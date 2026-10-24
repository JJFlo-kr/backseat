// Pure colour data + helpers (no DOM). Palettes are curated after Radix / Excalidraw /
// tldraw / Open Color style palettes.

export interface Palette {
  id: string
  labelKey: string
  /** '#RRGGBB', uppercase */
  colors: string[]
}

export const PALETTES: Palette[] = [
  {
    id: 'vivid',
    labelKey: 'palette.vivid',
    colors: [
      '#E5484D', '#F76B15', '#FFC53D', '#30A46C', '#12A594', '#0090FF',
      '#3E63DD', '#6E56CF', '#D6409F', '#FFFFFF', '#8B8D98', '#1C2024'
    ]
  },
  {
    id: 'calm',
    labelKey: 'palette.calm',
    colors: [
      '#E03131', '#E16919', '#F1AC4B', '#099268', '#4CB05E', '#4465E9',
      '#4BA1F1', '#AE3EC9', '#E085F4', '#F87777', '#9FA8B2', '#1D1D1D'
    ]
  },
  {
    id: 'pastel',
    labelKey: 'palette.pastel',
    colors: [
      '#FFC9C9', '#FFD8A8', '#FFEC99', '#B2F2BB', '#96F2D7', '#A5D8FF',
      '#BAC8FF', '#D0BFFF', '#FCC2D7', '#F1F3F5', '#DEE2E6', '#CED4DA'
    ]
  },
  {
    id: 'mono',
    labelKey: 'palette.mono',
    colors: [
      '#FFFFFF', '#F1F3F5', '#DEE2E6', '#ADB5BD', '#868E96',
      '#495057', '#343A40', '#212529', '#000000'
    ]
  }
]

export const RECENT_MAX = 6

const HEX6 = /^#?([0-9a-f]{6})$/i
const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i
const RGB = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i

/** '#abc' | 'abc' | '#AABBCC' | 'rgb(1,2,3)' -> '#AABBCC', else null */
export function normalizeHex(input: string): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  let m = HEX6.exec(s)
  if (m) return '#' + m[1].toUpperCase()
  m = HEX3.exec(s)
  if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase()
  m = RGB.exec(s)
  if (m) {
    const ch = [m[1], m[2], m[3]].map(Number)
    if (ch.some((n) => n > 255)) return null
    return '#' + ch.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  return null
}

/** Most-recent first, case-insensitive dedup, capped at `max`. Invalid colours are ignored. */
export function pushRecent(recent: readonly string[], color: string, max = RECENT_MAX): string[] {
  const c = normalizeHex(color)
  if (!c) return recent.slice(0, max)
  const out = [c]
  for (const r of recent) {
    const n = normalizeHex(r)
    if (n && n !== c && !out.includes(n)) out.push(n)
  }
  return out.slice(0, Math.max(0, max))
}

function rgbOf(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? '#000000'
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)]
}

/** -> 'rgba(r,g,b,a)', alpha clamped to 0..1 */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgbOf(hex)
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1
  return `rgba(${r},${g},${b},${a})`
}

function luminance(hex: string): number {
  const lin = rgbOf(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/** Readable text colour (black or white) on the given background, by WCAG contrast ratio. */
export function contrastText(hex: string): '#000000' | '#FFFFFF' {
  const l = luminance(hex)
  const onBlack = (l + 0.05) / 0.05
  const onWhite = 1.05 / (l + 0.05)
  return onBlack >= onWhite ? '#000000' : '#FFFFFF'
}
