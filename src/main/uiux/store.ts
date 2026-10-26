// UI/UX data store under <userData>/uiux (spec §12). Plain Node, no Electron: the MCP server (agent job tools)
// shares it. Layout:
//   projects/<projectId>/profile.json        ProjectProfile (exportable, no absolute paths)
//   projects/<projectId>/overview.json        latest ProjectOverview; overview-<revision>.json keeps each version
//   projects/<projectId>/rules.json          DesignRules
//   projects/<projectId>/skills/<skillId>.json  SkillContext
//   jobs/<jobId>.json, jobs/<jobId>.result.json
//   local/paths.json                         ProjectPathMap: this PC's folder per project (never exported)
// Writes are atomic (writeFileAtomic); ids are checked before they become file names.
import { randomBytes } from 'crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { renameRetry, writeFileAtomic } from '../fsutil'
import {
  UIUX_SCHEMA_VERSION, type DesignRules, type JobStatus, type JobType, type ProjectOverview, type ProjectPathMap,
  type ProjectProfile, type SkillContext, type UiuxJob
} from '../../shared/uiux/types'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** An id that is safe as a file name; anything else is refused (no path tricks through ids from an agent). */
export function assertSafeId(id: string, what = 'id'): string {
  if (!SAFE_ID.test(id) || id.includes('..')) throw new Error(`invalid ${what}: ${JSON.stringify(id).slice(0, 80)}`)
  return id
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  await writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n')
}

const nowIso = (): string => new Date().toISOString()

export const DEFAULT_JOB_MINUTES = 5

/** Extra job files: "<name>.png" / "<name>.txt" (never .json: listJobs would take such a file for a job). */
const JOB_FILE_SUFFIX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}.(png|txt)$/

export class UiuxStore {
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  private projectDir(projectId: string): string {
    return join(this.root, 'projects', assertSafeId(projectId, 'projectId'))
  }

  // ---------- projects ----------

