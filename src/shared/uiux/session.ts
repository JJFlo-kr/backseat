// The UI/UX panel's state for one capture (spec §4.2). Pure: tests/uiux-session.test.ts.
//   draft    — what the panel shows and the user edits; never sent by itself
//   applied  — a snapshot the user added to the request ("이 시안으로 요청" / "변경사항을 요청에 추가")
//   status   — off (nothing applied) · applied · stale (draft changed after applying: "변경사항 미반영")
// Closing the panel changes none of this. Switching project releases what was applied (spec §9).
import { diffTokens } from './builtin'
import {
  UIUX_SCHEMA_VERSION, type Check, type DesignRequest, type DesignRules, type DesignScope, type DesignTokens,
  type ProjectOverview, type SkillRef, type TokenPath
} from './types'

export interface UiuxDraft {
  tokens: DesignTokens
  scope: DesignScope
  /** What must not change, in the user's words. */
  preserve: string[]
  locks: TokenPath[]
  selectedProposalId?: string
  skill?: SkillRef
}

export interface UiuxSession {
  projectId: string | null
  /** The values the draft started from (project rules or defaults): changes are measured against them. */
  base: DesignTokens
  draft: UiuxDraft
  draftRev: number
  applied: UiuxDraft | null
  appliedRev: number | null
  /** appliedRev that was last sent, so later edits are told apart from what went out. */
  sentRev: number | null
}

export type UiuxStatus = 'off' | 'applied' | 'stale'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function newSession(base: DesignTokens, projectId: string | null, locks: TokenPath[] = []): UiuxSession {
  return {
    projectId,
    base: clone(base),
    draft: { tokens: clone(base), scope: { kind: 'all' }, preserve: [], locks: [...locks] },
    draftRev: 0,
    applied: null,
    appliedRev: null,
    sentRev: null
  }
}

export function status(s: UiuxSession): UiuxStatus {
  if (!s.applied) return 'off'
  return s.appliedRev === s.draftRev ? 'applied' : 'stale'
}

/** Applied and sent, and nothing applied changed since. */
export function isSent(s: UiuxSession): boolean {
  return s.applied !== null && s.sentRev !== null && s.sentRev === s.appliedRev
}

export function editDraft(s: UiuxSession, patch: Partial<UiuxDraft>): UiuxSession {
  const draft: UiuxDraft = { ...s.draft, ...clone(patch) }
  // A proposal stays "selected" only with its own values: new values without a proposal id drop it.
  if (patch.tokens && !('selectedProposalId' in patch)) delete draft.selectedProposalId
  return { ...s, draft, draftRev: s.draftRev + 1 }
}

/** Add the draft to the request (also "요청에 반영" after further edits). */
export function apply(s: UiuxSession): UiuxSession {
  return { ...s, applied: clone(s.draft), appliedRev: s.draftRev }
}

/** "해제": nothing goes with the send any more; the draft stays editable. */
export function release(s: UiuxSession): UiuxSession {
  return { ...s, applied: null, appliedRev: null }
}

/** Throw away edits made after applying: the draft returns to what is applied. */
export function discardDraftChanges(s: UiuxSession): UiuxSession {
  if (!s.applied) return s
  return { ...s, draft: clone(s.applied), draftRev: s.draftRev + 1, appliedRev: s.draftRev + 1 }
}

export function markSent(s: UiuxSession): UiuxSession {
  return s.applied ? { ...s, sentRev: s.appliedRev } : s
}

/** Another project: its rules become the base and anything applied for the previous one is released. */
export function switchProject(s: UiuxSession, projectId: string | null, base: DesignTokens, locks: TokenPath[] = []): UiuxSession {
  return { ...newSession(base, projectId, locks), draftRev: s.draftRev + 1 }
}

/** Annotation ids the scope points at that no longer exist ("연결할 영역 없음"). */
export function missingAnnotations(scope: DesignScope, existingIds: readonly string[]): string[] {
  if (scope.kind !== 'annotations') return []
  const have = new Set(existingIds)
  return (scope.annotationIds ?? []).filter((id) => !have.has(id))
}

export interface RequestContext {
  projectName: string
  overview?: ProjectOverview | null
  rules?: DesignRules | null
  checks: Check[]
  /** Package-relative name of a chosen mock-up, when one goes along. */
  previewRef?: string
  conflicts?: string[]
  now?: Date
}

/** The snapshot a send carries. Only what is applied; null when nothing is. */
export function buildRequest(s: UiuxSession, ctx: RequestContext): DesignRequest | null {
  const a = s.applied
  if (!a || !s.projectId) return null
  const req: DesignRequest = {
    schemaVersion: UIUX_SCHEMA_VERSION,
    projectId: s.projectId,
    projectName: ctx.projectName,
    scope: clone(a.scope),
    resolved: clone(a.tokens),
    changes: diffTokens(s.base, a.tokens),
    preserve: [...a.preserve],
    locks: [...a.locks],
    checks: clone(ctx.checks),
    createdAt: (ctx.now ?? new Date()).toISOString()
  }
  const o = ctx.overview
  if (o) {
    req.overviewRevision = o.revision
    req.overviewBasis = o.basis
    if (o.purpose.value || o.summary.value) req.purposeSummary = [o.summary.value, o.purpose.value].filter(Boolean).join(' — ').slice(0, 400)
  }
  if (ctx.rules) req.rulesRevision = ctx.rules.revision
  if (a.selectedProposalId) req.selectedProposalId = a.selectedProposalId
  if (a.skill) req.skill = clone(a.skill)
  if (ctx.previewRef) req.previewRef = ctx.previewRef
  if (ctx.conflicts?.length) req.conflicts = [...ctx.conflicts]
  return req
}
