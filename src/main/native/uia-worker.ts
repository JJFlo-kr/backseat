// worker_threads entry (out/main/uia-worker.js): UI Automation queries off the main thread, in a COM MTA,
// so a slow or hung target app never blocks the Electron main process. See src/main/native/uia.ts.
import { parentPort } from 'worker_threads'
import { clearVerified, focusedInfo, focusSoleInput, initUia, inputCheck, pasteIfUnchanged } from './uia-com'

export type UiaOp =
  | { op: 'focus' }
  | { op: 'inputCheck' }
  | { op: 'soleInput'; hwnd: number }
  | { op: 'paste'; hwnd: number }
  | { op: 'clear' }

export type UiaRequest = UiaOp & { id: number }
export interface UiaResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

function run(req: UiaOp): unknown {
  initUia()
  switch (req.op) {
    case 'focus':
      return focusedInfo()
    case 'inputCheck':
      return inputCheck()
    case 'soleInput':
      return focusSoleInput(req.hwnd)
    case 'paste':
      return pasteIfUnchanged(req.hwnd)
    case 'clear':
      clearVerified()
      return null
  }
}

parentPort?.on('message', (req: UiaRequest) => {
  let res: UiaResponse
  try {
    res = { id: req.id, ok: true, result: run(req) }
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  parentPort?.postMessage(res)
})
