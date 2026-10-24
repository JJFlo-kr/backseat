import { app, globalShortcut, session } from 'electron'
import type { AgentTarget, AskRequest, CaptureMode, EditorInit, SelectionResult } from '../shared/types'
import { classifyTarget } from './agents'
import { captureAllDisplays, captureForDisplayId, cropDip } from './capture'
import { applyLoginItem, ensureConfig, loadSettings } from './config'
import { createEditorWindow, installEditorIpc } from './editor'
import { pruneRegistry } from './mcp/registry'
import { getForegroundWindow, isWindow, listTopLevelWindows } from './native/win32'
import { startRequestWatcher, takePendingRequest } from './requests'
import { scrollCapture } from './scroll'
import { cancelSelector, runSelector, selectorActive } from './selector'
import { runSelfTest } from './selftest'
import { latestCompareSource, sessionsRoot } from './sessions'
import { createTray } from './tray'

let capturing = false
/** Last confirmed selection, for "마지막 영역 다시 캡처" (before/after comparisons). */
let lastSelection: SelectionResult | null = null
/** Last target that had a real window, reused when the hotkey is pressed from the desktop/tray. */
let lastTarget: AgentTarget | null = null

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

/**
 * Full flow: remember the active window -> freeze screens -> pick a region/window -> open the editor.
 * mode 'last' reuses the previous selection without showing the selector.
 */
export async function startCapture(mode: CaptureMode | 'last' = 'rect', request?: AskRequest): Promise<void> {
  if (capturing) {
    // Hotkey pressed again while the selector is up: treat as cancel.
    if (selectorActive()) cancelSelector()
    return
  }
  capturing = true
  try {
    const settings = loadSettings()
    const active = getForegroundWindow() // before any of our windows show up
    let target = await pickTarget(active)
    if (!target && lastTarget && isWindow(lastTarget.hwnd)) {
      target = { ...lastTarget, confidence: Math.min(lastTarget.confidence, 0.5), label: `${lastTarget.label} (직전 대상)` }
    }
    if (target && target.hwnd) lastTarget = target
    const ask = request ?? takePendingRequest() ?? undefined
    const caps = await captureAllDisplays()
    let sel: SelectionResult | null
    if (mode === 'last') {
      sel = lastSelection
      if (!sel) return
    } else {
      const windows = listTopLevelWindows()
      sel = await runSelector(caps, windows, mode)
    }
    if (!sel) return
    const cap = captureForDisplayId(caps, sel.displayId)
    if (!cap) return
    // A "last area" capture compares against the package of the previous send, when there is one.
    const compare = mode === 'last' ? (await latestCompareSource()) ?? undefined : undefined
    if (sel.mode !== 'scroll') lastSelection = sel
    let image: Electron.NativeImage
    let rectPx: EditorInit['meta']['rectPx']
    let rectDip = sel.rect
    let scroll: EditorInit['meta']['scroll']
    if (sel.mode === 'scroll' && sel.window) {
      // The selector overlays are gone (settled); wheel the real window and stitch.
      const r = await scrollCapture(cap.display, sel.window, sel.rect, { maxHeightPx: settings.scrollMaxHeightPx })
      if (r.stoppedBy === 'cancel') return
      image = r.image
      const { rectPx: top } = cropDip(cap, sel.rect)
      rectPx = { x: top.x, y: top.y, width: r.widthPx, height: r.heightPx }
      rectDip = { ...sel.rect, height: Math.round(r.heightPx / cap.display.scaleFactor) }
      scroll = { frames: r.frames, viewportPx: r.viewportPx }
    } else {
      const c = cropDip(cap, sel.rect)
      image = c.image
      rectPx = c.rectPx
    }
    const init: EditorInit = {
      imageDataUrl: `data:image/png;base64,${image.toPNG().toString('base64')}`,
      width: rectPx.width,
      height: rectPx.height,
      meta: {
        capturedAt: new Date().toISOString(),
        displayId: cap.display.id,
        scaleFactor: cap.display.scaleFactor,
        rectDip,
        rectPx,
        mode: sel.mode,
        window: sel.window ? { title: sel.window.title, process: sel.window.process } : undefined,
        activeWindow: active ? { title: active.title, process: active.process } : undefined,
        request: ask ? { requestId: ask.requestId, question: ask.question, agent: ask.agent } : undefined,
        scroll
      },
      target,
      autoRecord: settings.autoRecord,
      request: ask,
      compare
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
    applyLoginItem(settings)
    createTray({
      capture: () => void startCapture('rect'),
      captureWindow: () => void startCapture('window'),
      recaptureLast: () => void startCapture('last'),
      hasLast: () => lastSelection !== null
    })
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
