// Mock-up images in agent results (design_proposal): base64 PNG, checked strictly before anything is written.
// The bytes are only ever stored as a file and shown as an image; nothing is rendered as markup.
// Plain Node, no Electron.

export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024
export const MAX_PREVIEW_SIDE = 8000

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
/** Longest base64 text that can still decode to MAX_PREVIEW_BYTES (checked before decoding). */
const MAX_BASE64_CHARS = Math.ceil(MAX_PREVIEW_BYTES / 3) * 4

export type PngCheck = { ok: true; bytes: Buffer; width: number; height: number } | { ok: false; error: string }

/**
 * Raw base64 of a PNG (no "data:" prefix; line breaks and spaces are ignored). Accepts only a complete PNG:
 * signature, an IHDR first chunk with 1..8000 px per side, the closing IEND chunk, at most 8 MB decoded,
 * and canonical base64 (decoding and re-encoding gives the same text).
 */
export function checkPngBase64(value: unknown): PngCheck {
  if (typeof value !== 'string') return { ok: false, error: 'expected a base64 string' }
  const text = value.replace(/\s+/g, '')
  if (!text) return { ok: false, error: 'must not be empty' }
  if (/^data:/i.test(text)) return { ok: false, error: 'send the raw base64 text, not a data: URL' }
  if (text.length > MAX_BASE64_CHARS) return { ok: false, error: 'larger than 8 MB' }
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return { ok: false, error: 'not valid base64' }
  const bytes = Buffer.from(text, 'base64')
  if (bytes.toString('base64') !== text) return { ok: false, error: 'not canonical base64' }
  if (bytes.length > MAX_PREVIEW_BYTES) return { ok: false, error: 'larger than 8 MB' }
  // signature (8) + IHDR chunk (4 length + 4 type + 13 data + 4 crc) + IEND chunk (12)
  if (bytes.length < 8 + 25 + 12) return { ok: false, error: 'too short to be a PNG' }
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) return { ok: false, error: 'not a PNG (wrong signature)' }
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') return { ok: false, error: 'not a PNG (no IHDR header)' }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width < 1 || height < 1 || width > MAX_PREVIEW_SIDE || height > MAX_PREVIEW_SIDE) {
    return { ok: false, error: `image size ${width}x${height} is outside 1..${MAX_PREVIEW_SIDE} px per side` }
  }
  if (!bytes.subarray(bytes.length - 12).equals(IEND)) return { ok: false, error: 'PNG is cut off (no closing IEND chunk)' }
  return { ok: true, bytes, width, height }
}