  async listProjects(): Promise<ProjectProfile[]> {
    let names: string[]
    try {
      names = await readdir(join(this.root, 'projects'))
    } catch {
      return []
    }
    const out: ProjectProfile[] = []
    for (const n of names) {
      if (!SAFE_ID.test(n)) continue
      const p = await readJson<ProjectProfile>(join(this.root, 'projects', n, 'profile.json')).catch(() => null)
      if (p && p.projectId === n) out.push(p)
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  async getProject(projectId: string): Promise<ProjectProfile | null> {
    return readJson<ProjectProfile>(join(this.projectDir(projectId), 'profile.json'))
  }

  /** Creates a project with a new id from its name. */
  async createProject(fields: { name: string; repo?: string; agentId?: string }): Promise<ProjectProfile> {
    const slug = fields.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'project'
    const t = nowIso()
    const p: ProjectProfile = {
      schemaVersion: UIUX_SCHEMA_VERSION,
      projectId: `${slug}-${randomBytes(3).toString('hex')}`,
      name: fields.name.trim().slice(0, 80),
      createdAt: t,
      updatedAt: t
    }
    if (fields.repo) p.repo = fields.repo.trim().slice(0, 200)
    if (fields.agentId) p.agentId = fields.agentId
    await writeJson(join(this.projectDir(p.projectId), 'profile.json'), p)
    return p
  }

  async saveProject(p: ProjectProfile): Promise<ProjectProfile> {
    const next = { ...p, updatedAt: nowIso() }
    await writeJson(join(this.projectDir(p.projectId), 'profile.json'), next)
    return next
  }

  // ---------- this PC's folders ----------

  async getPaths(): Promise<ProjectPathMap> {
    return (await readJson<ProjectPathMap>(join(this.root, 'local', 'paths.json'))) ?? { schemaVersion: UIUX_SCHEMA_VERSION, paths: {} }
  }

  async setPath(projectId: string, folder: string | null): Promise<void> {
    assertSafeId(projectId, 'projectId')
    const m = await this.getPaths()
    if (folder) m.paths[projectId] = folder
    else delete m.paths[projectId]
    await writeJson(join(this.root, 'local', 'paths.json'), m)
  }

  // ---------- overview ----------

  async getOverview(projectId: string): Promise<ProjectOverview | null> {
    return readJson<ProjectOverview>(join(this.projectDir(projectId), 'overview.json'))
  }

  /** Stores a new revision (previous + 1) and keeps a copy of it; earlier recommendations keep pointing at theirs. */
  async saveOverview(o: Omit<ProjectOverview, 'revision'>): Promise<ProjectOverview> {
    const prev = await this.getOverview(o.projectId)
    const next: ProjectOverview = { ...o, schemaVersion: UIUX_SCHEMA_VERSION, revision: (prev?.revision ?? 0) + 1 }
    const dir = this.projectDir(o.projectId)
    await writeJson(join(dir, `overview-${next.revision}.json`), next)
    await writeJson(join(dir, 'overview.json'), next)
    return next
  }

  // ---------- design rules ----------

  async getRules(projectId: string): Promise<DesignRules | null> {
    return readJson<DesignRules>(join(this.projectDir(projectId), 'rules.json'))
  }

  /** Saves the next revision. Requests already sent keep their own snapshot (spec §9), so nothing else changes. */
  async saveRules(r: Omit<DesignRules, 'revision' | 'updatedAt' | 'schemaVersion'>): Promise<DesignRules> {
    const prev = await this.getRules(r.projectId)
    const next: DesignRules = { ...r, schemaVersion: UIUX_SCHEMA_VERSION, revision: (prev?.revision ?? 0) + 1, updatedAt: nowIso() }
    await writeJson(join(this.projectDir(r.projectId), 'rules.json'), next)
    return next
  }

  // ---------- skill contexts ----------

  async getSkillContext(projectId: string, skillId: string): Promise<SkillContext | null> {
    return readJson<SkillContext>(join(this.projectDir(projectId), 'skills', `${assertSafeId(skillId, 'skillId')}.json`))
  }

  async saveSkillContext(c: Omit<SkillContext, 'revision' | 'schemaVersion'>): Promise<SkillContext> {
    const prev = await this.getSkillContext(c.projectId, c.skill.id)
    const next: SkillContext = { ...c, schemaVersion: UIUX_SCHEMA_VERSION, revision: (prev?.revision ?? 0) + 1 }
    await writeJson(join(this.projectDir(c.projectId), 'skills', `${assertSafeId(c.skill.id, 'skillId')}.json`), next)
    return next
  }

  // ---------- agent jobs ----------

  private jobFile(jobId: string, suffix = ''): string {
    return join(this.root, 'jobs', `${assertSafeId(jobId, 'jobId')}${suffix}.json`)
  }

  async createJob(fields: { type: JobType; projectId: string; agentId?: string; inputRevision: number; skillId?: string; minutes?: number; input?: unknown }): Promise<UiuxJob> {
    assertSafeId(fields.projectId, 'projectId')
    const t = Date.now()
    const job: UiuxJob = {
      schemaVersion: UIUX_SCHEMA_VERSION,
      jobId: newId('job'),
      type: fields.type,
      projectId: fields.projectId,
      inputRevision: fields.inputRevision,
      status: 'pending',
      createdAt: new Date(t).toISOString(),
      updatedAt: new Date(t).toISOString(),
      expiresAt: new Date(t + (fields.minutes ?? DEFAULT_JOB_MINUTES) * 60_000).toISOString()
    }
    if (fields.agentId) job.agentId = fields.agentId
    if (fields.skillId) job.skillId = assertSafeId(fields.skillId, 'skillId')
    if (fields.input !== undefined) await writeJson(this.jobFile(job.jobId, '.input'), fields.input)
    await writeJson(this.jobFile(job.jobId), job)
    return job
  }

  /** The job with an expired deadline reported as such (stored state is updated lazily by updateJob). */
  async getJob(jobId: string): Promise<UiuxJob | null> {
    const j = await readJson<UiuxJob>(this.jobFile(jobId))
    if (j && (j.status === 'pending' || j.status === 'fetched') && Date.parse(j.expiresAt) < Date.now()) return { ...j, status: 'expired' }
    return j
  }

  async getJobInput<T = unknown>(jobId: string): Promise<T | null> {
    return readJson<T>(this.jobFile(jobId, '.input'))
  }

  async updateJob(jobId: string, patch: Partial<Pick<UiuxJob, 'status' | 'fetchedAt' | 'resultRef' | 'error' | 'expiresAt'>>): Promise<UiuxJob> {
    const j = await readJson<UiuxJob>(this.jobFile(jobId))
    if (!j) throw new Error(`no job ${jobId}`)
    const next: UiuxJob = { ...j, ...patch, updatedAt: nowIso() }
    await writeJson(this.jobFile(jobId), next)
    return next
  }

  async saveJobResult(jobId: string, result: unknown): Promise<string> {
    const file = this.jobFile(jobId, '.result')
    await writeJson(file, result)
    return `${jobId}.result.json`
  }

  async getJobResult<T = unknown>(jobId: string): Promise<T | null> {
    return readJson<T>(this.jobFile(jobId, '.result'))
  }

  /** jobs/<jobId>.<suffix> for files that belong to a job (mock-up PNGs, progress notes); suffix ends in .png or .txt. */
  private jobExtraFile(jobId: string, suffix: string): string {
    if (!JOB_FILE_SUFFIX.test(suffix) || suffix.includes('..')) throw new Error(`invalid job file name: ${JSON.stringify(suffix).slice(0, 80)}`)
    return join(this.root, 'jobs', `${assertSafeId(jobId, 'jobId')}.${suffix}`)
  }

  /** Additive helper (agent job tools): writes jobs/<jobId>.<suffix> atomically and returns the file name (no folder). */
  async saveJobFile(jobId: string, suffix: string, data: Buffer | string): Promise<string> {
    const file = this.jobExtraFile(jobId, suffix)
    await mkdir(join(file, '..'), { recursive: true })
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await writeFile(tmp, data)
      await renameRetry(tmp, file)
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined)
      throw err
    }
    return `${jobId}.${suffix}`
  }

  /** Additive helper: the bytes of jobs/<jobId>.<suffix>, or null when there is no such file. */
  async readJobFile(jobId: string, suffix: string): Promise<Buffer | null> {
    try {
      return await readFile(this.jobExtraFile(jobId, suffix))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async listJobs(filter: { projectId?: string; status?: JobStatus[] } = {}): Promise<UiuxJob[]> {
    let names: string[]
    try {
      names = await readdir(join(this.root, 'jobs'))
    } catch {
      return []
    }
    const out: UiuxJob[] = []
    for (const n of names) {
      if (!n.endsWith('.json') || n.endsWith('.result.json') || n.endsWith('.input.json')) continue
      const j = await this.getJob(n.slice(0, -5)).catch(() => null)
      if (!j) continue
      if (filter.projectId && j.projectId !== filter.projectId) continue
      if (filter.status && !filter.status.includes(j.status)) continue
      out.push(j)
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}
