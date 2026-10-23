// STT spike: transcribe a WAV with Whisper via transformers.js (ONNX, Node).
// usage: node scripts/stt-spike.mjs <wav> [modelId]
import { readFileSync } from 'node:fs'
import { pipeline, env } from '@huggingface/transformers'

env.cacheDir = new URL('../.cache/hf/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF wav')
  let off = 12
  let fmt = null
  let data = null
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

export function wavToFloat16k(buf) {
  const { fmt, data } = parseWav(buf)
  if (fmt.bits !== 16) throw new Error(`unsupported bits ${fmt.bits}`)
  const frames = data.length / 2 / fmt.channels
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

const [, , wavPath, modelId = 'onnx-community/whisper-small'] = process.argv
const audio = wavToFloat16k(readFileSync(wavPath))
console.log(`audio: ${(audio.length / 16000).toFixed(2)}s @16k, model ${modelId}`)
const t0 = Date.now()
const asr = await pipeline('automatic-speech-recognition', modelId, {
  progress_callback: (p) => {
    if (p.status === 'progress' && p.progress && Math.round(p.progress) % 25 === 0) {
      process.stdout.write(`\r  ${p.file} ${Math.round(p.progress)}%   `)
    }
  }
})
console.log(`\nmodel ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
const t1 = Date.now()
const out = await asr(audio, {
  language: 'korean',
  task: 'transcribe',
  return_timestamps: process.argv[4] === 'segment' ? true : 'word',
  chunk_length_s: 30
})
console.log(`transcribed in ${((Date.now() - t1) / 1000).toFixed(1)}s`)
console.log('TEXT:', out.text)
console.log('CHUNKS:', JSON.stringify(out.chunks?.slice(0, 40)))
