// UI/UX tools: comparing and mixing design proposals (spec §7.1, §8.2). Pure (no Electron, no DOM, no fs).
//
// Rules:
//   - A locked path is never trusted to an agent: `respectLocks` copies every locked value back from the base
//     tokens, whatever the proposal says. `lockViolations` names what had to be put back.
//   - A mix takes one area (colours, ratio, shadows, type, box) from one source each: the base tokens or one
//     proposal. Locks are applied to every proposal before it is taken, so a mix never breaks a lock.
//   - A mock-up is an image of one proposal's values. A mix that equals none of the proposals that have a mock-up
//     is not shown by any image: `mockupStale` ("시안 재생성 필요").
import type { DesignProposal, DesignTokens, TokenChange, TokenPath } from './types'
import { deepEqual, diffTokens, isLocked, isPlain, type Plain } from './builtin'
import { tokenChecks } from './contrast'

export type Area = 'colors' | 'ratio' | 'shadows' | 'type' | 'box'
export const AREAS: readonly Area[] = ['colors', 'ratio', 'shadows', 'type', 'box']

/**
 * `proposed` with every locked value taken from `base`. A path counts as locked when it equals a lock or lies
 * below one (lock "colors" covers "colors.primary"). When only a part of a value is locked (lock
 * "shadows.card.blur") the free parts of the proposal stay; when the proposal replaced the value by something
 * of another shape (a shadow switched off), the whole value comes back from the base.
 */
function restore(base: unknown, proposed: unknown, path: string, locks: readonly TokenPath[]): unknown {
  if (path !== '' && isLocked(path, locks)) return base
  const prefix = path === '' ? '' : path + '.'
  if (!locks.some((l) => l.startsWith(prefix) && l !== path)) return proposed
  if (isPlain(base) && isPlain(proposed)) {
    const out: Plain = {}
    for (const k of [...Object.keys(base), ...Object.keys(proposed)]) {
      if (Object.prototype.hasOwnProperty.call(out, k)) continue
      const v = restore(base[k], proposed[k], prefix + k, locks)
      if (v !== undefined) out[k] = v
    }
    return out
  }
  return base
}

function restoreTokens(base: DesignTokens, tokens: DesignTokens, locks: readonly TokenPath[]): DesignTokens {
  const usable = locks.filter((l) => typeof l === 'string' && l !== '')
  if (usable.length === 0) return structuredClone(tokens)
  return structuredClone(restore(base, tokens, '', usable) as DesignTokens)
}

/**
 * The paths a proposal would change although they are locked: the leaf paths where its tokens differ from the
 * base and that are put back by `respectLocks`. Empty when the proposal keeps every lock.
 */
export function lockViolations(p: DesignProposal, base: DesignTokens, locks: TokenPath[]): TokenPath[] {
  const restored = restoreTokens(base, p.tokens, locks)
  return diffTokens(p.tokens, restored).map((c) => c.path)
}

/** The same proposal with the locked values restored from `base`. The input is not touched. */
export function respectLocks(p: DesignProposal, base: DesignTokens, locks: TokenPath[]): DesignProposal {
  return { ...p, tokens: restoreTokens(base, p.tokens, locks) }
}

export interface MixPick {
  area: Area
  /** A proposalId, or 'base' for the current values. */
  proposalId: string | 'base'
}

export interface Mix {
  tokens: DesignTokens
  /** Per area: the proposalId it comes from, or 'base'. */
  from: Record<Area, string>
  /** Against the base tokens. */
  changes: TokenChange[]
  /** No mock-up image shows these values: the image has to be made again. */
  mockupStale: boolean
}

/**
 * Builds one token set from per-area picks. An area without a pick, or whose proposal is unknown, stays at
 * the base value. Locked values come from the base whatever a proposal says.
 *
 * mockupStale: there is at least one proposal with a mock-up (previewKind 'mockup') and the mix differs from
 * every one of them. With no mock-up around, nothing can be stale.
 */
export function mixProposals(base: DesignTokens, proposals: DesignProposal[], picks: MixPick[], locks: TokenPath[]): Mix {
  const tokens = structuredClone(base)
  const from = { colors: 'base', ratio: 'base', shadows: 'base', type: 'base', box: 'base' } as Record<Area, string>
  for (const area of AREAS) {
    // the last pick for an area wins
    let pick: MixPick | undefined
    for (const p of picks) if (p.area === area) pick = p
    if (!pick || pick.proposalId === 'base') continue
    const src = proposals.find((p) => p.proposalId === pick!.proposalId)
    if (!src) continue
    const kept = restoreTokens(base, src.tokens, locks)
    ;(tokens as unknown as Plain)[area] = structuredClone((kept as unknown as Plain)[area])
    from[area] = src.proposalId
  }
  const withMockup = proposals.filter((p) => p.previewKind === 'mockup')
  const mockupStale = withMockup.length > 0 && withMockup.every((p) => !deepEqual(p.tokens, tokens))
  return { tokens, from, changes: diffTokens(base, tokens), mockupStale }
}

// ---------- the user's own proposal ----------

export interface UserProposalContext {
  projectId: string
  inputRevision: number
  overviewRevision?: number
  /** Text for the saved proposal; the caller passes translated text. Defaults are neutral identifiers. */
  name?: string
  rationale?: string
  /** Defaults to an id derived from the values, so the same mix has the same id. */
  proposalId?: string
}

function fmt(v: unknown): string {
  if (v === undefined) return '-'
  if (v === null) return 'none'
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** A mix as a proposal of the user's own: origin 'user', direction 'mix', sample preview, checks recomputed. */
export function userProposal(mix: ReturnType<typeof mixProposals>, ctx: UserProposalContext): DesignProposal {
  const p: DesignProposal = {
    proposalId: ctx.proposalId ?? `user-mix-${hash(JSON.stringify([mix.from, mix.tokens]))}`,
    projectId: ctx.projectId,
    inputRevision: ctx.inputRevision,
    direction: 'mix',
    name: ctx.name ?? 'mix',
    rationale: ctx.rationale ?? '',
    tokens: structuredClone(mix.tokens),
    changes: mix.changes.map((c) => `${c.path}: ${fmt(c.from)} -> ${fmt(c.to)}`),
    preserved: [],
    previewKind: 'sample',
    checks: tokenChecks(mix.tokens),
    origin: 'user'
  }
  if (ctx.overviewRevision !== undefined) p.overviewRevision = ctx.overviewRevision
  return p
}

/**
 * True when the proposal was made for an older overview than the current one ("이전 개요 기준"). A proposal
 * without a recorded revision, or no current overview, is not called outdated: nothing is known to compare.
 */
export function isOutdated(p: DesignProposal, currentOverviewRevision: number | undefined): boolean {
  return p.overviewRevision !== undefined && currentOverviewRevision !== undefined && p.overviewRevision < currentOverviewRevision
}
