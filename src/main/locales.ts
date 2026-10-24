// The app's current UI language (config.locale, 'auto' = Windows display language) and the brief
// language (config.briefLocale). Main-process only; renderers get mergedMessages() in their init.
import { app } from 'electron'
import { BUNDLES } from '../shared/bundles'
import {
  createTranslator,
  mergeBundles,
  resolveLocale,
  setMessages,
  setMissingKeyWarning,
  type Locale,
  type Messages,
  type Translate
} from '../shared/i18n'
import { loadSettings } from './config'

if (!app.isPackaged) setMissingKeyWarning((msg) => console.warn(msg))

/** Test hook (self-test --selftest-locale=xx): overrides config.locale for this run without saving it. */
let override: Locale | null = null

export function setLocaleOverride(locale: Locale | null): void {
  override = locale
  applyLocale()
}

export function uiLocale(): Locale {
  return override ?? resolveLocale(loadSettings().locale, app.getLocale())
}

const merged = new Map<Locale, Messages>()

/** The full message map for a locale with en → ko fallbacks already filled in. */
export function mergedMessages(locale: Locale = uiLocale()): Messages {
  let m = merged.get(locale)
  if (!m) {
    m = mergeBundles(locale, BUNDLES)
    merged.set(locale, m)
  }
  return m
}

/** Make t() in the main process speak the current UI language (call after config.locale changes). */
export function applyLocale(): Locale {
  const l = uiLocale()
  setMessages(l, mergedMessages(l))
  return l
}

/** Language of brief.md and the pasted instruction line: the UI language, or English when config.briefLocale = 'en'. */
export function briefLocale(): Locale {
  if (briefOverride) return briefOverride === 'follow' ? uiLocale() : briefOverride
  return loadSettings().briefLocale === 'en' ? 'en' : uiLocale()
}

/** Test hook: 'follow' or a fixed Locale instead of config.briefLocale (null = use the config). */
let briefOverride: Locale | 'follow' | null = null

export function setBriefLocaleOverride(v: Locale | 'follow' | null): void {
  briefOverride = v
}

export function briefTranslator(): Translate {
  const l = briefLocale()
  return createTranslator(l, mergedMessages(l))
}

/** Whisper language name for each UI language (config.sttLanguage = 'auto'). */
const WHISPER_LANG: Record<Locale, string> = {
  ko: 'korean',
  en: 'english',
  ja: 'japanese',
  'zh-CN': 'chinese',
  'zh-TW': 'chinese',
  es: 'spanish',
  'pt-BR': 'portuguese',
  de: 'german',
  fr: 'french'
}

/** Speech languages offered in the tray, in menu order (Whisper language names). */
export const STT_LANGUAGES = ['korean', 'english', 'japanese', 'chinese', 'spanish', 'portuguese', 'german', 'french'] as const

/**
 * The Whisper language hint for a recording: config.sttLanguage 'auto' follows the UI language,
 * 'detect' lets Whisper detect it (undefined), anything else is passed through ('korean', 'english', …).
 */
export function sttLanguage(): string | undefined {
  const pref = loadSettings().sttLanguage
  if (pref === 'detect') return undefined
  if (!pref || pref === 'auto') return WHISPER_LANG[uiLocale()]
  return pref
}
