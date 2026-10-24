// "보내기": write the session package, then deliver it — step by step, recording only what was confirmed
// (plan 2026-10-25 §3 phase 2–3, request (1) items 2–4):
//   saved → clipboard → targetVerified (same window instance, in front) → inputVerified (UIA: an editable,
//   non-password field of that process, or a terminal) → pasted (Ctrl+V after one more check).
// Any doubt stops before Ctrl+V with the reason in DeliveryStatus.stoppedAt; the clipboard stays ready and
// the editor (never hidden, only put behind the target) comes back. Another window is never substituted,
// and Enter is pressed only after a fully verified paste into a known AI tool. Deliveries run one at a time.
import { BrowserWindow, clipboard, ClipboardItem } from 'electron'
import { readFile } from 'fs/promises'
import type { DeliveryStopReason, ExportPayload, SendOptions, SendResult } from '../shared/types'
import { t } from '../shared/i18n'
import { classifyTarget, instructionLine, isPlainCapture, plainPathLine } from './agents'
import { loadSettings } from './config'
import { compareIdentity, DeliveryTracker, elementForLog, isChromiumRootPane, judgeInput, mayFocusSoleInput, mayPressEnter, type DeliveryLogEntry } from './delivery'
import { logDelivery } from './diaglog'
import { briefTranslator } from './locales'
import { describeWindow, focusWindow, foregroundHwnd, liveWindow, processNameOf, win32Available } from './native/win32'
import { uiaClear, uiaEnterIfUnchanged, uiaFocusSoleInput, uiaInputCheck, uiaPasteIfUnchanged, type FocusInfo } from './native/uia'
import { markAnswered } from './requests'
import { sessionsRoot, writeSessionPackage } from './sessions'
import type { Resolved } from './targets'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const CONSOLE_HOSTS = new Set(['conhost.exe', 'openconsole.exe'])

async function clipboardText(text: string): Promise<void> {
  await clipboard.write([new ClipboardItem({ 'text/plain': text })])
}

/** Image on the clipboard, with a text line unless `text` is empty (a plain capture: the picture alone). */
async function clipboardImageAndText(pngPath: string, text: string): Promise<void> {
  const png = new Uint8Array(await readFile(pngPath))
  const item: Record<string, Blob | string> = { 'image/png': new Blob([png], { type: 'image/png' }) }
  if (text) item['text/plain'] = text
  await clipboard.write([new ClipboardItem(item)])
}

/** Status-bar text for a stop (UI language). The editor shows its own wording from DeliveryStatus. */
function stopMessage(reason: DeliveryStopReason, label: string): string {
  return t(`send.stopped.${reason}`, { target: label || '?' })
}

export interface SendExtras {
  /**
   * The user confirmed the target after a 'targetChanged' stop: this is the title it showed then (kept by
   * the editor IPC). The window must still show exactly that title; no auto Enter on such a send.
   */
  acceptTitle?: string
}

/** Two editors sending at once would fight over the focus: deliveries are queued. */
let queue: Promise<unknown> = Promise.resolve()

