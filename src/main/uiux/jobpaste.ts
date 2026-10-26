// Puts a job's request text into the editor's current send target, text only (no package, no image) and never
// Enter. It runs the same staged checks as a send (src/main/pasteflow.ts): the target is the same window instance,
// it comes to the front, UI Automation says the focused element is an editable non-password field of that
// process (or a terminal), and Ctrl+V goes out only if the same element still has the focus. Anything less stops
// with the text on the clipboard and says so; "pasted" always means an attempt, as in a send.
import { clipboard, ClipboardItem, type BrowserWindow } from 'electron'
import { t } from '../../shared/i18n'
import type { DeliveryStopReason } from '../../shared/types'
import { logDelivery } from '../diaglog'
import { win32Available } from '../native/win32'
import { uiaClear } from '../native/uia'
import { runExclusive, verifyAndPaste } from '../pasteflow'
import type { Resolved } from '../targets'

export interface PasteOutcome {
  /** Ctrl+V was sent into a verified field (an attempt, not proof that the text arrived). */
  pasted: boolean
  message: string
  reason?: DeliveryStopReason
}

async function clipboardText(text: string): Promise<void> {
  await clipboard.write([new ClipboardItem({ 'text/plain': text })])
}

/** One at a time with sends (src/main/pasteflow.ts): two deliveries must not fight over the focus. */
/** editorWin: brought back to the front when the checks stop after the target was raised (as a send does). */
export function pasteTextToTarget(ctx: Resolved | null, text: string, editorWin: BrowserWindow | null = null): Promise<PasteOutcome> {
  return runExclusive(() => paste(ctx, text, editorWin))
}

async function paste(ctx: Resolved | null, text: string, editorWin: BrowserWindow | null): Promise<PasteOutcome> {
  const target = ctx?.target ?? null
  const identity = ctx?.identity ?? null
  const label = target?.label ?? ''
  const log = (event: string, detail?: string): void =>
    void logDelivery({ sendId: '', source: ctx?.view.source ?? 'none', kind: target?.kind, process: target?.process, method: target?.method, event: `job:${event}`, reached: [], ...(detail ? { detail } : {}) })
  let movedFocus = false
  const stop = (reason: DeliveryStopReason): PasteOutcome => {
    uiaClear()
    // The message is shown in the editor: it must not stay behind the window that was raised.
    if (movedFocus && editorWin && !editorWin.isDestroyed()) {
      editorWin.show()
      editorWin.focus()
    }
    log('stopped', reason)
    return { pasted: false, reason, message: t(`send.stopped.${reason}`, { target: label || '?' }) }
  }
  try {
    await clipboardText(text)
    if (!win32Available()) return stop('pasteUnsupported')
    if (!target || !identity || target.method === 'clipboard' || !target.hwnd) {
      if (target?.hwnd && target.method !== 'clipboard' && !identity) return stop('targetExpired')
      return { pasted: false, reason: 'noTarget', message: t('send.clipboard.noTarget') }
    }
    const flow = await verifyAndPaste(target, identity, { onFocus: () => { movedFocus = true } })
    if (flow !== 'pasted') return stop(flow.reason)
    uiaClear() // no Enter: the user reads the line and submits it
    log('pasted')
    return { pasted: true, message: t('send.pastedPressEnter', { target: label }) }
  } catch {
    return stop('error')
  }
}
