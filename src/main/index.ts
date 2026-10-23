import { app, globalShortcut, session } from 'electron'
import type { AgentTarget, AskRequest, CaptureMode, EditorInit } from '../shared/types'
import { classifyTarget } from './agents'
import { captureAllDisplays, captureForDisplayId, cropDip } from './capture'
import { ensureConfig, loadSettings } from './config'
import { createEditorWindow, installEditorIpc } from './editor'
import { pruneRegistry } from './mcp/registry'
import { getForegroundWindow, listTopLevelWindows } from './native/win32'
import { startRequestWatcher, takePendingRequest } from './requests'
import { cancelSelector, runSelector, selectorActive } from './selector'
import { runSelfTest } from './selftest'
import { sessionsRoot } from './sessions'
import { createTray } from './tray'

let capturing = false

/** Merge the window-based guess with agents registered through backseat-mcp. */
async function pickTarget(active: ReturnType<typeof getForegroundWindow>): Promise<AgentTarget | null> {
  const guess = classifyTarget(active)
  let registered: Awaited<ReturnType<typeof pruneRegistry>> = []
  try {
    registered = await pruneRegistry(sessionsRoot())
  } catch {
    registered = []
  }
  if (registered.length === 0) return guess
  const agent = registered[registered.length - 1]
  const mcp = { id: agent.id, name: agent.name, cwd: agent.cwd }
  if (guess && guess.method !== 'clipboard') {
    // Terminal/editor in front AND an MCP agent listening: paste a short MCP instruction there.
    return { ...guess, mcp, label: `${guess.label} · MCP ${agent.name}`, confidence: Math.max(guess.confidence, 0.9) }
  }
  return {
    kind: 'claude-code',
    label: `${agent.name} (MCP) · ${agent.cwd}`,
    hwnd: 0,
    title: '',
    process: '',
    method: 'clipboard',
    confidence: 0.6,
    mcp
  }
}

/** Full flow: remember the active window -> freeze screens -> pick a region/window -> open the editor. */
export async function startCapture(mode: CaptureMode = 'rect', request?: AskRequest): Promise<void> {
  if (capturing) {
    // Hotkey pressed again while the selector is up: treat as cancel.
    if (selectorActive()) cancelSelector()
    return
  }
  capturing = true
  try {
    const settings = loadSettings()
    const active = getForegroundWindow() // before any of our windows show up
    const target = await pickTarget(active)
    const ask = request ?? takePendingRequest() ?? undefined
    const caps = await captureAllDisplays()
    const windows = listTopLevelWindows()
    const sel = await runSelector(caps, windows, mode)
    if (!sel) return
    const cap = captureForDisplayId(caps, sel.displayId)
    if (!cap) return
    const { image, rectPx } = cropDip(cap, sel.rect)
    const init: EditorInit = {
      imageDataUrl: `data:image/png;base64,${image.toPNG().toString('base64')}`,
      width: rectPx.width,
      height: rectPx.height,
      meta: {
        capturedAt: new Date().toISOString(),
        displayId: cap.display.id,
        scaleFactor: cap.display.scaleFactor,
        rectDip: sel.rect,
        rectPx,
        mode: sel.mode,
        window: sel.window ? { title: sel.window.title, process: sel.window.process } : undefined,
        activeWindow: active ? { title: active.title, process: active.process } : undefined,
        request: ask ? { requestId: ask.requestId, question: ask.question, agent: ask.agent } : undefined
      },
      target,
      autoRecord: settings.autoRecord,
      request: ask
    }
    createEditorWindow(init)
  } catch (err) {
    console.error('[backseat] capture failed:', err)
  } finally {
    capturing = false
  }
}

app.setAppUserModelId('com.backseat.app')

const isSelfTest = process.argv.includes('--selftest')

// The self-test must run even while the tray app is up, so it skips the single-instance lock.
if (!isSelfTest && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--capture')) void startCapture()
  })

  app.whenReady().then(async () => {
    // Our own renderers only: allow microphone and clipboard without a prompt.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(['media', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission))
    })
    session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
      ['media', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission)
    )
    installEditorIpc()
    if (process.argv.includes('--selftest')) {
      await runSelfTest()
      return
    }
    const settings = await ensureConfig()
    createTray(() => void startCapture())
    for (const [accel, mode] of [
      [settings.hotkeyRect, 'rect'],
      [settings.hotkeyWindow, 'window']
    ] as const) {
      if (!globalShortcut.register(accel, () => void startCapture(mode))) {
        console.error(`[backseat] could not register hotkey ${accel}`)
      }
    }
    void startRequestWatcher(settings.sessionsRoot, (r) => void startCapture('rect', r))
    if (process.argv.includes('--capture')) void startCapture()
  })
}

// Tray app: keep running when every window is closed.
app.on('window-all-closed', () => {
  /* noop */
})
app.on('will-quit', () => globalShortcut.unregisterAll())
