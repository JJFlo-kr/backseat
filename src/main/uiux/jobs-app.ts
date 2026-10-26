// Agent jobs and overview files in the app (stages B–D): the user asks the project's agent for something, the agent
// answers through the MCP job tools (src/main/mcp/jobs.ts) into the same store, and this module hands the stored
// results to the panel. Renderer input is checked here again: the renderer is sandboxed but not trusted.
import { BrowserWindow, clipboard, ClipboardItem, ipcMain } from 'electron'
import { readFile, stat, writeFile } from 'fs/promises'
import { IPC } from '../../shared/ipc'
import { t } from '../../shared/i18n'
import type { ExportPayload, SendResult, UserOverviewInput } from '../../shared/types'
import { BUILTIN_SKILL } from '../../shared/uiux/builtin'
import { applyOverviewEdits, mergeOverview, mergeSkillFields, sameOverviewContent, SCREEN_PREFIX } from '../../shared/uiux/overviewMerge'
import {
  UIUX_SCHEMA_VERSION, type DesignProposal, type DesignRequest, type JobOutcome, type JobRequest, type ProjectOverview, type ReportConfirmation, type SkillContext, type TokenChange,
  type SkillRef, type UiuxJob
} from '../../shared/uiux/types'
import { isObj, readOverview } from '../../shared/uiux/validate'
import { showOpen, showSave } from '../dialogs'
import { briefTranslator } from '../locales'
import { effectiveJob, type JobResultFile } from '../mcp/jobs'
import { uiuxStore } from './appstore'
import { isJobType } from '../mcp/jobspec'
import { omit, text, texts } from './clean'
import { buildJobInput, buildRequestText, clampMinutes, inputRevisionFor, REPORT_JOB_MINUTES } from './jobinput'
import { JobWatcher } from './jobwatch'
import { profileToMarkdown } from './overviewmd'
import { overviewToMarkdown } from '../../shared/uiux/overviewText'
import { buildProfileBundle, findAbsolutePaths, scrubOverview, MAX_OVERVIEW_BYTES, MAX_PROFILE_BYTES, parseProfileBundle, PROFILE_KIND } from './profileio'
import { checkPreviewPng, hasUiuxGuidance } from './package'
import { assertSafeId, DEFAULT_JOB_MINUTES } from './store'
import type { PasteOutcome } from './jobpaste'

const OPEN = ['pending', 'fetched', 'rejected']
const newestFirst = (a: { createdAt: string }, b: { createdAt: string }): number => b.createdAt.localeCompare(a.createdAt)

// ---------- dialogs (replaceable in tests) ----------

export interface Dialogs {
  openFile(win: BrowserWindow | null, title: string): Promise<string | null>
  saveFile(win: BrowserWindow | null, opts: { title: string; defaultName: string; ext: string; name: string }): Promise<string | null>
  pickFolder(win: BrowserWindow | null): Promise<string | null>
}

