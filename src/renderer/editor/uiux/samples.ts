// "디자인 예시": live component samples drawn with the given DesignTokens (spec 8.1, 8.3). No AI involved.
// Plain DOM, textContent only. Token values reach the page as CSS custom properties and data attributes on the
// stage element (see samples.css), never as concatenated CSS text, so update() stays cheap enough for sliders.
// Styles live in ./samples.css (scoped under .ux-samples); the caller imports that file once.

import type { ColorRole, DesignTokens, ShadowRole, TypeRole } from '../../../shared/uiux/types.ts'
import { COLOR_ROLES, SHADOW_ROLES, TYPE_ROLES } from '../../../shared/uiux/types.ts'
import {
  formatFamilyList, judgeProbes, parseFamilyList, reportFor, shownDiffers,
  type FontProbeVerdict, type FontRoleReport, type WidthProbe
} from '../../../shared/uiux/fonts.ts'
import { el } from './dom.ts'

export type FontReport = Record<TypeRole, FontRoleReport>

export interface SampleOptions {
  t: (key: string, params?: Record<string, string | number>) => string
  /** Optional reference image (data URL of the current capture or a crop) shown behind the samples, dimmed. */
  reference?: string | null
}

export interface SampleView {
  el: HTMLElement
  update(tokens: DesignTokens): void
  fontReport(): FontReport
  destroy(): void
}

// ---------- font detection (DOM part) ----------

const LATIN_PROBE = 'AaBb123'
const HANGUL_PROBE = '가나다한글'
const PROBE_FALLBACK_A = 'monospace'
const PROBE_FALLBACK_B = 'serif'

let probeCtx: CanvasRenderingContext2D | null | undefined
const verdicts = new Map<string, FontProbeVerdict>()

function ctx2d(): CanvasRenderingContext2D | null {
  if (probeCtx === undefined) {
    try {
      probeCtx = document.createElement('canvas').getContext('2d')
    } catch {
      probeCtx = null
    }
  }
  return probeCtx
}

function probe(c: CanvasRenderingContext2D, name: string, text: string): WidthProbe {
  const quoted = formatFamilyList([name])
  const width = (stack: string): number => {
    c.font = `64px ${stack}`
    return c.measureText(text).width
  }
  return {
    withA: width(`${quoted}, ${PROBE_FALLBACK_A}`),
    baseA: width(PROBE_FALLBACK_A),
    withB: width(`${quoted}, ${PROBE_FALLBACK_B}`),
    baseB: width(PROBE_FALLBACK_B)
  }
}

/** Installed? Draws Hangul? Never loads anything. A family that cannot be measured counts as not installed. */
function verdictFor(name: string): FontProbeVerdict {
  const hit = verdicts.get(name)
  if (hit) return hit
  let v: FontProbeVerdict = { installed: false, koreanGlyphs: false }
  try {
    // check() is true for names no @font-face declares, so it can only veto: a declared face that is not loaded yet.
    const declaredButNotLoaded = !document.fonts.check(`16px ${formatFamilyList([name])}`, '가')
    const c = ctx2d()
    if (c && !declaredButNotLoaded) v = judgeProbes(probe(c, name, LATIN_PROBE), probe(c, name, HANGUL_PROBE))
  } catch {
    // keep "not installed"
  }
  verdicts.set(name, v)
  return v
}

function computeReport(tokens: DesignTokens): FontReport {
  const out = {} as FontReport
  for (const role of TYPE_ROLES) {
    const spec = tokens.type[role]
    out[role] = reportFor(
      parseFamilyList(spec.family, spec.fallback),
      (f) => verdictFor(f).installed,
      (f) => verdictFor(f).koreanGlyphs
    )
  }
  return out
}

const HEX = /^#[0-9a-fA-F]{6}$/
const clamp = (n: number, lo: number, hi: number, dflt: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt)

