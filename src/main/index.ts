import { app, globalShortcut, session } from 'electron'
import type { AskRequest, CaptureMode, EditorInit, SelectionResult } from '../shared/types'
import { captureAllDisplays, captureForDisplayId, cropDip } from './capture'
import { applyLoginItem, ensureConfig, loadSettings, sessionsRoot } from './config'
import { resolveForCapture } from './destination'
import { createEditorWindow, installEditorIpc } from './editor'
import { getForegroundWindow, listTopLevelWindows } from './native/win32'
import { requestForCapture, startRequestWatcher } from './requests'
import { scrollCapture } from './scroll'
import { cancelSelector, runSelector, selectorActive } from './selector'
import { runSelfTest } from './selftest'
import { runDeliverySelfTest, runRealAppCheck } from './selftest-delivery'
import { latestCompareSource } from './sessions'
import { startForegroundTracker } from './tracker'
import { createTray } from './tray'
import { applyLocale } from './locales'

let capturing = false
/** Last confirmed selection, for "마지막 영역 다시 캡처" (before/after comparisons). */
let lastSelection: SelectionResult | null = null

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
    // One enumeration, in z-order, before any of our windows show up: target model, candidates and the selector use it.
    const windows = listTopLevelWindows()
    // Where 보내기 goes is decided apart from what is captured: pick → pin → MCP agent → last AI window →
    // AI app in front → none. The captured page / a messenger is never chosen automatically (src/main/targets.ts).
    const targets = await resolveForCapture(active, windows)
    const target = targets.current.target
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
      targetPinned: targets.current.view.source === 'pinned' ? true : undefined,
      candidates: [...targets.candidates.values()].map((c) => c.target),
      sendTarget: targets.current.view,
      autoRecord: settings.autoRecord,
      request: ask,
      compare
    }
    createEditorWindow(init, undefined, targets)
  } catch (err) {
    console.error('[backseat] capture failed:', err)
  } finally {
    capturing = false
  }
}

app.setAppUserModelId('com.backseat.app')

const realArg = process.argv.find((a) => a.startsWith('--selftest-real='))
const isSelfTest = process.argv.includes('--selftest') || process.argv.includes('--selftest-delivery') || Boolean(realArg)

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
    if (realArg) {
      await runRealAppCheck(Number(realArg.split('=')[1]))
      return
    }
    if (process.argv.includes('--selftest-delivery')) {
      await runDeliverySelfTest()
      return
    }
    if (process.argv.includes('--selftest')) {
      await runSelfTest()
      return
    }
    const settings = await ensureConfig()
    applyLoginItem(settings)
    startForegroundTracker()
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
