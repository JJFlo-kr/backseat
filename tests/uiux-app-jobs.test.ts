// The app side of the agent jobs (stages B–D): what a job carries, the request text, cancel / extend, applying a
// stored result once per submission, late answers, mock-up previews, overview and profile files, the
// implementation report job of a send, and the folder watcher. The "agent" is the real MCP job logic
// (src/main/mcp/jobs.ts) over the same store; only Electron and the file dialogs are faked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installFakeElectron } from './support/fake-electron.ts'
import { tokens } from './support/uiux-fixtures.ts'
import { BUNDLES } from '../src/shared/bundles.ts'
import type { DesignRequest, JobRequest, UiuxJob } from '../src/shared/uiux/types.ts'
import type { ExportPayload } from '../src/shared/types.ts'

const fake = installFakeElectron()
mkdirSync(join(fake.base, 'userData'), { recursive: true })
// The new message keys are not in src/locales yet: give the tests their own wording.
Object.assign(BUNDLES.ko, {
  'uiux.job.request.project_overview': 'overview job {jobId}',
  'uiux.job.request.design_proposal': 'proposal job {jobId}',
  'uiux.job.request.design_proposal.skill': 'proposal job {jobId} with {skill}',
  'uiux.job.request.skill_setup': 'skill job {jobId} for {skill}',
  'uiux.job.copied': 'COPIED',
  'uiux.job.notOpen': 'NOT-OPEN',
  'uiux.job.gone': 'GONE',
  'uiux.import.otherProject': 'OTHER {name}',
  'uiux.import.tooLarge': 'TOO-LARGE {mb}',
  'uiux.import.notJson': 'NOT-JSON',
  'uiux.import.invalid': 'INVALID'
})
const { applyLocale } = await import('../src/main/locales.ts')
applyLocale()

const { uiuxStore } = await import('../src/main/uiux/appstore.ts')
const app = await import('../src/main/uiux/jobs-app.ts')
const { openJob, submitJobResult } = await import('../src/main/mcp/jobs.ts')
const { JobWatcher } = await import('../src/main/uiux/jobwatch.ts')
const { buildJobInput, buildRequestText, clampMinutes, inputRevisionFor, userConfirmed } = await import('../src/main/uiux/jobinput.ts')
const { saveUserOverview } = await import('../src/main/uiux/service.ts')
const { BUILTIN_SKILL } = await import('../src/shared/uiux/builtin.ts')

const store = uiuxStore()

function png(width = 2, height = 2): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(8, 1)), chunk('IEND', Buffer.alloc(0))])
}
const dataUrl = (b: Buffer): string => `data:image/png;base64,${b.toString('base64')}`

const ev = [{ path: 'README.md' }]
const agentOverview = (projectId: string, over: Record<string, unknown> = {}) => ({
  projectId,
  summary: { value: 'Agent: a task tracker', source: 'verified', evidence: ev },
  purpose: { value: 'Agent: keep tasks together', source: 'verified', evidence: ev },
  goals: [{ value: 'speed', source: 'estimated' }, { value: 'Accuracy', source: 'estimated' }],
  audiences: [{ value: 'team leads', source: 'estimated' }],
  workflows: [{ id: 'signin', name: 'Sign in', steps: ['open', 'sign in'], source: 'verified' }],
  architecture: { nodes: [{ id: 'login', type: 'screen', label: 'Sign-in', source: 'verified', evidence: [{ path: 'index.html' }] }], edges: [] },
  stack: [], designState: [], designConstraints: [], sources: ev, unknowns: ['backend'],
  ...over
})

async function project(name = 'Acme', folder: string | null = 'D:\\work\\acme') {
  const p = await store.createProject({ name })
  if (folder) await store.setPath(p.projectId, folder)
  return p
}
/** The agent's side: fetch and submit. */
async function answer(job: UiuxJob, result: unknown): Promise<void> {
  await openJob(store, job.jobId)
  const out = await submitJobResult(store, { jobId: job.jobId, inputRevision: job.inputRevision, result })
  assert.equal(out.kind, 'submitted', JSON.stringify(out).slice(0, 500))
}

// ---------- pure: inputs and request text ----------

test('request text: one line, built from the job id (and the skill name for skill jobs)', () => {
  const tr = (k: string, p?: Record<string, unknown>): string => `${k}|${JSON.stringify(p)}`
  const t = buildRequestText({ jobId: 'job-1', type: 'project_overview' }, tr)
  assert.equal(t, 'uiux.job.request.project_overview|{"jobId":"job-1","skill":""}')
  assert.match(buildRequestText({ jobId: 'job-2', type: 'design_proposal' }, tr, { skillName: 'UI Pro' }), /^uiux\.job\.request\.design_proposal\.skill\|.*"skill":"UI Pro"/)
  assert.match(buildRequestText({ jobId: 'job-3', type: 'design_proposal' }, tr), /^uiux\.job\.request\.design_proposal\|/)
  for (const type of ['capabilities', 'skill_setup', 'style_audit', 'implementation_report'] as const) {
    assert.match(buildRequestText({ jobId: 'j', type }, tr), new RegExp(`^uiux\\.job\\.request\\.${type}\\|`))
  }
  assert.doesNotMatch(t, /\n/)
})

