// UI/UX guidance in a session package (spec §10.1): which files it adds, how the mock-up PNG is validated, and the
// brief.md section an agent reads. Pure logic (no Electron, no fs): sessions.ts writes what this decides, brief.ts
// appends the text. All user-visible text is a message key (brief language).
import type { Annotation, ExportPayload } from '../../shared/types.ts'
import type { Translate } from '../../shared/i18n.ts'
import { isObj } from '../../shared/uiux/validate.ts'
import { BUILTIN_SKILL } from '../../shared/uiux/builtin.ts'
import { COLOR_ROLES, SHADOW_ROLES, TYPE_ROLES, type Check, type DesignRequest, type DesignScope } from '../../shared/uiux/types.ts'

export const DESIGN_REQUEST_FILE = 'design-request.json'
export const DESIGN_PREVIEW_FILE = 'design-preview.png'

/** Mock-up size limit (decoded bytes) and the accepted pixel range per side. */
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024
export const PREVIEW_MIN_SIDE = 1
export const PREVIEW_MAX_SIDE = 10000

const PNG_PREFIX = 'data:image/png;base64,'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export type PreviewRejection = 'prefix' | 'encoding' | 'tooLarge' | 'signature' | 'header' | 'dimensions'

export type PreviewCheck = { ok: true; bytes: Buffer; width: number; height: number } | { ok: false; reason: PreviewRejection }

/**
 * Strict check of a mock-up data URL: exact `data:image/png;base64,` prefix, plain base64, decoded size within
 * PREVIEW_MAX_BYTES, the 8-byte PNG signature, an IHDR chunk right after it, and width/height within 1..10000.
 * The check is on bytes only; nothing is rendered or executed.
 */
export function checkPreviewPng(dataUrl: unknown): PreviewCheck {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) return { ok: false, reason: 'prefix' }
  const b64 = dataUrl.slice(PNG_PREFIX.length)
  // Size from the text first, so an oversized string is never decoded.
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  if (Math.floor((b64.length * 3) / 4) - padding > PREVIEW_MAX_BYTES) return { ok: false, reason: 'tooLarge' }
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return { ok: false, reason: 'encoding' }
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length > PREVIEW_MAX_BYTES) return { ok: false, reason: 'tooLarge' }
  if (bytes.length < 8 || PNG_SIGNATURE.some((v, i) => bytes[i] !== v)) return { ok: false, reason: 'signature' }
  // IHDR: length 13, type "IHDR", width, height (big endian).
  if (bytes.length < 24 || bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') return { ok: false, reason: 'header' }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const inRange = (n: number): boolean => n >= PREVIEW_MIN_SIDE && n <= PREVIEW_MAX_SIDE
  if (!inRange(width) || !inRange(height)) return { ok: false, reason: 'dimensions' }
  return { ok: true, bytes, width, height }
}

/** True when the send carries applied UI/UX guidance: such a send is a request, never a plain picture. */
export function hasUiuxGuidance(payload: Pick<ExportPayload, 'uiux'>): boolean {
  const request = payload.uiux?.request as unknown
  return typeof request === 'object' && request !== null
}

export interface DesignFiles {
  /** What goes into design-request.json: the request as given, with previewRef set only when the file is written. */
  request: DesignRequest
  /** design-preview.png bytes; only when the mock-up passed the check. */
  preview?: Buffer
  /** Why a mock-up that was sent was not written (kept in meta.json). */
  previewRejected?: PreviewRejection
}

/** Decide the UI/UX files of a package. Never references a file that will not be there. */
export function designFiles(payload: Pick<ExportPayload, 'uiux'>): DesignFiles | null {
  const uiux = payload.uiux
  if (!uiux || !hasUiuxGuidance(payload)) return null
  const { previewRef: _given, ...rest } = uiux.request
  void _given
  const dataUrl = uiux.previewPngDataUrl
  if (dataUrl === undefined || dataUrl === '') return { request: rest }
  const check = checkPreviewPng(dataUrl)
  if (!check.ok) return { request: rest, previewRejected: check.reason }
  return { request: { ...rest, previewRef: DESIGN_PREVIEW_FILE }, preview: check.bytes }
}

// ---------- brief.md section ----------

export interface UiuxBriefOptions {
  /** File name of the written mock-up (design-preview.png); absent = there is none in the package. */
  previewFileName?: string
  /** A mock-up was sent but could not be included. */
  previewMissing?: boolean
  /** implementation_report job of this send: the agent reports what it changed there. */
  reportJobId?: string
}

const MAX_TEXT = 240

