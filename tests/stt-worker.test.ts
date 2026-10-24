// Codex review F11: every pending transcription settles when its worker errors, exits or is terminated,
// and a later worker never settles an older worker's jobs. Real src/main/stt/index.ts, fake Worker.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { installFakeElectron } from './support/fake-electron.ts'

installFakeElectron()

class FakeWorker extends EventEmitter {
  static all: FakeWorker[] = []
  posted: { id: number }[] = []
  terminated = false
  constructor() {
    super()
    FakeWorker.all.push(this)
  }
  postMessage(msg: { id: number }): void {
    this.posted.push(msg)
  }
  terminate(): Promise<number> {
    this.terminated = true
    // Like worker_threads: terminate() ends in an 'exit' event.
    setImmediate(() => this.emit('exit', 1))
    return Promise.resolve(1)
  }
}

mock.module('worker_threads', { exports: { Worker: FakeWorker } })

const { transcribeLocal, stopStt } = await import('../src/main/stt/index.ts')

const req = () => ({ pcm16k: new Float32Array(160), audioStartMs: 0, language: 'korean' })

/** Resolves to 'pending' when the promise is still open after a few ticks. */
async function settled<T>(p: Promise<T>, ms = 100): Promise<T | 'pending'> {
  return Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), ms))])
}

test('a worker that exits without an error fails its pending jobs', async () => {
  const job = transcribeLocal(req())
  const w = FakeWorker.all.at(-1)!
  w.emit('exit', 0)
  const r = await settled(job)
  assert.notEqual(r, 'pending', 'job still waiting after the worker exited')
  assert.equal(r !== 'pending' && r.ok, false)
})

test('stopStt() while a job is pending fails that job', async () => {
  const job = transcribeLocal(req())
  stopStt()
  const r = await settled(job)
  assert.notEqual(r, 'pending')
  assert.equal(r !== 'pending' && r.ok, false)
})

test("a new worker's error does not settle jobs of the old worker twice / the next job still works", async () => {
  const first = transcribeLocal(req())
  const w1 = FakeWorker.all.at(-1)!
  w1.emit('exit', 0)
  assert.notEqual(await settled(first), 'pending')
  // Next request starts a fresh worker and is answered normally.
  const second = transcribeLocal(req())
  const w2 = FakeWorker.all.at(-1)!
  assert.notEqual(w2, w1)
  const id = w2.posted.at(-1)!.id
  w2.emit('message', { type: 'result', id, text: '안녕', chunks: [{ text: '안녕', timestamp: [0, 0.5] }], model: 'fake', elapsedMs: 1 })
  const r = await settled(second)
  assert.notEqual(r, 'pending')
  assert.equal(r !== 'pending' && r.ok, true)
  // A late event from the dead worker must not touch anything.
  w1.emit('error', new Error('late'))
})
