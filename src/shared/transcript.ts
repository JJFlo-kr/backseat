// Pure conversion from Whisper output chunks to editor-clock Segments. No Electron.
import type { Segment, Transcript, Word } from './types.ts'

/** One chunk as returned by transformers.js: a word (word timestamps) or a sentence (segment timestamps). */
export interface Chunk {
  text: string
  timestamp: [number, number | null]
}

export interface ChunkContext {
  /** Editor-clock ms when the audio started. */
  audioStartMs: number
  /** Samples at 16 kHz, for the duration. */
  sampleCount: number
  language?: string
}

const SENTENCE_END = /[.?!…。？！]$/
export const PAUSE_MS = 700

/** Word chunks -> sentence-ish segments; segment-level chunks pass through. */
export function toTranscript(text: string, chunks: Chunk[], ctx: ChunkContext, model: string): Transcript {
  const base = ctx.audioStartMs
  const durationMs = (ctx.sampleCount / 16000) * 1000
  const toMs = (s: number | null, fallback: number): number => Math.round((s ?? fallback) * 1000) + base

  const words: Word[] = chunks
    .map((c) => {
      const start = toMs(c.timestamp[0], 0)
      const end = toMs(c.timestamp[1], (c.timestamp[0] ?? 0) + 0.3)
      return { start, end: Math.max(end, start + 50), text: c.text.trim() }
    })
    .filter((w) => w.text.length > 0)

  // Chunks that each hold several words (or span long) are already segments.
  const looksLikeSegments =
    chunks.length > 0 &&
    chunks.every((c) => c.text.trim().split(/\s+/).length > 2 || (c.timestamp[1] ?? 0) - (c.timestamp[0] ?? 0) > 2.5)

  const segments: Segment[] = []
  if (looksLikeSegments) {
    for (const w of words) segments.push({ start: w.start, end: w.end, text: w.text })
  } else {
    let cur: Segment | null = null
    for (const w of words) {
      const breakHere = cur !== null && (w.start - cur.end > PAUSE_MS || SENTENCE_END.test(cur.text))
      if (!cur || breakHere) {
        cur = { start: w.start, end: w.end, text: w.text, words: [w] }
        segments.push(cur)
      } else {
        cur.end = w.end
        // Whisper splits "1.5배" into "1" + ".5배": glue punctuation-led pieces back on.
        const glue = /^[.,!?%)\]”’]/.test(w.text) ? '' : ' '
        cur.text = `${cur.text}${glue}${w.text}`
        cur.words?.push(w)
      }
    }
  }
  return { text: text.trim(), segments, audioStartMs: base, durationMs, model, language: ctx.language ?? 'auto' }
}
