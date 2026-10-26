import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUGGESTION_IDS, suggestionKey, suggestions, type SuggestContext } from '../src/shared/uiux/autocomplete.ts'
import { BUILTIN_SKILL, applyValue, defaultTokens } from '../src/shared/uiux/builtin.ts'
import type { Check, DesignRules } from '../src/shared/uiux/types.ts'

function rules(over: Partial<DesignRules> = {}): DesignRules {
  return {
    schemaVersion: 1, projectId: 'p1', revision: 1, tokens: defaultTokens(), locks: [], pageOverrides: {}, componentRules: [],
    themes: ['light'], updatedAt: '2026-10-27T00:00:00Z', ...over
  }
}
const ctx = (over: Partial<SuggestContext> = {}): SuggestContext => ({ memo: '', annotationKinds: [], ...over })
const ids = (c: SuggestContext, max?: number): string[] => suggestions(c, max).map((s) => s.id)

function failingTokens(): ReturnType<typeof defaultTokens> {
  let t = defaultTokens()
  t = applyValue(t, 'colors.primary', '#8899AA', []).tokens // onPrimary on it fails, so does primary on white
  t = applyValue(t, 'colors.textMuted', '#999999', []).tokens
  return t
}

test('nothing known: a few general phrases, at most 5, no duplicates', () => {
  const s = suggestions(ctx())
  assert.ok(s.length > 0 && s.length <= 5)
  assert.equal(new Set(s.map((x) => x.id)).size, s.length)
  assert.equal(new Set(s.map((x) => x.key)).size, s.length)
  for (const x of s) assert.match(x.key, /^uiux\.suggest\.[a-zA-Z]+$/)
})

test('max: default 5, honoured, zero and negative give nothing', () => {
  const full = ctx({ annotationKinds: ['text', 'rect', 'badge', 'stroke', 'blur'], tokens: failingTokens(), rules: rules({ locks: ['colors.primary'] }) })
  assert.equal(suggestions(full).length, 5)
  assert.equal(suggestions(full, 2).length, 2)
  assert.equal(suggestions(full, 1).length, 1)
  assert.deepEqual(suggestions(full, 0), [])
  assert.deepEqual(suggestions(full, -3), [])
  assert.ok(suggestions(full, 100).length > 5)
  assert.ok(suggestions(full, 100).length <= SUGGESTION_IDS.length)
  assert.deepEqual(suggestions(full, 2), suggestions(full, 5).slice(0, 2), 'a smaller max is a prefix of the larger')
})

test('ranking: failing contrast, then project rules, then annotation kinds, then general', () => {
  const c = ctx({
    tokens: failingTokens(),
    rules: rules({ locks: ['colors.primary'] }),
    annotationKinds: ['text', 'rect']
  })
  const all = ids(c, 100)
  const idx = (id: string): number => all.indexOf(id)
  assert.ok(idx('contrast-button') >= 0 && idx('contrast-text') >= 0 && idx('keep-brand-color') >= 0 && idx('text-size') >= 0 && idx('align-numbers-right') >= 0)
  assert.ok(Math.max(idx('contrast-button'), idx('contrast-text'), idx('contrast-accent')) < idx('keep-brand-color'), 'contrast before rules')
  assert.ok(idx('follow-rules') < idx('text-size'), 'rules before annotations')
  assert.ok(idx('align-edges') < idx('align-numbers-right'), 'annotations before general')
  assert.deepEqual(all.slice(0, 3), ['contrast-button', 'contrast-text', 'contrast-accent'])
})

