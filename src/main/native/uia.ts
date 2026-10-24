// Main-process side of the UI Automation worker (src/main/native/uia-worker.ts). Every call has a deadline:
// when UIA does not answer (hung target, broken accessibility) the worker is replaced and the caller gets
// an error, which delivery reports as 'uiaUnavailable' instead of pasting blind. Calls that press a key carry
// an earlier deadline into the worker, so a worker that resumes after the caller gave up never presses it.
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { FocusInfo, PasteCheck, SoleInput } from './uia-types'
import type { UiaOp, UiaRequest, UiaResponse } from './uia-worker'

export type { FocusInfo, PasteCheck, SoleInput }

const DEFAULT_DEADLINE_MS = 2500
/** How much earlier than the caller's deadline the worker stops pressing keys. */
const KEY_MARGIN_MS = 700

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

let worker: Worker | null = null
let nextId = 1
/** Pending calls per worker: an old worker's exit fails only its own calls. */
const pending = new Map<Worker, Map<number, Pending>>()

function workerPath(): string {
  return join(__dirname, 'uia-worker.js')
}

export function uiaAvailable(): boolean {
  return process.platform === 'win32' && existsSync(workerPath())
}

function failAll(w: Worker, error: string): void {
  const mine = pending.get(w)
  if (!mine) return
  pending.delete(w)
  for (const p of mine.values()) {
    clearTimeout(p.timer)
    p.reject(new Error(error))
  }
}

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(workerPath())
  worker = w
  pending.set(w, new Map())
  w.on('message', (res: UiaResponse) => {
    const mine = pending.get(w)
    const p = mine?.get(res.id)
    if (!mine || !p) return
    mine.delete(res.id)
    clearTimeout(p.timer)
    if (res.ok) p.resolve(res.result)
    else p.reject(new Error(res.error ?? 'UI Automation failed'))
  })
  w.on('error', (err: Error) => {
    if (worker === w) worker = null
    failAll(w, err.message)
  })
  w.on('exit', () => {
    if (worker === w) worker = null
    failAll(w, 'UI Automation worker exited')
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
      pending.get(w)?.delete(id)
      reject(new Error('UI Automation did not answer in time'))
      // A stuck COM call cannot be cancelled: drop the worker, the next call starts a fresh one.
      if (worker === w) worker = null
      failAll(w, 'UI Automation worker replaced')
      void w.terminate()
    }, deadlineMs)
    pending.get(w)?.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
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

/** Focus the window's only usable text input through UIA, if it has exactly one and no password field. */
export function uiaFocusSoleInput(hwnd: number): Promise<SoleInput> {
  return ask<SoleInput>({ op: 'soleInput', hwnd }, 4000)
}

/** Ctrl+V, but only while `hwnd` is in front and the element from uiaInputCheck() still has the focus. */
export function uiaPasteIfUnchanged(hwnd: number): Promise<PasteCheck> {
  return ask<PasteCheck>({ op: 'paste', hwnd, deadlineAt: Date.now() + DEFAULT_DEADLINE_MS - KEY_MARGIN_MS })
}

/** Enter after a verified paste, under the same checks (same window in front, same element, no password field). */
export function uiaEnterIfUnchanged(hwnd: number): Promise<PasteCheck> {
  return ask<PasteCheck>({ op: 'enter', hwnd, deadlineAt: Date.now() + DEFAULT_DEADLINE_MS - KEY_MARGIN_MS })
}

export function uiaClear(): void {
  if (worker) void ask({ op: 'clear' }).catch(() => undefined)
}

export function stopUia(): void {
  const w = worker
  worker = null
  if (w) void w.terminate()
}
