import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultTokens, diffTokens, getPath } from '../src/shared/uiux/builtin.ts'
import { tokenChecks } from '../src/shared/uiux/contrast.ts'
import { isOutdated, lockViolations, mixProposals, respectLocks, userProposal } from '../src/shared/uiux/mix.ts'
import type { DesignProposal, DesignTokens } from '../src/shared/uiux/types.ts'

const base = defaultTokens('light')

function tokens(edit: (t: DesignTokens) => void): DesignTokens {
  const t = structuredClone(base)
  edit(t)
  return t
}

function proposal(id: string, t: DesignTokens, extra: Partial<DesignProposal> = {}): DesignProposal {
  return {
    proposalId: id, projectId: 'p1', inputRevision: 1, direction: id.toUpperCase(), name: `name ${id}`, rationale: 'r',
    tokens: t, changes: [], preserved: [], previewKind: 'sample', checks: [], origin: 'agent', ...extra
  }
}

const colorsA = tokens((t) => { t.colors.primary = '#AA0000'; t.colors.surface = '#EEEEEE' })
const typeB = tokens((t) => { t.type.body.size = 18; t.type.heading.family = 'Georgia' })
const A = proposal('a', colorsA)
const B = proposal('b', typeB)

// ---------- locks ----------

test('lockViolations: no locks, no violations', () => {
  assert.deepEqual(lockViolations(A, base, []), [])
})

test('lockViolations: a locked leaf that the proposal changes', () => {
  assert.deepEqual(lockViolations(A, base, ['colors.primary']), ['colors.primary'])
})

test('lockViolations: a locked leaf the proposal leaves alone is no violation', () => {
  assert.deepEqual(lockViolations(B, base, ['colors.primary']), [])
})

test('lockViolations: a lock on a parent covers its children', () => {
  const v = lockViolations(A, base, ['colors'])
  assert.deepEqual([...v].sort(), ['colors.primary', 'colors.surface'])
})

test('lockViolations: a lock on a child of a changed object', () => {
  const p = proposal('c', tokens((t) => { t.type.body.size = 20; t.type.body.weight = 500 }))
  assert.deepEqual(lockViolations(p, base, ['type.body.size']), ['type.body.size'])
  assert.deepEqual(lockViolations(p, base, ['type.body']).sort(), ['type.body.size', 'type.body.weight'])
})

test('respectLocks restores locked values and keeps the rest', () => {
  const r = respectLocks(A, base, ['colors.primary'])
  assert.equal(r.tokens.colors.primary, base.colors.primary)
  assert.equal(r.tokens.colors.surface, '#EEEEEE')
  assert.deepEqual(lockViolations(r, base, ['colors.primary']), [])
  assert.equal(r.proposalId, 'a')
})

test('respectLocks: a parent lock restores every child', () => {
  const r = respectLocks(A, base, ['colors'])
  assert.deepEqual(r.tokens.colors, base.colors)
})

test('respectLocks does not mutate its input', () => {
  const before = structuredClone(A)
  respectLocks(A, base, ['colors'])
  assert.deepEqual(A, before)
})

test('respectLocks: a shadow switched off while a part of it is locked comes back whole', () => {
  const p = proposal('s', tokens((t) => { t.shadows.card = null }))
  assert.deepEqual(lockViolations(p, base, ['shadows.card.blur']), ['shadows.card'])
  const r = respectLocks(p, base, ['shadows.card.blur'])
  assert.deepEqual(r.tokens.shadows.card, base.shadows.card)
})

test('respectLocks: only the locked part of a shadow is restored', () => {
  const p = proposal('s2', tokens((t) => { t.shadows.card = { x: 4, y: 4, blur: 20, spread: 1, color: '#112233', opacity: 0.3 } }))
  const r = respectLocks(p, base, ['shadows.card.blur'])
  assert.equal(r.tokens.shadows.card?.blur, base.shadows.card?.blur)
  assert.equal(r.tokens.shadows.card?.x, 4)
})

