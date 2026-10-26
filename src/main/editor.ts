import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, screen } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { IPC } from '../shared/ipc'
import { t } from '../shared/i18n'
import type {
  CopyResult,
  DeliveryStatus,
  EditorInit,
  ExportPayload,
  SaveResult,
  SendOptions,
  SendResult,
  SendTargetView,
  TargetIdentity,
  TranscribeRequest,
  VideoSave
} from '../shared/types'
import { pinParts } from './agents'
import { buildBrief } from './brief'
import { saveSettings, sessionsRoot } from './config'
import { briefTranslator, mergedMessages, uiLocale } from './locales'
import { listTargets } from './destination'
import { watchFetch } from './fetchwatch'
import { liveWindow, processStartMs, win32Available } from './native/win32'
import { sendToTarget } from './send'
import { chooseForSend, toView, type EditorTargets } from './targets'
import { setPicked } from './tracker'
import { transcribe } from './stt'
import { appIcon, baseWebPreferences, loadPage, watchRendererErrors } from './windows'

let ipcInstalled = false
/**
 * Per editor window (several can be open): its current target and the windows its menu offered. A send may
 * only go to one of these, and only while it is the same window instance.
 */
const editorTargets = new WeakMap<Electron.WebContents, EditorTargets>()
/** Starts a region capture (set by index.ts, which owns the capture flow). */
let newCaptureHandler: (() => void) | null = null

export function onNewCaptureRequest(fn: () => void): void {
  newCaptureHandler = fn
}

/** Stops the fetch watcher of each editor's last send (a resend replaces it). */
const fetchWatchers = new WeakMap<Electron.WebContents, () => void>()
/** The window title seen when an editor's last send stopped with targetChanged (only for its next send). */
const pendingConfirms = new WeakMap<Electron.WebContents, { hwnd: number; pid: number; title: string }>()

