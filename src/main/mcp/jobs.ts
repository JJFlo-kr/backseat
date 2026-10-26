// Agent jobs (spec §11): what happens when an agent opens a job, reports on it and submits a result.
// Pure logic over UiuxStore (plain Node, no Electron, no MCP types) so tests can drive it directly;
// src/main/mcp/jobtools.ts turns the outcomes into tool replies.
//
// Lifecycle: pending → fetched (backseat_job_get) → submitted (valid result). An invalid result sets the status
// to rejected and the agent may submit again until the deadline. cancelled / expired / failed / submitted are
// final: they are reported as such and never reopened. The one exception is an overview that arrived incomplete:
// the agent may replace it with a complete one until the deadline (the stored result then has submission 2, …).
//
// What lands in jobs/<jobId>.result.json is a JobResultFile: the validated (normalised) data, never the raw text
// the agent sent. Mock-up images go next to it as jobs/<jobId>.<proposalId>.png and are referenced by file name.
import { createHash } from 'crypto'
import {
  UIUX_SCHEMA_VERSION, type DesignProposal, type ImplementationReport, type JobType, type ProjectOverview, type SkillContext, type SkillRef,
  type StyleFinding, type UiuxJob
} from '../../shared/uiux/types'
import {
  isObj, overviewCompleteness, readOverview, readProposal, readSkillContext, readSkillList, type OverviewGap
} from '../../shared/uiux/validate'
import { UiuxStore, assertSafeId } from '../uiux/store'
import { checkPngBase64 } from './jobimage'
import { isJobType } from './jobspec'
import { readImplementationReport, readStyleAudit } from './styleaudit'

export const MAX_PROPOSALS = 4
/** Proposals read from one submission before duplicates are dropped (a flood guard, not a product limit). */
const MAX_RAW_PROPOSALS = 12
export const MAX_NOTE = 500

// ---------- stored result ----------

export interface OverviewCompletenessReport {
  complete: boolean
  gaps: OverviewGap[]
}

/** jobs/<jobId>.result.json. Exactly one payload field is set, by `type`. */
export interface JobResultFile {
  schemaVersion: number
  jobId: string
  type: JobType
  projectId: string
  inputRevision: number
  submittedAt: string
  /** 1 for the first accepted result; an incomplete overview can be replaced, which counts up. */
  submission: number
  /** Hash of the submitted data: the same data again is a duplicate, not a new result. */
  fingerprint: string
  /** project_overview: ready for UiuxStore.saveOverview (add basis 'agent', generatedAt and jobId). */
  overview?: Omit<ProjectOverview, 'revision' | 'basis' | 'generatedAt' | 'jobId'>
  completeness?: OverviewCompletenessReport
  /** skill_setup: ready for UiuxStore.saveSkillContext (add generatedAt and jobId). */
  skillContext?: Pick<SkillContext, 'skill' | 'fields' | 'missing'>
  /** capabilities */
  skills?: SkillRef[]
  /** design_proposal: previewRef is the name of a PNG in the jobs folder (previewKind 'mockup'). */
  proposals?: DesignProposal[]
  dedupedProposalIds?: string[]
  /** style_audit */
  findings?: StyleFinding[]
  /** implementation_report: the agent's own account of what it changed. A claim, not proof: the user confirms by capturing again. */
  report?: ImplementationReport
}

// ---------- states ----------

const OPEN: readonly string[] = ['pending', 'fetched', 'rejected']

/** The job as the agent must see it: a missed deadline makes pending, fetched and rejected jobs expired. */
export function effectiveJob(job: UiuxJob, now = Date.now()): UiuxJob {
  if (OPEN.includes(job.status) && Date.parse(job.expiresAt) < now) return { ...job, status: 'expired' }
  return job
}

async function findJob(store: UiuxStore, jobId: string): Promise<UiuxJob | null> {
  try {
    assertSafeId(jobId, 'jobId')
  } catch {
    return null
  }
  const j = await store.getJob(jobId)
  return j ? effectiveJob(j) : null
}

const locks = new Map<string, Promise<unknown>>()

/** Calls for one job run one after another in this process (a double submit must not write twice). */
async function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(jobId) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  locks.set(jobId, tail)
  try {
    return await run
  } finally {
    if (locks.get(jobId) === tail) locks.delete(jobId)
  }
}

const noteOf = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE)

