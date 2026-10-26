// Memo suggestions: short request phrases the user can insert while writing the note for the agent.
// Pure (no Electron, no DOM). A suggestion is an i18n key plus params; the text lives in the locale bundles, so
// this module cannot match on it. Instead each suggestion has a small keyword list (Korean and English) that
// tells whether the memo already says the same thing.
//
// Ranking, strongest first:
//   1. failing contrast checks of the current tokens
//   2. what the project fixed: locks, rules, skill
//   3. what the user drew: text -> type, rect / arrow -> layout and box, badge -> one element
//   4. general phrases
import type { Annotation } from '../types'
import type { Check, DesignRules, DesignTokens, SkillRef } from './types'
import { tokenChecks } from './contrast'

export interface Suggestion {
  id: string
  /** i18n key of the phrase to insert. */
  key: string
  params?: Record<string, string | number>
}

export interface SuggestContext {
  /** The text typed so far. */
  memo: string
  annotationKinds: Annotation['kind'][]
  /** Tokens in the panel right now; their contrast checks are computed when `checks` is not given. */
  tokens?: DesignTokens | null
  /** The project's design rules. */
  rules?: DesignRules | null
  skill?: SkillRef | null
  checks?: Check[]
}

type Tier = 'contrast' | 'rules' | 'annotation' | 'general'
type Params = Record<string, string | number>

interface Def {
  id: string
  tier: Tier
  /** Annotation kinds that bring this phrase up (tier 'annotation'). */
  kinds?: Annotation['kind'][]
  /** Lower-case words that mean the memo already covers this idea. */
  keywords: string[]
  /** null = does not apply in this context; otherwise the params (possibly none). */
  applies: (ctx: SuggestContext, known: Known) => Params | null | undefined
}

interface Known {
  checks: Check[]
  failing: Check[]
  locks: string[]
}

const CONTRAST_WORDS = ['대비', '명암', 'contrast', 'wcag', '4.5:1']
const SHADOW_WORDS = ['그림자', 'shadow', 'elevation']
const SPACING_WORDS = ['여백', '패딩', 'padding', 'margin']

const failingIn = (k: Known, ids: string[]): boolean => k.failing.some((c) => ids.some((id) => c.id === id))
const TEXT_IDS = ['contrast.text-background', 'contrast.text-surface', 'contrast.textMuted-background', 'contrast.textMuted-surface']
const NON_TEXT_IDS = ['contrast.primary-background', 'contrast.success-background', 'contrast.warning-background', 'contrast.danger-background', 'contrast.info-background']

