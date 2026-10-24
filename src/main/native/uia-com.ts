// Windows UI Automation (UIAutomationCore COM) through koffi vtable calls: what has the keyboard focus, and
// is it a field we may paste into? Plain Node (no Electron) so it runs in a worker thread
// (src/main/native/uia-worker.ts) and in tests. Reads element type and flags only — never Name or Value,
// so no typed text or password ever leaves the target app (docs/plans/uia-spike.md).
import koffi from 'koffi'
import { UIA_CONTROL, UIA_PROP, type FocusInfo, type PasteCheck, type SoleInput } from './uia-types'

export { UIA_CONTROL, UIA_PROP, type FocusInfo, type PasteCheck, type SoleInput }

type Ptr = unknown

const S_OK = 0
const CLSCTX_INPROC_SERVER = 1
const COINIT_MULTITHREADED = 0
const VT_EMPTY = 0
const VT_I4 = 3
const VT_BSTR = 8
const VT_BOOL = 11
const TreeScope_Descendants = 4

// Vtable slots (UIAutomationClient.h). IUnknown: 0 QueryInterface, 1 AddRef, 2 Release.
const IUIAutomation_CompareElements = 3
const IUIAutomation_ElementFromHandle = 6
const IUIAutomation_GetFocusedElement = 8
const IUIAutomation_CreatePropertyCondition = 23
const IUIAutomation_CreateAndCondition = 25
const IUIAutomation2_put_ConnectionTimeout = 61
const IUIAutomation2_put_TransactionTimeout = 63
const IUIAutomationElement_SetFocus = 3
const IUIAutomationElement_FindAll = 6
const IUIAutomationElement_GetCurrentPropertyValue = 10
const IUIAutomationElementArray_get_Length = 3
const IUIAutomationElementArray_GetElement = 4

interface Com {
  CoInitializeEx: (reserved: null, flags: number) => number
  CoCreateInstance: (clsid: Buffer, outer: null, ctx: number, iid: Buffer, out: Ptr[]) => number
  VariantClear: (v: Buffer) => number
  GetForegroundWindow: () => number
  keybd_event: (vk: number, scan: number, flags: number, extra: number) => void
}

const P_OutPtr = koffi.proto('int UiaOutPtr(void *self, _Out_ void **out)')
const P_Var = koffi.proto('int UiaPropValue(void *self, int id, void *variant)')
const P_Release = koffi.proto('uint32_t UiaRelease(void *self)')
const P_SetU32 = koffi.proto('int UiaSetU32(void *self, uint32_t v)')
const P_Void = koffi.proto('int UiaVoid(void *self)')
const P_FromHandle = koffi.proto('int UiaFromHandle(void *self, uintptr_t hwnd, _Out_ void **el)')
const P_PropCond = koffi.proto('int UiaPropCond(void *self, int id, void *variant, _Out_ void **cond)')
const P_AndCond = koffi.proto('int UiaAndCond(void *self, void *a, void *b, _Out_ void **cond)')
const P_FindAll = koffi.proto('int UiaFindAll(void *self, int scope, void *cond, _Out_ void **arr)')
const P_OutInt = koffi.proto('int UiaOutInt(void *self, _Out_ int *n)')
const P_GetElement = koffi.proto('int UiaGetElement(void *self, int i, _Out_ void **el)')
const P_Compare = koffi.proto('int UiaCompare(void *self, void *a, void *b, _Out_ int *same)')

function guid(s: string): Buffer {
  const h = s.replace(/[{}-]/g, '')
  const b = Buffer.alloc(16)
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0)
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4)
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6)
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + 2 * i, 18 + 2 * i), 16)
  return b
}

const CLSID_CUIAutomation8 = guid('{e22ad333-b25f-460c-83d0-0581107395c9}')
const IID_IUIAutomation2 = guid('{34723aff-0c9d-49d0-9896-7ab52df8cd8a}')

let com: Com | null = null
let uia: Ptr = null
/** The element the last inputCheck() accepted; pasteIfUnchanged() compares the focus against it. */
let verified: Ptr = null

