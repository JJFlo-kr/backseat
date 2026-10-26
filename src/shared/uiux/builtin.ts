// Backseat's own design rules: default tokens, the recommendations for the five areas of spec §7.2 (colour
// strategy, colour ratio, shadow, type, box) and the token helpers behind direct adjustment (§8.3).
// Pure (no Electron, no DOM, no fs). Nothing user-visible is written here: options carry i18n keys plus
// params, the texts live in the locale bundles.
//
// Rules every recommendation follows:
//   - A locked path is never changed. Locked values are copied from `base` into every option.
//   - Recommended colours pass the contrast checks of contrast.ts (4.5:1 text, 3:1 non-text) whenever the
//     locks leave room for it.
//   - Exactly one option per area is `recommended` when the project overview gives a basis, none otherwise.
//     Without an overview the reasons say they are general defaults.
//   - Ratios are targets, never measurements. No golden ratio, no shadow on every button.
import {
  type BoxSpec, type ColorRatio, type ColorRole, type DesignTokens, type ProjectOverview,
  type ShadowSpec, type SkillRef, type TokenChange, type TokenPath, type TypeRole, type TypeSpec,
  COLOR_ROLES, SHADOW_ROLES, TYPE_ROLES
} from './types'
import {
  NON_TEXT_MIN_RATIO, TEXT_MIN_RATIO, adjustForContrast, contrastRatio, mix, readableOn, relativeLuminance, tokenChecks
} from './contrast'

export const BUILTIN_SKILL: SkillRef = { id: 'backseat-basic', name: 'Backseat basic design rules', source: 'builtin', version: '1' }

// ---------- defaults ----------

const SANS_FALLBACK = "'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', system-ui, sans-serif"
const SERIF_FALLBACK = "'Batang', 'Nanum Myeongjo', serif"
const MONO_FALLBACK = "'D2Coding', Consolas, 'Malgun Gothic', monospace"

function sans(size: number, weight: number, lineHeight: number): TypeSpec {
  return { family: 'Pretendard', fallback: SANS_FALLBACK, size, weight, lineHeight }
}
function mono(size: number, weight: number, lineHeight: number): TypeSpec {
  return { family: 'Roboto Mono', fallback: MONO_FALLBACK, size, weight, lineHeight }
}

/** Backseat's starting values. Every colour pair passes the contrast checks. */
export function defaultTokens(theme: 'light' | 'dark' = 'light'): DesignTokens {
  const dark = theme === 'dark'
  return {
    colors: dark
      ? {
          background: '#121216', surface: '#1C1C22', text: '#F2F2F5', textMuted: '#A9A9B6', primary: '#7C9CFF', onPrimary: '#0B0B10',
          border: '#34343E', success: '#4CC38A', warning: '#E0A030', danger: '#FF6B70', info: '#5AA2FF'
        }
      : {
          background: '#FFFFFF', surface: '#F5F5F7', text: '#1B1B1F', textMuted: '#5E5E6A', primary: '#2F5BEA', onPrimary: '#FFFFFF',
          border: '#DADAE0', success: '#1E8A55', warning: '#A86A00', danger: '#C9353A', info: '#2F80ED'
        },
    ratio: { background: 60, surface: 30, accent: 10 },
    shadows: dark
      ? {
          button: null,
          card: null,
          popover: { x: 0, y: 8, blur: 24, spread: 0, color: '#000000', opacity: 0.5 }
        }
      : {
          button: null,
          card: { x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.1 },
          popover: { x: 0, y: 8, blur: 24, spread: 0, color: '#000000', opacity: 0.16 }
        },
    type: { heading: sans(24, 700, 1.3), body: sans(15, 400, 1.6), numeric: mono(14, 500, 1.4) },
    box: { radius: 8, paddingX: 16, paddingY: 10, gap: 12, buttonMinWidth: 80, density: 'comfortable' }
  }
}

// ---------- token paths ----------

export type Plain = Record<string, unknown>
export const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v)
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
/** Optional leaves of BoxSpec: allowed as a path although they may be missing. */
const OPTIONAL_PATHS = new Set(['box.buttonMinWidth', 'box.maxWidth'])

