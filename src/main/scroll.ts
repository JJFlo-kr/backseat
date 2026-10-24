// Scroll capture: wheel the chosen window down step by step, grab the display after each step,
// and let the stitcher find the overlap. Stops at the end of the page, at the height limit,
// when frames stop matching, or when the user presses Esc.
import { BrowserWindow, desktopCapturer, globalShortcut, nativeImage, screen, type Display, type NativeImage } from 'electron'
import type { Rect, WindowInfo } from '../shared/types'
import { t } from '../shared/i18n'
import { frameDiff, Stitcher, type Frame } from '../shared/stitch'
import { getCursorPos, postWheel, sendWheel, sendWheelDelta, setCursorPos, WHEEL_DELTA, win32Available, windowAtPoint } from './native/win32'

export interface ScrollCaptureOptions {
  /** Stop once the stitched image is at least this tall (device px). */
  maxHeightPx?: number
  /** Wheel delta per step in WHEEL_DELTA units (120 = one notch). Default: about a third of the viewport. */
  stepDelta?: number
  /** Polling interval while waiting for smooth scrolling to settle. */
  settleMs?: number
  /** Save every grabbed frame here (debugging). */
  dumpDir?: string
  /** Hard cap on frames. */
  maxFrames?: number
  /** Show the little "스크롤 캡처 중" badge. */
  showProgress?: boolean
  /** Register Esc as a global cancel while capturing. */
  escCancels?: boolean
  onProgress?: (frames: number, heightPx: number) => void
}

export interface ScrollCaptureResult {
  image: NativeImage
  frames: number
  /** Height of one frame (the window's visible part), device px. */
  viewportPx: number
  heightPx: number
  widthPx: number
  stoppedBy: 'end' | 'limit' | 'mismatch' | 'cancel' | 'frames'
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function pxRect(display: Display, dip: Rect): Rect {
  const s = display.scaleFactor
  const x = Math.max(0, Math.round(dip.x * s))
  const y = Math.max(0, Math.round(dip.y * s))
  const w = Math.round(display.size.width * s)
  const h = Math.round(display.size.height * s)
  return { x, y, width: Math.max(1, Math.min(w - x, Math.round(dip.width * s))), height: Math.max(1, Math.min(h - y, Math.round(dip.height * s))) }
}

/** One screenshot of `display`, cropped to `rect` (device px), as a raw BGRA frame. */
async function grab(display: Display, rect: Rect): Promise<Frame> {
  const thumbnailSize = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!src) throw new Error('desktopCapturer returned no screen sources')
  let img = src.thumbnail
  const got = img.getSize()
  if (got.width !== thumbnailSize.width || got.height !== thumbnailSize.height) img = img.resize({ ...thumbnailSize, quality: 'best' })
  const crop = img.crop(rect)
  const size = crop.getSize()
  return { width: size.width, height: size.height, data: new Uint8Array(crop.toBitmap()) }
}

/** Grab until two consecutive grabs look the same (smooth scrolling has settled), or give up after ~1.5 s. */
async function grabSettled(display: Display, rect: Rect, pollMs: number): Promise<Frame> {
  let prev = await grab(display, rect)
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    await sleep(pollMs)
    const next = await grab(display, rect)
    if (frameDiff(prev, next) < 0.5) return next
    prev = next
  }
  return prev
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Tiny always-on-top badge placed in a display corner that does not overlap the captured window. */
function progressBadge(display: Display, avoidDip: Rect): BrowserWindow | null {
  const W = 300
  const H = 36
  const wa = display.workArea
  const corners = [
    { x: wa.x + wa.width - W - 12, y: wa.y + wa.height - H - 12 },
    { x: wa.x + 12, y: wa.y + wa.height - H - 12 },
    { x: wa.x + wa.width - W - 12, y: wa.y + 12 },
    { x: wa.x + 12, y: wa.y + 12 }
  ]
  const abs = { x: display.bounds.x + avoidDip.x, y: display.bounds.y + avoidDip.y, width: avoidDip.width, height: avoidDip.height }
  const spot = corners.find(
    (c) => c.x + W <= abs.x || c.x >= abs.x + abs.width || c.y + H <= abs.y || c.y >= abs.y + abs.height
  )
  if (!spot) return null
  const win = new BrowserWindow({
    x: spot.x, y: spot.y, width: W, height: H, frame: false, transparent: false, backgroundColor: '#1b1b1f',
    alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, focusable: false, show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  win.setMenu(null)
  win.setAlwaysOnTop(true, 'screen-saver')
  const html = `<body style="margin:0;background:#1b1b1f;color:#eee;font:12px system-ui,'Malgun Gothic',sans-serif;display:flex;align-items:center;justify-content:center;height:36px;border:1px solid #E5484D;box-sizing:border-box"><span id=t>${escapeHtml(t('scroll.badge.start'))}</span></body>`
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive() })
  return win
}

/**
 * Capture a window taller than the screen. `winRect` is the window's visible bounds in DIP
 * relative to `display` (as the selector reports them).
 */