// ---------- backseat_job_get ----------

export type OpenOutcome =
  | { kind: 'not_found' }
  /** cancelled, expired, failed or submitted: reported, not reopened. */
  | { kind: 'closed'; job: UiuxJob }
  | { kind: 'unsupported'; job: UiuxJob }
  | { kind: 'open'; job: UiuxJob; input: unknown; firstFetch: boolean }

/** Marks a pending job fetched (fetchedAt) and returns it with its input. */
export function openJob(store: UiuxStore, jobId: string): Promise<OpenOutcome> {
  return withJobLock(jobId, async () => {
    let job = await findJob(store, jobId)
    if (!job) return { kind: 'not_found' }
    if (!OPEN.includes(job.status)) return { kind: 'closed', job }
    if (!isJobType(job.type)) return { kind: 'unsupported', job }
    const input = await store.getJobInput(jobId).catch(() => null)
    let firstFetch = false
    if (job.status === 'pending') {
      // The app may have cancelled the job in the meantime: look again right before writing.
      const fresh = await findJob(store, jobId)
      if (!fresh) return { kind: 'not_found' }
      if (!OPEN.includes(fresh.status)) return { kind: 'closed', job: fresh }
      job = fresh
      if (fresh.status === 'pending') {
        job = await store.updateJob(jobId, { status: 'fetched', fetchedAt: new Date().toISOString() })
        firstFetch = true
      }
    }
    return { kind: 'open', job, input, firstFetch }
  })
}

// ---------- backseat_job_status ----------

export type StatusOutcome =
  | { kind: 'not_found' }
  /** Final or running state, as stored (cancelled, expired, failed, submitted, pending, fetched, rejected). */
  | { kind: 'state'; job: UiuxJob; recorded: 'progress' | 'failed' | null }

export function reportJobStatus(store: UiuxStore, req: { jobId: string; status: 'in_progress' | 'failed'; message?: string }): Promise<StatusOutcome> {
  return withJobLock(req.jobId, async () => {
    const job = await findJob(store, req.jobId)
    if (!job) return { kind: 'not_found' }
    if (!OPEN.includes(job.status)) return { kind: 'state', job, recorded: null }
    const message = noteOf(req.message)
    if (req.status === 'failed') {
      const next = await store.updateJob(req.jobId, { status: 'failed', error: message || 'failed' })
      return { kind: 'state', job: next, recorded: 'failed' }
    }
    // in_progress is not a stored status: the deadline, the state and updatedAt stay as they are, plus a note.
    await store.saveJobFile(req.jobId, 'progress.txt', JSON.stringify({ at: new Date().toISOString(), message }))
    const next = await store.updateJob(req.jobId, {})
    return { kind: 'state', job: next, recorded: 'progress' }
  })
}

// ---------- backseat_job_submit ----------

export interface SubmitSummary {
  type: JobType
  resultRef: string
  submission: number
  completeness?: OverviewCompletenessReport
  proposalIds?: string[]
  dedupedProposalIds?: string[]
  /** File names of the stored mock-ups, in proposal order. */
  previewRefs?: string[]
  findings?: number
  skills?: number
  /** implementation_report: how many changed files the agent listed. */
  changedFiles?: number
}

export type SubmitOutcome =
  | { kind: 'not_found' }
  | { kind: 'closed'; job: UiuxJob }
  | { kind: 'unsupported'; job: UiuxJob }
  | { kind: 'stale'; expected: number; got: number }
  /** A different result for a job that already has an accepted one. */
  | { kind: 'already_submitted'; job: UiuxJob }
  | { kind: 'rejected'; job: UiuxJob; errors: string[] }
  | { kind: 'submitted'; job: UiuxJob; duplicate: boolean; summary: SubmitSummary }

/** Key order does not matter for "the same result". */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}
const fingerprintOf = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex')

function summaryOf(file: JobResultFile): SubmitSummary {
  const s: SubmitSummary = { type: file.type, resultRef: `${file.jobId}.result.json`, submission: file.submission }
  if (file.completeness) s.completeness = file.completeness
  if (file.proposals) {
    s.proposalIds = file.proposals.map((p) => p.proposalId)
    s.previewRefs = file.proposals.flatMap((p) => (p.previewRef ? [p.previewRef] : []))
  }
  if (file.dedupedProposalIds?.length) s.dedupedProposalIds = file.dedupedProposalIds
  if (file.findings) s.findings = file.findings.length
  if (file.skills) s.skills = file.skills.length
  if (file.report) s.changedFiles = file.report.changedFiles.length
  return s
}

