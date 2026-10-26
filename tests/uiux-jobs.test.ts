// Agent jobs (spec §11): open → submit lifecycle over the real UiuxStore in a temp folder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { UiuxStore } from '../src/main/uiux/store.ts'
import { openJob, reportJobStatus, submitJobResult, type JobResultFile, type SubmitOutcome } from '../src/main/mcp/jobs.ts'
import { checkPngBase64, MAX_PREVIEW_BYTES } from '../src/main/mcp/jobimage.ts'
import { readStyleAudit } from '../src/main/mcp/styleaudit.ts'
import { resultSchema } from '../src/main/mcp/jobspec.ts'
import { JOB_TYPES } from '../src/shared/uiux/types.ts'
import { tokens } from './support/uiux-fixtures.ts'

const PID = 'acme-1'

async function withStore(fn: (s: UiuxStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'backseat-jobs-'))
  try {
    await fn(new UiuxStore(root), root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// ---------- fixtures ----------

const ev = [{ path: 'README.md' }]
const overview = (over: Record<string, unknown> = {}) => ({
  projectId: PID,
  summary: { value: 'A task tracker for small teams', source: 'verified', evidence: ev },
  purpose: { value: 'Keep a team\'s tasks in one place', source: 'verified', evidence: ev },
  goals: [{ value: 'readability', source: 'estimated' }],
  audiences: [{ value: 'small team leads', source: 'user' }],
  workflows: [{ id: 'signin', name: 'Sign in', steps: ['open', 'type email', 'sign in'], source: 'verified' }],
  architecture: { nodes: [{ id: 'login', type: 'screen', label: 'Sign-in', source: 'verified', evidence: [{ path: 'index.html' }] }], edges: [] },
  stack: [], designState: [], designConstraints: [], sources: ev, unknowns: ['backend'],
  ...over
})

function png(width = 2, height = 2, extra = 0): Buffer {
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(8 + extra, 1)), chunk('IEND', Buffer.alloc(0))])
}
const b64 = (b: Buffer): string => b.toString('base64')

const proposal = (id: string, over: Record<string, unknown> = {}) => ({
  proposalId: id, projectId: PID, direction: 'A', name: `Variant ${id}`, rationale: 'Minimal change', tokens: tokens(),
  changes: ['primary button darker'], preserved: ['layout'], checks: [{ id: 'c1', kind: 'visual', label: 'Contrast' }], ...over
})

const must = <K extends SubmitOutcome['kind']>(o: SubmitOutcome, kind: K): Extract<SubmitOutcome, { kind: K }> => {
  assert.equal(o.kind, kind, JSON.stringify(o).slice(0, 600))
  return o as Extract<SubmitOutcome, { kind: K }>
}

const newJob = (s: UiuxStore, fields: Partial<Parameters<UiuxStore['createJob']>[0]> = {}) =>
  s.createJob({ type: 'project_overview', projectId: PID, inputRevision: 2, input: { ask: 'overview' }, ...fields })

// ---------- lifecycle ----------

test('pending → fetched → submitted; a finished job is reported, not reopened', async () => {
  await withStore(async (s) => {
    const j = await newJob(s)
    assert.equal(j.status, 'pending')
    const first = await openJob(s, j.jobId)
    assert.equal(first.kind, 'open')
    if (first.kind !== 'open') return
    assert.equal(first.firstFetch, true)
    assert.equal(first.job.status, 'fetched')
    assert.ok(first.job.fetchedAt)
    assert.deepEqual(first.input, { ask: 'overview' })
    const again = await openJob(s, j.jobId)
    assert.equal(again.kind === 'open' && again.firstFetch, false)
    assert.equal(again.kind === 'open' && again.job.fetchedAt, first.job.fetchedAt)

    const out = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview() }), 'submitted')
    assert.equal(out.duplicate, false)
    assert.deepEqual(out.summary.completeness, { complete: true, gaps: [] })
    const stored = await s.getJob(j.jobId)
    assert.equal(stored?.status, 'submitted')
    assert.equal(stored?.resultRef, `${j.jobId}.result.json`)
    const file = await s.getJobResult<JobResultFile>(j.jobId)
    assert.equal(file?.type, 'project_overview')
    assert.equal(file?.projectId, PID)
    assert.equal(file?.submission, 1)
    assert.equal(file?.overview?.projectId, PID)
    assert.equal(file?.overview?.summary.value, 'A task tracker for small teams')

    const closed = await openJob(s, j.jobId)
    assert.equal(closed.kind, 'closed')
    assert.equal(closed.kind === 'closed' && closed.job.status, 'submitted')
  })
})

