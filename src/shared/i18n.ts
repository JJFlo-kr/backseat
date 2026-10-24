// UI language support shared by main, the MCP server and the renderers. Dependency-free: no Electron,
// no DOM at import time, no JSON imports. The message bundles live in src/locales/<locale>.json and are
// loaded by src/main/locales.ts (main / MCP); renderers get a ready-merged bundle in their init message.

/** Languages with a full message bundle. ko is the source language, en the fallback for everything else. */
export const LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'pt-BR', 'de', 'fr'] as const
export type Locale = (typeof LOCALES)[number]

/** Each language's own name, for the tray "Language" menu. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  de: 'Deutsch',
  fr: 'Français'
}

/** Missing keys fall back in this order after the locale itself. */
export const FALLBACK_CHAIN: readonly Locale[] = ['en', 'ko']

/** Flat key → template map, e.g. { "editor.tool.pen": "Pen" }. Templates use {name} placeholders. */
export type Messages = Record<string, string>
export type Params = Record<string, string | number>
export type Translate = (key: string, params?: Params) => string

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/**
 * Map a preference ('auto' or a Locale) and the system locale (Electron app.getLocale(), a BCP 47 tag
 * such as "ko", "en-US", "zh-HK", "pt-PT") to a supported Locale. Unknown languages become 'en'.
 */
export function resolveLocale(pref: string | undefined, systemLocale: string): Locale {
  if (pref && pref !== 'auto' && isLocale(pref)) return pref
  return matchSystemLocale(systemLocale)
}

export function matchSystemLocale(tag: string): Locale {
  const parts = (tag || '').replace(/_/g, '-').toLowerCase().split('-')
  const lang = parts[0]
  const rest = parts.slice(1)
  switch (lang) {
    case 'ko':
    case 'en':
    case 'ja':
    case 'es':
    case 'de':
    case 'fr':
      return lang
    case 'pt':
      return 'pt-BR' // pt-PT and every other Portuguese variant use the Brazilian bundle
    case 'zh':
      // Traditional script, or a region that writes it (Taiwan, Hong Kong, Macau)
      return rest.some((p) => p === 'hant' || p === 'tw' || p === 'hk' || p === 'mo') ? 'zh-TW' : 'zh-CN'
    default:
      return 'en'
  }
}

/** Replace {name} placeholders; unknown placeholders are left as they are. */
export function format(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

/** Every {name} placeholder in a template, sorted and de-duplicated (used by the bundle tests). */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
}

/**
 * Plural keys: when params.n is a number and the bundle has "<key>.one" / "<key>.other" (CLDR plural
 * categories of the locale), the matching one is used, then "<key>.other". Only keys that need it have
 * plural forms; every bundle has the same set of keys, so a language without singular forms simply
 * repeats the text.
 */
function pickKey(messages: Messages, key: string, locale: string, params?: Params): string {
  if (params && typeof params.n === 'number') {
    let cat = 'other'
    try {
      cat = new Intl.PluralRules(locale).select(params.n)
    } catch {
      /* unknown locale */
    }
    if (`${key}.${cat}` in messages) return `${key}.${cat}`
    if (`${key}.other` in messages) return `${key}.other`
  }
  return key
}

let warn: ((msg: string) => void) | null = null

/** Development builds report missing keys (once each) through this callback. */
export function setMissingKeyWarning(fn: ((msg: string) => void) | null): void {
  warn = fn
}

const warned = new Set<string>()

function missing(key: string, locale: string): void {
  if (!warn || warned.has(`${locale}|${key}`)) return
  warned.add(`${locale}|${key}`)
  warn(`[i18n] missing key "${key}" for ${locale}`)
}

/**
 * Merge bundles into one flat map: the locale's own text, then en, then ko for keys it lacks.
 * Reports (once) every key the locale does not have itself.
 */
export function mergeBundles(locale: Locale, bundles: Partial<Record<Locale, Messages>>): Messages {
  const own = bundles[locale] ?? {}
  const out: Messages = {}
  for (const l of [...FALLBACK_CHAIN].reverse()) Object.assign(out, bundles[l] ?? {})
  for (const key of Object.keys(out)) if (!(key in own)) missing(key, locale)
  return Object.assign(out, own)
}

/** A translate function bound to one locale and its merged messages. Unknown keys return the key. */
export function createTranslator(locale: string, messages: Messages): Translate {
  return (key, params) => {
    const k = pickKey(messages, key, locale, params)
    const template = messages[k]
    if (template === undefined) {
      missing(key, locale)
      return key
    }
    return format(template, params)
  }
}

// ---------- process-wide current language (main: tray, status messages; renderer: the whole window) ----------

let current: Locale = 'ko'
let currentT: Translate = createTranslator('ko', {})

export function setMessages(locale: Locale, messages: Messages): void {
  current = locale
  currentT = createTranslator(locale, messages)
}

export function getLocale(): Locale {
  return current
}

/** Translate with the current language. */
export function t(key: string, params?: Params): string {
  return currentT(key, params)
}

/**
 * Renderer helper: replace static text in a document. Elements carry the key in data-i18n (textContent),
 * data-i18n-title, data-i18n-placeholder and data-i18n-aria-label. Also sets <html lang>.
 */
export function applyDom(root: ParentNode & { documentElement?: HTMLElement }): void {
  const attr: [string, string][] = [
    ['i18nTitle', 'title'],
    ['i18nPlaceholder', 'placeholder'],
    ['i18nAriaLabel', 'aria-label']
  ]
  root.querySelectorAll<HTMLElement>('[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label]').forEach((el) => {
    const key = el.dataset.i18n
    if (key) el.textContent = t(key)
    for (const [data, name] of attr) {
      const k = el.dataset[data]
      if (k) el.setAttribute(name, t(k))
    }
  })
  if (root.documentElement) root.documentElement.lang = current
}