export const dialogs: Dialogs = {
  openFile(win, title) {
    return showOpen(win, { title, properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
  },
  async saveFile(win, o) {
    const r = await showSave(win, { title: o.title, defaultPath: o.defaultName, filters: [{ name: o.name, extensions: [o.ext] }] })
    if (r.canceled || !r.filePath) return null
    return r.filePath.toLowerCase().endsWith(`.${o.ext}`) ? r.filePath : `${r.filePath}.${o.ext}`
  },
  pickFolder(win) {
    return showOpen(win, { properties: ['openDirectory'] })
  }
}

/** Test hook. */
export function setDialogsForTest(d: Partial<Dialogs>): void {
  Object.assign(dialogs, d)
}

const fileSafe = (name: string): string => name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'project'

// ---------- skills ----------

/** The skill with this id for the project: Backseat's own, or one the agent reported in its latest capabilities job. */
async function resolveSkill(projectId: string, skillId: string): Promise<SkillRef | null> {
  if (skillId === BUILTIN_SKILL.id) return BUILTIN_SKILL
  const { agent } = await skills(projectId)
  return agent.find((s) => s.id === skillId) ?? null
}

export async function skills(projectId: unknown): Promise<{ agent: SkillRef[]; contexts: SkillContext[]; capabilitiesJob?: UiuxJob }> {
  const s = uiuxStore()
  const pid = assertSafeId(text(projectId, 64), 'projectId')
  const [submitted, contexts] = await Promise.all([s.listJobs({ projectId: pid, status: ['submitted'] }), s.listSkillContexts(pid)])
  const jobs = submitted.filter((j) => j.type === 'capabilities').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  // The newest answer counts; an older one only when the newest result cannot be read.
  for (const job of jobs) {
    const res = await s.getJobResult<JobResultFile>(job.jobId).catch(() => null)
    if (res?.skills) return { agent: res.skills, contexts, capabilitiesJob: job }
  }
  return { agent: [], contexts }
}

// ---------- requesting jobs ----------

let counterLock: Promise<unknown> = Promise.resolve()

/** The next design_proposal request number of the project, stored with it. */
function nextRequestNumber(projectId: string): Promise<number> {
  const run = async (): Promise<number> => {
    const s = uiuxStore()
    const p = await s.getProject(projectId)
    if (!p) throw new Error('unknown project')
    const n = (p.proposalRequests ?? 0) + 1
    await s.saveProject({ ...p, proposalRequests: n })
    return n
  }
  const result = counterLock.then(run, run)
  counterLock = result.catch(() => undefined)
  return result
}

function checkedPng(dataUrl: unknown, what: string): Buffer {
  const c = checkPreviewPng(dataUrl)
  if (!c.ok) throw new Error(`${what} is not a usable PNG (${c.reason})`)
  return c.bytes
}

export async function requestJob(projectId: unknown, req: JobRequest): Promise<{ job: UiuxJob; requestText: string }> {
  const s = uiuxStore()
  const pid = assertSafeId(text(projectId, 64), 'projectId')
  if (!req || !isJobType(req.type)) throw new Error('unknown job type')
  const profile = await s.getProject(pid)
  if (!profile) throw new Error('unknown project')
  const [overview, rules, paths] = await Promise.all([s.getOverview(pid), s.getRules(pid), s.getPaths()])
  const skillId = text(req.skillId, 64)
  let skill: SkillRef | undefined
  if (skillId) {
    const found = await resolveSkill(pid, skillId)
    if (!found) throw new Error('unknown skill')
    skill = found
  }
  if (req.type === 'skill_setup' && !skill) throw new Error('skill_setup needs a skill')
  const skillContext = skill ? await s.getSkillContext(pid, skill.id) : null
  const needsImages = req.type === 'design_proposal' || req.type === 'style_audit'
  const capture = needsImages && req.capturePng ? checkedPng(req.capturePng, 'capture') : null
  const annotated = needsImages && req.annotatedPng ? checkedPng(req.annotatedPng, 'annotated capture') : null
  // After the images passed: a refused request does not use up a request number.
  const requestNumber = req.type === 'design_proposal' ? await nextRequestNumber(pid) : undefined
  const clean: JobRequest = { type: req.type }
  if (req.scope) clean.scope = req.scope
  const preserve = texts(req.preserve, 300, 40)
  if (preserve.length) clean.preserve = preserve
  const purpose = text(req.screenPurpose, 600)
  if (purpose) clean.screenPurpose = purpose
  if (req.tokens) clean.tokens = req.tokens
  if (req.locks) clean.locks = texts(req.locks, 60, 80)
  const sessionDir = text(req.sessionDir, 500)
  const folder = paths.paths[pid] ?? null
  const base = { profile, folder, overview, rules, req: clean, ...(skill ? { skill } : {}), skillContext, ...(requestNumber ? { requestNumber } : {}) }
  const job = await s.createJob({
    type: req.type,
    projectId: pid,
    ...(profile.agentId ? { agentId: profile.agentId } : {}),
    inputRevision: inputRevisionFor(req.type, { overview, rules, requestNumber, designRequest: undefined }),
    ...(skill && (req.type === 'skill_setup' || req.type === 'design_proposal') ? { skillId: skill.id } : {}),
    minutes: clampMinutes(req.minutes, req.type === 'implementation_report' ? REPORT_JOB_MINUTES : DEFAULT_JOB_MINUTES),
    buildInput: async (jobId) => {
      const imagePaths: { capture?: string; annotated?: string } = {}
      if (capture) {
        await s.saveJobFile(jobId, 'capture.png', capture)
        imagePaths.capture = s.jobExtraFile(jobId, 'capture.png')
      }
      if (annotated) {
        await s.saveJobFile(jobId, 'annotated.png', annotated)
        imagePaths.annotated = s.jobExtraFile(jobId, 'annotated.png')
      }
      return buildJobInput(req.type, { ...base, imagePaths, ...(sessionDir ? { sessionDir } : {}) })
    }
  })
  return { job, requestText: buildRequestText(job, briefTranslator(), skill ? { skillName: skill.name } : {}) }
}

/** The request text of an existing job, rebuilt from what is stored (same words as when it was created). */
export async function jobRequestText(jobId: unknown): Promise<{ job: UiuxJob; text: string } | null> {
  const s = uiuxStore()
  const stored = await s.getJob(assertSafeId(text(jobId, 80), 'jobId'))
  if (!stored) return null
  const job = effectiveJob(stored)
  const input = await s.getJobInput<{ skill?: { name?: unknown } }>(job.jobId).catch(() => null)
  const skillName = typeof input?.skill?.name === 'string' ? input.skill.name : undefined
  return { job, text: buildRequestText(job, briefTranslator(), skillName ? { skillName } : {}) }
}

/**
 * copy: the request text on the clipboard. paste: also into the editor's send target through `paste`
 * (src/main/uiux/jobpaste.ts, the send's checks, text only, no Enter). The message says what really happened.
 */
export async function deliverJob(jobId: unknown, how: 'copy' | 'paste', paste: (text: string) => Promise<PasteOutcome>): Promise<{ ok: boolean; message: string }> {
  const found = await jobRequestText(jobId)
  if (!found) return { ok: false, message: t('uiux.job.gone') }
  if (!OPEN.includes(found.job.status)) return { ok: false, message: t('uiux.job.notOpen') }
  if (how === 'paste') {
    const out = await paste(found.text) // puts the text on the clipboard first
    return { ok: out.pasted, message: out.message }
  }
  try {
    await clipboard.write([new ClipboardItem({ 'text/plain': found.text })])
    return { ok: true, message: t('uiux.job.copied') }
  } catch (err) {
    return { ok: false, message: t('send.failed', { error: err instanceof Error ? err.message : String(err) }) }
  }
}

async function getKnownJob(jobId: unknown): Promise<UiuxJob> {
  const job = await uiuxStore().getJob(assertSafeId(text(jobId, 80), 'jobId'))
  if (!job) throw new Error('unknown job')
  return job
}

export async function cancelJob(jobId: unknown): Promise<UiuxJob> {
  const job = await getKnownJob(jobId)
  // Only a job still waiting for an answer can be cancelled; a finished one stays as it is.
  if (!OPEN.includes(job.status)) return effectiveJob(job)
  return effectiveJob(await uiuxStore().updateJob(job.jobId, { status: 'cancelled' }))
}

export async function extendJob(jobId: unknown, minutes: unknown): Promise<UiuxJob> {
  const job = await getKnownJob(jobId)
  // A job past its deadline (read as 'expired') is still open underneath and comes back; cancelled, failed and
  // answered jobs do not.
  if (!OPEN.includes(job.status) && job.status !== 'expired') return effectiveJob(job)
  return effectiveJob(await uiuxStore().updateJob(job.jobId, { expiresAt: new Date(Date.now() + clampMinutes(minutes, DEFAULT_JOB_MINUTES) * 60_000).toISOString() }))
}

export async function listJobs(projectId: unknown): Promise<UiuxJob[]> {
  const jobs = await uiuxStore().listJobs({ projectId: assertSafeId(text(projectId, 64), 'projectId') })
  return jobs.map((j) => effectiveJob(j)).sort(newestFirst)
}

// ---------- watching ----------

const watching = new Set<Electron.WebContents>()
let watcher: JobWatcher | null = null

/** While at least one editor is open the jobs folder is watched and changes go to every open editor. */
export function watchJobsFor(wc: Electron.WebContents): void {
  watching.add(wc)
  watcher ??= new JobWatcher(uiuxStore(), (job) => {
    // A submitted overview / skill context is stored before the editors hear of it.
    const ready = job.status === 'submitted' && APPLIED_TYPES.includes(job.type) ? applySubmitted(job).catch(() => null) : Promise.resolve()
    void ready.then(() => {
      for (const w of watching) if (!w.isDestroyed()) w.send(IPC.uiuxJobUpdate, job)
    })
  })
  watcher.start()
}

export function unwatchJobs(wc: Electron.WebContents): void {
  watching.delete(wc)
  if (watching.size === 0) watcher?.stop()
}

// ---------- results ----------

const appliedLocks = new Map<string, Promise<unknown>>()
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = appliedLocks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  appliedLocks.set(key, tail)
  return run.finally(() => {
    if (appliedLocks.get(key) === tail) appliedLocks.delete(key)
  })
}

interface AppliedRecord {
  submission: number
  overviewRevision?: number
  skipped?: boolean
}

async function readApplied(jobId: string): Promise<AppliedRecord | null> {
  const b = await uiuxStore().readJobFile(jobId, 'applied.txt').catch(() => null)
  if (!b) return null
  try {
    return JSON.parse(b.toString('utf8')) as AppliedRecord
  } catch {
    return null
  }
}

/** True when the job that produced `otherJobId` was requested after `job`: then `job`'s answer is a late one. */
async function supersededBy(otherJobId: string | undefined, job: UiuxJob): Promise<boolean> {
  if (!otherJobId || otherJobId === job.jobId) return false
  const other = await uiuxStore().getJob(otherJobId).catch(() => null)
  return Boolean(other && other.createdAt > job.createdAt)
}

/** Applies a project_overview / skill_setup result once per submission. */
async function applyResult(job: UiuxJob, res: JobResultFile): Promise<AppliedRecord | null> {
  const s = uiuxStore()
  const done = await readApplied(job.jobId)
  if (done && done.submission >= res.submission) return done
  if (res.projectId !== job.projectId || !(await s.getProject(job.projectId))) return null
  let rec: AppliedRecord
  if (job.type === 'project_overview' && res.overview) {
    const prev = await s.getOverview(job.projectId)
    if (await supersededBy(prev?.jobId, job)) rec = { submission: res.submission, skipped: true }
    else {
      const saved = await s.saveOverview({ ...mergeOverview(prev, res.overview), basis: 'agent', generatedAt: res.submittedAt, jobId: job.jobId })
      rec = { submission: res.submission, overviewRevision: saved.revision }
    }
  } else if (job.type === 'skill_setup' && res.skillContext) {
    const prev = await s.getSkillContext(job.projectId, res.skillContext.skill.id)
    if (await supersededBy(prev?.jobId, job)) rec = { submission: res.submission, skipped: true }
    else {
      const { fields } = mergeSkillFields(prev?.fields, res.skillContext.fields)
      await s.saveSkillContext({ projectId: job.projectId, skill: res.skillContext.skill, fields, missing: res.skillContext.missing.filter((m) => !fields[m]), generatedAt: res.submittedAt, jobId: job.jobId })
      rec = { submission: res.submission }
    }
  } else return null
  await s.saveJobFile(job.jobId, 'applied.txt', JSON.stringify(rec))
  return rec
}

const APPLIED_TYPES: readonly UiuxJob['type'][] = ['project_overview', 'skill_setup']

/** Applies one submitted project_overview / skill_setup result (no-op when already applied). */
function applySubmitted(job: UiuxJob): Promise<AppliedRecord | null> {
  return withLock(job.jobId, async () => {
    const res = await uiuxStore().getJobResult<JobResultFile>(job.jobId).catch(() => null)
    return res && res.jobId === job.jobId ? applyResult(job, res) : null
  })
}

/**
 * Applies every submitted project_overview / skill_setup result of the project that is not applied yet, oldest
 * request first, so a newer request's answer wins. Runs before the project state is read and when the watcher
 * sees a job submitted: results answered while no editor was open are never left unapplied.
 */
export async function applyPendingResults(projectId: string): Promise<void> {
  const jobs = await uiuxStore().listJobs({ projectId, status: ['submitted'] })
  for (const job of jobs.filter((j) => APPLIED_TYPES.includes(j.type))) await applySubmitted(job).catch(() => null)
}

/**
 * The stored result of a job as the panel shows it. Null: no such job. Without a result yet only `job` is set.
 * A project_overview / skill_setup result is applied once per submission (applyPendingResults, or here).
 */
export function jobOutcome(jobId: unknown): Promise<JobOutcome | null> {
  const id = assertSafeId(text(jobId, 80), 'jobId')
  return withLock(id, async () => {
    const s = uiuxStore()
    const stored = await s.getJob(id)
    if (!stored) return null
    const job = effectiveJob(stored)
    if (job.status !== 'submitted') return { job }
    const res = await s.getJobResult<JobResultFile>(id).catch(() => null)
    if (!res || res.jobId !== id) return { job }
    const out: JobOutcome = { job, submission: res.submission }
    if (res.completeness) out.completeness = { complete: res.completeness.complete, gaps: [...res.completeness.gaps] }
    if (res.skills) out.skills = res.skills
    if (res.proposals) out.proposals = res.proposals
    if (res.findings) out.findings = res.findings
    if (res.report) {
      out.report = res.report
      const conf = await readConfirmation(id)
      if (conf) out.confirmation = conf
      const input = await s.getJobInput<{ request?: { changes?: unknown } }>(id).catch(() => null)
      const changes = input?.request?.changes
      if (Array.isArray(changes)) out.requested = changes.filter((c): c is TokenChange => isObj(c) && typeof c.path === 'string').slice(0, 40)
    }
    const applied = await applyResult(job, res)
    if (applied?.overviewRevision !== undefined) out.overviewRevision = applied.overviewRevision
    return out
  })
}

const CONFIRMATION_FILE = 'confirmed.txt' // .json names are reserved for job files

async function readConfirmation(jobId: string): Promise<ReportConfirmation | null> {
  const b = await uiuxStore().readJobFile(jobId, CONFIRMATION_FILE).catch(() => null)
  if (!b) return null
  try {
    const c = JSON.parse(b.toString('utf8')) as ReportConfirmation
    return typeof c.at === 'string' && Array.isArray(c.ticked) ? { at: c.at, ticked: c.ticked.filter((x) => typeof x === 'string') } : null
  } catch {
    return null
  }
}

/**
 * Spec §10.3 "사용자 확인": the user looked at the result of an implementation report on a new capture. Only a
 * report that arrived can be confirmed; the record stays with the job, so every later editor shows it.
 */
export async function confirmReport(jobId: unknown, ticked: unknown): Promise<ReportConfirmation> {
  const job = await getKnownJob(jobId)
  if (job.type !== 'implementation_report' || effectiveJob(job).status !== 'submitted') throw new Error('no report to confirm')
  const conf: ReportConfirmation = { at: new Date().toISOString(), ticked: texts(ticked, 40, 30) }
  await uiuxStore().saveJobFile(job.jobId, CONFIRMATION_FILE, JSON.stringify(conf))
  return conf
}

/** A mock-up an agent submitted for one of this job's proposals, as a data URL; null when there is none. */
export async function proposalPreview(jobId: unknown, proposalId: unknown): Promise<string | null> {
  const s = uiuxStore()
  const id = assertSafeId(text(jobId, 80), 'jobId')
  const pid = assertSafeId(text(proposalId, 64), 'proposalId')
  const res = await s.getJobResult<JobResultFile>(id).catch(() => null)
  const p = res?.proposals?.find((x) => x.proposalId === pid)
  // Only a file the job's own result names (written by the MCP server after checking the PNG).
  if (!p || p.previewKind !== 'mockup' || p.previewRef !== `${id}.${pid}.png`) return null
  const bytes = await s.readJobFile(id, `${pid}.png`).catch(() => null)
  if (!bytes) return null
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
  return checkPreviewPng(dataUrl).ok ? dataUrl : null
}

type ProposalSet = { jobId: string; proposals: DesignProposal[]; overviewRevision?: number }

export async function proposals(projectId: unknown): Promise<ProposalSet[]> {
  const s = uiuxStore()
  const jobs = (await s.listJobs({ projectId: assertSafeId(text(projectId, 64), 'projectId'), status: ['submitted'] })).filter((j) => j.type === 'design_proposal').sort(newestFirst)
  const sets = await Promise.all(
    jobs.map(async (job): Promise<ProposalSet | null> => {
      const [res, input] = await Promise.all([
        s.getJobResult<JobResultFile>(job.jobId).catch(() => null),
        s.getJobInput<{ overviewRevision?: unknown }>(job.jobId).catch(() => null)
      ])
      if (!res?.proposals?.length) return null
      const rev = input?.overviewRevision
      return { jobId: job.jobId, proposals: res.proposals, ...(typeof rev === 'number' ? { overviewRevision: rev } : {}) }
    })
  )
  return sets.filter((x): x is ProposalSet => x !== null)
}

// ---------- overview: hand edits, import, export ----------

/**
 * The panel's overview form (spec §5.5). The first time, everything typed is the user's (basis "user"). Over a stored
 * overview only the fields whose text changed become the user's; the rest (an agent's claims, evidence, structure and
 * flows) stays as stored, and a later agent re-analysis keeps the user's fields (mergeOverview).
 */
export async function saveOverviewEdits(projectId: unknown, input: UserOverviewInput): Promise<ProjectOverview> {
  const s = uiuxStore()
  const pid = assertSafeId(text(projectId, 64), 'projectId')
  const prev = await s.getOverview(pid)
  const edits = {
    summary: text(input?.summary, 300),
    purpose: text(input?.purpose, 1000),
    audiences: texts(input?.audiences, 300),
    goals: texts(input?.goals, 200),
    screenKinds: texts(input?.screenKinds, 80)
  }
  if (!prev) {
    if (!(await s.getProject(pid))) throw new Error('unknown project')
    const user = (value: string) => ({ value, source: 'user' as const })
    return s.saveOverview({
      schemaVersion: UIUX_SCHEMA_VERSION, projectId: pid, basis: 'user', summary: user(edits.summary), purpose: user(edits.purpose),
      goals: edits.goals.map(user), audiences: edits.audiences.map(user), workflows: [], architecture: { nodes: [], edges: [] }, stack: [],
      designState: edits.screenKinds.map((k) => user(SCREEN_PREFIX + k)), designConstraints: [], sources: [], unknowns: [], generatedAt: new Date().toISOString()
    })
  }
  const next = applyOverviewEdits(prev, edits)
  if (sameOverviewContent(next, prev)) return prev
  return s.saveOverview({ ...next, generatedAt: new Date().toISOString() })
}

async function readSmallFile(file: string, max: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    if ((await stat(file)).size > max) return { ok: false, error: t('uiux.import.tooLarge', { mb: Math.round(max / (1024 * 1024)) }) }
    return { ok: true, text: await readFile(file, 'utf8') }
  } catch (err) {
    return { ok: false, error: t('uiux.import.unreadable', { error: err instanceof Error ? err.message : String(err) }) }
  }
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw.replace(/^﻿/, '')) as unknown }
  } catch {
    return { ok: false }
  }
}

