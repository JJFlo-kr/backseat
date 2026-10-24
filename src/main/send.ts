// "전송": write the session package, then deliver it to the agent the user was
// working with. Delivery never presses Enter unless asked, and always falls back
// to the clipboard with an honest message.
import { BrowserWindow, clipboard, ClipboardItem } from 'electron'
import { readFile } from 'fs/promises'
import type { AgentTarget, ExportPayload, SendOptions, SendResult } from '../shared/types'
import { instructionLine } from './agents'
import { loadSettings } from './config'
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
    const line = instructionLine(pkg.briefMd, pkg.annotatedPng, payload.memo, Boolean(target?.mcp))
    // Chat UIs get the image itself: say up front that the drawn marks are the user's Backseat annotations.
    const imageLine = `[Backseat 주석 포함] ${line}`

    if (!target || target.method === 'clipboard' || !target.hwnd || !win32Available()) {
      await clipboardImageAndText(pkg.annotatedPng, imageLine)
      const viaMcp = target?.mcp ? ' · 에이전트는 backseat_latest/backseat_wait로 받을 수 있음' : ''
      return {
        ok: true,
        delivered: 'clipboard',
        sessionDir,
        message: target ? `${target.label}: 클립보드에 복사됨 (Ctrl+V)${viaMcp}` : '대상 없음 · 클립보드에 복사됨 (Ctrl+V)'
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
        message: `${target.label} 창을 앞으로 가져오지 못해 클립보드에만 복사됨 (Ctrl+V)`
      }
    }
    await sleep(80)
    sendCtrlV()
    const pressEnter = opts.pressEnter ?? loadSettings().pressEnter
    if (pressEnter) {
      await sleep(150)
      sendEnter()
    }
    return {
      ok: true,
      delivered: 'pasted',
      sessionDir,
      message: `${target.label} 에 붙여넣음${pressEnter ? '' : ' · Enter를 눌러 보내세요'}`
    }
  } catch (err) {
    editorWin?.show()
    const error = err instanceof Error ? err.message : String(err)
    return { ok: false, delivered: 'file-only', sessionDir, message: `전송 실패: ${error}`, error }
  }
}
