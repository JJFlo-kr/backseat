// Thin Win32 layer (koffi, N-API) for window enumeration, foreground detection,
// focusing a window and sending Ctrl+V / Enter. Everything degrades to no-ops
// off Windows so the rest of the app keeps working.
import koffi from 'koffi'
import { screen } from 'electron'
import { basename } from 'path'
import type { Rect, WindowInfo } from '../../shared/types'

const GW_HWNDNEXT = 2
const GA_ROOT = 2
const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x80
const DWMWA_CLOAKED = 14
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const SW_RESTORE = 9
const KEYEVENTF_KEYUP = 2
const VK_MENU = 0x12
const VK_CONTROL = 0x11
const VK_RETURN = 0x0d
const VK_V = 0x56
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const TH32CS_SNAPPROCESS = 0x2
/** sizeof(PROCESSENTRY32W) on x64; th32ProcessID at 8, th32ParentProcessID at 32. */
const PROCESSENTRY32W_SIZE = 568
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow'])

type Fn = (...args: unknown[]) => unknown

interface Api {
  GetTopWindow: Fn
  GetWindow: Fn
  IsWindowVisible: Fn
  IsIconic: Fn
  GetWindowTextW: Fn
  GetClassNameW: Fn
  GetWindowLongPtrW: Fn
  GetAncestor: Fn
  GetWindowThreadProcessId: Fn
  GetForegroundWindow: Fn
  SetForegroundWindow: Fn
  ShowWindow: Fn
  GetWindowRect: Fn
  keybd_event: Fn
  DwmGetWindowAttribute: Fn
  OpenProcess: Fn
  QueryFullProcessImageNameW: Fn
  CloseHandle: Fn
  SetCursorPos: Fn
  GetCursorPos: Fn
  SendInput: Fn
  PostMessageW: Fn
  WindowFromPoint: Fn
  CreateToolhelp32Snapshot: Fn
  Process32FirstW: Fn
  Process32NextW: Fn
  CloseHandleI: Fn
}

let api: Api | null | undefined

function load(): Api | null {
  if (api !== undefined) return api
  if (process.platform !== 'win32') return (api = null)
  try {
    const user32 = koffi.load('user32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    const kernel32 = koffi.load('kernel32.dll')
    api = {
      GetTopWindow: user32.func('uintptr_t GetTopWindow(uintptr_t hwnd)') as Fn,
      GetWindow: user32.func('uintptr_t GetWindow(uintptr_t hwnd, uint32_t cmd)') as Fn,
      IsWindowVisible: user32.func('bool IsWindowVisible(uintptr_t hwnd)') as Fn,
      IsIconic: user32.func('bool IsIconic(uintptr_t hwnd)') as Fn,
      GetWindowTextW: user32.func('int GetWindowTextW(uintptr_t hwnd, _Out_ uint16_t *buf, int n)') as Fn,
      GetClassNameW: user32.func('int GetClassNameW(uintptr_t hwnd, _Out_ uint16_t *buf, int n)') as Fn,
      GetWindowLongPtrW: user32.func('intptr_t GetWindowLongPtrW(uintptr_t hwnd, int index)') as Fn,
      GetAncestor: user32.func('uintptr_t GetAncestor(uintptr_t hwnd, uint32_t flags)') as Fn,
      GetWindowThreadProcessId: user32.func('uint32_t GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *pid)') as Fn,
      GetForegroundWindow: user32.func('uintptr_t GetForegroundWindow()') as Fn,
      SetForegroundWindow: user32.func('bool SetForegroundWindow(uintptr_t hwnd)') as Fn,
      ShowWindow: user32.func('bool ShowWindow(uintptr_t hwnd, int cmd)') as Fn,
      GetWindowRect: user32.func('bool GetWindowRect(uintptr_t hwnd, _Out_ uint8_t *rect)') as Fn,
      keybd_event: user32.func('void keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)') as Fn,
      DwmGetWindowAttribute: dwmapi.func(
        'int DwmGetWindowAttribute(uintptr_t hwnd, uint32_t attr, _Out_ uint8_t *pv, uint32_t cb)'
      ) as Fn,
      OpenProcess: kernel32.func('uintptr_t OpenProcess(uint32_t access, bool inherit, uint32_t pid)') as Fn,
      QueryFullProcessImageNameW: kernel32.func(
        'bool QueryFullProcessImageNameW(uintptr_t h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'
      ) as Fn,
      CloseHandle: kernel32.func('bool CloseHandle(uintptr_t h)') as Fn,
      SetCursorPos: user32.func('bool SetCursorPos(int x, int y)') as Fn,
      GetCursorPos: user32.func('bool GetCursorPos(_Out_ uint8_t *pt)') as Fn,
      SendInput: user32.func('uint32_t SendInput(uint32_t n, _In_ uint8_t *inputs, int cb)') as Fn,
      PostMessageW: user32.func('bool PostMessageW(uintptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)') as Fn,
      WindowFromPoint: user32.func('uintptr_t WindowFromPoint(int64_t pt)') as Fn,
      // intptr_t: INVALID_HANDLE_VALUE is -1
      CreateToolhelp32Snapshot: kernel32.func('intptr_t CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)') as Fn,
      Process32FirstW: kernel32.func('bool Process32FirstW(intptr_t h, _Inout_ uint8_t *pe)') as Fn,
      Process32NextW: kernel32.func('bool Process32NextW(intptr_t h, _Inout_ uint8_t *pe)') as Fn,
      CloseHandleI: kernel32.func('bool CloseHandle(intptr_t h)') as Fn
    }
  } catch (err) {
    console.error('[backseat] win32 layer unavailable:', err)
    api = null
  }
  return api
}

export function win32Available(): boolean {
  return load() !== null
}

function utf16(buf: Uint16Array, n: number): string {
  return String.fromCharCode(...buf.subarray(0, Math.max(0, n)))
}

function windowText(a: Api, hwnd: number): string {
  const buf = new Uint16Array(512)
  const n = a.GetWindowTextW(hwnd, buf, buf.length) as number
  return utf16(buf, n)
}

function className(a: Api, hwnd: number): string {
  const buf = new Uint16Array(256)
  const n = a.GetClassNameW(hwnd, buf, buf.length) as number
  return utf16(buf, n)
}

const processNames = new Map<number, string>()

function processName(a: Api, pid: number): string {
  const cached = processNames.get(pid)
  if (cached) return cached
  let name = ''
  const h = a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) as number
  if (h) {
    const buf = new Uint16Array(1024)
    const size = new Uint32Array([buf.length])
    if (a.QueryFullProcessImageNameW(h, 0, buf, size)) name = basename(utf16(buf, size[0]))
    a.CloseHandle(h)
  }
  processNames.set(pid, name)
  return name
}

