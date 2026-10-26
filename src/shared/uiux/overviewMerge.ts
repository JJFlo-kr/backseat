// How an agent's overview and the user's own entries combine (spec §5.4): what the user entered or confirmed
// (source 'user') is never replaced or removed by an agent's re-analysis; everything else comes from the agent.
// Pure (tests/uiux-app-merge.test.ts).
import type { ArchEdge, ArchNode, Claim, Evidence, ProjectOverview, Workflow } from './types'

/** An overview as the validators produce it (before the app adds basis, generatedAt and jobId). */
export type AgentOverview = Omit<ProjectOverview, 'revision' | 'basis' | 'generatedAt' | 'jobId'>

/** The designState entries that hold the user's screen kinds start with this. */
export const SCREEN_PREFIX = 'screen: '

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** User claims first (they keep their order), then the agent's claims that do not repeat one of them. */
function mergeClaims(prev: readonly Claim[], agent: readonly Claim[]): Claim[] {
  const mine = prev.filter((c) => c.source === 'user')
  const seen = new Set(mine.map((c) => norm(c.value)))
  const out = [...mine]
  for (const c of agent) {
    const k = norm(c.value)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

function mergeSingle(prev: Claim | undefined, agent: Claim): Claim {
  return prev && prev.source === 'user' && prev.value.trim() ? prev : agent
}

function mergeWorkflows(prev: readonly Workflow[], agent: readonly Workflow[]): Workflow[] {
  const mine = prev.filter((w) => w.source === 'user')
  const names = new Set(mine.map((w) => norm(w.name)))
  const ids = new Set(mine.map((w) => w.id))
  const out = [...mine]
  for (const w of agent) {
    if (names.has(norm(w.name))) continue
    let id = w.id
    for (let n = 2; ids.has(id); n++) id = `${w.id}-${n}`
    ids.add(id)
    names.add(norm(w.name))
    out.push(id === w.id ? w : { ...w, id })
  }
  return out
}

function mergeArchitecture(prev: ProjectOverview['architecture'] | undefined, agent: AgentOverview['architecture']): AgentOverview['architecture'] {
  const mineNodes = (prev?.nodes ?? []).filter((n) => n.source === 'user')
  const nodes: ArchNode[] = [...mineNodes]
  const byLabel = new Map(mineNodes.map((n) => [`${n.type}:${norm(n.label)}`, n.id]))
  const taken = new Set(mineNodes.map((n) => n.id))
  /** agent node id → id it has in the result (a user node of the same label, or a renamed id). */
  const remap = new Map<string, string>()
  for (const n of agent.nodes) {
    const twin = byLabel.get(`${n.type}:${norm(n.label)}`)
    if (twin) {
      remap.set(n.id, twin)
      continue
    }
    let id = n.id
    for (let k = 2; taken.has(id); k++) id = `${n.id}-${k}`
    taken.add(id)
    remap.set(n.id, id)
    nodes.push(id === n.id ? n : { ...n, id })
  }
  const fixed = nodes.map((n): ArchNode => {
    if (!n.parent || mineNodes.includes(n)) return n
    const parent = remap.get(n.parent)
    if (!parent) {
      const { parent: _gone, ...rest } = n
      void _gone
      return rest
    }
    return parent === n.parent ? n : { ...n, parent }
  })
  const ids = new Set(fixed.map((n) => n.id))
  const key = (e: Pick<ArchEdge, 'from' | 'to' | 'relation'>): string => `${e.from}\u0000${e.to}\u0000${norm(e.relation)}`
  const edges: ArchEdge[] = (prev?.edges ?? []).filter((e) => e.source === 'user' && ids.has(e.from) && ids.has(e.to))
  const seen = new Set(edges.map(key))
  for (const e of agent.edges) {
    const edge = { ...e, from: remap.get(e.from) ?? e.from, to: remap.get(e.to) ?? e.to }
    if (!ids.has(edge.from) || !ids.has(edge.to) || seen.has(key(edge))) continue
    seen.add(key(edge))
    edges.push(edge)
  }
  return { nodes: fixed, edges }
}

function mergeEvidence(prev: readonly Evidence[], agent: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>()
  const out: Evidence[] = []
  for (const e of [...agent, ...prev]) {
    const k = e.path.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

function mergeTexts(...lists: (readonly string[])[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const l of lists) {
    for (const s of l) {
      const k = norm(s)
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(s)
    }
  }
  return out
}

/**
 * The stored overview after an agent's result arrived. `prev` null = nothing stored yet.
 *  - single fields (summary, purpose): the user's text stays; otherwise the agent's;
 *  - lists: the user's items stay (first), the agent's items follow except those repeating a user item (same
 *    value, ignoring case and spacing); an earlier agent run's items are replaced by the new run's;
 *  - sources: both, without repeats;
 *  - unknowns and questions: the new run's, plus those of a user-made or imported overview (a new run
 *    supersedes the old run's own remarks, not what the user or a file said).
 */
export function mergeOverview(prev: ProjectOverview | null, agent: AgentOverview): AgentOverview {
  const keepRemarks = prev !== null && prev.basis !== 'agent'
  const questions = mergeTexts(agent.questions ?? [], keepRemarks ? prev?.questions ?? [] : [])
  const merged: AgentOverview = {
    schemaVersion: agent.schemaVersion,
    projectId: agent.projectId,
    summary: mergeSingle(prev?.summary, agent.summary),
    purpose: mergeSingle(prev?.purpose, agent.purpose),
    goals: mergeClaims(prev?.goals ?? [], agent.goals),
    audiences: mergeClaims(prev?.audiences ?? [], agent.audiences),
    workflows: mergeWorkflows(prev?.workflows ?? [], agent.workflows),
    architecture: mergeArchitecture(prev?.architecture, agent.architecture),
    stack: mergeClaims(prev?.stack ?? [], agent.stack),
    designState: mergeClaims(prev?.designState ?? [], agent.designState),
    designConstraints: mergeClaims(prev?.designConstraints ?? [], agent.designConstraints),
    sources: mergeEvidence(prev?.sources ?? [], agent.sources),
    unknowns: mergeTexts(agent.unknowns, keepRemarks ? prev?.unknowns ?? [] : [])
  }
  if (questions.length) merged.questions = questions
  return merged
}

/** Skill fields: what the user typed stays, everything else is the agent's. */
export function mergeSkillFields(prev: Record<string, Claim> | undefined, agent: Record<string, Claim>): { fields: Record<string, Claim>; kept: string[] } {
  const fields: Record<string, Claim> = { ...agent }
  const kept: string[] = []
  for (const [k, c] of Object.entries(prev ?? {})) {
    if (c.source === 'user' && c.value.trim()) {
      fields[k] = c
      kept.push(k)
    }
  }
  return { fields, kept }
}

/** What the user can edit in the panel (src/shared/types.ts UserOverviewInput). */
export interface OverviewEdits {
  summary: string
  purpose: string
  audiences: string[]
  goals: string[]
  screenKinds: string[]
}

const clean = (s: string): string => s.trim().replace(/\s+/g, ' ')

function editClaim(prev: Claim | undefined, text: string): Claim {
  const v = clean(text)
  return prev && norm(prev.value) === norm(v) ? prev : { value: v, source: 'user' }
}

function editList(prev: readonly Claim[], texts: readonly string[]): Claim[] {
  const out: Claim[] = []
  const seen = new Set<string>()
  for (const raw of texts) {
    const v = clean(raw)
    const k = norm(v)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(prev.find((c) => norm(c.value) === k) ?? { value: v, source: 'user' })
  }
  return out
}

/**
 * The user's hand edits applied to a stored overview: fields whose text changed (or items that are new) become
 * the user's, unchanged ones keep their source and evidence, everything else stays as stored.
 */
export function applyOverviewEdits(prev: ProjectOverview, edits: OverviewEdits): Omit<ProjectOverview, 'revision'> {
  const screens = prev.designState.filter((c) => c.value.startsWith(SCREEN_PREFIX))
  const wanted = edits.screenKinds.map(clean).filter(Boolean)
  const screenClaims = editList(screens, wanted.map((k) => SCREEN_PREFIX + k))
  const { revision: _r, ...rest } = prev
  void _r
  return {
    ...rest,
    summary: editClaim(prev.summary, edits.summary),
    purpose: editClaim(prev.purpose, edits.purpose),
    goals: editList(prev.goals, edits.goals),
    audiences: editList(prev.audiences, edits.audiences),
    designState: [...prev.designState.filter((c) => !c.value.startsWith(SCREEN_PREFIX)), ...screenClaims]
  }
}

/** True when the edits would not change the stored overview. */
export function sameOverviewContent(a: Omit<ProjectOverview, 'revision'>, b: ProjectOverview): boolean {
  const { revision: _r, generatedAt: _g, ...bb } = b
  const { generatedAt: _h, ...aa } = a
  void _r; void _g; void _h
  return JSON.stringify(aa) === JSON.stringify(bb)
}