type Validated =
  | { ok: true; payload: Partial<JobResultFile>; images: { suffix: string; bytes: Buffer }[] }
  | { ok: false; errors: string[] }

/** The skill a skill_setup job is about: what the job input says, else just the id the job carries. */
function skillFor(job: UiuxJob, input: unknown): SkillRef | null {
  if (!job.skillId) return null
  const s = isObj(input) && isObj(input.skill) ? input.skill : {}
  const ref: SkillRef = {
    id: job.skillId,
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : job.skillId,
    source: s.source === 'builtin' || s.source === 'imported' ? s.source : 'agent'
  }
  if (typeof s.version === 'string' && s.version.trim()) ref.version = s.version.trim().slice(0, 40)
  if (typeof s.description === 'string' && s.description.trim()) ref.description = s.description.trim().slice(0, 600)
  return ref
}

const inRevision = (input: unknown, key: 'overviewRevision' | 'rulesRevision'): number | undefined => {
  const v = isObj(input) ? input[key] : undefined
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined
}

function validateResult(job: UiuxJob, input: unknown, raw: unknown): Validated {
  switch (job.type) {
    case 'project_overview': {
      const r = readOverview(raw, job.projectId)
      if (!r.ok) return r
      return { ok: true, payload: { overview: r.value, completeness: overviewCompleteness(r.value) }, images: [] }
    }
    case 'skill_setup': {
      const skill = skillFor(job, input)
      if (!skill) return { ok: false, errors: ['$: this job has no skill id; ask the user to start it again'] }
      const r = readSkillContext(raw, { projectId: job.projectId, skill })
      if (!r.ok) return r
      return { ok: true, payload: { skillContext: { skill, ...r.value } }, images: [] }
    }
    case 'capabilities': {
      const r = readSkillList(raw)
      if (!r.ok) return r
      return { ok: true, payload: { skills: r.value }, images: [] }
    }
    case 'style_audit': {
      const r = readStyleAudit(raw, { projectId: job.projectId })
      if (!r.ok) return r
      return { ok: true, payload: { findings: r.value }, images: [] }
    }
    case 'implementation_report': {
      const r = readImplementationReport(raw, { projectId: job.projectId })
      if (!r.ok) return r
      return { ok: true, payload: { report: r.value }, images: [] }
    }
    case 'design_proposal':
      return validateProposals(job, input, raw)
  }
}

function validateProposals(job: UiuxJob, input: unknown, raw: unknown): Validated {
  const errors: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['$: expected an object like { "proposals": [ ... ] }'] }
  if (typeof raw.projectId === 'string' && raw.projectId.trim() && raw.projectId.trim() !== job.projectId) {
    errors.push(`$.projectId: is for project "${raw.projectId.trim().slice(0, 64)}", not "${job.projectId}"`)
  }
  if (!Array.isArray(raw.proposals)) return { ok: false, errors: [...errors, '$.proposals: expected a list'] }
  if (raw.proposals.length < 1) errors.push('$.proposals: needs at least 1 item(s)')
  if (raw.proposals.length > MAX_RAW_PROPOSALS) errors.push(`$.proposals: more than ${MAX_RAW_PROPOSALS} items`)
  const overviewRevision = inRevision(input, 'overviewRevision')
  const rulesRevision = inRevision(input, 'rulesRevision')
  const seen = new Set<string>()
  const deduped: string[] = []
  const proposals: DesignProposal[] = []
  const images: { suffix: string; bytes: Buffer }[] = []
  raw.proposals.slice(0, MAX_RAW_PROPOSALS).forEach((item, i) => {
    const path = `$.proposals[${i}]`
    const pid = isObj(item) && typeof item.proposalId === 'string' ? item.proposalId.trim() : ''
    // The same proposalId twice is one proposal: the first one counts.
    if (pid && seen.has(pid)) {
      deduped.push(pid)
      return
    }
    const r = readProposal(item, { projectId: job.projectId, inputRevision: job.inputRevision })
    if (!r.ok) {
      errors.push(...r.errors.map((e) => path + e.slice(1)))
      return
    }
    seen.add(r.value.proposalId)
    const p = r.value
    if (overviewRevision !== undefined) p.overviewRevision = overviewRevision
    if (rulesRevision !== undefined) p.rulesRevision = rulesRevision
    const img = isObj(item) ? item.previewPngBase64 : undefined
    if (img !== undefined && img !== null) {
      const png = checkPngBase64(img)
      if (!png.ok) errors.push(`${path}.previewPngBase64: ${png.error}`)
      else {
        const suffix = `${p.proposalId}.png`
        p.previewKind = 'mockup'
        p.previewRef = `${job.jobId}.${suffix}`
        images.push({ suffix, bytes: png.bytes })
      }
    }
    proposals.push(p)
  })
  if (proposals.length > MAX_PROPOSALS) errors.push(`$.proposals: more than ${MAX_PROPOSALS} different proposals`)
  if (errors.length) return { ok: false, errors: errors.slice(0, 50) }
  const payload: Partial<JobResultFile> = { proposals }
  if (deduped.length) payload.dedupedProposalIds = deduped
  return { ok: true, payload, images }
}

