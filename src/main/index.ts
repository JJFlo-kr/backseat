import { app, globalShortcut, session } from 'electron'
import type { AgentTarget, AskRequest, CaptureMode, EditorInit, SelectionResult, WindowInfo } from '../shared/types'
import { asFallback, buildCandidates, classifyTarget, getLastTarget, matchPinned, rememberTarget, withMcpAgent } from './agents'
import { captureAllDisplays, captureForDisplayId, cropDip } from './capture'
import { applyLoginItem, ensureConfig, loadSettings, sessionsRoot } from './config'
import { createEditorWindow, installEditorIpc } from './editor'
import { pruneRegistry } from './mcp/registry'
import { getForegroundWindow, isWindow, listTopLevelWindows, processParents } from './native/win32'
import { requestForCapture, startRequestWatcher } from './requests'
import { scrollCapture } from './scroll'
import { cancelSelector, runSelector, selectorActive } from './selector'
import { runSelfTest } from './selftest'
import { latestCompareSource } from './sessions'
import { createTray } from './tray'
import { applyLocale } from './locales'

let capturing = false
/** Last confirmed selection, for "마지막 영역 다시 캡처" (before/after comparisons). */
let lastSelection: SelectionResult | null = null

/**
 * Bind the window-based guess to an agent registered through backseat-mcp, but only when that agent
 * provably runs in the guessed window (process tree; Codex review F03). Otherwise the guess is unchanged
 * and the pasted line carries file paths, which any agent can read.
 */
async function pickTarget(guess: AgentTarget | null, windows: readonly WindowInfo[]): Promise<AgentTarget | null> {
  if (!guess?.hwnd) return guess
  let registered: Awaited<ReturnType<typeof pruneRegistry>> = []
  try {
    registered = await pruneRegistry(sessionsRoot())
  } catch {
    registered = []
  }
  if (registered.length === 0) return guess
  const win = windows.find((w) => w.hwnd === guess.hwnd) ?? null
  const parents = processParents()
  return withMcpAgent(guess, registered, win, (pid) => parents.get(pid))
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
    // One enumeration, in z-order, before any of our windows show up: pinned match, candidates and the selector use it.
    const windows = listTopLevelWindows()
    // A pinned default target wins over automatic detection while its window is open.
    const pinWin = matchPinned(windows, settings.pinnedTargetProcess ?? '', settings.pinnedTargetTitle ?? '')
    const pinnedGuess = pinWin ? classifyTarget(pinWin, { selfPid: process.pid }) : null
    const detected = pinnedGuess ?? classifyTarget(active, { selfPid: process.pid })
    let guess = detected
    // Fall back to the previous target ONLY when nothing real was in front (null / desktop / taskbar).
    const prev = getLastTarget()
    if (!guess && prev && isWindow(prev.hwnd)) guess = asFallback(prev)
    // lastTarget keeps the original (undecorated) target; only the object handed to the editor is decorated.
    if (detected) rememberTarget(detected)
    const target = await pickTarget(guess, windows)
    const candidates = buildCandidates(windows, { selfPid: process.pid, excludeHwnd: target?.hwnd })
    const ask = requestForCapture(request)
    const caps = await captureAllDisplays()
    let sel: SelectionResult | null
    if (mode === 'last') {
      sel = lastSelection
      if (!sel) return
    } else {
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
      targetPinned: pinnedGuess ? true : undefined,
      candidates,
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
    applyLocale()
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
    void startRequestWatcher(sessionsRoot(), (r) => void startCapture('rect', r))
    if (process.argv.includes('--capture')) void startCapture()
  })
}

// Tray app: keep running when every window is closed.
app.on('window-all-closed', () => {
  /* noop */
})
app.on('will-quit', () => globalShortcut.unregisterAll())