export async function importOverview(projectId: unknown, win: BrowserWindow | null): Promise<{ ok: boolean; errors?: string[]; overview?: ProjectOverview }> {
  const s = uiuxStore()
  const pid = assertSafeId(text(projectId, 64), 'projectId')
  const profile = await s.getProject(pid)
  if (!profile) return { ok: false, errors: [t('uiux.import.noProject')] }
  const file = await dialogs.openFile(win, t('uiux.import.overviewTitle'))
  if (!file) return { ok: false }
  const read = await readSmallFile(file, MAX_OVERVIEW_BYTES)
  if (!read.ok) return { ok: false, errors: [read.error] }
  const parsed = parseJson(read.text)
  if (!parsed.ok) return { ok: false, errors: [t('uiux.import.notJson')] }
  let raw = parsed.value
  // A project file (profile export) carries the overview inside.
  if (raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === PROFILE_KIND) raw = (raw as { overview?: unknown }).overview
  const other = raw && typeof raw === 'object' ? (raw as { projectId?: unknown }).projectId : undefined
  if (typeof other === 'string' && other.trim() && other.trim() !== pid) return { ok: false, errors: [t('uiux.import.otherProject', { name: profile.name })] }
  const r = readOverview(raw, pid)
  if (!r.ok) return { ok: false, errors: [t('uiux.import.invalid'), ...r.errors.slice(0, 20)] }
  const prev = await s.getOverview(pid)
  const saved = await s.saveOverview({ ...mergeOverview(prev, r.value), basis: 'imported', generatedAt: new Date().toISOString() })
  return { ok: true, overview: saved }
}

