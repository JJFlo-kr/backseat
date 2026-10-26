// Stages 1–4 of a delivery, shared by a send (src/main/send.ts) and a job's request text (src/main/uiux/jobpaste.ts):
//   1. the target is the same window instance as chosen (a closed window or a reused handle is never "close enough"),
//   2. it comes to the front and is still that window,
//   3. UI Automation says the focused element is an editable, non-password field of that process (or a terminal),
//   4. Ctrl+V goes out only if the same window is in front and the same element still has the focus.
// Any doubt returns the step and the reason before Ctrl+V. The caller owns the clipboard, Enter and its own log.
// Deliveries run one at a time (runExclusive): a send and a job paste must not fight over the focus.
import type { AgentTarget, DeliveryStopReason, TargetIdentity } from '../shared/types'
import { compareIdentity, elementForLog, isChromiumRootPane, judgeInput, mayFocusSoleInput, type DeliveryLogEntry } from './delivery'
import { describeWindow, focusWindow, foregroundHwnd, liveWindow, processNameOf } from './native/win32'
import { uiaFocusSoleInput, uiaInputCheck, uiaPasteIfUnchanged, type FocusInfo } from './native/uia'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const CONSOLE_HOSTS = new Set(['conhost.exe', 'openconsole.exe'])

export type PasteStep = 'targetVerified' | 'inputVerified' | 'pasted'
export interface PasteStop {
  step: PasteStep
  reason: DeliveryStopReason
}

export interface PasteFlowHooks {
  /** The target is about to be brought forward. */
  onFocus?(): void
  /** A stage was confirmed. */
  reached?(step: PasteStep): void
  /** Diagnostic lines (steps and verdicts only, never typed text). */
  log?(event: string, extra: Partial<DeliveryLogEntry>): void
}

let queue: Promise<unknown> = Promise.resolve()

/** Runs deliveries one at a time, in call order; a failed one does not block the next. */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn)
  queue = result.catch(() => undefined)
  return result
}

/**
 * Stages 1–4 for a target with a window. `identity` is what the window must still be (a title the user confirmed
 * after a stop replaces the remembered one). 'pasted' means Ctrl+V was sent: an attempt, not proof of arrival.
 */
export async function verifyAndPaste(target: AgentTarget, identity: TargetIdentity, hooks: PasteFlowHooks = {}): Promise<'pasted' | PasteStop> {
  const stop = (step: PasteStep, reason: DeliveryStopReason): PasteStop => ({ step, reason })
  const sameWindow = (): DeliveryStopReason | null => {
    const c = compareIdentity(identity, liveWindow(target.hwnd), target.kind)
    return c === 'expired' ? 'targetExpired' : c === 'titleChanged' ? 'targetChanged' : null
  }

  // 1. Same window instance as chosen.
  const before = sameWindow()
  if (before) return stop('targetVerified', before)

  // 2. Bring it forward; what is in front now must still be that window (for a browser: the visible tab's title).
  hooks.onFocus?.()
  const focused = await focusWindow(target.hwnd)
  if (!focused || foregroundHwnd() !== target.hwnd) return stop('targetVerified', 'focusLost')
  const after = sameWindow()
  if (after) return stop('targetVerified', after)
  hooks.reached?.('targetVerified')

  // 3. The focused element must be a field we may paste into — never a password field.
  // A classic console window's text area is a nameless Document of its console host process (conhost.exe).
  const consoleWindow = describeWindow(target.hwnd)?.className === 'ConsoleWindowClass'
  const judge = (f: FocusInfo | null) =>
    judgeInput(f, {
      pid: identity.pid,
      method: target.method,
      kind: target.kind,
      consoleHostFocus: consoleWindow && f !== null && CONSOLE_HOSTS.has(processNameOf(f.pid).toLowerCase())
    })
  // Chromium's first answers may name its window pane until its accessibility tree is on: ask again shortly.
  const check = async (): Promise<FocusInfo | null> => {
    let f = await uiaInputCheck()
    for (let i = 0; i < 5 && isChromiumRootPane(f); i++) {
      await sleep(200)
      f = await uiaInputCheck()
    }
    return f
  }
  try {
    await sleep(80) // let the app restore its own focus after activation
    let focus = await check()
    let verdict = judge(focus)
    if (!verdict.ok && verdict.reason === 'notEditable' && mayFocusSoleInput(target.kind)) {
      const sole = await uiaFocusSoleInput(target.hwnd)
      hooks.log?.('soleInput', { detail: `candidates=${sole.candidates} passwordFields=${sole.passwordFields} focused=${sole.focused}` })
      if (sole.focused) {
        await sleep(120)
        focus = await check()
        verdict = judge(focus)
      }
    }
    hooks.log?.('inputCheck', { element: elementForLog(focus, identity.pid), detail: verdict.ok ? `ok:${verdict.via}` : verdict.reason })
    if (!verdict.ok) return stop('inputVerified', verdict.reason)
  } catch (err) {
    hooks.log?.('inputCheck', { detail: `uia:${err instanceof Error ? err.message.slice(0, 80) : 'error'}` })
    return stop('inputVerified', 'uiaUnavailable')
  }
  hooks.reached?.('inputVerified')

  // 4. Ctrl+V only if the same window is in front and the same element still has the focus.
  let pasted
  try {
    pasted = await uiaPasteIfUnchanged(target.hwnd)
  } catch {
    return stop('pasted', 'uiaUnavailable')
  }
  if (!pasted.pasted) {
    const r = pasted.reason
    return stop('pasted', r === 'password' ? 'passwordField' : r === 'none' ? 'error' : r === 'timeout' ? 'uiaUnavailable' : 'focusLost')
  }
  hooks.reached?.('pasted')
  return 'pasted'
}
