// Validation of UI/UX data that comes from outside: agent results (MCP job_submit), imported files.
// Pure: tests/uiux-validate.test.ts. Everything is data, never instructions; strings are bounded so a result
// cannot flood the UI, and nothing here executes or fetches anything.
import {
  ARCH_NODE_TYPES, COLOR_ROLES, PROVENANCES, SHADOW_ROLES, TYPE_ROLES, UIUX_SCHEMA_VERSION,
  type ArchEdge, type ArchNode, type Architecture, type Check, type Claim, type ColorRatio, type DesignProposal,
  type DesignTokens, type Evidence, type ProjectOverview, type Provenance, type ShadowSpec, type SkillContext,
  type SkillRef, type TypeSpec, type Workflow, type BoxSpec, type Density
} from './types'

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] }

const MAX_TEXT = 2000
const MAX_SHORT = 200
const MAX_LIST = 60

export type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Collects errors with their JSON path while reading an untrusted object. */
export class Reader {
  errors: string[] = []
  err(path: string, msg: string): void {
    if (this.errors.length < 50) this.errors.push(`${path}: ${msg}`)
  }
  obj(v: unknown, path: string): Obj {
    if (isObj(v)) return v
    this.err(path, 'expected an object')
    return {}
  }
  str(v: unknown, path: string, max = MAX_TEXT, required = true): string {
    if (typeof v === 'string') {
      const s = v.trim()
      if (required && !s) this.err(path, 'must not be empty')
      if (s.length > max) this.err(path, `longer than ${max} characters`)
      return s.slice(0, max)
    }
    if (v === undefined && !required) return ''
    this.err(path, 'expected a string')
    return ''
  }
  optStr(v: unknown, path: string, max = MAX_TEXT): string | undefined {
    if (v === undefined || v === null) return undefined
    const s = this.str(v, path, max, false)
    return s || undefined
  }
  num(v: unknown, path: string, min: number, max: number): number {
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v < min || v > max) this.err(path, `must be between ${min} and ${max}`)
      return Math.min(max, Math.max(min, v))
    }
    this.err(path, 'expected a number')
    return min
  }
  int(v: unknown, path: string, min: number, max: number): number {
    const n = this.num(v, path, min, max)
    if (!Number.isInteger(n)) this.err(path, 'expected a whole number')
    return Math.round(n)
  }
  list<T>(v: unknown, path: string, item: (x: unknown, p: string) => T, opts: { min?: number; max?: number } = {}): T[] {
    const max = opts.max ?? MAX_LIST
    if (!Array.isArray(v)) {
      if (v === undefined && !opts.min) return []
      this.err(path, 'expected a list')
      return []
    }
    if (opts.min && v.length < opts.min) this.err(path, `needs at least ${opts.min} item(s)`)
    if (v.length > max) this.err(path, `more than ${max} items`)
    return v.slice(0, max).map((x, i) => item(x, `${path}[${i}]`))
  }
  oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
    this.err(path, `must be one of ${allowed.join(', ')}`)
    return allowed[0]
  }
  hex(v: unknown, path: string): string {
    if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase()
    this.err(path, 'expected a colour like #1A2B3C')
    return '#000000'
  }
}

/** A project-relative path: no drive letters, no leading slash, no "..". Absolute PC paths are rejected (spec §9). */
export function isRelativePath(p: string): boolean {
  if (!p || p.length > 400) return false
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\') || p.startsWith('~')) return false
  return !p.split(/[\\/]/).includes('..')
}

export function readEvidence(r: Reader, v: unknown, path: string): Evidence {
  const o = r.obj(v, path)
  const p = r.str(o.path, `${path}.path`, 400)
  if (p && !isRelativePath(p)) r.err(`${path}.path`, 'must be a project-relative path')
  const e: Evidence = { path: p }
  const note = r.optStr(o.note, `${path}.note`, MAX_SHORT)
  if (note) e.note = note
  const at = r.optStr(o.checkedAt, `${path}.checkedAt`, 40)
  if (at) e.checkedAt = at
  const rev = r.optStr(o.revision, `${path}.revision`, 80)
  if (rev) e.revision = rev
  return e
}