/** The editor's target state from an EditorInit alone (self-test, older callers): identities read now. */
function stateFromInit(init: EditorInit): EditorTargets {
  const identityOf = (t: NonNullable<EditorInit['target']>): TargetIdentity | null => {
    const now = t.hwnd ? liveWindow(t.hwnd) : null
    return now ? { hwnd: t.hwnd, pid: now.pid, processStartMs: now.processStartMs, title: t.title, process: t.process } : null
  }
  const t = init.target
  const identity = t ? identityOf(t) : null
  const source = init.sendTarget?.source ?? (init.targetPinned ? 'pinned' : 'foreground-agent')
  const candidates: EditorTargets['candidates'] = new Map(
    (init.candidates ?? []).flatMap((c) => {
      const id = identityOf(c)
      return id ? [[c.hwnd, { target: c, identity: id }] as const] : []
    })
  )
  return { current: { target: t, identity, view: init.sendTarget ?? toView(t, t ? source : 'none', identity) }, candidates }
}

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
      title: t('dialog.saveCapture'),
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
      // Save keeps its meaning (the PNG, plus the plain note): UI/UX guidance goes with the session package, and its
      // design-request.json / design-preview.png would not exist next to this file.
      await writeFile(md, buildBrief({ ...payload, uiux: undefined }, basename(file), null, { t: briefTranslator() }), 'utf8')
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
      title: t('dialog.saveVideo'),
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
  ipcMain.handle(IPC.editorTargets, async (e): Promise<SendTargetView[]> => {
    const state = editorTargets.get(e.sender)
    if (!state) return []
    const { views, candidates } = await listTargets(state)
    // The menu's fresh windows become what a send may pick from (each with the identity seen now).
    editorTargets.set(e.sender, { current: state.current, candidates })
    return views
  })
  ipcMain.handle(IPC.editorSend, async (e, payload: ExportPayload, opts: SendOptions = {}): Promise<SendResult> => {
    const state = editorTargets.get(e.sender) ?? { current: { target: null, identity: null, view: toView(null, 'none', null) }, candidates: new Map() }
    const choice = chooseForSend(state, opts, liveWindow)
    if (choice.kind === 'expired') {
      // Nothing is written or sent: another window would be a destination the user did not choose.
      const status: DeliveryStatus = { sendId: '', reached: [], stoppedAt: { step: 'targetVerified', reason: 'targetExpired' } }
      return { ok: false, delivered: 'file-only', targetExpired: true, message: t('send.targetExpired', { target: choice.label || '?' }), status }
    }
    const ctx = choice.kind === 'target' ? choice.ctx : state.current
    if (choice.kind === 'target' && choice.picked && ctx.target && ctx.identity) {
      // A pick sticks: this editor's resends and the next captures go there while that window lives.
      editorTargets.set(e.sender, { current: ctx, candidates: state.candidates })
      setPicked(ctx.target, ctx.identity)
    }
    if (opts.pinTarget === true && ctx.target?.hwnd && ctx.target.process) {
      const p = pinParts(ctx.target)
      saveSettings({ pinnedTargetProcess: p.process, pinnedTargetTitle: p.title }).catch(() => undefined) // reported by the tray
    } else if (opts.pinTarget === false) {
      saveSettings({ pinnedTargetProcess: '', pinnedTargetTitle: '' }).catch(() => undefined)
    }
    // "Ask once" (plan §3 phase 2): after a targetChanged stop, the next send to that same window is the user's
    // answer — for exactly the title it showed at the stop. A further change stops again.
    const pending = pendingConfirms.get(e.sender)
    pendingConfirms.delete(e.sender)
    const clipboardOnly = choice.kind === 'clipboard' || opts.clipboardOnly
    const acceptTitle = !clipboardOnly && pending && ctx.identity && pending.hwnd === ctx.identity.hwnd && pending.pid === ctx.identity.pid ? pending.title : undefined
    const result = await sendToTarget(BrowserWindow.fromWebContents(e.sender), payload, ctx, { ...opts, clipboardOnly }, { acceptTitle })
    const status = result.status
    if (status?.stoppedAt?.reason === 'targetChanged' && ctx.identity) {
      const seen = liveWindow(ctx.identity.hwnd)
      if (seen) pendingConfirms.set(e.sender, { hwnd: ctx.identity.hwnd, pid: seen.pid, title: seen.title })
    }
    if (status?.sendId && status.reached.includes('saved')) {
      fetchWatchers.get(e.sender)?.()
      const sender = e.sender
      const recipientId = choice.kind === 'target' ? ctx.target?.mcp?.id : undefined
      fetchWatchers.set(
        sender,
        watchFetch({
          root: sessionsRoot(),
          sendId: status.sendId,
          recipientId,
          onUpdate: (patch) => {
            if (sender.isDestroyed()) return
            if (patch.fetched && !status.reached.includes('fetched')) status.reached.push('fetched')
            if (patch.fetchedBy) status.fetchedBy = patch.fetchedBy
            if (patch.fetchTimedOut) status.fetchTimedOut = true
            sender.send(IPC.deliveryUpdate, { ...status, reached: [...status.reached] })
          }
        })
      )
    }
    return result
  })
  ipcMain.handle(IPC.editorPin, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return false
    const pinned = !win.isAlwaysOnTop()
    if (pinned) {
      const [w, h] = win.getSize()
      const scale = 480 / w
      win.setAlwaysOnTop(true, 'floating')
      win.setSize(480, Math.max(300, Math.round(h * scale)))
      const wa = screen.getDisplayMatching(win.getBounds()).workArea
      win.setPosition(wa.x + wa.width - 480 - 16, wa.y + 16)
    } else {
      win.setAlwaysOnTop(false)
    }
    return pinned
  })
  ipcMain.handle(IPC.editorTranscribe, (e, req: TranscribeRequest) =>
    transcribe(req, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.editorSttProgress, p)
    })
  )
  ipcMain.handle(IPC.editorCopy, (_e, payload: ExportPayload) => copyToClipboard(payload))
  ipcMain.on(IPC.editorClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.on(IPC.editorNewCapture, (e) => {
    // The user is done with this capture: close it first so the new screenshot does not show the editor.
    BrowserWindow.fromWebContents(e.sender)?.close()
    setTimeout(() => newCaptureHandler?.(), 250)
  })
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Open the annotation editor for a cropped capture. */
export function createEditorWindow(init: EditorInit, errors?: string[], targetState?: EditorTargets): BrowserWindow {
  installEditorIpc()
  const display =
    screen.getAllDisplays().find((d) => d.id === init.meta.displayId) ?? screen.getPrimaryDisplay()
  const wa = display.workArea
  const dipW = init.width / init.meta.scaleFactor
  const dipH = init.height / init.meta.scaleFactor
  // Wide enough for the whole toolbar; tall enough for the image plus the timeline panel.
  const width = Math.round(clamp(dipW + 48, 840, wa.width * 0.92))
  const height = Math.round(clamp(dipH + 40 + 36 + 56 + 110, 520, wa.height * 0.92))

  const win = new BrowserWindow({
    icon: appIcon(),
    width,
    height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    minWidth: 820,
    minHeight: 420,
    title: 'Backseat',
    backgroundColor: '#1b1b1f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: baseWebPreferences()
  })
  win.setMenu(null)
  const state = targetState ?? stateFromInit(init)
  editorTargets.set(win.webContents, state)
  const wc = win.webContents
  win.on('closed', () => fetchWatchers.get(wc)?.())
  if (errors) watchRendererErrors(win.webContents, errors, 'editor')
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return
    // The UI language is read at send time: a language change applies from the next capture on.
    win.webContents.send(IPC.editorInit, { ...init, sendTarget: state.current.view, platform: process.platform, canTarget: win32Available(), locale: uiLocale(), messages: mergedMessages() })
    win.show()
    win.focus()
  })
  void loadPage(win, 'editor')
  return win
}

export function briefDirName(file: string): string {
  return dirname(file)
}
