// Layout of the program-structure diagram (spec §6): pure and deterministic, no DOM.
// Input is the validated Architecture; output is boxes and edge polylines in plain numbers, which the view turns
// into SVG (createElementNS) and into a PNG (canvas) from the very same data.
//
// Layers run left to right. Edges decide the layer (longest path, back edges of a cycle are ignored for that);
// nodes without any edge sit in the column of their type: screen → module → store → external.
// Only nodes without a parent are shown first; children appear when their parent id is in `expanded`.
// An edge to a hidden child is drawn to its nearest visible ancestor.
import { resolveParents } from './overviewText'
import type { ArchEdge, ArchNode, ArchNodeType, Architecture, Provenance } from './types'

export interface LayoutNode {
  id: string
  label: string
  /** The label broken into at most two lines that fit the box. */
  lines: string[]
  type: ArchNodeType
  source: Provenance
  x: number
  y: number
  w: number
  h: number
  hasChildren: boolean
  expanded: boolean
  /** Visible parent (an expanded node), when this is a child. */
  parent?: string
  /** 0 = top level. */
  depth: number
  /** Number of direct children in the data, shown or not. */
  childCount: number
}

export interface Point { x: number; y: number }

export interface LayoutEdge {
  from: string
  to: string
  relation: string
  source: Provenance
  points: Point[]
  /** Where a text label fits: the middle of the longest segment. */
  labelAt: Point
  /** True when the edge was moved from a hidden child to its visible ancestor. */
  lifted: boolean
}

/** Dotted link from an expanded node to one of its shown children (not a data edge). */
export interface LayoutTether { from: string; to: string; points: Point[] }

export interface Layout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  tethers: LayoutTether[]
  width: number
  height: number
  /** True when top-level nodes were left out because there are more than maxTop. */
  truncated: boolean
  /** Ids of the top-level nodes that were left out. */
  omitted: string[]
}

export interface LayoutOptions {
  /** Ids of nodes whose children are shown. */
  expanded?: string[]
  /** Top-level nodes shown at most (default 12). */
  maxTop?: number
}

export const DEFAULT_MAX_TOP = 12
/** Above this many visible nodes the view prefers the list. */
export const MAX_DIAGRAM_NODES = 80

// ---------- text size estimate (no font metrics available here) ----------

export const FONT_PX = 13
const MIN_W = 140
const MAX_W = 232
const PAD_X = 14
const LINE_H = 16
const MARGIN = 16
const NODE_GAP = 22
const LAYER_GAP_BASE = 36
const SLOT = 10

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff)
  )
}

/** Rough width in px of a text at `font` px: wide (CJK) glyphs a full em, Latin about 0.56 em, capitals wider. */
export function estimateWidth(text: string, font: number = FONT_PX): number {
  let em = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isWide(cp)) em += 1
    else if (ch === ' ') em += 0.3
    else if (/[A-Z0-9MW@%]/.test(ch)) em += 0.66
    else if (/[il.,;:'|!]/.test(ch)) em += 0.3
    else em += 0.56
  }
  return Math.ceil(em * font)
}

function ellipsize(text: string, maxW: number, font: number): string {
  if (estimateWidth(text, font) <= maxW) return text
  const chars = Array.from(text)
  while (chars.length > 1 && estimateWidth(chars.join('') + '…', font) > maxW) chars.pop()
  return chars.join('').trimEnd() + '…'
}

/** Greedy wrap: break at the last space that fits, else inside the word; the last line gets an ellipsis. */
export function wrapLabel(label: string, maxW: number, maxLines = 2, font: number = FONT_PX): string[] {
  const text = label.replace(/\s+/g, ' ').trim()
  if (!text) return ['']
  const chars = Array.from(text)
  const out: string[] = []
  let line = ''
  let lastSpace = -1
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (line === '' && ch === ' ') continue
    const next = line + ch
    if (estimateWidth(next, font) > maxW && line !== '') {
      if (lastSpace > 0 && ch !== ' ') {
        out.push(line.slice(0, lastSpace).trimEnd())
        line = line.slice(lastSpace + 1) + ch
      } else {
        out.push(line.trimEnd())
        line = ch === ' ' ? '' : ch
      }
      lastSpace = -1
      if (out.length === maxLines) {
        // The rest does not fit: fold it into the last line with an ellipsis.
        const rest = (out[maxLines - 1] + ' ' + line + chars.slice(i + 1).join('')).trim()
        out[maxLines - 1] = ellipsize(rest, maxW, font)
        return out
      }
    } else {
      line = next
      if (ch === ' ') lastSpace = line.length - 1
    }
  }
  if (line.trim() !== '') out.push(line.trimEnd())
  if (out.length > maxLines) out.length = maxLines
  return out
}

