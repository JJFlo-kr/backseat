// Generates resources/tray.png (32x32) and resources/icon.png (256x256).
// Dependency-free: only zlib, fs and path. PNG is encoded by hand.
'use strict'

const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const OUT_DIR = path.join(__dirname, '..', 'resources')

// ---- CRC32 (IEEE 802.3, reflected polynomial 0xEDB88320) ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---- PNG encoding ----
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

// rgba: Buffer of width * height * 4 bytes, row-major, top row first
function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression method
  ihdr[11] = 0 // filter method
  ihdr[12] = 0 // interlace: none

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---- Drawing ----
const RED = [0xe5, 0x48, 0x4d] // #E5484D
const WHITE = [0xff, 0xff, 0xff]

// Rounded rectangle test in normalized coordinates (0..1).
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hw = (x1 - x0) / 2 - r
  const hh = (y1 - y0) / 2 - r
  const dx = Math.max(Math.abs(x - cx) - hw, 0)
  const dy = Math.max(Math.abs(y - cy) - hh, 0)
  return dx * dx + dy * dy <= r * r
}

// Car seat silhouette: [x0, y0, x1, y1, cornerRadius] in normalized coordinates.
const SEAT_SHAPES = [
  [0.3, 0.22, 0.46, 0.7, 0.05], // seat back: tall, left-center
  [0.27, 0.58, 0.73, 0.74, 0.05] // seat base: wide, bottom-center
]

function render(size) {
  const buf = Buffer.alloc(size * size * 4) // zeroed: fully transparent
  const center = size / 2
  const radius = size * 0.46 // circle diameter = 92% of canvas
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px + 0.5 - center
      const dy = py + 0.5 - center
      if (dx * dx + dy * dy > radius * radius) continue // outside circle: alpha stays 0

      const nx = (px + 0.5) / size
      const ny = (py + 0.5) / size
      const onSeat = SEAT_SHAPES.some(([x0, y0, x1, y1, r]) => inRoundedRect(nx, ny, x0, y0, x1, y1, r))
      const col = onSeat ? WHITE : RED
      const i = (py * size + px) * 4
      buf[i] = col[0]
      buf[i + 1] = col[1]
      buf[i + 2] = col[2]
      buf[i + 3] = 255
    }
  }
  return buf
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const targets = [
    ['tray.png', 32],
    ['icon.png', 256]
  ]
  for (const [name, size] of targets) {
    const png = encodePng(size, size, render(size))
    const file = path.join(OUT_DIR, name)
    fs.writeFileSync(file, png)
    console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`)
  }
}

main()
