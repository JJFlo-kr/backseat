// The three agent job tools (spec §11): backseat_job_get, backseat_job_submit, backseat_job_status.
// Replies are a sentence in the brief language (translated keys, mcp.job.*) followed by JSON with stable English
// field names, so an agent reads them the same way in every language. Technical error lines (validator paths such
// as "$.purpose.value: must not be empty") are English, like the validators in src/shared/uiux/validate.ts.
// Plain Node: no Electron.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Translate } from '../../shared/i18n'
import type { JobType, UiuxJob } from '../../shared/uiux/types'
import type { UiuxStore } from '../uiux/store'
import { openJob, reportJobStatus, submitJobResult, MAX_NOTE, type SubmitOutcome } from './jobs'
import { resultSchema } from './jobspec'

type Reply = { content: { type: 'text'; text: string }[]; isError?: boolean }

const reply = (lines: string[], data: unknown, isError = false): Reply => ({
  content: [{ type: 'text', text: `${lines.join('\n')}\n\n${JSON.stringify(data, null, 2)}` }],
  ...(isError ? { isError: true } : {})
})

/** What the agent needs to know about a job (no internal file names). */
function jobMeta(job: UiuxJob): Record<string, unknown> {
  const m: Record<string, unknown> = {
    jobId: job.jobId,
    type: job.type,
    projectId: job.projectId,
    status: job.status,
    inputRevision: job.inputRevision,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt
  }
  if (job.fetchedAt) m.fetchedAt = job.fetchedAt
  if (job.skillId) m.skillId = job.skillId
  if (job.error) m.error = job.error
  return m
}

const headerLine = (tr: Translate, job: UiuxJob): string =>
  tr('mcp.job.header', { jobId: job.jobId, type: job.type, projectId: job.projectId, status: job.status, expiresAt: job.expiresAt })

const closedLine = (tr: Translate, job: UiuxJob): string =>
  tr(job.status === 'submitted' ? 'mcp.job.closed.submitted' : 'mcp.job.closed.other', { jobId: job.jobId, status: job.status })

const WHAT_KEYS: Record<JobType, string> = {
  project_overview: 'mcp.job.what.project_overview',
  skill_setup: 'mcp.job.what.skill_setup',
  capabilities: 'mcp.job.what.capabilities',
  design_proposal: 'mcp.job.what.design_proposal',
  style_audit: 'mcp.job.what.style_audit',
  implementation_report: 'mcp.job.what.implementation_report'
}

const GAP_KEYS = {
  summary: 'mcp.job.gap.summary',
  purpose: 'mcp.job.gap.purpose',
  purposeUnbacked: 'mcp.job.gap.purposeUnbacked',
  audiences: 'mcp.job.gap.audiences',
  workflows: 'mcp.job.gap.workflows',
  architecture: 'mcp.job.gap.architecture'
} as const

function submitReply(tr: Translate, out: SubmitOutcome, jobId: string): Reply {
  switch (out.kind) {
    case 'not_found':
      return reply([tr('mcp.job.notFound', { jobId })], { status: 'not_found', jobId }, true)
    case 'unsupported':
      return reply([tr('mcp.job.unsupportedType', { jobId, type: out.job.type })], { status: 'unsupported', ...jobMeta(out.job) }, true)
    case 'closed':
      return reply([closedLine(tr, out.job)], { status: out.job.status, accepted: false, ...jobMeta(out.job) }, true)
    case 'stale':
      return reply([tr('mcp.job.submit.stale', { expected: out.expected, got: out.got })], { status: 'stale', accepted: false, jobId, expectedInputRevision: out.expected, gotInputRevision: out.got }, true)
    case 'already_submitted':
      return reply([tr('mcp.job.submit.already', { jobId })], { status: 'already_submitted', accepted: false, ...jobMeta(out.job) }, true)
    case 'rejected':
      return reply(
        [tr('mcp.job.submit.rejected', { jobId, expiresAt: out.job.expiresAt }), ...out.errors.map((e) => `- ${e}`)],
        { status: 'rejected', accepted: false, jobId, expiresAt: out.job.expiresAt, errors: out.errors },
        true
      )
    case 'submitted': {
      const s = out.summary
      const data: Record<string, unknown> = { status: 'submitted', accepted: true, duplicate: out.duplicate, jobId, ...s }
      const lines: string[] = []
      if (out.duplicate) lines.push(tr('mcp.job.submit.duplicate', { jobId }))
      else if (s.completeness && !s.completeness.complete) {
        lines.push(tr('mcp.job.submit.incomplete', { jobId, expiresAt: out.job.expiresAt }))
        lines.push(...s.completeness.gaps.map((g) => `- ${tr(GAP_KEYS[g])}`))
      } else lines.push(tr('mcp.job.submit.accepted', { jobId }))
      if (s.type === 'implementation_report') lines.push(tr('mcp.job.submit.reportNote'))
      if (s.dedupedProposalIds?.length) lines.push(tr('mcp.job.submit.deduped', { ids: s.dedupedProposalIds.join(', ') }))
      return reply(lines, data)
    }
  }
}

