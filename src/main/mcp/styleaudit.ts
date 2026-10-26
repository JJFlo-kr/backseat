// Validation of a style_audit job result (agent → Backseat). Same rules as src/shared/uiux/validate.ts:
// bounded strings, project-relative evidence paths, "verified" needs evidence, nothing executed or fetched.
// Plain Node, no Electron.
import { PROVENANCES, type Evidence, type Provenance } from '../../shared/uiux/types'
import { isRelativePath, type Result } from '../../shared/uiux/validate'

export interface StyleFinding {
  /** Screen, component or file area the finding is about. */
  area: string
  issue: string
  source: Provenance
  evidence?: Evidence[]
  suggestion: string
}

export const MAX_FINDINGS = 40

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export function readStyleAudit(v: unknown, ctx: { projectId: string }): Result<StyleFinding[]> {
  const errors: string[] = []
  const err = (path: string, msg: string): void => {
    if (errors.length < 50) errors.push(`${path}: ${msg}`)
  }
  const str = (x: unknown, path: string, max: number, required = true): string => {
    if (typeof x !== 'string') {
      if (x !== undefined || required) err(path, 'expected a string')
      return ''
    }
    const s = x.trim()
    if (required && !s) err(path, 'must not be empty')
    if (s.length > max) err(path, `longer than ${max} characters`)
    return s.slice(0, max)
  }

  if (!isObj(v)) return { ok: false, errors: ['$: expected an object'] }
  if (v.projectId !== undefined) {
    const pid = str(v.projectId, '$.projectId', 64)
    if (pid && pid !== ctx.projectId) err('$.projectId', `is for project "${pid}", not "${ctx.projectId}"`)
  }
  const out: StyleFinding[] = []
  if (!Array.isArray(v.findings)) err('$.findings', 'expected a list')
  else {
    if (v.findings.length > MAX_FINDINGS) err('$.findings', `more than ${MAX_FINDINGS} items`)
    v.findings.slice(0, MAX_FINDINGS).forEach((x, i) => {
      const p = `$.findings[${i}]`
      if (!isObj(x)) return err(p, 'expected an object')
      const source = typeof x.source === 'string' && (PROVENANCES as readonly string[]).includes(x.source) ? (x.source as Provenance) : null
      if (!source) err(`${p}.source`, `must be one of ${PROVENANCES.join(', ')}`)
      const finding: StyleFinding = {
        area: str(x.area, `${p}.area`, 120),
        issue: str(x.issue, `${p}.issue`, 600),
        source: source ?? 'unknown',
        suggestion: str(x.suggestion, `${p}.suggestion`, 600)
      }
      const ev: Evidence[] = []
      if (x.evidence !== undefined) {
        if (!Array.isArray(x.evidence)) err(`${p}.evidence`, 'expected a list')
        else {
          if (x.evidence.length > 10) err(`${p}.evidence`, 'more than 10 items')
          x.evidence.slice(0, 10).forEach((e, j) => {
            const q = `${p}.evidence[${j}]`
            if (!isObj(e)) return err(q, 'expected an object')
            const path = str(e.path, `${q}.path`, 400)
            if (path && !isRelativePath(path)) err(`${q}.path`, 'must be a project-relative path')
            const item: Evidence = { path }
            const note = str(e.note, `${q}.note`, 200, false)
            if (note) item.note = note
            const at = str(e.checkedAt, `${q}.checkedAt`, 40, false)
            if (at) item.checkedAt = at
            const rev = str(e.revision, `${q}.revision`, 80, false)
            if (rev) item.revision = rev
            ev.push(item)
          })
        }
      }
      if (ev.length) finding.evidence = ev
      if (finding.source === 'verified' && !ev.length) err(`${p}.evidence`, 'a verified statement needs evidence')
      out.push(finding)
    })
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out }
}
