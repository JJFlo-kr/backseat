// Text side of the project overview (spec §5.3, §6): provenance words, the structure as a tree, the design hints
// derived from goals, and the Markdown export. Pure: no DOM, no Electron. Every user-visible word is a message
// key (uiux.overview.*); everything that comes from the agent is data and goes in as plain text only.
import type { Translate } from '../i18n'
import type { ArchEdge, ArchNode, ArchNodeType, Architecture, Claim, Evidence, ProjectOverview, Provenance } from './types'

// ---------- words ----------

/** 확인함 / 사용자 확인 / AI 추정 / 미확인: the label shown next to every statement. */
export function provenanceLabel(p: Provenance, t: Translate): string {
  return t(`uiux.overview.prov.${p}`)
}

export function typeLabel(type: ArchNodeType, t: Translate): string {
  return t(`uiux.overview.type.${type}`)
}

export function basisLabel(basis: ProjectOverview['basis'], t: Translate): string {
  return t(`uiux.overview.basis.${basis}`)
}

/** Statements that rest on a guess or on nothing are drawn dashed and carry the word. */
export const isUncertain = (p: Provenance): boolean => p === 'estimated' || p === 'unknown'

/** The statement's value, or the "not written yet" words when it is empty. */
export function claimText(c: Claim<string> | undefined, t: Translate): string {
  const v = c?.value?.trim() ?? ''
  return v === '' ? t('uiux.overview.empty') : v
}

/** One line for an evidence entry: the project-relative path first, then note, check time and revision. */
export function evidenceLine(e: Evidence, t: Translate): string {
  const parts: string[] = []
  if (e.note) parts.push(e.note)
  if (e.checkedAt) parts.push(t('uiux.overview.evidence.checked', { date: e.checkedAt.slice(0, 10) }))
  if (e.revision) parts.push(t('uiux.overview.evidence.revision', { revision: e.revision }))
  return parts.length ? `${e.path} — ${parts.join(' · ')}` : e.path
}

// ---------- structure as a tree ----------

export interface TreeItem {
  node: ArchNode
  children: TreeItem[]
  /** Edges that leave this node / arrive at it, with the other end's label. */
  out: { edge: ArchEdge; other: string }[]
  in: { edge: ArchEdge; other: string }[]
}

/**
 * The parent structure both the text and the diagram use: nodes by id (first one wins), children per parent, and
 * the top level. A node whose parent is itself, missing or part of a parent loop is top level, so the two views
 * agree on what the top-level nodes are.
 */
export function resolveParents(nodes: readonly ArchNode[]): { byId: Map<string, ArchNode>; kids: Map<string, ArchNode[]>; tops: ArchNode[] } {
  const byId = new Map<string, ArchNode>()
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n)
  const hasValidParent = (n: ArchNode): boolean => {
    if (!n.parent || n.parent === n.id || !byId.has(n.parent)) return false
    const seen = new Set<string>([n.id])
    let cur: string | undefined = n.parent
    while (cur !== undefined) {
      if (seen.has(cur)) return false
      seen.add(cur)
      cur = byId.get(cur)?.parent
      if (cur !== undefined && !byId.has(cur)) break
    }
    return true
  }
  const kids = new Map<string, ArchNode[]>()
  const tops: ArchNode[] = []
  for (const n of byId.values()) {
    if (hasValidParent(n)) {
      const list = kids.get(n.parent!) ?? []
      list.push(n)
      kids.set(n.parent!, list)
    } else tops.push(n)
  }
  return { byId, kids, tops }
}

/** Nested list of the architecture: nodes without a (valid) parent first, children under their parent. */
export function structureTree(arch: Architecture): TreeItem[] {
  const { byId, kids, tops } = resolveParents(arch.nodes)
  const label = (id: string): string => byId.get(id)?.label ?? id
  const edges = arch.edges.filter((e) => byId.has(e.from) && byId.has(e.to))
  const build = (n: ArchNode): TreeItem => ({
    node: n,
    children: (kids.get(n.id) ?? []).map(build),
    out: edges.filter((e) => e.from === n.id).map((e) => ({ edge: e, other: label(e.to) })),
    in: edges.filter((e) => e.to === n.id).map((e) => ({ edge: e, other: label(e.from) }))
  })
  return tops.map(build)
}

// ---------- design hints (suggestions derived from the overview, not facts) ----------

export interface DesignHint {
  ruleId: string
  /** The goal the hint comes from (its text and provenance). */
  basis: string
  basisSource: Provenance
  /** Translated suggestion. */
  text: string
}

export interface DesignImplications {
  fromGoals: DesignHint[]
  /** Goals no rule matched. */
  unmatched: Claim[]
  state: Claim[]
  constraints: Claim[]
}

interface Rule { id: string; test: RegExp }