/** One line, no markup-looking angle brackets, bounded: guidance text is data for the agent, never layout. */
function clean(v: unknown): string {
  const s = String(v ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' / ')
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .trim()
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
function badge(i: number): string {
  return i < CIRCLED.length ? CIRCLED[i] : `(${i + 1})`
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function strs(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}
const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '?')

function formatValue(v: unknown, tr: Translate): string {
  if (v === null) return tr('brief.uiux.value.none')
  if (v === undefined) return tr('brief.uiux.unset')
  if (typeof v === 'string') return clean(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return clean(JSON.stringify(v))
  } catch {
    return '?'
  }
}

function scopeLine(scope: unknown, annotations: Annotation[], tr: Translate): string {
  const s = isObj(scope) ? (scope as Partial<DesignScope>) : {}
  if (s.kind === 'component') {
    const known = ['button', 'card', 'input', 'table']
    const name = typeof s.component === 'string' && known.includes(s.component) ? tr(`brief.uiux.component.${s.component}`) : '?'
    return tr('brief.uiux.scope.component', { component: name })
  }
  if (s.kind === 'annotations') {
    const refs = strs(s.annotationIds).map((id) => {
      const i = annotations.findIndex((a) => a.id === id)
      return i >= 0 ? badge(i) : tr('brief.uiux.scope.unlinked')
    })
    return tr('brief.uiux.scope.annotations', { refs: refs.length > 0 ? refs.join(', ') : tr('brief.uiux.scope.unlinked') })
  }
  return tr('brief.uiux.scope.all')
}

function checkLines(checks: Check[], tr: Translate): string[] {
  return checks.map((c) => {
    const status = tr(`brief.uiux.status.${c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'fail' : 'unverified'}`)
    // Backseat's own checks carry a message key; an agent's check label is its own text.
    const label = c.label.startsWith('uiux.') ? tr(c.label) : c.label
    return `- ${clean(label)} — ${status}${c.note ? `: ${clean(c.note)}` : ''}`
  })
}

/** `only`: the areas to list (colors, ratio, shadows, type, box); null = all. */
function aimLines(resolved: unknown, tr: Translate, only: Set<string> | null = null): string[] {
  if (!isObj(resolved)) return []
  const out: string[] = []
  const want = (area: string): boolean => !only || only.has(area)
  const colors = want('colors') && isObj(resolved.colors) ? resolved.colors : null
  if (colors) {
    const parts = COLOR_ROLES.filter((role) => typeof colors[role] === 'string').map((role) => `${role} ${clean(colors[role])}`)
    if (parts.length > 0) out.push(`- ${tr('brief.uiux.aim.colors', { list: parts.join(', ') })}`)
  }
  const ratio = want('ratio') && isObj(resolved.ratio) ? resolved.ratio : null
  if (ratio) out.push(`- ${tr('brief.uiux.aim.ratio', { background: num(ratio.background), surface: num(ratio.surface), accent: num(ratio.accent) })}`)
  const shadows = want('shadows') && isObj(resolved.shadows) ? resolved.shadows : null
  if (shadows) {
    const parts = SHADOW_ROLES.filter((role) => role in shadows).map((role) => {
      const sh = shadows[role]
      if (!isObj(sh)) return `${role} ${tr('brief.uiux.value.none')}`
      const opacity = typeof sh.opacity === 'number' ? Math.round(sh.opacity * 100) : '?'
      return `${role} ${num(sh.x)} ${num(sh.y)} ${num(sh.blur)} ${num(sh.spread)} ${clean(sh.color)} @${opacity}%`
    })
    if (parts.length > 0) out.push(`- ${tr('brief.uiux.aim.shadows', { list: parts.join('; ') })}`)
  }
  const type = want('type') && isObj(resolved.type) ? resolved.type : null
  if (type) {
    const parts = TYPE_ROLES.filter((role) => isObj(type[role])).map((role) => {
      const sp = type[role] as Record<string, unknown>
      return `${role} ${clean(sp.family)}, ${clean(sp.fallback)}, ${num(sp.size)}px / ${num(sp.lineHeight)}, ${num(sp.weight)}`
    })
    if (parts.length > 0) out.push(`- ${tr('brief.uiux.aim.type', { list: parts.join('; ') })}`)
  }
  const box = want('box') && isObj(resolved.box) ? resolved.box : null
  if (box) {
    out.push(
      `- ${tr('brief.uiux.aim.box', {
        radius: num(box.radius),
        px: num(box.paddingX),
        py: num(box.paddingY),
        gap: num(box.gap),
        density: clean(box.density),
        minWidth: box.buttonMinWidth === undefined ? tr('brief.uiux.unset') : num(box.buttonMinWidth),
        maxWidth: box.maxWidth === undefined ? tr('brief.uiux.unset') : num(box.maxWidth)
      })}`
    )
  }
  return out
}

/**
 * The UI/UX section of brief.md: lines to append (ends with an empty line). `annotations` are the capture's, in
 * drawing order, so ids in the scope become the same circled numbers the annotation list uses.
 */
export function uiuxBriefLines(request: DesignRequest, annotations: Annotation[], tr: Translate, options: UiuxBriefOptions = {}): string[] {
  const r = request as unknown as Record<string, unknown>
  const lines: string[] = []
  lines.push(`## ${tr('brief.uiux.heading')}`)
  lines.push(tr('brief.uiux.intro'))
  lines.push(`- ${tr('brief.uiux.project', { name: clean(r.projectName) })}`)
  const purpose = typeof r.purposeSummary === 'string' ? clean(r.purposeSummary) : ''
  if (purpose) lines.push(`- ${tr('brief.uiux.purpose', { summary: purpose })}`)
  const basis = r.overviewBasis === 'user' || r.overviewBasis === 'imported' || r.overviewBasis === 'agent' ? r.overviewBasis : undefined
  if (basis || typeof r.overviewRevision === 'number') {
    const basisText = basis ? tr(`brief.uiux.basis.${basis}`) : tr('brief.uiux.unset')
    lines.push(
      `- ${typeof r.overviewRevision === 'number' ? tr('brief.uiux.overview', { basis: basisText, revision: r.overviewRevision }) : tr('brief.uiux.overview.noRevision', { basis: basisText })}`
    )
  }
  if (typeof r.rulesRevision === 'number') lines.push(`- ${tr('brief.uiux.rules', { revision: r.rulesRevision })}`)
  if (typeof r.selectedProposalId === 'string' && r.selectedProposalId) {
    // A mix the user made from several proposals has a generated id that means nothing to the agent.
    lines.push(`- ${r.selectedProposalId.startsWith('user-mix-') ? tr('brief.uiux.proposal.mix') : tr('brief.uiux.proposal', { id: clean(r.selectedProposalId) })}`)
  }
  if (isObj(r.skill)) {
    const source = r.skill.source === 'builtin' || r.skill.source === 'agent' || r.skill.source === 'imported' ? r.skill.source : undefined
    const version = typeof r.skill.version === 'string' && r.skill.version ? ` ${clean(r.skill.version)}` : ''
    // Backseat's own rules are named in the brief's language; the stored name is an internal English id.
    const name = r.skill.id === BUILTIN_SKILL.id ? tr('uiux.panel.builtinSkill') : `${clean(r.skill.name)}${version}`
    lines.push(`- ${tr('brief.uiux.skill', { name, source: source ? tr(`brief.uiux.skill.source.${source}`) : tr('brief.uiux.unset') })}`)
  }
  lines.push(`- ${scopeLine(r.scope, annotations, tr)}`)

  const changes = arr(r.changes).filter(isObj)
  if (changes.length > 0) {
    lines.push('')
    lines.push(`### ${tr('brief.uiux.changes')}`)
    for (const c of changes) lines.push(`- ${clean(c.path)}: ${formatValue(c.from, tr)} → ${formatValue(c.to, tr)}`)
    lines.push(tr('brief.uiux.changes.base'))
  }
  // With saved project rules every value is the user's target. Without them the untouched values are only
  // Backseat's defaults, not what the user asked for: list the areas the request changes or locks, keep the rest.
  const withRules = typeof r.rulesRevision === 'number'
  const areaOf = (p: unknown): string => String(p).split('.')[0]
  const touched = new Set([...changes.map((c) => areaOf(c.path)), ...strs(r.locks).map(areaOf)])
  const aim = aimLines(r.resolved, tr, withRules ? null : touched)
  if (aim.length > 0) {
    lines.push('')
    lines.push(`### ${tr(withRules ? 'brief.uiux.aim' : 'brief.uiux.aim.touched')}`)
    lines.push(...aim)
  }
  if (!withRules) lines.push(tr('brief.uiux.keepRest'))
  const preserve = strs(r.preserve)
  if (preserve.length > 0) {
    lines.push('')
    lines.push(`### ${tr('brief.uiux.preserve')}`)
    for (const p of preserve) lines.push(`- ${clean(p)}`)
  }
  const locks = strs(r.locks)
  if (locks.length > 0) {
    lines.push('')
    lines.push(`### ${tr('brief.uiux.locks')}`)
    lines.push(`- ${locks.map(clean).join(', ')}`)
  }
  const checks = arr(r.checks).filter(isObj) as unknown as Check[]
  if (checks.length > 0) {
    const visual = checks.filter((c) => c.kind !== 'runtime')
    const runtime = checks.filter((c) => c.kind === 'runtime')
    lines.push('')
    lines.push(`### ${tr('brief.uiux.checks')}`)
    if (visual.length > 0) {
      lines.push(`${tr('brief.uiux.checks.visual')}`)
      lines.push(...checkLines(visual, tr))
    }
    if (runtime.length > 0) {
      lines.push(`${tr('brief.uiux.checks.runtime')}`)
      lines.push(...checkLines(runtime, tr))
    }
    lines.push(tr('brief.uiux.checks.note'))
  }
  const conflicts = strs(r.conflicts)
  if (conflicts.length > 0) {
    lines.push('')
    lines.push(`### ${tr('brief.uiux.conflicts')}`)
    for (const c of conflicts) lines.push(`- ${clean(c)}`)
  }
  lines.push('')
  if (options.previewFileName) lines.push(tr('brief.uiux.preview', { file: options.previewFileName }))
  else if (options.previewMissing) lines.push(tr('brief.uiux.previewMissing'))
  lines.push(tr('brief.uiux.done'))
  if (options.reportJobId) lines.push(tr('brief.uiux.report', { jobId: clean(options.reportJobId) }))
  lines.push('')
  return lines
}