export async function exportOverview(projectId: unknown, format: unknown, pngDataUrl: unknown, win: BrowserWindow | null): Promise<{ ok: boolean; path?: string }> {
  const s = uiuxStore()
  const pid = assertSafeId(text(projectId, 64), 'projectId')
  const [profile, overview] = await Promise.all([s.getProject(pid), s.getOverview(pid)])
  if (!profile || !overview) return { ok: false }
  if (format !== 'md' && format !== 'json' && format !== 'png') return { ok: false }
  // As stored, unless it carries an absolute PC path somewhere (then those are removed: exports leave this PC).
  const shown = findAbsolutePaths(overview).length ? scrubOverview(overview, { evidenceDropped: 0, downgraded: 0 }) : overview
  let data: string | Buffer
  if (format === 'png') {
    const c = checkPreviewPng(pngDataUrl)
    if (!c.ok) return { ok: false }
    data = c.bytes
  } else data = format === 'json' ? JSON.stringify(shown, null, 2) + '\n' : overviewToMarkdown(shown, t, { projectName: profile.name })
  const label = format === 'md' ? 'Markdown' : format === 'json' ? 'JSON' : 'PNG'
  const path = await dialogs.saveFile(win, { title: t('uiux.export.overviewTitle'), defaultName: `${fileSafe(profile.name)}-overview.${format}`, ext: format, name: label })
  if (!path) return { ok: false }
  await writeFile(path, data, typeof data === 'string' ? 'utf8' : undefined)
  return { ok: true, path }
}