function provenance(r: Reader, v: unknown, path: string): Provenance {
  return r.oneOf(v, path, PROVENANCES)
}

function claim(r: Reader, v: unknown, path: string, max = MAX_TEXT): Claim {
  const o = r.obj(v, path)
  const c: Claim = { value: r.str(o.value, `${path}.value`, max), source: provenance(r, o.source, `${path}.source`) }
  const ev = r.list(o.evidence, `${path}.evidence`, (x, p) => readEvidence(r, x, p), { max: 20 })
  if (ev.length) c.evidence = ev
  // "verified" has to say where it was verified.
  if (c.source === 'verified' && !ev.length) r.err(`${path}.evidence`, 'a verified statement needs evidence')
  return c
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function id(r: Reader, v: unknown, path: string): string {
  const s = r.str(v, path, 64)
  if (s && !ID_RE.test(s)) r.err(path, 'ids use letters, digits, ".", "_" and "-" (max 64)')
  return s
}

function architecture(r: Reader, v: unknown, path: string): Architecture {
  const o = r.obj(v, path)
  const nodes = r.list(o.nodes, `${path}.nodes`, (x, p): ArchNode => {
    const n = r.obj(x, p)
    const node: ArchNode = {
      id: id(r, n.id, `${p}.id`),
      type: r.oneOf(n.type, `${p}.type`, ARCH_NODE_TYPES),
      label: r.str(n.label, `${p}.label`, 80),
      source: provenance(r, n.source, `${p}.source`)
    }
    const d = r.optStr(n.description, `${p}.description`, 600)
    if (d) node.description = d
    const parent = r.optStr(n.parent, `${p}.parent`, 64)
    if (parent) node.parent = parent
    const ev = r.list(n.evidence, `${p}.evidence`, (y, q) => readEvidence(r, y, q), { max: 10 })
    if (ev.length) node.evidence = ev
    return node
  }, { min: 1, max: 80 })
  const ids = new Set<string>()
  nodes.forEach((n, i) => {
    if (ids.has(n.id)) r.err(`${path}.nodes[${i}].id`, `duplicate id ${n.id}`)
    ids.add(n.id)
  })
  nodes.forEach((n, i) => { if (n.parent && !ids.has(n.parent)) r.err(`${path}.nodes[${i}].parent`, `unknown node ${n.parent}`) })
  const edges = r.list(o.edges, `${path}.edges`, (x, p): ArchEdge => {
    const e = r.obj(x, p)
    const edge: ArchEdge = {
      from: r.str(e.from, `${p}.from`, 64),
      to: r.str(e.to, `${p}.to`, 64),
      relation: r.str(e.relation, `${p}.relation`, 80),
      source: provenance(r, e.source, `${p}.source`)
    }
    if (!ids.has(edge.from)) r.err(`${p}.from`, `unknown node ${edge.from}`)
    if (!ids.has(edge.to)) r.err(`${p}.to`, `unknown node ${edge.to}`)
    const ev = r.list(e.evidence, `${p}.evidence`, (y, q) => readEvidence(r, y, q), { max: 10 })
    if (ev.length) edge.evidence = ev
    return edge
  }, { max: 200 })
  return { nodes, edges }
}

/**
 * An overview from an agent or a file. `expectedProjectId` must match: an answer about another project is
 * rejected outright (AC-05). Completeness (purpose, users, tasks, structure backed by evidence) is a separate
 * question, answered by overviewCompleteness().
 */
export function readOverview(v: unknown, expectedProjectId: string): Result<Omit<ProjectOverview, 'revision' | 'basis' | 'generatedAt' | 'jobId'>> {
  const r = new Reader()
  const o = r.obj(v, '$')
  const projectId = r.str(o.projectId, '$.projectId', 64)
  if (projectId && projectId !== expectedProjectId) r.err('$.projectId', `is for project "${projectId}", not "${expectedProjectId}"`)
  const value = {
    schemaVersion: UIUX_SCHEMA_VERSION,
    projectId: expectedProjectId,
    summary: claim(r, o.summary, '$.summary', 300),
    purpose: claim(r, o.purpose, '$.purpose'),
    goals: r.list(o.goals, '$.goals', (x, p) => claim(r, x, p, 300), { max: 12 }),
    audiences: r.list(o.audiences, '$.audiences', (x, p) => claim(r, x, p, 400), { max: 12 }),
    workflows: r.list(o.workflows, '$.workflows', (x, p): Workflow => {
      const w = r.obj(x, p)
      const flow: Workflow = {
        id: id(r, w.id, `${p}.id`),
        name: r.str(w.name, `${p}.name`, 120),
        steps: r.list(w.steps, `${p}.steps`, (y, q) => r.str(y, q, 200), { min: 1, max: 20 }),
        source: provenance(r, w.source, `${p}.source`)
      }
      const screens = r.list(w.screens, `${p}.screens`, (y, q) => r.str(y, q, 64), { max: 20 })
      if (screens.length) flow.screens = screens
      return flow
    }, { max: 12 }),
    architecture: architecture(r, o.architecture, '$.architecture'),
    stack: r.list(o.stack, '$.stack', (x, p) => claim(r, x, p, 300), { max: 30 }),
    designState: r.list(o.designState, '$.designState', (x, p) => claim(r, x, p, 400), { max: 30 }),
    designConstraints: r.list(o.designConstraints, '$.designConstraints', (x, p) => claim(r, x, p, 400), { max: 30 }),
    sources: r.list(o.sources, '$.sources', (x, p) => readEvidence(r, x, p), { max: 60 }),
    unknowns: r.list(o.unknowns, '$.unknowns', (x, p) => r.str(x, p, 300), { max: 30 }),
    questions: r.list(o.questions, '$.questions', (x, p) => r.str(x, p, 300), { max: 20 })
  }
  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, value }
}