test('contrast suggestions follow the failing checks only', () => {
  const none = ids(ctx({ tokens: defaultTokens() }), 100)
  assert.ok(!none.some((i) => i.startsWith('contrast')))
  const onlyButton: Check[] = [{ id: 'contrast.onPrimary-primary', kind: 'visual', label: 'x', status: 'fail' }, { id: 'contrast.text-background', kind: 'visual', label: 'x', status: 'pass' }]
  assert.deepEqual(ids(ctx({ checks: onlyButton }), 100).filter((i) => i.startsWith('contrast')), ['contrast-button'])
  const passing: Check[] = onlyButton.map((c) => ({ ...c, status: 'pass' as const }))
  assert.ok(!ids(ctx({ checks: passing }), 100).some((i) => i.startsWith('contrast')))
  // explicit checks win over the tokens
  assert.ok(!ids(ctx({ checks: passing, tokens: failingTokens() }), 100).some((i) => i.startsWith('contrast')))
  // an unverified check is not a failure
  const unverified: Check[] = [{ id: 'contrast.text-background', kind: 'visual', label: 'x', status: 'unverified' }]
  assert.ok(!ids(ctx({ checks: unverified }), 100).some((i) => i.startsWith('contrast')))
  const textFail: Check[] = [{ id: 'contrast.textMuted-surface', kind: 'visual', label: 'x', status: 'fail' }]
  assert.deepEqual(ids(ctx({ checks: textFail }), 100).filter((i) => i.startsWith('contrast')), ['contrast-text'])
  const accentFail: Check[] = [{ id: 'contrast.danger-background', kind: 'visual', label: 'x', status: 'fail' }]
  assert.deepEqual(ids(ctx({ checks: accentFail }), 100).filter((i) => i.startsWith('contrast')), ['contrast-accent'])
})

test('project rules produce phrases with params', () => {
  const r = rules({ locks: ['colors.primary', 'type'], tokens: applyValue(defaultTokens(), 'box.gap', 14, []).tokens })
  const s = suggestions(ctx({ rules: r }), 100)
  const by = Object.fromEntries(s.map((x) => [x.id, x]))
  assert.ok(by['keep-brand-color'])
  assert.ok(by['keep-locked'])
  assert.ok(by['card-shadow'], 'default tokens have a card shadow')
  assert.ok(!by['no-card-shadow'])
  assert.deepEqual(by['keep-gap'].params, { gap: 14 })
  assert.deepEqual(by['keep-font'].params, { font: 'Pretendard' })
  assert.equal(by['keep-gap'].key, 'uiux.suggest.keepGap')
  assert.ok(by['follow-rules'])
  assert.ok(!by['follow-skill'], 'the built-in skill is not mentioned')
  // flat project: the opposite phrase
  const flat = rules({ tokens: applyValue(defaultTokens(), 'shadows.card', null, []).tokens })
  const f = ids(ctx({ rules: flat }), 100)
  assert.ok(f.includes('no-card-shadow') && !f.includes('card-shadow'))
  // no rules: no project phrases
  assert.ok(!ids(ctx(), 100).some((i) => ['keep-gap', 'keep-font', 'card-shadow', 'follow-rules', 'keep-locked'].includes(i)))
  // a skill brings its own phrase
  const withSkill = suggestions(ctx({ skill: { id: 'x', name: 'Acme UI', source: 'agent' } }), 100).find((x) => x.id === 'follow-skill')
  assert.deepEqual(withSkill?.params, { skill: 'Acme UI' })
  assert.ok(!ids(ctx({ skill: BUILTIN_SKILL }), 100).includes('follow-skill'))
})

test('lock phrases only for locked brand colour', () => {
  assert.ok(!ids(ctx({ rules: rules({ locks: ['box.radius'] }) }), 100).includes('keep-brand-color'))
  assert.ok(ids(ctx({ rules: rules({ locks: ['box.radius'] }) }), 100).includes('keep-locked'))
  assert.ok(ids(ctx({ rules: rules({ locks: ['colors'] }) }), 100).includes('keep-brand-color'))
})

