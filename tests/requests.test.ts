// Codex review F07: a backseat_ask question answered from its notification must not be attached to the
// next ordinary capture. Real src/main/requests.ts with a fake Notification.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeNotification, installFakeElectron } from './support/fake-electron.ts'
import type { AskRequest } from '../src/shared/types.ts'

const fake = installFakeElectron()
const requests = await import('../src/main/requests.ts')

// What startCapture() does with the (optional) request it was started with. Before the fix it was
// `request ?? takePendingRequest()` inline in src/main/index.ts.
const forCapture: (r?: AskRequest) => AskRequest | undefined =
  (requests as { requestForCapture?: (r?: AskRequest) => AskRequest | undefined }).requestForCapture ??
  ((r) => r ?? requests.takePendingRequest() ?? undefined)

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

test('notification click answers the question once; the next capture has no request', async (t) => {
  const root = join(fake.base, 'sessions')
  const clicked: AskRequest[] = []
  await requests.startRequestWatcher(root, (r) => clicked.push(r))
  t.after(() => requests.stopRequestWatcher())
  mkdirSync(join(root, 'requests'), { recursive: true })
  const r: AskRequest = { requestId: '1760000000000-42', question: '어느 버튼?', agent: 'Claude Code', createdAt: new Date().toISOString() }
  writeFileSync(join(root, 'requests', `${r.requestId}.json`), JSON.stringify(r), 'utf8')
  await until(() => FakeNotification.created.length > 0)
  FakeNotification.created[0].emit('click')
  assert.equal(clicked.length, 1)

  assert.equal(forCapture(clicked[0])?.requestId, r.requestId, 'the capture started from the notification answers it')
  assert.equal(forCapture(undefined), undefined, 'an ordinary capture afterwards must not carry the old question')
})

test('a pending question is used by the next capture exactly once', async (t) => {
  const root = join(fake.base, 'sessions2')
  await requests.startRequestWatcher(root, () => undefined)
  t.after(() => requests.stopRequestWatcher())
  const r: AskRequest = { requestId: '1760000000001-42', question: 'q', agent: 'a', createdAt: new Date().toISOString() }
  writeFileSync(join(root, 'requests', `${r.requestId}.json`), JSON.stringify(r), 'utf8')
  await until(() => requests.peekPendingRequest()?.requestId === r.requestId)
  assert.equal(forCapture(undefined)?.requestId, r.requestId)
  assert.equal(forCapture(undefined), undefined)
})
