// Validation of agent results that list findings or claims about project files: style_audit and
// implementation_report. Same rules as src/shared/uiux/validate.ts: bounded strings, project-relative evidence
// paths, "verified" needs evidence, nothing executed or fetched. Plain Node, no Electron.
import { PROVENANCES, type ImplementationReport, type Provenance, type StyleFinding } from '../../shared/uiux/types'
import { Reader, isObj, readEvidence, type Obj, type Result } from '../../shared/uiux/validate'

export const MAX_FINDINGS = 40
const MAX_REPORT_LIST = 40

/** `projectId` is optional in these results, but when it is there it must be the job's. */
function checkProject(r: Reader, v: Obj, projectId: string): void {
  if (v.projectId === undefined) return
  const pid = r.str(v.projectId, '$.projectId', 64)
  if (pid && pid !== projectId) r.err('$.projectId', `is for project "${pid}", not "${projectId}"`)
}

export function readStyleAudit(v: unknown, ctx: { projectId: string }): Result<StyleFinding[]> {
  const r = new Reader()
  if (!isObj(v)) return { ok: false, errors: ['$: expected an object'] }
  checkProject(r, v, ctx.projectId)
  const out: StyleFinding[] = []
  if (!Array.isArray(v.findings)) r.err('$.findings', 'expected a list')
  else {
    r.list(v.findings, '$.findings', (x, p) => {
      if (!isObj(x)) return r.err(p, 'expected an object')
      const source = typeof x.source === 'string' && (PROVENANCES as readonly string[]).includes(x.source) ? (x.source as Provenance) : null
      if (!source) r.err(`${p}.source`, `must be one of ${PROVENANCES.join(', ')}`)
      const finding: StyleFinding = {
        area: r.str(x.area, `${p}.area`, 120),
        issue: r.str(x.issue, `${p}.issue`, 600),
        source: source ?? 'unknown',
        suggestion: r.str(x.suggestion, `${p}.suggestion`, 600)
      }
      const ev = r.list(x.evidence, `${p}.evidence`, (e, q) => readEvidence(r, e, q), { max: 10 })
      if (ev.length) finding.evidence = ev
      if (finding.source === 'verified' && !ev.length) r.err(`${p}.evidence`, 'a verified statement needs evidence')
      out.push(finding)
    }, { max: MAX_FINDINGS })
  }
  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, value: out }
}

/**
 * The agent's account of a UI/UX change it carried out (implementation_report). It is a claim, not proof:
 * changed files are project-relative paths, every list is bounded, and nothing is opened or run.
 */
export function readImplementationReport(v: unknown, ctx: { projectId: string }): Result<ImplementationReport> {
  const r = new Reader()
  if (!isObj(v)) return { ok: false, errors: ['$: expected an object'] }
  checkProject(r, v, ctx.projectId)
  const max = { max: MAX_REPORT_LIST }
  const report: ImplementationReport = {
    summary: r.str(v.summary, '$.summary', 1500),
    changedFiles: r.list(v.changedFiles, '$.changedFiles', (y, p) => readEvidence(r, y, p), max),
    notDone: r.list(v.notDone, '$.notDone', (y, p) => r.str(y, p, 300), max),
    checksRun: r.list(v.checksRun, '$.checksRun', (y, p) => r.str(y, p, 300), max)
  }
  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, value: report }
}
