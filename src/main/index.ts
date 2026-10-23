import { app, globalShortcut } from 'electron'
import type { EditorInit } from '../shared/types'
import { captureAllDisplays, captureForDisplayId, cropDip } from './capture'
import { createEditorWindow, installEditorIpc } from './editor'
import { runSelector, selectorActive, cancelSelector } from './selector'
import { runSelfTest } from './selftest'
import { createTray } from './tray'

const HOTKEY = 'CommandOrControl+Shift+A'
let capturing = false

/** Full M0 flow: freeze screens -> pick a region -> open the editor. */
export async function startCapture(): Promise<void> {
  if (capturing) {
    // Hotkey pressed again while the selector is up: treat as cancel.
    if (selectorActive()) cancelSelector()
    return
  }
  capturing = true
  try {
    const caps = await captureAllDisplays()
    const sel = await runSelector(caps)
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
        rectPx
      }
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
    const ok = globalShortcut.register(HOTKEY, () => void startCapture())
    if (!ok) console.error(`[backseat] could not register hotkey ${HOTKEY}`)
    if (process.argv.includes('--capture')) void startCapture()
  })
}

// Tray app: keep running when every window is closed.
app.on('window-all-closed', () => {
  /* noop */
})
app.on('will-quit', () => globalShortcut.unregisterAll())
