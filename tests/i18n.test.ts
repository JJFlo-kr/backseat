import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createTranslator,
  format,
  LOCALES,
  matchSystemLocale,
  mergeBundles,
  placeholders,
  resolveLocale,
  type Messages
} from '../src/shared/i18n.ts'
import { BUNDLES } from '../src/shared/bundles.ts'

const context = JSON.parse(readFileSync(new URL('../src/locales/_context.json', import.meta.url), 'utf8')) as Messages

test('system locales map onto the supported languages', () => {
  const cases: [string, string][] = [
    ['ko', 'ko'], ['ko-KR', 'ko'], ['en-US', 'en'], ['en-GB', 'en'], ['ja-JP', 'ja'],
    ['zh-CN', 'zh-CN'], ['zh-SG', 'zh-CN'], ['zh', 'zh-CN'], ['zh-Hans-HK', 'zh-TW'],
    ['zh-TW', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh-MO', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh_TW', 'zh-TW'],
    ['es-ES', 'es'], ['es-419', 'es'], ['pt-BR', 'pt-BR'], ['pt-PT', 'pt-BR'], ['pt', 'pt-BR'],
    ['de-AT', 'de'], ['fr-CA', 'fr'], ['vi-VN', 'en'], ['ar', 'en'], ['', 'en']
  ]
  for (const [tag, want] of cases) assert.equal(matchSystemLocale(tag), want, tag)
})

test('an explicit preference wins over the system locale; auto and unknown values do not', () => {
  assert.equal(resolveLocale('ja', 'ko-KR'), 'ja')
  assert.equal(resolveLocale('auto', 'de-DE'), 'de')
  assert.equal(resolveLocale(undefined, 'fr-FR'), 'fr')
  assert.equal(resolveLocale('xx', 'ko-KR'), 'ko')
})

test('placeholders are filled, unknown ones kept', () => {
  assert.equal(format('Saved: {path}', { path: 'C:\a.png' }), 'Saved: C:\a.png')
  assert.equal(format('{a} and {b}', { a: 1 }), '1 and {b}')
  assert.deepEqual(placeholders('{b} {a} {b}'), ['a', 'b'])
})

test('missing keys fall back to en, then ko; plural forms follow the locale', () => {
  const merged = mergeBundles('ja', {
    ko: { a: '가', b: '나', only: '한국어만' },
    en: { a: 'A', b: 'B', 'n.one': '{n} frame', 'n.other': '{n} frames' },
    ja: { a: 'ア' }
  })
  const t = createTranslator('ja', merged)
  assert.equal(t('a'), 'ア')
  assert.equal(t('b'), 'B')
  assert.equal(t('only'), '한국어만')
  assert.equal(t('nope'), 'nope')
  assert.equal(t('n', { n: 3 }), '3 frames') // ja has only "other"
  const en = createTranslator('en', merged)
  assert.equal(en('n', { n: 1 }), '1 frame')
  assert.equal(en('n', { n: 2 }), '2 frames')
})

const en = BUNDLES.en

test('every bundle has exactly the keys of en.json', () => {
  const want = Object.keys(en).sort()
  assert.ok(want.length > 100, 'en.json looks empty')
  for (const l of LOCALES) {
    const have = Object.keys(BUNDLES[l]).sort()
    const missing = want.filter((k) => !(k in BUNDLES[l]))
    const extra = have.filter((k) => !(k in en))
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, l)
  }
})

test('placeholders match en.json and no string is empty', () => {
  for (const l of LOCALES) {
    for (const [k, v] of Object.entries(BUNDLES[l])) {
      assert.equal(typeof v, 'string', `${l} ${k}`)
      assert.ok(v.trim().length > 0, `${l} ${k} is empty`)
      if (k in en) assert.deepEqual(placeholders(v), placeholders(en[k]), `${l} ${k}: ${v}`)
    }
  }
})

test('plural keys come in pairs and every key has a context note', () => {
  for (const k of Object.keys(en)) {
    if (k.endsWith('.one')) assert.ok(`${k.slice(0, -4)}.other` in en, k)
    assert.ok(k in context, `_context.json lacks ${k}`)
  }
})
