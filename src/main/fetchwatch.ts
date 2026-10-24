// Watches for an MCP agent fetching a send (receipts written by backseat-mcp, src/main/mcp/receipts.ts)
// and reports it once, later than the send itself: the editor shows "AI가 자료를 가져갔어요" in place.
// For an MCP target a missing fetch becomes fetchTimedOut ("수신 미확인") after the wait window.
import type { DeliveryStatus } from '../shared/types'
import { pickFetch, readReceipts } from './mcp/receipts'

export const FETCH_WAIT_MS = 3 * 60_000
const POLL_MS = 1500

export interface FetchWatch {
  root: string
  sendId: string
  /** Registry id of the agent the send was meant for (meta.json recipient); absent = no MCP target. */
  recipientId?: string
  waitMs?: number
  pollMs?: number
  /** Called with the status additions: a fetch (expected or not), or the timeout. */
  onUpdate: (patch: Pick<DeliveryStatus, 'fetchedBy' | 'fetchTimedOut'> & { fetched: boolean }) => void
}

/** Start watching; returns a stop function. Stops by itself after the expected fetch or the wait window. */
export function watchFetch(w: FetchWatch): () => void {
  const deadline = Date.now() + (w.waitMs ?? FETCH_WAIT_MS)
  let stopped = false
  let reportedUnexpected = ''
  let timer: NodeJS.Timeout | null = null
  const stop = (): void => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
  const poll = async (): Promise<void> => {
    if (stopped) return
    const verdict = pickFetch(await readReceipts(w.root, w.sendId), w.sendId, w.recipientId)
    if (stopped) return
    if (verdict) {
      const r = verdict.receipt
      const fetchedBy = { agentId: r.agentId, name: r.name, cwd: r.cwd, at: r.at, tool: r.tool, expected: verdict.expected }
      if (verdict.expected) {
        w.onUpdate({ fetched: true, fetchedBy })
        stop()
        return
      }
      const key = `${r.agentId}|${r.at}`
      if (key !== reportedUnexpected) {
        reportedUnexpected = key
        // Another agent took it: shown apart, never as the intended agent's receipt.
        w.onUpdate({ fetched: false, fetchedBy })
        if (!w.recipientId) {
          stop()
          return
        }
      }
    }
    if (Date.now() >= deadline) {
      if (w.recipientId) w.onUpdate({ fetched: false, fetchTimedOut: true })
      stop()
      return
    }
    timer = setTimeout(() => void poll().catch(() => undefined), w.pollMs ?? POLL_MS)
    timer.unref?.()
  }
  void poll().catch(() => undefined)
  return stop
}
