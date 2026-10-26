import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_SKILL, applyValue, boxOptions, colorStrategies, defaultTokens, diffTokens, getPath, ratioOptions, shadowOptions, typeOptions,
  type Option, type RecommendInput
} from '../src/shared/uiux/builtin.ts'
import { tokenChecks } from '../src/shared/uiux/contrast.ts'
import { readTokens } from '../src/shared/uiux/validate.ts'
import type { Claim, DesignTokens } from '../src/shared/uiux/types.ts'

const claim = (value: string): Claim => ({ value, source: 'user' })
function overview(parts: { purpose?: string; goals?: string[]; audiences?: string[]; designState?: string[] }): NonNullable<RecommendInput['overview']> {
  return {
    purpose: claim(parts.purpose ?? ''),
    goals: (parts.goals ?? []).map(claim),
    audiences: (parts.audiences ?? []).map(claim),
    designState: (parts.designState ?? []).map(claim)
  }
}

interface Area { name: string; section: keyof DesignTokens; run: (i: RecommendInput) => Option<unknown>[] }
const AREAS: Area[] = [
  { name: 'colors', section: 'colors', run: colorStrategies },
  { name: 'ratio', section: 'ratio', run: ratioOptions },
  { name: 'shadows', section: 'shadows', run: shadowOptions },
  { name: 'type', section: 'type', run: typeOptions },
  { name: 'box', section: 'box', run: boxOptions }
]

function brandBase(): DesignTokens {
  const t = defaultTokens()
  t.colors.primary = '#E4572E'
  t.colors.background = '#FFF8F0'
  t.colors.surface = '#FBEBDD'
  t.colors.textMuted = '#9A8F86' // weak on purpose
  t.ratio = { background: 55, surface: 35, accent: 10 }
  t.shadows.card = { x: 1, y: 3, blur: 9, spread: 0, color: '#223344', opacity: 0.2 }
  t.type.body = { family: 'Gmarket Sans', fallback: 'sans-serif', size: 16, weight: 300, lineHeight: 1.4 }
  t.box = { radius: 3, paddingX: 9, paddingY: 7, gap: 5, density: 'compact' }
  return t
}

function rec<T>(opts: Option<T>[]): Option<T> {
  const r = opts.find((o) => o.recommended)
  assert.ok(r, 'a recommended option')
  return r
}

test('BUILTIN_SKILL and defaultTokens', () => {
  assert.deepEqual(BUILTIN_SKILL, { id: 'backseat-basic', name: 'Backseat basic design rules', source: 'builtin', version: '1' })
  for (const theme of [undefined, 'light', 'dark'] as const) {
    const r = readTokens(defaultTokens(theme))
    assert.ok(r.ok, r.ok ? '' : r.errors.join('; '))
  }
  assert.notDeepEqual(defaultTokens('light').colors, defaultTokens('dark').colors)
  assert.notEqual(defaultTokens(), defaultTokens(), 'a fresh object each time')
  assert.equal(defaultTokens().shadows.button, null, 'no shadow on every button by default')
  assert.equal(defaultTokens('dark').shadows.card, null, 'dark theme leans on borders and surfaces')
})

test('getPath', () => {
  const t = defaultTokens()
  assert.equal(getPath(t, 'colors.primary'), t.colors.primary)
  assert.equal(getPath(t, 'type.body.size'), 15)
  assert.equal(getPath(t, 'shadows.button'), null)
  assert.equal(getPath(t, 'colors.nope'), undefined)
  assert.equal(getPath(t, 'box.maxWidth'), undefined)
  assert.equal(getPath(t, '__proto__.x'), undefined)
  assert.equal(getPath(t, 'colors.primary.x'), undefined)
})

test('applyValue: immutable, sets a leaf', () => {
  const t = defaultTokens()
  const before = JSON.stringify(t)
  const r = applyValue(t, 'colors.primary', '#112233', [])
  assert.equal(JSON.stringify(t), before)
  assert.equal(r.tokens.colors.primary, '#112233')
  assert.deepEqual(r.blocked, [])
  assert.notEqual(r.tokens, t)
  assert.equal(r.tokens.type, t.type, 'untouched branches are shared')
  assert.equal(applyValue(t, 'colors.primary', t.colors.primary, []).tokens, t, 'no change, same object')
})