/** Simple, readable rules: a word in a goal → what it usually means for the design. Korean and English words. */
export const DESIGN_RULES: readonly Rule[] = [
  { id: 'dense', test: /정확|정밀|속도|빠르|빠른|신속|비교|숫자|수치|데이터|통계|대시보드|분석|accura|precis|speed|fast|quick|compar|number|numeric|data|dashboard|analytic|metric/i },
  { id: 'readable', test: /가독|읽기|읽는|본문|readab|legib|reading|typograph/i },
  { id: 'brand', test: /브랜드|아이덴티티|정체성|개성|brand|identity/i },
  { id: 'trust', test: /신뢰|안전|보안|투명|안정|trust|safe|secur|reliab|transparen/i },
  { id: 'access', test: /접근성|장애|고령|색약|access|a11y|wcag|disab|elder/i },
  { id: 'simple', test: /쉬운|쉽게|초보|단순|간단|처음|simple|easy|beginner|novice|onboard|intuitive/i },
  { id: 'mobile', test: /모바일|반응형|터치|휴대|mobile|responsive|touch|tablet/i },
  { id: 'theme', test: /다크|어두운|테마|dark|theme/i }
]

export function designImplications(o: ProjectOverview, t: Translate): DesignImplications {
  const fromGoals: DesignHint[] = []
  const unmatched: Claim[] = []
  for (const g of o.goals) {
    const text = g.value ?? ''
    const hits = DESIGN_RULES.filter((r) => r.test.test(text))
    if (hits.length === 0) unmatched.push(g)
    for (const r of hits) {
      fromGoals.push({ ruleId: r.id, basis: text, basisSource: g.source, text: t(`uiux.overview.imply.${r.id}`) })
    }
  }
  return { fromGoals, unmatched, state: o.designState, constraints: o.designConstraints }
}

// ---------- Markdown ----------

/** Plain text for a Markdown line: one line, no tags (a "<" would start HTML in many viewers). */
export function mdText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/[<>]/g, (c) => `\\${c}`)
}