test('minutes are clamped to 1..60', () => {
  assert.equal(clampMinutes(0, 5), 1)
  assert.equal(clampMinutes(500, 5), 60)
  assert.equal(clampMinutes(undefined, 5), 5)
  assert.equal(clampMinutes(12.4, 5), 12)
})

test('job inputs carry what each type needs', () => {
  const profile = { schemaVersion: 1, projectId: 'p1', name: 'Acme', repo: 'github.com/a/b', createdAt: 'a', updatedAt: 'b' }
  const overview = {
    schemaVersion: 1, projectId: 'p1', revision: 3, basis: 'agent' as const, generatedAt: 'g',
    summary: { value: 'S', source: 'user' as const }, purpose: { value: 'P', source: 'estimated' as const },
    goals: [{ value: 'speed', source: 'user' as const }], audiences: [], workflows: [{ id: 'w', name: 'Flow', steps: ['a'], source: 'user' as const }],
    architecture: { nodes: [], edges: [] }, stack: [], designState: [], designConstraints: [], sources: [], unknowns: ['x'], questions: ['q']
  }
  const rules = { schemaVersion: 1, projectId: 'p1', revision: 4, tokens: tokens() as never, locks: ['colors.primary'], pageOverrides: {}, componentRules: [], themes: ['light' as const], updatedAt: 'u' }
  const base = { profile, folder: 'D:\\work\\acme', overview, rules, req: { type: 'project_overview' as const } }

  const ov = buildJobInput('project_overview', base)
  assert.deepEqual(ov.project, { projectId: 'p1', name: 'Acme', repo: 'github.com/a/b', folder: 'D:\\work\\acme' })
  assert.equal(ov.overviewRevision, 3)
  assert.deepEqual(ov.userConfirmed, [{ field: 'summary', value: 'S' }, { field: 'goals', value: 'speed' }, { field: 'workflows', value: 'Flow' }])
  assert.deepEqual(userConfirmed(null), [])

  assert.throws(() => buildJobInput('skill_setup', base), /needs a skill/)
  const skill = { id: 'uupm', name: 'UI Pro', source: 'agent' as const }
  const ss = buildJobInput('skill_setup', { ...base, skill })
  assert.deepEqual(ss.skill, skill)
  assert.equal((ss.overview as { purpose: string }).purpose, 'P')

  const dp = buildJobInput('design_proposal', { ...base, skill, requestNumber: 2, imagePaths: { capture: 'C:\\x\\c.png' }, req: { type: 'design_proposal', screenPurpose: 'sign-in', preserve: ['logo'], scope: { kind: 'component', component: 'button' } } })
  assert.equal(dp.rulesRevision, 4)
  assert.equal(dp.requestNumber, 2)
  assert.deepEqual((dp.current as { locks: string[] }).locks, ['colors.primary'])
  assert.deepEqual(dp.scope, { kind: 'component', component: 'button' })
  assert.deepEqual(dp.images, { capture: 'C:\\x\\c.png' })
  assert.equal(dp.screenPurpose, 'sign-in')

  const sa = buildJobInput('style_audit', { ...base, req: { type: 'style_audit' } })
  assert.equal((sa.rules as { revision: number }).revision, 4)
  assert.deepEqual(buildJobInput('capabilities', base), { project: ov.project, overviewRevision: 3 })

  assert.equal(inputRevisionFor('project_overview', { overview, rules, requestNumber: undefined, designRequest: undefined }), 3)
  assert.equal(inputRevisionFor('design_proposal', { overview, rules, requestNumber: 5, designRequest: undefined }), 5)
  assert.equal(inputRevisionFor('style_audit', { overview, rules, requestNumber: undefined, designRequest: undefined }), 4)
  assert.equal(inputRevisionFor('capabilities', { overview: null, rules: null, requestNumber: undefined, designRequest: undefined }), 0)
  assert.equal(inputRevisionFor('project_overview', { overview: null, rules: null, requestNumber: undefined, designRequest: undefined }), 0)
})

// ---------- requesting, cancelling, extending ----------

test('requestJob: project_overview input has the folder, revision and the confirmed claims; text names the job', async () => {
  const p = await project()
  await saveUserOverview(p.projectId, { summary: 'Mine', purpose: 'My purpose', audiences: ['ops'], goals: ['clarity'], screenKinds: ['dashboard'] })
  const { job, requestText } = await app.requestJob(p.projectId, { type: 'project_overview' })
  assert.equal(job.status, 'pending')
  assert.equal(job.inputRevision, 1)
  assert.equal(requestText, `overview job ${job.jobId}`)
  const input = await store.getJobInput<{ project: { folder: string; name: string }; userConfirmed: { field: string; value: string }[] }>(job.jobId)
  assert.equal(input?.project.folder, 'D:\\work\\acme')
  assert.deepEqual(input?.userConfirmed.map((c) => c.field).sort(), ['audiences', 'designState', 'goals', 'purpose', 'summary'])
  assert.equal(Math.round((Date.parse(job.expiresAt) - Date.parse(job.createdAt)) / 60000), 5)
})