test('respectLocks: an optional box value the proposal adds or drops', () => {
  const added = proposal('o', tokens((t) => { t.box.maxWidth = 640; delete t.box.buttonMinWidth }))
  const r = respectLocks(added, base, ['box.maxWidth', 'box.buttonMinWidth'])
  assert.equal(r.tokens.box.maxWidth, undefined)
  assert.equal(r.tokens.box.buttonMinWidth, base.box.buttonMinWidth)
  assert.deepEqual(lockViolations(r, base, ['box.maxWidth', 'box.buttonMinWidth']), [])
})

test('respectLocks: a lock on a path that does not exist changes nothing', () => {
  const r = respectLocks(A, base, ['colors.nope', 'nothing.at.all'])
  assert.deepEqual(r.tokens, A.tokens)
})

test('respectLocks and lockViolations agree on every lock set', () => {
  const sets = [['colors'], ['colors.primary', 'type.body'], ['box'], ['type.heading.family'], ['ratio', 'shadows']]
  for (const p of [A, B]) {
    for (const locks of sets) {
      const r = respectLocks(p, base, locks)
      assert.deepEqual(lockViolations(r, base, locks), [], `locks ${locks.join(',')}`)
      for (const l of locks) assert.deepEqual(getPath(r.tokens, l), getPath(base, l))
    }
  }
})

// ---------- mixing ----------

test('mixProposals: no picks equals the base', () => {
  const m = mixProposals(base, [A, B], [], [])
  assert.deepEqual(m.tokens, base)
  assert.deepEqual(m.changes, [])
  assert.deepEqual(m.from, { colors: 'base', ratio: 'base', shadows: 'base', type: 'base', box: 'base' })
})

test('mixProposals: colours from A, type from B', () => {
  const m = mixProposals(base, [A, B], [{ area: 'colors', proposalId: 'a' }, { area: 'type', proposalId: 'b' }], [])
  assert.deepEqual(m.tokens.colors, colorsA.colors)
  assert.deepEqual(m.tokens.type, typeB.type)
  assert.deepEqual(m.tokens.box, base.box)
  assert.deepEqual(m.from, { colors: 'a', ratio: 'base', shadows: 'base', type: 'b', box: 'base' })
  assert.deepEqual(m.changes, diffTokens(base, m.tokens))
  assert.deepEqual(m.changes.map((c) => c.path), ['colors.surface', 'colors.primary', 'type.heading.family', 'type.body.size'])
})

test('mixProposals: only the area is taken, not the rest of the proposal', () => {
  const both = proposal('ab', tokens((t) => { t.colors.primary = '#00AA00'; t.box.radius = 2 }))
  const m = mixProposals(base, [both], [{ area: 'box', proposalId: 'ab' }], [])
  assert.equal(m.tokens.box.radius, 2)
  assert.equal(m.tokens.colors.primary, base.colors.primary)
})

test('mixProposals: unknown proposal and explicit base fall back to the base; the last pick wins', () => {
  const m = mixProposals(base, [A, B], [
    { area: 'colors', proposalId: 'zzz' }, { area: 'type', proposalId: 'b' }, { area: 'type', proposalId: 'base' }
  ], [])
  assert.deepEqual(m.tokens, base)
  assert.equal(m.from.colors, 'base')
  assert.equal(m.from.type, 'base')
})

test('mixProposals: locks hold even when a proposal breaks them', () => {
  const m = mixProposals(base, [A, B], [{ area: 'colors', proposalId: 'a' }], ['colors.primary'])
  assert.equal(m.tokens.colors.primary, base.colors.primary)
  assert.equal(m.tokens.colors.surface, '#EEEEEE')
  assert.deepEqual(m.changes.map((c) => c.path), ['colors.surface'])
})

test('mixProposals does not alias the inputs', () => {
  const m = mixProposals(base, [A], [{ area: 'colors', proposalId: 'a' }], [])
  m.tokens.colors.primary = '#000001'
  assert.equal(A.tokens.colors.primary, '#AA0000')
  assert.equal(base.colors.primary, defaultTokens('light').colors.primary)
})

test('mockupStale: false while no proposal has a mock-up', () => {
  const m = mixProposals(base, [A, B], [{ area: 'colors', proposalId: 'a' }, { area: 'type', proposalId: 'b' }], [])
  assert.equal(m.mockupStale, false)
})

