// The portable project file (spec §9, §12): one versioned JSON with profile, rules, latest overview and skill
// contexts, never an absolute PC path. Export scrubs, import validates like an agent result. Pure
// (tests/uiux-app-export.test.ts).
import { UIUX_SCHEMA_VERSION } from '../../shared/uiux/types.ts'
import type { Claim, DesignRules, Evidence, ProjectOverview, ProjectProfile, SkillContext, SkillRef } from '../../shared/uiux/types.ts'
import { isObj, isRelativePath, readOverview, readSkillContext, readTokens, type Result } from '../../shared/uiux/validate.ts'
import { omit, texts } from './clean.ts'

export const PROFILE_KIND = 'backseat-uiux-profile'
/** A profile file larger than this is not read. */
export const MAX_PROFILE_BYTES = 4 * 1024 * 1024
export const MAX_OVERVIEW_BYTES = 2 * 1024 * 1024

export interface ProfileBundle {
  kind: typeof PROFILE_KIND
  schemaVersion: number
  exportedAt: string
  profile: ProjectProfile
  rules: DesignRules | null
  overview: ProjectOverview | null
  skillContexts: SkillContext[]
}

// ---------- scrubbing ----------

const REMOVED = '[local path removed]'
const ABSOLUTE_PATTERNS: RegExp[] = [
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|*?]*/g,
  /\\\\[^\s\\"']+\\[^\s"']*/g,
  /(?<![\w.:/])\/(?:Users|home)\/[^\s"']+/g
]

/** Free text with absolute PC paths (drive, UNC, /Users, /home) replaced. */
export function scrubText(s: string): string {
  return ABSOLUTE_PATTERNS.reduce((t, re) => t.replace(re, REMOVED), s)
}

/** Absolute PC paths still present anywhere in a value (strings only). Used by tests and as a last check. */
export function findAbsolutePaths(v: unknown, found: string[] = []): string[] {
  if (typeof v === 'string') {
    for (const re of ABSOLUTE_PATTERNS) for (const m of v.matchAll(new RegExp(re.source, re.flags))) found.push(m[0])
  } else if (Array.isArray(v)) v.forEach((x) => findAbsolutePaths(x, found))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => findAbsolutePaths(x, found))
  return found
}

function scrubDeep<T>(v: T): T {
  if (typeof v === 'string') return scrubText(v) as T
  if (Array.isArray(v)) return v.map(scrubDeep) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)])) as T
  return v
}

export interface ScrubReport {
  /** Evidence entries dropped because their path was not project-relative. */
  evidenceDropped: number
  /** "verified" statements that lost all evidence and became "estimated". */
  downgraded: number
}

function cleanEvidence(ev: Evidence[] | undefined, rep: ScrubReport): Evidence[] | undefined {
  if (!ev) return undefined
  const kept = ev.filter((e) => isRelativePath(e.path))
  rep.evidenceDropped += ev.length - kept.length
  return kept.length ? kept : undefined
}

/** Claim-like object (value/source/evidence) without evidence it cannot keep. */
function cleanClaimLike<T extends { source: Claim['source']; evidence?: Evidence[] }>(c: T, rep: ScrubReport): T {
  const evidence = cleanEvidence(c.evidence, rep)
  const rest = omit(c, 'evidence')
  const next = (evidence ? { ...rest, evidence } : rest) as T
  if (next.source === 'verified' && !evidence) {
    rep.downgraded++
    return { ...next, source: 'estimated' }
  }
  return next
}

export function scrubOverview(o: ProjectOverview, rep: ScrubReport): ProjectOverview {
  const claims = (l: Claim[]): Claim[] => l.map((c) => cleanClaimLike(c, rep))
  return scrubDeep({
    ...omit(o, 'jobId'),
    summary: cleanClaimLike(o.summary, rep),
    purpose: cleanClaimLike(o.purpose, rep),
    goals: claims(o.goals),
    audiences: claims(o.audiences),
    stack: claims(o.stack),
    designState: claims(o.designState),
    designConstraints: claims(o.designConstraints),
    architecture: {
      nodes: o.architecture.nodes.map((n) => cleanClaimLike(n, rep)),
      edges: o.architecture.edges.map((e) => cleanClaimLike(e, rep))
    },
    sources: o.sources.filter((e) => isRelativePath(e.path))
  })
}

/**
 * The file's content. Dropped on purpose: this PC's folder, the linked agent (an id that means nothing on another
 * PC), job ids (the jobs stay here). Evidence needs project-relative paths; free text loses absolute paths.
 */
export function buildProfileBundle(input: {
  profile: ProjectProfile
  rules: DesignRules | null
  overview: ProjectOverview | null
  skillContexts: SkillContext[]
  now?: string
}): { bundle: ProfileBundle; report: ScrubReport } {
  const report: ScrubReport = { evidenceDropped: 0, downgraded: 0 }
  const profile = omit(input.profile, 'agentId')
  const bundle: ProfileBundle = {
    kind: PROFILE_KIND,
    schemaVersion: UIUX_SCHEMA_VERSION,
    exportedAt: input.now ?? new Date().toISOString(),
    profile: scrubDeep(profile),
    rules: input.rules ? scrubDeep(input.rules) : null,
    overview: input.overview ? scrubOverview(input.overview, report) : null,
    skillContexts: input.skillContexts.map((c) => {
      return scrubDeep({ ...omit(c, 'jobId'), fields: Object.fromEntries(Object.entries(c.fields).map(([k, f]) => [k, cleanClaimLike(f, report)])) })
    })
  }
  return { bundle, report }
}

