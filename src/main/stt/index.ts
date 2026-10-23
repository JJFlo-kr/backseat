// STT manager: one lazily-started worker, requests serialised by id, chunks turned
// into Segments on the editor clock.
import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { SttProgress, TranscribeRequest, TranscribeResult } from '../../shared/types'
import { toTranscript } from '../../shared/transcript'
import { loadSettings, sttApiKey } from '../config'
import { transcribeOpenAi } from './openai'
import type { WorkerOut } from './worker'

export const DEFAULT_MODEL = 'onnx-community/whisper-small_timestamped'

export function sttModel(): string {
  return process.env.BACKSEAT_STT_MODEL || DEFAULT_MODEL
}

export function modelCacheDir(): string {
  if (process.env.BACKSEAT_MODEL_CACHE) return process.env.BACKSEAT_MODEL_CACHE
  const dev = join(app.getAppPath(), '.cache', 'hf')
  if (existsSync(dev)) return dev
  return join(app.getPath('userData'), 'models')
}

let worker: Worker | null = null
let nextId = 1
interface PendingJob {
  resolve: (r: TranscribeResult) => void
  onProgress?: (p: SttProgress) => void
  req: TranscribeRequest
  /** Kept separately: the PCM buffer is transferred to the worker and becomes detached. */
  sampleCount: number
}
const pending = new Map<number, PendingJob>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(join(__dirname, 'stt-worker.js'), {
    workerData: { cacheDir: modelCacheDir(), model: sttModel() }
  })
  worker.on('message', (msg: WorkerOut) => {
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.type === 'progress') {
      p.onProgress?.({ stage: msg.stage, file: msg.file, progress: msg.progress })
    } else if (msg.type === 'result') {
      pending.delete(msg.id)
      const transcript = toTranscript(
        msg.text,
        msg.chunks,
        { audioStartMs: p.req.audioStartMs, sampleCount: p.sampleCount, language: p.req.language },
        msg.model
      )
      p.onProgress?.({ stage: 'done', message: `${transcript.segments.length} segments` })
      p.resolve({ ok: true, transcript, elapsedMs: msg.elapsedMs })
    } else {
      pending.delete(msg.id)
      p.onProgress?.({ stage: 'error', message: msg.message })
      p.resolve({ ok: false, error: msg.message })
    }
  })
  worker.on('error', (err: Error) => {
    for (const [id, p] of pending) {
      pending.delete(id)
      p.resolve({ ok: false, error: err.message })
    }
    worker = null
  })
  worker.on('exit', () => {
    worker = null
  })
  return worker
}

export type SttBackend = 'local' | 'openai'

/**
 * Speech recognition through the configured backend (settings.sttBackend, default 'local').
 * The cloud adapter needs BACKSEAT_STT_API_KEY in the environment; the key is never persisted.
 */
export async function transcribe(
  req: TranscribeRequest,
  onProgress?: (p: SttProgress) => void,
  override?: { backend?: SttBackend; apiBase?: string; apiKey?: string; model?: string }
): Promise<TranscribeResult> {
  const s = loadSettings()
  const backend = override?.backend ?? s.sttBackend
  if (backend !== 'openai') return transcribeLocal(req, onProgress)
  const t0 = Date.now()
  const apiBase = override?.apiBase ?? s.sttApiBase
  onProgress?.({ stage: 'transcribing', message: `클라우드 전사 중… (${apiBase})` })
  try {
    const transcript = await transcribeOpenAi(req.pcm16k, {
      apiBase,
      apiKey: override?.apiKey ?? sttApiKey(),
      model: override?.model ?? s.sttCloudModel,
      language: req.language ?? s.sttLanguage,
      audioStartMs: req.audioStartMs
    })
    onProgress?.({ stage: 'done', message: `${transcript.segments.length} segments` })
    return { ok: true, transcript, elapsedMs: Date.now() - t0 }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onProgress?.({ stage: 'error', message })
    return { ok: false, error: message, elapsedMs: Date.now() - t0 }
  }
}

export function transcribeLocal(req: TranscribeRequest, onProgress?: (p: SttProgress) => void): Promise<TranscribeResult> {
  return new Promise((resolve) => {
    const id = nextId++
    const pcm = req.pcm16k
    pending.set(id, { resolve, onProgress, req, sampleCount: pcm.length })
    try {
      getWorker().postMessage({ type: 'transcribe', id, pcm, language: req.language }, [pcm.buffer as ArrayBuffer])
    } catch (err) {
      pending.delete(id)
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}

export function stopStt(): void {
  void worker?.terminate()
  worker = null
}
