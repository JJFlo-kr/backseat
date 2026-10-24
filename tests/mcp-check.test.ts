// Codex review F14: the MCP contract checker must fail (exit != 0, no MCP_OK) against a wrong server.
// The positive run against the real server needs a build: `npm run mcp-check` (also in CI).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))

test('mcp-check rejects a server that answers with the wrong contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'backseat-mcp-wrong-'))
  const r = spawnSync(process.execPath, [join(repo, 'scripts', 'mcp-check.mjs'), root, join(repo, 'tests', 'fixtures', 'wrong-mcp-server.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 90_000
  })
  assert.notEqual(r.status, 0, `exit code must be non-zero\n${r.stdout}\n${r.stderr}`)
  assert.doesNotMatch(r.stdout, /MCP_OK/)
  assert.match(r.stdout, /FAIL /)
})