// ---------- profile files ----------

export async function exportProfile(projectId: unknown, win: BrowserWindow | null): Promise<{ ok: boolean; path?: string }> {
  const s = uiuxStore()
  const pid = assertSafeId(text(projectId, 64), 'projectId')
  const profile = await s.getProject(pid)
  if (!profile) return { ok: false }
  const [rules, overview, contexts] = await Promise.all([s.getRules(pid), s.getOverview(pid), s.listSkillContexts(pid)])
  const { bundle } = buildProfileBundle({ profile: omit(profile, 'proposalRequests'), rules, overview, skillContexts: contexts })
  const path = await dialogs.saveFile(win, { title: t('uiux.export.profileTitle'), defaultName: `${fileSafe(profile.name)}-backseat-project.json`, ext: 'json', name: 'JSON' })
  if (!path) return { ok: false }
  await writeFile(path, JSON.stringify(bundle, null, 2) + '\n', 'utf8')
  const md = profileToMarkdown({ profile: bundle.profile, rules: bundle.rules, overview: bundle.overview, skillContexts: bundle.skillContexts, exportedAt: bundle.exportedAt }, t)
  await writeFile(path.replace(/\.json$/i, '.md'), md, 'utf8').catch(() => undefined) // the JSON is the file that matters
  return { ok: true, path }
}