test('applyValue: locked path and children of a locked path are blocked', () => {
  const t = defaultTokens()
  const a = applyValue(t, 'colors.primary', '#112233', ['colors.primary'])
  assert.equal(a.tokens.colors.primary, t.colors.primary)
  assert.deepEqual(a.blocked, ['colors.primary'])
  const b = applyValue(t, 'colors.primary', '#112233', ['colors'])
  assert.equal(b.tokens.colors.primary, t.colors.primary)
  assert.deepEqual(b.blocked, ['colors.primary'])
  const c = applyValue(t, 'type.body.size', 20, ['type'])
  assert.equal(c.tokens.type.body.size, 15)
  assert.deepEqual(c.blocked, ['type.body.size'])
  // a different path is free
  const d = applyValue(t, 'colors.danger', '#AA0000', ['colors.primary'])
  assert.equal(d.tokens.colors.danger, '#AA0000')
  assert.deepEqual(d.blocked, [])
  // a lock on a sibling prefix is not a lock on this path
  const e = applyValue(t, 'colors.primary', '#112233', ['colors.primaryX'])
  assert.equal(e.tokens.colors.primary, '#112233')
  // same value on a locked path is not an attempt to change it
  assert.deepEqual(applyValue(t, 'colors.primary', t.colors.primary, ['colors.primary']).blocked, [])
})

test('applyValue: setting a parent keeps the locked children', () => {
  const t = defaultTokens()
  const next = { ...t.colors, primary: '#010203', danger: '#AA0000' }
  const r = applyValue(t, 'colors', next, ['colors.primary'])
  assert.equal(r.tokens.colors.primary, t.colors.primary)
  assert.equal(r.tokens.colors.danger, '#AA0000')
  assert.deepEqual(r.blocked, ['colors.primary'])
  // replacing a shadow by null while one of its fields is locked
  const card = t.shadows.card
  assert.ok(card)
  const s = applyValue(t, 'shadows.card', null, ['shadows.card.blur'])
  assert.deepEqual(s.tokens.shadows.card, card)
  assert.deepEqual(s.blocked, ['shadows.card.blur'])
  // optional box fields can be added and removed
  const added = applyValue(t, 'box.maxWidth', 640, [])
  assert.equal(added.tokens.box.maxWidth, 640)
  const removed = applyValue(added.tokens, 'box.maxWidth', undefined, [])
  assert.equal('maxWidth' in removed.tokens.box, false)
})

