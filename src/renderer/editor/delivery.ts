// What the editor shows around "보내기": the target chip, the "what will be sent" summary and, after a send,
// the delivery steps main could confirm. Only confirmed steps are shown as done, and no wording may read as
// "the AI understood / finished" (requests 2 and 3, plan 2026-10-25 §7). Pure (no DOM): tests/delivery.test.ts.
import type {
  AgentTarget, DeliveryStatus, DeliveryStep, DeliveryStopReason, PreflightReport, SendResult, SendTargetView, TargetSource
} from '../../shared/types'
import type { Translate } from '../../shared/i18n'

export const STEP_ORDER: readonly DeliveryStep[] = ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted', 'fetched']
export const STOP_REASONS: readonly DeliveryStopReason[] = [
  'noTarget', 'targetExpired', 'targetChanged', 'focusLost', 'notEditable', 'passwordField', 'uiaUnavailable', 'error'
]

// ---------- before sending ----------

export function preflight(image: boolean, annotations: number, memo: string, voice: PreflightReport['voice']): PreflightReport {
  return { image, annotations, memo: memo.trim().length > 0, voice }
}

/** "이미지 1 · 주석 3 · 메모 · 음성 설명 준비됨" as parts; a failed transcription is not a part (see voiceMissing). */
export function summaryParts(r: PreflightReport, t: Translate): string[] {
  const parts: string[] = []
  if (r.image) parts.push(t('editor.summary.image', { n: 1 }))
  if (r.annotations > 0) parts.push(t('editor.summary.annotations', { n: r.annotations }))
  if (r.memo) parts.push(t('editor.summary.memo'))
  switch (r.voice) {
    case 'ready': parts.push(t('editor.summary.voiceReady')); break
    case 'recording': parts.push(t('editor.summary.voiceRecording')); break
    case 'transcribing': parts.push(t('editor.summary.voiceTranscribing')); break
    case 'none':
    case 'failed':
      break
  }
  return parts
}

/** The recording has no text: 보내기 stops and the summary offers 다시 변환 / 음성 없이 보내기 (Codex review F12). */
export const voiceMissing = (r: PreflightReport): boolean => r.voice === 'failed'

// ---------- the target chip ----------

export type ChipTone = 'ok' | 'guess' | 'none' | 'warn'
export interface ChipView {
  /** Where: "Claude Code · backseat". */
  label: string
  /** How sure: "연결 확인됨", "추정 · 최근 사용"; empty when the label says it all. */
  state: string
  tone: ChipTone
}

/** The label plus the MCP project folder when the label does not name it already. */
export function targetText(v: SendTargetView): string {
  return v.project && !v.label.includes(v.project) ? `${v.label} · ${v.project}` : v.label
}

export function chipView(v: SendTargetView | null, t: Translate, opts: { expired?: boolean } = {}): ChipView {
  if (opts.expired) return { label: t('editor.target.expiredNote'), state: '', tone: 'warn' }
  if (!v || v.source === 'none') return { label: t('editor.chip.none'), state: '', tone: 'none' }
  if (v.method === 'clipboard' && !v.identity?.hwnd) return { label: t('editor.target.clipboardOnly'), state: '', tone: 'ok' }
  const label = targetText(v)
  switch (v.source) {
    case 'mcp-verified': return { label, state: t('editor.chip.verified'), tone: 'ok' }
    case 'picked': return { label, state: t('editor.chip.picked'), tone: 'ok' }
    case 'pinned': return { label, state: t('editor.chip.pinned'), tone: 'ok' }
    case 'recent-agent': return { label, state: t('editor.chip.recent'), tone: 'guess' }
    case 'foreground-agent': return { label, state: t('editor.chip.guess'), tone: 'guess' }
  }
}

/** A detected / candidate window as a chip view (until main sends SendTargetView itself). */
export function viewFromAgent(a: AgentTarget, source: TargetSource): SendTargetView {
  const project = a.mcp?.cwd ? a.mcp.cwd.split(/[\\/]/).filter(Boolean).pop() : undefined
  return {
    source,
    label: a.label,
    kind: a.kind,
    ...(project ? { project } : {}),
    estimated: !(source === 'picked' || source === 'pinned' || source === 'mcp-verified'),
    method: a.method,
    identity: { hwnd: a.hwnd, pid: 0, processStartMs: 0, title: a.title, process: a.process }
  }
}

/** The chip at open time: main's SendTargetView, else derived from the legacy fields. */
export function initialTarget(init: { sendTarget?: SendTargetView; target: AgentTarget | null; targetPinned?: boolean }): SendTargetView | null {
  if (init.sendTarget) return init.sendTarget
  const a = init.target
  if (!a) return null
  return viewFromAgent(a, init.targetPinned ? 'pinned' : a.mcp ? 'mcp-verified' : 'foreground-agent')
}

// ---------- after sending ----------

export type StepState = 'done' | 'stopped'
export type DeliveryAction = 'resend' | 'retarget' | 'copy'
export type DeliveryTone = 'ok' | 'wait' | 'warn' | 'error'

export interface DeliveryView {
  steps: { step: DeliveryStep; label: string; state: StepState }[]
  /** What happened, in the user's words. */
  headline: string
  /** What to do next; empty when nothing is needed. */
  detail: string
  tone: DeliveryTone
  /** The action to offer first. */
  primary: DeliveryAction | null
}

const stepLabel = (s: DeliveryStep, t: Translate): string => t(`editor.step.${s}`)

const STOP_KEYS: Record<Exclude<DeliveryStopReason, 'noTarget'>, string> = {
  targetExpired: 'editor.stop.targetExpired',
  targetChanged: 'editor.stop.targetChanged',
  focusLost: 'editor.stop.focusLost',
  notEditable: 'editor.stop.notEditable',
  passwordField: 'editor.stop.passwordField',
  uiaUnavailable: 'editor.stop.uiaUnavailable',
  error: 'editor.stop.error'
}

