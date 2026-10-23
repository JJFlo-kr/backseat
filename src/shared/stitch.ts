// Pure stitching for scroll capture: no Electron, no DOM, so it is unit-testable.
// Frames are 4-byte-per-pixel bitmaps (BGRA or RGBA, the maths does not care) of equal width.

export interface Frame {
  width: number
  height: number
  /** width * height * 4 bytes, row-major. */
  data: Uint8Array
}

export interface StitchOptions {
  /** Rows at the top of every frame to ignore when matching (sticky headers). Default 25% of the height. */
  skipTopRows?: number
  /** Smallest scroll (px) that counts as movement. Default 4. */
  minShift?: number
  /** Sample every Nth column / row when comparing. Default 3. */
  stride?: number
  /** Mean per-channel error above which no offset is trusted. Default 12. */
  maxError?: number
}

export interface MatchResult {
  /** How many rows the content moved up between prev and next (0 = identical, nothing scrolled). */
  shift: number
  /** Mean absolute per-channel difference at that shift (0 = perfect). */
  error: number
}

/** Mean absolute difference between prev rows [s, s+n) and next rows [t, t+n), sampled. */
function rowError(prev: Frame, next: Frame, s: number, t: number, n: number, stride: number): number {
  const w = prev.width
  let sum = 0
  let count = 0
  for (let r = 0; r < n; r += stride) {
    let pi = ((s + r) * w) * 4
    let ni = ((t + r) * w) * 4
    for (let x = 0; x < w; x += stride, pi += 4 * stride, ni += 4 * stride) {
      sum += Math.abs(prev.data[pi] - next.data[ni]) + Math.abs(prev.data[pi + 1] - next.data[ni + 1]) + Math.abs(prev.data[pi + 2] - next.data[ni + 2])
      count += 3
    }
  }
  return count ? sum / count : 0
}

/** Sampled mean absolute per-channel difference between two equally sized frames. */
export function frameDiff(a: Frame, b: Frame, stride = 6): number {
  if (a.width !== b.width || a.height !== b.height) return Infinity
  return rowError(a, b, 0, 0, a.height, stride)
}

/**
 * Rows at the bottom that did not move between two frames although the page scrolled: a window
 * border, status bar or sticky footer. Counted from the bottom up to maxRows.
 */
export function fixedBottomRows(prev: Frame, next: Frame, maxRows: number): number {
  const w = prev.width
  let k = 0
  for (let y = prev.height - 1; y >= 0 && k < maxRows; y--) {
    let sum = 0
    let count = 0
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4
      sum += Math.abs(prev.data[i] - next.data[i]) + Math.abs(prev.data[i + 1] - next.data[i + 1]) + Math.abs(prev.data[i + 2] - next.data[i + 2])
      count += 3
    }
    if (sum / count > 1.5) break
    k++
  }
  return k
}

/**
 * Find how far `next` scrolled relative to `prev`: the shift s such that prev[s + skip ..] matches
 * next[skip ..]. Returns shift 0 when the frames are the same (end of page or nothing scrolled),
 * and error = Infinity when no shift matches well enough.
 */
export function findShift(prev: Frame, next: Frame, opts: StitchOptions = {}): MatchResult {
  if (prev.width !== next.width || prev.height !== next.height) throw new Error('frame size mismatch')
  const h = prev.height
  const skip = Math.min(h - 8, opts.skipTopRows ?? Math.floor(h * 0.25))
  const minShift = opts.minShift ?? 4
  const stride = opts.stride ?? 3
  const maxError = opts.maxError ?? 12

  // identical frames: nothing moved
  const same = rowError(prev, next, skip, skip, h - skip, stride)
  if (same < 1) return { shift: 0, error: same }

  let best: MatchResult = { shift: 0, error: Infinity }
  // Coarse pass over every offset with sparse sampling, then an exact pass around the best one.
  const minOverlap = Math.max(8, Math.floor((h - skip) * 0.1))
  const coarse = Math.max(stride, 4)
  for (let s = minShift; s <= h - skip - minOverlap; s++) {
    const n = h - skip - s
    const e = rowError(prev, next, skip + s, skip, n, coarse)
    if (e < best.error) best = { shift: s, error: e }
  }
  const lo = Math.max(minShift, best.shift - 1)
  const hi = Math.min(h - skip - minOverlap, best.shift + 1)
  best = { shift: 0, error: Infinity }
  for (let s = lo; s <= hi; s++) {
    const n = h - skip - s
    const e = rowError(prev, next, skip + s, skip, n, 1)
    if (e < best.error) best = { shift: s, error: e }
  }
  if (best.error > maxError) return { shift: 0, error: Infinity }
  return best
}

/** Growable tall bitmap that frames are appended to. */
export class Stitcher {
  private rows: Uint8Array[] = []
  private height = 0
  readonly width: number
  private last: Frame | null = null
  private readonly opts: StitchOptions
  /** Bottom rows of `last` that are not in the composite yet (a fixed footer, added once at the end). */
  private trimmed = 0
  frames = 0

  constructor(first: Frame, opts: StitchOptions = {}) {
    this.width = first.width
    this.opts = opts
    this.append(first.data, 0, first.height)
    this.last = first
    this.frames = 1
  }

  private append(data: Uint8Array, fromRow: number, toRow: number): void {
    if (toRow <= fromRow) return
    this.rows.push(data.subarray(fromRow * this.width * 4, toRow * this.width * 4))
    this.height += toRow - fromRow
  }

  /** Drop the last n rows of the composite. */
  private dropBottom(n: number): void {
    const stride = this.width * 4
    while (n > 0 && this.rows.length > 0) {
      const lastChunk = this.rows[this.rows.length - 1]
      const chunkRows = lastChunk.length / stride
      if (chunkRows <= n) {
        this.rows.pop()
        n -= chunkRows
        this.height -= chunkRows
      } else {
        this.rows[this.rows.length - 1] = lastChunk.subarray(0, (chunkRows - n) * stride)
        this.height -= n
        n = 0
      }
    }
  }

  get totalHeight(): number {
    return this.height
  }

  /**
   * Add the next frame. Returns the detected shift (0 = page did not move: caller should stop)
   * or -1 when the frame could not be matched (caller may retry or stop).
   */
  push(next: Frame): number {
    if (!this.last) return -1
    const m = findShift(this.last, next, this.opts)
    if (m.error === Infinity) return -1
    if (m.shift === 0) return 0
    const h = next.height
    // Rows at the bottom that stayed put (window border, status bar, sticky footer) must not be
    // copied at every seam: keep them out of the composite and add them once at the end.
    const footer = Math.min(fixedBottomRows(this.last, next, Math.floor(h / 4)), this.trimmed + m.shift - 1)
    if (footer > this.trimmed) this.dropBottom(footer - this.trimmed)
    // The composite now ends at last[h - max(footer, trimmed)); the new frame's rows below that are new content.
    const from = h - Math.max(footer, this.trimmed) - m.shift
    this.append(next.data, from, h - footer)
    this.trimmed = footer
    this.last = next
    this.frames++
    return m.shift
  }

  /** The stitched bitmap (same pixel format as the frames), footer included once at the bottom. */
  toFrame(): Frame {
    const tail = this.last && this.trimmed > 0 ? this.last.data.subarray((this.last.height - this.trimmed) * this.width * 4) : null
    const height = this.height + (tail ? this.trimmed : 0)
    const data = new Uint8Array(this.width * height * 4)
    let off = 0
    for (const r of this.rows) {
      data.set(r, off)
      off += r.length
    }
    if (tail) data.set(tail, off)
    return { width: this.width, height, data }
  }
}
