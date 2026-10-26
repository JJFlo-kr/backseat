// "개요 파악 완료" view (spec §5.4, §6): a large overlay in the editor window that explains the project at a glance.
// Rendered ONLY from the validated ProjectOverview: every string goes in through textContent, the SVG is built
// with createElementNS from numbers (the layout) and fixed class/dash constants, nothing is ever parsed as HTML.
// Provenance is always shown in words (확인함 / 사용자 확인 / AI 추정 / 미확인); estimated and unknown items are also
// dashed and carry a text marker. The PNG export is drawn on a canvas from the same layout data (no DOM raster).
// Styles: ./overview-view.css (scoped under .uxo-*); the caller links that file once (see index.html).
import {
  FONT_PX, estimateWidth, expandableIds, layoutArchitecture, tooManyForDiagram,
  type Layout, type LayoutEdge, type LayoutNode, type Point
} from '../../../shared/uiux/diagram'
import {
  basisLabel, claimText, designImplications, evidenceLine, isUncertain, overviewToMarkdown, provenanceLabel, structureTree, typeLabel,
  type TreeItem
} from '../../../shared/uiux/overviewText'
import type { Architecture, Claim, Evidence, ProjectOverview, Provenance, Workflow } from '../../../shared/uiux/types'
import { button, el as h } from './dom'

export interface OverviewViewOptions {
  t: (key: string, params?: Record<string, string | number>) => string
  /** Export: 'png' passes a PNG data URL of the current diagram/tab rendered by the view (canvas from the layout data). */
  onExport(format: 'md' | 'json' | 'png', pngDataUrl?: string): void
  /** User wants to edit fields (the panel shows its form). */
  onEdit?(): void
}

type Tab = 'purpose' | 'structure' | 'flows' | 'design'
const TABS: readonly Tab[] = ['purpose', 'structure', 'flows', 'design']

const SVG_NS = 'http://www.w3.org/2000/svg'
const GLYPH: Record<Provenance, string> = { verified: '✓', user: '✓', estimated: '≈', unknown: '?' }
/** Line styles by provenance: solid for checked statements, two different dashes for the others. */
const DASH: Record<Provenance, string> = { verified: '', user: '', estimated: '6 4', unknown: '2 4' }
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

// Canvas colours (the same as overview-view.css, which is the reference).
const C = {
  bg: '#1b1b1f', node: '#2a2a30', text: '#e6e6e6', muted: '#8c8c97', ok: '#3dd68c', guess: '#f5b13d', focus: '#8ab4ff', line: '#74747f'
}

// ---------- tiny DOM helpers (textContent only) ----------

function sv(tag: string, attrs: Record<string, string | number> = {}, cls?: string): SVGElement {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === 'number' ? String(Math.round(v * 10) / 10) : v)
  if (cls) e.setAttribute('class', cls)
  return e
}

function svText(text: string, x: number, y: number, cls: string, anchor?: 'middle'): SVGElement {
  const e = sv('text', { x, y }, cls)
  if (anchor) e.setAttribute('text-anchor', anchor)
  e.textContent = text
  return e
}

const btn = (label: string, onClick: () => void, cls = 'uxo-btn'): HTMLButtonElement => button(label, onClick, cls)

function arrowHead(a: Point, b: Point): string {
  const dx = Math.sign(b.x - a.x)
  const dy = Math.sign(b.y - a.y)
  const px = dy
  const py = -dx
  const pts: Point[] = [b, { x: b.x - dx * 8 + px * 4, y: b.y - dy * 8 + py * 4 }, { x: b.x - dx * 8 - px * 4, y: b.y - dy * 8 - py * 4 }]
  return pts.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(' ')
}

const arr = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : [])

/** Defensive copy: the data was validated, but the view must not throw on a missing optional list. */
function normalize(o: ProjectOverview): ProjectOverview {
  const claim = (c: Claim | undefined): Claim => (c && typeof c.value === 'string' ? c : { value: '', source: 'unknown' })
  return {
    ...o,
    summary: claim(o.summary),
    purpose: claim(o.purpose),
    goals: arr(o.goals),
    audiences: arr(o.audiences),
    workflows: arr(o.workflows).map((w) => ({ ...w, steps: arr(w.steps), screens: arr(w.screens) })),
    architecture: { nodes: arr(o.architecture?.nodes), edges: arr(o.architecture?.edges) },
    stack: arr(o.stack),
    designState: arr(o.designState),
    designConstraints: arr(o.designConstraints),
    sources: arr(o.sources),
    unknowns: arr(o.unknowns),
    questions: arr(o.questions)
  }
}

// ---------- export lines (PNG of a text tab) ----------

interface Line { kind: 'h1' | 'h2' | 'p' | 'li'; text: string; indent: number }

/** A Markdown export line as plain text: no bold marks, code quotes or escapes. */
const mdPlain = (s: string): string => s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/\\([<>])/g, '$1')

// ---------- the view ----------

let current: { close(): void } | null = null

