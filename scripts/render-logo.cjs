// Renders logo SVGs to PNG at 256/64/32/16 px and builds a contact sheet.
//
//   node scripts/render-logo.cjs [--sheet=previews.png] <a.svg> [b.svg ...] <outDir>
//
// Writes <outDir>/<name>-<size>.png for each SVG and <outDir>/previews.png (or the --sheet name):
// one column per SVG with the 256 px render on top, then a dark (#1b1b1f) and
// a light (#f0f0f0) strip holding the 32 px and 16 px renders at 1:1 plus the
// 16 px render blown up 4x (nearest neighbour) so single pixels are visible.
//
// Rasteriser: sharp if it loads; otherwise headless Chrome or Edge (one
// screenshot of a page with every SVG at every size, then cropped). The
// contact sheet is composited here with a small dependency-free PNG codec.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')

const SIZES = [256, 64, 32, 16]

// ---------- PNG codec (8-bit RGB/RGBA, non-interlaced) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng({ width, height, data }) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}
function decodePng(buf) {
  let off = 8
  let width, height, colorType, bitDepth, interlace
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, colour ${colorType}, interlace ${interlace})`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const px = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0
      const b = y > 0 ? px[dst - stride + x] : 0
      const c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0
      let v = raw[src + x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[dst + x] = v & 0xff
    }
  }
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0, j = 0; i < width * height; i++, j += bpp) {
    data[i * 4] = px[j]
    data[i * 4 + 1] = px[j + 1]
    data[i * 4 + 2] = px[j + 2]
    data[i * 4 + 3] = bpp === 4 ? px[j + 3] : 255
  }
  return { width, height, data }
}

// ---------- tiny RGBA canvas ----------
function canvas(width, height, rgb = [0, 0, 0], alpha = 0) {
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([rgb[0], rgb[1], rgb[2], alpha], i * 4)
  return { width, height, data }
}
function crop(img, x0, y0, w, h) {
  const out = canvas(w, h)
  for (let y = 0; y < h; y++) {
    img.data.copy(out.data, y * w * 4, ((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4)
  }
  return out
}
function fillRect(img, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) img.data.set([rgb[0], rgb[1], rgb[2], 255], (y * img.width + x) * 4)
  }
}
// alpha-composite src over dst at (dx, dy), optionally scaled by an integer (nearest neighbour)
function blit(dst, src, dx, dy, scale = 1) {
  for (let y = 0; y < src.height * scale; y++) {
    for (let x = 0; x < src.width * scale; x++) {
      const s = (Math.floor(y / scale) * src.width + Math.floor(x / scale)) * 4
      const d = ((dy + y) * dst.width + dx + x) * 4
      const sa = src.data[s + 3] / 255
      const da = dst.data[d + 3] / 255
      const oa = sa + da * (1 - sa)
      if (oa === 0) continue
      for (let k = 0; k < 3; k++) {
        dst.data[d + k] = Math.round((src.data[s + k] * sa + dst.data[d + k] * da * (1 - sa)) / oa)
      }
      dst.data[d + 3] = Math.round(oa * 255)
    }
  }
}

// ---------- rasterisers ----------
function trySharp() {
  try {
    return require('sharp')
  } catch (err) {
    console.warn(`sharp did not load (${String(err.message).split('\n')[0]}); falling back to headless browser`)
    return null
  }
}

async function rasteriseWithSharp(sharp, svgPath, size) {
  const svg = fs.readFileSync(svgPath)
  const buf = await sharp(svg, { density: Math.max(72, (72 * size) / 256) * 4 })
    .resize(size, size)
    .png()
    .toBuffer()
  return decodePng(buf)
}

function findBrowser() {
  const env = process.env
  const candidates = [
    env.CHROME_PATH,
    path.join(env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(env['PROGRAMFILES'] || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ]
  return candidates.find((p) => p && fs.existsSync(p)) || null
}

// One screenshot holding every SVG at every size; returns map svgPath -> {size: img}
function rasteriseWithBrowser(svgPaths) {
  const browser = findBrowser()
  if (!browser) throw new Error('no headless Chrome/Edge found (set CHROME_PATH)')
  const ROW = 264
  const cols = []
  let x = 0
  for (const s of SIZES) {
    cols.push(x)
    x += s + 8
  }
  const width = x
  const height = ROW * svgPaths.length
  const imgs = svgPaths
    .map((p, r) =>
      SIZES.map(
        (s, c) =>
          `<img src="${pathToFileURL(path.resolve(p)).href}" width="${s}" height="${s}" style="left:${cols[c]}px;top:${r * ROW}px">`
      ).join('')
    )
    .join('\n')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden}img{position:absolute;display:block}
</style></head><body>${imgs}</body></html>`
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-logo-'))
  const htmlPath = path.join(tmp, 'page.html')
  const shot = path.join(tmp, 'shot.png')
  fs.writeFileSync(htmlPath, html)
  try {
    execFileSync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        '--allow-file-access-from-files',
        `--user-data-dir=${path.join(tmp, 'profile')}`,
        `--window-size=${width},${height}`,
        `--screenshot=${shot}`,
        pathToFileURL(htmlPath).href
      ],
      { stdio: 'pipe', timeout: 60000 }
    )
    const page = decodePng(fs.readFileSync(shot))
    const out = new Map()
    svgPaths.forEach((p, r) => {
      const bySize = {}
      SIZES.forEach((s, c) => (bySize[s] = crop(page, cols[c], r * ROW, s, s)))
      out.set(p, bySize)
    })
    return out
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- contact sheet ----------
function contactSheet(renders) {
  const COL = 300
  const PAD = 22
  const STRIP = 84
  const DARK = [0x1b, 0x1b, 0x1f]
  const LIGHT = [0xf0, 0xf0, 0xf0]
  const W = COL * renders.length
  const H = PAD + 256 + PAD + STRIP * 2 + PAD
  const sheet = canvas(W, H, [0x2a, 0x2a, 0x30], 255)
  renders.forEach((r, i) => {
    const x0 = i * COL
    blit(sheet, r[256], x0 + (COL - 256) / 2, PAD)
    ;[DARK, LIGHT].forEach((bg, k) => {
      const y0 = PAD + 256 + PAD + k * STRIP
      fillRect(sheet, x0 + PAD, y0, COL - PAD * 2, STRIP - 6, bg)
      const mid = y0 + (STRIP - 6) / 2
      blit(sheet, r[32], x0 + PAD + 20, mid - 16)
      blit(sheet, r[16], x0 + PAD + 74, mid - 8)
      blit(sheet, r[16], x0 + PAD + 120, mid - 32, 4) // 16 px shown 4x so pixels are visible
    })
  })
  return sheet
}