const COLOR_VAR: Record<ColorRole, string> = {
  background: '--ux-bg', surface: '--ux-surface', text: '--ux-text', textMuted: '--ux-muted', primary: '--ux-primary',
  onPrimary: '--ux-on-primary', border: '--ux-border', success: '--ux-success', warning: '--ux-warning',
  danger: '--ux-danger', info: '--ux-info'
}
const DENSITY: Record<string, number> = { compact: 0.75, comfortable: 1, spacious: 1.3 }
const STATUS: { role: 'success' | 'warning' | 'danger' | 'info'; glyph: string }[] = [
  { role: 'success', glyph: '✓' },
  { role: 'warning', glyph: '▲' },
  { role: 'danger', glyph: '✕' },
  { role: 'info', glyph: 'ℹ' }
]

export function createSampleView(initial: DesignTokens, opts: SampleOptions): SampleView {
  const { t } = opts
  let current = initial
  let fontKey = ''
  let report: FontReport = computeReport(initial)

  // --- structure ---
  const root = el('section', 'ux-samples')
  const head = el('div', 'ux-samples__head')
  head.append(el('span', 'ux-samples__label', t('uiux.samples.label')), el('span', 'ux-samples__note', t('uiux.samples.notReal')))
  root.append(head)

  const stage = el('div', 'ux-samples__stage')
  stage.setAttribute('role', 'group')
  stage.setAttribute('aria-label', t('uiux.samples.label'))
  root.append(stage)

  const ref = opts.reference
  if (typeof ref === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(ref)) {
    const img = el('img', 'ux-samples__ref')
    img.alt = ''
    img.setAttribute('aria-hidden', 'true')
    img.src = ref
    stage.append(img)
    head.append(el('span', 'ux-samples__note', t('uiux.samples.referenceNote')))
  }

  const body = el('div', 'ux-samples__body')
  stage.append(body)

  // buttons
  const buttons = el('div', 'ux-row ux-buttons')
  const mkBtn = (cls: string, key: string, disabled = false): HTMLButtonElement => {
    const b = el('button', `ux-btn ${cls}`, t(key))
    b.type = 'button'
    b.disabled = disabled
    return b
  }
  buttons.append(
    mkBtn('ux-btn--primary', 'uiux.samples.button.primary'),
    mkBtn('ux-btn--secondary', 'uiux.samples.button.secondary'),
    mkBtn('ux-btn--disabled', 'uiux.samples.button.disabled', true)
  )

  // card
  const card = el('div', 'ux-card')
  const specimen = el('p', 'ux-card__text')
  specimen.append(el('span', 'ux-specimen', t('uiux.samples.card.specimen')), ' ', el('span', 'ux-num ux-card__amount', '1,234.50'))
  card.append(el('h3', 'ux-card__title', t('uiux.samples.card.title')), el('p', 'ux-card__text', t('uiux.samples.card.body')), specimen)

  // input
  const field = el('div', 'ux-field')
  const inputId = `ux-in-${Math.random().toString(36).slice(2, 8)}`
  const label = el('label', 'ux-field__label', t('uiux.samples.input.label'))
  label.htmlFor = inputId
  const input = el('input', 'ux-input ux-input--focus')
  input.id = inputId
  input.type = 'text'
  input.placeholder = t('uiux.samples.input.placeholder')
  field.append(label, input, el('div', 'ux-popover', t('uiux.samples.input.hint')))

  // table
  const table = el('table', 'ux-table')
  table.setAttribute('aria-label', t('uiux.samples.table.label'))
  const thead = el('thead')
  const hr = el('tr')
  const heads = ['item', 'qty', 'amount']
  heads.forEach((k, i) => {
    const th = el('th', i === 0 ? '' : 'ux-num', t(`uiux.samples.table.${k}`))
    th.scope = 'col'
    hr.append(th)
  })
  thead.append(hr)
  const tbody = el('tbody')
  const rows: [string, string, string][] = [
    ['row1', '1', '1,234.50'],
    ['row2', '3', '98.00'],
    ['row3', '12', '-120.75']
  ]
  for (const [k, qty, amount] of rows) {
    const tr = el('tr')
    const th = el('th', '', t(`uiux.samples.table.${k}`))
    th.scope = 'row'
    tr.append(th, el('td', 'ux-num', qty), el('td', 'ux-num', amount))
    tbody.append(tr)
  }
  table.append(thead, tbody)

  // status chips: glyph + word, never colour alone
  const chips = el('div', 'ux-row ux-chips')
  for (const s of STATUS) {
    const chip = el('span', `ux-chip ux-chip--${s.role}`)
    const g = el('span', 'ux-chip__glyph', s.glyph)
    g.setAttribute('aria-hidden', 'true')
    chip.append(g, el('span', 'ux-chip__text', t(`uiux.samples.status.${s.role}`)))
    chips.append(chip)
  }

  // target ratio bar
  const ratio = el('div', 'ux-ratio')
  const ratioHead = el('div', 'ux-ratio__head')
  const ratioLegend = el('span', 'ux-ratio__legend')
  ratioHead.append(el('span', 'ux-ratio__label', t('uiux.samples.ratio.label')), ratioLegend)
  const bar = el('div', 'ux-ratio__bar')
  bar.setAttribute('role', 'img')
  const segs = {
    background: el('span', 'ux-ratio__seg ux-ratio__seg--bg'),
    surface: el('span', 'ux-ratio__seg ux-ratio__seg--surface'),
    accent: el('span', 'ux-ratio__seg ux-ratio__seg--accent')
  }
  bar.append(segs.background, segs.surface, segs.accent)
  ratio.append(ratioHead, bar)

  body.append(buttons, card, field, table, chips, ratio)

  // font report (outside the token box: it is Backseat's own statement)
  const fonts = el('div', 'ux-fonts')
  fonts.append(el('div', 'ux-fonts__title', t('uiux.samples.fonts.title')))
  const fontList = el('ul', 'ux-fonts__list')
  fonts.append(fontList)
  root.append(fonts)

  // --- styling: custom properties only, written when the value changed ---
  const written = new Map<string, string>()
  const setVar = (name: string, value: string): void => {
    if (written.get(name) === value) return
    written.set(name, value)
    stage.style.setProperty(name, value)
  }
  const dropVar = (name: string): void => {
    if (!written.has(name)) return
    written.delete(name)
    stage.style.removeProperty(name)
  }
  const setAttr = (name: string, value: string): void => {
    if (stage.getAttribute(name) !== value) stage.setAttribute(name, value)
  }

  const renderFontReport = (): void => {
    fontList.textContent = ''
    for (const role of TYPE_ROLES) {
      const r = report[role]
      const li = el('li', 'ux-fonts__item')
      const roleName = t(`uiux.samples.fonts.role.${role}`)
      const differs = shownDiffers(r)
      if (differs) li.classList.add('is-differs')
      li.append(
        el('span', 'ux-fonts__role', roleName),
        el('span', 'ux-fonts__what',
          differs
            ? t('uiux.samples.fonts.differs', { requested: r.requested, used: r.used })
            : t('uiux.samples.fonts.same', { family: r.used || r.requested }))
      )
      if (!r.koreanGlyphs) {
        li.classList.add('is-differs')
        li.append(el('span', 'ux-fonts__warn', t('uiux.samples.fonts.noKorean')))
      }
      fontList.append(li)
    }
  }

  const refreshFonts = (tokens: DesignTokens): void => {
    const key = TYPE_ROLES.map((r) => `${tokens.type[r].family}\u0000${tokens.type[r].fallback}`).join('\u0001')
    if (key === fontKey) return
    fontKey = key
    report = computeReport(tokens)
    renderFontReport()
  }

  const apply = (tokens: DesignTokens): void => {
    current = tokens
    for (const role of COLOR_ROLES) {
      const v = tokens.colors[role]
      if (typeof v === 'string' && HEX.test(v)) setVar(COLOR_VAR[role], v)
    }

    for (const role of SHADOW_ROLES as readonly ShadowRole[]) {
      const s = tokens.shadows[role]
      const p = `--ux-sh-${role}`
      if (!s) {
        setAttr(`data-shadow-${role}`, 'off')
        continue
      }
      setAttr(`data-shadow-${role}`, 'on')
      setVar(`${p}-x`, `${clamp(s.x, -200, 200, 0)}px`)
      setVar(`${p}-y`, `${clamp(s.y, -200, 200, 0)}px`)
      setVar(`${p}-blur`, `${clamp(s.blur, 0, 400, 0)}px`)
      setVar(`${p}-spread`, `${clamp(s.spread, -200, 200, 0)}px`)
      setVar(`${p}-color`, HEX.test(s.color) ? s.color : '#000000')
      setVar(`${p}-opacity`, String(clamp(s.opacity, 0, 1, 0)))
    }

    for (const role of TYPE_ROLES) {
      const spec = tokens.type[role]
      const p = `--ux-${role}`
      setVar(`${p}-family`, formatFamilyList(parseFamilyList(spec.family, spec.fallback)) || 'sans-serif')
      setVar(`${p}-size`, `${clamp(spec.size, 6, 200, 14)}px`)
      setVar(`${p}-weight`, String(Math.round(clamp(spec.weight, 1, 1000, 400))))
      setVar(`${p}-lh`, String(clamp(spec.lineHeight, 0.8, 4, 1.4)))
    }

    const b = tokens.box
    setVar('--ux-radius', `${clamp(b.radius, 0, 100, 8)}px`)
    setVar('--ux-pad-x', `${clamp(b.paddingX, 0, 200, 16)}px`)
    setVar('--ux-pad-y', `${clamp(b.paddingY, 0, 200, 10)}px`)
    setVar('--ux-gap', `${clamp(b.gap, 0, 200, 12)}px`)
    setVar('--ux-dens', String(DENSITY[b.density] ?? 1))
    if (b.buttonMinWidth !== undefined && Number.isFinite(b.buttonMinWidth)) setVar('--ux-btn-min', `${clamp(b.buttonMinWidth, 0, 1000, 0)}px`)
    else dropVar('--ux-btn-min')
    if (b.maxWidth !== undefined && Number.isFinite(b.maxWidth)) setVar('--ux-max-w', `${clamp(b.maxWidth, 40, 4000, 4000)}px`)
    else dropVar('--ux-max-w')

    const r = tokens.ratio
    const share = (n: number): number => clamp(n, 0, 100, 0)
    setVar('--ux-ratio-bg', String(share(r.background)))
    setVar('--ux-ratio-surface', String(share(r.surface)))
    setVar('--ux-ratio-accent', String(share(r.accent)))
    ratioLegend.textContent = t('uiux.samples.ratio.legend', {
      background: Math.round(share(r.background)),
      surface: Math.round(share(r.surface)),
      accent: Math.round(share(r.accent))
    })
    bar.setAttribute('aria-label', ratioLegend.textContent)

    refreshFonts(tokens)
  }

  // Fonts that finish loading later change the answer: measure again.
  const onFontsLoaded = (): void => {
    verdicts.clear()
    fontKey = ''
    refreshFonts(current)
  }
  try {
    document.fonts.addEventListener('loadingdone', onFontsLoaded)
  } catch {
    // no FontFaceSet events: the first measurement stands
  }

  apply(initial)

  return {
    el: root,
    update: apply,
    fontReport: () => report,
    destroy() {
      try {
        document.fonts.removeEventListener('loadingdone', onFontsLoaded)
      } catch {
        // ignore
      }
      root.remove()
    }
  }
}