export async function importProfile(win: BrowserWindow | null): Promise<{ ok: boolean; projectId?: string; name?: string; idChanged?: boolean; folderLinked?: boolean; errors?: string[] }> {
  const s = uiuxStore()
  const file = await dialogs.openFile(win, t('uiux.import.profileTitle'))
  if (!file) return { ok: false }
  const read = await readSmallFile(file, MAX_PROFILE_BYTES)
  if (!read.ok) return { ok: false, errors: [read.error] }
  const parsed = parseJson(read.text)
  if (!parsed.ok) return { ok: false, errors: [t('uiux.import.notJson')] }
  const r = parseProfileBundle(parsed.value)
  if (!r.ok) return { ok: false, errors: [t('uiux.import.invalid'), ...r.errors.slice(0, 20)] }
  const { data } = r.value
  const now = new Date().toISOString()
  // A project with that id already here is not touched: the file becomes a new project.
  let projectId = await s.freeProjectId(data.profile.projectId)
  const make = (id: string) => ({
    schemaVersion: UIUX_SCHEMA_VERSION,
    projectId: id,
    name: data.profile.name,
    ...(data.profile.repo ? { repo: data.profile.repo } : {}),
    ...(data.profile.skillIds ? { skillIds: data.profile.skillIds } : {}),
    createdAt: now,
    updatedAt: now
  })
  if (!(await s.addProject(make(projectId)))) {
    projectId = await s.freeProjectId(`${data.profile.projectId}-${Date.now().toString(36)}`)
    await s.addProject(make(projectId))
  }
  if (data.rules) await s.saveRules({ ...data.rules, projectId })
  if (data.overview) await s.saveOverview({ ...data.overview, projectId, basis: 'imported', generatedAt: now })
  for (const c of data.skillContexts) await s.saveSkillContext({ ...c, projectId, generatedAt: now })
  // This PC's folder is asked last; cancelling leaves the project without one.
  const folder = await dialogs.pickFolder(win)
  if (folder) await s.setPath(projectId, folder)
  return { ok: true, projectId, name: data.profile.name, idChanged: projectId !== data.profile.projectId, folderLinked: Boolean(folder) }
}