test('annotation kinds pick the family of phrases, in the order the kinds were drawn', () => {
  assert.deepEqual(ids(ctx({ annotationKinds: ['text'] }), 2), ['text-size', 'line-height'])
  assert.deepEqual(ids(ctx({ annotationKinds: ['rect'] }), 2), ['align-edges', 'equal-spacing'])
  assert.deepEqual(ids(ctx({ annotationKinds: ['arrow'] }), 2), ['align-edges', 'equal-spacing'])
  assert.deepEqual(ids(ctx({ annotationKinds: ['badge'] }), 1), ['only-numbered'])
  assert.deepEqual(ids(ctx({ annotationKinds: ['stroke'] }), 1), ['only-marked'])
  assert.deepEqual(ids(ctx({ annotationKinds: ['blur'] }), 1), ['keep-hidden'])
  assert.deepEqual(ids(ctx({ annotationKinds: ['rect', 'text'] }), 4), ['align-edges', 'equal-spacing', 'text-size', 'line-height'])
  assert.deepEqual(ids(ctx({ annotationKinds: ['text', 'text', 'rect', 'text'] }), 4), ['text-size', 'line-height', 'align-edges', 'equal-spacing'])
  // kinds that were not drawn do not show up
  assert.ok(!ids(ctx({ annotationKinds: ['text'] }), 100).includes('align-edges'))
})

test('memo that already says it: the idea is not suggested again (Korean and English)', () => {
  const base = ctx({ annotationKinds: ['text', 'rect'], tokens: failingTokens(), rules: rules({ locks: ['colors.primary'] }) })
  const all = ids(base, 100)
  assert.ok(all.includes('contrast-button') && all.includes('keep-brand-color') && all.includes('text-size'))
  const without = (memo: string): string[] => ids({ ...base, memo }, 100)
  assert.ok(!without('버튼 대비를 올려 주세요').some((i) => i.startsWith('contrast')))
  assert.ok(!without('Please fix the CONTRAST').some((i) => i.startsWith('contrast')))
  assert.ok(!without('브랜드 색은 그대로').includes('keep-brand-color'))
  assert.ok(!without('keep the brand colour').includes('keep-brand-color'))
  assert.ok(!without('글자 크기를 키워서').includes('text-size'))
  assert.ok(!without('make the font size bigger').includes('text-size'))
  assert.ok(!without('행간 넓게').includes('line-height'))
  assert.ok(!without('카드 그림자는 프로젝트 것').includes('card-shadow'))
  assert.ok(!without('no Shadow please').includes('card-shadow'))
  // other ideas stay
  assert.ok(without('브랜드 색은 그대로').includes('contrast-button'))
  assert.ok(without('keep the brand colour').includes('text-size'))
  // unrelated words do not hide anything
  assert.deepEqual(without('이 버튼 좀 고쳐 주세요'), all)
  // with the slots freed, the next phrases move up
  const top = ids({ ...base, memo: '대비' }, 3)
  assert.equal(top[0], 'keep-brand-color')
  assert.ok(!top.some((i) => i.startsWith('contrast')))
})

test('memo keywords for general phrases', () => {
  const all = ids(ctx(), 100)
  assert.ok(all.includes('align-numbers-right'))
  assert.ok(!ids(ctx({ memo: '표의 숫자는 오른쪽 정렬' }), 100).includes('align-numbers-right'))
  assert.ok(!ids(ctx({ memo: 'right-align the numbers' }), 100).includes('align-numbers-right'))
  assert.ok(!ids(ctx({ memo: '새 색은 쓰지 마세요' }), 100).includes('no-new-colors'))
})

test('no duplicates anywhere, params stay small and printable', () => {
  const c = ctx({
    annotationKinds: ['text', 'rect', 'arrow', 'badge', 'stroke', 'blur', 'text'], tokens: failingTokens(),
    rules: rules({ locks: ['colors', 'colors.primary'] }), skill: { id: 'a', name: 'Acme', source: 'imported' }
  })
  const s = suggestions(c, 100)
  assert.equal(new Set(s.map((x) => x.id)).size, s.length)
  assert.equal(new Set(s.map((x) => x.key)).size, s.length)
  assert.equal(s.length, SUGGESTION_IDS.length - 1, 'with full context every phrase can appear except the card-shadow opposite')
  for (const x of s) {
    assert.equal(x.key, suggestionKey(x.id))
    for (const v of Object.values(x.params ?? {})) assert.ok(typeof v === 'string' || typeof v === 'number')
  }
  assert.equal(suggestionKey('keep-brand-color'), 'uiux.suggest.keepBrandColor')
})
