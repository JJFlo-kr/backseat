// Speech-recognition worker: keeps a Whisper pipeline (transformers.js, ONNX) warm
// off the main thread. Protocol: see WorkerIn / WorkerOut.
import { parentPort, workerData } from 'worker_threads'
import type { Chunk } from '../../shared/transcript'
export type { Chunk }

export interface WorkerIn {
  type: 'transcribe'
  id: number
  pcm: Float32Array
  language?: string
}

export type WorkerOut =
  | { type: 'progress'; id: number; stage: 'loading' | 'downloading' | 'transcribing'; file?: string; progress?: number }
  | { type: 'result'; id: number; text: string; chunks: Chunk[]; elapsedMs: number; model: string }
  | { type: 'error'; id: number; message: string }

interface WorkerData {
  cacheDir: string
  model: string
}

interface AsrOutput {
  text: string
  chunks?: Chunk[]
}

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput | AsrOutput[]>

interface ProgressEvent {
  status: string
  file?: string
  progress?: number
}

interface TransformersModule {
  env: { cacheDir: string; allowRemoteModels: boolean }
  pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<Asr>
}

const data = workerData as WorkerData
const port = parentPort
if (!port) throw new Error('stt worker needs a parent port')

let asrPromise: Promise<Asr> | null = null

function post(msg: WorkerOut): void {
  port?.postMessage(msg)
}

async function loadPipeline(id: number): Promise<Asr> {
  if (asrPromise) return asrPromise
  asrPromise = (async () => {
    post({ type: 'progress', id, stage: 'loading' })
    // Dynamic import keeps the worker tiny when STT is never used.
    const tf = (await import('@huggingface/transformers')) as unknown as TransformersModule
    tf.env.cacheDir = data.cacheDir
    const asr = await tf.pipeline('automatic-speech-recognition', data.model, {
      progress_callback: (p: ProgressEvent) => {
        if (p.status === 'progress' || p.status === 'download') {
          post({ type: 'progress', id, stage: 'downloading', file: p.file, progress: p.progress })
        }
      }
    })
    return asr
  })()
  asrPromise.catch(() => {
    asrPromise = null
  })
  return asrPromise
}

port.on('message', async (msg: WorkerIn) => {
  if (msg.type !== 'transcribe') return
  const t0 = Date.now()
  try {
    const asr = await loadPipeline(msg.id)
    post({ type: 'progress', id: msg.id, stage: 'transcribing' })
    const opts: Record<string, unknown> = {
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: 30
    }
    if (msg.language) opts.language = msg.language
    let out: AsrOutput
    try {
      const r = await asr(msg.pcm, opts)
      out = Array.isArray(r) ? r[0] : r
    } catch (err) {
      // Models exported without cross-attentions cannot do word timestamps: fall back to segments.
      if (!String(err).includes('cross attentions')) throw err
      const r = await asr(msg.pcm, { ...opts, return_timestamps: true })
      out = Array.isArray(r) ? r[0] : r
    }
    post({
      type: 'result',
      id: msg.id,
      text: out.text ?? '',
      chunks: out.chunks ?? [],
      elapsedMs: Date.now() - t0,
      model: data.model
    })
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
})
