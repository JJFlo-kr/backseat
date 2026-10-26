import { test } from 'node:test'
import assert from 'node:assert/strict'
import { designImplications, evidenceLine, mdText, overviewToMarkdown, provenanceLabel, structureTree } from '../src/shared/uiux/overviewText.ts'
import { claim, overview } from './support/overview-fixtures.ts'
import type { Provenance } from '../src/shared/uiux/types.ts'

// Fake translator: keeps the key visible and appends the parameters.
const t = (key: string, p?: Record<string, string | number>): string =>
  p ? `[${key} ${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(' ')}]` : `[${key}]`

test('provenanceLabel maps every provenance to its own key', () => {
  const all: Provenance[] = ['verified', 'user', 'estimated', 'unknown']
  assert.deepEqual(all.map((p) => provenanceLabel(p, t)), all.map((p) => `[uiux.overview.prov.${p}]`))
})

test('markdown: headings, provenance word on every statement, evidence paths, no HTML', () => {
  const md = overviewToMarkdown(overview(), t, { projectName: 'Back <i>seat</i>' })
  assert.match(md, /^# \[uiux\.overview\.title\] — Back \\<i\\>seat\\<\/i\\>/)
  for (const h of ['tab.purpose', 'tab.structure', 'tab.flows', 'tab.design', 'unknowns.title', 'questions.title', 'sources.title']) {
    assert.ok(md.includes(`## [uiux.overview.${h}]`), h)
  }
  assert.ok(md.includes('Capture tool for AI coding — [uiux.overview.prov.verified]'))
  assert.ok(md.includes('Tell the agent what is wrong on screen — [uiux.overview.prov.estimated]'))
  assert.ok(md.includes('`README.md`') && md.includes('`docs/users.md`') && md.includes('`src/renderer/editor/editor.ts`'))
  assert.ok(md.includes('Trust and security — [uiux.overview.prov.unknown]'))
  assert.equal(/(^|[^\\])<[a-zA-Z/]/m.test(md), false, 'no tag survives unescaped')
  assert.ok(md.includes('Tools \\<b\\>x\\</b\\>'))
})

test('markdown: goals and flows are numbered, structure is a nested list with connections', () => {
  const md = overviewToMarkdown(overview(), t)
  assert.ok(md.includes('1. Fast comparison of numbers — [uiux.overview.prov.user]'))
  assert.ok(md.includes('2. Brand expression — [uiux.overview.prov.estimated]'))
  assert.ok(md.includes('1. Press hotkey\n2. Draw\n3. Press Enter'))
  assert.ok(md.includes('### 1. Send a capture — [uiux.overview.prov.verified]'))
  assert.ok(md.includes('editor, ghost'), 'unknown screen ids are kept as ids')
  const lines = md.split('\n')
  const main = lines.findIndex((l) => l.startsWith('- **main**'))
  const tools = lines.findIndex((l) => l.startsWith('  - **Tools'))
  assert.ok(main >= 0 && tools > main, 'child indented under its parent')
  assert.ok(lines.some((l) => l.startsWith('- **store**') && l.includes('[uiux.overview.dashedNote]')), 'estimated nodes carry the text marker')
  assert.ok(lines.some((l) => l.includes('uiux.overview.conn.toLine') && l.includes('other=store') && l.includes('source=[uiux.overview.prov.estimated]')))
})

test('markdown: unknowns, questions, empty data and missing fields', () => {
  const md = overviewToMarkdown(overview(), t)
  assert.ok(md.includes('- License terms — [uiux.overview.prov.unknown]'))
  assert.ok(md.includes('- Who pays?'))
  const o = overview({ nodes: [], edges: [] })
  o.goals = []; o.workflows = []; o.unknowns = []; o.questions = undefined; o.sources = []
  o.summary = claim('', 'unknown')
  const empty = overviewToMarkdown(o, t)
  assert.ok(empty.includes('[uiux.overview.empty] — [uiux.overview.prov.unknown]'))
  assert.ok(empty.includes('[uiux.overview.structure.none]') && empty.includes('[uiux.overview.flows.none]'))
})

test('structureTree nests children, survives parent loops and lists both ends of edges', () => {
  const tree = structureTree(overview().architecture)
  assert.deepEqual(tree.map((i) => i.node.id), ['editor', 'main', 'store', 'mcp'])
  const main = tree.find((i) => i.node.id === 'main')!
  assert.deepEqual(main.children.map((c) => c.node.id), ['tools'])
  assert.deepEqual(main.out.map((o) => o.other), ['store', 'mcp'])
  assert.deepEqual(tree.find((i) => i.node.id === 'store')!.in.map((o) => o.other), ['main', 'Tools <b>x</b>'])
  const loop = structureTree({ nodes: [{ id: 'a', type: 'module', label: 'a', source: 'user', parent: 'b' }, { id: 'b', type: 'module', label: 'b', source: 'user', parent: 'a' }], edges: [] })
  assert.equal(loop.length, 2)
})

test('design implications come from goal words, say which goal they come from, and leave the rest unmatched', () => {
  const imp = designImplications(overview(), t)
  const ids = imp.fromGoals.map((h) => `${h.ruleId}:${h.basis}`)
  assert.ok(ids.includes('dense:Fast comparison of numbers'))
  assert.ok(ids.includes('brand:Brand expression'))
  assert.ok(ids.includes('trust:Trust and security'))
  assert.deepEqual(imp.unmatched.map((c) => c.value), ['Have fun'])
  assert.equal(imp.fromGoals.find((h) => h.ruleId === 'dense')!.basisSource, 'user')
  assert.equal(imp.fromGoals.find((h) => h.ruleId === 'dense')!.text, '[uiux.overview.imply.dense]')
  assert.equal(imp.constraints.length, 1)
  const ko = overview(); ko.goals = [claim('가독성과 접근성', 'user')]
  assert.deepEqual(designImplications(ko, t).fromGoals.map((h) => h.ruleId), ['readable', 'access'])
})

test('mdText and evidenceLine keep one line and the path first', () => {
  assert.equal(mdText('a\n\nb  <c>'), 'a b \\<c\\>')
  assert.equal(evidenceLine({ path: 'a/b.ts', note: 'n', checkedAt: '2026-01-02T03:04:05Z', revision: 'abc' }, t), 'a/b.ts — n · [uiux.overview.evidence.checked date=2026-01-02] · [uiux.overview.evidence.revision revision=abc]')
  assert.equal(evidenceLine({ path: 'a/b.ts' }, t), 'a/b.ts')
})