test('an unknown job, or an id with path tricks, is not found', async () => {
  await withStore(async (s) => {
    assert.equal((await openJob(s, 'job-nope')).kind, 'not_found')
    assert.equal((await openJob(s, '../x')).kind, 'not_found')
    assert.equal((await submitJobResult(s, { jobId: '..\\x', inputRevision: 0, result: {} })).kind, 'not_found')
    assert.equal((await reportJobStatus(s, { jobId: 'job-nope', status: 'failed' })).kind, 'not_found')
  })
})

test('a rejected result lists the errors, the agent submits again and the job is submitted', async () => {
  await withStore(async (s) => {
    const j = await newJob(s)
    await openJob(s, j.jobId)
    const bad = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview({ purpose: { value: 'x', source: 'verified' } }) }), 'rejected')
    assert.ok(bad.errors.some((e) => e.includes('$.purpose.evidence')), bad.errors.join('\n'))
    const stored = await s.getJob(j.jobId)
    assert.equal(stored?.status, 'rejected')
    assert.match(stored?.error ?? '', /purpose/)
    assert.equal(await s.getJobResult(j.jobId), null, 'nothing stored for a rejected result')

    // job_get still works (with the last error) and the same job accepts the corrected result
    const reopened = await openJob(s, j.jobId)
    assert.equal(reopened.kind === 'open' && reopened.job.status, 'rejected')
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview() }), 'submitted')
    const done = await s.getJob(j.jobId)
    assert.equal(done?.status, 'submitted')
    assert.equal(done?.error, undefined)
  })
})

test('the same result twice is one result; a different one for a finished job changes nothing', async () => {
  await withStore(async (s) => {
    const j = await newJob(s)
    const first = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview() }), 'submitted')
    const before = await s.getJobResult<JobResultFile>(j.jobId)
    // same data, other key order, as JSON text
    const shuffled = JSON.stringify(Object.fromEntries(Object.entries(overview()).reverse()))
    const second = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: shuffled }), 'submitted')
    assert.equal(second.duplicate, true)
    assert.deepEqual(second.summary, first.summary)
    assert.deepEqual(await s.getJobResult(j.jobId), before)

    const other = overview({ summary: { value: 'Something else', source: 'user' } })
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: other }), 'already_submitted')
    assert.deepEqual(await s.getJobResult(j.jobId), before)
    assert.equal((await s.getJob(j.jobId))?.status, 'submitted')
  })
})

test('two submits at the same time make one result and one duplicate', async () => {
  await withStore(async (s) => {
    const j = await newJob(s)
    const [a, b] = await Promise.all([
      submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview() }),
      submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview() })
    ])
    const flags = [must(a, 'submitted').duplicate, must(b, 'submitted').duplicate].sort()
    assert.deepEqual(flags, [false, true])
    assert.equal((await s.getJobResult<JobResultFile>(j.jobId))?.submission, 1)
  })
})

test('a stale inputRevision is refused and nothing changes', async () => {
  await withStore(async (s) => {
    const j = await newJob(s, { inputRevision: 3 })
    await openJob(s, j.jobId)
    const out = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview() }), 'stale')
    assert.deepEqual([out.expected, out.got], [3, 2])
    assert.equal((await s.getJob(j.jobId))?.status, 'fetched')
    assert.equal(await s.getJobResult(j.jobId), null)
  })
})