function physicalBounds(a: Api, hwnd: number): Rect | null {
  const raw = new Uint8Array(16)
  let ok = (a.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, raw, 16) as number) === 0
  if (!ok) ok = a.GetWindowRect(hwnd, raw) as boolean
  if (!ok) return null
  const r = new Int32Array(raw.buffer, raw.byteOffset, 4)
  return { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] }
}

function isCloaked(a: Api, hwnd: number): boolean {
  const raw = new Uint8Array(4)
  if ((a.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, raw, 4) as number) !== 0) return false
  return new Uint32Array(raw.buffer, raw.byteOffset, 1)[0] !== 0
}

function describe(a: Api, hwnd: number): WindowInfo | null {
  const title = windowText(a, hwnd)
  if (!title) return null
  const pidOut = new Uint32Array(1)
  a.GetWindowThreadProcessId(hwnd, pidOut)
  const pid = pidOut[0]
  const px = physicalBounds(a, hwnd)
  if (!px) return null
  const dip = screen.screenToDipRect(null, px)
  return { hwnd, pid, title, process: processName(a, pid), bounds: dip, className: className(a, hwnd) }
}

/** Visible top-level windows in z-order (front-most first), excluding our own. */
export function listTopLevelWindows(): WindowInfo[] {
  const a = load()
  if (!a) return []
  const out: WindowInfo[] = []
  let hwnd = a.GetTopWindow(0) as number
  let guard = 0
  while (hwnd && guard++ < 4000) {
    try {
      if (
        a.IsWindowVisible(hwnd) &&
        !a.IsIconic(hwnd) &&
        (a.GetAncestor(hwnd, GA_ROOT) as number) === hwnd &&
        (Number(a.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) === 0 &&
        !SKIP_CLASSES.has(className(a, hwnd)) &&
        !isCloaked(a, hwnd)
      ) {
        const info = describe(a, hwnd)
        if (info && info.pid !== process.pid && info.bounds.width > 10 && info.bounds.height > 10) out.push(info)
      }
    } catch {
      /* skip broken window */
    }
    hwnd = a.GetWindow(hwnd, GW_HWNDNEXT) as number
  }
  return out
}

/**
 * pid -> parent pid for every running process (one Toolhelp snapshot). Used to prove that an MCP agent runs
 * inside a given window (src/main/agents.ts agentForWindow). Empty off Windows or on failure.
 */
export function processParents(): Map<number, number> {
  const out = new Map<number, number>()
  const a = load()
  if (!a) return out
  const snap = a.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) as number
  if (snap === -1 || !snap) return out
  try {
    const pe = new Uint8Array(PROCESSENTRY32W_SIZE)
    const view = new DataView(pe.buffer)
    view.setUint32(0, PROCESSENTRY32W_SIZE, true)
    let ok = Boolean(a.Process32FirstW(snap, pe))
    while (ok) {
      out.set(view.getUint32(8, true), view.getUint32(32, true))
      ok = Boolean(a.Process32NextW(snap, pe))
    }
  } catch (err) {
    console.error('[backseat] process snapshot failed:', err)
  } finally {
    a.CloseHandleI(snap)
  }
  return out
}

