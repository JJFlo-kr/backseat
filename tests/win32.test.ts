// The process-parent snapshot behind the MCP agent check (Codex review F03). Windows only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installFakeElectron } from './support/fake-electron.ts'

installFakeElectron()
const { processParents } = await import('../src/main/native/win32.ts')

test('processParents() knows this process and its parent', { skip: process.platform !== 'win32' }, () => {
  const parents = processParents()
  assert.ok(parents.size > 10)
  assert.equal(parents.get(process.pid), process.ppid)
})
