import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, screen } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { IPC } from '../shared/ipc'
import type { CopyResult, EditorInit, ExportPayload, SaveResult, VideoSave } from '../shared/types'
import { buildBrief } from './brief'
import { baseWebPreferences, loadPage, watchRendererErrors } from './windows'

let ipcInstalled = false

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function pngBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

export function defaultSaveDir(): string {
  return join(app.getPath('pictures'), 'Backseat')
}

async function handleSave(win: BrowserWindow | null, payload: ExportPayload): Promise<SaveResult> {
  try {
    const dir = defaultSaveDir()
    await mkdir(dir, { recursive: true })
    const defaultPath = join(dir, `backseat-${stamp()}.png`)
    const opts = {
      title: '캡처 저장',
      defaultPath,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    let file = r.filePath
    if (!file.toLowerCase().endsWith('.png')) file += '.png'
    await writeFile(file, pngBuffer(payload.pngDataUrl))
    if (payload.memo || payload.annotations.length > 0) {
      const md = file.replace(/\.png$/i, '.md')
      await writeFile(md, buildBrief(payload, basename(file)), 'utf8')
    }
    return { ok: true, path: file }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function copyToClipboard(payload: ExportPayload): Promise<CopyResult> {
  try {
    // Electron 45 clipboard is W3C-style: one ClipboardItem carrying several MIME types.
    const png = new Uint8Array(pngBuffer(payload.pngDataUrl))
    const parts: Record<string, string | Blob> = {
      'image/png': new Blob([png], { type: 'image/png' })
    }
    if (payload.memo) parts['text/plain'] = payload.memo
    await clipboard.write([new ClipboardItem(parts)])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleSaveVideo(win: BrowserWindow | null, video: VideoSave): Promise<SaveResult> {
  try {
    const dir = defaultSaveDir()
    await mkdir(dir, { recursive: true })
    const ext = video.mimeType.includes('mp4') ? 'mp4' : 'webm'
    const opts = {
      title: '녹화 저장',
      defaultPath: join(dir, `backseat-${stamp()}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    await writeFile(r.filePath, Buffer.from(video.bytes))
    return { ok: true, path: r.filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function installEditorIpc(): void {
  if (ipcInstalled) return
  ipcInstalled = true
  ipcMain.handle(IPC.editorSave, (e, payload: ExportPayload) =>
    handleSave(BrowserWindow.fromWebContents(e.sender), payload)
  )
  ipcMain.handle(IPC.editorSaveVideo, (e, video: VideoSave) =>
    handleSaveVideo(BrowserWindow.fromWebContents(e.sender), video)
  )
  ipcMain.handle(IPC.editorCopy, (_e, payload: ExportPayload) => copyToClipboard(payload))
  ipcMain.on(IPC.editorClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Open the annotation editor for a cropped capture. */
export function createEditorWindow(init: EditorInit, errors?: string[]): BrowserWindow {
  installEditorIpc()
  const display =
    screen.getAllDisplays().find((d) => d.id === init.meta.displayId) ?? screen.getPrimaryDisplay()
  const wa = display.workArea
  const dipW = init.width / init.meta.scaleFactor
  const dipH = init.height / init.meta.scaleFactor
  // Wide enough for the whole toolbar; tall enough for the image plus the timeline panel.
  const width = Math.round(clamp(dipW + 48, 780, wa.width * 0.92))
  const height = Math.round(clamp(dipH + 40 + 36 + 56 + 110, 520, wa.height * 0.92))

  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    minWidth: 760,
    minHeight: 420,
    title: 'Backseat',
    backgroundColor: '#1b1b1f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: baseWebPreferences()
  })
  win.setMenu(null)
  if (errors) watchRendererErrors(win.webContents, errors, 'editor')
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.send(IPC.editorInit, init)
    win.show()
    win.focus()
  })
  void loadPage(win, 'editor')
  return win
}

export function briefDirName(file: string): string {
  return dirname(file)
}