test('requestJob: a project without an overview gets inputRevision 0; unknown project, type and skill are refused', async () => {
  const p = await project('Bare', null)
  const { job } = await app.requestJob(p.projectId, { type: 'capabilities', minutes: 500 })
  assert.equal(job.inputRevision, 0)
  assert.equal(Math.round((Date.parse(job.expiresAt) - Date.parse(job.createdAt)) / 60000), 60)
  const input = await store.getJobInput<{ project: { folder?: string } }>(job.jobId)
  assert.equal(input?.project.folder, undefined)
  await assert.rejects(app.requestJob('nope-1', { type: 'capabilities' }), /unknown project/)
  await assert.rejects(app.requestJob(p.projectId, { type: 'bogus' } as unknown as JobRequest), /unknown job type/)
  await assert.rejects(app.requestJob(p.projectId, { type: 'skill_setup' }), /needs a skill/)
  await assert.rejects(app.requestJob(p.projectId, { type: 'skill_setup', skillId: 'ghost' }), /unknown skill/)
  await assert.rejects(app.requestJob('../evil', { type: 'capabilities' }), /invalid projectId/)
})

test('requestJob: design_proposal saves the captures next to the job, counts requests per project, refuses a bad PNG', async () => {
  const p = await project()
  await store.saveRules({ projectId: p.projectId, tokens: tokens() as never, locks: ['colors.primary'], pageOverrides: {}, componentRules: [], themes: ['light'] })
  const req: JobRequest = { type: 'design_proposal', capturePng: dataUrl(png()), annotatedPng: dataUrl(png(3, 3)), skillId: BUILTIN_SKILL.id, screenPurpose: 'sign-in', preserve: ['logo'], scope: { kind: 'all' } }
  const first = await app.requestJob(p.projectId, req)
  const second = await app.requestJob(p.projectId, req)
  assert.equal(first.job.inputRevision, 1)
  assert.equal(second.job.inputRevision, 2, 'an incrementing counter per project')
  assert.equal((await store.getProject(p.projectId))?.proposalRequests, 2)
  assert.equal(first.job.skillId, BUILTIN_SKILL.id)
  assert.equal(first.requestText, `proposal job ${first.job.jobId} with ${BUILTIN_SKILL.name}`)
  const input = await store.getJobInput<{ images: { capture: string; annotatedCapture: string }; rulesRevision: number; current: { locks: string[] } }>(first.job.jobId)
  assert.equal(input?.images.capture, store.jobExtraFile(first.job.jobId, 'capture.png'))
  assert.ok(existsSync(input?.images.capture ?? ''))
  assert.ok(statSync(input?.images.annotatedCapture ?? '').size > 0)
  assert.equal(input?.rulesRevision, 1)
  assert.deepEqual(input?.current.locks, ['colors.primary'])
  const before = (await store.listJobs({ projectId: p.projectId })).length
  await assert.rejects(app.requestJob(p.projectId, { type: 'style_audit', capturePng: 'data:image/png;base64,AAAA' }), /not a usable PNG/)
  assert.equal((await store.listJobs({ projectId: p.projectId })).length, before, 'no job without its capture')
})

test('cancel, extend and list', async () => {
  const p = await project()
  const a = (await app.requestJob(p.projectId, { type: 'capabilities' })).job
  const b = (await app.requestJob(p.projectId, { type: 'capabilities' })).job
  const listed = await app.listJobs(p.projectId)
  assert.equal(listed.length, 2)
  assert.ok(listed[0]!.createdAt >= listed[1]!.createdAt, 'newest first')
  const extended = await app.extendJob(a.jobId, 30)
  assert.ok(Math.abs(Date.parse(extended.expiresAt) - (Date.now() + 30 * 60_000)) < 5000)
  assert.equal((await app.extendJob(a.jobId, 999)).expiresAt > extended.expiresAt, true)
  assert.ok(Date.parse((await app.extendJob(a.jobId, 999)).expiresAt) - Date.now() <= 60 * 60_000 + 5000, 'clamped to 60 minutes')
  assert.equal((await app.cancelJob(a.jobId)).status, 'cancelled')
  assert.equal((await app.cancelJob(a.jobId)).status, 'cancelled')
  assert.equal((await app.extendJob(a.jobId, 10)).status, 'cancelled', 'a cancelled job does not come back')
  // The agent sees the cancellation.
  const opened = await openJob(store, a.jobId)
  assert.equal(opened.kind, 'closed')
  // A job past its deadline reads as expired and can be extended back to life.
  await store.updateJob(b.jobId, { expiresAt: new Date(Date.now() - 1000).toISOString() })
  assert.equal((await app.listJobs(p.projectId)).find((j) => j.jobId === b.jobId)?.status, 'expired')
  assert.equal((await app.extendJob(b.jobId, 5)).status, 'pending')
  // An answered job cannot be cancelled.
  const c = (await app.requestJob(p.projectId, { type: 'capabilities' })).job
  await answer(c, { skills: [{ id: 's1', name: 'S One' }] })
  assert.equal((await app.cancelJob(c.jobId)).status, 'submitted')
})

