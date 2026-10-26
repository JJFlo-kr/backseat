// A send that carries UI/UX guidance creates an implementation_report job before the package is written: the brief
// and meta.json name it, the job input gets the package folder, a renderer cannot choose the id, and sends without
// guidance are untouched. Real editor IPC, sessions and brief; only the delivery (send.ts) and Win32 are faked.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeBrowserWindow, installFakeElectron } from './support/fake-electron.ts'
import { fakeWin32 } from './support/fake-win32.ts'
import { tokens } from './support/uiux-fixtures.ts'
import type { EditorInit, ExportPayload, SendResult } from '../src/shared/types.ts'
import type { DesignRequest } from '../src/shared/uiux/types.ts'

const fake = installFakeElectron()
mkdirSync(join(fake.base, 'userData'), { recursive: true })
writeFileSync(join(fake.base, 'userData', 'config.json'), JSON.stringify({ version: 2, sessionsRoot: join(fake.base, 'sessions') }), 'utf8')

mock.module('../src/main/native/win32.ts', { exports: fakeWin32() })
let stopBeforeSaving = false
mock.module('../src/main/send.ts', {
  exports: {
    sendToTarget: async (_win: unknown, p: ExportPayload): Promise<SendResult> => {
      lastPayload = p
      if (stopBeforeSaving) return { ok: false, delivered: 'file-only', message: 'failed' }
      const { writeSessionPackage } = await import('../src/main/sessions.ts')
      const pkg = await writeSessionPackage(p, null)
      return { ok: true, delivered: 'clipboard', sessionDir: pkg.dir, message: 'ok' }
    }
  }
})
let lastPayload: ExportPayload | null = null

const { createEditorWindow } = await import('../src/main/editor.ts')
const { IPC } = await import('../src/shared/ipc.ts')
const { uiuxStore } = await import('../src/main/uiux/appstore.ts')
const { uiuxBriefLines } = await import('../src/main/uiux/package.ts')
const { buildBrief } = await import('../src/main/brief.ts')
const { unwatchJobs } = await import('../src/main/uiux/jobs-app.ts')

const store = uiuxStore()
const meta: EditorInit['meta'] = {
  capturedAt: '2026-10-27T10:00:00.000Z', displayId: 0, scaleFactor: 1,
  rectDip: { x: 0, y: 0, width: 10, height: 10 }, rectPx: { x: 0, y: 0, width: 10, height: 10 }, mode: 'rect'
}
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const request = (projectId: string): DesignRequest => ({
  schemaVersion: 1, projectId, projectName: 'Acme', scope: { kind: 'all' }, resolved: tokens() as DesignRequest['resolved'],
  changes: [{ path: 'colors.primary', from: '#111111', to: '#222222' }], preserve: ['logo'], locks: [], checks: [], overviewRevision: 0, createdAt: '2026-10-27T10:00:00.000Z'
})

function editor(): FakeBrowserWindow {
  createEditorWindow({ imageDataUrl: '', width: 10, height: 10, meta, target: null, candidates: [], autoRecord: false })
  return FakeBrowserWindow.all.at(-1)!
}
async function send(win: FakeBrowserWindow, payload: ExportPayload): Promise<SendResult> {
  return (await fake.ipcHandlers.get(IPC.editorSend)!({ sender: win.webContents }, payload, {})) as SendResult
}
const base = (): ExportPayload => ({ pngDataUrl: PNG, memo: 'calmer please', annotations: [], meta })
const readMeta = (dir: string): { uiux?: { reportJobId?: string } } => JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { uiux?: { reportJobId?: string } }

