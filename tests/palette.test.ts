import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PALETTES, RECENT_MAX, contrastText, normalizeHex, pushRecent, withAlpha } from '../src/shared/palette.ts'

test('palettes: exact ids/order and valid uppercase #RRGGBB colours', () => {
  assert.deepEqual(PALETTES.map((p) => p.id), ['vivid', 'calm', 'pastel', 'mono'])
  assert.deepEqual(PALETTES.map((p) => p.label), ['선명', '차분', '파스텔', '모노'])
  assert.deepEqual(PALETTES.map((p) => p.colors.length), [12, 12, 12, 9])
  for (const p of PALETTES) {
    for (const c of p.colors) assert.match(c, /^#[0-9A-F]{6}$/, `${p.id} ${c}`)
    assert.equal(new Set(p.colors).size, p.colors.length, `${p.id} has duplicates`)
  }
})

test('normalizeHex accepts hex forms and rgb()', () => {
  assert.equal(normalizeHex('#abc'), '#AABBCC')
  assert.equal(normalizeHex('abc'), '#AABBCC')
  assert.equal(normalizeHex('#AABBCC'), '#AABBCC')
  assert.equal(normalizeHex('  e5484d '), '#E5484D')
  assert.equal(normalizeHex('rgb(1,2,3)'), '#010203')
  assert.equal(normalizeHex('rgb(255, 128, 0)'), '#FF8000')
  assert.equal(normalizeHex('rgba(255,128,0,0.5)'), '#FF8000')
})

test('normalizeHex rejects garbage', () => {
  for (const bad of ['', '#', '#abcd', '#12345', 'xyz', '#GGGGGG', 'rgb(256,0,0)', 'rgb(1,2)', 'red']) {
    assert.equal(normalizeHex(bad), null, bad)
  }
})

test('pushRecent: most-recent first, dedup case-insensitively, capped', () => {
  assert.deepEqual(pushRecent([], '#e5484d'), ['#E5484D'])
  assert.deepEqual(pushRecent(['#111111', '#222222'], '#333333'), ['#333333', '#111111', '#222222'])
  assert.deepEqual(pushRecent(['#111111', '#222222', '#333333'], '#222222'), ['#222222', '#111111', '#333333'])
  assert.deepEqual(pushRecent(['#AAAAAA', '#BBBBBB'], '#aaaaaa'), ['#AAAAAA', '#BBBBBB'])
  const many = ['#000001', '#000002', '#000003', '#000004', '#000005', '#000006']
  const r = pushRecent(many, '#FFFFFF')
  assert.equal(r.length, RECENT_MAX)
  assert.equal(r[0], '#FFFFFF')
  assert.equal(r[5], '#000005')
  assert.equal(pushRecent(many, '#FFFFFF', 2).length, 2)
  const input = ['#111111']
  pushRecent(input, '#222222')
  assert.deepEqual(input, ['#111111'])
})

test('withAlpha', () => {
  assert.equal(withAlpha('#FF8000', 0.5), 'rgba(255,128,0,0.5)')
  assert.equal(withAlpha('#000000', 2), 'rgba(0,0,0,1)')
  assert.equal(withAlpha('#ffffff', -1), 'rgba(255,255,255,0)')
  assert.equal(withAlpha('#0A0B0C', 1), 'rgba(10,11,12,1)')
})

test('contrastText picks a readable colour', () => {
  assert.equal(contrastText('#FFFFFF'), '#000000')
  assert.equal(contrastText('#000000'), '#FFFFFF')
  assert.equal(contrastText('#FFEC99'), '#000000')
  assert.equal(contrastText('#FFC53D'), '#000000')
  assert.equal(contrastText('#1C2024'), '#FFFFFF')
  assert.equal(contrastText('#3E63DD'), '#FFFFFF')
  assert.equal(contrastText('#6E56CF'), '#FFFFFF')
})