function loadCom(): Com {
  if (com) return com
  const ole32 = koffi.load('ole32.dll')
  const oleaut32 = koffi.load('oleaut32.dll')
  const user32 = koffi.load('user32.dll')
  com = {
    CoInitializeEx: ole32.func('int CoInitializeEx(void *r, uint32_t c)') as Com['CoInitializeEx'],
    CoCreateInstance: ole32.func(
      'int CoCreateInstance(void *clsid, void *outer, uint32_t ctx, void *iid, _Out_ void **ppv)'
    ) as Com['CoCreateInstance'],
    VariantClear: oleaut32.func('int VariantClear(void *v)') as Com['VariantClear'],
    GetForegroundWindow: user32.func('uintptr_t GetForegroundWindow()') as Com['GetForegroundWindow'],
    keybd_event: user32.func('void keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)') as Com['keybd_event']
  }
  return com
}

function slot(obj: Ptr, index: number): Ptr {
  const vtbl = koffi.decode(obj, 'void *') as Ptr
  return (koffi.decode(vtbl, 'void *', index + 1) as Ptr[])[index]
}

function call(obj: Ptr, index: number, proto: ReturnType<typeof koffi.proto>, ...args: unknown[]): number {
  return koffi.call(slot(obj, index), proto, obj, ...args) as number
}

function release(obj: Ptr): void {
  if (obj) call(obj, 2, P_Release)
}

function hex(hr: number): string {
  return `0x${(hr >>> 0).toString(16)}`
}

/** Create the UIA client once per thread (MTA, as UIA recommends for clients). Throws when UIA is missing. */
export function initUia(timeoutMs = 1000): void {
  if (uia) return
  const c = loadCom()
  c.CoInitializeEx(null, COINIT_MULTITHREADED) // S_FALSE / RPC_E_CHANGED_MODE are fine: COM is usable
  const out: Ptr[] = [null]
  const hr = c.CoCreateInstance(CLSID_CUIAutomation8, null, CLSCTX_INPROC_SERVER, IID_IUIAutomation2, out)
  if (hr < 0 || !out[0]) throw new Error(`UI Automation unavailable (${hex(hr)})`)
  uia = out[0]
  // A hung target app must not stall delivery for the default 20 s.
  call(uia, IUIAutomation2_put_ConnectionTimeout, P_SetU32, timeoutMs)
  call(uia, IUIAutomation2_put_TransactionTimeout, P_SetU32, timeoutMs)
}

function readVariant(v: Buffer): number | boolean | string | null {
  const vt = v.readUInt16LE(0)
  let out: number | boolean | string | null = null
  if (vt === VT_I4) out = v.readInt32LE(8)
  else if (vt === VT_BOOL) out = v.readInt16LE(8) !== 0
  else if (vt === VT_BSTR) {
    const p = koffi.decode(v, 8, 'void *') as Ptr
    out = p ? (koffi.decode(p, 'char16_t', -1) as string) : ''
  } else if (vt === VT_EMPTY) out = null
  // anything else (VT_UNKNOWN = "not supported") stays null
  loadCom().VariantClear(v)
  return out
}

