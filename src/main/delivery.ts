// Decisions behind a staged delivery (plan 2026-10-25 §3 phase 2): is the target still the same window,
// is the focused element a field we may paste into, and the DeliveryStatus that records only what was
// confirmed. Pure: no Electron, no Win32 (tests/delivery.test.ts).
import type { AgentKind, AgentTarget, DeliveryStatus, DeliveryStep, DeliveryStopReason, SendTargetView, TargetIdentity } from '../shared/types'
import { UIA_CONTROL, type FocusInfo } from './native/uia-types'

// ---------- target identity ----------

/** What the window looks like right now (null: the handle no longer names a window). */
export interface LiveWindow {
  pid: number
  processStartMs: number
  title: string
}

export type IdentityCheck = 'same' | 'expired' | 'titleChanged'

/** The handle still names a window of the same process instance (pid + start time; the title may differ). */
export function sameInstance(saved: TargetIdentity, now: LiveWindow | null): boolean {
  if (!now || now.pid !== saved.pid) return false
  return !saved.processStartMs || !now.processStartMs || saved.processStartMs === now.processStartMs
}

/**
 * Browser windows show the active tab's title, and an arbitrary picked window (a messenger) shows the open
 * conversation: there a new title can mean a different page or person. Terminals, editors and the AI apps
 * retitle themselves all the time (running command, open file), so their title is not compared.
 */
const TITLE_SENSITIVE = new Set<AgentKind>(['chat', 'unknown'])

/**
 * Is `now` still the window the user chose? A reused handle or a restarted process (other pid or start
 * time) is a different window: 'expired'. A changed title of a browser / picked window: 'titleChanged',
 * which the user may confirm once (SendOptions.confirmTarget).
 */
export function compareIdentity(saved: TargetIdentity, now: LiveWindow | null, kind: AgentKind): IdentityCheck {
  if (!sameInstance(saved, now)) return 'expired'
  if (TITLE_SENSITIVE.has(kind) && now?.title !== saved.title) return 'titleChanged'
  return 'same'
}

// ---------- the focused element ----------

/** Window classes of console / terminal text areas: they take a paste although UIA calls them a pane. */
const TERMINAL_CLASSES = new Set(['TermControl', 'ConsoleWindowClass', 'PseudoConsoleWindow'])

export type InputVerdict =
  | { ok: true; via: 'field' | 'terminal' }
  | { ok: false; reason: Extract<DeliveryStopReason, 'notEditable' | 'passwordField' | 'focusLost'> }

/**
 * May Ctrl+V go into the focused element? In order: there is one; it is NOT a password field (checked
 * before anything else, whatever the app); it belongs to the target's process; and it is a terminal text
 * area of a terminal target, or an enabled edit / document whose value is not read-only. A focused page,
 * button or list is 'notEditable': the active window alone never counts as an input (request (1) item 2).
 */
export function judgeInput(focus: FocusInfo | null, target: Pick<AgentTarget, 'method' | 'kind'> & { pid: number }): InputVerdict {
  if (!focus) return { ok: false, reason: 'notEditable' }
  if (focus.isPassword) return { ok: false, reason: 'passwordField' }
  const terminal = target.method === 'paste-path' && TERMINAL_CLASSES.has(focus.className)
  // Console windows report the shell's pid for the window but conhost's for the element: the class decides.
  if (focus.pid !== target.pid && !terminal) return { ok: false, reason: 'focusLost' }
  if (terminal) return { ok: true, via: 'terminal' }
  if (!focus.isEnabled) return { ok: false, reason: 'notEditable' }
  const textual = focus.controlType === UIA_CONTROL.edit || focus.controlType === UIA_CONTROL.document
  if (textual && focus.valuePattern && focus.valueReadOnly === false) return { ok: true, via: 'field' }
  return { ok: false, reason: 'notEditable' }
}

/** Claude / ChatGPT·Codex apps: the only kinds where Backseat may focus the message box itself (UIA SetFocus). */
export function mayFocusSoleInput(kind: AgentKind): boolean {
  return kind === 'claude-desktop' || kind === 'codex'
}

// ---------- staged status ----------

const ORDER: DeliveryStep[] = ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted', 'fetched']

/** Accumulates the steps of one send; every step is added only once it was confirmed. */
export class DeliveryTracker {
  readonly status: DeliveryStatus

  constructor(target?: SendTargetView) {
    this.status = { sendId: '', reached: [], ...(target ? { target } : {}) }
  }

  reach(step: DeliveryStep): void {
    if (!this.status.reached.includes(step)) this.status.reached.push(step)
    this.status.reached.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  }

  stop(step: DeliveryStep, reason: DeliveryStopReason): DeliveryStatus {
    this.status.stoppedAt = { step, reason }
    return this.status
  }

  has(step: DeliveryStep): boolean {
    return this.status.reached.includes(step)
  }
}

/** Kinds where Enter submits to an AI. 'terminal' (no agent recognised: a plain shell would run the line as a
 * command) and 'unknown' (a picked messenger or page: Enter could message a person) never get one. */
const ENTER_KINDS = new Set<AgentKind>(['claude-code', 'claude-desktop', 'codex', 'cursor', 'vscode', 'orca', 'chat'])

/**
 * Auto Enter only after a verified paste: same target window, a checked input field, Ctrl+V sent after the
 * last re-check (request (1) item 3) — into a known AI tool that still looks like the same kind of window,
 * and not on a send whose changed title the user merely confirmed. Anything less and the line waits.
 */
export function mayPressEnter(
  status: DeliveryStatus,
  wanted: boolean,
  target: { kind: AgentKind; sameKindNow: boolean; confirmed: boolean }
): boolean {
  if (!wanted || status.stoppedAt || target.confirmed || !target.sameKindNow || !ENTER_KINDS.has(target.kind)) return false
  return (['targetVerified', 'inputVerified', 'pasted'] as const).every((s) => status.reached.includes(s))
}

// ---------- diagnostics ----------

/**
 * One line of the delivery log: steps and verdicts only. Never window titles, clipboard text, the memo,
 * element names or values (a password field's content must not end up in a log file).
 */
export interface DeliveryLogEntry {
  at: string
  sendId: string
  source: SendTargetView['source'] | 'none'
  kind?: AgentKind
  process?: string
  method?: SendTargetView['method']
  event: string
  reached: DeliveryStep[]
  stoppedAt?: { step: DeliveryStep; reason: DeliveryStopReason }
  element?: { controlType: number; className: string; frameworkId: string; isPassword: boolean; readOnly: boolean | null; samePid: boolean }
  detail?: string
}

/**
 * The element part of a log line: type and flags, nothing the user typed. In web content (Chromium) the UIA
 * class name is the page's own HTML class attribute, so it is replaced by a placeholder.
 */
export function elementForLog(focus: FocusInfo | null, targetPid: number): DeliveryLogEntry['element'] {
  if (!focus) return undefined
  const web = focus.frameworkId === 'Chrome' && !/^Chrome_|^Intermediate D3D Window$/.test(focus.className)
  return {
    controlType: focus.controlType,
    className: web ? '(web)' : focus.className.slice(0, 64),
    frameworkId: focus.frameworkId.slice(0, 32),
    isPassword: focus.isPassword,
    readOnly: focus.valueReadOnly,
    samePid: focus.pid === targetPid
  }
}