export function openOverviewView(input: ProjectOverview, opts: OverviewViewOptions): { close(): void } {
  current?.close()
  const t = opts.t
  const o = normalize(input)
  const arch: Architecture = o.architecture
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null

  let tab: Tab = 'purpose'
  let listMode = false
  let selected: string | null = null
  let flowId: string | null = null
  const expanded = new Set<string>()
  let view = { k: 1, tx: 0, ty: 0, fitted: false }
  /** The layout the structure tab shows right now (for the PNG export); null in list mode. */
  let lastLayout: Layout | null = null
  let closed = false

  const prov = (p: Provenance): string => provenanceLabel(p, t)
  const nodeById = new Map(arch.nodes.map((n) => [n.id, n]))
  const flowById = new Map(o.workflows.map((w) => [w.id, w]))

  // ----- frame -----
  const root = h('div', 'uxo-root')
  root.dataset.hotkeysOff = ''
  const card = h('div', 'uxo-card')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  const titleId = 'uxo-title'
  card.setAttribute('aria-labelledby', titleId)
  root.append(card)

  const head = h('div', 'uxo-head')
  const titleBox = h('div', 'uxo-titlebox')
  const title = h('h2', 'uxo-title', t('uiux.overview.title'))
  title.id = titleId
  const meta = h('p', 'uxo-meta', t('uiux.overview.meta', { basis: basisLabel(o.basis, t), revision: o.revision, date: (o.generatedAt ?? '').slice(0, 10) }))
  titleBox.append(title, meta)
  const actions = h('div', 'uxo-actions')
  if (opts.onEdit) actions.append(btn(t('uiux.overview.edit'), () => { const f = opts.onEdit; close(); f?.() }))
  actions.append(
    btn(t('uiux.overview.export.md'), () => opts.onExport('md')),
    btn(t('uiux.overview.export.json'), () => opts.onExport('json')),
    btn(t('uiux.overview.export.png'), exportPng)
  )
  const closeBtn = btn(t('uiux.overview.close'), () => close(), 'uxo-btn uxo-close')
  closeBtn.setAttribute('aria-label', t('uiux.overview.closeLabel'))
  actions.append(closeBtn)
  head.append(titleBox, actions)

  const tabsEl = h('div', 'uxo-tabs')
  tabsEl.setAttribute('role', 'tablist')
  tabsEl.setAttribute('aria-label', t('uiux.overview.tabs'))
  const tabButtons = new Map<Tab, HTMLButtonElement>()
  for (const id of TABS) {
    const b = h('button', 'uxo-tab', t(`uiux.overview.tab.${id}`))
    b.type = 'button'
    b.id = `uxo-tab-${id}`
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-controls', 'uxo-panel')
    b.addEventListener('click', () => show(id))
    tabButtons.set(id, b)
    tabsEl.append(b)
  }
  tabsEl.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(tab)
    let n = -1
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = TABS.length - 1
    if (n < 0) return
    e.preventDefault()
    show(TABS[n])
    tabButtons.get(TABS[n])?.focus()
  })

  const legend = h('p', 'uxo-legend', t('uiux.overview.legend'))
  const status = h('p', 'uxo-status')
  status.setAttribute('role', 'status')
  const body = h('div', 'uxo-body')
  body.id = 'uxo-panel'
  body.setAttribute('role', 'tabpanel')
  card.append(head, tabsEl, legend, status, body)

  // ----- shared pieces -----

  function provBadge(p: Provenance): HTMLElement {
    const b = h('span', `uxo-prov uxo-prov-${p}`)
    b.append(h('span', 'uxo-glyph', GLYPH[p]), document.createTextNode(prov(p)))
    b.firstElementChild?.setAttribute('aria-hidden', 'true')
    return b
  }

  function evidenceList(list: Evidence[] | undefined, showNone = true): HTMLElement | null {
    const items = arr(list)
    if (items.length === 0) return showNone ? h('p', 'uxo-evi uxo-muted', t('uiux.overview.evidence.none')) : null
    const box = h('div', 'uxo-evi')
    box.append(h('span', 'uxo-evi-label', t('uiux.overview.evidence.label')))
    const ul = h('ul', 'uxo-evi-list')
    for (const e of items) ul.append(h('li', undefined, evidenceLine(e, t)))
    box.append(ul)
    return box
  }

  /** One statement: the text, the provenance word (and a dashed edge when uncertain), then where it comes from. */
  function claimBlock(c: Claim | undefined, big = false): HTMLElement {
    const src: Provenance = c?.source ?? 'unknown'
    const box = h('div', `uxo-claim${isUncertain(src) ? ' uxo-dashed' : ''}${big ? ' uxo-claim-big' : ''}`)
    const row = h('div', 'uxo-claim-row')
    row.append(h('span', 'uxo-text', claimText(c, t)), provBadge(src))
    box.append(row)
    const ev = evidenceList(c?.evidence)
    if (ev) box.append(ev)
    return box
  }

  function section(titleText: string, hint?: string): HTMLElement {
    const s = h('section', 'uxo-sec')
    s.append(h('h3', 'uxo-h', titleText))
    if (hint) s.append(h('p', 'uxo-hint', hint))
    return s
  }

  function claimList(list: Claim[], ordered: boolean): HTMLElement {
    if (list.length === 0) return claimBlock({ value: '', source: 'unknown' })
    const ul = h(ordered ? 'ol' : 'ul', 'uxo-list')
    for (const c of list) {
      const li = h('li')
      li.append(claimBlock(c))
      ul.append(li)
    }
    return ul
  }

  function plainList(items: string[]): HTMLElement {
    if (items.length === 0) return h('p', 'uxo-muted', t('uiux.overview.none'))
    const ul = h('ul', 'uxo-list')
    for (const s of items) {
      const li = h('li', 'uxo-dashed uxo-plain')
      li.append(h('span', 'uxo-text', s), provBadge('unknown'))
      ul.append(li)
    }
    return ul
  }

  // ----- tab 1: purpose -----

  function buildPurpose(): HTMLElement {
    const box = h('div', 'uxo-tabbody')
    const a = section(t('uiux.overview.sec.summary'))
    a.append(claimBlock(o.summary, true))
    const b = section(t('uiux.overview.sec.purpose'))
    b.append(claimBlock(o.purpose))
    const c = section(t('uiux.overview.sec.audiences'))
    c.append(claimList(o.audiences, false))
    const d = section(t('uiux.overview.sec.goals'), t('uiux.overview.goalsHint'))
    d.append(claimList(o.goals, true))
    const e = section(t('uiux.overview.sec.constraints'))
    e.append(claimList(o.designConstraints, false))
    box.append(a, b, c, d, e, unknownsBlock(), sourcesBlock())
    return box
  }

  function unknownsBlock(): HTMLElement {
    const s = h('section', 'uxo-sec uxo-unknowns')
    s.append(h('h3', 'uxo-h', t('uiux.overview.unknowns.title')), plainList(o.unknowns))
    s.append(h('h3', 'uxo-h', t('uiux.overview.questions.title')))
    const qs = arr(o.questions)
    if (qs.length === 0) s.append(h('p', 'uxo-muted', t('uiux.overview.none')))
    else {
      const ul = h('ul', 'uxo-list')
      for (const q of qs) ul.append(h('li', 'uxo-text', q))
      s.append(ul)
    }
    return s
  }

  function sourcesBlock(): HTMLElement {
    const s = section(t('uiux.overview.sources.title'))
    if (o.sources.length === 0) s.append(h('p', 'uxo-muted', t('uiux.overview.none')))
    else {
      const ul = h('ul', 'uxo-list uxo-sources')
      for (const e of o.sources) ul.append(h('li', undefined, evidenceLine(e, t)))
      s.append(ul)
    }
    return s
  }

  // ----- tab 2: structure -----

  /** Set by the structure tab while it is shown, so the detail pane (built outside it) can redraw it. */
  let refreshStructureRef: () => void = () => undefined
  const tree = structureTree(arch)
  const treeById = new Map<string, TreeItem>()
  const walk = (items: TreeItem[]): void => { for (const it of items) { treeById.set(it.node.id, it); walk(it.children) } }
  walk(tree)

  /** Screens of the selected flow: shown directly, or inside a collapsed ancestor. */
  function flowHits(layout: Layout | null): { direct: Set<string>; inside: Set<string> } {
    const direct = new Set<string>()
    const inside = new Set<string>()
    const w = flowId ? flowById.get(flowId) : undefined
    if (!w || !layout) return { direct, inside }
    const visible = new Set(layout.nodes.map((n) => n.id))
    for (const id of arr(w.screens)) {
      let cur: string | undefined = id
      let hops = 0
      while (cur !== undefined && !visible.has(cur) && hops++ < 100) cur = nodeById.get(cur)?.parent
      if (cur === undefined || !nodeById.has(id)) continue
      if (cur === id) direct.add(id)
      else inside.add(cur)
    }
    return { direct, inside }
  }

  function nodeDetail(id: string, into: HTMLElement, inline: boolean): void {
    const it = treeById.get(id)
    if (!it) return
    const n = it.node
    const head = h('div', 'uxo-nd-head')
    head.append(h(inline ? 'span' : 'h3', 'uxo-nd-title', n.label), h('span', 'uxo-type', typeLabel(n.type, t)), provBadge(n.source))
    into.append(head)
    if (isUncertain(n.source)) into.append(h('p', 'uxo-note', t('uiux.overview.dashedNote')))
    into.append(h('p', n.description ? 'uxo-desc' : 'uxo-desc uxo-muted', n.description ? n.description : t('uiux.overview.structure.noDescription')))
    const ev = evidenceList(n.evidence)
    if (ev) into.append(ev)
    const conns = (title: string, list: TreeItem['out']): void => {
      if (list.length === 0) return
      into.append(h('h4', 'uxo-h4', title))
      const ul = h('ul', 'uxo-list uxo-conns')
      for (const c of list) {
        const li = h('li', isUncertain(c.edge.source) ? 'uxo-dashed' : undefined)
        li.append(h('span', 'uxo-text', t('uiux.overview.conn.line', { other: c.other, relation: c.edge.relation })), provBadge(c.edge.source))
        ul.append(li)
      }
      into.append(ul)
    }
    conns(t('uiux.overview.conn.out'), it.out)
    conns(t('uiux.overview.conn.in'), it.in)
    const inFlows = o.workflows.filter((w) => arr(w.screens).includes(id))
    if (inFlows.length) {
      into.append(h('h4', 'uxo-h4', t('uiux.overview.structure.inFlows')))
      const ul = h('ul', 'uxo-list')
      for (const w of inFlows) {
        const li = h('li')
        li.append(inline ? h('span', 'uxo-text', w.name) : btn(w.name, () => { flowId = w.id; refreshStructureRef() }, 'uxo-link'))
        ul.append(li)
      }
      into.append(ul)
    }
  }

  function buildStructure(): HTMLElement {
    const box = h('div', 'uxo-tabbody uxo-structure')
    const bar = h('div', 'uxo-toolbar')
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', t('uiux.overview.structure.toolbar'))
    const zoomLabel = h('span', 'uxo-zoom')
    const detail = h('aside', 'uxo-detail')
    detail.setAttribute('aria-label', t('uiux.overview.structure.detailLabel'))
    const note = h('div', 'uxo-notes')
    const mainArea = h('div', 'uxo-split')
    const left = h('div', 'uxo-left')
    mainArea.append(left, detail)

    // flow highlight selector
    const flowSel = h('select', 'uxo-select')
    flowSel.setAttribute('aria-label', t('uiux.overview.structure.flowSelect'))
    flowSel.append(new Option(t('uiux.overview.structure.flowNone'), ''))
    for (const w of o.workflows) flowSel.append(new Option(w.name, w.id))
    flowSel.value = flowId ?? ''
    flowSel.addEventListener('change', () => { flowId = flowSel.value === '' ? null : flowSel.value; refreshStructure() })

    let svg: SVGSVGElement | null = null
    let world: SVGElement | null = null
    let layout: Layout | null = null
    let viewport: HTMLElement | null = null

    // ----- zoom and pan -----
    const apply = (): void => {
      world?.setAttribute('transform', `translate(${Math.round(view.tx * 10) / 10} ${Math.round(view.ty * 10) / 10}) scale(${Math.round(view.k * 1000) / 1000})`)
      zoomLabel.textContent = `${Math.round(view.k * 100)}%`
    }
    const size = (): { w: number; h: number } => {
      const r = svg?.getBoundingClientRect()
      return { w: r && r.width > 0 ? r.width : 640, h: r && r.height > 0 ? r.height : 360 }
    }
    const fit = (): void => {
      if (!layout) return
      const s = size()
      const k = Math.max(MIN_ZOOM, Math.min(1.4, (s.w - 24) / layout.width, (s.h - 24) / layout.height))
      view = { k, tx: (s.w - layout.width * k) / 2, ty: (s.h - layout.height * k) / 2, fitted: true }
      apply()
    }
    const zoomAt = (px: number, py: number, factor: number): void => {
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.k * factor))
      const f = k / view.k
      view = { k, tx: px - (px - view.tx) * f, ty: py - (py - view.ty) * f, fitted: true }
      apply()
    }
    const zoomCenter = (factor: number): void => { const s = size(); zoomAt(s.w / 2, s.h / 2, factor) }

    // ----- drawing -----
    function drawNode(n: LayoutNode, hits: { direct: Set<string>; inside: Set<string> }): SVGElement {
      const hasFlow = flowId !== null
      const hit = hits.direct.has(n.id)
      const inside = hits.inside.has(n.id)
      const cls = ['uxo-node', `uxo-src-${n.source}`, `uxo-type-${n.type}`]
      if (selected === n.id) cls.push('uxo-selected')
      if (hit || inside) cls.push('uxo-hit')
      else if (hasFlow) cls.push('uxo-dim')
      if (n.depth > 0) cls.push('uxo-child')
      const g = sv('g', { tabindex: 0, role: 'button' }, cls.join(' '))
      const tip = sv('title')
      tip.textContent = t('uiux.overview.structure.nodeTitle', { label: n.label, type: typeLabel(n.type, t), source: prov(n.source) })
      g.append(tip)
      const rect = sv('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 8 }, 'uxo-box')
      const dash = DASH[n.source]
      if (dash) rect.setAttribute('stroke-dasharray', dash)
      g.append(rect)
      n.lines.forEach((ln, i) => g.append(svText(ln, n.x + 14, n.y + 23 + i * 16, 'uxo-label')))
      const sub = `${typeLabel(n.type, t)} · ${prov(n.source)}`
      const subEl = svText(sub, n.x + 14, n.y + n.h - 11, 'uxo-sub')
      const room = n.w - 28
      if (estimateWidth(sub, 11) > room) {
        subEl.setAttribute('textLength', String(room))
        subEl.setAttribute('lengthAdjust', 'spacingAndGlyphs')
      }
      g.append(subEl)
      if (hit || inside) g.append(svText(hit ? t('uiux.overview.structure.flowTag') : t('uiux.overview.structure.flowInside'), n.x, n.y - 5, 'uxo-flowtag'))
      const select = (): void => { selected = n.id; pending = `n:${n.id}`; refreshStructure(false) }
      els.set(`n:${n.id}`, g)
      g.addEventListener('click', () => { if (!suppressClick) select() })
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); select() }
      })
      return g
    }

    function drawToggle(n: LayoutNode): SVGElement {
      const x = n.x + n.w - 24
      const y = n.y + 6
      const g = sv('g', { tabindex: 0, role: 'button' }, 'uxo-toggle')
      const tip = sv('title')
      tip.textContent = t(n.expanded ? 'uiux.overview.structure.collapse' : 'uiux.overview.structure.expand')
      g.append(tip, sv('rect', { x, y, width: 18, height: 18, rx: 4 }), svText(n.expanded ? '−' : '+', x + 9, y + 13.5, 'uxo-toggle-text', 'middle'))
      const flip = (): void => {
        if (n.expanded) expanded.delete(n.id)
        else expanded.add(n.id)
        pending = `t:${n.id}`
        refreshStructure(false)
      }
      els.set(`t:${n.id}`, g)
      g.addEventListener('click', (e) => { e.stopPropagation(); if (!suppressClick) flip() })
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); flip() }
      })
      return g
    }

    function drawEdge(e: LayoutEdge, showLabel: boolean): SVGElement {
      const g = sv('g', {}, `uxo-edge uxo-src-${e.source}`)
      const tip = sv('title')
      tip.textContent = t('uiux.overview.structure.edgeTitle', { relation: e.relation, source: prov(e.source) })
      g.append(tip)
      const d = e.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
      const path = sv('path', { d }, 'uxo-edge-line')
      const dash = DASH[e.source]
      if (dash) path.setAttribute('stroke-dasharray', dash)
      g.append(path)
      const last = e.points[e.points.length - 1]
      const before = e.points[e.points.length - 2] ?? last
      g.append(sv('polygon', { points: arrowHead(before, last) }, 'uxo-arrow'))
      // Estimated and unknown edges always carry their word on the line.
      if (showLabel || isUncertain(e.source)) {
        const text = isUncertain(e.source) ? t('uiux.overview.edge.label', { relation: e.relation, source: prov(e.source) }) : e.relation
        g.append(svText(text.length > 40 ? text.slice(0, 39) + '…' : text, e.labelAt.x, e.labelAt.y - 3, 'uxo-edge-text', 'middle'))
      }
      return g
    }

    let suppressClick = false
    /** Elements that can take focus back after a redraw: node, toggle and detail button, by key. */
    const els = new Map<string, Element>()
    let pending: string | null = null

    function drawDiagram(): void {
      if (!world) return
      while (world.firstChild) world.removeChild(world.firstChild)
      els.clear()
      layout = layoutArchitecture(arch, { expanded: Array.from(expanded) })
      lastLayout = layout
      const hits = flowHits(layout)
      for (const th of layout.tethers) {
        world.append(sv('polyline', { points: th.points.map((p) => `${p.x},${p.y}`).join(' ') }, 'uxo-tether'))
      }
      const edgeLayer = sv('g')
      const incident = (e: LayoutEdge): boolean => selected !== null && (e.from === selected || e.to === selected)
      for (const e of layout.edges) edgeLayer.append(drawEdge(e, layout.edges.length <= 14 || incident(e)))
      world.append(edgeLayer)
      for (const n of layout.nodes) {
        world.append(drawNode(n, hits))
        if (n.hasChildren) world.append(drawToggle(n))
      }
    }

    function drawList(): void {
      lastLayout = null
      detail.hidden = true
      left.replaceChildren()
      const hits = flowId ? new Set(arr(flowById.get(flowId)?.screens)) : new Set<string>()
      const renderItems = (items: TreeItem[]): HTMLElement => {
        const ul = h('ul', 'uxo-tree')
        for (const it of items) {
          const li = h('li', `uxo-tree-item${hits.has(it.node.id) ? ' uxo-hit' : ''}`)
          const inner = h('div', `uxo-tree-node${isUncertain(it.node.source) ? ' uxo-dashed' : ''}`)
          if (hits.has(it.node.id)) inner.append(h('span', 'uxo-flowtag-inline', t('uiux.overview.structure.flowTag')))
          nodeDetail(it.node.id, inner, true)
          li.append(inner)
          if (it.children.length) li.append(renderItems(it.children))
          ul.append(li)
        }
        return ul
      }
      left.append(tree.length ? renderItems(tree) : h('p', 'uxo-muted', t('uiux.overview.structure.none')))
    }

    function drawNotes(reason: 'none' | 'fallback' | 'tooMany'): void {
      note.replaceChildren()
      if (reason === 'fallback') note.append(h('p', 'uxo-note-warn', t('uiux.overview.structure.fallback')))
      if (reason === 'tooMany') note.append(h('p', 'uxo-note-warn', t('uiux.overview.structure.tooMany', { n: arch.nodes.length })))
      if (layout?.truncated && !listMode) {
        note.append(h('p', 'uxo-note-warn', t('uiux.overview.structure.truncated', { shown: layout.nodes.filter((n) => n.depth === 0).length, hidden: layout.omitted.length })))
      }
      const w = flowId ? flowById.get(flowId) : undefined
      if (w) {
        const p = h('p', 'uxo-note-flow')
        p.append(h('span', undefined, t('uiux.overview.structure.flowNote', { name: w.name })))
        p.append(btn(t('uiux.overview.structure.flowOff'), () => { flowId = null; refreshStructure() }, 'uxo-link'))
        note.append(p)
        const missing = arr(w.screens).filter((id) => !nodeById.has(id)).length
        if (missing > 0) note.append(h('p', 'uxo-muted', t('uiux.overview.structure.flowMissing', { n: missing })))
        if (arr(w.screens).length === 0) note.append(h('p', 'uxo-muted', t('uiux.overview.flows.noScreens')))
      }
    }

    function drawDetail(): void {
      detail.replaceChildren()
      const it = selected ? treeById.get(selected) : undefined
      if (!selected || !it) {
        detail.append(h('p', 'uxo-muted', t('uiux.overview.structure.pick')))
        return
      }
      nodeDetail(selected, detail, false)
      if (it.children.length) {
        const open = expanded.has(selected)
        const id = selected
        const b = btn(t(open ? 'uiux.overview.structure.collapse' : 'uiux.overview.structure.expandN', { n: it.children.length }), () => {
          if (open) expanded.delete(id)
          else expanded.add(id)
          pending = 'd:toggle'
          refreshStructure(false)
        })
        els.set('d:toggle', b)
        detail.append(b)
      }
    }

    function buildCanvas(): boolean {
      left.replaceChildren()
      viewport = h('div', 'uxo-viewport')
      viewport.tabIndex = 0
      viewport.setAttribute('role', 'group')
      viewport.setAttribute('aria-label', t('uiux.overview.structure.canvasLabel'))
      svg = sv('svg', { width: '100%', height: '100%', focusable: 'false' }, 'uxo-svg') as SVGSVGElement
      world = sv('g')
      svg.append(world)
      viewport.append(svg)
      left.append(viewport)

      // pan by dragging, zoom with the wheel, keys on the viewport
      let drag: { x: number; y: number; tx: number; ty: number; id: number; moved: boolean } | null = null
      svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return
        drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, id: e.pointerId, moved: false }
      })
      svg.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return
        const dx = e.clientX - drag.x
        const dy = e.clientY - drag.y
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
          drag.moved = true
          try { svg?.setPointerCapture(e.pointerId) } catch { /* not capturable: dragging still works while over the canvas */ }
          viewport?.classList.add('uxo-dragging')
        }
        if (drag.moved) { view = { ...view, tx: drag.tx + dx, ty: drag.ty + dy, fitted: true }; apply() }
      })
      const end = (e: PointerEvent): void => {
        if (!drag || e.pointerId !== drag.id) return
        if (drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false }, 0) }
        drag = null
        viewport?.classList.remove('uxo-dragging')
      }
      svg.addEventListener('pointerup', end)
      svg.addEventListener('pointercancel', end)
      svg.addEventListener('wheel', (e) => {
        e.preventDefault()
        const r = svg!.getBoundingClientRect()
        zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 1 / 1.1)
      }, { passive: false })
      viewport.addEventListener('keydown', (e) => {
        const step = 48
        switch (e.key) {
          case 'ArrowLeft': view = { ...view, tx: view.tx + step }; break
          case 'ArrowRight': view = { ...view, tx: view.tx - step }; break
          case 'ArrowUp': view = { ...view, ty: view.ty + step }; break
          case 'ArrowDown': view = { ...view, ty: view.ty - step }; break
          case '+': case '=': zoomCenter(1.2); e.preventDefault(); return
          case '-': case '_': zoomCenter(1 / 1.2); e.preventDefault(); return
          case '0': fit(); e.preventDefault(); return
          default: return
        }
        e.preventDefault()
        apply()
      })
      try {
        drawDiagram()
        if (layout && tooManyForDiagram(layout)) return false
      } catch {
        return false
      }
      apply()
      return true
    }

    function refreshStructure(rebuildCanvas = true): void {
      if (closed || tab !== 'structure') return
      flowSel.value = flowId ?? ''
      if (!listMode) {
        let ok = false
        try {
          if (rebuildCanvas || !world) ok = buildCanvas()
          else { drawDiagram(); ok = !(layout && tooManyForDiagram(layout)) }
        } catch { ok = false }
        if (ok) {
          detail.hidden = false
          drawDetail()
          if (!view.fitted) requestAnimationFrame(fit)
        } else {
          fallback = layout && tooManyForDiagram(layout) ? 'tooMany' : 'fallback'
          layout = null
          world = null
          svg = null
          listMode = true
        }
      }
      if (listMode) drawList()
      toggleBtn.textContent = t(listMode ? 'uiux.overview.structure.asDiagram' : 'uiux.overview.structure.asList')
      for (const b of diagramOnly) b.disabled = listMode
      drawNotes(fallback)
      if (pending) {
        const el = els.get(pending)
        pending = null
        if (el instanceof HTMLElement || el instanceof SVGElement) el.focus()
      }
    }

    let fallback: 'none' | 'fallback' | 'tooMany' = 'none'
    refreshStructureRef = () => refreshStructure()
    const diagramOnly: HTMLButtonElement[] = []
    const toggleBtn = btn('', () => {
      listMode = !listMode
      fallback = 'none'
      refreshStructure()
    })
    const zoomOutB = btn(t('uiux.overview.structure.zoomOut'), () => zoomCenter(1 / 1.2))
    const zoomInB = btn(t('uiux.overview.structure.zoomIn'), () => zoomCenter(1.2))
    const fitB = btn(t('uiux.overview.structure.fit'), fit)
    const allB = btn(t('uiux.overview.structure.expandAll'), () => { for (const id of expandableIds(arch)) expanded.add(id); refreshStructure(false) })
    const noneB = btn(t('uiux.overview.structure.collapseAll'), () => { expanded.clear(); refreshStructure(false) })
    diagramOnly.push(zoomOutB, zoomInB, fitB, allB, noneB)
    const hasKids = expandableIds(arch).length > 0
    bar.append(zoomOutB, zoomInB, fitB, zoomLabel)
    if (hasKids) bar.append(allB, noneB)
    if (o.workflows.length) {
      const lab = h('label', 'uxo-flowsel')
      lab.append(h('span', undefined, t('uiux.overview.structure.flowSelect')), flowSel)
      bar.append(lab)
    }
    bar.append(toggleBtn)

    if (arch.nodes.length === 0) listMode = true // nothing to draw: the list says so in words
    box.append(bar, note, mainArea)
    box.append(stackBlock())
    refreshStructure()
    return box
  }

  function stackBlock(): HTMLElement {
    const s = section(t('uiux.overview.sec.stack'))
    s.append(claimList(o.stack, false))
    return s
  }

  // ----- tab 3: flows -----

  function buildFlows(): HTMLElement {
    const box = h('div', 'uxo-tabbody')
    box.append(h('p', 'uxo-hint', t('uiux.overview.flows.pick')))
    if (o.workflows.length === 0) {
      box.append(claimBlock({ value: t('uiux.overview.flows.none'), source: 'unknown' }))
      return box
    }
    for (const w of o.workflows) box.append(flowCard(w))
    return box
  }

  function flowCard(w: Workflow): HTMLElement {
    const on = flowId === w.id
    const c = h('section', `uxo-flow${on ? ' uxo-flow-on' : ''}${isUncertain(w.source) ? ' uxo-dashed' : ''}`)
    const head = h('div', 'uxo-flow-head')
    head.append(h('h3', 'uxo-flow-name', w.name), provBadge(w.source))
    c.append(head)
    if (w.steps.length === 0) c.append(h('p', 'uxo-muted', t('uiux.overview.empty')))
    else {
      const ol = h('ol', 'uxo-steps')
      for (const s of w.steps) ol.append(h('li', undefined, s))
      c.append(ol)
    }
    c.append(h('h4', 'uxo-h4', t('uiux.overview.flows.screens')))
    const screens = arr(w.screens)
    if (screens.length === 0) c.append(h('p', 'uxo-muted', t('uiux.overview.flows.noScreens')))
    else {
      const ul = h('ul', 'uxo-chips')
      for (const id of screens) {
        const n = nodeById.get(id)
        ul.append(h('li', n ? 'uxo-chip' : 'uxo-chip uxo-chip-missing', n ? n.label : t('uiux.overview.flows.unknownScreen', { id })))
      }
      c.append(ul)
    }
    const row = h('div', 'uxo-flow-actions')
    const pick = btn(t(on ? 'uiux.overview.flows.selected' : 'uiux.overview.flows.select'), () => {
      flowId = on ? null : w.id
      show('flows')
    })
    pick.setAttribute('aria-pressed', on ? 'true' : 'false')
    row.append(pick, btn(t('uiux.overview.flows.showInStructure'), () => { flowId = w.id; show('structure') }))
    c.append(row)
    return c
  }

  // ----- tab 4: design requirements -----

  function buildDesign(): HTMLElement {
    const box = h('div', 'uxo-tabbody')
    const imp = designImplications(o, t)
    box.append(h('p', 'uxo-hint uxo-suggest-note', t('uiux.overview.design.intro')))
    const a = section(t('uiux.overview.design.fromGoals'))
    if (o.goals.length === 0) a.append(claimBlock({ value: '', source: 'unknown' }))
    else {
      const ul = h('ul', 'uxo-hints')
      for (const hint of imp.fromGoals) {
        const li = h('li', 'uxo-hint-card')
        const goal = h('div', 'uxo-hint-goal')
        goal.append(h('span', 'uxo-text', hint.basis), provBadge(hint.basisSource))
        const sug = h('div', 'uxo-hint-sug')
        sug.append(h('span', 'uxo-tag', t('uiux.overview.design.suggestion')), h('span', 'uxo-text', hint.text))
        li.append(goal, sug)
        ul.append(li)
      }
      for (const g of imp.unmatched) {
        const li = h('li', 'uxo-hint-card')
        const goal = h('div', 'uxo-hint-goal')
        goal.append(h('span', 'uxo-text', claimText(g, t)), provBadge(g.source))
        li.append(goal, h('p', 'uxo-muted', t('uiux.overview.design.none')))
        ul.append(li)
      }
      a.append(ul)
    }
    const b = section(t('uiux.overview.design.state'), t('uiux.overview.imply.state'))
    b.append(claimList(imp.state, false))
    const c = section(t('uiux.overview.sec.constraints'), t('uiux.overview.imply.constraint'))
    c.append(claimList(imp.constraints, false))
    box.append(a, b, c)
    return box
  }

  // ----- tabs -----

  function show(next: Tab): void {
    tab = next
    for (const [id, b] of tabButtons) {
      const on = id === next
      b.setAttribute('aria-selected', on ? 'true' : 'false')
      b.tabIndex = on ? 0 : -1
    }
    body.setAttribute('aria-labelledby', `uxo-tab-${next}`)
    status.textContent = ''
    let content: HTMLElement
    try {
      content = next === 'purpose' ? buildPurpose() : next === 'structure' ? buildStructure() : next === 'flows' ? buildFlows() : buildDesign()
    } catch {
      content = h('p', 'uxo-note-warn', t('uiux.overview.error.tab'))
      if (next === 'structure') {
        lastLayout = null
        try { content = h('div', 'uxo-tabbody'); content.append(h('p', 'uxo-note-warn', t('uiux.overview.structure.fallback')), structureListOnly()) } catch { /* keep the plain error text */ }
      }
    }
    body.replaceChildren(content)
    body.scrollTop = 0
  }

  /** Last resort when the structure tab itself failed to build: the plain nested list. */
  function structureListOnly(): HTMLElement {
    const ul = h('ul', 'uxo-tree')
    const render = (items: TreeItem[], into: HTMLElement): void => {
      for (const it of items) {
        const li = h('li', 'uxo-tree-item')
        li.append(h('span', 'uxo-text', `${it.node.label} · ${typeLabel(it.node.type, t)} · ${prov(it.node.source)}`))
        if (it.children.length) { const sub = h('ul', 'uxo-tree'); render(it.children, sub); li.append(sub) }
        into.append(li)
      }
    }
    render(tree, ul)
    return ul
  }

  // ----- PNG export (canvas from the layout data) -----

  function exportPng(): void {
    try {
      const url = tab === 'structure' && lastLayout ? diagramPng(lastLayout) : textPng(linesFor(tab))
      opts.onExport('png', url)
    } catch {
      status.textContent = t('uiux.overview.export.pngFailed')
    }
  }

  /**
   * The lines of a text tab for the PNG: that tab's section of the Markdown export (the purpose tab also takes the
   * unknowns and the questions), so the picture says what the .md file says.
   */
  function linesFor(which: Tab): Line[] {
    const tabTitle = t(`uiux.overview.tab.${which}`)
    const wanted = which === 'purpose' ? [tabTitle, t('uiux.overview.unknowns.title'), t('uiux.overview.questions.title')] : [tabTitle]
    const out: Line[] = [{ kind: 'h1', text: `${t('uiux.overview.title')} · ${tabTitle}`, indent: 0 }]
    let inside = false
    for (const raw of overviewToMarkdown(o, t).split('\n')) {
      const head = /^(#+) (.*)$/.exec(raw)
      if (head && head[1].length <= 2) {
        inside = head[1].length === 2 && wanted.includes(head[2])
        if (inside && head[2] !== tabTitle) out.push({ kind: 'h2', text: mdPlain(head[2]), indent: 0 })
        continue
      }
      if (!inside || !raw.trim()) continue
      const body = raw.trimStart()
      const indent = Math.floor((raw.length - body.length) / 2)
      if (head) out.push({ kind: 'h2', text: mdPlain(head[2]), indent: 0 })
      else if (body.startsWith('- ')) out.push({ kind: 'li', text: mdPlain(body.slice(2)), indent })
      else if (/^\d+\. /.test(body)) out.push({ kind: 'li', text: mdPlain(body), indent })
      else out.push({ kind: 'p', text: mdPlain(body), indent })
    }
    return out
  }

  const FONT = (px: number, bold = false): string => `${bold ? '600 ' : ''}${px}px system-ui, "Malgun Gothic", sans-serif`

  function newCanvas(w: number, hgt: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; scale: number } {
    const scale = Math.min(2, 4096 / Math.max(w, hgt, 1))
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.round(w * scale))
    cv.height = Math.max(1, Math.round(hgt * scale))
    const ctx = cv.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.scale(scale, scale)
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, w, hgt)
    return { cv, ctx, scale }
  }

  const strokeFor = (p: Provenance): string => (p === 'estimated' ? C.guess : p === 'unknown' ? C.muted : C.ok)

  function diagramPng(L: Layout): string {
    const foot = 34
    const { cv, ctx } = newCanvas(Math.max(L.width, 360), L.height + foot)
    const hits = flowHits(L)
    ctx.lineJoin = 'round'
    // tethers
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.setLineDash([1, 3])
    for (const th of L.tethers) { ctx.beginPath(); th.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke() }
    // edges
    for (const e of L.edges) {
      const dash = DASH[e.source]
      ctx.strokeStyle = C.line; ctx.fillStyle = C.line; ctx.lineWidth = 1.5
      ctx.setLineDash(dash ? dash.split(' ').map(Number) : [])
      ctx.beginPath(); e.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke()
      ctx.setLineDash([])
      const last = e.points[e.points.length - 1]
      const prev = e.points[e.points.length - 2] ?? last
      const pts = arrowHead(prev, last).split(' ').map((s) => s.split(',').map(Number))
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill()
      const label = isUncertain(e.source) || L.edges.length <= 14
        ? (isUncertain(e.source) ? t('uiux.overview.edge.label', { relation: e.relation, source: prov(e.source) }) : e.relation)
        : ''
      if (label) {
        ctx.font = FONT(11); ctx.textAlign = 'center'
        ctx.lineWidth = 3; ctx.strokeStyle = C.bg; ctx.strokeText(label, e.labelAt.x, e.labelAt.y - 3)
        ctx.fillStyle = C.muted; ctx.fillText(label, e.labelAt.x, e.labelAt.y - 3)
      }
    }
    // nodes
    ctx.textAlign = 'left'
    for (const n of L.nodes) {
      const hit = hits.direct.has(n.id) || hits.inside.has(n.id)
      ctx.globalAlpha = flowId && !hit ? 0.5 : 1
      ctx.fillStyle = C.node
      roundRect(ctx, n.x, n.y, n.w, n.h, 8); ctx.fill()
      ctx.strokeStyle = hit ? C.focus : strokeFor(n.source); ctx.lineWidth = hit ? 3 : 1.5
      const dash = DASH[n.source]
      ctx.setLineDash(dash ? dash.split(' ').map(Number) : [])
      roundRect(ctx, n.x, n.y, n.w, n.h, 8); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = C.text; ctx.font = FONT(FONT_PX)
      n.lines.forEach((ln, i) => ctx.fillText(ln, n.x + 14, n.y + 23 + i * 16))
      ctx.fillStyle = C.muted; ctx.font = FONT(11)
      ctx.fillText(fitText(ctx, `${typeLabel(n.type, t)} · ${prov(n.source)}`, n.w - 28), n.x + 14, n.y + n.h - 11)
      if (hit) { ctx.fillStyle = C.focus; ctx.fillText(hits.direct.has(n.id) ? t('uiux.overview.structure.flowTag') : t('uiux.overview.structure.flowInside'), n.x, n.y - 5) }
      ctx.globalAlpha = 1
    }
    ctx.fillStyle = C.muted; ctx.font = FONT(11); ctx.fillText(t('uiux.overview.legend'), 12, L.height + 20)
    return cv.toDataURL('image/png')
  }

  function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
    if (ctx.measureText(text).width <= max) return text
    let s = text
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1)
    return s + '…'
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number): void {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + hh, r)
    ctx.arcTo(x + w, y + hh, x, y + hh, r)
    ctx.arcTo(x, y + hh, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function textPng(lines: Line[]): string {
    const W = 1000
    const measure = document.createElement('canvas').getContext('2d')
    if (!measure) throw new Error('no canvas')
    const wrap = (text: string, font: string, max: number): string[] => {
      measure.font = font
      const out: string[] = []
      let line = ''
      for (const ch of Array.from(text)) {
        if (measure.measureText(line + ch).width > max && line !== '') { out.push(line); line = ch === ' ' ? '' : ch } else line += ch
      }
      out.push(line)
      return out
    }
    interface Row { text: string; font: string; color: string; x: number; y: number }
    const rows: Row[] = []
    let y = 28
    const MAX_H = 4000
    for (const ln of lines) {
      const px = ln.kind === 'h1' ? 20 : ln.kind === 'h2' ? 15 : 13
      const font = FONT(px, ln.kind !== 'p' && ln.kind !== 'li')
      const x = 24 + ln.indent * 22 + (ln.kind === 'li' ? 14 : 0)
      if (ln.kind === 'h2') y += 8
      const parts = wrap(ln.text, font, W - x - 24)
      for (let i = 0; i < parts.length; i++) {
        if (y > MAX_H) break
        if (ln.kind === 'li' && i === 0) rows.push({ text: '•', font, color: C.muted, x: x - 14, y })
        rows.push({ text: parts[i], font, color: ln.kind === 'p' ? C.muted : C.text, x, y })
        y += px + 6
      }
      if (y > MAX_H) { rows.push({ text: '…', font: FONT(13), color: C.muted, x: 24, y }); y += 20; break }
    }
    const { cv, ctx } = newCanvas(W, y + 16)
    ctx.textBaseline = 'alphabetic'
    for (const r of rows) { ctx.font = r.font; ctx.fillStyle = r.color; ctx.fillText(r.text, r.x, r.y) }
    return cv.toDataURL('image/png')
  }

  // ----- open / close / keys -----

  function focusables(): HTMLElement[] {
    const q = 'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    return Array.from(root.querySelectorAll<HTMLElement>(q)).filter((el) => el.getClientRects().length > 0)
  }

  function onKey(e: KeyboardEvent): void {
    if (closed) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      close()
      return
    }
    if (e.key === 'Tab') {
      const f = focusables()
      if (f.length === 0) { e.preventDefault(); return }
      const first = f[0]
      const last = f[f.length - 1]
      const active = document.activeElement
      if (!root.contains(active)) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
  }

  function close(): void {
    if (closed) return
    closed = true
    window.removeEventListener('keydown', onKey, true)
    root.remove()
    if (current === handle) current = null
    if (returnTo && returnTo.isConnected) returnTo.focus()
  }

  root.addEventListener('mousedown', (e) => { if (e.target === root) close() })
  const handle = { close }
  current = handle
  window.addEventListener('keydown', onKey, true)
  document.body.append(root)
  show('purpose')
  tabButtons.get('purpose')?.focus()
  return handle
}