// ---------- helpers ----------

const TYPE_RANK: Record<ArchNodeType, number> = { screen: 0, module: 1, other: 1, store: 2, external: 3 }
/** Weakest provenance wins when edges are merged. */
const WEAKNESS: Record<Provenance, number> = { unknown: 0, estimated: 1, user: 2, verified: 3 }

interface Item {
  node: ArchNode
  /** Position in DFS order, the stable tie-break everywhere. */
  order: number
  depth: number
  parent?: string
}

interface Link { from: string; to: string; relation: string; source: Provenance; lifted: boolean }

function sizeOf(label: string): { lines: string[]; w: number; h: number } {
  const lines = wrapLabel(label, MAX_W - 2 * PAD_X, 2)
  const textW = Math.max(...lines.map((l) => estimateWidth(l)))
  const w = Math.min(MAX_W, Math.max(MIN_W, textW + 2 * PAD_X))
  // top pad 10 + label lines + gap 6 + sub line 14 + bottom pad 10
  const h = 10 + lines.length * LINE_H + 6 + 14 + 10
  return { lines, w, h }
}

// ---------- layout ----------

export function layoutArchitecture(arch: Architecture, opts: LayoutOptions = {}): Layout {
  const maxTop = Math.max(1, Math.floor(opts.maxTop ?? DEFAULT_MAX_TOP))
  const expandedSet = new Set(opts.expanded ?? [])
  const { byId, kids, tops } = resolveParents(arch.nodes)

  // owner[id] = the top-level node that contains id (itself when top level): to count edges per top node.
  const ownerTop = new Map<string, string>()
  const mark = (n: ArchNode, top: string): void => {
    ownerTop.set(n.id, top)
    for (const c of kids.get(n.id) ?? []) mark(c, top)
  }
  for (const t of tops) mark(t, t.id)

  // Which top-level nodes stay: the most connected ones, kept in their original order.
  let shownTops = tops
  let truncated = false
  let omitted: string[] = []
  if (tops.length > maxTop) {
    truncated = true
    const degree = new Map<string, number>()
    for (const e of arch.edges) {
      const a = ownerTop.get(e.from)
      const b = ownerTop.get(e.to)
      if (a === undefined || b === undefined || a === b) continue
      degree.set(a, (degree.get(a) ?? 0) + 1)
      degree.set(b, (degree.get(b) ?? 0) + 1)
    }
    const ranked = tops
      .map((n, i) => ({ n, i, d: degree.get(n.id) ?? 0 }))
      .sort((p, q) => q.d - p.d || p.i - q.i)
      .slice(0, maxTop)
      .map((r) => r.n.id)
    const keep = new Set(ranked)
    shownTops = tops.filter((n) => keep.has(n.id))
    omitted = tops.filter((n) => !keep.has(n.id)).map((n) => n.id)
  }

  // Visible items in DFS order.
  const items: Item[] = []
  const visit = (n: ArchNode, depth: number, parent?: string): void => {
    items.push({ node: n, order: items.length, depth, parent })
    if (expandedSet.has(n.id)) for (const c of kids.get(n.id) ?? []) visit(c, depth + 1, n.id)
  }
  for (const t of shownTops) visit(t, 0)
  const visibleIds = new Set(items.map((i) => i.node.id))

  // Edges between visible nodes; an end that is hidden moves to its nearest visible ancestor.
  const nearestVisible = (id: string): string | undefined => {
    let cur: string | undefined = id
    const seen = new Set<string>()
    while (cur !== undefined && !seen.has(cur)) {
      if (visibleIds.has(cur)) return cur
      seen.add(cur)
      const p: string | undefined = byId.get(cur)?.parent
      cur = p !== undefined && byId.has(p) ? p : undefined
    }
    return undefined
  }
  const linkMap = new Map<string, Link>()
  const links: Link[] = []
  for (const e of arch.edges as ArchEdge[]) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    const a = nearestVisible(e.from)
    const b = nearestVisible(e.to)
    if (a === undefined || b === undefined || a === b) continue
    const lifted = a !== e.from || b !== e.to
    const key = `${a}\u0000${b}\u0000${e.relation}`
    const have = linkMap.get(key)
    if (have) {
      if (WEAKNESS[e.source] < WEAKNESS[have.source]) have.source = e.source
      have.lifted = have.lifted && lifted
      continue
    }
    const link: Link = { from: a, to: b, relation: e.relation, source: e.source, lifted }
    linkMap.set(key, link)
    links.push(link)
  }

  // ----- layers -----
  const n = items.length
  const idx = new Map(items.map((it, i) => [it.node.id, i]))
  const outs: number[][] = items.map(() => [])
  const connected = new Array<boolean>(n).fill(false)
  for (const l of links) {
    const a = idx.get(l.from)!
    const b = idx.get(l.to)!
    outs[a].push(b)
    connected[a] = true
    connected[b] = true
  }
  // Back edges by DFS (colour marking), then longest path over the rest.
  const state = new Array<number>(n).fill(0)
  const back = new Set<string>()
  const topo: number[] = []
  for (let s = 0; s < n; s++) {
    if (state[s] !== 0) continue
    const stack: { v: number; i: number }[] = [{ v: s, i: 0 }]
    state[s] = 1
    while (stack.length) {
      const top = stack[stack.length - 1]
      if (top.i < outs[top.v].length) {
        const w = outs[top.v][top.i++]
        if (state[w] === 0) {
          state[w] = 1
          stack.push({ v: w, i: 0 })
        } else if (state[w] === 1) back.add(`${top.v}>${w}`)
      } else {
        state[top.v] = 2
        topo.push(top.v)
        stack.pop()
      }
    }
  }
  const layer = new Array<number>(n).fill(0)
  for (let k = topo.length - 1; k >= 0; k--) {
    const v = topo[k]
    for (const w of outs[v]) {
      if (back.has(`${v}>${w}`)) continue
      if (layer[w] < layer[v] + 1) layer[w] = layer[v] + 1
    }
  }
  // Nodes without any edge: the column of their type; a child without edges stays beside its parent.
  for (let i = 0; i < n; i++) {
    if (connected[i]) continue
    const it = items[i]
    const p = it.parent !== undefined ? idx.get(it.parent) : undefined
    layer[i] = p !== undefined ? layer[p] : TYPE_RANK[it.node.type]
  }
  // Compact: only columns that hold a node.
  const used = Array.from(new Set(layer)).sort((a, b) => a - b)
  const compact = new Map(used.map((v, i) => [v, i]))
  for (let i = 0; i < n; i++) layer[i] = compact.get(layer[i])!
  const layerCount = used.length

  // ----- order within layers: DFS order, then barycenter sweeps -----
  const cols: number[][] = Array.from({ length: layerCount }, () => [])
  for (let i = 0; i < n; i++) cols[layer[i]].push(i)
  const nbrs: number[][] = items.map(() => [])
  for (const l of links) {
    const a = idx.get(l.from)!
    const b = idx.get(l.to)!
    nbrs[a].push(b)
    nbrs[b].push(a)
  }
  const pos = new Array<number>(n).fill(0)
  const refresh = (): void => { for (const c of cols) c.forEach((v, i) => { pos[v] = i }) }
  refresh()
  const sweep = (c: number, toward: number): void => {
    const keyOf = (v: number): number => {
      const ns = nbrs[v].filter((w) => layer[w] === toward)
      return ns.length ? ns.reduce((s, w) => s + pos[w], 0) / ns.length : pos[v]
    }
    const keyed = cols[c].map((v, i) => ({ v, k: keyOf(v), i }))
    keyed.sort((p, q) => p.k - q.k || p.i - q.i)
    cols[c] = keyed.map((x) => x.v)
    refresh()
  }
  for (let round = 0; round < 4; round++) {
    for (let c = 1; c < layerCount; c++) sweep(c, c - 1)
    for (let c = layerCount - 2; c >= 0; c--) sweep(c, c + 1)
  }

  // ----- sizes -----
  const sizes = items.map((it) => sizeOf(it.node.label))
  const layerW = cols.map((col) => col.reduce((m, v) => Math.max(m, sizes[v].w), 0))

  // ----- edge routing plan: gap slots and top lanes -----
  // gap g = space right of layer g (g = -1: left margin). Vertical runs get their own slot in a gap.
  interface Plan { link: Link; a: number; b: number; kind: 'fwd' | 'back' | 'same'; gStart: number; gEnd: number; slotStart: number; slotEnd: number; lane: number }
  const slotCount = new Map<number, number>()
  const takeSlot = (g: number): number => {
    const k = slotCount.get(g) ?? 0
    slotCount.set(g, k + 1)
    return k
  }
  const plans: Plan[] = links.map((link) => {
    const a = idx.get(link.from)!
    const b = idx.get(link.to)!
    const la = layer[a]
    const lb = layer[b]
    let kind: Plan['kind']
    let gStart: number
    let gEnd: number
    if (la === lb) { kind = 'same'; gStart = la; gEnd = la }
    else if (lb > la) { kind = 'fwd'; gStart = la; gEnd = lb - 1 }
    else { kind = 'back'; gStart = la - 1; gEnd = lb }
    const slotStart = takeSlot(gStart)
    const slotEnd = kind === 'fwd' && gEnd === gStart ? slotStart : kind === 'same' ? slotStart : takeSlot(gEnd)
    return { link, a, b, kind, gStart, gEnd, slotStart, slotEnd, lane: -1 }
  })
  let laneCount = 0
  for (const p of plans) {
    const needsLane = p.kind === 'back' || (p.kind === 'fwd' && layer[p.b] - layer[p.a] > 1)
    if (needsLane) p.lane = laneCount++
  }

  // ----- x positions -----
  const gapWidth = (g: number): number => {
    const slots = slotCount.get(g) ?? 0
    if (g === -1) return slots === 0 ? 0 : 12 + slots * SLOT
    if (g === layerCount - 1) return slots === 0 ? 0 : 12 + slots * SLOT
    return Math.max(LAYER_GAP_BASE, 16 + slots * SLOT)
  }
  const layerX: number[] = []
  let cursor = MARGIN + gapWidth(-1)
  for (let c = 0; c < layerCount; c++) {
    layerX.push(cursor)
    cursor += layerW[c] + gapWidth(c)
  }
  const gapX = (g: number, slot: number): number => {
    if (g === -1) return MARGIN + 6 + slot * SLOT
    return layerX[g] + layerW[g] + 8 + slot * SLOT
  }

  // ----- y positions: stack each column, centre it on the tallest -----
  const laneTop = 8
  const topPad = MARGIN + (laneCount > 0 ? laneCount * 8 + 8 : 0)
  const colH = cols.map((col) => col.reduce((s, v, i) => s + sizes[v].h + (i > 0 ? NODE_GAP : 0), 0))
  const maxH = colH.reduce((m, h) => Math.max(m, h), 0)
  const boxes: { x: number; y: number }[] = new Array(n)
  cols.forEach((col, c) => {
    let y = topPad + (maxH - colH[c]) / 2
    for (const v of col) {
      boxes[v] = { x: layerX[c] + (layerW[c] - sizes[v].w) / 2, y }
      y += sizes[v].h + NODE_GAP
    }
  })
  const round1 = (v: number): number => Math.round(v * 10) / 10
  const width = Math.ceil(cursor + MARGIN)
  const height = Math.ceil(topPad + maxH + MARGIN)

  // ----- ports: spread edge ends along a side -----
  const portCount = new Map<string, number>()
  const portSeen = new Map<string, number>()
  const portKey = (v: number, side: 'l' | 'r'): string => `${v}${side}`
  const sides = (p: Plan): { s: 'l' | 'r'; t: 'l' | 'r' } =>
    p.kind === 'fwd' ? { s: 'r', t: 'l' } : p.kind === 'back' ? { s: 'l', t: 'r' } : { s: 'r', t: 'r' }
  for (const p of plans) {
    const { s, t } = sides(p)
    portCount.set(portKey(p.a, s), (portCount.get(portKey(p.a, s)) ?? 0) + 1)
    portCount.set(portKey(p.b, t), (portCount.get(portKey(p.b, t)) ?? 0) + 1)
  }
  const portY = (v: number, side: 'l' | 'r'): number => {
    const k = portKey(v, side)
    const total = portCount.get(k) ?? 1
    const i = portSeen.get(k) ?? 0
    portSeen.set(k, i + 1)
    const h = sizes[v].h
    // Keep ports off the corners: use the middle 60 % of the side.
    return boxes[v].y + h * (0.2 + (0.6 * (i + 1)) / (total + 1))
  }

  const edgesOut: LayoutEdge[] = plans.map((p) => {
    const { s, t } = sides(p)
    const A = boxes[p.a]
    const B = boxes[p.b]
    const ya = portY(p.a, s)
    const yb = portY(p.b, t)
    const xaRight = A.x + sizes[p.a].w
    const xbRight = B.x + sizes[p.b].w
    let pts: Point[]
    if (p.kind === 'fwd') {
      const g1 = gapX(p.gStart, p.slotStart)
      if (p.lane < 0) pts = [{ x: xaRight, y: ya }, { x: g1, y: ya }, { x: g1, y: yb }, { x: B.x, y: yb }]
      else {
        const g2 = gapX(p.gEnd, p.slotEnd)
        const ly = laneTop + p.lane * 8
        pts = [{ x: xaRight, y: ya }, { x: g1, y: ya }, { x: g1, y: ly }, { x: g2, y: ly }, { x: g2, y: yb }, { x: B.x, y: yb }]
      }
    } else if (p.kind === 'back') {
      const g1 = gapX(p.gStart, p.slotStart)
      const g2 = gapX(p.gEnd, p.slotEnd)
      const ly = laneTop + p.lane * 8
      pts = [{ x: A.x, y: ya }, { x: g1, y: ya }, { x: g1, y: ly }, { x: g2, y: ly }, { x: g2, y: yb }, { x: xbRight, y: yb }]
    } else {
      const g = gapX(p.gStart, p.slotStart)
      pts = [{ x: xaRight, y: ya }, { x: g, y: ya }, { x: g, y: yb }, { x: xbRight, y: yb }]
    }
    pts = pts.map((q) => ({ x: round1(q.x), y: round1(q.y) }))
    // Label spot: the middle of the longest segment.
    let best = 0
    let at: Point = pts[0]
    for (let i = 0; i + 1 < pts.length; i++) {
      const len = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y)
      if (len > best) {
        best = len
        at = { x: round1((pts[i].x + pts[i + 1].x) / 2), y: round1((pts[i].y + pts[i + 1].y) / 2) }
      }
    }
    return { from: p.link.from, to: p.link.to, relation: p.link.relation, source: p.link.source, points: pts, labelAt: at, lifted: p.link.lifted }
  })

  // ----- nodes in original (DFS) order -----
  const nodesOut: LayoutNode[] = items.map((it, i) => {
    const childList = kids.get(it.node.id) ?? []
    return {
      id: it.node.id,
      label: it.node.label,
      lines: sizes[i].lines,
      type: it.node.type,
      source: it.node.source,
      x: round1(boxes[i].x),
      y: round1(boxes[i].y),
      w: sizes[i].w,
      h: sizes[i].h,
      hasChildren: childList.length > 0,
      expanded: childList.length > 0 && expandedSet.has(it.node.id),
      parent: it.parent,
      depth: it.depth,
      childCount: childList.length
    }
  })

  // Tethers parent → child (dotted, vertical-ish): from the parent's box edge to the child's box edge.
  const tethers: LayoutTether[] = []
  for (const it of items) {
    if (it.parent === undefined) continue
    const p = nodesOut[idx.get(it.parent)!]
    const c = nodesOut[idx.get(it.node.id)!]
    const pc = { x: p.x + p.w / 2, y: p.y + p.h / 2 }
    const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 }
    // Leave through the side that faces the child.
    const start: Point = cc.x >= p.x + p.w ? { x: p.x + p.w, y: pc.y } : cc.x + c.w <= p.x ? { x: p.x, y: pc.y } : cc.y > pc.y ? { x: pc.x, y: p.y + p.h } : { x: pc.x, y: p.y }
    const end: Point = start.x === p.x + p.w ? { x: c.x, y: cc.y } : start.x === p.x ? { x: c.x + c.w, y: cc.y } : cc.y > pc.y ? { x: cc.x, y: c.y } : { x: cc.x, y: c.y + c.h }
    tethers.push({ from: p.id, to: c.id, points: [start, end] })
  }

  return { nodes: nodesOut, edges: edgesOut, tethers, width, height, truncated, omitted }
}

/** Visible nodes (after the layout) → true when the view should offer the list instead. */
export function tooManyForDiagram(layout: Layout): boolean {
  return layout.nodes.length > MAX_DIAGRAM_NODES
}

/** Ids of every node that has children: handy for "expand all". */
export function expandableIds(arch: Architecture): string[] {
  const { kids } = resolveParents(arch.nodes)
  return Array.from(kids.keys())
}