export interface JobToolsDeps {
  store: UiuxStore
  /** Translator for the text the agent reads (called on every request, so a language change applies at once). */
  translator: () => Promise<Translate>
}

export function registerJobTools(server: McpServer, deps: JobToolsDeps): void {
  const { store } = deps

  server.registerTool(
    'backseat_job_get',
    {
      title: 'Get a Backseat UI/UX job',
      description:
        'Fetch a job the user created in Backseat (the pasted text gives its jobId): its type, project, deadline, input data, the JSON Schema of the result to submit and the rules to follow. Marks a pending job as fetched. A cancelled, expired, failed or finished job is reported as such and not reopened.',
      inputSchema: { jobId: z.string().describe('The job id Backseat gave you') }
    },
    async ({ jobId }) => {
      const tr = await deps.translator()
      const out = await openJob(store, jobId)
      if (out.kind === 'not_found') return reply([tr('mcp.job.notFound', { jobId })], { status: 'not_found', jobId }, true)
      if (out.kind === 'unsupported') return reply([tr('mcp.job.unsupportedType', { jobId, type: out.job.type })], { status: 'unsupported', ...jobMeta(out.job) }, true)
      if (out.kind === 'closed') return reply([headerLine(tr, out.job), closedLine(tr, out.job)], jobMeta(out.job))
      const job = out.job
      const head = [headerLine(tr, job)]
      if (job.status === 'rejected' && job.error) head.push(tr('mcp.job.lastError', { error: job.error }))
      head.push('', tr('mcp.job.rules'), '', tr(WHAT_KEYS[job.type]), '', tr('mcp.job.submitHow', { jobId: job.jobId, inputRevision: job.inputRevision }))
      return {
        content: [
          { type: 'text' as const, text: `${head.join('\n')}\n\n${JSON.stringify(jobMeta(job), null, 2)}` },
          { type: 'text' as const, text: `${tr('mcp.job.inputLabel')}\n${JSON.stringify(out.input ?? null, null, 2)}` },
          { type: 'text' as const, text: `${tr('mcp.job.schemaLabel')}\n${JSON.stringify(resultSchema(job.type), null, 2)}` }
        ]
      }
    }
  )

  server.registerTool(
    'backseat_job_submit',
    {
      title: 'Submit the result of a Backseat UI/UX job',
      description:
        'Send the result of a job fetched with backseat_job_get: jobId, the job\'s inputRevision and result (a JSON object following the schema from backseat_job_get). The result is checked; if it is not accepted the reply lists the errors and you may submit again before the deadline. Submitting the same result twice is harmless.',
      inputSchema: {
        jobId: z.string(),
        inputRevision: z.number().int().min(0).describe('The inputRevision of the job, as backseat_job_get shows it'),
        result: z.union([z.record(z.string(), z.unknown()), z.string()]).describe('The result as a JSON object (or JSON text) following the job\'s schema')
      }
    },
    async ({ jobId, inputRevision, result }) => {
      const tr = await deps.translator()
      const out = await submitJobResult(store, { jobId, inputRevision, result })
      return submitReply(tr, out, jobId)
    }
  )

  server.registerTool(
    'backseat_job_status',
    {
      title: 'Report progress or failure of a Backseat UI/UX job',
      description:
        'Tell Backseat that you are working on a job (in_progress) or cannot finish it (failed, with a short message). The reply shows the current status; if it is cancelled or expired, stop working on the job.',
      inputSchema: {
        jobId: z.string(),
        status: z.enum(['in_progress', 'failed']),
        message: z.string().max(2000).optional().describe(`A short note (up to ${MAX_NOTE} characters) the user can read`)
      }
    },
    async ({ jobId, status, message }) => {
      const tr = await deps.translator()
      const out = await reportJobStatus(store, { jobId, status, message })
      if (out.kind === 'not_found') return reply([tr('mcp.job.notFound', { jobId })], { status: 'not_found', jobId }, true)
      const meta = { ...jobMeta(out.job), recorded: out.recorded }
      if (out.recorded === 'progress') return reply([tr('mcp.job.status.progress', { jobId, status: out.job.status })], meta)
      if (out.recorded === 'failed') return reply([tr('mcp.job.status.failed', { jobId })], meta)
      return reply([closedLine(tr, out.job)], meta)
    }
  )
}
