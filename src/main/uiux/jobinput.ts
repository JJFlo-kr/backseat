// What the app puts into a job for the agent (the "input" backseat_job_get returns) and the sentence that tells
// the agent about the job. Pure: no Electron, no fs (tests/uiux-app-jobs.test.ts).
//
// The input is data the app gives the agent, not instructions: the rules and the result schema come from the MCP
// server. Absolute paths (this PC's project folder, the saved captures) appear here and nowhere in exports.
import type { Translate } from '../../shared/i18n.ts'
import type {
  Claim, DesignRequest, DesignRules, JobRequest, JobType, ProjectOverview, ProjectProfile, SkillContext, SkillRef, TokenPath, UiuxJob
} from '../../shared/uiux/types.ts'

export const MIN_JOB_MINUTES = 1
export const MAX_JOB_MINUTES = 60
/** An agent that changes a UI takes longer than one that writes a list. */
export const REPORT_JOB_MINUTES = 60

export function clampMinutes(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  return Math.min(MAX_JOB_MINUTES, Math.max(MIN_JOB_MINUTES, n))
}

export interface JobInputContext {
  profile: ProjectProfile
  /** This PC's folder for the project, when linked. */
  folder: string | null
  overview: ProjectOverview | null
  rules: DesignRules | null
  skill?: SkillRef
  skillContext?: SkillContext | null
  req: JobRequest
  /** Absolute paths of the saved capture PNGs (design_proposal / style_audit). */
  imagePaths?: { capture?: string; annotated?: string }
  /** design_proposal: this request's number within the project (late answers to older requests are told apart). */
  requestNumber?: number
  /** implementation_report: the request the send carried. */
  designRequest?: DesignRequest
  memo?: string
  sessionDir?: string
}

/** Every user-confirmed statement of an overview as { field, value }: the agent must keep these. */
export function userConfirmed(o: ProjectOverview | null): { field: string; value: string }[] {
  if (!o) return []
  const out: { field: string; value: string }[] = []
  const one = (field: string, c: Claim): void => {
    if (c.source === 'user' && c.value.trim()) out.push({ field, value: c.value })
  }
  one('summary', o.summary)
  one('purpose', o.purpose)
  for (const [field, list] of [['goals', o.goals], ['audiences', o.audiences], ['stack', o.stack], ['designState', o.designState], ['designConstraints', o.designConstraints]] as const) {
    for (const c of list) one(field, c)
  }
  for (const w of o.workflows) if (w.source === 'user') out.push({ field: 'workflows', value: w.name })
  for (const n of o.architecture.nodes) if (n.source === 'user') out.push({ field: 'architecture', value: n.label })
  return out
}

const values = (list: readonly Claim[]): string[] => list.map((c) => c.value)

function overviewFacts(o: ProjectOverview | null): Record<string, unknown> | null {
  if (!o) return null
  return {
    revision: o.revision,
    basis: o.basis,
    summary: o.summary.value,
    purpose: o.purpose.value,
    goals: values(o.goals),
    audiences: values(o.audiences),
    stack: values(o.stack),
    designState: values(o.designState),
    designConstraints: values(o.designConstraints)
  }
}

function rulesFacts(r: DesignRules | null): Record<string, unknown> | null {
  if (!r) return null
  return {
    revision: r.revision,
    tokens: r.tokens,
    locks: r.locks,
    pageOverrides: r.pageOverrides,
    componentRules: r.componentRules,
    themes: r.themes,
    ...(r.skill ? { skill: r.skill } : {})
  }
}

/** What a design_proposal and a style_audit both look at: the rules, the values in use, the scope, the overview, the captures. */
function designFacts(ctx: JobInputContext, images: Record<string, string>): Record<string, unknown> {
  const locks: TokenPath[] = ctx.req.locks ?? ctx.rules?.locks ?? []
  return {
    rulesRevision: ctx.rules?.revision ?? 0,
    rules: rulesFacts(ctx.rules),
    current: { tokens: ctx.req.tokens ?? ctx.rules?.tokens ?? null, locks },
    scope: ctx.req.scope ?? { kind: 'all' },
    overview: overviewFacts(ctx.overview),
    images
  }
}