test('a cancelled or expired job takes no result, also when it was rejected before', async () => {
  await withStore(async (s) => {
    const cancelled = await newJob(s)
    await openJob(s, cancelled.jobId)
    await s.updateJob(cancelled.jobId, { status: 'cancelled' })
    assert.equal(must(await submitJobResult(s, { jobId: cancelled.jobId, inputRevision: 2, result: overview() }), 'closed').job.status, 'cancelled')
    assert.equal(await s.getJobResult(cancelled.jobId), null)
    assert.equal((await openJob(s, cancelled.jobId)).kind, 'closed')
    const st = await reportJobStatus(s, { jobId: cancelled.jobId, status: 'in_progress', message: 'still going' })
    assert.equal(st.kind === 'state' && st.job.status, 'cancelled')
    assert.equal(st.kind === 'state' && st.recorded, null)

    const expired = await newJob(s)
    await s.updateJob(expired.jobId, { expiresAt: new Date(Date.now() - 1000).toISOString() })
    assert.equal(must(await submitJobResult(s, { jobId: expired.jobId, inputRevision: 2, result: overview() }), 'closed').job.status, 'expired')
    assert.equal((await openJob(s, expired.jobId)).kind, 'closed')

    // rejected earlier, deadline passes: no second chance (the stored state stays rejected; it reads as expired)
    const late = await newJob(s)
    must(await submitJobResult(s, { jobId: late.jobId, inputRevision: 2, result: {} }), 'rejected')
    await s.updateJob(late.jobId, { expiresAt: new Date(Date.now() - 1000).toISOString() })
    assert.equal(must(await submitJobResult(s, { jobId: late.jobId, inputRevision: 2, result: overview() }), 'closed').job.status, 'expired')
    assert.equal(await s.getJobResult(late.jobId), null)

    // extended by the user: usable again
    await s.updateJob(late.jobId, { expiresAt: new Date(Date.now() + 60_000).toISOString() })
    must(await submitJobResult(s, { jobId: late.jobId, inputRevision: 2, result: overview() }), 'submitted')
  })
})

test('a result about another project is rejected', async () => {
  await withStore(async (s) => {
    const j = await newJob(s)
    const out = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview({ projectId: 'other-9' }) }), 'rejected')
    assert.match(out.errors.join(), /not "acme-1"/)
    const p = await newJob(s, { type: 'design_proposal' })
    const out2 = must(await submitJobResult(s, { jobId: p.jobId, inputRevision: 2, result: { proposals: [proposal('A', { projectId: 'other-9' })] } }), 'rejected')
    assert.match(out2.errors.join(), /\$\.proposals\[0\]\.projectId: is for project "other-9"/)
    const top = must(await submitJobResult(s, { jobId: p.jobId, inputRevision: 2, result: { projectId: 'other-9', proposals: [proposal('A')] } }), 'rejected')
    assert.match(top.errors.join(), /\$\.projectId/)
    const a = await newJob(s, { type: 'style_audit' })
    must(await submitJobResult(s, { jobId: a.jobId, inputRevision: 2, result: { projectId: 'other-9', findings: [] } }), 'rejected')
  })
})

test('an incomplete overview is stored with its gaps and can be completed until the deadline', async () => {
  await withStore(async (s) => {
    const j = await newJob(s)
    const weak = overview({ purpose: { value: 'maybe tracking tasks', source: 'estimated' }, workflows: [] })
    const out = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: weak }), 'submitted')
    assert.deepEqual(out.summary.completeness, { complete: false, gaps: ['purposeUnbacked', 'workflows'] })
    assert.equal((await s.getJob(j.jobId))?.status, 'submitted')
    assert.equal((await s.getJobResult<JobResultFile>(j.jobId))?.completeness?.complete, false)

    // an invalid replacement does not disturb the stored one
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: {} }), 'rejected')
    assert.equal((await s.getJob(j.jobId))?.status, 'submitted')
    assert.equal((await s.getJobResult<JobResultFile>(j.jobId))?.submission, 1)

    const full = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview() }), 'submitted')
    assert.equal(full.summary.submission, 2)
    assert.deepEqual(full.summary.completeness, { complete: true, gaps: [] })
    // complete now: further changes are refused
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: weak }), 'already_submitted')
  })
})