// ---------- import ----------

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const TOKEN_PATH = /^(colors|ratio|shadows|type|box)(\.[A-Za-z]+){0,2}$/

export interface ImportedProfile {
  profile: Pick<ProjectProfile, 'projectId' | 'name' | 'repo' | 'skillIds'>
  rules: Omit<DesignRules, 'revision' | 'updatedAt' | 'schemaVersion'> | null
  overview: OverviewValue | null
  skillContexts: Omit<SkillContext, 'revision' | 'schemaVersion' | 'generatedAt' | 'jobId'>[]
}

type OverviewValue = Omit<ProjectOverview, 'revision' | 'basis' | 'generatedAt' | 'jobId'>

function readSkillRef(v: unknown, path: string, errors: string[]): SkillRef | null {
  if (!isObj(v) || typeof v.id !== 'string' || !ID_RE.test(v.id) || typeof v.name !== 'string' || !v.name.trim()) {
    errors.push(`${path}: not a skill`)
    return null
  }
  const source = v.source === 'builtin' || v.source === 'imported' ? v.source : 'agent'
  const ref: SkillRef = { id: v.id, name: v.name.trim().slice(0, 80), source }
  if (typeof v.version === 'string' && v.version.trim()) ref.version = v.version.trim().slice(0, 40)
  if (typeof v.description === 'string' && v.description.trim()) ref.description = v.description.trim().slice(0, 600)
  return ref
}

/** Checks a parsed profile file. Errors are English technical lines (JSON paths), like the agent validators. */
export function parseProfileBundle(raw: unknown): Result<{ data: ImportedProfile }> {
  if (!isObj(raw) || raw.kind !== PROFILE_KIND) return { ok: false, errors: ['$.kind: not a Backseat project file'] }
  if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) return { ok: false, errors: ['$.schemaVersion: expected a whole number'] }
  if (raw.schemaVersion > UIUX_SCHEMA_VERSION) return { ok: false, errors: [`$.schemaVersion: ${raw.schemaVersion} is newer than this Backseat understands (${UIUX_SCHEMA_VERSION})`] }
  const errors: string[] = []
  const p = raw.profile
  if (!isObj(p)) return { ok: false, errors: ['$.profile: expected an object'] }
  const projectId = typeof p.projectId === 'string' ? p.projectId.trim() : ''
  if (!ID_RE.test(projectId)) errors.push('$.profile.projectId: ids use letters, digits, ".", "_" and "-" (max 64)')
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, 80) : ''
  if (!name) errors.push('$.profile.name: must not be empty')
  const profile: ImportedProfile['profile'] = { projectId, name }
  if (typeof p.repo === 'string' && p.repo.trim()) profile.repo = p.repo.trim().slice(0, 200)
  if (Array.isArray(p.skillIds)) {
    const ids = p.skillIds.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)).slice(0, 20)
    if (ids.length) profile.skillIds = ids
  }

  let rules: ImportedProfile['rules'] = null
  if (raw.rules !== null && raw.rules !== undefined) {
    const r = raw.rules
    if (!isObj(r)) errors.push('$.rules: expected an object')
    else {
      const tokens = readTokens(r.tokens, '$.rules.tokens')
      if (!tokens.ok) errors.push(...tokens.errors)
      const themes = (Array.isArray(r.themes) ? r.themes : []).filter((x): x is 'light' | 'dark' => x === 'light' || x === 'dark')
      const overrides = isObj(r.pageOverrides) ? r.pageOverrides : {}
      const pageOverrides: DesignRules['pageOverrides'] = {}
      for (const [screen, values] of Object.entries(overrides).slice(0, 60)) {
        if (!isObj(values)) continue
        pageOverrides[screen.slice(0, 120)] = Object.fromEntries(Object.entries(values).filter(([k]) => TOKEN_PATH.test(k)).slice(0, 80))
      }
      if (tokens.ok) {
        rules = {
          projectId,
          tokens: tokens.value,
          locks: texts(r.locks, 60, 80).filter((x) => TOKEN_PATH.test(x)),
          pageOverrides,
          componentRules: texts(r.componentRules, 300, 60),
          themes: themes.length ? themes : ['light']
        }
        const skill = r.skill === undefined ? null : readSkillRef(r.skill, '$.rules.skill', errors)
        if (skill) rules.skill = skill
      }
    }
  }

  let overview: ImportedProfile['overview'] = null
  if (raw.overview !== null && raw.overview !== undefined) {
    // The overview inside the file is for the project the file names.
    const o = readOverview(isObj(raw.overview) ? { ...raw.overview, projectId } : raw.overview, projectId)
    if (!o.ok) errors.push(...o.errors.map((e) => `$.overview${e.slice(1)}`))
    else overview = o.value
  }

  const skillContexts: ImportedProfile['skillContexts'] = []
  if (Array.isArray(raw.skillContexts)) {
    raw.skillContexts.slice(0, 60).forEach((c, i) => {
      const path = `$.skillContexts[${i}]`
      if (!isObj(c)) return void errors.push(`${path}: expected an object`)
      const skill = readSkillRef(c.skill, `${path}.skill`, errors)
      if (!skill) return
      const r = readSkillContext({ projectId, skillId: skill.id, fields: c.fields, missing: c.missing }, { projectId, skill })
      if (!r.ok) errors.push(...r.errors.map((e) => `${path}${e.slice(1)}`))
      else skillContexts.push({ projectId, skill, fields: r.value.fields, missing: r.value.missing })
    })
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 50) }
  return { ok: true, value: { data: { profile, rules, overview, skillContexts } } }
}
