// How an agent's overview and the user's entries combine, and how hand edits mark only what changed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyOverviewEdits, mergeOverview, mergeSkillFields, sameOverviewContent, type AgentOverview } from '../src/shared/uiux/overviewMerge.ts'
import type { Claim, ProjectOverview } from '../src/shared/uiux/types.ts'

const ev = [{ path: 'README.md' }]
const user = (value: string): Claim => ({ value, source: 'user' })
const est = (value: string): Claim => ({ value, source: 'estimated' })

const agent = (over: Partial<AgentOverview> = {}): AgentOverview => ({
  schemaVersion: 1, projectId: 'p1',
  summary: { value: 'Agent summary', source: 'verified', evidence: ev },
  purpose: { value: 'Agent purpose', source: 'verified', evidence: ev },
  goals: [est('speed'), est('Readability')],
  audiences: [est('ops staff')],
  workflows: [{ id: 'w1', name: 'Sign in', steps: ['a'], source: 'verified' }],
  architecture: { nodes: [{ id: 'n1', type: 'screen', label: 'Login', source: 'verified', evidence: ev }], edges: [] },
  stack: [], designState: [], designConstraints: [], sources: ev, unknowns: ['backend'], questions: ['Which DB?'],
  ...over
})
const stored = (over: Partial<ProjectOverview> = {}): ProjectOverview => ({ ...agent(), revision: 3, basis: 'user', generatedAt: '2026-10-27T00:00:00.000Z', ...over })

test('no stored overview: the agent result as it is', () => {
  const m = mergeOverview(null, agent())
  assert.equal(m.summary.value, 'Agent summary')
  assert.deepEqual(m.goals.map((g) => g.value), ['speed', 'Readability'])
  assert.deepEqual(m.unknowns, ['backend'])
})

test('the user summary and purpose are never replaced; an estimated one is', () => {
  const m = mergeOverview(stored({ summary: user('My summary'), purpose: est('old guess') }), agent())
  assert.equal(m.summary.value, 'My summary')
  assert.equal(m.summary.source, 'user')
  assert.equal(m.purpose.value, 'Agent purpose')
})

test('user items stay first, agent duplicates (any case or spacing) are dropped, the rest comes from the agent', () => {
  const m = mergeOverview(stored({ goals: [user('  readability '), est('old agent goal')], audiences: [user('Ops Staff')] }), agent())
  assert.deepEqual(m.goals.map((g) => [g.value, g.source]), [['  readability ', 'user'], ['speed', 'estimated']])
  assert.deepEqual(m.audiences.map((a) => a.value), ['Ops Staff'], 'the agent audience is the same as the user one')
})

test('user workflows and nodes stay; same-name agent ones are dropped; id clashes are renamed', () => {
  const prev = stored({
    workflows: [{ id: 'w1', name: 'Checkout', steps: ['x'], source: 'user' }],
    architecture: { nodes: [{ id: 'n1', type: 'module', label: 'Billing', source: 'user' }], edges: [] }
  })
  const m = mergeOverview(prev, agent({ workflows: [{ id: 'w1', name: 'Sign in', steps: ['a'], source: 'verified' }, { id: 'w2', name: 'checkout', steps: ['b'], source: 'estimated' }] }))
  assert.deepEqual(m.workflows.map((w) => [w.id, w.name]), [['w1', 'Checkout'], ['w1-2', 'Sign in']])
  assert.deepEqual(m.architecture.nodes.map((n) => [n.id, n.label]), [['n1', 'Billing'], ['n1-2', 'Login']])
})

test('edges of agent nodes that were merged into a user node are re-pointed', () => {
  const prev = stored({ architecture: { nodes: [{ id: 'u1', type: 'screen', label: 'login', source: 'user' }], edges: [] } })
  const m = mergeOverview(prev, agent({
    architecture: {
      nodes: [{ id: 'n1', type: 'screen', label: 'Login', source: 'verified', evidence: ev }, { id: 'n2', type: 'store', label: 'DB', source: 'estimated' }],
      edges: [{ from: 'n1', to: 'n2', relation: 'reads', source: 'estimated' }]
    }
  }))
  assert.deepEqual(m.architecture.nodes.map((n) => n.id), ['u1', 'n2'])
  assert.deepEqual(m.architecture.edges.map((e) => [e.from, e.to]), [['u1', 'n2']])
})

test('unknowns and questions: an earlier agent run is replaced, a user or imported overview keeps its own', () => {
  const fromUser = mergeOverview(stored({ basis: 'user', unknowns: ['my open point'], questions: ['my question'] }), agent())
  assert.deepEqual(fromUser.unknowns, ['backend', 'my open point'])
  assert.deepEqual(fromUser.questions, ['Which DB?', 'my question'])
  const fromAgent = mergeOverview(stored({ basis: 'agent', unknowns: ['old agent doubt'] }), agent({ unknowns: [], questions: undefined }))
  assert.deepEqual(fromAgent.unknowns, [])
  assert.equal(fromAgent.questions, undefined)
})

test('skill fields: what the user typed stays', () => {
  const r = mergeSkillFields({ framework: user('Vue'), css: est('plain') }, { framework: est('React'), css: est('tailwind'), theme: est('dark') })
  assert.equal(r.fields.framework?.value, 'Vue')
  assert.equal(r.fields.css?.value, 'tailwind')
  assert.deepEqual(r.kept, ['framework'])
})

test('hand edits: only changed fields and new items become the user\'s', () => {
  const prev = stored({ basis: 'agent', goals: [est('speed'), est('trust')], audiences: [est('ops staff')], designState: [est('dark theme'), user('screen: dashboard')] })
  const next = applyOverviewEdits(prev, { summary: 'Agent summary', purpose: 'My purpose', goals: ['trust', 'accuracy'], audiences: ['ops staff'], screenKinds: ['dashboard', 'sign-in'] })
  assert.equal(next.summary.source, 'verified', 'unchanged text keeps its source and evidence')
  assert.deepEqual(next.summary.evidence, ev)
  assert.deepEqual(next.purpose, { value: 'My purpose', source: 'user' })
  assert.deepEqual(next.goals.map((g) => [g.value, g.source]), [['trust', 'estimated'], ['accuracy', 'user']], 'speed was removed by the user')
  assert.equal(next.audiences[0]?.source, 'estimated')
  assert.deepEqual(next.designState.map((c) => [c.value, c.source]), [['dark theme', 'estimated'], ['screen: dashboard', 'user'], ['screen: sign-in', 'user']])
  assert.equal(next.basis, 'agent', 'the basis stays')
  assert.equal('revision' in next, false)
})

test('hand edits that change nothing are recognised', () => {
  const prev = stored({ goals: [est('speed')], audiences: [est('ops')], designState: [] })
  const same = applyOverviewEdits(prev, { summary: prev.summary.value, purpose: prev.purpose.value, goals: ['speed'], audiences: ['ops'], screenKinds: [] })
  assert.equal(sameOverviewContent(same, prev), true)
  const changed = applyOverviewEdits(prev, { summary: 'new', purpose: prev.purpose.value, goals: ['speed'], audiences: ['ops'], screenKinds: [] })
  assert.equal(sameOverviewContent(changed, prev), false)
})
