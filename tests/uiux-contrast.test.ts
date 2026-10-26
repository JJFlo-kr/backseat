import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adjustForContrast, contrastRatio, formatRatio, mix, parseHex, readableOn, relativeLuminance, tokenChecks } from '../src/shared/uiux/contrast.ts'
import { defaultTokens } from '../src/shared/uiux/builtin.ts'

test('contrastRatio: known pairs', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21)
  assert.equal(contrastRatio('#FFFFFF', '#000000'), 21)
  assert.equal(contrastRatio('#336699', '#336699'), 1)
  assert.ok(Math.abs(contrastRatio('#777777', '#FFFFFF') - 4.48) < 0.01)
  assert.ok(contrastRatio('#767676', '#FFFFFF') >= 4.5, '#767676 is the lightest grey that passes 4.5 on white')
  assert.ok(contrastRatio('#777777', '#FFFFFF') < 4.5)
  assert.ok(Math.abs(contrastRatio('#0000FF', '#FFFFFF') - 8.59) < 0.01)
})

test('contrastRatio: short hex works, garbage gives NaN', () => {
  assert.equal(contrastRatio('#000', '#fff'), 21)
  assert.ok(Number.isNaN(contrastRatio('red', '#FFFFFF')))
  assert.ok(Number.isNaN(contrastRatio('#12345', '#FFFFFF')))
  assert.equal(parseHex('#1A2B3C')?.join(','), '26,43,60')
  assert.equal(parseHex('nope'), null)
  assert.ok(Number.isNaN(relativeLuminance('')))
})

test('formatRatio cuts instead of rounding up to a limit', () => {
  assert.equal(formatRatio(21), '21.00:1')
  assert.equal(formatRatio(4.4999), '4.49:1')
  assert.equal(formatRatio(4.5), '4.50:1')
  assert.equal(formatRatio(NaN), '')
})

test('mix, readableOn and adjustForContrast', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0), '#000000')
  assert.equal(mix('#000000', '#FFFFFF', 1), '#FFFFFF')
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080')
  assert.equal(readableOn('#000000'), '#FFFFFF')
  assert.equal(readableOn('#FFFFFF'), '#111111')
  // already fine: unchanged
  assert.equal(adjustForContrast('#000000', [{ against: '#FFFFFF', min: 4.5 }]), '#000000')
  // too light: darkened until it passes
  const fixed = adjustForContrast('#999999', [{ against: '#FFFFFF', min: 4.5 }])
  assert.ok(contrastRatio(fixed, '#FFFFFF') >= 4.5)
  assert.notEqual(fixed, '#999999')
  // impossible: unchanged
  assert.equal(adjustForContrast('#888888', [{ against: '#808080', min: 21 }]), '#888888')
})

test('tokenChecks: default light and dark tokens pass every check', () => {
  for (const theme of ['light', 'dark'] as const) {
    const checks = tokenChecks(defaultTokens(theme))
    assert.equal(checks.length, 10)
    for (const c of checks) assert.equal(c.status, 'pass', `${theme}: ${c.id} ${c.note}`)
  }
})

test('tokenChecks: shape, ids, labels and notes', () => {
  const checks = tokenChecks(defaultTokens())
  assert.deepEqual(checks.map((c) => c.id), [
    'contrast.text-background', 'contrast.text-surface', 'contrast.textMuted-background', 'contrast.textMuted-surface',
    'contrast.onPrimary-primary', 'contrast.primary-background',
    'contrast.success-background', 'contrast.warning-background', 'contrast.danger-background', 'contrast.info-background'
  ])
  for (const c of checks) {
    assert.equal(c.kind, 'visual')
    assert.notEqual(c.status, 'unverified')
    assert.match(c.label, /^uiux\.check\.contrast\.[A-Za-z]+$/)
    assert.match(c.note ?? '', /^\d+\.\d\d:1$/)
  }
  assert.deepEqual(tokenChecks(defaultTokens()).map((c) => c.id), checks.map((c) => c.id), 'ids are stable')
  assert.equal(checks[0].note, formatRatio(contrastRatio(defaultTokens().colors.text, defaultTokens().colors.background)))
})

test('tokenChecks: failing pairs are reported, using 4.5 for text and 3 for non-text', () => {
  const t = defaultTokens()
  t.colors.textMuted = '#777777' // 4.48 on white: fails 4.5
  t.colors.warning = '#FFEB99' // pale on white: fails 3
  t.colors.primary = '#8899AA' // lightish: onPrimary white on it fails 4.5, and against white it fails 3
  const byId = new Map(tokenChecks(t).map((c) => [c.id, c]))
  assert.equal(byId.get('contrast.textMuted-background')?.status, 'fail')
  assert.equal(byId.get('contrast.textMuted-background')?.note, '4.47:1')
  assert.equal(byId.get('contrast.warning-background')?.status, 'fail')
  assert.equal(byId.get('contrast.onPrimary-primary')?.status, 'fail')
  assert.equal(byId.get('contrast.primary-background')?.status, 'fail')
  assert.equal(byId.get('contrast.text-background')?.status, 'pass')
  assert.equal(byId.get('contrast.danger-background')?.status, 'pass')
})

test('tokenChecks: a 3:1 colour passes as non-text but would fail as text', () => {
  const t = defaultTokens()
  t.colors.info = '#8A8A8A' // about 3.4:1 on white
  const info = tokenChecks(t).find((c) => c.id === 'contrast.info-background')
  assert.equal(info?.status, 'pass')
  t.colors.text = '#8A8A8A'
  assert.equal(tokenChecks(t).find((c) => c.id === 'contrast.text-background')?.status, 'fail')
})

test('tokenChecks: an invalid colour fails instead of throwing', () => {
  const t = defaultTokens()
  t.colors.text = '#12'
  const c = tokenChecks(t).find((x) => x.id === 'contrast.text-background')
  assert.equal(c?.status, 'fail')
  assert.equal(c?.note, undefined)
})