test('mockupStale: a mix that equals a single mock-up proposal is not stale', () => {
  const M = proposal('m', colorsA, { previewKind: 'mockup', previewRef: 'm.png' })
  const same = mixProposals(base, [M, B], [{ area: 'colors', proposalId: 'm' }], [])
  assert.equal(same.mockupStale, false)
})

test('mockupStale: a mix that matches no mock-up is stale', () => {
  const M = proposal('m', colorsA, { previewKind: 'mockup', previewRef: 'm.png' })
  const mixed = mixProposals(base, [M, B], [{ area: 'colors', proposalId: 'm' }, { area: 'type', proposalId: 'b' }], [])
  assert.equal(mixed.mockupStale, true)
  // the base values are not on any mock-up either
  assert.equal(mixProposals(base, [M], [], []).mockupStale, true)
})

test('mockupStale: a mock-up whose values broke a lock no longer shows the mix', () => {
  const M = proposal('m', colorsA, { previewKind: 'mockup', previewRef: 'm.png' })
  const m = mixProposals(base, [M], [{ area: 'colors', proposalId: 'm' }], ['colors.primary'])
  assert.equal(m.mockupStale, true)
})

// ---------- user proposal ----------

test('userProposal: shape and recomputed checks', () => {
  const m = mixProposals(base, [A, B], [{ area: 'colors', proposalId: 'a' }, { area: 'type', proposalId: 'b' }], [])
  const u = userProposal(m, { projectId: 'p1', inputRevision: 3, overviewRevision: 2 })
  assert.equal(u.origin, 'user')
  assert.equal(u.previewKind, 'sample')
  assert.equal(u.direction, 'mix')
  assert.equal(u.projectId, 'p1')
  assert.equal(u.inputRevision, 3)
  assert.equal(u.overviewRevision, 2)
  assert.equal(u.previewRef, undefined)
  assert.deepEqual(u.tokens, m.tokens)
  assert.deepEqual(u.checks, tokenChecks(m.tokens))
  assert.equal(u.changes.length, m.changes.length)
  assert.match(u.changes[0], /^colors\.surface: /)
  assert.ok(u.proposalId.startsWith('user-mix-'))
  assert.equal(userProposal(m, { projectId: 'p1', inputRevision: 3 }).proposalId, u.proposalId)
  assert.equal('overviewRevision' in userProposal(m, { projectId: 'p1', inputRevision: 3 }), false)
})

test('userProposal: another mix has another id; name and id can be given', () => {
  const m1 = mixProposals(base, [A, B], [{ area: 'colors', proposalId: 'a' }], [])
  const m2 = mixProposals(base, [A, B], [{ area: 'type', proposalId: 'b' }], [])
  const ctx = { projectId: 'p1', inputRevision: 1 }
  assert.notEqual(userProposal(m1, ctx).proposalId, userProposal(m2, ctx).proposalId)
  const named = userProposal(m1, { ...ctx, name: 'Mine', rationale: 'why', proposalId: 'u1' })
  assert.deepEqual([named.name, named.rationale, named.proposalId], ['Mine', 'why', 'u1'])
})

test('userProposal: a failing contrast shows up as a failed check', () => {
  const bad = proposal('bad', tokens((t) => { t.colors.text = '#FEFEFE' }))
  const m = mixProposals(base, [bad], [{ area: 'colors', proposalId: 'bad' }], [])
  const u = userProposal(m, { projectId: 'p1', inputRevision: 1 })
  assert.equal(u.checks.find((c) => c.id === 'contrast.text-background')?.status, 'fail')
})

// ---------- outdated ----------

test('isOutdated', () => {
  const p = (rev?: number): DesignProposal => proposal('x', base, rev === undefined ? {} : { overviewRevision: rev })
  assert.equal(isOutdated(p(1), 2), true)
  assert.equal(isOutdated(p(2), 2), false)
  assert.equal(isOutdated(p(3), 2), false)
  assert.equal(isOutdated(p(), 2), false)
  assert.equal(isOutdated(p(1), undefined), false)
})