// ---------- results ----------

test('project_overview result: merged with the user\'s entries, stored once per submission', async () => {
  const p = await project()
  await saveUserOverview(p.projectId, { summary: 'My summary', purpose: 'My purpose', audiences: ['Team Leads'], goals: ['accuracy'], screenKinds: [] })
  const { job } = await app.requestJob(p.projectId, { type: 'project_overview' })
  assert.deepEqual(await app.jobOutcome(job.jobId), { job: (await app.jobOutcome(job.jobId))!.job }, 'nothing before the agent answers')
  await answer(job, agentOverview(p.projectId))
  const out = await app.jobOutcome(job.jobId)
  assert.equal(out?.job.status, 'submitted')
  assert.equal(out?.overviewRevision, 2)
  assert.equal(out?.completeness?.complete, true)
  const o = await store.getOverview(p.projectId)
  assert.equal(o?.revision, 2)
  assert.equal(o?.basis, 'agent')
  assert.equal(o?.jobId, job.jobId)
  assert.equal(o?.summary.value, 'My summary', 'the user\'s text is not replaced')
  assert.deepEqual(o?.goals.map((g) => [g.value, g.source]), [['accuracy', 'user'], ['speed', 'estimated']], 'agent duplicate dropped, user first')
  assert.deepEqual(o?.audiences.map((g) => g.value), ['Team Leads'])
  assert.equal(o?.workflows.length, 1)
  // Asking again changes nothing: applied once.
  assert.equal((await app.jobOutcome(job.jobId))?.overviewRevision, 2)
  await Promise.all([app.jobOutcome(job.jobId), app.jobOutcome(job.jobId)])
  assert.equal((await store.getOverview(p.projectId))?.revision, 2)
  assert.ok(existsSync(store.jobExtraFile(job.jobId, 'applied.txt')))
})

test('an incomplete overview is stored too (partial view) and the completed one is applied as a new revision', async () => {
  const p = await project()
  const { job } = await app.requestJob(p.projectId, { type: 'project_overview' })
  await answer(job, agentOverview(p.projectId, { workflows: [] }))
  const first = await app.jobOutcome(job.jobId)
  assert.equal(first?.completeness?.complete, false)
  assert.deepEqual(first?.completeness?.gaps, ['workflows'])
  assert.equal(first?.overviewRevision, 1)
  await answer(job, agentOverview(p.projectId))
  const second = await app.jobOutcome(job.jobId)
  assert.equal(second?.submission, 2)
  assert.equal(second?.overviewRevision, 2)
})

test('a late answer to an older overview request does not overwrite a newer one', async () => {
  const p = await project()
  const older = (await app.requestJob(p.projectId, { type: 'project_overview' })).job
  await new Promise((r) => setTimeout(r, 5))
  const newer = (await app.requestJob(p.projectId, { type: 'project_overview' })).job
  await answer(newer, agentOverview(p.projectId, { summary: { value: 'Newer answer', source: 'estimated' } }))
  assert.equal((await app.jobOutcome(newer.jobId))?.overviewRevision, 1)
  await answer(older, agentOverview(p.projectId, { summary: { value: 'Older answer', source: 'estimated' } }))
  const late = await app.jobOutcome(older.jobId)
  assert.equal(late?.overviewRevision, undefined)
  const o = await store.getOverview(p.projectId)
  assert.equal(o?.revision, 1)
  assert.equal(o?.summary.value, 'Newer answer')
})

