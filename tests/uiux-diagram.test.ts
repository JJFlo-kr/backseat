import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateWidth, expandableIds, layoutArchitecture, wrapLabel, type Layout } from '../src/shared/uiux/diagram.ts'
import { edge, node, overview } from './support/overview-fixtures.ts'
import type { Architecture } from '../src/shared/uiux/types.ts'

const overlaps = (l: Layout): string[] => {
  const bad: string[] = []
  for (let i = 0; i < l.nodes.length; i++) for (let j = i + 1; j < l.nodes.length; j++) {
    const a = l.nodes[i], b = l.nodes[j]
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad.push(`${a.id}/${b.id}`)
  }
  return bad
}
const inside = (l: Layout): boolean => l.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.x + n.w <= l.width && n.y + n.h <= l.height)

test('layout: default architecture has no overlaps, stays inside, and layers follow the edges', () => {
  const l = layoutArchitecture(overview().architecture)
  assert.deepEqual(l.nodes.map((n) => n.id), ['editor', 'main', 'store', 'mcp'], 'children hidden until expanded')
  assert.deepEqual(overlaps(l), [])
  assert.ok(inside(l))
  const x = (id: string) => l.nodes.find((n) => n.id === id)!.x
  assert.ok(x('editor') < x('main') && x('main') < x('store'))
  assert.equal(l.truncated, false)
})

test('every visible edge has visible ends and a polyline touching both boxes', () => {
  const l = layoutArchitecture(overview().architecture, { expanded: ['main'] })
  const ids = new Set(l.nodes.map((n) => n.id))
  assert.ok(l.edges.length >= 3)
  for (const e of l.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to))
    assert.ok(e.points.length >= 2)
    const a = l.nodes.find((n) => n.id === e.from)!, b = l.nodes.find((n) => n.id === e.to)!
    const on = (n: typeof a, p: { x: number; y: number }) => p.y >= n.y && p.y <= n.y + n.h && (Math.abs(p.x - n.x) < 0.2 || Math.abs(p.x - (n.x + n.w)) < 0.2)
    assert.ok(on(a, e.points[0]), `start of ${e.from}>${e.to}`)
    assert.ok(on(b, e.points[e.points.length - 1]), `end of ${e.from}>${e.to}`)
    for (const p of e.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= l.width && p.y <= l.height)
  }
})

test('children appear only when their parent is expanded', () => {
  const arch = overview().architecture
  const closed = layoutArchitecture(arch)
  assert.equal(closed.nodes.find((n) => n.id === 'main')!.hasChildren, true)
  assert.equal(closed.nodes.find((n) => n.id === 'main')!.expanded, false)
  assert.ok(closed.edges.every((e) => e.from !== 'tools' && e.to !== 'tools'))
  const open = layoutArchitecture(arch, { expanded: ['main'] })
  const tools = open.nodes.find((n) => n.id === 'tools')!
  assert.equal(tools.parent, 'main')
  assert.equal(tools.depth, 1)
  assert.equal(open.nodes.find((n) => n.id === 'main')!.expanded, true)
  assert.equal(open.tethers.length, 1)
  assert.deepEqual(overlaps(open), [])
  assert.ok(open.edges.some((e) => e.from === 'tools' && e.to === 'store'))
  assert.deepEqual(layoutArchitecture(arch, { expanded: ['editor'] }).nodes.map((n) => n.id), ['editor', 'main', 'store', 'mcp'], 'expanding a node without children changes nothing')
})

test('a hidden child edge is lifted to its parent', () => {
  const arch: Architecture = { nodes: [node('a'), node('b'), node('b1', 'module', { parent: 'b' })], edges: [edge('a', 'b1', { relation: 'calls', source: 'estimated' })] }
  const l = layoutArchitecture(arch)
  assert.equal(l.edges.length, 1)
  assert.deepEqual([l.edges[0].from, l.edges[0].to, l.edges[0].lifted, l.edges[0].source], ['a', 'b', true, 'estimated'])
})