export type OverviewGap = 'summary' | 'purpose' | 'purposeUnbacked' | 'audiences' | 'workflows' | 'architecture'

/**
 * Spec §5.4: complete only when purpose, users, main tasks and structure are filled in and the essential
 * judgements are backed by evidence or the user. Technical versions etc. may stay unknown. A file arriving is
 * never enough on its own.
 */
export function overviewCompleteness(o: Pick<ProjectOverview, 'summary' | 'purpose' | 'audiences' | 'workflows' | 'architecture'>): { complete: boolean; gaps: OverviewGap[] } {
  const gaps: OverviewGap[] = []
  const backed = (c: Claim): boolean => c.source === 'verified' || c.source === 'user'
  if (!o.summary.value) gaps.push('summary')
  if (!o.purpose.value) gaps.push('purpose')
  else if (!backed(o.purpose)) gaps.push('purposeUnbacked')
  if (!o.audiences.some((a) => a.value)) gaps.push('audiences')
  if (!o.workflows.length) gaps.push('workflows')
  if (!o.architecture.nodes.length) gaps.push('architecture')
  return { complete: gaps.length === 0, gaps }
}

function shadow(r: Reader, v: unknown, path: string): ShadowSpec | null {
  if (v === null) return null
  const o = r.obj(v, path)
  return {
    x: r.num(o.x, `${path}.x`, -50, 50),
    y: r.num(o.y, `${path}.y`, -50, 50),
    blur: r.num(o.blur, `${path}.blur`, 0, 100),
    spread: r.num(o.spread, `${path}.spread`, -50, 50),
    color: r.hex(o.color, `${path}.color`),
    opacity: r.num(o.opacity, `${path}.opacity`, 0, 1)
  }
}