async function main() {
  let sheetName = 'previews.png'
  const args = process.argv.slice(2).filter((a) => {
    if (a.startsWith('--sheet=')) {
      sheetName = a.slice('--sheet='.length)
      return false
    }
    return true
  })
  if (args.length < 2) {
    console.error('usage: node scripts/render-logo.cjs [--sheet=previews.png] <a.svg> [b.svg ...] <outDir>')
    process.exit(2)
  }
  const outDir = path.resolve(args.pop())
  const svgs = args
  fs.mkdirSync(outDir, { recursive: true })

  const sharp = trySharp()
  let results
  if (sharp) {
    results = new Map()
    for (const p of svgs) {
      const bySize = {}
      for (const s of SIZES) bySize[s] = await rasteriseWithSharp(sharp, p, s)
      results.set(p, bySize)
    }
  } else {
    results = rasteriseWithBrowser(svgs)
  }

  for (const p of svgs) {
    const name = path.basename(p, '.svg')
    for (const s of SIZES) {
      const file = path.join(outDir, `${name}-${s}.png`)
      fs.writeFileSync(file, encodePng(results.get(p)[s]))
      console.log('wrote', file)
    }
  }
  const sheet = path.join(outDir, sheetName)
  fs.writeFileSync(sheet, encodePng(contactSheet(svgs.map((p) => results.get(p)))))
  console.log('wrote', sheet)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
