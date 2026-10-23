import { app, globalShortcut } from 'electron'
import type { CaptureMode, EditorInit } from '../shared/types'
import { classifyTarget } from './agents'
import { captureAllDisplays, captureForDisplayId, cropDip } from './capture'
import { createEditorWindow, installEditorIpc } from './editor'
import { getForegroundWindow, listTopLevelWindows } from './native/win32'
import { cancelSelector, runSelector, selectorActive } from './selector'
import { runSelfTest } from './selftest'
import { createTray } from './tray'

const HOTKEY = 'CommandOrControl+Shift+A'
const HOTKEY_WINDOW = 'CommandOrControl+Shift+W'
let capturing = false

/** Full flow: remember the active window -> freeze screens -> pick a region/window -> open the editor. */
export async function startCapture(mode: CaptureMode = 'rect'): Promise<void> {
  if (capturing) {
    // Hotkey pressed again while the selector is up: treat as cancel.
    if (selectorActive()) cancelSelector()
    return
  }
  capturing = true
  try {
    const active = getForegroundWindow() // before any of our windows show up
    const target = classifyTarget(active)
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
        activeWindow: active ? { title: active.title, process: active.process } : undefined
      },
      target
    }
    createEditorWindow(init)
  } catch (err) {
    console.error('[backseat] capture failed:', err)
  } finally {
    capturing = false
  }
}

app.setAppUserModelId('com.backseat.app')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--capture')) void startCapture()
  })

  app.whenReady().then(async () => {
    installEditorIpc()
    if (process.argv.includes('--selftest')) {
      await runSelfTest()
      return
    }
    createTray(() => void startCapture())
    if (!globalShortcut.register(HOTKEY, () => void startCapture('rect'))) {
      console.error(`[backseat] could not register hotkey ${HOTKEY}`)
    }
    if (!globalShortcut.register(HOTKEY_WINDOW, () => void startCapture('window'))) {
      console.error(`[backseat] could not register hotkey ${HOTKEY_WINDOW}`)
    }
    if (process.argv.includes('--capture')) void startCapture()
  })
}

// Tray app: keep running when every window is closed.
app.on('window-all-closed', () => {
  /* noop */
})
app.on('will-quit', () => globalShortcut.unregisterAll())