function typeSpec(r: Reader, v: unknown, path: string): TypeSpec {
  const o = r.obj(v, path)
  const family = r.str(o.family, `${path}.family`, 80)
  // A font-family name, not CSS: no characters that could close the declaration.
  if (/[;{}<>]/.test(family)) r.err(`${path}.family`, 'not a font name')
  return {
    family,
    fallback: r.str(o.fallback, `${path}.fallback`, 160).replace(/[;{}<>]/g, ''),
    size: r.num(o.size, `${path}.size`, 8, 96),
    weight: r.int(o.weight, `${path}.weight`, 100, 900),
    lineHeight: r.num(o.lineHeight, `${path}.lineHeight`, 0.8, 3)
  }
}

export function readTokens(v: unknown, path = '$'): Result<DesignTokens> {
  const r = new Reader()
  const o = r.obj(v, path)
  const c = r.obj(o.colors, `${path}.colors`)
  const colors = Object.fromEntries(COLOR_ROLES.map((role) => [role, r.hex(c[role], `${path}.colors.${role}`)])) as DesignTokens['colors']
  const ro = r.obj(o.ratio, `${path}.ratio`)
  const ratio: ColorRatio = {
    background: r.num(ro.background, `${path}.ratio.background`, 0, 100),
    surface: r.num(ro.surface, `${path}.ratio.surface`, 0, 100),
    accent: r.num(ro.accent, `${path}.ratio.accent`, 0, 100)
  }
  if (Math.abs(ratio.background + ratio.surface + ratio.accent - 100) > 0.5) r.err(`${path}.ratio`, 'shares must add up to 100')
  const so = r.obj(o.shadows, `${path}.shadows`)
  const shadows = Object.fromEntries(SHADOW_ROLES.map((role) => [role, shadow(r, so[role] ?? null, `${path}.shadows.${role}`)])) as DesignTokens['shadows']
  const to = r.obj(o.type, `${path}.type`)
  const type = Object.fromEntries(TYPE_ROLES.map((role) => [role, typeSpec(r, to[role], `${path}.type.${role}`)])) as DesignTokens['type']
  const bo = r.obj(o.box, `${path}.box`)
  const box: BoxSpec = {
    radius: r.num(bo.radius, `${path}.box.radius`, 0, 48),
    paddingX: r.num(bo.paddingX, `${path}.box.paddingX`, 0, 64),
    paddingY: r.num(bo.paddingY, `${path}.box.paddingY`, 0, 64),
    gap: r.num(bo.gap, `${path}.box.gap`, 0, 64),
    density: r.oneOf<Density>(bo.density, `${path}.box.density`, ['compact', 'comfortable', 'spacious'])
  }
  if (bo.buttonMinWidth !== undefined) box.buttonMinWidth = r.num(bo.buttonMinWidth, `${path}.box.buttonMinWidth`, 0, 600)
  if (bo.maxWidth !== undefined) box.maxWidth = r.num(bo.maxWidth, `${path}.box.maxWidth`, 120, 4000)
  const value: DesignTokens = { colors, ratio, shadows, type, box }
  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, value }
}

function skillRef(r: Reader, v: unknown, path: string): SkillRef {
  const o = r.obj(v, path)
  const s: SkillRef = {
    id: id(r, o.id, `${path}.id`),
    name: r.str(o.name, `${path}.name`, 80),
    source: r.oneOf(o.source, `${path}.source`, ['builtin', 'agent', 'imported'] as const)
  }
  const ver = r.optStr(o.version, `${path}.version`, 40)
  if (ver) s.version = ver
  const d = r.optStr(o.description, `${path}.description`, 600)
  if (d) s.description = d
  return s
}