/** A result the agent sent as JSON text instead of an object is read as JSON. */
function parseResult(result: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof result !== 'string') return { ok: true, value: result }
  try {
    return { ok: true, value: JSON.parse(result) as unknown }
  } catch {
    return { ok: false, error: '$: the result is text but not valid JSON' }
  }
}

export function submitJobResult(store: UiuxStore, req: { jobId: string; inputRevision: number; result: unknown }): Promise<SubmitOutcome> {
  return withJobLock(req.jobId, async () => {
    const job = await findJob(store, req.jobId)
    if (!job) return { kind: 'not_found' }
    // A cancelled, expired or failed job: whatever arrives now is a late answer and changes nothing.
    if (job.status === 'cancelled' || job.status === 'expired' || job.status === 'failed') return { kind: 'closed', job }
    if (!isJobType(job.type)) return { kind: 'unsupported', job }
    if (req.inputRevision !== job.inputRevision) return { kind: 'stale', expected: job.inputRevision, got: req.inputRevision }

    const parsed = parseResult(req.result)
    const fingerprint = fingerprintOf(parsed.ok ? parsed.value : req.result)
    let submission = 1
    if (job.status === 'submitted') {
      const prev = await store.getJobResult<JobResultFile>(req.jobId)
      if (prev && prev.fingerprint === fingerprint) return { kind: 'submitted', job, duplicate: true, summary: summaryOf(prev) }
      // An overview that arrived incomplete may be completed until the deadline; nothing else is replaced.
      const replaceable = prev?.type === 'project_overview' && prev.completeness?.complete === false && Date.parse(job.expiresAt) >= Date.now()
      if (!prev || !replaceable) return { kind: 'already_submitted', job }
      submission = prev.submission + 1
    }

    const reject = async (errors: string[]): Promise<SubmitOutcome> => {
      const next = job.status === 'submitted' ? job : await store.updateJob(req.jobId, { status: 'rejected', error: noteOf(errors.slice(0, 5).join('; ')) })
      return { kind: 'rejected', job: next, errors }
    }
    if (!parsed.ok) return reject([parsed.error])
    const input = await store.getJobInput(req.jobId).catch(() => null)
    const v = validateResult(job, input, parsed.value)
    if (!v.ok) return reject(v.errors)

    // The app may have cancelled the job while the result was being checked: look again right before writing.
    const fresh = await findJob(store, req.jobId)
    if (!fresh) return { kind: 'not_found' }
    if (fresh.status === 'cancelled' || fresh.status === 'expired' || fresh.status === 'failed') return { kind: 'closed', job: fresh }

    const file: JobResultFile = {
      schemaVersion: UIUX_SCHEMA_VERSION,
      jobId: job.jobId,
      type: job.type,
      projectId: job.projectId,
      inputRevision: job.inputRevision,
      submittedAt: new Date().toISOString(),
      submission,
      fingerprint,
      ...v.payload
    }
    for (const img of v.images) await store.saveJobFile(job.jobId, img.suffix, img.bytes)
    const resultRef = await store.saveJobResult(job.jobId, file)
    const next = await store.updateJob(job.jobId, { status: 'submitted', resultRef, error: undefined })
    return { kind: 'submitted', job: next, duplicate: false, summary: summaryOf(file) }
  })
}