test('skill_setup result is saved as the skill context (user fields kept); capabilities give the skill list', async () => {
  const p = await project()
  const caps = (await app.requestJob(p.projectId, { type: 'capabilities' })).job
  await answer(caps, { skills: [{ id: 'uupm', name: 'UI Pro Max', version: '2' }] })
  const listed = await app.skills(p.projectId)
  assert.deepEqual(listed.agent.map((s) => [s.id, s.source]), [['uupm', 'agent']])
  assert.equal(listed.capabilitiesJob?.jobId, caps.jobId)
  assert.deepEqual(listed.contexts, [])

  await store.saveSkillContext({ projectId: p.projectId, skill: { id: 'uupm', name: 'UI Pro Max', source: 'agent' }, fields: { framework: { value: 'Vue', source: 'user' } }, missing: [], generatedAt: 'x' })
  const { job, requestText } = await app.requestJob(p.projectId, { type: 'skill_setup', skillId: 'uupm' })
  assert.equal(requestText, `skill job ${job.jobId} for UI Pro Max`)
  assert.equal(job.skillId, 'uupm')
  await answer(job, { projectId: p.projectId, skillId: 'uupm', fields: { framework: { value: 'React', source: 'estimated' }, css: { value: 'tailwind', source: 'verified', evidence: ev } }, missing: ['framework', 'tokens'] })
  await app.jobOutcome(job.jobId)
  await app.jobOutcome(job.jobId)
  const ctx = await store.getSkillContext(p.projectId, 'uupm')
  assert.equal(ctx?.revision, 2, 'applied once')
  assert.equal(ctx?.fields.framework?.value, 'Vue')
  assert.equal(ctx?.fields.css?.value, 'tailwind')
  assert.deepEqual(ctx?.missing, ['tokens'])
  assert.equal(ctx?.jobId, job.jobId)
  assert.equal((await app.skills(p.projectId)).contexts.length, 1)
  // A newer capabilities answer replaces the list.
  const caps2 = (await app.requestJob(p.projectId, { type: 'capabilities' })).job
  await answer(caps2, { skills: [{ id: 'other', name: 'Other' }] })
  assert.deepEqual((await app.skills(p.projectId)).agent.map((s) => s.id), ['other'])
})

test('design proposals: listed per job (newest first, with the overview revision) and the mock-up comes back as a data URL', async () => {
  const p = await project()
  await saveUserOverview(p.projectId, { summary: 'S', purpose: 'P', audiences: ['a'], goals: [], screenKinds: [] })
  const proposal = (id: string, extra: Record<string, unknown> = {}) => ({
    proposalId: id, projectId: p.projectId, direction: 'A', name: `Variant ${id}`, rationale: 'r', tokens: tokens(),
    changes: ['c'], preserved: ['l'], checks: [{ id: 'c1', kind: 'visual', label: 'Contrast' }], ...extra
  })
  const j1 = (await app.requestJob(p.projectId, { type: 'design_proposal' })).job
  await new Promise((r) => setTimeout(r, 5))
  await saveUserOverview(p.projectId, { summary: 'S2', purpose: 'P', audiences: ['a'], goals: [], screenKinds: [] })
  const j2 = (await app.requestJob(p.projectId, { type: 'design_proposal' })).job
  await answer(j1, { projectId: p.projectId, proposals: [proposal('a1')] })
  await answer(j2, { projectId: p.projectId, proposals: [proposal('b1', { previewPngBase64: png().toString('base64') }), proposal('b2')] })
  const list = await app.proposals(p.projectId)
  assert.deepEqual(list.map((l) => [l.jobId, l.overviewRevision, l.proposals.length]), [[j2.jobId, 2, 2], [j1.jobId, 1, 1]])
  const out = await app.jobOutcome(j2.jobId)
  assert.deepEqual(out?.proposals?.map((x) => x.proposalId), ['b1', 'b2'])
  assert.equal(out?.proposals?.[0]?.previewKind, 'mockup')
  assert.match((await app.proposalPreview(j2.jobId, 'b1')) ?? '', /^data:image\/png;base64,iVBOR/)
  assert.equal(await app.proposalPreview(j2.jobId, 'b2'), null, 'no mock-up for that proposal')
  assert.equal(await app.proposalPreview(j1.jobId, 'b1'), null, 'not a proposal of that job')
  assert.equal(await app.proposalPreview(j2.jobId, 'nope'), null)
  await assert.rejects(app.proposalPreview(j2.jobId, '../x'), /invalid proposalId/)
})

