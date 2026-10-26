// WCAG 2.x contrast maths and the checks computed from design tokens. Pure (no Electron, no DOM).
// Requirements used here, and nothing else: 4.5:1 for normal text, 3:1 for large text and non-text parts
// (the accent colour, status colours). A ratio is computed on the token values only; it says nothing about
// how a whole app looks (spec §7.4).
import type { Check, ColorRole, DesignTokens } from './types'

export const TEXT_MIN_RATIO = 4.5
export const NON_TEXT_MIN_RATIO = 3

const HEX6 = /^#[0-9a-fA-F]{6}$/
const HEX3 = /^#[0-9a-fA-F]{3}$/

/** '#RRGGBB' (or '#RGB') to 0..255 channels; null when the text is not a colour. */
export function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string') return null
  if (HEX6.test(hex)) return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  if (HEX3.test(hex)) return [parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), parseInt(hex[3] + hex[3], 16)]
  return null
}

export function toHex(r: number, g: number, b: number): string {
  const c = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

/** WCAG relative luminance, 0 (black) .. 1 (white); NaN for an invalid colour. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return NaN
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio 1..21 between two '#RRGGBB' colours (order does not matter); NaN for an invalid colour. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (Number.isNaN(la) || Number.isNaN(lb)) return NaN
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** "4.52:1". Cut (not rounded) to two decimals, so a ratio just under a limit never reads as the limit. */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return ''
  return `${(Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)}:1`
}

/** Linear mix in sRGB: t = 0 gives a, t = 1 gives b. Invalid input returns a. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return a
  const k = Math.max(0, Math.min(1, t))
  return toHex(x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k)
}

/** Near-black or white, whichever reads better on the given background. */
export function readableOn(bg: string): string {
  return contrastRatio('#FFFFFF', bg) >= contrastRatio('#111111', bg) ? '#FFFFFF' : '#111111'
}

export interface ContrastConstraint {
  against: string
  min: number
}

/**
 * Moves `fg` toward black or white, in 1 % steps and by the smaller step, until it reaches every constraint.
 * Returns `fg` unchanged when it already does, and also when no amount of darkening or lightening can.
 */
export function adjustForContrast(fg: string, constraints: ContrastConstraint[]): string {
  const ok = (c: string): boolean => constraints.every((k) => contrastRatio(c, k.against) >= k.min)
  if (ok(fg) || !parseHex(fg)) return fg
  let best: string | null = null
  let bestStep = Infinity
  for (const target of ['#000000', '#FFFFFF']) {
    for (let step = 1; step <= 100 && step < bestStep; step++) {
      const c = mix(fg, target, step / 100)
      if (ok(c)) { best = c; bestStep = step; break }
    }
  }
  return best ?? fg
}

interface PairSpec {
  id: string
  label: string
  fg: ColorRole
  bg: ColorRole
  min: number
}

/** The pairs checked on every token set, in display order. */
export const CONTRAST_PAIRS: readonly PairSpec[] = [
  { id: 'contrast.text-background', label: 'uiux.check.contrast.textBackground', fg: 'text', bg: 'background', min: TEXT_MIN_RATIO },
  { id: 'contrast.text-surface', label: 'uiux.check.contrast.textSurface', fg: 'text', bg: 'surface', min: TEXT_MIN_RATIO },
  { id: 'contrast.textMuted-background', label: 'uiux.check.contrast.textMutedBackground', fg: 'textMuted', bg: 'background', min: TEXT_MIN_RATIO },
  { id: 'contrast.textMuted-surface', label: 'uiux.check.contrast.textMutedSurface', fg: 'textMuted', bg: 'surface', min: TEXT_MIN_RATIO },
  { id: 'contrast.onPrimary-primary', label: 'uiux.check.contrast.onPrimaryPrimary', fg: 'onPrimary', bg: 'primary', min: TEXT_MIN_RATIO },
  { id: 'contrast.primary-background', label: 'uiux.check.contrast.primaryBackground', fg: 'primary', bg: 'background', min: NON_TEXT_MIN_RATIO },
  { id: 'contrast.success-background', label: 'uiux.check.contrast.successBackground', fg: 'success', bg: 'background', min: NON_TEXT_MIN_RATIO },
  { id: 'contrast.warning-background', label: 'uiux.check.contrast.warningBackground', fg: 'warning', bg: 'background', min: NON_TEXT_MIN_RATIO },
  { id: 'contrast.danger-background', label: 'uiux.check.contrast.dangerBackground', fg: 'danger', bg: 'background', min: NON_TEXT_MIN_RATIO },
  { id: 'contrast.info-background', label: 'uiux.check.contrast.infoBackground', fg: 'info', bg: 'background', min: NON_TEXT_MIN_RATIO }
]

/** Contrast checks for a token set. Computed here, so every status is 'pass' or 'fail', never 'unverified'. */
export function tokenChecks(t: DesignTokens): Check[] {
  return CONTRAST_PAIRS.map((p) => {
    const ratio = contrastRatio(t.colors[p.fg], t.colors[p.bg])
    const check: Check = { id: p.id, kind: 'visual', label: p.label, status: ratio >= p.min ? 'pass' : 'fail' }
    const note = formatRatio(ratio)
    if (note) check.note = note
    return check
  })
}
