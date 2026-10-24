// Editor option memory (request 3, plan 2026-10-25 §3 phase 5): the last tool and each tool's last options
// survive a restart, broken or missing storage falls back to the defaults, and one bad field never resets the rest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultPrefs, loadPrefs, parsePrefs, savePrefs, nearest, hexColor, isDrawTool,
  PREFS_KEY, LEGACY_COLOR_KEY, DEFAULT_COLOR, DEFAULT_WIDTH, DEFAULT_TEXT_SIZE, BADGE_SIZES, BLUR_STRENGTHS, BLUR_SOLID, TEXT_SIZES,
  type KeyValueStore, type ToolPrefs
} from '../src/renderer/editor/prefs.ts'

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
}

const throwing: KeyValueStore = {
  getItem: () => { throw new Error('SecurityError') },
  setItem: () => { throw new Error('QuotaExceededError') }
}

test('defaults: red #E5484D, width 4, 24 px text on a background box, medium numbers and blur, pen first', () => {
  const d = defaultPrefs('Noto Sans KR')
  assert.equal(d.tool, 'pen')
  for (const s of [d.pen, d.arrow, d.rect]) assert.deepEqual(s, { color: DEFAULT_COLOR, width: DEFAULT_WIDTH })
  assert.equal(DEFAULT_COLOR, '#E5484D')
  assert.equal(DEFAULT_WIDTH, 4)
  assert.deepEqual(d.badge, { color: '#E5484D', size: 22 })
  assert.deepEqual(d.blur, { strength: 14 })
  assert.equal(d.text.size, DEFAULT_TEXT_SIZE)
  assert.equal(d.text.size, 24)
  assert.equal(d.text.style, 'plate')
  assert.equal(d.text.font, 'Noto Sans KR')
  assert.equal(d.text.bg, null)
  assert.equal(d.text.shadow, false)
})

test('every tool keeps its own options and the last drawing tool comes back', () => {
  const store = memStore()
  const p: ToolPrefs = defaultPrefs('Noto Sans KR')
  p.tool = 'badge'
  p.pen = { color: '#2F80ED', width: 7 }
  p.arrow = { color: '#FFC9C9', width: 2 }
  p.rect = { color: '#00AA55', width: 12 }
  p.badge = { color: '#6E56CF', size: 30 }
  p.blur = { strength: BLUR_SOLID }
  p.text = { color: '#FFFFFF', font: 'Jua', size: 32, style: 'outline', bold: false, italic: true, bg: '#1E5EFF', bgOpacity: 0.7, outline: '#1A1AFF', shadow: true }
  assert.equal(savePrefs(store, p), true)
  const back = loadPrefs(store, defaultPrefs('Noto Sans KR'))
  assert.deepEqual(back, p)
  assert.ok(store.data.has(PREFS_KEY))
})

test('the system font (null) and automatic plate values (null) round-trip as such', () => {
  const store = memStore()
  const p = defaultPrefs(null)
  savePrefs(store, p)
  const back = loadPrefs(store, defaultPrefs('Noto Sans KR'))
  assert.equal(back.text.font, null)
  assert.equal(back.text.bg, null)
  assert.equal(back.text.bgOpacity, null)
  assert.equal(back.text.bold, null)
})

test('a storage that throws (private profile, quota) means defaults, never an exception', () => {
  const d = defaultPrefs('Noto Sans KR')
  assert.deepEqual(loadPrefs(throwing, d), d)
  assert.equal(savePrefs(throwing, d), false)
  assert.deepEqual(loadPrefs(null, d), d)
  assert.equal(savePrefs(null, d), false)
})

test('broken JSON or a non-object falls back to the defaults', () => {
  const d = defaultPrefs('Noto Sans KR')
  assert.deepEqual(parsePrefs('{not json', null, d), d)
  assert.deepEqual(parsePrefs('[]', null, d).pen, d.pen)
  assert.deepEqual(parsePrefs('"pen"', null, d).text, d.text)
})

test('one bad field is replaced by its default; the others are kept', () => {
  const d = defaultPrefs('Noto Sans KR')
  const raw = JSON.stringify({
    tool: 'crop', // crop / eraser are never the starting tool
    pen: { color: 'red', width: 9 },
    arrow: { color: '#abc', width: 500 },
    rect: { color: '#123456', width: -3 },
    badge: { color: '#ABCDEF', size: 25 },
    blur: { strength: 3 },
    text: { color: '#FFFFFF', size: 20, style: 'neon', bgOpacity: 7, font: '', italic: 'yes' }
  })
  const p = parsePrefs(raw, null, d)
  assert.equal(p.tool, 'pen')
  assert.deepEqual(p.pen, { color: DEFAULT_COLOR, width: 9 })
  assert.deepEqual(p.arrow, { color: '#AABBCC', width: 24 }, 'short hex expanded, width clamped')
  assert.deepEqual(p.rect, { color: '#123456', width: 1 })
  assert.deepEqual(p.badge, { color: '#ABCDEF', size: d.badge.size }, 'only the offered sizes')
  assert.deepEqual(p.blur, d.blur)
  assert.equal(p.text.color, '#FFFFFF')
  assert.equal(p.text.size, d.text.size)
  assert.equal(p.text.style, 'plate')
  assert.equal(p.text.bgOpacity, 1)
  assert.equal(p.text.font, 'Noto Sans KR')
  assert.equal(p.text.italic, false)
})

test('the 0.4.x pen colour seeds every tool once; the newer prefs win afterwards', () => {
  const store = memStore({ [LEGACY_COLOR_KEY]: '#2f80ed' })
  const seeded = loadPrefs(store, defaultPrefs('Noto Sans KR'))
  for (const c of [seeded.pen.color, seeded.arrow.color, seeded.rect.color, seeded.badge.color, seeded.text.color]) assert.equal(c, '#2F80ED')
  const p = defaultPrefs('Noto Sans KR')
  p.pen.color = '#00AA55'
  savePrefs(store, p)
  assert.equal(loadPrefs(store, defaultPrefs('Noto Sans KR')).pen.color, '#00AA55')
})

test('the self-test key is separate and never seeded from the user profile', () => {
  const store = memStore({ [LEGACY_COLOR_KEY]: '#2F80ED' })
  const d = defaultPrefs('Noto Sans KR')
  assert.deepEqual(loadPrefs(store, d, 'backseat.selftest.tools'), d)
  const p = defaultPrefs('Noto Sans KR')
  p.tool = 'arrow'
  savePrefs(store, p, 'backseat.selftest.tools')
  assert.equal(store.data.has(PREFS_KEY), false, 'the user key is untouched')
})

test('helpers: nearest choice, hex normalising, drawing tools', () => {
  assert.equal(nearest(23, TEXT_SIZES), 24)
  assert.equal(nearest(40, TEXT_SIZES), 32)
  assert.equal(nearest(29, BADGE_SIZES), 30)
  assert.equal(nearest(1e9, BLUR_STRENGTHS), BLUR_SOLID)
  assert.equal(hexColor('#e5484d'), '#E5484D')
  assert.equal(hexColor('#fff'), '#FFFFFF')
  assert.equal(hexColor('rgb(1,2,3)'), null)
  assert.equal(isDrawTool('arrow'), true)
  assert.equal(isDrawTool('crop'), false)
  assert.equal(isDrawTool('eraser'), false)
})