export interface DeliveryContext {
  /** The user chose "클립보드에만 복사" for this send. */
  clipboardOnly?: boolean
  /** The target is an MCP agent: a fetch may follow the paste. */
  mcp?: boolean
  /** Error text for reason 'error'. */
  error?: string
}

export function deliveryView(s: DeliveryStatus, ctx: DeliveryContext, t: Translate): DeliveryView {
  const reached = new Set(s.reached)
  const steps: DeliveryView['steps'] = STEP_ORDER.filter((st) => reached.has(st)).map((st) => ({ step: st, label: stepLabel(st, t), state: 'done' }))
  const onClipboard = reached.has('clipboard')
  const stop = s.stoppedAt
  if (stop) {
    if (!reached.has(stop.step)) steps.push({ step: stop.step, label: stepLabel(stop.step, t), state: 'stopped' })
    if (stop.reason === 'noTarget') {
      if (ctx.clipboardOnly && onClipboard) {
        return { steps, headline: t('editor.delivery.clipboardChosen'), detail: t('editor.delivery.clipboardChosenDetail'), tone: 'ok', primary: null }
      }
      return onClipboard
        ? { steps, headline: t('editor.delivery.noTarget'), detail: t('editor.delivery.noTargetDetail'), tone: 'warn', primary: 'retarget' }
        : { steps, headline: t('editor.delivery.failed'), detail: t('editor.stop.pickAgain'), tone: 'error', primary: 'retarget' }
    }
    const headline = stop.reason === 'error' && ctx.error ? t('editor.stop.errorWith', { error: ctx.error }) : t(STOP_KEYS[stop.reason])
    if (stop.reason === 'targetExpired') return { steps, headline, detail: t('editor.stop.pickAgain'), tone: 'error', primary: 'retarget' }
    return {
      steps, headline,
      detail: onClipboard ? t('editor.stop.pasteByHand') : t('editor.stop.tryAgain'),
      tone: stop.reason === 'error' ? 'error' : 'warn',
      primary: onClipboard ? 'copy' : 'resend'
    }
  }
  if (reached.has('fetched')) {
    const by = s.fetchedBy
    if (by && !by.expected) return { steps, headline: t('editor.delivery.fetchedOther', { name: by.name }), detail: '', tone: 'warn', primary: null }
    return { steps, headline: by?.name ? t('editor.delivery.fetchedBy', { name: by.name }) : t('editor.delivery.fetched'), detail: '', tone: 'ok', primary: null }
  }
  if (s.fetchTimedOut) {
    return { steps, headline: t('editor.delivery.notFetched'), detail: t('editor.delivery.notFetchedDetail'), tone: 'warn', primary: 'resend' }
  }
  if (reached.has('pasted')) {
    const mcp = ctx.mcp === true || s.target?.method === 'mcp' || s.target?.source === 'mcp-verified'
    return { steps, headline: t('editor.delivery.pasted'), detail: mcp ? t('editor.delivery.waitFetch') : '', tone: mcp ? 'wait' : 'ok', primary: null }
  }
  if (onClipboard) return { steps, headline: t('editor.delivery.clipboardChosen'), detail: t('editor.delivery.clipboardChosenDetail'), tone: 'ok', primary: null }
  if (reached.has('saved')) return { steps, headline: t('editor.delivery.saved'), detail: '', tone: 'ok', primary: null }
  return { steps, headline: t('editor.delivery.failed'), detail: t('editor.stop.tryAgain'), tone: 'error', primary: 'resend' }
}

/**
 * main's DeliveryStatus, or one read off a legacy SendResult (main before phase 2). The legacy path claims
 * only what it checked: the package was written, the clipboard was filled, and for a paste the window it
 * focused was the target (send.ts compares the foreground hwnd). It never claims the input field.
 */
export function statusOf(r: SendResult, ctx: { clipboardOnly: boolean; target: SendTargetView | null }): DeliveryStatus {
  if (r.status) return r.status
  const sendId = r.sessionDir ? r.sessionDir.split(/[\\/]/).filter(Boolean).pop() ?? r.sessionDir : ''
  const base: DeliveryStatus = { sendId, ...(r.sessionDir ? { sessionDir: r.sessionDir } : {}), ...(ctx.target ? { target: ctx.target } : {}), reached: [] }
  if (r.targetExpired) return { ...base, reached: [], stoppedAt: { step: 'targetVerified', reason: 'targetExpired' } }
  const reached: DeliveryStep[] = r.sessionDir ? ['saved'] : []
  if (r.ok && r.delivered === 'pasted') return { ...base, reached: [...reached, 'clipboard', 'targetVerified', 'pasted'] }
  if (r.ok && r.delivered === 'clipboard') {
    const none = ctx.clipboardOnly || !ctx.target || ctx.target.source === 'none' || ctx.target.method === 'clipboard'
    return { ...base, reached: [...reached, 'clipboard'], stoppedAt: { step: 'targetVerified', reason: none ? 'noTarget' : 'targetChanged' } }
  }
  const next = STEP_ORDER.find((st) => !reached.includes(st)) ?? 'saved'
  return { ...base, reached, stoppedAt: { step: next, reason: 'error' } }
}

/** A later delivery:update for the current send replaces it; news about another send is ignored (null). */
export function mergeUpdate(cur: DeliveryStatus | null, upd: DeliveryStatus): DeliveryStatus | null {
  if (!cur || !upd.sendId || upd.sendId !== cur.sendId) return null
  const reached = STEP_ORDER.filter((st) => cur.reached.includes(st) || upd.reached.includes(st))
  return { ...cur, ...upd, reached }
}
