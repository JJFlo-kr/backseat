// Codex review F02 (unique packages), F04 (published only when complete), F08 (one sessions root).
// Runs the real src/main/sessions.ts against a fake 'electron' and a slowed-down fs.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
// Through require: an ESM import of fs/promises here would load it before mock.module() can replace it.
const realFs = createRequire(import.meta.url)('fs/promises') as typeof import('node:fs/promises')
// Captured now: mock.module() patches the builtin's exports object in place.
const realWriteFile = realFs.writeFile
const realReadFile = realFs.readFile
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { installFakeElectron } from './support/fake-electron.ts'
import type { AgentTarget, ExportPayload } from '../src/shared/types.ts'

const fake = installFakeElectron()
const custom = join(fake.base, 'custom-sessions')
mkdirSync(join(fake.base, 'userData'), { recursive: true })
writeFileSync(join(fake.base, 'userData', 'config.json'), JSON.stringify({ version: 2, sessionsRoot: custom }), 'utf8')

/** Writes whose path ends with one of these names wait until released (F04: a slow annotated.png). */
const slow = new Map<string, Promise<void>>()
mock.module('fs/promises', {
  exports: {
    ...realFs,
    default: realFs,
    writeFile: async (file: string, ...rest: unknown[]) => {
      for (const [name, gate] of slow) if (String(file).endsWith(name)) await gate
      return (realWriteFile as (...a: unknown[]) => Promise<void>)(file, ...rest)
    }
  }
})

const { writeSessionPackage, sessionsRoot } = await import('../src/main/sessions.ts')

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const payload = (memo: string, extra: Partial<ExportPayload> = {}): ExportPayload => ({
  pngDataUrl: PNG,
  basePngDataUrl: PNG,
  memo,
  annotations: [],
  meta: {
    capturedAt: '2026-10-25T10:00:00.000Z',
    displayId: 0,
    scaleFactor: 1,
    rectDip: { x: 0, y: 0, width: 1, height: 1 },
    rectPx: { x: 0, y: 0, width: 1, height: 1 },
    mode: 'rect'
  },
  ...extra
})

let n = 0
const freshRoot = (): string => join(fake.base, `root-${n++}`)
const published = (root: string): string[] =>
  existsSync(root) ? readdirSync(root).filter((d) => /^\d{8}-\d{6}/.test(d)) : []

test('F02: two sends in the same second get different folders and the first one is not overwritten', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-25T10:00:00.000Z') })
  const root = freshRoot()
  const a = await writeSessionPackage(payload('first', { audio: { bytes: new Uint8Array([1, 2]), mimeType: 'audio/webm' } }), null, root)
  const b = await writeSessionPackage(payload('second'), null, root)
  assert.notEqual(a.dir, b.dir)
  assert.notEqual(a.id, b.id)
  const metaA = JSON.parse(await realReadFile(join(a.dir, 'meta.json'), 'utf8')) as { memo: string; files: string[] }
  assert.equal(metaA.memo, 'first')
  assert.ok(metaA.files.includes('audio.webm'))
  assert.match(await realReadFile(a.briefMd, 'utf8'), /first/)
  assert.equal(published(root).length, 2)
})

test('F02: concurrent sends from several editors at the same instant stay separate', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-25T10:00:00.000Z') })
  const root = freshRoot()
  const pkgs = await Promise.all([0, 1, 2, 3, 4].map((i) => writeSessionPackage(payload(`editor ${i}`), null, root)))
  assert.equal(new Set(pkgs.map((p) => p.dir)).size, 5)
  for (const [i, p] of pkgs.entries()) {
    const meta = JSON.parse(await realReadFile(p.metaJson, 'utf8')) as { id: string; memo: string }
    assert.equal(meta.memo, `editor ${i}`)
    assert.equal(meta.id, p.id)
  }
})

test('F04: while annotated.png is still being written no package folder is visible', async () => {
  const root = freshRoot()
  let release!: () => void
  slow.set('annotated.png', new Promise<void>((r) => (release = r)))
  try {
    const writing = writeSessionPackage(payload('slow'), null, root)
    // Let every other write finish first.
    await new Promise((r) => setTimeout(r, 150))
    const early = published(root).filter((d) => existsSync(join(root, d, 'meta.json')) || existsSync(join(root, d, 'brief.md')))
    assert.deepEqual(early, [], 'meta.json / brief.md must not be visible before annotated.png is written')
    release()
    const pkg = await writing
    for (const f of [pkg.annotatedPng, pkg.briefMd, pkg.metaJson, pkg.strokesJson]) assert.ok(existsSync(f), f)
    assert.equal((await realReadFile(join(root, 'latest.txt'), 'utf8')).trim(), pkg.dir)
  } finally {
    slow.delete('annotated.png')
    release?.()
  }
})

test('F04: a failed write leaves no half package behind', async () => {
  const root = freshRoot()
  let fail!: (e: Error) => void
  slow.set('strokes.json', new Promise<void>((_r, j) => (fail = j)))
  try {
    const writing = writeSessionPackage(payload('broken'), null, root)
    await new Promise((r) => setTimeout(r, 50))
    fail(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }))
    await assert.rejects(writing, /ENOSPC/)
    assert.deepEqual(published(root), [])
    assert.deepEqual(readdirSync(root).filter((d) => d.startsWith('.')), [], 'staging folder removed')
  } finally {
    slow.delete('strokes.json')
  }
})

test('F08: the writer uses the sessions root from config.json', async () => {
  const { loadSettings } = await import('../src/main/config.ts')
  assert.equal(loadSettings().sessionsRoot, custom)
  assert.equal(sessionsRoot(), custom)
  const pkg = await writeSessionPackage(payload('custom root'), null)
  assert.ok(pkg.dir.startsWith(custom), pkg.dir)
})

test('F03: the MCP agent a package was handed to is recorded as its recipient', async () => {
  const root = freshRoot()
  const target: AgentTarget = {
    kind: 'claude-code', label: 'T', hwnd: 5, title: 'T', process: 'WindowsTerminal.exe', method: 'paste-path', confidence: 0.9,
    mcp: { id: '900', name: 'Claude Code', cwd: 'D:/work/backseat' }
  }
  const pkg = await writeSessionPackage(payload('to mcp'), target, root)
  const meta = JSON.parse(await realReadFile(pkg.metaJson, 'utf8')) as { recipient?: unknown }
  assert.deepEqual(meta.recipient, { agentId: '900', name: 'Claude Code', cwd: 'D:/work/backseat' })
  const plain = await writeSessionPackage(payload('to anyone'), null, root)
  assert.equal((JSON.parse(await realReadFile(plain.metaJson, 'utf8')) as { recipient?: unknown }).recipient, undefined)
})
