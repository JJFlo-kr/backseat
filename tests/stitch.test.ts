import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findShift, Stitcher, type Frame } from '../src/shared/stitch.ts'

/** A tall synthetic "page": every row has its own colour pattern so overlaps are unambiguous. */
function page(width: number, height: number, seed = 7): Frame {
  const data = new Uint8Array(width * height * 4)
  let s = seed
  for (let y = 0; y < height; y++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const r = s & 0xff
    const g = (s >> 8) & 0xff
    const b = (s >> 16) & 0xff
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = (r + x * 3) & 0xff
      data[i + 1] = (g + ((x * 7) & 0x1f)) & 0xff
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

/** The viewport (window) showing the page from row `top`. */
function viewport(p: Frame, top: number, vh: number, header = 0, footer = 0): Frame {
  const data = new Uint8Array(p.width * vh * 4)
  data.set(p.data.subarray(top * p.width * 4, (top + vh) * p.width * 4))
  // Sticky header: the first `header` rows are always the same (page rows 0..header).
  if (header > 0) data.set(p.data.subarray(0, header * p.width * 4))
  // Fixed footer (window border / status bar): the last `footer` rows are a constant pattern.
  for (let y = vh - footer; y < vh; y++) {
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4
      data[i] = 40
      data[i + 1] = 40 + (x % 7)
      data[i + 2] = 60
      data[i + 3] = 255
    }
  }
  return { width: p.width, height: vh, data }
}

test('findShift recovers the scroll distance between two viewports', () => {
  const p = page(120, 600)
  const a = viewport(p, 0, 200)
  const b = viewport(p, 73, 200)
  const m = findShift(a, b)
  assert.equal(m.shift, 73)
  assert.ok(m.error < 1)
})

test('findShift reports 0 for identical frames (end of page) and Infinity for unrelated ones', () => {
  const p = page(100, 400)
  const a = viewport(p, 50, 150)
  assert.equal(findShift(a, viewport(p, 50, 150)).shift, 0)
  const other = page(100, 400, 99)
  const m = findShift(a, viewport(other, 0, 150))
  assert.equal(m.error, Infinity)
})

test('Stitcher rebuilds the whole page from overlapping viewports, stopping at the end', () => {
  const p = page(80, 1000)
  const vh = 240
  const st = new Stitcher(viewport(p, 0, vh))
  let top = 0
  let ended = false
  for (let i = 0; i < 20; i++) {
    const next = Math.min(p.height - vh, top + 90) // the last steps clamp at the bottom of the page
    const shift = st.push(viewport(p, next, vh))
    if (shift === 0) {
      ended = true
      break
    }
    assert.equal(shift, next - top)
    top = next
  }
  assert.ok(ended, 'the stitcher should see an identical frame at the bottom')
  const out = st.toFrame()
  assert.equal(out.width, 80)
  assert.equal(out.height, 1000)
  assert.deepEqual(out.data, p.data)
})

test('a fixed footer (window border) is kept out of the seams and appears once at the bottom', () => {
  const p = page(64, 900)
  const vh = 220
  const footer = 6
  const st = new Stitcher(viewport(p, 0, vh, 0, footer))
  let top = 0
  while (true) {
    const next = Math.min(p.height - vh, top + 75)
    const shift = st.push(viewport(p, next, vh, 0, footer))
    if (shift === 0) break
    assert.equal(shift, next - top)
    top = next
  }
  const out = st.toFrame()
  // page rows 0 .. 900-footer, then the footer once
  assert.equal(out.height, 900)
  assert.deepEqual(out.data.subarray(0, (900 - footer) * 64 * 4), p.data.subarray(0, (900 - footer) * 64 * 4))
  const last = viewport(p, p.height - vh, vh, 0, footer)
  assert.deepEqual(out.data.subarray((900 - footer) * 64 * 4), last.data.subarray((vh - footer) * 64 * 4))
})

test('a sticky header at the top of every frame does not break matching and appears once', () => {
  const p = page(60, 700)
  const vh = 200
  const header = 30
  const st = new Stitcher(viewport(p, 0, vh, header), { skipTopRows: 50 })
  let top = 0
  while (true) {
    const next = Math.min(p.height - vh, top + 70)
    const shift = st.push(viewport(p, next, vh, header))
    if (shift === 0) break
    assert.equal(shift, next - top)
    top = next
  }
  const out = st.toFrame()
  assert.equal(out.height, 700)
  // Rows below the header are the page's own rows: compare the tail.
  const tail = out.data.subarray(header * 60 * 4)
  assert.deepEqual(tail, p.data.subarray(header * 60 * 4))
})
