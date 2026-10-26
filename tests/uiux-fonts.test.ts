import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  firstAvailable, formatFamilyList, isGenericFamily, judgeProbes, parseFamilyList, reportFor, shownDiffers, widthsDiffer
} from '../src/shared/uiux/fonts.ts'

test('parseFamilyList: requested first, then the fallback stack, quotes stripped', () => {
  assert.deepEqual(parseFamilyList('Pretendard', 'Malgun Gothic, sans-serif'), ['Pretendard', 'Malgun Gothic', 'sans-serif'])
  assert.deepEqual(parseFamilyList('"Noto Sans KR", \'Apple SD Gothic Neo\'', 'system-ui'), ['Noto Sans KR', 'Apple SD Gothic Neo', 'system-ui'])
})

test('parseFamilyList: commas inside quotes stay, blanks and repeats go, whitespace collapses', () => {
  assert.deepEqual(parseFamilyList('"Foo, Bar"', 'sans-serif'), ['Foo, Bar', 'sans-serif'])
  assert.deepEqual(parseFamilyList('  Roboto   Mono ', ', ,roboto mono, Consolas ,'), ['Roboto Mono', 'Consolas'])
  assert.deepEqual(parseFamilyList('', ''), [])
})

test('parseFamilyList: entries that could break out of a CSS value are dropped', () => {
  assert.deepEqual(parseFamilyList('Evil; background: url(x)', 'sans-serif'), ['sans-serif'])
  assert.deepEqual(parseFamilyList('a{b}', 'monospace'), ['monospace'])
  assert.deepEqual(parseFamilyList('ok\nname', 'serif'), ['serif'])
})

test('isGenericFamily: generic keywords only, case and quotes ignored', () => {
  for (const g of ['sans-serif', 'serif', 'monospace', 'system-ui', 'SANS-SERIF', '"system-ui"', 'ui-monospace']) assert.equal(isGenericFamily(g), true, g)
  for (const n of ['Pretendard', 'Arial', 'Malgun Gothic', '']) assert.equal(isGenericFamily(n), false, n)
})

test('firstAvailable: generics always count, others ask the callback, null when nothing', () => {
  const asked: string[] = []
  const has = (f: string): boolean => {
    asked.push(f)
    return f === 'Malgun Gothic'
  }
  assert.equal(firstAvailable(['Pretendard', 'Malgun Gothic', 'sans-serif'], has), 'Malgun Gothic')
  assert.deepEqual(asked, ['Pretendard', 'Malgun Gothic'])
  assert.equal(firstAvailable(['Pretendard', 'sans-serif'], () => false), 'sans-serif')
  assert.equal(firstAvailable(['system-ui', 'Pretendard'], () => { throw new Error('must not be asked') }), 'system-ui')
  assert.equal(firstAvailable(['A', 'B'], () => false), null)
  assert.equal(firstAvailable([], () => true), null)
})

test('formatFamilyList: names quoted and escaped, generics bare', () => {
  assert.equal(formatFamilyList(['Noto Sans KR', 'sans-serif']), '"Noto Sans KR", sans-serif')
  assert.equal(formatFamilyList(['Say "hi"', 'System-UI']), '"Say \\"hi\\"", system-ui')
  assert.equal(formatFamilyList([]), '')
})

test('widthsDiffer / judgeProbes: a missing font measures like both fallbacks', () => {
  const same = { withA: 100, baseA: 100, withB: 90, baseB: 90 }
  assert.equal(widthsDiffer(same), false)
  assert.equal(widthsDiffer({ ...same, withA: 101 }), true)
  // an installed font that happens to equal one fallback is still caught by the other
  assert.equal(widthsDiffer({ withA: 100, baseA: 100, withB: 90, baseB: 80 }), true)
  assert.deepEqual(judgeProbes(same, same), { installed: false, koreanGlyphs: false })
})

test('judgeProbes: installed without Hangul glyphs, and installed with them', () => {
  const same = { withA: 100, baseA: 100, withB: 90, baseB: 90 }
  const differs = { withA: 120, baseA: 100, withB: 110, baseB: 90 }
  assert.deepEqual(judgeProbes(differs, same), { installed: true, koreanGlyphs: false })
  assert.deepEqual(judgeProbes(differs, differs), { installed: true, koreanGlyphs: true })
  // a Hangul-only font still counts as installed
  assert.deepEqual(judgeProbes(same, differs), { installed: true, koreanGlyphs: true })
})

test('reportFor: requested font installed with Hangul', () => {
  const r = reportFor(['Pretendard', 'sans-serif'], () => true, () => true)
  assert.deepEqual(r, { requested: 'Pretendard', used: 'Pretendard', missingRequested: false, koreanGlyphs: true })
  assert.equal(shownDiffers(r), false)
})

test('reportFor: missing requested font is replaced by the first available fallback', () => {
  const r = reportFor(['Pretendard', 'Malgun Gothic', 'sans-serif'], (f) => f === 'Malgun Gothic', () => true)
  assert.deepEqual(r, { requested: 'Pretendard', used: 'Malgun Gothic', missingRequested: true, koreanGlyphs: true })
  assert.equal(shownDiffers(r), true)
})

test('reportFor: installed but Latin-only is reported as lacking Hangul', () => {
  const r = reportFor(['Roboto Mono', 'monospace'], () => true, () => false)
  assert.equal(r.used, 'Roboto Mono')
  assert.equal(r.missingRequested, false)
  assert.equal(r.koreanGlyphs, false)
  assert.equal(shownDiffers(r), false)
})

test('reportFor: generic requested/used family never counts as missing and supplies Hangul itself', () => {
  const g = reportFor(['sans-serif'], () => false, () => false)
  assert.deepEqual(g, { requested: 'sans-serif', used: 'sans-serif', missingRequested: false, koreanGlyphs: true })
  const fell = reportFor(['Nope', 'sans-serif'], () => false, () => false)
  assert.deepEqual(fell, { requested: 'Nope', used: 'sans-serif', missingRequested: true, koreanGlyphs: true })
  assert.equal(shownDiffers(fell), true)
})

test('reportFor: empty list and case-only difference', () => {
  assert.deepEqual(reportFor([], () => true, () => true), { requested: '', used: '', missingRequested: false, koreanGlyphs: false })
  assert.equal(shownDiffers({ requested: 'Arial', used: 'arial', missingRequested: false, koreanGlyphs: true }), false)
})

test('hasKorean is asked only of the used non-generic family', () => {
  const asked: string[] = []
  reportFor(['Missing', 'Malgun Gothic', 'sans-serif'], (f) => f === 'Malgun Gothic', (f) => { asked.push(f); return true })
  assert.deepEqual(asked, ['Malgun Gothic'])
})