test('guidance send: the job exists before the package, the package names it, the job learns the folder', async () => {
  const p = await store.createProject({ name: 'Acme' })
  const win = editor()
  const result = await send(win, { ...base(), uiux: { request: request(p.projectId), reportJobId: 'evil-renderer-id' } as never })
  assert.equal(result.ok, true)
  const jobId = result.reportJobId
  assert.ok(jobId && jobId !== 'evil-renderer-id')
  assert.equal(lastPayload?.uiux?.reportJobId, jobId, 'the package writer got main\'s id, not the renderer\'s')
  assert.equal(readMeta(result.sessionDir!).uiux?.reportJobId, jobId)
  const job = await store.getJob(jobId!)
  assert.equal(job?.type, 'implementation_report')
  assert.equal(job?.status, 'pending')
  const input = await store.getJobInput<{ sessionDir: string; project: { projectId: string } }>(jobId!)
  assert.equal(input?.sessionDir, result.sessionDir)
  assert.equal(input?.project.projectId, p.projectId)
  unwatchJobs(win.webContents)
})

test('the brief tells the agent to report on the job; without a job id the brief has no such line', () => {
  const tr = (k: string, p?: Record<string, unknown>): string => (p ? `${k}${JSON.stringify(p)}` : k)
  const req = request('p1')
  const withJob = uiuxBriefLines(req, [], tr, { reportJobId: 'job-abc' }).join('\n')
  assert.match(withJob, /brief\.uiux\.report\{"jobId":"job-abc"\}/)
  assert.ok(withJob.indexOf('brief.uiux.done') < withJob.indexOf('brief.uiux.report'))
  assert.doesNotMatch(uiuxBriefLines(req, [], tr).join('\n'), /brief\.uiux\.report/)
  const full = buildBrief({ ...base(), uiux: { request: req } }, 'annotated.png', null, { t: tr, uiuxReportJobId: 'job-abc' })
  assert.match(full, /brief\.uiux\.report\{"jobId":"job-abc"\}/)
  assert.doesNotMatch(buildBrief({ ...base(), uiux: { request: req } }, 'annotated.png', null, { t: tr }), /brief\.uiux\.report/)
})

test('a package written with the id carries it in meta.json and design-request.json stays the contract', async () => {
  const { writeSessionPackage } = await import('../src/main/sessions.ts')
  const pkg = await writeSessionPackage({ ...base(), uiux: { request: request('p1'), reportJobId: 'job-xyz' } }, null)
  assert.equal(readMeta(pkg.dir).uiux?.reportJobId, 'job-xyz')
  const dr = JSON.parse(readFileSync(join(pkg.dir, 'design-request.json'), 'utf8')) as Record<string, unknown>
  assert.equal('reportJobId' in dr, false)
  assert.match(readFileSync(join(pkg.dir, 'brief.md'), 'utf8'), /brief\.uiux\.report|job-xyz/)
})

test('sends without guidance: no job, nothing new in meta.json', async () => {
  const before = (await store.listJobs()).length
  const win = editor()
  const result = await send(win, base())
  assert.equal(result.reportJobId, undefined)
  assert.equal((await store.listJobs()).length, before)
  assert.equal(readMeta(result.sessionDir!).uiux, undefined)
  unwatchJobs(win.webContents)
})

test('guidance for an unknown project: the send goes on without a job', async () => {
  const win = editor()
  const result = await send(win, { ...base(), uiux: { request: request('ghost-1') } })
  assert.equal(result.ok, true)
  assert.equal(result.reportJobId, undefined)
  assert.equal(readMeta(result.sessionDir!).uiux?.reportJobId, undefined)
  unwatchJobs(win.webContents)
})

test('a send that wrote no package cancels its report job', async () => {
  const p = await store.createProject({ name: 'Acme 2' })
  const win = editor()
  stopBeforeSaving = true
  const result = await send(win, { ...base(), uiux: { request: request(p.projectId) } })
  stopBeforeSaving = false
  assert.equal(result.reportJobId, undefined)
  const jobs = await store.listJobs({ projectId: p.projectId })
  assert.deepEqual(jobs.map((j) => [j.type, j.status]), [['implementation_report', 'cancelled']])
  assert.equal(existsSync(join(fake.base, 'sessions')), true)
  unwatchJobs(win.webContents)
})
