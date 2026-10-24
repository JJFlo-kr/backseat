// Main-process side of the UI Automation worker (src/main/native/uia-worker.ts). Every call has a deadline:
// when UIA does not answer (hung target, broken accessibility) the worker is replaced and the caller gets
// an error, which delivery reports as 'uiaUnavailable' instead of pasting blind.
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { FocusInfo, PasteCheck, SoleInput } from './uia-types'
import type { UiaOp, UiaRequest, UiaResponse } from './uia-worker'

export type { FocusInfo, PasteCheck, SoleInput }

const DEFAULT_DEADLINE_MS = 2500

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function workerPath(): string {
  return join(__dirname, 'uia-worker.js')
}

export function uiaAvailable(): boolean {
  return process.platform === 'win32' && existsSync(workerPath())
}

function failAll(error: string): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(error))
    pending.delete(id)
  }
}

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(workerPath())
  worker = w
  w.on('message', (res: UiaResponse) => {
    const p = pending.get(res.id)
    if (!p) return
    pending.delete(res.id)
    clearTimeout(p.timer)
    if (res.ok) p.resolve(res.result)
    else p.reject(new Error(res.error ?? 'UI Automation failed'))
  })
  w.on('error', (err: Error) => {
    if (worker === w) worker = null
    failAll(err.message)
  })
  w.on('exit', () => {
    if (worker === w) worker = null
    failAll('UI Automation worker exited')
  })
  w.unref()
  return w
}

function ask<T>(op: UiaOp, deadlineMs = DEFAULT_DEADLINE_MS): Promise<T> {
  if (!uiaAvailable()) return Promise.reject(new Error('UI Automation is not available here'))
  return new Promise<T>((resolve, reject) => {
    const id = nextId++
    const w = getWorker()
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('UI Automation did not answer in time'))
      // A stuck COM call cannot be cancelled: drop the worker, the next call starts a fresh one.
      if (worker === w) worker = null
      void w.terminate()
    }, deadlineMs)
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    w.postMessage({ ...op, id } satisfies UiaRequest)
  })
}

/** The element that has the keyboard focus right now (null: nothing has it). */
export function uiaFocus(): Promise<FocusInfo | null> {
  return ask<FocusInfo | null>({ op: 'focus' })
}

/** Like uiaFocus(), and remembers the element for uiaPasteIfUnchanged(). */
export function uiaInputCheck(): Promise<FocusInfo | null> {
  return ask<FocusInfo | null>({ op: 'inputCheck' })
}

/** Focus the window's only usable text input through UIA, if it has exactly one. */
export function uiaFocusSoleInput(hwnd: number): Promise<SoleInput> {
  return ask<SoleInput>({ op: 'soleInput', hwnd }, 4000)
}

/** Ctrl+V, but only while `hwnd` is in front and the element from uiaInputCheck() still has the focus. */
export function uiaPasteIfUnchanged(hwnd: number): Promise<PasteCheck> {
  return ask<PasteCheck>({ op: 'paste', hwnd })
}

export function uiaClear(): void {
  if (worker) void ask({ op: 'clear' }).catch(() => undefined)
}

export function stopUia(): void {
  const w = worker
  worker = null
  if (w) void w.terminate()
}
