// Pure font-stack helpers for the UI/UX design samples (no DOM, no Electron).
// The DOM part (is a family installed? does it draw Hangul?) lives in src/renderer/editor/uiux/samples.ts and
// feeds its answers into these functions. Fonts are never downloaded (spec 7.3).

/** CSS generic families (and the system keywords) that every browser can resolve, so they are always "available". */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong'
])

/** True for 'sans-serif', 'monospace', 'system-ui', … (case-insensitive, quotes ignored). */
export function isGenericFamily(name: string): boolean {
  return GENERIC_FAMILIES.has(stripQuotes(name).trim().toLowerCase())
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2) {
    const a = t[0]
    const b = t[t.length - 1]
    if ((a === '"' || a === "'") && a === b) return t.slice(1, -1)
  }
  return t
}

/** Split a CSS font-family list on commas that are not inside quotes. */
function splitFamilies(list: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of list) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/**
 * The requested family followed by its fallback stack, as plain family names: split on commas outside quotes,
 * quotes removed, whitespace collapsed, empty and repeated (case-insensitive) names dropped. Order is kept, so
 * index 0 is the requested family. Characters that cannot be part of a family name in a CSS value
 * (`;` `{` `}` `<` `>` and control characters) drop that entry.
 */
export function parseFamilyList(family: string, fallback: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [...splitFamilies(String(family ?? '')), ...splitFamilies(String(fallback ?? ''))]) {
    const unquoted = stripQuotes(raw)
    if (/[;{}<>\\\u0000-\u001f\u007f]/.test(unquoted)) continue
    const name = unquoted.replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * The first family of the list that is available. Generic families are always available; every other name is
 * asked of `isAvailable`. null when nothing in the list qualifies.
 */
export function firstAvailable(list: string[], isAvailable: (family: string) => boolean): string | null {
  for (const f of list) {
    if (isGenericFamily(f) || isAvailable(f)) return f
  }
  return null
}

/** A value for the CSS `font-family` property: non-generic names double-quoted (with `"` and `\` escaped), generics bare. */
export function formatFamilyList(list: string[]): string {
  return list
    .map((f) => (isGenericFamily(f) ? stripQuotes(f).trim().toLowerCase() : `"${f.replace(/["\\]/g, '\\$&')}"`))
    .join(', ')
}

/** Text widths (canvas measureText) of one sample string, with and without the family in front of two fallbacks. */
export interface WidthProbe {
  /** `"<name>", <fallbackA>` */
  withA: number
  /** `<fallbackA>` alone */
  baseA: number
  /** `"<name>", <fallbackB>` */
  withB: number
  /** `<fallbackB>` alone */
  baseB: number
}

const WIDTH_EPSILON = 0.01

/**
 * Does the family change how this text is drawn? A family that is not installed measures exactly like the
 * fallback behind it, whichever fallback that is. Comparing against two different generic fallbacks also catches a
 * family that happens to measure like one of them (e.g. an installed serif font against `serif`).
 */
export function widthsDiffer(p: WidthProbe): boolean {
  return Math.abs(p.withA - p.baseA) > WIDTH_EPSILON || Math.abs(p.withB - p.baseB) > WIDTH_EPSILON
}

/** Verdict from the two probes (Latin "AaBb123" and Hangul "가나다한글"). */
export interface FontProbeVerdict {
  /** The family is installed (or loaded): it changes the Latin or the Hangul text. */
  installed: boolean
  /** The family draws Hangul itself (the Hangul probe changes). False for an installed Latin-only family. */
  koreanGlyphs: boolean
}

export function judgeProbes(latin: WidthProbe, hangul: WidthProbe): FontProbeVerdict {
  const latinDiffers = widthsDiffer(latin)
  const koreanGlyphs = widthsDiffer(hangul)
  return { installed: latinDiffers || koreanGlyphs, koreanGlyphs }
}

export type FontRoleReport = {
  /** The family the user asked for (first name of the list; '' when the list is empty). */
  requested: string
  /** The first family of the stack that is actually available ('' when none, which cannot happen with a generic fallback). */
  used: string
  /** The requested family is not installed (always false when the request is a generic family). */
  missingRequested: boolean
  /** The used family draws Hangul with its own glyphs (generic families count as yes: the system supplies Hangul). */
  koreanGlyphs: boolean
}

/**
 * Build one role's report from the parsed list. `isAvailable` and `hasKorean` answer for non-generic names;
 * `hasKorean` is only asked of the family that ends up used.
 */
export function reportFor(
  list: string[],
  isAvailable: (family: string) => boolean,
  hasKorean: (family: string) => boolean
): FontRoleReport {
  const requested = list[0] ?? ''
  const used = firstAvailable(list, isAvailable) ?? ''
  const missingRequested = requested !== '' && !isGenericFamily(requested) && !isAvailable(requested)
  const koreanGlyphs = used === '' ? false : isGenericFamily(used) ? true : hasKorean(used)
  return { requested, used, missingRequested, koreanGlyphs }
}

/** True when the preview must say the requested family is not what is shown (missing, or shown with another name). */
export function shownDiffers(r: FontRoleReport): boolean {
  return r.requested !== '' && r.requested.toLowerCase() !== r.used.toLowerCase()
}