// ---------- other job types ----------

test('skill_setup: fields for the job\'s skill; another skill or project is rejected', async () => {
  await withStore(async (s) => {
    const j = await s.createJob({ type: 'skill_setup', projectId: PID, inputRevision: 1, skillId: 'uupm', input: { skill: { id: 'uupm', name: 'UI UX Pro Max', source: 'agent' } } })
    const good = { projectId: PID, skillId: 'uupm', fields: { framework: { value: 'static HTML', source: 'verified', evidence: ev } }, missing: ['brand_colors'] }
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 1, result: { ...good, skillId: 'other' } }), 'rejected')
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 1, result: good }), 'submitted')
    const file = await s.getJobResult<JobResultFile>(j.jobId)
    assert.equal(file?.skillContext?.skill.name, 'UI UX Pro Max')
    assert.deepEqual(file?.skillContext?.missing, ['brand_colors'])
    const noSkill = await s.createJob({ type: 'skill_setup', projectId: PID, inputRevision: 1 })
    assert.match(must(await submitJobResult(s, { jobId: noSkill.jobId, inputRevision: 1, result: good }), 'rejected').errors.join(), /no skill id/)
  })
})

test('capabilities: installed skills are stored as agent skills', async () => {
  await withStore(async (s) => {
    const j = await s.createJob({ type: 'capabilities', projectId: PID, inputRevision: 0 })
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 0, result: { skills: [{ id: 'ui-ux-pro-max', name: 'UI UX Pro Max', source: 'builtin' }] } }), 'submitted')
    assert.equal((await s.getJobResult<JobResultFile>(j.jobId))?.skills?.[0].source, 'agent')
    const j2 = await s.createJob({ type: 'capabilities', projectId: PID, inputRevision: 0 })
    must(await submitJobResult(s, { jobId: j2.jobId, inputRevision: 0, result: { skills: [{ id: 'bad id', name: 'x' }] } }), 'rejected')
  })
})

test('style_audit findings: provenance and project-relative evidence are enforced', async () => {
  await withStore(async (s) => {
    const finding = { area: 'Buttons', issue: 'Three different radii', source: 'verified', evidence: [{ path: 'src/styles/button.css', note: 'line 12' }], suggestion: 'Use radius 8 everywhere' }
    const bad = [
      { ...finding, evidence: undefined },
      { ...finding, evidence: [{ path: 'C:\\Users\\me\\x.css' }] },
      { ...finding, evidence: [{ path: '../secret.css' }] },
      { ...finding, source: 'guess' },
      { ...finding, suggestion: '' }
    ]
    for (const f of bad) {
      const j = await s.createJob({ type: 'style_audit', projectId: PID, inputRevision: 1 })
      must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 1, result: { findings: [f] } }), 'rejected')
    }
    const j = await s.createJob({ type: 'style_audit', projectId: PID, inputRevision: 1 })
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 1, result: { findings: [finding, { ...finding, area: 'Cards', source: 'estimated', evidence: undefined }] } }), 'submitted')
    assert.equal((await s.getJobResult<JobResultFile>(j.jobId))?.findings?.length, 2)
    const empty = await s.createJob({ type: 'style_audit', projectId: PID, inputRevision: 1 })
    must(await submitJobResult(s, { jobId: empty.jobId, inputRevision: 1, result: { findings: [] } }), 'submitted')
  })
})

test('style audit validator: bounded and tolerant of extra keys', () => {
  assert.equal(readStyleAudit({ findings: 'nope' }, { projectId: PID }).ok, false)
  assert.equal(readStyleAudit(null, { projectId: PID }).ok, false)
  assert.equal(readStyleAudit({ findings: Array.from({ length: 41 }, () => ({})) }, { projectId: PID }).ok, false)
  const r = readStyleAudit({ findings: [{ area: ' A ', issue: 'i', source: 'user', suggestion: 's', extra: 1 }] }, { projectId: PID })
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.value, [{ area: 'A', issue: 'i', source: 'user', suggestion: 's' }])
})

