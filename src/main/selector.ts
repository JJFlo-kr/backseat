import { BrowserWindow, ipcMain, screen } from 'electron'
import { IPC } from '../shared/ipc'
import type { CaptureMode, Rect, SelectionResult, SelectorInit, WindowInfo } from '../shared/types'
import type { DisplayCapture } from './capture'
import { baseWebPreferences, loadPage, watchRendererErrors } from './windows'

interface Pending {
  windows: BrowserWindow[]
  resolve: (r: SelectionResult | null) => void
  settled: boolean
}

let pending: Pending | null = null
let ipcInstalled = false

function settle(result: SelectionResult | null): void {
  const p = pending
  if (!p || p.settled) return
  p.settled = true
  pending = null
  for (const w of p.windows) {
    if (!w.isDestroyed()) w.destroy()
  }
  p.resolve(result)
}

function installIpc(): void {
  if (ipcInstalled) return
  ipcInstalled = true
  ipcMain.on(IPC.selectorDone, (_e, result: SelectionResult) => settle(result))
  ipcMain.on(IPC.selectorCancel, () => settle(null))
}

export function cancelSelector(): void {
  settle(null)
}

export function selectorActive(): boolean {
  return pending !== null
}

export function createSelectorWindow(cap: DisplayCapture, errors?: string[]): BrowserWindow {
  const { display } = cap
  const b = display.bounds
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    autoHideMenuBar: true,
    show: false,
    title: 'Backseat capture',
    webPreferences: baseWebPreferences()
  })
  win.setMenu(null)
  win.setAlwaysOnTop(true, 'screen-saver')
  // Some Windows setups ignore the constructor bounds for off-primary displays.
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
  if (errors) watchRendererErrors(win.webContents, errors, `selector:${display.id}`)
  return win
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 - x <= 0 || y2 - y <= 0) return null
  return { x, y, width: x2 - x, height: y2 - y }
}

/** Windows overlapping this display, with bounds made relative to the display and clipped. */
export function windowsForDisplay(cap: DisplayCapture, windows: WindowInfo[]): WindowInfo[] {
  const b = cap.display.bounds
  const out: WindowInfo[] = []
  for (const w of windows) {
    const clip = intersect(w.bounds, b)
    if (!clip) continue
    out.push({ ...w, bounds: { x: clip.x - b.x, y: clip.y - b.y, width: clip.width, height: clip.height } })
  }
  return out
}

export function selectorInitFor(cap: DisplayCapture, windows: WindowInfo[] = [], mode: CaptureMode = 'rect'): SelectorInit {
  const { display } = cap
  return {
    displayId: display.id,
    // JPEG keeps the IPC payload small; the crop itself happens from the lossless NativeImage.
    imageDataUrl: `data:image/jpeg;base64,${cap.image.toJPEG(88).toString('base64')}`,
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
    mode,
    windows: windowsForDisplay(cap, windows)
  }
}

/**
 * Show one selector window per display and resolve with the user's selection,
 * or null when cancelled.
 */
export function runSelector(
  caps: DisplayCapture[],
  windows: WindowInfo[] = [],
  mode: CaptureMode = 'rect'
): Promise<SelectionResult | null> {
  installIpc()
  if (pending) settle(null)

  return new Promise<SelectionResult | null>((resolve) => {
    const wins = caps.map((c) => createSelectorWindow(c))
    pending = { windows: wins, resolve, settled: false }

    const cursor = screen.getCursorScreenPoint()
    const focusDisplay = screen.getDisplayNearestPoint(cursor)

    caps.forEach((cap, i) => {
      const win = wins[i]
      win.on('closed', () => settle(null))
      win.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return
        win.webContents.send(IPC.selectorInit, selectorInitFor(cap, windows, mode))
        win.show()
        if (cap.display.id === focusDisplay.id) win.focus()
      })
      void loadPage(win, 'selector')
    })
  })
}
