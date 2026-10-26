// The session package with applied UI/UX guidance: design-request.json, design-preview.png only when valid,
// previewRef never pointing at a missing file, annotated.png / screenshot.png untouched, and a package without
// guidance exactly as before. Runs the real src/main/sessions.ts against a fake 'electron'.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { installFakeElectron } from './support/fake-electron.ts'
import type { ExportPayload } from '../src/shared/types.ts'
import type { DesignRequest } from '../src/shared/uiux/types.ts'

const fake = installFakeElectron()
mkdirSync(join(fake.base, 'userData'), { recursive: true })
writeFileSync(join(fake.base, 'userData', 'config.json'), JSON.stringify({ version: 2, sessionsRoot: join(fake.base, 'sessions') }), 'utf8')
const { writeSessionPackage } = await import('../src/main/sessions.ts')

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 1
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))])
}
const url = (b: Buffer): string => `data:image/png;base64,${b.toString('base64')}`

const CAPTURE = png(4, 4)
const SHOT = png(5, 5)
const request: DesignRequest = {
  schemaVersion: 1,
  projectId: 'p1',
  projectName: 'Shop admin',
  scope: { kind: 'all' },
  resolved: {} as DesignRequest['resolved'],
  changes: [{ path: 'colors.primary', from: '#111111', to: '#222222' }],
  preserve: [],
  locks: [],
  checks: [{ id: 'c', kind: 'runtime', label: 'Focus ring', status: 'unverified' }],
  previewRef: 'design-preview.png',
  createdAt: '2026-10-27T10:00:00.000Z'
}
const payload = (extra: Partial<ExportPayload> = {}): ExportPayload => ({
  pngDataUrl: url(CAPTURE),
  basePngDataUrl: url(SHOT),
  memo: '',
  annotations: [],
  meta: { capturedAt: '2026-10-27T10:00:00.000Z', displayId: 0, scaleFactor: 1, rectDip: { x: 0, y: 0, width: 1, height: 1 }, rectPx: { x: 0, y: 0, width: 1, height: 1 }, mode: 'rect' },
  ...extra
})

let n = 0
const root = (): string => join(fake.base, `root-${n++}`)
const files = (dir: string): string[] => readdirSync(dir).sort()
const json = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

test('guidance without a mock-up: design-request.json is written and carries no previewRef', async () => {
  const pkg = await writeSessionPackage(payload({ uiux: { request } }), null, root())
  assert.deepEqual(files(pkg.dir), ['annotated.png', 'brief.md', 'design-request.json', 'meta.json', 'screenshot.png', 'strokes.json'])
  const written = json(join(pkg.dir, 'design-request.json'))
  assert.equal(written.previewRef, undefined, 'a given previewRef is dropped when no file is written')
  assert.deepEqual(written, JSON.parse(JSON.stringify({ ...request, previewRef: undefined })), 'the request is written as given')
  assert.match(readFileSync(join(pkg.dir, 'design-request.json'), 'utf8'), /\n  "projectId": "p1"/, 'pretty JSON')
  assert.ok(pkg.designRequestJson?.endsWith('design-request.json'))
  assert.equal(pkg.designPreviewPng, undefined)
  const meta = json(join(pkg.dir, 'meta.json'))
  assert.ok((meta.files as string[]).includes('design-request.json'))
  assert.equal(meta.uiux, undefined)
  assert.match(readFileSync(pkg.briefMd, 'utf8'), /## .*[Uu][Ii]\/[Uu][Xx]|brief\.uiux\.heading/)
})

test('a valid mock-up is written as design-preview.png next to untouched captures', async () => {
  const mock = png(300, 200)
  const pkg = await writeSessionPackage(payload({ uiux: { request: { ...request, previewRef: undefined }, previewPngDataUrl: url(mock) } }), null, root())
  assert.deepEqual(files(pkg.dir), ['annotated.png', 'brief.md', 'design-preview.png', 'design-request.json', 'meta.json', 'screenshot.png', 'strokes.json'])
  assert.deepEqual(readFileSync(join(pkg.dir, 'design-preview.png')), mock)
  assert.deepEqual(readFileSync(join(pkg.dir, 'annotated.png')), CAPTURE, 'the capture is never overwritten')
  assert.deepEqual(readFileSync(join(pkg.dir, 'screenshot.png')), SHOT)
  assert.equal(json(join(pkg.dir, 'design-request.json')).previewRef, 'design-preview.png')
  assert.ok(pkg.designPreviewPng?.endsWith('design-preview.png'))
  assert.ok((json(join(pkg.dir, 'meta.json')).files as string[]).includes('design-preview.png'))
})

test('an invalid mock-up is not written, the ref is dropped and the reason is recorded', async () => {
  const bad: Record<string, string> = {
    prefix: 'data:image/jpeg;base64,' + png(2, 2).toString('base64'),
    signature: url(Buffer.from('definitely not a png file, only text')),
    dimensions: url(png(0, 7)),
    tooLarge: url(Buffer.concat([png(2, 2), Buffer.alloc(10 * 1024 * 1024)]))
  }
  for (const [reason, dataUrl] of Object.entries(bad)) {
    const pkg = await writeSessionPackage(payload({ uiux: { request, previewPngDataUrl: dataUrl } }), null, root())
    assert.equal(existsSync(join(pkg.dir, 'design-preview.png')), false, reason)
    assert.equal(json(join(pkg.dir, 'design-request.json')).previewRef, undefined, `${reason}: never reference a missing file`)
    assert.equal((json(join(pkg.dir, 'meta.json')).uiux as { previewRejected: string }).previewRejected, reason)
    assert.equal(pkg.designPreviewPng, undefined)
    assert.equal(readdirSync(join(pkg.dir, '..')).filter((d) => d.startsWith('.writing-')).length, 0, 'published, nothing left in staging')
  }
})

test('a package without guidance has no UI/UX files or meta entry', async () => {
  const pkg = await writeSessionPackage(payload({ memo: 'bigger button' }), null, root())
  assert.deepEqual(files(pkg.dir), ['annotated.png', 'brief.md', 'meta.json', 'screenshot.png', 'strokes.json'])
  const meta = json(join(pkg.dir, 'meta.json'))
  assert.equal('uiux' in meta, false)
  assert.doesNotMatch(readFileSync(pkg.briefMd, 'utf8'), /uiux/i)
})