/** True when the handle still refers to a live window. */
export function isWindow(hwnd: number): boolean {
  const a = load()
  if (!a || !hwnd) return false
  try {
    return Boolean(a.IsWindowVisible(hwnd)) || Boolean(a.IsIconic(hwnd))
  } catch {
    return false
  }
}

export function getForegroundWindow(): WindowInfo | null {
  const a = load()
  if (!a) return null
  const hwnd = a.GetForegroundWindow() as number
  if (!hwnd) return null
  try {
    return describe(a, hwnd)
  } catch {
    return null
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Bring a window to the front; resolves true when it really is the foreground window. */
export async function focusWindow(hwnd: number): Promise<boolean> {
  const a = load()
  if (!a) return false
  if (a.IsIconic(hwnd)) a.ShowWindow(hwnd, SW_RESTORE)
  // Tapping Alt first lifts Windows' foreground lock for the next SetForegroundWindow.
  a.keybd_event(VK_MENU, 0, 0, 0)
  a.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
  a.SetForegroundWindow(hwnd)
  for (let i = 0; i < 10; i++) {
    await sleep(40)
    if ((a.GetForegroundWindow() as number) === hwnd) return true
  }
  return false
}

function tap(a: Api, vk: number): void {
  a.keybd_event(vk, 0, 0, 0)
  a.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
}

export function sendCtrlV(): boolean {
  const a = load()
  if (!a) return false
  a.keybd_event(VK_CONTROL, 0, 0, 0)
  tap(a, VK_V)
  a.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
  return true
}

export function sendEnter(): boolean {
  const a = load()
  if (!a) return false
  tap(a, VK_RETURN)
  return true
}

// ---------- mouse wheel (scroll capture) ----------

const INPUT_MOUSE = 0
const MOUSEEVENTF_WHEEL = 0x0800
export const WHEEL_DELTA = 120
const WM_MOUSEWHEEL = 0x020a
/** sizeof(INPUT) on x64: DWORD type + 4 pad + MOUSEINPUT (32 bytes). */
const INPUT_SIZE = 40

/** Physical-pixel cursor position, or null off Windows. */
export function getCursorPos(): { x: number; y: number } | null {
  const a = load()
  if (!a) return null
  const raw = new Uint8Array(8)
  if (!a.GetCursorPos(raw)) return null
  const p = new Int32Array(raw.buffer, raw.byteOffset, 2)
  return { x: p[0], y: p[1] }
}

export function setCursorPos(x: number, y: number): boolean {
  const a = load()
  if (!a) return false
  return Boolean(a.SetCursorPos(Math.round(x), Math.round(y)))
}

/**
 * One wheel event with a raw delta in WHEEL_DELTA units (120 = one notch; negative = down) through
 * SendInput, i.e. exactly what a real wheel does: the window under the cursor scrolls.
 * Chromium-based windows honour fractions of a notch (precision scrolling). Returns 1 on success.
 */
export function sendWheelDelta(delta: number): number {
  const a = load()
  if (!a || delta === 0) return 0
  const buf = new Uint8Array(INPUT_SIZE)
  const dv = new DataView(buf.buffer)
  dv.setUint32(0, INPUT_MOUSE, true)
  dv.setInt32(8, 0, true) // dx
  dv.setInt32(12, 0, true) // dy
  dv.setInt32(16, Math.round(delta), true) // mouseData
  dv.setUint32(20, MOUSEEVENTF_WHEEL, true)
  dv.setUint32(24, 0, true) // time; dwExtraInfo (8 bytes at +32) stays 0
  return Number(a.SendInput(1, buf, INPUT_SIZE))
}

/** Whole notches (negative = down), one event each, for apps that only act on full WHEEL_DELTA steps. */
export function sendWheel(ticks: number): number {
  let sent = 0
  for (let i = 0; i < Math.abs(ticks); i++) sent += sendWheelDelta(ticks < 0 ? -WHEEL_DELTA : WHEEL_DELTA)
  return sent
}

/** Fallback when SendInput is blocked (UIPI): post WM_MOUSEWHEEL straight to the window. */
export function postWheel(hwnd: number, delta: number, screenX: number, screenY: number): boolean {
  const a = load()
  if (!a || delta === 0) return false
  const wParam = BigInt(delta & 0xffff) << 16n // HIWORD = signed wheel delta, LOWORD = no modifier keys
  const lParam = ((screenY & 0xffff) << 16) | (screenX & 0xffff)
  return Boolean(a.PostMessageW(hwnd, WM_MOUSEWHEEL, wParam, lParam))
}

/** Top-level window under a physical-pixel point (0 when none). */
export function windowAtPoint(x: number, y: number): number {
  const a = load()
  if (!a) return 0
  const packed = (BigInt(y & 0xffffffff) << 32n) | BigInt(x & 0xffffffff)
  const hwnd = Number(a.WindowFromPoint(BigInt.asIntN(64, packed)))
  return hwnd ? (a.GetAncestor(hwnd, GA_ROOT) as number) : 0
}