// ---------- design proposals and mock-up images ----------

test('design_proposal: up to 4, duplicates by proposalId dropped, each with its own mock-up file', async () => {
  await withStore(async (s, root) => {
    const j = await newJob(s, { type: 'design_proposal', input: { overviewRevision: 4, rulesRevision: 1 } })
    const image = png()
    const result = { proposals: [proposal('A', { previewPngBase64: b64(image) }), proposal('B'), proposal('A', { name: 'again' }), proposal('C', { direction: 'C' })] }
    const out = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result }), 'submitted')
    assert.deepEqual(out.summary.proposalIds, ['A', 'B', 'C'])
    assert.deepEqual(out.summary.dedupedProposalIds, ['A'])
    assert.deepEqual(out.summary.previewRefs, [`${j.jobId}.A.png`])
    const file = await s.getJobResult<JobResultFile>(j.jobId)
    const a = file?.proposals?.[0]
    assert.equal(a?.name, 'Variant A', 'the first A counts')
    assert.equal(a?.previewKind, 'mockup')
    assert.equal(a?.previewRef, `${j.jobId}.A.png`)
    assert.equal(a?.inputRevision, 2)
    assert.equal(a?.overviewRevision, 4)
    assert.equal(a?.rulesRevision, 1)
    assert.equal(a?.checks[0].status, 'unverified')
    assert.equal(file?.proposals?.[1].previewRef, undefined)
    assert.ok((await s.readJobFile(j.jobId, 'A.png'))?.equals(image))
    assert.deepEqual((await readdir(join(root, 'jobs'))).filter((n) => n.endsWith('.png')), [`${j.jobId}.A.png`])
    assert.equal((await s.listJobs()).length, 1, 'extra files are not jobs')
  })
})

test('design_proposal: none, too many different ones, and a bad one among good ones are rejected', async () => {
  await withStore(async (s, root) => {
    const j = await newJob(s, { type: 'design_proposal' })
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: { proposals: [] } }), 'rejected')
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: { nothing: 1 } }), 'rejected')
    const five = ['A', 'B', 'C', 'D', 'E'].map((id) => proposal(id))
    assert.match(must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: { proposals: five } }), 'rejected').errors.join(), /more than 4/)
    // four different ones plus repeats are fine
    const four = ['A', 'B', 'C', 'D'].map((id) => proposal(id))
    const withBad = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: { proposals: [...four.slice(0, 3), { ...proposal('D'), tokens: {} }] } }), 'rejected')
    assert.ok(withBad.errors.some((e) => e.startsWith('$.proposals[3].tokens')), withBad.errors.join('\n'))
    assert.deepEqual((await readdir(join(root, 'jobs'))).filter((n) => n.endsWith('.png')), [])
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: { proposals: [...four, proposal('B')] } }), 'submitted')
  })
})

test('mock-up image checks: signature, size, dimensions, encoding; nothing is written when one fails', async () => {
  await withStore(async (s, root) => {
    const j = await newJob(s, { type: 'design_proposal' })
    const cases: [string, unknown, RegExp][] = [
      ['not a PNG', b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.repeat(3))), /too short|signature/],
      ['JPEG bytes', b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(80, 7)])), /signature/],
      ['data URL', `data:image/png;base64,${b64(png())}`, /data: URL/],
      ['not base64', '!!!not base64!!!', /base64/],
      ['too wide', b64(png(8001, 10)), /8001x10/],
      ['zero height', b64(png(10, 0)), /10x0/],
      ['truncated', b64(png().subarray(0, png().length - 5)), /cut off/],
      ['too big', 'A'.repeat(Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 + 4), /8 MB/],
      ['a number', 12, /string/]
    ]
    for (const [name, value, re] of cases) {
      const out = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: { proposals: [proposal('A', { previewPngBase64: value })] } }), 'rejected')
      assert.match(out.errors.join(), re, name)
      assert.match(out.errors.join(), /\$\.proposals\[0\]\.previewPngBase64/, name)
    }
    assert.deepEqual((await readdir(join(root, 'jobs'))).filter((n) => n.endsWith('.png')), [])
    // limits themselves are fine
    const edge = png(8000, 1)
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: { proposals: [proposal('A', { previewPngBase64: b64(edge) })] } }), 'submitted')
  })
})