export async function scrollCapture(
  display: Display,
  win: Pick<WindowInfo, 'hwnd'>,
  winRect: Rect,
  opts: ScrollCaptureOptions = {}
): Promise<ScrollCaptureResult> {
  const maxHeight = opts.maxHeightPx ?? 16000
  // One notch scrolls about 300 DIP in Chromium at Windows' default "3 lines"; aim for a third of the
  // viewport per step so consecutive frames overlap well even for small windows.
  const NOTCH_DIP = 300
  let stepDelta = opts.stepDelta ?? Math.max(WHEEL_DELTA / 3, Math.min(WHEEL_DELTA * 6, Math.round(((winRect.height * 0.35) / NOTCH_DIP) * WHEEL_DELTA)))
  const settleMs = opts.settleMs ?? 120
  const maxFrames = opts.maxFrames ?? 80
  const rect = pxRect(display, winRect)
  const dump = async (f: Frame, tag: string): Promise<void> => {
    if (!opts.dumpDir) return
    const { writeFile, mkdir } = await import('fs/promises')
    await mkdir(opts.dumpDir, { recursive: true })
    const img = nativeImage.createFromBitmap(Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength), { width: f.width, height: f.height })
    await writeFile(`${opts.dumpDir}/${tag}.png`, img.toPNG())
  }
  const first = await grabSettled(display, rect, settleMs)
  await dump(first, 'frame-0')
  const stitcher = new Stitcher(first)
  const viewportPx = rect.height
  let stoppedBy: ScrollCaptureResult['stoppedBy'] = 'end'
  let canceled = false
  let escRegistered = false
  if (opts.escCancels !== false) {
    try {
      escRegistered = globalShortcut.register('Escape', () => { canceled = true })
    } catch {
      escRegistered = false
    }
  }
  const badge = opts.showProgress !== false ? progressBadge(display, winRect) : null
  const cursorBefore = getCursorPos()
  // Wheel events go to the window under the cursor: park it in the window's lower half,
  // away from the edges, so a sticky header or a scrollbar does not swallow them.
  const centreDip = { x: winRect.x + winRect.width / 2, y: winRect.y + winRect.height * 0.6 }
  const centre = screen.dipToScreenPoint({ x: display.bounds.x + centreDip.x, y: display.bounds.y + centreDip.y })
  let sentDelta = 0
  let mismatches = 0
  let idle = 0 // consecutive steps where nothing moved
  let grabs = 0
  try {
    opts.onProgress?.(stitcher.frames, stitcher.totalHeight)
    while (true) {
      if (canceled) { stoppedBy = 'cancel'; break }
      if (stitcher.totalHeight >= maxHeight) { stoppedBy = 'limit'; break }
      if (stitcher.frames >= maxFrames) { stoppedBy = 'frames'; break }
      if (win32Available()) {
        setCursorPos(centre.x, centre.y)
        const sent = sendWheelDelta(-stepDelta)
        if (sent === 0 || (win.hwnd && windowAtPoint(centre.x, centre.y) !== win.hwnd)) {
          postWheel(win.hwnd, -stepDelta, centre.x, centre.y)
        }
        sentDelta += stepDelta
      }
      await sleep(settleMs)
      if (canceled) { stoppedBy = 'cancel'; break }
      const frame = await grabSettled(display, rect, settleMs)
      await dump(frame, `frame-${++grabs}`)
      const shift = stitcher.push(frame)
      if (shift === -1) {
        // Overshot the overlap (or a popup/tooltip appeared): smaller steps, a few tries.
        mismatches++
        if (mismatches >= 3) { stoppedBy = 'mismatch'; break }
        stepDelta = Math.max(WHEEL_DELTA / 3, Math.floor(stepDelta / 2))
        continue
      }
      mismatches = 0
      if (shift === 0) {
        // Apps that only react to whole notches move every few sub-notch steps: insist a little.
        idle++
        if (idle >= 3 || (sentDelta >= WHEEL_DELTA * 2 && idle >= 2)) { stoppedBy = 'end'; break }
        continue
      }
      idle = 0
      opts.onProgress?.(stitcher.frames, stitcher.totalHeight)
      if (badge && !badge.isDestroyed()) {
        void badge.webContents
          .executeJavaScript(`document.getElementById('t').textContent=${JSON.stringify(t('scroll.badge.progress', { n: stitcher.frames, height: stitcher.totalHeight }))}`)
          .catch(() => undefined)
      }
    }
  } finally {
    if (escRegistered) globalShortcut.unregister('Escape')
    badge?.destroy()
    // Leave the page where the user had it.
    if (sentDelta > 0 && win32Available()) {
      setCursorPos(centre.x, centre.y)
      sendWheel(Math.ceil(sentDelta / WHEEL_DELTA))
    }
    if (cursorBefore) setCursorPos(cursorBefore.x, cursorBefore.y)
  }
  const frame = stitcher.toFrame()
  const image = nativeImage.createFromBitmap(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength), {
    width: frame.width,
    height: frame.height
  })
  return { image, frames: stitcher.frames, viewportPx, heightPx: frame.height, widthPx: frame.width, stoppedBy }
}