test('style_audit findings and an implementation report reach the outcome', async () => {
  const p = await project()
  const audit = (await app.requestJob(p.projectId, { type: 'style_audit', capturePng: dataUrl(png()) })).job
  await answer(audit, { projectId: p.projectId, findings: [{ area: 'Login', issue: 'Primary colour differs', source: 'estimated', suggestion: 'Use colors.primary' }] })
  assert.equal((await app.jobOutcome(audit.jobId))?.findings?.[0]?.area, 'Login')

  const request = { schemaVersion: 1, projectId: p.projectId, projectName: 'Acme', scope: { kind: 'all' }, resolved: tokens(), changes: [{ path: 'colors.primary', from: '#111111', to: '#222222' }], preserve: [], locks: [], checks: [{ id: 'c', kind: 'runtime', label: 'Focus ring', status: 'unverified' }], createdAt: 'now' } as unknown as DesignRequest
  const payload = { memo: 'make it calmer', uiux: { request } } as unknown as ExportPayload
  const jobId = await app.createReportJob(payload)
  assert.ok(jobId)
  await app.attachSessionDir(jobId!, 'C:\\Users\\a\\Pictures\\Backseat\\sessions\\s1')
  const input = await store.getJobInput<{ sessionDir: string; request: { changes: unknown[] }; memo: string }>(jobId!)
  assert.equal(input?.sessionDir, 'C:\\Users\\a\\Pictures\\Backseat\\sessions\\s1')
  assert.equal(input?.request.changes.length, 1)
  assert.equal(input?.memo, 'make it calmer')
  const job = (await store.getJob(jobId!))!
  assert.equal(job.type, 'implementation_report')
  assert.equal(Math.round((Date.parse(job.expiresAt) - Date.parse(job.createdAt)) / 60000), 60)
  await answer(job, { projectId: p.projectId, summary: 'Changed the button colour', changedFiles: [{ path: 'src/button.css' }], notDone: [], checksRun: ['npm test'] })
  const out = await app.jobOutcome(jobId!)
  assert.equal(out?.report?.summary, 'Changed the button colour')
  assert.deepEqual(out?.report?.changedFiles, [{ path: 'src/button.css' }])
  // No guidance, an unknown project: no job, and the send is not held back.
  assert.equal(await app.createReportJob({ memo: '', uiux: undefined } as unknown as ExportPayload), null)
  assert.equal(await app.createReportJob({ memo: '', uiux: { request: { ...request, projectId: 'ghost-1' } } } as unknown as ExportPayload), null)
})

// ---------- hand edits ----------

test('saveOverviewEdits keeps the agent\'s other fields and marks only the edited ones as the user\'s', async () => {
  const p = await project()
  const { job } = await app.requestJob(p.projectId, { type: 'project_overview' })
  await answer(job, agentOverview(p.projectId))
  await app.jobOutcome(job.jobId)
  const before = (await store.getOverview(p.projectId))!
  const same = await app.saveOverviewEdits(p.projectId, { summary: before.summary.value, purpose: before.purpose.value, audiences: ['team leads'], goals: ['speed', 'Accuracy'], screenKinds: [] })
  assert.equal(same.revision, before.revision, 'no change, no new revision')
  const edited = await app.saveOverviewEdits(p.projectId, { summary: before.summary.value, purpose: 'Our purpose', audiences: ['team leads'], goals: ['speed', 'Accuracy', 'trust'], screenKinds: ['dashboard'] })
  assert.equal(edited.revision, before.revision + 1)
  assert.equal(edited.basis, 'agent')
  assert.equal(edited.summary.source, 'verified')
  assert.deepEqual(edited.purpose, { value: 'Our purpose', source: 'user' })
  assert.deepEqual(edited.goals.map((g) => g.source), ['estimated', 'estimated', 'user'])
  assert.equal(edited.workflows.length, 1)
  assert.equal(edited.architecture.nodes.length, 1)
  // A later agent run keeps the edit.
  const again = (await app.requestJob(p.projectId, { type: 'project_overview' })).job
  await answer(again, agentOverview(p.projectId, { purpose: { value: 'Agent purpose v2', source: 'verified', evidence: ev } }))
  await app.jobOutcome(again.jobId)
  assert.equal((await store.getOverview(p.projectId))?.purpose.value, 'Our purpose')
  // No overview yet: like typing it in.
  const bare = await project('Bare edits', null)
  const made = await app.saveOverviewEdits(bare.projectId, { summary: 'S', purpose: 'P', audiences: ['a'], goals: ['g'], screenKinds: ['k'] })
  assert.equal(made.basis, 'user')
  assert.equal(made.summary.source, 'user')
  await assert.rejects(app.saveOverviewEdits('ghost-1', { summary: '', purpose: '', audiences: [], goals: [], screenKinds: [] }), /unknown project/)
})

// ---------- files ----------

const tmpFile = (name: string, content: string | Buffer): string => {
  const f = join(fake.base, name)
  writeFileSync(f, content)
  return f
}

test('importOverview: validated like an agent result, basis imported, other projects and bad files refused', async () => {
  const p = await project()
  const other = await project('Other')
  const win = null
  app.setDialogsForTest({ openFile: async () => tmpFile('ov-ok.json', JSON.stringify(agentOverview(p.projectId))) })
  const ok = await app.importOverview(p.projectId, win)
  assert.equal(ok.ok, true)
  assert.equal(ok.overview?.basis, 'imported')
  assert.equal((await store.getOverview(p.projectId))?.basis, 'imported')

  app.setDialogsForTest({ openFile: async () => tmpFile('ov-other.json', JSON.stringify(agentOverview(other.projectId))) })
  const wrong = await app.importOverview(p.projectId, win)
  assert.deepEqual(wrong, { ok: false, errors: ['OTHER Acme'] })
  assert.equal((await store.getOverview(other.projectId)), null)

  app.setDialogsForTest({ openFile: async () => tmpFile('ov-text.json', 'not json') })
  assert.deepEqual((await app.importOverview(p.projectId, win)).errors, ['NOT-JSON'])
  app.setDialogsForTest({ openFile: async () => tmpFile('ov-bad.json', JSON.stringify({ projectId: p.projectId, summary: 'x' })) })
  const bad = await app.importOverview(p.projectId, win)
  assert.equal(bad.ok, false)
  assert.equal(bad.errors?.[0], 'INVALID')
  assert.match(bad.errors?.[1] ?? '', /^\$\./)
  app.setDialogsForTest({ openFile: async () => tmpFile('ov-big.json', Buffer.alloc(2 * 1024 * 1024 + 1, 32)) })
  assert.deepEqual((await app.importOverview(p.projectId, win)).errors, ['TOO-LARGE 2'])
  app.setDialogsForTest({ openFile: async () => null })
  assert.deepEqual(await app.importOverview(p.projectId, win), { ok: false })
})