test('checkPngBase64: line breaks are ignored, a real PNG reports its size', () => {
  const text = b64(png(3, 5)).replace(/(.{20})/g, '$1\n')
  const r = checkPngBase64(text)
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual([r.width, r.height], [3, 5])
  assert.equal(checkPngBase64('').ok, false)
  assert.equal(checkPngBase64(b64(png()).slice(0, -1)).ok, false)
})

// ---------- status reports ----------

test('job_status: in_progress only notes it, failed ends the job', async () => {
  await withStore(async (s) => {
    const j = await newJob(s)
    const p = await reportJobStatus(s, { jobId: j.jobId, status: 'in_progress', message: 'reading docs\n  and code' })
    assert.equal(p.kind === 'state' && p.recorded, 'progress')
    assert.equal(p.kind === 'state' && p.job.status, 'pending', 'progress does not count as fetched')
    const note = JSON.parse((await s.readJobFile(j.jobId, 'progress.txt'))?.toString('utf8') ?? '{}') as { message?: string; at?: string }
    assert.equal(note.message, 'reading docs and code')
    assert.ok(note.at)
    await openJob(s, j.jobId)
    const f = await reportJobStatus(s, { jobId: j.jobId, status: 'failed', message: 'x'.repeat(900) })
    assert.equal(f.kind === 'state' && f.recorded, 'failed')
    const stored = await s.getJob(j.jobId)
    assert.equal(stored?.status, 'failed')
    assert.equal(stored?.error?.length, 500)
    assert.equal((await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: overview() })).kind, 'closed')
    const again = await reportJobStatus(s, { jobId: j.jobId, status: 'in_progress' })
    assert.equal(again.kind === 'state' && again.job.status, 'failed')
    // a finished job keeps its state
    const done = await newJob(s)
    await submitJobResult(s, { jobId: done.jobId, inputRevision: 2, result: overview() })
    const late = await reportJobStatus(s, { jobId: done.jobId, status: 'failed', message: 'oops' })
    assert.equal(late.kind === 'state' && late.job.status, 'submitted')
    assert.equal((await s.getJob(done.jobId))?.status, 'submitted')
  })
})

// ---------- store helpers and schemas ----------

test('job files: only .png / .txt next to the job, safe names', async () => {
  await withStore(async (s) => {
    const j = await newJob(s)
    for (const bad of ['x.json', '../a.png', 'a/b.png', '.png', 'a..b.png', 'x'.repeat(90) + '.png']) {
      await assert.rejects(s.saveJobFile(j.jobId, bad, 'x'), /invalid job file name/, bad)
    }
    await assert.rejects(s.saveJobFile('../x', 'a.png', 'x'), /invalid jobId/)
    assert.equal(await s.saveJobFile(j.jobId, 'a.png', Buffer.from([1, 2])), `${j.jobId}.a.png`)
    assert.deepEqual(await s.readJobFile(j.jobId, 'a.png'), Buffer.from([1, 2]))
    assert.equal(await s.readJobFile(j.jobId, 'b.png'), null)
  })
})

test('every job type has a result schema that asks for what the validators require', () => {
  for (const t of JOB_TYPES) {
    const sc = resultSchema(t) as { $schema?: string; required?: string[]; type?: string }
    assert.equal(sc.type, 'object', t)
    assert.ok(sc.$schema)
    JSON.stringify(sc) // plain data
  }
  assert.ok((resultSchema('project_overview') as { required: string[] }).required.includes('projectId'))
  assert.ok((resultSchema('design_proposal') as { required: string[] }).required.includes('proposals'))
  assert.ok((resultSchema('style_audit') as { required: string[] }).required.includes('findings'))
})