const KEY_ORDER: Record<string, readonly string[]> = {
  '': ['colors', 'ratio', 'shadows', 'type', 'box'],
  colors: COLOR_ROLES,
  ratio: ['background', 'surface', 'accent'],
  shadows: SHADOW_ROLES,
  type: TYPE_ROLES,
  box: ['radius', 'paddingX', 'paddingY', 'gap', 'buttonMinWidth', 'maxWidth', 'density'],
  shadow: ['x', 'y', 'blur', 'spread', 'color', 'opacity'],
  typeSpec: ['family', 'fallback', 'size', 'weight', 'lineHeight']
}

function orderKeys(path: string, keys: string[]): string[] {
  const parts = path ? path.split('.') : []
  const list = parts.length === 0 ? KEY_ORDER[''] : parts.length === 1 ? KEY_ORDER[parts[0]] : parts[0] === 'shadows' ? KEY_ORDER.shadow : parts[0] === 'type' ? KEY_ORDER.typeSpec : undefined
  const rank = (k: string): number => { const i = list ? list.indexOf(k) : -1; return i < 0 ? 1000 : i }
  return [...new Set(keys)].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
}

/** The value at a dotted path, undefined when the path does not exist. */
export function getPath(tokens: DesignTokens, path: TokenPath): unknown {
  let cur: unknown = tokens
  for (const k of path.split('.')) {
    if (UNSAFE_KEYS.has(k) || !isPlain(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined
    cur = cur[k]
  }
  return cur
}

/** True when `path` is locked itself or lies below a locked path (lock "colors" covers "colors.primary"). */
export function isLocked(path: TokenPath, locks: readonly TokenPath[]): boolean {
  return locks.some((l) => path === l || path.startsWith(l + '.'))
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isPlain(a) && isPlain(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) if (!deepEqual(a[k], b[k])) return false
    return true
  }
  return false
}

function setIn(obj: unknown, parts: string[], value: unknown): unknown {
  const [head, ...rest] = parts
  const src: Plain = isPlain(obj) ? obj : {}
  const copy: Plain = { ...src }
  if (rest.length === 0) {
    if (value === undefined) delete copy[head]
    else copy[head] = value
  } else {
    copy[head] = setIn(src[head], rest, value)
  }
  return copy
}

/**
 * Sets one path without touching the input. A locked path, or one below a locked path, is left as it was and
 * reported in `blocked` when the new value would have changed it. When the path itself is free but a locked path
 * lies below it (setting "colors" while "colors.primary" is locked), the free parts change and the locked parts
 * stay. A path that does not exist in the tokens is ignored.
 */
export function applyValue(tokens: DesignTokens, path: TokenPath, value: unknown, locks: readonly TokenPath[]): { tokens: DesignTokens; blocked: TokenPath[] } {
  const blocked: TokenPath[] = []
  let next: unknown = tokens
  const known = (p: string): boolean => {
    const parts = p.split('.')
    if (parts.some((k) => UNSAFE_KEYS.has(k))) return false
    return getPath(next as DesignTokens, p) !== undefined || OPTIONAL_PATHS.has(p)
  }
  const walk = (p: string, v: unknown): void => {
    const cur = getPath(next as DesignTokens, p)
    if (isLocked(p, locks)) {
      if (!deepEqual(cur, v)) blocked.push(p)
      return
    }
    const below = locks.filter((l) => l.startsWith(p + '.'))
    if (below.length > 0 && isPlain(v) && isPlain(cur)) {
      for (const k of orderKeys(p, [...Object.keys(cur), ...Object.keys(v)])) {
        if (v[k] === undefined && !OPTIONAL_PATHS.has(`${p}.${k}`)) continue
        walk(`${p}.${k}`, v[k])
      }
      return
    }
    if (below.length > 0) {
      if (!deepEqual(cur, v)) blocked.push(...below)
      return
    }
    if (!known(p)) return
    if (deepEqual(cur, v)) return
    next = setIn(next, p.split('.'), v)
  }
  walk(path, value)
  return { tokens: next as DesignTokens, blocked: [...new Set(blocked)] }
}

/** Leaf paths whose values differ, in a fixed order (colors, ratio, shadows, type, box; roles in their own order). */
export function diffTokens(a: DesignTokens, b: DesignTokens): TokenChange[] {
  const out: TokenChange[] = []
  const walk = (path: string, x: unknown, y: unknown): void => {
    if (deepEqual(x, y)) return
    if (isPlain(x) && isPlain(y)) {
      for (const k of orderKeys(path, [...Object.keys(x), ...Object.keys(y)])) walk(path ? `${path}.${k}` : k, x[k], y[k])
      return
    }
    out.push({ path, from: x, to: y })
  }
  walk('', a, b)
  return out
}

// ---------- reading the overview ----------

type Signal =
  | 'accuracy' | 'speed' | 'readability' | 'longReading' | 'trust' | 'brand' | 'dashboard' | 'landing' | 'data' | 'work'
  | 'fonts' | 'brandColor'

// Keyword heuristics over the claim values, Korean and English. A hit only nudges the ranking and is quoted
// back to the user as the basis; it never overrides a lock.
const SIGNAL_RE: Record<Signal, RegExp> = {
  accuracy: /정확|정밀|오류 없|검증|accura|precis/i,
  speed: /빠른|빠르|빨리|속도|신속|효율|speed|\bfast|quick|efficien/i,
  readability: /가독|읽기\s*(쉬|편)|readab|legib/i,
  longReading: /긴\s*글|장문|독서|기사|문서|매뉴얼|블로그|뉴스|아티클|long[- ]?(form|read|text)|article|reading|manual|\bdocs?\b|blog|news/i,
  trust: /신뢰|안전|보안|금융|은행|의료|결제|trust|secur|\bsafe|financ|bank|medical|payment/i,
  brand: /브랜드|감성|개성|마케팅|identity|brand|expressive|marketing/i,
  dashboard: /대시보드|관리자|모니터링|dashboard|\badmin|monitor|analytics/i,
  landing: /랜딩|홍보|캠페인|소개 페이지|쇼케이스|landing|promo|campaign|showcase/i,
  data: /데이터|테이블|숫자|통계|수치|리포트|정산|재무|스프레드시트|(^|\s)표(를|가|로|에|는|의)?(\s|$|,|\.)|\bdata|table|numeric|statist|report|spreadsheet/i,
  work: /업무|생산성|내부용|전문가|사무|워크플로|\bworkflows?\b|\bwork\b|productiv|enterprise|internal tool|professional/i,
  fonts: /글꼴|폰트|서체|font|typeface/i,
  brandColor: /브랜드\s*(색|컬러)|대표\s*색|brand\s*colou?r|primary\s*colou?r|#[0-9a-f]{6}\b/i
}

interface Signals {
  /** Signal → the first claim text it was found in. */
  hit: Partial<Record<Signal, string>>
}

type OverviewIn = RecommendInput['overview']

function readSignals(o: OverviewIn | undefined): Signals | null {
  if (!o) return null
  const claims = [o.purpose, ...(o.goals ?? []), ...(o.audiences ?? []), ...(o.designState ?? [])]
  const texts = claims.filter((c) => c && c.source !== 'unknown' && typeof c.value === 'string' && c.value.trim()).map((c) => c.value.trim())
  if (texts.length === 0) return null
  const hit: Signals['hit'] = {}
  for (const sig of Object.keys(SIGNAL_RE) as Signal[]) {
    const text = texts.find((t) => SIGNAL_RE[sig].test(t))
    if (text !== undefined) hit[sig] = text.length > 60 ? text.slice(0, 59) + '…' : text
  }
  return { hit }
}

// ---------- options ----------

export interface Option<T> {
  id: string
  labelKey: string
  reasonKey: string
  params?: Record<string, string | number>
  value: T
  recommended?: boolean
}

export interface RecommendInput {
  overview?: Pick<ProjectOverview, 'purpose' | 'goals' | 'audiences' | 'designState'> | null
  /** Current values (project rules or defaults). */
  base: DesignTokens
  /** Locked paths must not change in any option's value. */
  locks: TokenPath[]
  theme?: 'light' | 'dark'
}

type Params = Record<string, string | number>

interface Cand<T> {
  id: string
  /** i18n key base: `<key>.label`, `<key>.general`, `<key>.fit`. */
  key: string
  value: T
  params?: Params
  base?: number
  weights?: Partial<Record<Signal | 'dark', number>>
  /** false = fails a check and is not recommended while another option passes. */
  ok?: boolean
}

function build<T>(cands: Cand<T>[], sig: Signals | null, dark: boolean): Option<T>[] {
  const scored = cands.map((c) => {
    let score = c.base ?? 0
    let basis: string | undefined
    for (const [k, w] of Object.entries(c.weights ?? {}) as [Signal | 'dark', number][]) {
      if (k === 'dark') { if (dark) score += w; continue }
      const text = sig?.hit[k]
      if (text === undefined) continue
      score += w
      if (w > 0 && basis === undefined) basis = text
    }
    return { c, score, basis }
  })
  let pick = -1
  if (sig && scored.length > 0) {
    const pool = scored.some((s) => s.c.ok !== false) ? scored.filter((s) => s.c.ok !== false) : scored
    const best = pool.reduce((a, b) => (b.score > a.score ? b : a))
    pick = scored.indexOf(best)
  }
  return scored.map((s, i) => {
    const o: Option<T> = {
      id: s.c.id,
      labelKey: `${s.c.key}.label`,
      reasonKey: s.basis !== undefined ? `${s.c.key}.fit` : `${s.c.key}.general`,
      value: s.c.value
    }
    const params: Params = { ...(s.c.params ?? {}), ...(s.basis !== undefined ? { basis: s.basis } : {}) }
    if (Object.keys(params).length) o.params = params
    if (i === pick) o.recommended = true
    return o
  })
}

function resolveTheme(i: RecommendInput): 'light' | 'dark' {
  if (i.theme) return i.theme
  const lum = relativeLuminance(i.base.colors.background)
  return lum < 0.2 ? 'dark' : 'light'
}

/** The section of `base` with the option's value laid over it, locked leaves copied from `base`. */
function lockSafe<K extends keyof DesignTokens>(i: RecommendInput, section: K, value: DesignTokens[K]): DesignTokens[K] {
  return getPath(applyValue(i.base, section, value, i.locks).tokens, section) as DesignTokens[K]
}

const HEX6 = /^#[0-9a-fA-F]{6}$/

// ---------- colour strategy ----------

type Colors = DesignTokens['colors']

/** Fixes colour pairs that miss their contrast limit by changing only unlocked roles; status colours keep their hue. */
function repairColors(c: Colors, locks: readonly TokenPath[], keepPrimary: boolean): Colors {
  const out: Colors = { ...c }
  const can = (r: ColorRole): boolean => !isLocked(`colors.${r}`, locks)
  if (!keepPrimary && can('primary')) {
    const cons = [{ against: out.background, min: NON_TEXT_MIN_RATIO }]
    if (!can('onPrimary')) cons.push({ against: out.onPrimary, min: TEXT_MIN_RATIO })
    out.primary = adjustForContrast(out.primary, cons)
  }
  if (can('onPrimary') && contrastRatio(out.onPrimary, out.primary) < TEXT_MIN_RATIO) out.onPrimary = readableOn(out.primary)
  if (!keepPrimary && can('primary') && contrastRatio(out.onPrimary, out.primary) < TEXT_MIN_RATIO) {
    out.primary = adjustForContrast(out.primary, [{ against: out.background, min: NON_TEXT_MIN_RATIO }, { against: out.onPrimary, min: TEXT_MIN_RATIO }])
  }
  for (const role of ['text', 'textMuted'] as const) {
    if (can(role)) out[role] = adjustForContrast(out[role], [{ against: out.background, min: TEXT_MIN_RATIO }, { against: out.surface, min: TEXT_MIN_RATIO }])
  }
  for (const role of ['success', 'warning', 'danger', 'info'] as const) {
    if (can(role)) out[role] = adjustForContrast(out[role], [{ against: out.background, min: NON_TEXT_MIN_RATIO }])
  }
  return out
}

/** Colour strategies: neutral base with one accent, keep the brand colours, or tint areas to tell them apart. */
export function colorStrategies(i: RecommendInput): Option<Colors>[] {
  const theme = resolveTheme(i)
  const dark = theme === 'dark'
  const sig = readSignals(i.overview)
  const base = i.base.colors
  const def = defaultTokens(theme).colors
  const finish = (raw: Colors, keepPrimary: boolean): { value: Colors; ok: boolean } => {
    const value = repairColors(lockSafe(i, 'colors', raw), i.locks, keepPrimary)
    const ok = tokenChecks({ ...i.base, colors: value }).every((c) => c.status === 'pass')
    return { value, ok }
  }
  const neutral = finish({ ...base, background: def.background, surface: def.surface, text: def.text, textMuted: def.textMuted, border: def.border }, false)
  const keep = finish({ ...base }, true)
  const tintA = dark ? 0.14 : 0.07
  const tintB = dark ? 0.3 : 0.22
  const tinted = finish({ ...base, surface: mix(base.background, base.primary, tintA), border: mix(base.background, base.primary, tintB) }, false)
  return build<Colors>([
    { id: 'neutral-accent', key: 'uiux.rec.color.neutralAccent', value: neutral.value, ok: neutral.ok, base: 1, weights: { dashboard: 0.5, data: 0.5, work: 1, accuracy: 1, speed: 1, trust: 1 } },
    { id: 'keep-brand', key: 'uiux.rec.color.keepBrand', value: keep.value, ok: keep.ok, weights: { brandColor: 3, brand: 2, landing: 1 } },
    { id: 'info-category', key: 'uiux.rec.color.infoCategory', value: tinted.value, ok: tinted.ok, weights: { dashboard: 2, data: 1.5 } }
  ], sig, dark)
}

// ---------- colour ratio ----------

function fitRatio(target: ColorRatio, base: ColorRatio, locks: readonly TokenPath[]): ColorRatio {
  if (isLocked('ratio', locks)) return { ...base }
  const keys = ['background', 'surface', 'accent'] as const
  const fixed = keys.filter((k) => isLocked(`ratio.${k}`, locks))
  const free = keys.filter((k) => !fixed.includes(k))
  if (free.length === 0) return { ...base }
  const rest = 100 - fixed.reduce((s, k) => s + base[k], 0)
  if (rest < 0) return { ...base }
  const out: ColorRatio = { ...base }
  const total = free.reduce((s, k) => s + target[k], 0)
  let used = 0
  free.forEach((k, idx) => {
    if (idx === free.length - 1) { out[k] = Math.max(0, rest - used); return }
    const v = Math.round(total > 0 ? (target[k] / total) * rest : rest / free.length)
    out[k] = v
    used += v
  })
  return out
}

/** Target shares of background, surface and accent. Heuristics, always summing to 100; never a measurement. */
export function ratioOptions(i: RecommendInput): Option<ColorRatio>[] {
  const sig = readSignals(i.overview)
  const mk = (target: ColorRatio): { value: ColorRatio; params: Params } => {
    const value = lockSafe(i, 'ratio', fitRatio(target, i.base.ratio, i.locks))
    return { value, params: { background: value.background, surface: value.surface, accent: value.accent } }
  }
  const balanced = mk({ background: 60, surface: 30, accent: 10 })
  const calm = mk({ background: 70, surface: 25, accent: 5 })
  const dense = mk({ background: 45, surface: 45, accent: 10 })
  const bold = mk({ background: 55, surface: 25, accent: 20 })
  return build<ColorRatio>([
    { id: 'balanced', key: 'uiux.rec.ratio.balanced', ...balanced, base: 1 },
    { id: 'calm', key: 'uiux.rec.ratio.calm', ...calm, weights: { readability: 2, longReading: 2, trust: 1, accuracy: 1, speed: 0.5 } },
    { id: 'dense', key: 'uiux.rec.ratio.dense', ...dense, weights: { dashboard: 2, data: 2, work: 1 } },
    { id: 'bold', key: 'uiux.rec.ratio.bold', ...bold, weights: { landing: 2, brand: 2 } }
  ], sig, resolveTheme(i) === 'dark')
}

// ---------- shadows ----------

type Shadows = DesignTokens['shadows']

/** Flat, outline, soft and layered. Buttons never get a shadow here; dark themes lean on borders and surface steps. */
export function shadowOptions(i: RecommendInput): Option<Shadows>[] {
  const theme = resolveTheme(i)
  const dark = theme === 'dark'
  const sig = readSignals(i.overview)
  const edge = HEX6.test(i.base.colors.border) ? i.base.colors.border.toUpperCase() : '#000000'
  const sh = (y: number, blur: number, spread: number, light: number, night: number): ShadowSpec => ({ x: 0, y, blur, spread, color: '#000000', opacity: dark ? night : light })
  const ring: ShadowSpec = { x: 0, y: 0, blur: 0, spread: 1, color: edge, opacity: 1 }
  const flat: Shadows = { button: null, card: null, popover: null }
  const outline: Shadows = { button: null, card: { ...ring }, popover: { ...ring } }
  const soft: Shadows = { button: null, card: sh(2, 8, 0, 0.1, 0.4), popover: sh(8, 24, 0, 0.16, 0.55) }
  const layered: Shadows = { button: null, card: sh(4, 12, -2, 0.1, 0.45), popover: sh(16, 40, -8, 0.2, 0.6) }
  const mk = (v: Shadows): Shadows => lockSafe(i, 'shadows', v)
  return build<Shadows>([
    { id: 'flat', key: 'uiux.rec.shadow.flat', value: mk(flat), weights: { dashboard: 1, data: 1, work: 1, speed: 1, dark: 1 } },
    { id: 'outline', key: 'uiux.rec.shadow.outline', value: mk(outline), weights: { trust: 1, accuracy: 1, readability: 0.5, dark: 3 } },
    { id: 'soft', key: 'uiux.rec.shadow.soft', value: mk(soft), base: 1, weights: { readability: 0.5, landing: 0.5 } },
    { id: 'layered', key: 'uiux.rec.shadow.layered', value: mk(layered), weights: { landing: 1.5, brand: 1.5 } }
  ], sig, dark)
}

// ---------- type ----------

type Types = Record<TypeRole, TypeSpec>

/** Type sets by use. Families that cover Korean come first; a missing font shows its fallback. */
export function typeOptions(i: RecommendInput): Option<Types>[] {
  const sig = readSignals(i.overview)
  const mk = (v: Types): Types => lockSafe(i, 'type', v)
  const balanced: Types = { heading: sans(24, 700, 1.3), body: sans(15, 400, 1.6), numeric: mono(14, 500, 1.4) }
  const reading: Types = { heading: sans(28, 700, 1.35), body: sans(17, 400, 1.75), numeric: sans(16, 500, 1.5) }
  const data: Types = { heading: sans(20, 700, 1.3), body: sans(14, 400, 1.5), numeric: mono(15, 600, 1.4) }
  const display: Types = {
    heading: { family: 'Noto Serif KR', fallback: SERIF_FALLBACK, size: 36, weight: 700, lineHeight: 1.25 },
    body: sans(16, 400, 1.65),
    numeric: sans(16, 600, 1.5)
  }
  const keepFonts: Types = {
    heading: { ...i.base.type.heading, size: balanced.heading.size, weight: balanced.heading.weight, lineHeight: balanced.heading.lineHeight },
    body: { ...i.base.type.body, size: balanced.body.size, weight: balanced.body.weight, lineHeight: balanced.body.lineHeight },
    numeric: { ...i.base.type.numeric, size: balanced.numeric.size, weight: balanced.numeric.weight, lineHeight: balanced.numeric.lineHeight }
  }
  return build<Types>([
    { id: 'balanced', key: 'uiux.rec.type.balanced', value: mk(balanced), base: 1 },
    { id: 'reading', key: 'uiux.rec.type.reading', value: mk(reading), weights: { readability: 2, longReading: 3 } },
    { id: 'data', key: 'uiux.rec.type.data', value: mk(data), weights: { data: 2, dashboard: 2, accuracy: 1, work: 1, speed: 0.5 } },
    { id: 'display', key: 'uiux.rec.type.display', value: mk(display), weights: { landing: 2, brand: 2 } },
    { id: 'keep-fonts', key: 'uiux.rec.type.keepFonts', value: mk(keepFonts), weights: { fonts: 3 } }
  ], sig, resolveTheme(i) === 'dark')
}

// ---------- box ----------

/** Compact, comfortable and spacious boxes. CSS px; no golden ratio. */
export function boxOptions(i: RecommendInput): Option<BoxSpec>[] {
  const sig = readSignals(i.overview)
  const mk = (v: BoxSpec): { value: BoxSpec; params: Params } => {
    const value = lockSafe(i, 'box', v)
    return { value, params: { radius: value.radius, paddingX: value.paddingX, paddingY: value.paddingY, gap: value.gap } }
  }
  const compact = mk({ radius: 6, paddingX: 12, paddingY: 6, gap: 8, buttonMinWidth: 64, density: 'compact' })
  const comfortable = mk({ radius: 8, paddingX: 16, paddingY: 10, gap: 12, buttonMinWidth: 80, density: 'comfortable' })
  const spacious = mk({ radius: 12, paddingX: 24, paddingY: 14, gap: 20, buttonMinWidth: 96, maxWidth: 720, density: 'spacious' })
  return build<BoxSpec>([
    { id: 'compact', key: 'uiux.rec.box.compact', ...compact, weights: { dashboard: 2, data: 2, work: 1, speed: 1 } },
    { id: 'comfortable', key: 'uiux.rec.box.comfortable', ...comfortable, base: 1 },
    { id: 'spacious', key: 'uiux.rec.box.spacious', ...spacious, weights: { landing: 2, longReading: 2, readability: 1, brand: 0.5 } }
  ], sig, resolveTheme(i) === 'dark')
}