// ---------- implementation_report (editor send) ----------

/**
 * Creates the report job for a send that carries UI/UX guidance, BEFORE the package is written (the brief names
 * its id). null when the project is unknown or anything fails: a send is never held back by this.
 */
export async function createReportJob(payload: Pick<ExportPayload, 'uiux' | 'memo'>): Promise<string | null> {
  try {
    if (!payload.uiux || !hasUiuxGuidance(payload)) return null
    const request = payload.uiux.request as DesignRequest
    const s = uiuxStore()
    const pid = assertSafeId(text(request.projectId, 64), 'projectId')
    const profile = await s.getProject(pid)
    if (!profile) return null
    const [overview, paths] = await Promise.all([s.getOverview(pid), s.getPaths()])
    const job = await s.createJob({
      type: 'implementation_report',
      projectId: pid,
      ...(profile.agentId ? { agentId: profile.agentId } : {}),
      inputRevision: inputRevisionFor('implementation_report', { overview, rules: null, designRequest: request }),
      minutes: REPORT_JOB_MINUTES,
      input: buildJobInput('implementation_report', { profile, folder: paths.paths[pid] ?? null, overview, rules: null, req: { type: 'implementation_report' }, designRequest: request, memo: payload.memo })
    })
    return job.jobId
  } catch {
    return null
  }
}