// ---------- implementation_report ----------

const report = (over: Record<string, unknown> = {}) => ({
  summary: 'Darkened the primary button and kept the layout',
  changedFiles: [{ path: 'src/styles/button.css', note: 'primary colour' }, { path: 'src/App.tsx' }],
  notDone: ['Dark theme: not requested in this send'],
  checksRun: ['npm test'],
  ...over
})

test('implementation_report: accepted, stored as report, the agent\'s own account', async () => {
  await withStore(async (s) => {
    const j = await newJob(s, { type: 'implementation_report', inputRevision: 0, input: { sessionDir: '20261027-100000-000-aaaa' } })
    const open = await openJob(s, j.jobId)
    assert.equal(open.kind === 'open' && open.job.status, 'fetched')
    const out = must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 0, result: { projectId: PID, ...report() } }), 'submitted')
    assert.equal(out.summary.changedFiles, 2)
    assert.equal((await s.getJob(j.jobId))?.status, 'submitted')
    const file = await s.getJobResult<JobResultFile>(j.jobId)
    assert.equal(file?.type, 'implementation_report')
    assert.deepEqual(file?.report, { summary: 'Darkened the primary button and kept the layout', changedFiles: [{ path: 'src/styles/button.css', note: 'primary colour' }, { path: 'src/App.tsx' }], notDone: ['Dark theme: not requested in this send'], checksRun: ['npm test'] })
    // empty lists are fine: the agent may have changed nothing and say so
    const none = await newJob(s, { type: 'implementation_report' })
    must(await submitJobResult(s, { jobId: none.jobId, inputRevision: 2, result: report({ changedFiles: [], notDone: [], checksRun: [] }) }), 'submitted')
  })
})

test('implementation_report: another project, absolute or escaping paths, empty summary and long lists are rejected', async () => {
  await withStore(async (s) => {
    const j = await newJob(s, { type: 'implementation_report' })
    const send = async (result: unknown) => must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result }), 'rejected').errors.join('\n')
    assert.match(await send(report({ projectId: 'other-9' })), /\$\.projectId: is for project "other-9"/)
    for (const path of ['C:\\Users\\me\\app\\a.css', 'D:/work/a.css', '/etc/passwd', '\\\\server\\share\\a.css', '~/a.css', '../outside.css', 'src/../../x.css']) {
      assert.match(await send(report({ changedFiles: [{ path }] })), /\$\.changedFiles\[0\]\.path: must be a project-relative path/, path)
    }
    assert.match(await send(report({ summary: '  ' })), /\$\.summary: must not be empty/)
    assert.match(await send(report({ summary: 'x'.repeat(1501) })), /longer than 1500/)
    assert.match(await send(report({ notDone: Array.from({ length: 41 }, () => 'x') })), /more than 40/)
    assert.match(await send(report({ checksRun: [5] })), /\$\.checksRun\[0\]: expected a string/)
    assert.match(await send(report({ changedFiles: 'src/a.css' })), /expected a list/)
    assert.match(await send('nope-not-json'), /not valid JSON/)
    assert.equal(await s.getJobResult(j.jobId), null)
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: report() }), 'submitted')
  })
})

test('implementation_report: the same report twice is one result; a different one is refused', async () => {
  await withStore(async (s) => {
    const j = await newJob(s, { type: 'implementation_report' })
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: report() }), 'submitted')
    const before = await s.getJobResult<JobResultFile>(j.jobId)
    assert.equal(must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: report() }), 'submitted').duplicate, true)
    must(await submitJobResult(s, { jobId: j.jobId, inputRevision: 2, result: report({ summary: 'Another story' }) }), 'already_submitted')
    assert.deepEqual(await s.getJobResult(j.jobId), before)
  })
})
