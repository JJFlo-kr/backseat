import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, buildRequest, discardDraftChanges, editDraft, isSent, markSent, missingAnnotations, newSession, release, status, switchProject } from '../src/shared/uiux/session.ts'
import { tokens } from './support/uiux-fixtures.ts'
import type { DesignTokens } from '../src/shared/uiux/types.ts'

const base = (): DesignTokens => tokens() as unknown as DesignTokens
const withPrimary = (hex: string) => { const t = base(); t.colors.primary = hex; return t }

test('panel states: off → draft edits are not applied → applied → stale → reflected (AC-02)', () => {
  let s = newSession(base(), 'acme-1')
  assert.equal(status(s), 'off')
  s = editDraft(s, { tokens: withPrimary('#123456') })
  assert.equal(status(s), 'off', 'editing a draft applies nothing')
  s = apply(s)
  assert.equal(status(s), 'applied')
  s = editDraft(s, { tokens: withPrimary('#654321') })
  assert.equal(status(s), 'stale')
  assert.equal(s.applied?.tokens.colors.primary, '#123456', 'what is applied does not follow the draft')
  s = apply(s)
  assert.equal(status(s), 'applied')
  assert.equal(s.applied?.tokens.colors.primary, '#654321')
})

test('release keeps the draft; discard returns the draft to what is applied', () => {
  let s = apply(editDraft(newSession(base(), 'acme-1'), { tokens: withPrimary('#111111') }))
  s = editDraft(s, { tokens: withPrimary('#222222') })
  const d = discardDraftChanges(s)
  assert.equal(status(d), 'applied')
  assert.equal(d.draft.tokens.colors.primary, '#111111')
  const r = release(s)
  assert.equal(status(r), 'off')
  assert.equal(r.draft.tokens.colors.primary, '#222222')
})

test('sent state: marked after a send, cleared by a later re-apply', () => {
  let s = apply(editDraft(newSession(base(), 'acme-1'), { preserve: ['logo'] }))
  s = markSent(s)
  assert.equal(isSent(s), true)
  s = apply(editDraft(s, { preserve: ['logo', 'menu'] }))
  assert.equal(isSent(s), false)
})

test('switching project releases what was applied', () => {
  const s = switchProject(apply(newSession(base(), 'acme-1')), 'other-2', base())
  assert.equal(s.projectId, 'other-2')
  assert.equal(status(s), 'off')
})

test('missing annotation ids are reported (AC-13)', () => {
  assert.deepEqual(missingAnnotations({ kind: 'annotations', annotationIds: ['a1', 'a2'] }, ['a2', 'a3']), ['a1'])
  assert.deepEqual(missingAnnotations({ kind: 'all' }, []), [])
})

test('the request carries only what is applied, with changes against the base', () => {
  const draft = newSession(base(), 'acme-1')
  assert.equal(buildRequest(draft, { projectName: 'Acme', checks: [] }), null, 'nothing applied → nothing sent')
  const s = apply(editDraft(draft, { tokens: withPrimary('#0A0A0A'), preserve: ['logo'], scope: { kind: 'annotations', annotationIds: ['a1'] } }))
  const later = editDraft(s, { tokens: withPrimary('#FFFFFF') })
  const req = buildRequest(later, { projectName: 'Acme', checks: [], now: new Date('2026-10-27T00:00:00Z') })
  assert.ok(req)
  assert.equal(req?.resolved.colors.primary, '#0A0A0A', 'a stale draft is not what is sent')
  assert.deepEqual(req?.changes.map((c) => c.path), ['colors.primary'])
  assert.deepEqual(req?.scope, { kind: 'annotations', annotationIds: ['a1'] })
  assert.equal(req?.createdAt, '2026-10-27T00:00:00.000Z')
})
