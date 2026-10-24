// Codex review F06: concurrent backseat_register calls from two MCP processes must both survive.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneRegistry, readRegistry, registerAgent, unregisterAgent } from '../src/main/mcp/registry.ts'

// Two pids that are certainly alive: this test process and its parent.
const A = process.pid
const B = process.ppid

test('two agents registering at the same moment are both kept', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backseat-reg-'))
  await Promise.all([
    registerAgent(root, { name: 'Claude Code', kind: 'claude-code', cwd: 'D:/a', pid: A }),
    registerAgent(root, { name: 'Cursor', kind: 'cursor', cwd: 'D:/b', pid: B })
  ])
  const agents = await readRegistry(root)
  assert.deepEqual(agents.map((a) => a.pid).sort(), [A, B].sort())
})

test('many concurrent register / unregister calls keep exactly the live registrations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backseat-reg-'))
  const ops: Promise<unknown>[] = []
  for (let i = 0; i < 10; i++) {
    ops.push(registerAgent(root, { name: `a${i}`, kind: 'other', cwd: 'D:/a', pid: A }))
    ops.push(registerAgent(root, { name: `b${i}`, kind: 'other', cwd: 'D:/b', pid: B }))
    ops.push(pruneRegistry(root))
  }
  await Promise.all(ops)
  assert.equal((await pruneRegistry(root)).length, 2)
  await unregisterAgent(root, String(A))
  assert.deepEqual((await readRegistry(root)).map((a) => a.pid), [B])
})

test('the pre-0.4 registry.json is still read, and dead pids are pruned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backseat-reg-'))
  const old = (pid: number, name: string) => ({ id: `${pid}`, name, kind: 'claude-code', cwd: 'D:/old', pid, registeredAt: '2026-01-01T00:00:00.000Z', lastSeen: '2026-01-01T00:00:00.000Z' })
  await writeFile(join(root, 'registry.json'), JSON.stringify({ agents: [old(A, 'old server'), old(2 ** 31 - 2, 'gone')] }), 'utf8')
  assert.equal((await readRegistry(root)).length, 2)
  const live = await pruneRegistry(root)
  assert.deepEqual(live.map((a) => a.name), ['old server'])
})