const DEFS: Def[] = [
  // 1. failing contrast
  { id: 'contrast-button', tier: 'contrast', keywords: CONTRAST_WORDS, applies: (_c, k) => (failingIn(k, ['contrast.onPrimary-primary']) ? {} : null) },
  { id: 'contrast-text', tier: 'contrast', keywords: CONTRAST_WORDS, applies: (_c, k) => (failingIn(k, TEXT_IDS) ? {} : null) },
  { id: 'contrast-accent', tier: 'contrast', keywords: CONTRAST_WORDS, applies: (_c, k) => (failingIn(k, NON_TEXT_IDS) ? {} : null) },

  // 2. project rules
  {
    id: 'keep-brand-color', tier: 'rules', keywords: ['브랜드', 'brand', '대표색', 'primary'],
    applies: (_c, k) => (k.locks.some((l) => l === 'colors' || l === 'colors.primary') ? {} : null)
  },
  {
    id: 'keep-locked', tier: 'rules', keywords: ['잠근', '잠긴', '잠금', 'locked', 'lock'],
    applies: (_c, k) => (k.locks.length > 0 ? {} : null)
  },
  {
    id: 'card-shadow', tier: 'rules', keywords: SHADOW_WORDS,
    applies: (c) => (c.rules?.tokens.shadows.card ? {} : null)
  },
  {
    id: 'no-card-shadow', tier: 'rules', keywords: SHADOW_WORDS,
    applies: (c) => (c.rules && c.rules.tokens.shadows.card === null ? {} : null)
  },
  {
    id: 'keep-gap', tier: 'rules', keywords: ['간격', 'gap'],
    applies: (c) => (c.rules && Number.isFinite(c.rules.tokens.box.gap) ? { gap: c.rules.tokens.box.gap } : null)
  },
  {
    id: 'keep-font', tier: 'rules', keywords: ['글꼴', '폰트', 'font', 'typeface'],
    applies: (c) => (c.rules && c.rules.tokens.type.body.family ? { font: c.rules.tokens.type.body.family } : null)
  },
  {
    id: 'follow-skill', tier: 'rules', keywords: ['skill', '스킬'],
    applies: (c) => (c.skill && c.skill.source !== 'builtin' && c.skill.name ? { skill: c.skill.name } : null)
  },
  {
    id: 'follow-rules', tier: 'rules', keywords: ['디자인 규칙', '디자인 시스템', 'design rules', 'design system'],
    applies: (c) => (c.rules ? {} : null)
  },

  // 3. annotation kinds
  { id: 'text-size', tier: 'annotation', kinds: ['text'], keywords: ['글자 크기', '글씨 크기', '폰트 크기', '글꼴 크기', 'font size', 'text size', 'larger text'], applies: () => ({}) },
  { id: 'line-height', tier: 'annotation', kinds: ['text'], keywords: ['행간', '줄 간격', '줄간격', 'line height', 'line-height', 'leading'], applies: () => ({}) },
  { id: 'align-edges', tier: 'annotation', kinds: ['rect', 'arrow'], keywords: ['정렬', 'align'], applies: () => ({}) },
  { id: 'equal-spacing', tier: 'annotation', kinds: ['rect', 'arrow'], keywords: SPACING_WORDS, applies: () => ({}) },
  { id: 'only-numbered', tier: 'annotation', kinds: ['badge'], keywords: ['번호', '표시한 요소', 'only the numbered', 'numbered element'], applies: () => ({}) },
  { id: 'only-marked', tier: 'annotation', kinds: ['stroke'], keywords: ['표시한 부분', 'only the marked', 'marked part', 'marked area'], applies: () => ({}) },
  { id: 'keep-hidden', tier: 'annotation', kinds: ['blur'], keywords: ['가린', '블러', 'blur', 'hidden', 'mask'], applies: () => ({}) },

  // 4. general
  { id: 'align-numbers-right', tier: 'general', keywords: ['숫자', '오른쪽 정렬', 'right-align', 'right align', 'numbers', 'numeric', 'tabular'], applies: () => ({}) },
  { id: 'keep-wording', tier: 'general', keywords: ['글자 내용', '문구', 'wording', 'copy text'], applies: () => ({}) },
  { id: 'no-new-colors', tier: 'general', keywords: ['새 색', '새로운 색', '색을 추가', 'new color', 'new colour'], applies: () => ({}) },
  { id: 'same-radius', tier: 'general', keywords: ['둥글', '모서리', 'radius', 'rounded', 'corner'], applies: () => ({}) }
]

const TIER_ORDER: Tier[] = ['contrast', 'rules', 'annotation', 'general']

/** Which of the suggestion ids in DEFS exist: handy for locale tests. */
export const SUGGESTION_IDS: readonly string[] = DEFS.map((d) => d.id)

export const SUGGESTION_KEY_PREFIX = 'uiux.suggest.'

/** 'keep-brand-color' -> 'uiux.suggest.keepBrandColor' */
export function suggestionKey(id: string): string {
  return SUGGESTION_KEY_PREFIX + id.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
}

/**
 * Up to `max` (default 5) phrases for the memo, best first, without duplicates and without any phrase whose idea
 * the memo already contains.
 */
export function suggestions(ctx: SuggestContext, max = 5): Suggestion[] {
  const limit = Math.max(0, Math.floor(max))
  if (limit === 0) return []
  const memo = (ctx.memo ?? '').toLowerCase()
  const checks = ctx.checks ?? (ctx.tokens ? tokenChecks(ctx.tokens) : [])
  const known: Known = { checks, failing: checks.filter((c) => c.status === 'fail'), locks: ctx.rules?.locks ?? [] }
  const kindRank = new Map<string, number>()
  for (const k of ctx.annotationKinds ?? []) if (!kindRank.has(k)) kindRank.set(k, kindRank.size)

  const rows: { def: Def; params: Params; order: number }[] = []
  DEFS.forEach((def, index) => {
    if (def.keywords.some((w) => memo.includes(w))) return
    if (def.tier === 'annotation') {
      const ranks = (def.kinds ?? []).map((k) => kindRank.get(k)).filter((r): r is number => r !== undefined)
      if (ranks.length === 0) return
      const params = def.applies(ctx, known)
      if (params) rows.push({ def, params, order: Math.min(...ranks) * 100 + index })
      return
    }
    const params = def.applies(ctx, known)
    if (params) rows.push({ def, params, order: index })
  })
  rows.sort((a, b) => TIER_ORDER.indexOf(a.def.tier) - TIER_ORDER.indexOf(b.def.tier) || a.order - b.order)

  const out: Suggestion[] = []
  const seen = new Set<string>()
  for (const { def, params } of rows) {
    const key = suggestionKey(def.id)
    const sig = key + JSON.stringify(params)
    if (seen.has(def.id) || seen.has(sig)) continue
    seen.add(def.id)
    seen.add(sig)
    const s: Suggestion = { id: def.id, key }
    if (Object.keys(params).length) s.params = params
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}