test('exportOverview: Markdown with provenance words, the stored JSON, a checked PNG', async () => {
  const p = await project()
  assert.deepEqual(await app.exportOverview(p.projectId, 'md', undefined, null), { ok: false }, 'no overview yet')
  const { job } = await app.requestJob(p.projectId, { type: 'project_overview' })
  await answer(job, agentOverview(p.projectId))
  await app.jobOutcome(job.jobId)
  app.setDialogsForTest({ saveFile: async (_w, o) => join(fake.base, `export-${p.projectId}.${o.ext}`) })
  const md = await app.exportOverview(p.projectId, 'md', undefined, null)
  assert.equal(md.ok, true)
  const text = readFileSync(md.path!, 'utf8')
  // Every statement ends with its provenance in words (src/shared/uiux/overviewText.ts).
  assert.match(text, /- Agent: a task tracker — \S/)
  const js = await app.exportOverview(p.projectId, 'json', undefined, null)
  assert.deepEqual(JSON.parse(readFileSync(js.path!, 'utf8')), await store.getOverview(p.projectId))
  const img = await app.exportOverview(p.projectId, 'png', dataUrl(png()), null)
  assert.equal(readFileSync(img.path!).subarray(1, 4).toString('latin1'), 'PNG')
  assert.deepEqual(await app.exportOverview(p.projectId, 'png', 'data:image/png;base64,AAAA', null), { ok: false })
  assert.deepEqual(await app.exportOverview(p.projectId, 'png', undefined, null), { ok: false })
  assert.deepEqual(await app.exportOverview(p.projectId, 'pdf' as never, undefined, null), { ok: false })
  app.setDialogsForTest({ saveFile: async () => null })
  assert.deepEqual(await app.exportOverview(p.projectId, 'md', undefined, null), { ok: false })
})

test('profile export/import: portable file, new id when the id is taken, folder asked last and optional', async () => {
  const p = await project('Portable')
  await store.saveProject({ ...(await store.getProject(p.projectId))!, repo: 'github.com/a/portable', agentId: 'agent-1' })
  await store.saveRules({ projectId: p.projectId, tokens: tokens() as never, locks: ['colors.primary'], pageOverrides: {}, componentRules: ['one'], themes: ['light'] })
  const { job } = await app.requestJob(p.projectId, { type: 'project_overview' })
  await answer(job, agentOverview(p.projectId, { unknowns: ['backend at D:\\secret\\place'] }))
  await app.jobOutcome(job.jobId)
  await store.saveSkillContext({ projectId: p.projectId, skill: { id: 'uupm', name: 'UI Pro', source: 'agent' }, fields: { css: { value: 'tailwind', source: 'user' } }, missing: [], generatedAt: 'x' })

  const file = join(fake.base, 'portable-backseat-project.json')
  app.setDialogsForTest({ saveFile: async () => file })
  const out = await app.exportProfile(p.projectId, null)
  assert.deepEqual(out, { ok: true, path: file })
  const raw = readFileSync(file, 'utf8')
  assert.doesNotMatch(raw, /D:\\\\|secret|work\\\\acme|agent-1/)
  assert.ok(existsSync(file.replace(/\.json$/, '.md')), 'a readable file beside it')
  const bundle = JSON.parse(raw) as { schemaVersion: number; profile: Record<string, unknown>; skillContexts: unknown[] }
  assert.equal(bundle.schemaVersion, 1)
  assert.equal(bundle.profile.proposalRequests, undefined)
  assert.equal(bundle.skillContexts.length, 1)

  // Same PC: the id exists, so the file becomes a new project (nothing is overwritten).
  const folders: string[] = []
  app.setDialogsForTest({ openFile: async () => file, pickFolder: async () => (folders.push('asked'), null) })
  const again = await app.importProfile(null)
  assert.equal(again.ok, true)
  assert.equal(again.idChanged, true)
  assert.equal(again.folderLinked, false)
  assert.notEqual(again.projectId, p.projectId)
  assert.deepEqual(folders, ['asked'])
  const imported = await store.getProject(again.projectId!)
  assert.equal(imported?.name, 'Portable')
  assert.equal(imported?.agentId, undefined)
  assert.equal((await store.getRules(again.projectId!))?.projectId, again.projectId)
  const ov = await store.getOverview(again.projectId!)
  assert.equal(ov?.basis, 'imported')
  assert.equal(ov?.projectId, again.projectId)
  assert.equal(ov?.unknowns.some((u) => u.includes('secret')), false)
  assert.equal((await store.listSkillContexts(again.projectId!))[0]?.projectId, again.projectId)
  assert.equal((await store.getPaths()).paths[again.projectId!], undefined)
  assert.equal((await store.getProject(p.projectId))?.agentId, 'agent-1', 'the original is untouched')

  // Fresh PC: the id is free and is kept; the folder the user picks is linked.
  const target = join(fake.base, 'work-folder')
  const lone = JSON.parse(raw) as { profile: { projectId: string } }
  lone.profile.projectId = 'brand-new-1'
  app.setDialogsForTest({ openFile: async () => tmpFile('lone.json', JSON.stringify(lone)), pickFolder: async () => target })
  const fresh = await app.importProfile(null)
  assert.deepEqual([fresh.ok, fresh.projectId, fresh.idChanged, fresh.folderLinked], [true, 'brand-new-1', false, true])
  assert.equal((await store.getPaths()).paths['brand-new-1'], target)

  app.setDialogsForTest({ openFile: async () => tmpFile('junk.json', JSON.stringify({ kind: 'something else' })) })
  const junk = await app.importProfile(null)
  assert.equal(junk.ok, false)
  assert.equal(junk.errors?.[0], 'INVALID')
  assert.equal((await store.listProjects()).filter((x) => x.name === 'Portable').length, 3, 'a refused file creates nothing')
})

