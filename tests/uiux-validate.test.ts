import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokens } from './support/uiux-fixtures.ts'
import { isRelativePath, overviewCompleteness, readOverview, readProposal, readSkillContext, readSkillList, readTokens } from '../src/shared/uiux/validate.ts'


const ev = [{ path: 'README.md' }]
const overview = (over: Record<string, unknown> = {}) => ({
  projectId: 'acme-1',
  summary: { value: 'A task tracker for small teams', source: 'verified', evidence: ev },
  purpose: { value: 'Keep a team\'s tasks in one place', source: 'verified', evidence: ev },
  goals: [{ value: 'readability', source: 'estimated' }],
  audiences: [{ value: 'small team leads', source: 'user' }],
  workflows: [{ id: 'signin', name: 'Sign in', steps: ['open', 'type email', 'sign in'], source: 'verified' }],
  architecture: { nodes: [{ id: 'login', type: 'screen', label: 'Sign-in', source: 'verified', evidence: [{ path: 'index.html' }] }, { id: 'api', type: 'external', label: 'Auth API', source: 'estimated' }], edges: [{ from: 'login', to: 'api', relation: 'calls', source: 'estimated' }] },
  stack: [{ value: 'static HTML', source: 'verified', evidence: [{ path: 'index.html' }] }],
  designState: [],
  designConstraints: [],
  sources: ev,
  unknowns: ['backend'],
  ...over
})

test('a well-formed overview is read and complete', () => {
  const r = readOverview(overview(), 'acme-1')
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  if (r.ok) assert.deepEqual(overviewCompleteness(r.value), { complete: true, gaps: [] })
})

test('an overview for another project is rejected (AC-05)', () => {
  const r = readOverview(overview({ projectId: 'other' }), 'acme-1')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.errors.join(), /not "acme-1"/)
})

test('a verified statement without evidence is rejected', () => {
  const r = readOverview(overview({ purpose: { value: 'x', source: 'verified' } }), 'acme-1')
  assert.equal(r.ok, false)
})

test('absolute PC paths in evidence are rejected; project-relative ones pass', () => {
  for (const bad of ['C:\\work\\a.md', '/home/me/a.md', '~/a.md', '../secret.txt', 'docs/../../x']) assert.equal(isRelativePath(bad), false, bad)
  for (const good of ['README.md', 'src/app/page.tsx', 'docs\\spec.md']) assert.equal(isRelativePath(good), true, good)
  const r = readOverview(overview({ sources: [{ path: 'C:\\Users\\me\\proj\\README.md' }] }), 'acme-1')
  assert.equal(r.ok, false)
})

test('an estimated purpose reads fine but is not complete (needs evidence or the user)', () => {
  const r = readOverview(overview({ purpose: { value: 'probably a tracker', source: 'estimated' } }), 'acme-1')
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(overviewCompleteness(r.value).gaps, ['purposeUnbacked'])
})

test('missing users, tasks or structure are listed as gaps', () => {
  const r = readOverview(overview({ audiences: [], workflows: [] }), 'acme-1')
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(overviewCompleteness(r.value).gaps, ['audiences', 'workflows'])
})

test('edges to unknown nodes and duplicate node ids are errors', () => {
  const arch = { nodes: [{ id: 'a', type: 'screen', label: 'A', source: 'user' }, { id: 'a', type: 'screen', label: 'A2', source: 'user' }], edges: [{ from: 'a', to: 'zz', relation: 'x', source: 'user' }] }
  const r = readOverview(overview({ architecture: arch }), 'acme-1')
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.match(r.errors.join(), /duplicate id a/)
    assert.match(r.errors.join(), /unknown node zz/)
  }
})

test('oversized text is reported, not passed through', () => {
  const r = readOverview(overview({ summary: { value: 'x'.repeat(5000), source: 'user' } }), 'acme-1')
  assert.equal(r.ok, false)
})

test('tokens: colours must be #RRGGBB, ratio must add up to 100, font names cannot carry CSS', () => {
  assert.ok(readTokens(tokens()).ok)
  const t1 = tokens(); t1.colors.primary = 'red'
  assert.equal(readTokens(t1).ok, false)
  const t2 = tokens(); t2.ratio = { background: 50, surface: 30, accent: 10 }
  assert.equal(readTokens(t2).ok, false)
  const t3 = tokens(); t3.type.body.family = 'X; background: url(evil)'
  assert.equal(readTokens(t3).ok, false)
})

test('a proposal is tied to the job\'s project and input; its checks arrive unverified', () => {
  const p = { projectId: 'acme-1', proposalId: 'p-a', direction: 'A', name: 'Minimal', rationale: 'keep brand', tokens: tokens(), changes: ['bigger button'], preserved: ['logo'], checks: [{ id: 'c1', kind: 'visual', label: 'contrast', status: 'pass' }] }
  const r = readProposal(p, { projectId: 'acme-1', inputRevision: 3 })
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  if (r.ok) {
    assert.equal(r.value.inputRevision, 3)
    assert.equal(r.value.checks[0].status, 'unverified')
    assert.equal(r.value.origin, 'agent')
  }
  assert.equal(readProposal({ ...p, projectId: 'x' }, { projectId: 'acme-1', inputRevision: 3 }).ok, false)
})

test('skill context: fields with provenance, wrong skill or project rejected', () => {
  const skill = { id: 'uupm', name: 'UI UX Pro Max', source: 'agent' as const }
  const ok = readSkillContext({ projectId: 'acme-1', skillId: 'uupm', fields: { framework: { value: 'static HTML', source: 'verified', evidence: [{ path: 'index.html' }] }, product_type: { value: 'SaaS', source: 'estimated' } }, missing: ['brand_colors'] }, { projectId: 'acme-1', skill })
  assert.ok(ok.ok, ok.ok ? '' : ok.errors.join('\n'))
  assert.equal(readSkillContext({ projectId: 'acme-1', skillId: 'other', fields: {} }, { projectId: 'acme-1', skill }).ok, false)
})

test('skill list from an agent is marked as agent skills', () => {
  const r = readSkillList({ skills: [{ id: 'ui-ux-pro-max', name: 'UI UX Pro Max', source: 'builtin' }] })
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.value[0].source, 'agent')
})