function check(r: Reader, v: unknown, path: string): Check {
  const o = r.obj(v, path)
  const c: Check = {
    id: id(r, o.id, `${path}.id`),
    kind: r.oneOf(o.kind, `${path}.kind`, ['visual', 'runtime'] as const),
    label: r.str(o.label, `${path}.label`, 200),
    // What an agent claims about checks it ran is recorded, but a proposal never arrives "passed" by itself.
    status: 'unverified'
  }
  const note = r.optStr(o.note, `${path}.note`, 300)
  if (note) c.note = note
  return c
}

/** A design proposal from an agent. Previews are references to files the app validated itself, never inline markup. */
export function readProposal(v: unknown, ctx: { projectId: string; inputRevision: number }): Result<DesignProposal> {
  const r = new Reader()
  const o = r.obj(v, '$')
  const pid = r.str(o.projectId, '$.projectId', 64)
  if (pid && pid !== ctx.projectId) r.err('$.projectId', `is for project "${pid}", not "${ctx.projectId}"`)
  const tokens = readTokens(o.tokens, '$.tokens')
  if (!tokens.ok) r.errors.push(...tokens.errors)
  const value: DesignProposal = {
    proposalId: id(r, o.proposalId, '$.proposalId'),
    projectId: ctx.projectId,
    inputRevision: ctx.inputRevision,
    direction: r.str(o.direction, '$.direction', 40),
    name: r.str(o.name, '$.name', 80),
    rationale: r.str(o.rationale, '$.rationale', 1500),
    tokens: tokens.ok ? tokens.value : ({} as DesignTokens),
    changes: r.list(o.changes, '$.changes', (x, p) => r.str(x, p, 300), { max: 40 }),
    preserved: r.list(o.preserved, '$.preserved', (x, p) => r.str(x, p, 300), { max: 40 }),
    previewKind: 'sample',
    checks: r.list(o.checks, '$.checks', (x, p) => check(r, x, p), { max: 30 }),
    origin: 'agent'
  }
  const cautions = r.list(o.cautions, '$.cautions', (x, p) => r.str(x, p, 300), { max: 20 })
  if (cautions.length) value.cautions = cautions
  if (o.skill !== undefined) value.skill = skillRef(r, o.skill, '$.skill')
  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, value }
}

/** What a skill needs, gathered by the agent (skill_setup). */
export function readSkillContext(v: unknown, ctx: { projectId: string; skill: SkillRef }): Result<Pick<SkillContext, 'fields' | 'missing'>> {
  const r = new Reader()
  const o = r.obj(v, '$')
  const pid = r.str(o.projectId, '$.projectId', 64)
  if (pid && pid !== ctx.projectId) r.err('$.projectId', `is for project "${pid}", not "${ctx.projectId}"`)
  const sid = r.str(o.skillId, '$.skillId', 64)
  if (sid && sid !== ctx.skill.id) r.err('$.skillId', `is for skill "${sid}", not "${ctx.skill.id}"`)
  const fo = r.obj(o.fields, '$.fields')
  const keys = Object.keys(fo)
  if (keys.length > 40) r.err('$.fields', 'more than 40 fields')
  const fields: Record<string, Claim> = {}
  for (const k of keys.slice(0, 40)) {
    if (!ID_RE.test(k)) { r.err(`$.fields.${k}`, 'field names use letters, digits, ".", "_" and "-"'); continue }
    fields[k] = claim(r, fo[k], `$.fields.${k}`, 600)
  }
  const missing = r.list(o.missing, '$.missing', (x, p) => r.str(x, p, 64), { max: 40 })
  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, value: { fields, missing } }
}

/** Skills an agent reports as installed (capabilities). */
export function readSkillList(v: unknown): Result<SkillRef[]> {
  const r = new Reader()
  const o = r.obj(v, '$')
  const skills = r.list(o.skills, '$.skills', (x, p) => ({ ...skillRef(r, { ...(isObj(x) ? x : {}), source: 'agent' }, p) }), { max: 100 })
  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, value: skills }
}