test('stable output: same input, same layout', () => {
  const a = layoutArchitecture(overview().architecture, { expanded: ['main'] })
  const b = layoutArchitecture(structuredClone(overview().architecture), { expanded: ['main'] })
  assert.deepEqual(a, b)
})

test('truncated when more top-level nodes than maxTop; the most connected stay, children of dropped nodes vanish', () => {
  const nodes = Array.from({ length: 15 }, (_, i) => node(`n${i}`))
  const edges = [edge('n13', 'n14'), edge('n14', 'n12'), edge('n12', 'n13')]
  const arch: Architecture = { nodes: [...nodes, node('kid', 'module', { parent: 'n0' })], edges: [...edges, edge('kid', 'n13')] }
  const l = layoutArchitecture(arch, { maxTop: 5, expanded: ['n0'] })
  assert.equal(l.truncated, true)
  assert.equal(l.nodes.filter((n) => n.depth === 0).length, 5)
  assert.equal(l.omitted.length, 10)
  for (const id of ['n12', 'n13', 'n14']) assert.ok(l.nodes.some((n) => n.id === id), id)
  assert.deepEqual(overlaps(l), [])
  assert.equal(layoutArchitecture(arch).truncated, true, 'default maxTop is 12')
  assert.equal(layoutArchitecture({ nodes: nodes.slice(0, 12), edges: [] }).truncated, false)
})

test('cycles, self loops, duplicates, unknown ends and parent loops do not break the layout', () => {
  const arch: Architecture = {
    nodes: [node('a'), node('b', 'store'), node('c', 'external'), node('a', 'module', { label: 'dup' }), node('p', 'module', { parent: 'q' }), node('q', 'module', { parent: 'p' })],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('a', 'a'), edge('a', 'b'), edge('a', 'zzz'), edge('b', 'a', { relation: 'reads' })]
  }
  const l = layoutArchitecture(arch, { expanded: ['p', 'q'] })
  assert.equal(new Set(l.nodes.map((n) => n.id)).size, l.nodes.length)
  assert.deepEqual(overlaps(l), [])
  assert.ok(l.edges.every((e) => e.from !== e.to))
  assert.equal(l.edges.filter((e) => e.from === 'a' && e.to === 'b').length, 1)
  assert.ok(l.nodes.some((n) => n.id === 'p') && l.nodes.some((n) => n.id === 'q'))
})

test('edgeless nodes sit in the column of their type; empty architecture is fine', () => {
  const l = layoutArchitecture({ nodes: [node('e', 'external'), node('s', 'screen'), node('d', 'store'), node('m')], edges: [] })
  const x = (id: string) => l.nodes.find((n) => n.id === id)!.x
  assert.ok(x('s') < x('m') && x('m') < x('d') && x('d') < x('e'))
  const empty = layoutArchitecture({ nodes: [], edges: [] })
  assert.deepEqual([empty.nodes.length, empty.edges.length, empty.truncated], [0, 0, false])
})

test('boxes grow with the label and wrap to two lines at most', () => {
  const long = '아주 긴 이름의 모듈입니다 정말로 길어서 두 줄로도 모자랄 만큼 길게 이어지는 이름'
  const l = layoutArchitecture({ nodes: [node('s', 'module', { label: 'x' }), node('l', 'module', { label: long })], edges: [] })
  const s = l.nodes.find((n) => n.id === 's')!, big = l.nodes.find((n) => n.id === 'l')!
  assert.ok(big.w > s.w && big.h > s.h)
  assert.equal(big.lines.length, 2)
  assert.ok(big.lines[1].endsWith('…'))
  assert.equal(big.label, long, 'label itself is untouched')
  assert.ok(estimateWidth('가나다') > estimateWidth('abc'))
  assert.deepEqual(wrapLabel('', 100), [''])
  assert.deepEqual(expandableIds(overview().architecture), ['main'])
})