// ---------- delivering the request text ----------

test('deliverJob: copy puts the text on the clipboard; paste goes through the editor path; closed jobs are refused', async () => {
  const p = await project()
  const { job, requestText } = await app.requestJob(p.projectId, { type: 'project_overview' })
  const pasted: string[] = []
  const stub = async (text: string) => (pasted.push(text), { pasted: true, message: 'PASTED' })
  assert.deepEqual(await app.deliverJob(job.jobId, 'copy', stub), { ok: true, message: 'COPIED' })
  assert.deepEqual(pasted, [])
  assert.deepEqual(await app.deliverJob(job.jobId, 'paste', stub), { ok: true, message: 'PASTED' })
  assert.deepEqual(pasted, [requestText])
  // A paste that could not be done says so and is not ok.
  const refused = await app.deliverJob(job.jobId, 'paste', async () => ({ pasted: false, message: 'ON THE CLIPBOARD ONLY', reason: 'noTarget' }))
  assert.deepEqual(refused, { ok: false, message: 'ON THE CLIPBOARD ONLY' })
  await app.cancelJob(job.jobId)
  assert.deepEqual(await app.deliverJob(job.jobId, 'paste', stub), { ok: false, message: 'NOT-OPEN' })
  assert.equal(pasted.length, 1)
  assert.deepEqual(await app.deliverJob('job-ghost', 'copy', stub), { ok: false, message: 'GONE' })
})

// ---------- watching ----------

test('JobWatcher reports status changes and deadline passes, not the first look and not quiet jobs', async () => {
  const p = await project()
  const quiet = (await app.requestJob(p.projectId, { type: 'capabilities' })).job
  const seen: string[] = []
  const w = new JobWatcher(store, (j: UiuxJob) => seen.push(`${j.jobId}:${j.status}`))
  await w.poll()
  assert.deepEqual(seen, [], 'the first look only remembers')
  await w.poll()
  assert.deepEqual(seen, [])
  const j = (await app.requestJob(p.projectId, { type: 'capabilities' })).job
  await w.poll()
  assert.deepEqual(seen, [`${j.jobId}:pending`], 'a new job')
  await openJob(store, j.jobId)
  await w.poll()
  await answer(j, { skills: [] })
  await w.poll()
  await w.poll()
  assert.deepEqual(seen, [`${j.jobId}:pending`, `${j.jobId}:fetched`, `${j.jobId}:submitted`])
  await store.updateJob(quiet.jobId, { expiresAt: new Date(Date.now() - 1000).toISOString() })
  await w.poll()
  assert.equal(seen.at(-1), `${quiet.jobId}:expired`)
  assert.equal(w.active, false)
  w.start()
  assert.equal(w.active, true)
  w.stop()
  assert.equal(w.active, false)
})

test('editor windows are watched only while open', async () => {
  const wc = { isDestroyed: () => false, send: () => undefined } as unknown as Electron.WebContents
  app.watchJobsFor(wc)
  app.unwatchJobs(wc)
  const wc2 = { isDestroyed: () => false, send: () => undefined } as unknown as Electron.WebContents
  app.watchJobsFor(wc)
  app.watchJobsFor(wc2)
  app.unwatchJobs(wc)
  app.unwatchJobs(wc2) // the last one stops the timer; the process can exit
})
