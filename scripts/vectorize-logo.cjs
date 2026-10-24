// Turn a flat AI-generated logo raster (white mark on a red circle / rounded square, on a white page)
// into a clean SVG: the background shape is redrawn as exact geometry, the white mark is traced.
//
//   node scripts/vectorize-logo.cjs <depsDir> <in.png> <out.svg> [circle|square]
//
// depsDir must contain node_modules/potrace and node_modules/pngjs (installed outside the repo).
'use strict'
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const [, , depsDir, inPath, outPath, shapeArg] = process.argv
if (!depsDir || !inPath || !outPath) {
  console.error('usage: vectorize-logo.cjs <depsDir> <in.png> <out.svg> [circle|square]')
  process.exit(2)
}
const req = createRequire(path.join(path.resolve(depsDir), 'package.json'))
const { PNG } = req('pngjs')
const potrace = req('potrace')

const RED = '#E5484D'
const VIEW = 256
const INSET = 6 // breathing room inside the 256 canvas

const png = PNG.sync.read(fs.readFileSync(inPath))
const { width: W, height: H, data } = png
const at = (x, y) => (y * W + x) * 4
const minCh = (i) => Math.min(data[i], data[i + 1], data[i + 2])
const isLight = (x, y) => minCh(at(x, y)) > 150 // white page or white mark
const isRed = (x, y) => {
  const i = at(x, y)
  return data[i] > 150 && data[i + 1] < 140 && data[i + 2] < 140
}

// 1. Light pixels connected to the border are the page; the rest of the light pixels are the mark.
const outside = new Uint8Array(W * H)
const stack = []
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const k = y * W + x
  if (outside[k] || !isLight(x, y)) return
  outside[k] = 1
  stack.push(k)
}
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1) }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y) }
while (stack.length) {
  const k = stack.pop()
  const x = k % W
  const y = (k - x) / W
  push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
}

// 2. Background shape geometry from the red pixels.
let x0 = W, y0 = H, x1 = -1, y1 = -1
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!isRed(x, y)) continue
  if (x < x0) x0 = x
  if (x > x1) x1 = x
  if (y < y0) y0 = y
  if (y > y1) y1 = y
}
const bw = x1 - x0 + 1
const bh = y1 - y0 + 1
const side = Math.max(bw, bh)
// Corner radius from the 45° diagonal: the arc meets it at t = r(1 - 1/√2).
let t = 0
while (t < side / 2 && !isRed(x0 + t, y0 + t)) t++
const radiusPx = t / (1 - Math.SQRT1_2)
const shape = shapeArg || (radiusPx > side * 0.42 ? 'circle' : 'square')

// 3. Mark mask (black mark on white) cropped to the background box, traced by potrace.
const mask = new PNG({ width: bw, height: bh })
for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
  const sx = x0 + x
  const sy = y0 + y
  const k = sy * W + sx
  const mark = isLight(sx, sy) && !outside[k]
  const o = (y * bw + x) * 4
  const v = mark ? 0 : 255
  mask.data[o] = mask.data[o + 1] = mask.data[o + 2] = v
  mask.data[o + 3] = 255
}
const maskBuf = PNG.sync.write(mask)

potrace.trace(maskBuf, { threshold: 128, turdSize: 20, optTolerance: 0.35, alphaMax: 1.0, color: '#000' }, (err, svg) => {
  if (err) throw err
  const d = (svg.match(/ d="([^"]+)"/) || [])[1]
  if (!d) throw new Error('potrace produced no path')
  const scale = (VIEW - INSET * 2) / side
  const r = Math.min(radiusPx, side / 2) * scale
  const s = VIEW - INSET * 2
  const bg =
    shape === 'circle'
      ? `<circle cx="${VIEW / 2}" cy="${VIEW / 2}" r="${(s / 2).toFixed(2)}" fill="${RED}"/>`
      : `<rect x="${INSET}" y="${INSET}" width="${s}" height="${s}" rx="${r.toFixed(2)}" fill="${RED}"/>`
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}">`,
    `  ${bg}`,
    `  <path transform="translate(${INSET} ${INSET}) scale(${scale.toFixed(6)})" fill="#fff" fill-rule="evenodd" d="${d}"/>`,
    `</svg>`,
    ''
  ].join('\n')
  fs.writeFileSync(outPath, out)
  // A mark-only version (white hand, transparent) for README / large artwork on red.
  const glyphOut = outPath.replace(/\.svg$/i, '-mark.svg')
  fs.writeFileSync(
    glyphOut,
    [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bw} ${bh}" width="${bw}" height="${bh}">`,
      `  <path fill="${RED}" fill-rule="evenodd" d="${d}"/>`,
      `</svg>`,
      ''
    ].join('\n')
  )
  console.log(JSON.stringify({ in: inPath, shape, box: [x0, y0, bw, bh], radiusPx: Math.round(radiusPx), pathChars: d.length, out: outPath, mark: glyphOut }))
})
