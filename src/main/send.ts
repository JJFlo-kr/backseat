// "전송": write the session package, then deliver it to the agent the user was
// working with. Delivery never presses Enter unless asked, and always falls back
// to the clipboard with an honest message.
import { BrowserWindow, clipboard, ClipboardItem } from 'electron'
import { readFile } from 'fs/promises'
import type { AgentTarget, ExportPayload, SendOptions, SendResult } from '../shared/types'
import { t } from '../shared/i18n'
import { instructionLine } from './agents'
import { loadSettings } from './config'
import { briefTranslator } from './locales'
import { focusWindow, getForegroundWindow, sendCtrlV, sendEnter, win32Available } from './native/win32'
import { markAnswered } from './requests'
import { sessionsRoot, writeSessionPackage } from './sessions'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function clipboardText(text: string): Promise<void> {
  await clipboard.write([new ClipboardItem({ 'text/plain': text })])
}

async function clipboardImageAndText(pngPath: string, text: string): Promise<void> {
  const png = new Uint8Array(await readFile(pngPath))
  await clipboard.write([
    new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }), 'text/plain': text })
  ])
}

export async function sendToTarget(
  editorWin: BrowserWindow | null,
  payload: ExportPayload,
  target: AgentTarget | null,
  opts: SendOptions = {}
): Promise<SendResult> {
  let sessionDir: string | undefined
  try {
    const pkg = await writeSessionPackage(payload, target)
    sessionDir = pkg.dir
    if (payload.meta.request) await markAnswered(sessionsRoot(), payload.meta.request.requestId)
    // The line and the image prefix are read by the agent: brief language. Status messages below: UI language.
    const line = instructionLine(pkg.briefMd, pkg.annotatedPng, payload.memo, Boolean(target?.mcp), briefTranslator())
    // Chat UIs get the image itself: say up front that the drawn marks are the user's Backseat annotations.
    const imageLine = `${briefTranslator()('send.imageNotice')} ${line}`

    if (!target || target.method === 'clipboard' || !target.hwnd || !win32Available()) {
      await clipboardImageAndText(pkg.annotatedPng, imageLine)
      return {
        ok: true,
        delivered: 'clipboard',
        sessionDir,
        message: opts.clipboardOnly
          ? t('send.clipboard.chosen')
          : target
            ? t(target.mcp ? 'send.clipboard.targetMcp' : 'send.clipboard.target', { target: target.label })
            : t('send.clipboard.noTarget')
      }
    }

    if (target.method === 'paste-path') await clipboardText(line)
    else await clipboardImageAndText(pkg.annotatedPng, imageLine)

    // Get out of the way, then hand focus to the agent window and paste.
    editorWin?.hide()
    await sleep(120)
    const focused = await focusWindow(target.hwnd)
    const fg = getForegroundWindow()
    if (!focused || !fg || fg.hwnd !== target.hwnd) {
      editorWin?.show()
      return {
        ok: true,
        delivered: 'clipboard',
        sessionDir,
        message: t('send.focusFailed', { target: target.label })
      }
    }
    await sleep(80)
    sendCtrlV()
    const pressEnter = opts.pressEnter ?? loadSettings().pressEnter
    if (pressEnter) {
      await sleep(150)
      sendEnter()
    }
    // The editor comes back after the paste without taking the focus from the agent window: it stays open
    // for a resend, another destination or a copy (Codex review F05; user decision 2026-10-25).
    editorWin?.showInactive()
    return {
      ok: true,
      delivered: 'pasted',
      sessionDir,
      message: t(pressEnter ? 'send.pasted' : 'send.pastedPressEnter', { target: target.label })
    }
  } catch (err) {
    editorWin?.show()
    const error = err instanceof Error ? err.message : String(err)
    return { ok: false, delivered: 'file-only', sessionDir, message: t('send.failed', { error }), error }
  }
}
