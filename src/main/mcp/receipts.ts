// Fetch receipts (plan 2026-10-25 §3 phase 4): when backseat-mcp hands a session package to an agent, it
// records who fetched which send id, so the app can show "AI가 자료를 가져갔어요" — and nothing more: a
// receipt says the data was fetched, not that it was read, understood or acted on.
// <root>/receipts/<sendId>/<agent>-<ms>-<rand>.json, one file per fetch, each written atomically (no shared
// file is ever rewritten, so concurrent agents cannot lose each other's receipts). Plain Node.
import { randomBytes } from 'crypto'
import { mkdir, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '../fsutil'

export interface FetchReceipt {
  sendId: string
  /** Registry id of the fetching agent ('' when it never called backseat_register). */
  agentId: string
  name: string
  cwd: string
  /** backseat_get / backseat_latest / backseat_wait / backseat_ask */
  tool: string
  at: string
  /** pid of the backseat-mcp process that served it. */
  mcpPid: number
}

/** Session ids as written by src/main/sessions.ts (older ones lack the ms / random parts). */
const SEND_ID = /^\d{8}-\d{6}(-\d{3}-[0-9a-f]{4})?$/

export function isSendId(id: string): boolean {
  return SEND_ID.test(id)
}

export function receiptsDir(root: string, sendId: string): string {
  return join(root, 'receipts', sendId)
}

export async function writeReceipt(root: string, r: FetchReceipt): Promise<void> {
  if (!isSendId(r.sendId)) return
  const dir = receiptsDir(root, r.sendId)
  await mkdir(dir, { recursive: true })
  const who = (r.agentId || `mcp${r.mcpPid}`).replace(/[^\w.-]/g, '_')
  await writeFileAtomic(join(dir, `${who}-${Date.now()}-${randomBytes(2).toString('hex')}.json`), JSON.stringify(r, null, 2))
}

function isReceipt(v: unknown): v is FetchReceipt {
  const r = v as Partial<FetchReceipt> | null
  return Boolean(r) && typeof r?.sendId === 'string' && typeof r.agentId === 'string' && typeof r.tool === 'string' && typeof r.at === 'string'
}

/** Every receipt of one send, oldest first. Unreadable or foreign files are skipped. */
export async function readReceipts(root: string, sendId: string): Promise<FetchReceipt[]> {
  if (!isSendId(sendId)) return []
  let names: string[]
  try {
    names = await readdir(receiptsDir(root, sendId))
  } catch {
    return []
  }
  const out: FetchReceipt[] = []
  for (const n of names) {
    if (!n.endsWith('.json') || n.endsWith('.tmp')) continue
    try {
      const r = JSON.parse(await readFile(join(receiptsDir(root, sendId), n), 'utf8')) as unknown
      if (isReceipt(r) && r.sendId === sendId) out.push(r)
    } catch {
      /* being written; the next poll sees it */
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

export interface FetchVerdict {
  receipt: FetchReceipt
  /** The agent this send was meant for (meta.json recipient) fetched it. */
  expected: boolean
}

/**
 * The receipt to show: the intended recipient's when there is one, else the first other agent's
 * (shown as "another agent fetched it"). null = nobody fetched this send id yet.
 */
export function pickFetch(receipts: readonly FetchReceipt[], sendId: string, recipientId?: string): FetchVerdict | null {
  const mine = receipts.filter((r) => r.sendId === sendId)
  if (recipientId) {
    const expected = mine.find((r) => r.agentId === recipientId)
    if (expected) return { receipt: expected, expected: true }
  }
  return mine[0] ? { receipt: mine[0], expected: false } : null
}