const mdCode = (s: string): string => '`' + s.replace(/[`\r\n]/g, "'") + '`'

export function evidenceMd(list: Evidence[] | undefined, t: Translate, indent: string): string[] {
  if (!list || list.length === 0) return []
  return list.map((e) => {
    const parts: string[] = []
    if (e.note) parts.push(mdText(e.note))
    if (e.checkedAt) parts.push(t('uiux.overview.evidence.checked', { date: e.checkedAt.slice(0, 10) }))
    if (e.revision) parts.push(t('uiux.overview.evidence.revision', { revision: mdText(e.revision) }))
    return `${indent}- ${t('uiux.overview.evidence.label')}: ${mdCode(e.path)}${parts.length ? ' — ' + parts.join(' · ') : ''}`
  })
}

/** One statement as a Markdown line (`bullet` can carry a leading label) with its provenance word and evidence lines. */
export function claimMd(c: Claim | undefined, t: Translate, bullet: string, indent = ''): string[] {
  const src: Provenance = c?.source ?? 'unknown'
  const text = mdText(claimText(c, t))
  return [`${indent}${bullet} ${text} — ${provenanceLabel(src, t)}`, ...evidenceMd(c?.evidence, t, indent + '  ')]
}

function claimListMd(list: Claim[], t: Translate, ordered: boolean): string[] {
  if (list.length === 0) return [`- ${t('uiux.overview.empty')} — ${provenanceLabel('unknown', t)}`]
  const out: string[] = []
  list.forEach((c, i) => out.push(...claimMd(c, t, ordered ? `${i + 1}.` : '-')))
  return out
}

function treeMd(items: TreeItem[], t: Translate, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth)
  for (const it of items) {
    const n = it.node
    const marker = isUncertain(n.source) ? ` — ${t('uiux.overview.dashedNote')}` : ''
    out.push(`${pad}- **${mdText(n.label)}** · ${typeLabel(n.type, t)} · ${provenanceLabel(n.source, t)}${marker}`)
    if (n.description) out.push(`${pad}  ${mdText(n.description)}`)
    out.push(...evidenceMd(n.evidence, t, pad + '  '))
    for (const c of it.out) {
      out.push(`${pad}  - ${t('uiux.overview.conn.toLine', { relation: mdText(c.edge.relation), other: mdText(c.other), source: provenanceLabel(c.edge.source, t) })}`)
    }
    treeMd(it.children, t, depth + 1, out)
  }
}

export interface MarkdownOptions {
  projectName?: string
  /** Added to every heading level: 1 puts the whole overview one level down, as a section of a larger file. */
  headingOffset?: number
}

/** Readable export: headings, lists, every statement with its provenance word and evidence paths. No HTML. */
export function overviewToMarkdown(o: ProjectOverview, t: Translate, opts: MarkdownOptions = {}): string {
  const L: string[] = []
  const head = (level: number, text: string): string => `${'#'.repeat(level + (opts.headingOffset ?? 0))} ${text}`
  const name = opts.projectName ? mdText(opts.projectName) : ''
  L.push(head(1, `${t('uiux.overview.title')}${name ? ` — ${name}` : ''}`), '')
  L.push(`- ${t('uiux.overview.md.basis')}: ${basisLabel(o.basis, t)}`)
  L.push(`- ${t('uiux.overview.md.revision')}: ${o.revision}`)
  if (o.generatedAt) L.push(`- ${t('uiux.overview.md.generated')}: ${mdText(o.generatedAt)}`)
  L.push(`- ${t('uiux.overview.md.legend')}: ${(['verified', 'user', 'estimated', 'unknown'] as Provenance[]).map((p) => provenanceLabel(p, t)).join(' / ')}`, '')

  L.push(head(2, t('uiux.overview.tab.purpose')), '')
  L.push(head(3, t('uiux.overview.sec.summary')), '', ...claimMd(o.summary, t, '-'), '')
  L.push(head(3, t('uiux.overview.sec.purpose')), '', ...claimMd(o.purpose, t, '-'), '')
  L.push(head(3, t('uiux.overview.sec.audiences')), '', ...claimListMd(o.audiences, t, false), '')
  L.push(head(3, t('uiux.overview.sec.goals')), '', ...claimListMd(o.goals, t, true), '')
  L.push(head(3, t('uiux.overview.sec.constraints')), '', ...claimListMd(o.designConstraints, t, false), '')

  L.push(head(2, t('uiux.overview.tab.structure')), '')
  const tree = structureTree(o.architecture)
  if (tree.length === 0) L.push(`- ${t('uiux.overview.structure.none')} — ${provenanceLabel('unknown', t)}`)
  else treeMd(tree, t, 0, L)
  L.push('', head(3, t('uiux.overview.sec.stack')), '', ...claimListMd(o.stack, t, false), '')

  L.push(head(2, t('uiux.overview.tab.flows')), '')
  if (o.workflows.length === 0) L.push(`- ${t('uiux.overview.flows.none')} — ${provenanceLabel('unknown', t)}`, '')
  const labelOf = new Map(o.architecture.nodes.map((n) => [n.id, n.label]))
  o.workflows.forEach((w, i) => {
    L.push(head(3, `${i + 1}. ${mdText(w.name)} — ${provenanceLabel(w.source, t)}`), '')
    if (w.steps.length === 0) L.push(`- ${t('uiux.overview.empty')}`)
    w.steps.forEach((s, k) => L.push(`${k + 1}. ${mdText(s)}`))
    const screens = (w.screens ?? []).map((id) => mdText(labelOf.get(id) ?? id))
    if (screens.length) L.push('', `${t('uiux.overview.flows.screens')}: ${screens.join(', ')}`)
    L.push('')
  })

  L.push(head(2, t('uiux.overview.tab.design')), '')
  const imp = designImplications(o, t)
  L.push(`${t('uiux.overview.design.intro')}`, '')
  L.push(head(3, t('uiux.overview.design.fromGoals')), '')
  if (imp.fromGoals.length === 0) L.push(`- ${t('uiux.overview.design.none')}`)
  for (const h of imp.fromGoals) {
    L.push(`- ${t('uiux.overview.design.suggestion')}: ${h.text}`)
    L.push(`  - ${t('uiux.overview.design.basis', { text: mdText(h.basis), source: provenanceLabel(h.basisSource, t) })}`)
  }
  L.push('', head(3, t('uiux.overview.design.state')), '', ...claimListMd(imp.state, t, false), '')
  L.push(head(3, t('uiux.overview.sec.constraints')), '', ...claimListMd(imp.constraints, t, false), '')

  L.push(head(2, t('uiux.overview.unknowns.title')), '')
  if (o.unknowns.length === 0) L.push(`- ${t('uiux.overview.none')}`)
  for (const u of o.unknowns) L.push(`- ${mdText(u)} — ${provenanceLabel('unknown', t)}`)
  L.push('', head(2, t('uiux.overview.questions.title')), '')
  const qs = o.questions ?? []
  if (qs.length === 0) L.push(`- ${t('uiux.overview.none')}`)
  for (const q of qs) L.push(`- ${mdText(q)}`)

  L.push('', head(2, t('uiux.overview.sources.title')), '')
  if (o.sources.length === 0) L.push(`- ${t('uiux.overview.none')}`)
  for (const s of o.sources) L.push(`- ${mdCode(s.path)}${s.note ? ` — ${mdText(s.note)}` : ''}`)
  L.push('')
  return L.join('\n')
}
