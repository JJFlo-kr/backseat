import { desktopCapturer, screen, type Display, type NativeImage } from 'electron'
import type { Rect } from '../shared/types'

export interface DisplayCapture {
  display: Display
  /** Full-resolution screenshot of the display, device pixels. */
  image: NativeImage
  pxWidth: number
  pxHeight: number
}

function pxSize(d: Display): { w: number; h: number } {
  return {
    w: Math.round(d.size.width * d.scaleFactor),
    h: Math.round(d.size.height * d.scaleFactor)
  }
}

/**
 * Grab every display at native resolution. Must run BEFORE any selector
 * window is shown so the overlay is not part of the screenshot.
 */
export async function captureAllDisplays(): Promise<DisplayCapture[]> {
  const displays = screen.getAllDisplays()
  const sizes = displays.map(pxSize)
  const thumbnailSize = {
    width: Math.max(...sizes.map((s) => s.w)),
    height: Math.max(...sizes.map((s) => s.h))
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  if (sources.length === 0) throw new Error('desktopCapturer returned no screen sources')

  return displays.map((display, i) => {
    const want = sizes[i]
    const byId = sources.find((s) => s.display_id === String(display.id))
    const src = byId ?? sources[Math.min(i, sources.length - 1)]
    let image = src.thumbnail
    const got = image.getSize()
    if (got.width !== want.w || got.height !== want.h) {
      image = image.resize({ width: want.w, height: want.h, quality: 'best' })
    }
    return { display, image, pxWidth: want.w, pxHeight: want.h }
  })
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Crop a DIP rect (relative to the display) out of its capture. */
export function cropDip(cap: DisplayCapture, rect: Rect): { image: NativeImage; rectPx: Rect } {
  const s = cap.display.scaleFactor
  const x = clamp(Math.round(rect.x * s), 0, cap.pxWidth - 1)
  const y = clamp(Math.round(rect.y * s), 0, cap.pxHeight - 1)
  const width = clamp(Math.round(rect.width * s), 1, cap.pxWidth - x)
  const height = clamp(Math.round(rect.height * s), 1, cap.pxHeight - y)
  const rectPx = { x, y, width, height }
  return { image: cap.image.crop(rectPx), rectPx }
}

export function captureForDisplayId(caps: DisplayCapture[], id: number): DisplayCapture | undefined {
  return caps.find((c) => c.display.id === id)
}
