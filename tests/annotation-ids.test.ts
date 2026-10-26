import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newAnnotationId, withAnnotationIds } from '../src/shared/annotationIds.ts'
import type { Annotation } from '../src/shared/types.ts'

const badge = (n: number, id?: string): Annotation => ({ kind: 'badge', x: n * 10, y: 0, n, color: '#E5484D', size: 22, tStart: n, tEnd: n, ...(id ? { id } : {}) })
const seq = (): (() => string) => { let i = 0; return () => `g${++i}` }

test('a list that already has unique ids comes back unchanged (same array)', () => {
  const list = [badge(1, 'x'), badge(2, 'y')]
  assert.equal(withAnnotationIds(list, seq()), list)
})

test('missing ids are filled in; existing ids are kept', () => {
  const out = withAnnotationIds([badge(1, 'keep'), badge(2), badge(3)], seq())
  assert.deepEqual(out.map((a) => a.id), ['keep', 'g1', 'g2'])
})

test('a repeated id (a copied annotation) gets a new one; the first keeps it', () => {
  const out = withAnnotationIds([badge(1, 'dup'), badge(2, 'dup')], seq())
  assert.deepEqual(out.map((a) => a.id), ['dup', 'g1'])
})

test('a generated id that collides with one in the list is skipped', () => {
  let i = 0
  const gen = (): string => (++i === 1 ? 'taken' : `g${i}`)
  const out = withAnnotationIds([badge(1, 'taken'), badge(2)], gen)
  assert.deepEqual(out.map((a) => a.id), ['taken', 'g2'])
})

test('normalising twice changes nothing the second time (redo restores the same ids)', () => {
  const once = withAnnotationIds([badge(1), badge(2)])
  assert.equal(withAnnotationIds(once), once)
})

test('ids follow the annotation, not its position: erase the first, the second keeps its id', () => {
  const list = withAnnotationIds([badge(1), badge(2), badge(3)])
  const second = list[1].id
  const afterErase = withAnnotationIds(list.filter((_, i) => i !== 0).map((a, i) => (a.kind === 'badge' ? { ...a, n: i + 1 } : a)))
  assert.equal(afterErase[0].id, second)
})

test('new ids are distinct', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newAnnotationId()))
  assert.equal(ids.size, 500)
})
