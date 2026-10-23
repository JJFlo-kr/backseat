// Minimal RIFF/WAV reader producing mono 16 kHz Float32 PCM (used by the self-test
// and by any future "transcribe this file" command).

interface Fmt {
  format: number
  channels: number
  rate: number
  bits: number
}

function parseWav(buf: Buffer): { fmt: Fmt; data: Buffer } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF wav')
  let off = 12
  let fmt: Fmt | null = null
  let data: Buffer | null = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      }
    } else if (id === 'data') {
      data = buf.subarray(body, body + size)
    }
    off = body + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('wav missing fmt/data')
  return { fmt, data }
}

export function wavToFloat16k(buf: Buffer): Float32Array {
  const { fmt, data } = parseWav(buf)
  if (fmt.bits !== 16) throw new Error(`unsupported wav bits ${fmt.bits}`)
  const frames = Math.floor(data.length / 2 / fmt.channels)
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2)
    mono[i] = s / fmt.channels / 32768
  }
  if (fmt.rate === 16000) return mono
  const ratio = fmt.rate / 16000
  const outLen = Math.floor(frames / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(frames - 1, i0 + 1)
    const f = pos - i0
    out[i] = mono[i0] * (1 - f) + mono[i1] * f
  }
  return out
}
