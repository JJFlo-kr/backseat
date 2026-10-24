// Phase 4 (request (2) ②): a fetch counts only for the exact send id, and as "expected" only when the
// intended agent fetched it; another agent is reported apart; no fetch within the wait window is a timeout
// (MCP targets only). src/main/mcp/receipts.ts + src/main/fetchwatch.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSendId, pickFetch, readReceipts, receiptsDir, writeReceipt, type FetchReceipt } from '../src/main/mcp/receipts.ts'
import { watchFetch } from '../src/main/fetchwatch.ts'

const ID = '20261025-101500-123-ab12'
const OTHER = '20261025-101501-456-cd34'
const rec = (over: Partial<FetchReceipt>): FetchReceipt => ({
  sendId: ID, agentId: '9001', name: 'Claude Code', cwd: 'D:\\backseat', tool: 'backseat_get', at: new Date().toISOString(), mcpPid: 9001, ...over
})

test('send ids: only package ids, so a receipt path can never escape the receipts folder', () => {
  assert.equal(isSendId(ID), true)
  assert.equal(isSendId('20261025-101500'), true, 'packages from before 0.4.1')
  for (const bad of ['..', '../x', 'a/b', '20261025-101500-123-ab12/../..', '', 'latest']) assert.equal(isSendId(bad), false, bad)
})

test('written receipts are read back per send id only; foreign or broken files are ignored', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bs-receipts-'))
  await writeReceipt(root, rec({}))
  await writeReceipt(root, rec({ sendId: OTHER, agentId: '9002' }))
  await writeReceipt(root, rec({ sendId: '../evil' }))
  writeFileSync(join(receiptsDir(root, ID), 'broken.json'), '{')
  writeFileSync(join(receiptsDir(root, ID), 'foreign.json'), JSON.stringify(rec({ sendId: OTHER })))
  const mine = await readReceipts(root, ID)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].agentId, '9001')
  assert.deepEqual(await readReceipts(root, '../evil'), [])
})

test('pickFetch: the intended agent is expected; another agent is shown as not expected; other ids never count', () => {
  const a = rec({ agentId: '9002', name: 'Codex', at: '2026-10-25T01:00:00.000Z' })
  const b = rec({ agentId: '9001', at: '2026-10-25T01:00:05.000Z' })
  assert.deepEqual(pickFetch([a, b], ID, '9001'), { receipt: b, expected: true })
  assert.deepEqual(pickFetch([a], ID, '9001'), { receipt: a, expected: false })
  assert.deepEqual(pickFetch([a], ID), { receipt: a, expected: false }, 'no recipient: nobody is "the" agent')
  assert.equal(pickFetch([rec({ sendId: OTHER })], ID, '9001'), null)
  assert.equal(pickFetch([], ID, '9001'), null)
})

test('watchFetch: reports the expected fetch once and stops', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bs-watch-'))
  const updates: unknown[] = []
  const done = new Promise<void>((resolve) => {
    watchFetch({ root, sendId: ID, recipientId: '9001', pollMs: 20, waitMs: 5000, onUpdate: (u) => { updates.push(u); if (u.fetched) resolve() } })
  })
  setTimeout(() => void writeReceipt(root, rec({})), 60)
  await done
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(updates.length, 1)
  const u = updates[0] as { fetched: boolean; fetchedBy: { expected: boolean; tool: string } }
  assert.equal(u.fetched, true)
  assert.equal(u.fetchedBy.expected, true)
  assert.equal(u.fetchedBy.tool, 'backseat_get')
})

test('watchFetch: another agent only -> reported as not expected, then the timeout for an MCP target', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bs-watch2-'))
  mkdirSync(join(root, 'receipts'), { recursive: true })
  await writeReceipt(root, rec({ agentId: '7777', name: 'Other' }))
  const updates: { fetched: boolean; fetchTimedOut?: boolean; fetchedBy?: { expected: boolean } }[] = []
  await new Promise<void>((resolve) => {
    watchFetch({ root, sendId: ID, recipientId: '9001', pollMs: 20, waitMs: 150, onUpdate: (u) => { updates.push(u); if (u.fetchTimedOut) resolve() } })
  })
  assert.equal(updates[0].fetched, false)
  assert.equal(updates[0].fetchedBy?.expected, false)
  assert.equal(updates.at(-1)?.fetchTimedOut, true)
  assert.ok(updates.every((u) => !u.fetched))
})

test('watchFetch: no MCP target and nobody fetches -> silent (no timeout status)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bs-watch3-'))
  const updates: unknown[] = []
  watchFetch({ root, sendId: ID, pollMs: 20, waitMs: 100, onUpdate: (u) => updates.push(u) })
  await new Promise((r) => setTimeout(r, 250))
  assert.deepEqual(updates, [])
})
