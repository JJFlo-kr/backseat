// Cloud STT adapter: OpenAI-compatible POST /audio/transcriptions (verbose_json with word
// timestamps). Plain Node (fetch, no Electron) so it can be unit-tested against a mock server.
// .ts extensions so plain Node (the unit tests) can import this file without a bundler.
import type { Transcript } from '../../shared/types.ts'
import { toTranscript, type Chunk } from '../../shared/transcript.ts'

export interface OpenAiSttOptions {
  /** e.g. https://api.openai.com/v1 */
  apiBase: string
  apiKey: string
  model: string
  /** Whisper-style language name ('korean') or ISO code ('ko'). */
  language?: string
  audioStartMs: number
  /** Overrides global fetch (tests). */
  fetchImpl?: typeof fetch
}

/** Subset of the verbose_json response we rely on. */
export interface VerboseJson {
  text?: string
  language?: string
  duration?: number
  words?: { word: string; start: number; end: number }[]
  segments?: { text: string; start: number; end: number }[]
}

const LANG_CODES: Record<string, string> = {
  korean: 'ko', english: 'en', japanese: 'ja', chinese: 'zh', german: 'de', french: 'fr', spanish: 'es'
}

export function languageCode(lang?: string): string | undefined {
  if (!lang) return undefined
  const l = lang.toLowerCase()
  return LANG_CODES[l] ?? (l.length === 2 ? l : undefined)
}

/** Float32 mono PCM (-1..1) at 16 kHz -> 16-bit PCM WAV bytes. */
export function pcmToWav(pcm: Float32Array, rate = 16000): Uint8Array<ArrayBuffer> {
  const dataLen = pcm.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, dataLen, true)
  let off = 44
  for (let i = 0; i < pcm.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    v.setInt16(off, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true)
  }
  return new Uint8Array(buf)
}

/** verbose_json -> editor-clock Transcript. Word timestamps win; segment timestamps are the fallback. */
export function verboseJsonToTranscript(
  json: VerboseJson,
  ctx: { audioStartMs: number; sampleCount: number; language?: string },
  model: string
): Transcript {
  const language = json.language ?? ctx.language
  if (json.words && json.words.length > 0) {
    const chunks: Chunk[] = json.words.map((w) => ({ text: ` ${w.word}`, timestamp: [w.start, w.end] }))
    return toTranscript(json.text ?? '', chunks, { ...ctx, language }, model)
  }
  // No word timestamps: the API's own segments are the segments (no regrouping heuristics).
  const toMs = (s: number): number => Math.round(s * 1000) + ctx.audioStartMs
  const raw = json.segments && json.segments.length > 0
    ? json.segments
    : json.text
      ? [{ text: json.text, start: 0, end: json.duration ?? ctx.sampleCount / 16000 }]
      : []
  const segments = raw
    .map((s) => ({ start: toMs(s.start), end: Math.max(toMs(s.end), toMs(s.start) + 50), text: s.text.trim() }))
    .filter((s) => s.text.length > 0)
  return {
    text: (json.text ?? '').trim(),
    segments,
    audioStartMs: ctx.audioStartMs,
    durationMs: (ctx.sampleCount / 16000) * 1000,
    model,
    language: language ?? 'auto'
  }
}

export async function transcribeOpenAi(pcm16k: Float32Array, opts: OpenAiSttOptions): Promise<Transcript> {
  if (!opts.apiKey) throw new Error('클라우드 STT 키가 없습니다: 환경변수 BACKSEAT_STT_API_KEY를 설정하세요')
  const base = opts.apiBase.replace(/\/+$/, '')
  const form = new FormData()
  form.append('file', new Blob([pcmToWav(pcm16k)], { type: 'audio/wav' }), 'audio.wav')
  form.append('model', opts.model)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')
  const lang = languageCode(opts.language)
  if (lang) form.append('language', lang)
  const doFetch = opts.fetchImpl ?? fetch
  const res = await doFetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form
  })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`STT API ${res.status}: ${body || res.statusText}`)
  }
  const json = (await res.json()) as VerboseJson
  return verboseJsonToTranscript(
    json,
    { audioStartMs: opts.audioStartMs, sampleCount: pcm16k.length, language: opts.language },
    `${opts.model}@${new URL(base).host}`
  )
}
