// What the editor remembers between captures: the last drawing tool and each tool's last options.
// Stored as one JSON value in localStorage; anything missing or broken falls back to the defaults, and a
// storage that throws (private profile, quota) just means nothing is remembered. Pure (no DOM): tests/prefs.test.ts.

export type Tool = 'pen' | 'text' | 'arrow' | 'rect' | 'badge' | 'blur' | 'crop' | 'eraser'
export type TextStyle = 'outline' | 'plate' | 'plain'
/** Tools the editor reopens with. Crop and the eraser are one-off actions, never remembered as "the" tool. */
export type DrawTool = 'pen' | 'text' | 'arrow' | 'rect' | 'badge' | 'blur'

export interface StrokePrefs {
  color: string
  /** CSS px. */
  width: number
}
export interface BadgePrefs {
  color: string
  /** Diameter in CSS px, one of BADGE_SIZES. */
  size: number
}
export interface BlurPrefs {
  /** Pixel block in CSS px, one of BLUR_STRENGTHS (BLUR_SOLID = one block: the box becomes its average colour). */
  strength: number
}
export interface TextPrefs {
  color: string
  /** CSS font family; null = the system UI font. */
  font: string | null
  /** CSS px. */
  size: number
  style: TextStyle
  /** null = the font's own default weight. */
  bold: boolean | null
  italic: boolean
  /** Plate colour; null = automatic. */
  bg: string | null
  /** Plate opacity 0.1..1; null = the automatic plate's alpha. */
  bgOpacity: number | null
  /** Outline colour; null = translucent black. */
  outline: string | null
  shadow: boolean
}
export interface ToolPrefs {
  tool: DrawTool
  pen: StrokePrefs
  arrow: StrokePrefs
  rect: StrokePrefs
  badge: BadgePrefs
  blur: BlurPrefs
  text: TextPrefs
}

export const DEFAULT_COLOR = '#E5484D'
export const DEFAULT_WIDTH = 4
export const MIN_WIDTH = 1
export const MAX_WIDTH = 24
export const DEFAULT_TEXT_SIZE = 24
export const TEXT_SIZES = [14, 18, 24, 32, 48] as const
export const BADGE_SIZES = [18, 22, 30] as const
export const DEFAULT_BADGE_SIZE = 22
/** Larger than any capture: drawBlur's block covers the whole box. */
export const BLUR_SOLID = 100000
export const BLUR_STRENGTHS = [14, 28, BLUR_SOLID] as const
export const DEFAULT_BLUR = 14

export const PREFS_KEY = 'backseat.tools'
/** The pen colour of 0.4.x and earlier: seeds every tool's colour once. */
export const LEGACY_COLOR_KEY = 'backseat.color'

export function isTool(v: unknown): v is Tool {
  return v === 'pen' || v === 'text' || v === 'arrow' || v === 'rect' || v === 'badge' || v === 'blur' || v === 'crop' || v === 'eraser'
}
export function isDrawTool(v: unknown): v is DrawTool {
  return isTool(v) && v !== 'crop' && v !== 'eraser'
}
export function isTextStyle(v: unknown): v is TextStyle {
  return v === 'plate' || v === 'outline' || v === 'plain'
}

/** '#RRGGBB' (upper case) for '#rgb' / '#rrggbb', else null. */
export function hexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
  return `#${h.toUpperCase()}`
}

export function defaultPrefs(textFont: string | null, color = DEFAULT_COLOR): ToolPrefs {
  const stroke = (): StrokePrefs => ({ color, width: DEFAULT_WIDTH })
  return {
    tool: 'pen',
    pen: stroke(),
    arrow: stroke(),
    rect: stroke(),
    badge: { color, size: DEFAULT_BADGE_SIZE },
    blur: { strength: DEFAULT_BLUR },
    text: {
      color, font: textFont, size: DEFAULT_TEXT_SIZE, style: 'plate', bold: null, italic: false,
      bg: null, bgOpacity: null, outline: null, shadow: false
    }
  }
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const oneOf = <T extends number>(v: unknown, choices: readonly T[], fallback: T): T =>
  typeof v === 'number' && (choices as readonly number[]).includes(v) ? (v as T) : fallback
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

function strokeOf(v: unknown, d: StrokePrefs): StrokePrefs {
  const o = obj(v)
  const w = typeof o.width === 'number' && Number.isFinite(o.width) ? Math.round(o.width) : d.width
  return { color: hexColor(o.color) ?? d.color, width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)) }
}

function textOf(v: unknown, d: TextPrefs): TextPrefs {
  const o = obj(v)
  const op = typeof o.bgOpacity === 'number' && Number.isFinite(o.bgOpacity) ? Math.min(1, Math.max(0.1, o.bgOpacity)) : null
  return {
    color: hexColor(o.color) ?? d.color,
    font: o.font === null ? null : typeof o.font === 'string' && o.font.length > 0 && o.font.length < 64 ? o.font : d.font,
    size: oneOf(o.size, TEXT_SIZES, d.size as (typeof TEXT_SIZES)[number]),
    style: isTextStyle(o.style) ? o.style : d.style,
    bold: typeof o.bold === 'boolean' ? o.bold : null,
    italic: bool(o.italic, d.italic),
    bg: hexColor(o.bg),
    bgOpacity: op,
    outline: hexColor(o.outline),
    shadow: bool(o.shadow, d.shadow)
  }
}

/**
 * Parse stored prefs; every field is checked on its own, so one bad value never resets the rest.
 * `legacyColor` (the old single pen colour) is used as every tool's colour when nothing newer is stored.
 */
export function parsePrefs(raw: string | null, legacyColor: string | null, defaults: ToolPrefs): ToolPrefs {
  let data: unknown = null
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      data = null
    }
  }
  if (data === null) {
    const c = hexColor(legacyColor)
    return c ? defaultPrefs(defaults.text.font, c) : defaults
  }
  const o = obj(data)
  const badge = obj(o.badge)
  const blur = obj(o.blur)
  return {
    tool: isDrawTool(o.tool) ? o.tool : defaults.tool,
    pen: strokeOf(o.pen, defaults.pen),
    arrow: strokeOf(o.arrow, defaults.arrow),
    rect: strokeOf(o.rect, defaults.rect),
    badge: { color: hexColor(badge.color) ?? defaults.badge.color, size: oneOf(badge.size, BADGE_SIZES, defaults.badge.size as (typeof BADGE_SIZES)[number]) },
    blur: { strength: oneOf(blur.strength, BLUR_STRENGTHS, defaults.blur.strength as (typeof BLUR_STRENGTHS)[number]) },
    text: textOf(o.text, defaults.text)
  }
}

/** The subset of Storage the prefs need (tests pass a Map-backed fake). */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function loadPrefs(store: KeyValueStore | null, defaults: ToolPrefs, key = PREFS_KEY): ToolPrefs {
  if (!store) return defaults
  try {
    // The legacy pen colour only seeds the real profile, not the self-test's own key.
    return parsePrefs(store.getItem(key), key === PREFS_KEY ? store.getItem(LEGACY_COLOR_KEY) : null, defaults)
  } catch {
    return defaults
  }
}

/** false when the storage refused (nothing is remembered, the editor works on). */
export function savePrefs(store: KeyValueStore | null, prefs: ToolPrefs, key = PREFS_KEY): boolean {
  if (!store) return false
  try {
    store.setItem(key, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

/** The nearest allowed value (a text re-edited at an odd size, a width out of range). */
export function nearest<T extends number>(v: number, choices: readonly T[]): T {
  return choices.reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best), choices[0])
}