/** inputRevision of a job: the revision of what the answer is about. */
export function inputRevisionFor(type: JobType, ctx: Pick<JobInputContext, 'overview' | 'rules' | 'requestNumber' | 'designRequest'>): number {
  switch (type) {
    case 'project_overview':
    case 'skill_setup':
      return ctx.overview?.revision ?? 0
    case 'design_proposal':
      return ctx.requestNumber ?? 1
    case 'style_audit':
      return ctx.rules?.revision ?? 0
    case 'implementation_report':
      return ctx.designRequest?.overviewRevision ?? 0
    case 'capabilities':
      return 0
  }
}

export function buildJobInput(type: JobType, ctx: JobInputContext): Record<string, unknown> {
  const project: Record<string, unknown> = { projectId: ctx.profile.projectId, name: ctx.profile.name }
  if (ctx.profile.repo) project.repo = ctx.profile.repo
  if (ctx.folder) project.folder = ctx.folder
  const base: Record<string, unknown> = { project, overviewRevision: ctx.overview?.revision ?? 0 }
  const images: Record<string, string> = {}
  if (ctx.imagePaths?.capture) images.capture = ctx.imagePaths.capture
  if (ctx.imagePaths?.annotated) images.annotatedCapture = ctx.imagePaths.annotated

  switch (type) {
    case 'capabilities':
      return base
    case 'project_overview': {
      const keep = userConfirmed(ctx.overview)
      return {
        ...base,
        userConfirmed: keep,
        previous: ctx.overview ? { revision: ctx.overview.revision, basis: ctx.overview.basis, generatedAt: ctx.overview.generatedAt, unknowns: ctx.overview.unknowns, questions: ctx.overview.questions ?? [] } : null
      }
    }
    case 'skill_setup': {
      if (!ctx.skill) throw new Error('skill_setup needs a skill')
      const prev = ctx.skillContext
      return {
        ...base,
        skill: ctx.skill,
        overview: overviewFacts(ctx.overview),
        previous: prev ? { revision: prev.revision, fields: prev.fields, missing: prev.missing } : null,
        userConfirmed: prev ? Object.entries(prev.fields).filter(([, c]) => c.source === 'user').map(([field, c]) => ({ field, value: c.value })) : []
      }
    }
    case 'design_proposal':
      return {
        ...base,
        ...designFacts(ctx, images),
        requestNumber: ctx.requestNumber ?? 1,
        ...(ctx.skill ? { skill: ctx.skill } : {}),
        preserve: ctx.req.preserve ?? [],
        screenPurpose: ctx.req.screenPurpose ?? ''
      }
    case 'style_audit':
      return { ...base, ...designFacts(ctx, images) }
    case 'implementation_report': {
      const r = ctx.designRequest
      return {
        ...base,
        ...(ctx.sessionDir ? { sessionDir: ctx.sessionDir } : {}),
        request: r
          ? {
              createdAt: r.createdAt,
              ...(r.selectedProposalId ? { selectedProposalId: r.selectedProposalId } : {}),
              scope: r.scope,
              changes: r.changes.slice(0, 40),
              preserve: r.preserve,
              locks: r.locks,
              checks: r.checks.map((c) => ({ id: c.id, kind: c.kind, label: c.label })),
              ...(r.skill ? { skill: r.skill } : {}),
              ...(r.rulesRevision !== undefined ? { rulesRevision: r.rulesRevision } : {})
            }
          : null,
        ...(ctx.memo ? { memo: ctx.memo.slice(0, 1000) } : {})
      }
    }
  }
}

/**
 * The text the user hands to the agent: one line (a line break could submit a half-pasted terminal line), in the
 * brief language. It names the job and the two tools; everything else the agent reads from the job itself.
 */
export function buildRequestText(job: Pick<UiuxJob, 'jobId' | 'type'>, tr: Translate, opts: { skillName?: string } = {}): string {
  const params = { jobId: job.jobId, skill: opts.skillName ?? '' }
  if (job.type === 'design_proposal' && opts.skillName) return tr('uiux.job.request.design_proposal.skill', params)
  return tr(`uiux.job.request.${job.type}`, params)
}