test('applyValue: unknown paths are ignored', () => {
  const t = defaultTokens()
  assert.equal(applyValue(t, 'colors.nope', '#000000', []).tokens, t)
  assert.equal(applyValue(t, '__proto__.polluted', 1, []).tokens, t)
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('diffTokens: leaf paths in a stable order', () => {
  const a = defaultTokens()
  assert.deepEqual(diffTokens(a, a), [])
  let b = applyValue(a, 'box.radius', 12, []).tokens
  b = applyValue(b, 'colors.text', '#000000', []).tokens
  b = applyValue(b, 'type.heading.size', 30, []).tokens
  b = applyValue(b, 'ratio.accent', 5, []).tokens
  const d = diffTokens(a, b)
  assert.deepEqual(d.map((c) => c.path), ['colors.text', 'ratio.accent', 'type.heading.size', 'box.radius'])
  assert.deepEqual(d[0], { path: 'colors.text', from: a.colors.text, to: '#000000' })
  assert.deepEqual(diffTokens(b, a).map((c) => c.path), d.map((c) => c.path), 'same order both ways')
})

test('diffTokens: shadow null vs object is one change; optional fields count', () => {
  const a = defaultTokens()
  const b = applyValue(a, 'shadows.card', null, []).tokens
  const d = diffTokens(a, b)
  assert.deepEqual(d.map((c) => c.path), ['shadows.card'])
  assert.equal(d[0].to, null)
  const c = applyValue(a, 'shadows.card.blur', 20, []).tokens
  assert.deepEqual(diffTokens(a, c).map((x) => x.path), ['shadows.card.blur'])
  const e = applyValue(a, 'box.maxWidth', 700, []).tokens
  assert.deepEqual(diffTokens(a, e), [{ path: 'box.maxWidth', from: undefined, to: 700 }])
})

test('options: ids, keys and values are well formed; values are valid tokens', () => {
  for (const area of AREAS) {
    const opts = area.run({ base: defaultTokens(), locks: [] })
    assert.ok(opts.length >= 3, area.name)
    assert.equal(new Set(opts.map((o) => o.id)).size, opts.length, `${area.name}: unique ids`)
    for (const o of opts) {
      assert.match(o.labelKey, /^uiux\.rec\.[a-zA-Z]+\.[a-zA-Z]+\.label$/)
      assert.match(o.reasonKey, /^uiux\.rec\.[a-zA-Z]+\.[a-zA-Z]+\.(general|fit)$/)
      const r = readTokens({ ...defaultTokens(), [area.section]: o.value })
      assert.ok(r.ok, `${area.name}/${o.id}: ${r.ok ? '' : r.errors.join('; ')}`)
    }
  }
})

test('recommended: none without an overview, general reasons', () => {
  for (const area of AREAS) {
    for (const input of [{ base: defaultTokens(), locks: [] as string[] }, { base: defaultTokens(), locks: [] as string[], overview: null }]) {
      const opts = area.run(input)
      assert.equal(opts.filter((o) => o.recommended).length, 0, area.name)
      for (const o of opts) assert.ok(o.reasonKey.endsWith('.general'), `${area.name}/${o.id}`)
    }
  }
})

test('recommended: exactly one with an overview, even when no keyword matches', () => {
  const overviews = [
    overview({ purpose: 'zzz qqq', goals: ['xyzzy'] }),
    overview({ purpose: '사내 정산 대시보드', goals: ['정확한 숫자', '빠른 확인'] }),
    overview({ purpose: 'Landing page for a new brand', goals: ['brand expression'] }),
    overview({ purpose: '긴 글을 읽는 블로그', goals: ['가독성'] })
  ]
  for (const ov of overviews) {
    for (const theme of ['light', 'dark'] as const) {
      for (const area of AREAS) {
        const opts = area.run({ overview: ov, base: defaultTokens(theme), locks: [], theme })
        assert.equal(opts.filter((o) => o.recommended).length, 1, `${area.name} ${ov.purpose.value} ${theme}`)
      }
    }
  }
})

test('overview with only unknown or empty claims gives no basis', () => {
  const ov = { purpose: { value: '', source: 'unknown' as const }, goals: [{ value: '대시보드', source: 'unknown' as const }], audiences: [], designState: [] }
  for (const area of AREAS) assert.equal(area.run({ overview: ov, base: defaultTokens(), locks: [] }).filter((o) => o.recommended).length, 0)
})

test('keyword heuristics pick the fitting option and quote the basis', () => {
  const dash = overview({ purpose: '사내 대시보드', goals: ['정확한 숫자 확인', '빠른 업무'] })
  const i: RecommendInput = { overview: dash, base: defaultTokens(), locks: [] }
  assert.equal(rec(typeOptions(i)).id, 'data')
  assert.equal(rec(boxOptions(i)).id, 'compact')
  assert.equal(rec(ratioOptions(i)).id, 'dense')
  assert.equal(rec(colorStrategies(i)).id, 'neutral-accent', 'accuracy and speed favour a neutral base')
  const board = overview({ purpose: '지표 대시보드', goals: ['데이터 구분'] })
  assert.equal(rec(colorStrategies({ overview: board, base: defaultTokens(), locks: [] })).id, 'info-category')
  const t = rec(typeOptions(i))
  assert.ok(t.reasonKey.endsWith('.fit'))
  assert.match(String(t.params?.basis), /대시보드|정확/)

  const read = overview({ purpose: 'Long reading blog', goals: ['readability'] })
  const j: RecommendInput = { overview: read, base: defaultTokens(), locks: [] }
  assert.equal(rec(typeOptions(j)).id, 'reading')
  assert.equal(rec(boxOptions(j)).id, 'spacious')
  assert.equal(rec(ratioOptions(j)).id, 'calm')

  const brand = overview({ purpose: 'Landing page', goals: ['brand expression'], designState: ['브랜드 색 #E4572E 사용'] })
  const k: RecommendInput = { overview: brand, base: defaultTokens(), locks: [] }
  assert.equal(rec(typeOptions(k)).id, 'display')
  assert.equal(rec(shadowOptions(k)).id, 'layered')
  assert.equal(rec(ratioOptions(k)).id, 'bold')
  assert.equal(rec(boxOptions(k)).id, 'spacious')
  assert.equal(rec(colorStrategies(k)).id, 'keep-brand')

  const trust = overview({ purpose: '결제 서비스', goals: ['신뢰', '정확'] })
  assert.equal(rec(ratioOptions({ overview: trust, base: defaultTokens(), locks: [] })).id, 'calm')
  assert.equal(rec(shadowOptions({ overview: trust, base: defaultTokens(), locks: [] })).id, 'outline')

  const fonts = overview({ purpose: 'App', designState: ['글꼴은 Gmarket Sans'] })
  assert.equal(rec(typeOptions({ overview: fonts, base: brandBase(), locks: [] })).id, 'keep-fonts')
})

test('dark theme prefers border and surface contrast over shadows; buttons never get a shadow', () => {
  const ov = overview({ purpose: 'App', goals: ['편리함'] })
  const dark = shadowOptions({ overview: ov, base: defaultTokens('dark'), locks: [], theme: 'dark' })
  assert.equal(rec(dark).id, 'outline')
  const light = shadowOptions({ overview: ov, base: defaultTokens(), locks: [], theme: 'light' })
  assert.equal(rec(light).id, 'soft')
  for (const o of [...dark, ...light]) assert.equal(o.value.button, null, o.id)
  assert.ok(dark.some((o) => o.id === 'flat' && o.value.card === null && o.value.popover === null))
  // theme inferred from the base background when not given
  assert.equal(rec(shadowOptions({ overview: ov, base: defaultTokens('dark'), locks: [] })).id, 'outline')
})

test('ratio options always sum to 100', () => {
  const lockSets: string[][] = [[], ['ratio.accent'], ['ratio.background'], ['ratio.surface', 'ratio.accent'], ['ratio'], ['ratio.background', 'ratio.surface', 'ratio.accent']]
  for (const locks of lockSets) {
    for (const base of [defaultTokens(), brandBase()]) {
      const opts = ratioOptions({ base, locks, overview: overview({ purpose: 'x' }) })
      for (const o of opts) {
        const v = o.value
        assert.equal(v.background + v.surface + v.accent, 100, `${locks.join('+')} ${o.id}`)
        assert.ok(v.background >= 0 && v.surface >= 0 && v.accent >= 0)
        assert.equal(o.params?.background, v.background)
        assert.equal(o.params?.surface, v.surface)
        assert.equal(o.params?.accent, v.accent)
        for (const k of locks) {
          if (k === 'ratio') assert.deepEqual(v, base.ratio)
          else assert.equal(getPath({ ...base, ratio: v }, k), getPath(base, k), `${locks.join('+')} ${o.id} ${k}`)
        }
      }
    }
  }
  const free = ratioOptions({ base: defaultTokens(), locks: [] })
  assert.deepEqual(free.map((o) => o.value), [
    { background: 60, surface: 30, accent: 10 }, { background: 70, surface: 25, accent: 5 },
    { background: 45, surface: 45, accent: 10 }, { background: 55, surface: 25, accent: 20 }
  ])
})

test('locks: no option of any area changes a locked path', () => {
  const lockSets: string[][] = [
    ['colors.primary'], ['colors'], ['colors.background', 'colors.text', 'colors.danger'], ['ratio.accent'], ['ratio'],
    ['shadows.card'], ['shadows'], ['shadows.card.blur', 'shadows.popover'], ['type.body'], ['type.body.size', 'type.heading.family'], ['type'],
    ['box.radius'], ['box'], ['box.paddingX', 'box.maxWidth', 'box.density']
  ]
  const ovs = [null, overview({ purpose: '대시보드', goals: ['정확'] }), overview({ purpose: 'Landing', goals: ['brand'] })]
  for (const base of [defaultTokens(), defaultTokens('dark'), brandBase()]) {
    for (const locks of lockSets) {
      for (const ov of ovs) {
        for (const area of AREAS) {
          for (const o of area.run({ overview: ov, base, locks })) {
            const merged: DesignTokens = { ...base, [area.section]: o.value }
            for (const c of diffTokens(base, merged)) {
              assert.ok(!locks.some((l) => c.path === l || c.path.startsWith(l + '.')), `${area.name}/${o.id} changed ${c.path} under locks ${locks.join(',')}`)
            }
            // and the same through applyValue
            const viaApply = applyValue(base, area.section, o.value, locks)
            assert.deepEqual(viaApply.tokens[area.section], o.value, `${area.name}/${o.id} is stable under applyValue`)
            assert.deepEqual(viaApply.blocked, [])
          }
        }
      }
    }
  }
})

test('colour strategies: recommended passes every contrast check, status colours keep their meaning', () => {
  const ov = overview({ purpose: 'App', goals: ['편리함'] })
  const ch = (h: string, n: number): number => parseInt(h.slice(1 + n * 2, 3 + n * 2), 16)
  const dom = (h: string): number => [ch(h, 0), ch(h, 1), ch(h, 2)].indexOf(Math.max(ch(h, 0), ch(h, 1), ch(h, 2)))
  for (const base of [defaultTokens(), defaultTokens('dark'), brandBase()]) {
    const opts = colorStrategies({ overview: ov, base, locks: [] })
    const r = rec(opts)
    assert.ok(tokenChecks({ ...base, colors: r.value }).every((c) => c.status === 'pass'), `recommended ${r.id} passes`)
    for (const o of opts) {
      if (o.id !== 'keep-brand') assert.ok(tokenChecks({ ...base, colors: o.value }).every((c) => c.status === 'pass'), `${o.id} passes`)
      // status colours stay in their colour family: only their lightness may move
      for (const role of ['success', 'warning', 'danger', 'info'] as const) {
        assert.equal(dom(o.value[role]), dom(base.colors[role]), `${o.id} ${role} keeps its dominant channel`)
      }
    }
  }
})

test('colour strategies: keep-brand keeps the brand colour; neutral-accent keeps the one accent', () => {
  const base = brandBase()
  const opts = colorStrategies({ base, locks: [] })
  const byId = Object.fromEntries(opts.map((o) => [o.id, o]))
  assert.equal(byId['keep-brand'].value.primary, base.colors.primary)
  assert.equal(byId['keep-brand'].value.background, base.colors.background)
  assert.equal(byId['neutral-accent'].value.background, defaultTokens().colors.background)
  assert.equal(byId['neutral-accent'].value.primary, base.colors.primary)
  assert.notEqual(byId['info-category'].value.surface, base.colors.surface)
  // the weak muted text of the base was repaired
  assert.equal(tokenChecks({ ...base, colors: byId['keep-brand'].value }).find((c) => c.id === 'contrast.textMuted-background')?.status, 'pass')
  assert.deepEqual(opts.map((o) => o.id), ['neutral-accent', 'keep-brand', 'info-category'])
})

test('colour strategies: a locked colour is not repaired even when it fails', () => {
  const base = brandBase()
  const opts = colorStrategies({ overview: overview({ purpose: 'x' }), base, locks: ['colors.textMuted'] })
  for (const o of opts) assert.equal(o.value.textMuted, base.colors.textMuted)
  // none can pass because of the lock, one is still recommended
  assert.equal(opts.filter((o) => o.recommended).length, 1)
})

test('type options: Korean-capable families first, a mono numeric face for data', () => {
  for (const o of typeOptions({ base: defaultTokens(), locks: [] })) {
    for (const role of ['heading', 'body'] as const) {
      const f = o.value[role]
      assert.match(f.family, /Pretendard|Noto (Sans|Serif) KR/, `${o.id}.${role}`)
      assert.match(f.fallback, /Malgun Gothic|Batang|Nanum Myeongjo/, `${o.id}.${role} fallback`)
    }
  }
  const opts = typeOptions({ base: brandBase(), locks: [] })
  assert.match(opts.find((o) => o.id === 'data')?.value.numeric.family ?? '', /Mono/)
  assert.equal(opts.find((o) => o.id === 'keep-fonts')?.value.body.family, 'Gmarket Sans')
})

test('box options carry their numbers as params', () => {
  const opts = boxOptions({ base: defaultTokens(), locks: [] })
  assert.deepEqual(opts.map((o) => o.id), ['compact', 'comfortable', 'spacious'])
  assert.ok(opts[0].value.paddingY < opts[1].value.paddingY && opts[1].value.paddingY < opts[2].value.paddingY)
  assert.deepEqual(opts[1].params, { radius: 8, paddingX: 16, paddingY: 10, gap: 12 })
  // with a locked field the params show the real number
  for (const o of boxOptions({ base: brandBase(), locks: ['box.gap'] })) assert.equal(o.params?.gap, 5)
})