function prop(el: Ptr, id: number): number | boolean | string | null {
  const v = Buffer.alloc(24)
  const hr = call(el, IUIAutomationElement_GetCurrentPropertyValue, P_Var, id, v)
  if (hr < 0) throw new Error(`property ${id} failed (${hex(hr)})`)
  return readVariant(v)
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const bool = (v: unknown): boolean => v === true
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Fails closed: anything but an explicit IsPassword = false counts as a password field. */
function passwordOf(el: Ptr): boolean {
  return prop(el, UIA_PROP.isPassword) !== false
}

function describe(el: Ptr): FocusInfo {
  const valuePattern = bool(prop(el, UIA_PROP.isValuePatternAvailable))
  const ro = valuePattern ? prop(el, UIA_PROP.valueIsReadOnly) : null
  return {
    pid: num(prop(el, UIA_PROP.processId)),
    controlType: num(prop(el, UIA_PROP.controlType)),
    className: str(prop(el, UIA_PROP.className)),
    frameworkId: str(prop(el, UIA_PROP.frameworkId)),
    isPassword: passwordOf(el),
    hasKeyboardFocus: bool(prop(el, UIA_PROP.hasKeyboardFocus)),
    isEnabled: bool(prop(el, UIA_PROP.isEnabled)),
    isKeyboardFocusable: bool(prop(el, UIA_PROP.isKeyboardFocusable)),
    valuePattern,
    valueReadOnly: typeof ro === 'boolean' ? ro : null,
    textPattern: bool(prop(el, UIA_PROP.isTextPatternAvailable)),
    nativeHwnd: num(prop(el, UIA_PROP.nativeWindowHandle))
  }
}

function focusedElement(): Ptr {
  if (!uia) initUia()
  const out: Ptr[] = [null]
  const hr = call(uia, IUIAutomation_GetFocusedElement, P_OutPtr, out)
  if (hr < 0) throw new Error(`GetFocusedElement failed (${hex(hr)})`)
  return out[0] ?? null
}

/** The element with the keyboard focus, or null when nothing has it. */
export function focusedInfo(): FocusInfo | null {
  const el = focusedElement()
  if (!el) return null
  try {
    return describe(el)
  } finally {
    release(el)
  }
}

/**
 * Read the focused element and remember it as the one a following pasteIfUnchanged() must still find
 * focused. Returns its description (the caller judges it: src/main/delivery.ts judgeInput). Deliveries run
 * one at a time (src/main/send.ts), so one remembered element is enough.
 */
export function inputCheck(): FocusInfo | null {
  clearVerified()
  const el = focusedElement()
  if (!el) return null
  try {
    const info = describe(el)
    verified = el
    return info
  } catch (err) {
    release(el)
    throw err
  }
}

/** Forget the remembered element (after a delivery or a stop). */
export function clearVerified(): void {
  if (verified) release(verified)
  verified = null
}

const VK_CONTROL = 0x11
const VK_V = 0x56
const VK_RETURN = 0x0d
const KEYEVENTF_KEYUP = 2

/**
 * Is the keyboard focus still exactly where inputCheck() looked: the target window in front, the same
 * element (CompareElements), still not a password field? null = yes, else why not.
 */
function stillVerified(hwnd: number): PasteCheck | null {
  const c = loadCom()
  if (!verified) return { pasted: false, reason: 'none' }
  if (Number(c.GetForegroundWindow()) !== hwnd) return { pasted: false, reason: 'foreground' }
  const el = focusedElement()
  if (!el) return { pasted: false, reason: 'focus' }
  try {
    const same: number[] = [0]
    const hr = call(uia, IUIAutomation_CompareElements, P_Compare, verified, el, same)
    if (hr < 0 || !same[0]) return { pasted: false, reason: 'focus' }
    if (passwordOf(el)) return { pasted: false, reason: 'password' }
    if (Number(c.GetForegroundWindow()) !== hwnd) return { pasted: false, reason: 'foreground' }
    return null
  } finally {
    release(el)
  }
}

function press(chord: number[]): void {
  const c = loadCom()
  for (const vk of chord) c.keybd_event(vk, 0, 0, 0)
  for (const vk of [...chord].reverse()) c.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
}

/**
 * The last check before Ctrl+V, as close to the key press as possible (stillVerified). `deadlineAt`
 * (ms since 1970): past it no key is pressed — the main process has already given up on this call and
 * reported that nothing was pasted. The element stays remembered for enterIfUnchanged().
 */
export function pasteIfUnchanged(hwnd: number, deadlineAt: number): PasteCheck {
  const why = stillVerified(hwnd)
  if (why) {
    clearVerified()
    return why
  }
  if (Date.now() > deadlineAt) {
    clearVerified()
    return { pasted: false, reason: 'timeout' }
  }
  press([VK_CONTROL, VK_V])
  return { pasted: true }
}

/** Enter after a verified paste, under the same checks as the paste itself; forgets the element either way. */
export function enterIfUnchanged(hwnd: number, deadlineAt: number): PasteCheck {
  try {
    const why = stillVerified(hwnd)
    if (why) return why
    if (Date.now() > deadlineAt) return { pasted: false, reason: 'timeout' }
    press([VK_RETURN])
    return { pasted: true }
  } finally {
    clearVerified()
  }
}

function intVariant(value: number): Buffer {
  const v = Buffer.alloc(24)
  v.writeUInt16LE(VT_I4, 0)
  v.writeInt32LE(value, 8)
  return v
}

function boolVariant(value: boolean): Buffer {
  const v = Buffer.alloc(24)
  v.writeUInt16LE(VT_BOOL, 0)
  v.writeInt16LE(value ? -1 : 0, 8)
  return v
}

/**
 * Chat apps (Claude, ChatGPT / Codex) where the message box is not focused: when the window has exactly
 * ONE usable text input and no password field at all, give it the keyboard focus through UIA (no
 * coordinates, no Tab presses). With zero or several candidates — or a sign-in view (email + password) —
 * nothing is focused and the caller stops.
 */
export function focusSoleInput(hwnd: number): SoleInput {
  if (!uia) initUia()
  const rootOut: Ptr[] = [null]
  call(uia, IUIAutomation_ElementFromHandle, P_FromHandle, hwnd, rootOut)
  const root = rootOut[0]
  if (!root) return { candidates: 0, passwordFields: 0, focused: false }
  const conds: Ptr[] = []
  const cond = (id: number, v: Buffer): Ptr => {
    const out: Ptr[] = [null]
    call(uia, IUIAutomation_CreatePropertyCondition, P_PropCond, id, v, out)
    conds.push(out[0])
    return out[0]
  }
  const and = (a: Ptr, b: Ptr): Ptr => {
    const out: Ptr[] = [null]
    call(uia, IUIAutomation_CreateAndCondition, P_AndCond, a, b, out)
    conds.push(out[0])
    return out[0]
  }
  let arr: Ptr = null
  const usable: Ptr[] = []
  try {
    const edit = cond(UIA_PROP.controlType, intVariant(UIA_CONTROL.edit))
    const focusable = cond(UIA_PROP.isKeyboardFocusable, boolVariant(true))
    const enabled = cond(UIA_PROP.isEnabled, boolVariant(true))
    const onScreen = cond(UIA_PROP.isOffscreen, boolVariant(false))
    const all = and(and(edit, focusable), and(enabled, onScreen))
    const arrOut: Ptr[] = [null]
    const hr = call(root, IUIAutomationElement_FindAll, P_FindAll, TreeScope_Descendants, all, arrOut)
    arr = arrOut[0]
    if (hr < 0 || !arr) return { candidates: 0, passwordFields: 0, focused: false }
    const n: number[] = [0]
    call(arr, IUIAutomationElementArray_get_Length, P_OutInt, n)
    let passwordFields = 0
    for (let i = 0; i < n[0]; i++) {
      const elOut: Ptr[] = [null]
      call(arr, IUIAutomationElementArray_GetElement, P_GetElement, i, elOut)
      const el = elOut[0]
      if (!el) continue
      let keep = false
      try {
        if (passwordOf(el)) passwordFields++
        else keep = !(bool(prop(el, UIA_PROP.isValuePatternAvailable)) && prop(el, UIA_PROP.valueIsReadOnly) === true)
      } finally {
        if (keep) usable.push(el)
        else release(el)
      }
    }
    let focused = false
    if (usable.length === 1 && passwordFields === 0) focused = call(usable[0], IUIAutomationElement_SetFocus, P_Void) === S_OK
    return { candidates: usable.length, passwordFields, focused }
  } finally {
    for (const el of usable) release(el)
    release(arr)
    for (const c of conds) release(c)
    release(root)
  }
}