/** The package folder is known only after the package was written: add it to the job's input. */
export async function attachSessionDir(jobId: string, sessionDir: string): Promise<void> {
  const s = uiuxStore()
  const input = await s.getJobInput<Record<string, unknown>>(jobId)
  await s.setJobInput(jobId, { ...(input ?? {}), sessionDir })
}

/**
 * A send through `send` with its implementation_report job: the job is created first (the brief names it; an id the
 * renderer put in the payload is always replaced), learns the package folder as soon as it is written (before the
 * paste, so an agent that reads the brief at once finds it), and is cancelled when the send wrote no package or
 * failed (it would never be answered). Failing to create the job never holds the send back.
 */
export async function sendWithReportJob(
  payload: ExportPayload,
  send: (payload: ExportPayload, onPackage: (dir: string) => Promise<void>) => Promise<SendResult>
): Promise<SendResult> {
  const reportJobId = await createReportJob(payload)
  let attached = ''
  const onPackage = async (dir: string): Promise<void> => {
    if (!reportJobId) return
    await attachSessionDir(reportJobId, dir)
    attached = dir
  }
  let sent: SendResult
  try {
    sent = await send(payload.uiux ? { ...payload, uiux: { ...payload.uiux, reportJobId: reportJobId ?? undefined } } : payload, onPackage)
  } catch (err) {
    if (reportJobId) await cancelJob(reportJobId).catch(() => undefined)
    throw err
  }
  if (!reportJobId) return sent
  if (!sent.sessionDir) {
    await cancelJob(reportJobId).catch(() => undefined)
    return sent
  }
  if (attached !== sent.sessionDir) await attachSessionDir(reportJobId, sent.sessionDir).catch(() => undefined)
  return { ...sent, reportJobId }
}

// ---------- IPC ----------

const winOf = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)

let installed = false

/** Everything except IPC.uiuxDeliverJob, which needs the editor's target (src/main/editor.ts). */
export function installJobsIpc(): void {
  if (installed) return
  installed = true
  // Each function checks its own input (ids, lengths): the IPC layer only passes it on.
  ipcMain.handle(IPC.uiuxRequestJob, (_e, projectId: unknown, req: JobRequest) => requestJob(projectId, req))
  ipcMain.handle(IPC.uiuxCancelJob, (_e, jobId: unknown) => cancelJob(jobId))
  ipcMain.handle(IPC.uiuxExtendJob, (_e, jobId: unknown, minutes: unknown) => extendJob(jobId, minutes))
  ipcMain.handle(IPC.uiuxListJobs, (_e, projectId: unknown) => listJobs(projectId))
  ipcMain.handle(IPC.uiuxJobOutcome, (_e, jobId: unknown) => jobOutcome(jobId))
  ipcMain.handle(IPC.uiuxConfirmReport, (_e, jobId: unknown, ticked: unknown) => confirmReport(jobId, ticked))
  ipcMain.handle(IPC.uiuxProposalPreview, (_e, jobId: unknown, proposalId: unknown) => proposalPreview(jobId, proposalId))
  ipcMain.handle(IPC.uiuxImportOverview, (e, projectId: unknown) => importOverview(projectId, winOf(e)))
  ipcMain.handle(IPC.uiuxExportOverview, (e, projectId: unknown, format: unknown, png: unknown) => exportOverview(projectId, format, png, winOf(e)))
  ipcMain.handle(IPC.uiuxSaveOverviewEdits, (_e, projectId: unknown, edits: UserOverviewInput) => saveOverviewEdits(projectId, edits))
  ipcMain.handle(IPC.uiuxSkills, (_e, projectId: unknown) => skills(projectId))
  ipcMain.handle(IPC.uiuxProposals, (_e, projectId: unknown) => proposals(projectId))
  ipcMain.handle(IPC.uiuxExportProfile, (e, projectId: unknown) => exportProfile(projectId, winOf(e)))
  ipcMain.handle(IPC.uiuxImportProfile, (e) => importProfile(winOf(e)))
}
