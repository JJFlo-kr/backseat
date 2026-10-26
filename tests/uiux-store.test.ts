import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { assertSafeId, UiuxStore } from '../src/main/uiux/store.ts'

async function withStore(fn: (s: UiuxStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'backseat-uiux-'))
  try {
    await fn(new UiuxStore(root), root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('ids with path tricks are refused', () => {
  for (const bad of ['../x', 'a/b', 'a\\b', '', '.hidden', 'x'.repeat(65), 'C:x']) assert.throws(() => assertSafeId(bad), bad)
  assert.equal(assertSafeId('acme-1a2b3c'), 'acme-1a2b3c')
})

test('projects: create, list, save; this PC\'s folders are stored apart', async () => {
  await withStore(async (s, root) => {
    const p = await s.createProject({ name: 'Acme Tasks' })
    assert.match(p.projectId, /^acme-tasks-[0-9a-f]{6}$/)
    assert.deepEqual((await s.listProjects()).map((x) => x.name), ['Acme Tasks'])
    await s.setPath(p.projectId, 'D:\\demo\\acme')
    assert.equal((await s.getPaths()).paths[p.projectId], 'D:\\demo\\acme')
    // The exportable profile never contains the folder.
    assert.equal(JSON.stringify(await s.getProject(p.projectId)).includes('demo'), false)
    assert.deepEqual(await readdir(join(root, 'local')), ['paths.json'])
  })
})

test('overview and rules revisions increase; every overview revision is kept', async () => {
  await withStore(async (s, root) => {
    const p = await s.createProject({ name: 'X' })
    const base = { schemaVersion: 1, projectId: p.projectId, basis: 'user' as const, summary: { value: 's', source: 'user' as const }, purpose: { value: 'p', source: 'user' as const }, goals: [], audiences: [], workflows: [], architecture: { nodes: [], edges: [] }, stack: [], designState: [], designConstraints: [], sources: [], unknowns: [], generatedAt: new Date().toISOString() }
    assert.equal((await s.saveOverview(base)).revision, 1)
    assert.equal((await s.saveOverview(base)).revision, 2)
    const files = await readdir(join(root, 'projects', p.projectId))
    assert.ok(files.includes('overview-1.json') && files.includes('overview-2.json') && files.includes('overview.json'))
    assert.equal((await s.getOverview(p.projectId))?.revision, 2)
  })
})

test('jobs: created pending, expire after their deadline, results stored apart', async () => {
  await withStore(async (s) => {
    const j = await s.createJob({ type: 'project_overview', projectId: 'acme-1', inputRevision: 0, minutes: 5, input: { ask: 'overview' } })
    assert.equal(j.status, 'pending')
    assert.deepEqual(await s.getJobInput(j.jobId), { ask: 'overview' })
    await s.updateJob(j.jobId, { expiresAt: new Date(Date.now() - 1000).toISOString() })
    assert.equal((await s.getJob(j.jobId))?.status, 'expired')
    const done = await s.createJob({ type: 'capabilities', projectId: 'acme-1', inputRevision: 0 })
    await s.saveJobResult(done.jobId, { skills: [] })
    await s.updateJob(done.jobId, { status: 'submitted', resultRef: `${done.jobId}.result.json` })
    assert.deepEqual((await s.listJobs({ status: ['submitted'] })).map((x) => x.jobId), [done.jobId])
    assert.deepEqual(await s.getJobResult(done.jobId), { skills: [] })
  })
})