export function sendToTarget(
  editorWin: BrowserWindow | null,
  payload: ExportPayload,
  ctx: Resolved,
  opts: SendOptions = {},
  extras: SendExtras = {}
): Promise<SendResult> {
  const run = (): Promise<SendResult> => deliver(editorWin, payload, ctx, opts, extras)
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

async function deliver(
  editorWin: BrowserWindow | null,
  payload: ExportPayload,
  ctx: Resolved,
  opts: SendOptions,
  extras: SendExtras
): Promise<SendResult> {
  const target = opts.clipboardOnly ? null : ctx.target
  const identity = opts.clipboardOnly ? null : ctx.identity
  const tracker = new DeliveryTracker(opts.clipboardOnly ? { source: 'none', label: '', estimated: false, method: 'clipboard' } : ctx.view)
  const status = tracker.status
  const label = target?.label ?? ''
  const log = (event: string, extra: Partial<DeliveryLogEntry> = {}): void =>
    void logDelivery({
      sendId: status.sendId,
      source: status.target?.source ?? 'none',
      kind: target?.kind,
      process: target?.process,
      method: status.target?.method,
      event,
      reached: [...status.reached],
      ...(status.stoppedAt ? { stoppedAt: status.stoppedAt } : {}),
      ...extra
    })
  // After the target was brought forward, a stop brings the editor back so the user sees why.
  let movedFocus = false
  const noTargetMessage = (): string =>
    opts.clipboardOnly ? t('send.clipboard.chosen') : target ? t('send.clipboard.target', { target: label }) : t('send.clipboard.noTarget')
  const stopped = (step: Parameters<DeliveryTracker['stop']>[0], reason: DeliveryStopReason, extra: Partial<SendResult> = {}): SendResult => {
    tracker.stop(step, reason)
    uiaClear()
    if (movedFocus && editorWin && !editorWin.isDestroyed()) {
      editorWin.show()
      editorWin.focus()
    }
    log('stopped')
    return {
      ok: true,
      delivered: status.reached.includes('clipboard') ? 'clipboard' : 'file-only',
      sessionDir: status.sessionDir,
      message: reason === 'noTarget' ? noTargetMessage() : stopMessage(reason, label),
      status,
      ...extra
    }
  }
  const pastedResult = (): SendResult => ({
    ok: true,
    delivered: 'pasted',
    sessionDir: status.sessionDir,
    message: t(status.enterPressed ? 'send.pasted' : 'send.pastedPressEnter', { target: label }),
    status
  })

  try {
    const pkg = await writeSessionPackage(payload, target)
    status.sendId = pkg.id
    status.sessionDir = pkg.dir
    tracker.reach('saved')
    if (payload.meta.request) await markAnswered(sessionsRoot(), payload.meta.request.requestId)
    // The line and the image prefix are read by the agent: brief language. Status messages: UI language.
    // Nothing added to the capture: the picture alone (chat UIs) or its path alone (terminals), no instructions.
    const plain = isPlainCapture(payload)
    const line = plain
      ? plainPathLine(pkg.annotatedPng)
      : instructionLine(pkg.briefMd, pkg.annotatedPng, payload.memo, target?.mcp ? pkg.id : undefined, briefTranslator())
    // Chat UIs get the image itself: say up front that the drawn marks are the user's Backseat annotations.
    const imageLine = plain ? '' : `${briefTranslator()('send.imageNotice')} ${line}`

    if (!target || !identity || target.method === 'clipboard' || !target.hwnd) {
      await clipboardImageAndText(pkg.annotatedPng, imageLine)
      tracker.reach('clipboard')
      // A window that was already gone when its identity was read is a closed target, not "no target".
      if (target?.hwnd && target.method !== 'clipboard' && !identity) return stopped('targetVerified', 'targetExpired', { targetExpired: true })
      return stopped('targetVerified', 'noTarget')
    }
    if (target.method === 'paste-path') await clipboardText(line)
    else await clipboardImageAndText(pkg.annotatedPng, imageLine)
    tracker.reach('clipboard')
    if (!win32Available()) return stopped('targetVerified', 'uiaUnavailable')

    // 1. Same window instance as chosen (a closed window or a reused handle is never "close enough"). A title
    // the user confirmed after a stop replaces the remembered one — and must still be exactly that.
    const expected = extras.acceptTitle !== undefined ? { ...identity, title: extras.acceptTitle } : identity
    const before = compareIdentity(expected, liveWindow(target.hwnd), target.kind)
    if (before === 'expired') return stopped('targetVerified', 'targetExpired', { targetExpired: true })
    if (before === 'titleChanged') return stopped('targetVerified', 'targetChanged')

    // 2. Bring it forward. The editor is not hidden (the user keeps their work in view); the target simply goes on top.
    movedFocus = true
    const focused = await focusWindow(target.hwnd)
    if (!focused || foregroundHwnd() !== target.hwnd) return stopped('targetVerified', 'focusLost')
    // What is in front now: for a browser the visible tab's title.
    const after = compareIdentity(expected, liveWindow(target.hwnd), target.kind)
    if (after === 'expired') return stopped('targetVerified', 'targetExpired', { targetExpired: true })
    if (after === 'titleChanged') return stopped('targetVerified', 'targetChanged')
    tracker.reach('targetVerified')

    // 3. The focused element must be a field we may paste into — never a password field.
    let focus: FocusInfo | null
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
      focus = await check()
      let verdict = judge(focus)
      if (!verdict.ok && verdict.reason === 'notEditable' && mayFocusSoleInput(target.kind)) {
        const sole = await uiaFocusSoleInput(target.hwnd)
        log('soleInput', { detail: `candidates=${sole.candidates} passwordFields=${sole.passwordFields} focused=${sole.focused}` })
        if (sole.focused) {
          await sleep(120)
          focus = await check()
          verdict = judge(focus)
        }
      }
      log('inputCheck', { element: elementForLog(focus, identity.pid), detail: verdict.ok ? `ok:${verdict.via}` : verdict.reason })
      if (!verdict.ok) return stopped('inputVerified', verdict.reason)
    } catch (err) {
      log('inputCheck', { detail: `uia:${err instanceof Error ? err.message.slice(0, 80) : 'error'}` })
      return stopped('inputVerified', 'uiaUnavailable')
    }
    tracker.reach('inputVerified')

    // 4. Ctrl+V only if the same window is in front and the same element still has the focus.
    let pasted
    try {
      pasted = await uiaPasteIfUnchanged(target.hwnd)
    } catch {
      return stopped('pasted', 'uiaUnavailable')
    }
    if (!pasted.pasted) {
      const reason: DeliveryStopReason =
        pasted.reason === 'password' ? 'passwordField' : pasted.reason === 'none' ? 'error' : pasted.reason === 'timeout' ? 'uiaUnavailable' : 'focusLost'
      return stopped('pasted', reason)
    }
    tracker.reach('pasted')

    // 5. Enter only after a fully verified paste into a known AI tool that still looks like one (a terminal
    // tab that turned into a plain shell would run the line as a command), never after a confirmed title
    // change, and under the same element checks as the paste.
    const now = describeWindow(target.hwnd)
    const sameKindNow = now ? classifyTarget(now, { selfPid: process.pid })?.kind === target.kind : false
    const wantEnter = opts.pressEnter ?? loadSettings().pressEnter
    if (mayPressEnter(status, wantEnter, { kind: target.kind, sameKindNow, confirmed: extras.acceptTitle !== undefined })) {
      await sleep(150)
      const enter = await uiaEnterIfUnchanged(target.hwnd).catch(() => null)
      if (enter?.pasted) status.enterPressed = true
      else log('enterSkipped', { detail: enter && !enter.pasted ? enter.reason : 'uia' })
    } else {
      uiaClear()
    }
    log('pasted')
    return pastedResult()
  } catch (err) {
    // Something failed after Ctrl+V went out: the paste still happened, say so.
    if (status.reached.includes('pasted')) {
      log('afterPasteError')
      return pastedResult()
    }
    const error = err instanceof Error ? err.message : String(err)
    const next = (['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'] as const).find((s) => !status.reached.includes(s)) ?? 'pasted'
    const r = stopped(next, 'error')
    return { ...r, ok: false, delivered: status.reached.includes('saved') ? r.delivered : 'file-only', message: t('send.failed', { error }), error }
  }
}
