// Proposal comparison and mixing (spec §7.1, §8.1, §8.2): the original capture next to each candidate, what a
// candidate changes, its checks, the locks it would have broken (restored, never trusted), and a mix of areas
// taken from different candidates. Plain DOM, textContent only; styles in ./compare.css (scoped under .uxc).
//
// What a candidate shows:
//   - its mock-up when the agent provided one, labelled "개선 시안 · 실제 앱 미적용";
//   - otherwise component samples drawn with its tokens (they carry their own "디자인 예시" label).
// A missing mock-up is never replaced by a generic example: the samples always use the candidate's own values
// and say so.
import type { Check, DesignProposal, DesignTokens, SkillRef, TokenPath } from '../../../shared/uiux/types'
import { diffTokens } from '../../../shared/uiux/builtin'
import { tokenChecks } from '../../../shared/uiux/contrast'
import {
  AREAS, isOutdated, lockViolations, mixProposals, respectLocks, userProposal,
  type Area, type Mix, type MixPick
} from '../../../shared/uiux/mix'
import type { Translate } from '../../../shared/i18n'
import { createSampleView, type SampleView } from './samples'
import { button as uxButton, el } from './dom'

export interface CompareOptions {
  t: Translate
  /** The capture (data URL) shown as the original, same scale as mock-ups. */
  original: string | null
  base: DesignTokens
  locks: TokenPath[]
  proposals: DesignProposal[]
  /** mock-up image per proposalId (data URL), when the agent provided one */
  mockups: Record<string, string>
  currentOverviewRevision?: number
  onRequest(tokens: DesignTokens, proposal: DesignProposal): void
}

export interface CompareView {
  el: HTMLElement
  destroy(): void
}

type ViewMode = 'candidate' | 'original' | 'side'

const MIX = 'mix'
const HEX = /^#[0-9a-fA-F]{6}$/
const MAX_CHANGES = 12
const ZOOM_MIN = 50
const ZOOM_MAX = 400

/** The shared button, class first as this view reads, with an optional tooltip. */
function button(cls: string, text: string, onClick: () => void, tip?: string): HTMLButtonElement {
  const b = uxButton(text, onClick, cls)
  if (tip) b.title = tip
  return b
}

let uid = 0

export function createCompareView(opts: CompareOptions): CompareView {
  const { t } = opts
  const id = `uxc${++uid}`

  const root = el('section', 'uxc')

  let selected = ''
  let viewMode: ViewMode | null = null
  const picks: Record<Area, string> = { colors: 'base', ratio: 'base', shadows: 'base', type: 'base', box: 'base' }
  let candSample: SampleView | null = null
  let mixSample: SampleView | null = null
  let mixResultBox: HTMLElement | null = null

  // overlay ("크게 비교")
  let overlay: HTMLElement | null = null
  let overlayCandidate = ''
  let overlayZoom = 100
  let overlayOpener: HTMLElement | null = null

  // ---------- derived data ----------

  /** Proposals as the comparison sees them: a mock-up that has no image counts as a sample preview. */
  function effective(): DesignProposal[] {
    return opts.proposals.map((p) => (p.previewKind === 'mockup' && !opts.mockups[p.proposalId] ? { ...p, previewKind: 'sample' as const } : p))
  }

  function labelOf(p: DesignProposal, i: number): string {
    const d = p.direction.trim()
    return d.length > 0 && d.length <= 3 ? d : String.fromCharCode(65 + (i % 26))
  }

  function areaLabel(a: Area): string {
    return t(`uiux.compare.area.${a}`)
  }

  function checkLabel(c: Check): string {
    return c.label.startsWith('uiux.') ? t(c.label) : c.label
  }

  function fmtValue(v: unknown): string {
    if (v === undefined) return t('uiux.compare.unset')
    if (v === null) return t('uiux.compare.none')
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.blur === 'number') return `${o.x} ${o.y} ${o.blur} ${o.spread} ${o.color} ${o.opacity}`
      return Object.entries(o).map(([k, x]) => `${k} ${fmtValue(x)}`).join(', ')
    }
    return String(v)
  }

  function sourceLabel(s: SkillRef['source']): string {
    return t(`uiux.compare.skill.source.${s}`)
  }

  // ---------- small renderers ----------

  function swatch(v: unknown): HTMLElement | null {
    if (typeof v !== 'string' || !HEX.test(v)) return null
    const s = el('span', 'uxc-swatch')
    s.style.background = v
    s.setAttribute('aria-hidden', 'true')
    return s
  }

  function valueSpan(v: unknown): HTMLElement {
    const span = el('span', 'uxc-val')
    const sw = swatch(v)
    if (sw) span.append(sw)
    span.append(el('span', 'uxc-valtext', fmtValue(v)))
    return span
  }

  function changeList(changes: { path: string; from: unknown; to: unknown }[]): HTMLElement {
    const box = el('div', 'uxc-changes')
    if (changes.length === 0) {
      box.append(el('p', 'uxc-muted', t('uiux.compare.changes.none')))
      return box
    }
    const areas = AREAS.filter((a) => changes.some((c) => c.path === a || c.path.startsWith(a + '.')))
    box.append(el('p', 'uxc-areas', t('uiux.compare.changes.areas', { areas: areas.map(areaLabel).join(', ') })))
    const ul = el('ul', 'uxc-list uxc-changelist')
    for (const c of changes.slice(0, MAX_CHANGES)) {
      const li = el('li')
      li.append(el('code', 'uxc-path', c.path), valueSpan(c.from), el('span', 'uxc-arrow', '→'), valueSpan(c.to))
      ul.append(li)
    }
    box.append(ul)
    if (changes.length > MAX_CHANGES) box.append(el('p', 'uxc-muted', t('uiux.compare.changes.more', { n: changes.length - MAX_CHANGES })))
    return box
  }

  function textList(items: string[]): HTMLElement {
    const ul = el('ul', 'uxc-list')
    for (const s of items) ul.append(el('li', undefined, s))
    return ul
  }

  function section(title: string, body: HTMLElement | null): HTMLElement | null {
    if (!body) return null
    const s = el('div', 'uxc-section')
    s.append(el('h5', 'uxc-h', title), body)
    return s
  }

  function checksBlock(checks: Check[]): HTMLElement {
    const ul = el('ul', 'uxc-list uxc-checks')
    for (const c of checks) {
      const li = el('li', `uxc-check uxc-${c.status}`)
      const glyph = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '○'
      li.append(el('span', 'uxc-status', `${glyph} ${t(`uiux.compare.status.${c.status}`)}`))
      li.append(el('span', 'uxc-checklabel', checkLabel(c)))
      if (c.note) li.append(el('span', 'uxc-note', c.note))
      if (c.kind === 'runtime') li.append(el('span', 'uxc-tag', t('uiux.compare.check.runtime')))
      ul.append(li)
    }
    return ul
  }

  /** Recomputed contrast first (the agent's own claim is not trusted), then the agent's other checks. */
  function checksFor(p: DesignProposal, tokens: DesignTokens): Check[] {
    const own = tokenChecks(tokens)
    return [...own, ...p.checks.filter((c) => !own.some((o) => o.id === c.id))]
  }

  function image(src: string, alt: string): HTMLImageElement {
    const img = el('img', 'uxc-img')
    img.src = src
    img.alt = alt
    img.draggable = false
    return img
  }

  function figure(content: HTMLElement, caption: string, cls = ''): HTMLElement {
    const f = el('figure', `uxc-fig ${cls}`.trim())
    f.append(content, el('figcaption', 'uxc-cap', caption))
    return f
  }

  // ---------- candidate view ----------

  function renderPreview(p: DesignProposal, raw: DesignProposal, tokens: DesignTokens, violated: boolean): HTMLElement {
    const wrap = el('div', 'uxc-preview')
    const mock = opts.mockups[p.proposalId]
    const hasOrig = !!opts.original
    const mode: ViewMode = viewMode && (viewMode !== 'side' || (hasOrig && mock)) && (viewMode !== 'original' || hasOrig)
      ? viewMode
      : hasOrig && mock ? 'side' : 'candidate'

    if (hasOrig) {
      const seg = el('div', 'uxc-seg')
      seg.setAttribute('role', 'group')
      seg.setAttribute('aria-label', t('uiux.compare.view.label'))
      const modes: ViewMode[] = mock ? ['side', 'candidate', 'original'] : ['candidate', 'original']
      for (const m of modes) {
        const b = button('uxc-segbtn', t(`uiux.compare.view.${m}`), () => { viewMode = m; render() })
        b.setAttribute('aria-pressed', String(m === mode))
        seg.append(b)
      }
      wrap.append(seg)
    }

    const candidateEl = (): HTMLElement => {
      if (mock) return figure(image(mock, t('uiux.compare.mockupAlt', { name: raw.name })), t('uiux.compare.mockupLabel'), 'uxc-mock')
      if (!candSample) candSample = createSampleView(tokens, { t })
      candSample.update(tokens)
      const box = el('div', 'uxc-samplebox')
      if (raw.previewKind === 'mockup') box.append(el('p', 'uxc-note-line', t('uiux.compare.mockupMissing')))
      box.append(candSample.el)
      return box
    }
    const originalEl = (): HTMLElement =>
      opts.original
        ? figure(image(opts.original, t('uiux.compare.originalAlt')), t('uiux.compare.original'), 'uxc-orig')
        : el('p', 'uxc-note-line', t('uiux.compare.noOriginal'))

    if (mode === 'side') {
      const grid = el('div', 'uxc-pair')
      grid.append(originalEl(), candidateEl())
      wrap.append(grid)
    } else {
      wrap.append(mode === 'original' ? originalEl() : candidateEl())
    }
    if (mock && violated) wrap.append(el('p', 'uxc-note-line uxc-warn', t('uiux.compare.mockupBeforeRestore')))

    const tools = el('div', 'uxc-row')
    if (mock || hasOrig) {
      tools.append(button('uxc-btn', t('uiux.compare.big'), () => openOverlay(raw.proposalId, tools.firstElementChild as HTMLElement), t('uiux.compare.big.tip')))
      wrap.append(tools)
    }
    return wrap
  }

  function renderCandidate(p: DesignProposal, index: number): HTMLElement {
    const body = el('div', 'uxc-cand')
    const raw = opts.proposals.find((x) => x.proposalId === p.proposalId) ?? p
    const restored = respectLocks(p, opts.base, opts.locks)
    const violations = lockViolations(p, opts.base, opts.locks)

    const head = el('div', 'uxc-cardhead')
    head.append(el('span', 'uxc-badge', labelOf(p, index)), el('h4', 'uxc-name', p.name))
    body.append(head)
    const meta = el('div', 'uxc-meta')
    if (p.direction.trim()) meta.append(el('span', 'uxc-chip', t('uiux.compare.direction', { direction: p.direction })))
    meta.append(el('span', 'uxc-chip', t(`uiux.compare.origin.${p.origin}`)))
    if (isOutdated(p, opts.currentOverviewRevision)) {
      const o = el('span', 'uxc-chip uxc-chip-warn', `▲ ${t('uiux.compare.outdated')}`)
      o.title = t('uiux.compare.outdated.tip')
      meta.append(o)
    }
    body.append(meta)

    body.append(renderPreview(p, raw, restored.tokens, violations.length > 0))

    if (p.rationale.trim()) body.append(section(t('uiux.compare.section.rationale'), el('p', 'uxc-text', p.rationale))!)

    if (violations.length > 0) {
      const box = el('div', 'uxc-lockbox')
      box.append(el('p', 'uxc-warn', `▲ ${t('uiux.compare.locks.restored')}`), textListCode(violations))
      body.append(box)
    }

    body.append(section(t('uiux.compare.section.changes'), changeList(diffTokens(opts.base, restored.tokens)))!)
    if (p.changes.length > 0) body.append(section(t('uiux.compare.section.changesAgent'), textList(p.changes))!)
    if (p.preserved.length > 0) body.append(section(t('uiux.compare.section.preserved'), textList(p.preserved))!)
    if (p.cautions && p.cautions.length > 0) body.append(section(t('uiux.compare.section.cautions'), textList(p.cautions))!)

    const skill = el('p', 'uxc-text', p.skill ? `${p.skill.name} · ${sourceLabel(p.skill.source)}` : t('uiux.compare.skill.none'))
    body.append(section(t('uiux.compare.section.skill'), skill)!)
    body.append(section(t('uiux.compare.section.checks'), checksBlock(checksFor(p, restored.tokens)))!)

    const act = el('div', 'uxc-actions')
    act.append(button('uxc-btn uxc-primary', t('uiux.compare.request'), () => opts.onRequest(restored.tokens, respectLocks(raw, opts.base, opts.locks)), t('uiux.compare.request.tip')))
    body.append(act)
    return body
  }

  function textListCode(items: string[]): HTMLElement {
    const ul = el('ul', 'uxc-list')
    for (const s of items) {
      const li = el('li')
      li.append(el('code', 'uxc-path', s))
      ul.append(li)
    }
    return ul
  }

  // ---------- mix view ----------

  function currentMix(): Mix {
    const list = AREAS.map((area): MixPick => ({ area, proposalId: picks[area] }))
    return mixProposals(opts.base, effective(), list, opts.locks)
  }

  function renderMixResult(): void {
    if (!mixResultBox) return
    const box = mixResultBox
    const m = currentMix()
    if (!mixSample) mixSample = createSampleView(m.tokens, { t })
    mixSample.update(m.tokens)
    box.replaceChildren()

    if (m.mockupStale) {
      const s = el('div', 'uxc-stale')
      s.setAttribute('role', 'status')
      s.append(el('p', 'uxc-stale-title', `▲ ${t('uiux.compare.mix.stale')}`), el('p', 'uxc-muted', t('uiux.compare.mix.staleHint')))
      box.append(s)
    }
    box.append(mixSample.el)
    box.append(section(t('uiux.compare.section.changes'), changeList(m.changes))!)
    box.append(section(t('uiux.compare.section.checks'), checksBlock(tokenChecks(m.tokens)))!)
    if (opts.locks.length > 0) box.append(el('p', 'uxc-note-line', t('uiux.compare.mix.locksKept')))

    const act = el('div', 'uxc-actions')
    const req = button('uxc-btn uxc-primary', t('uiux.compare.mix.request'), () => {
      const cur = currentMix()
      const letters = Object.fromEntries(effective().map((p, i) => [p.proposalId, labelOf(p, i)]))
      const parts = AREAS.map((a) => `${areaLabel(a)} ${cur.from[a] === 'base' ? t('uiux.compare.mix.source.base') : letters[cur.from[a]] ?? cur.from[a]}`)
      const proposal = userProposal(cur, {
        projectId: opts.proposals[0]?.projectId ?? '',
        inputRevision: Math.max(0, ...opts.proposals.map((p) => p.inputRevision)),
        overviewRevision: opts.currentOverviewRevision,
        name: t('uiux.compare.mix.name'),
        rationale: t('uiux.compare.mix.rationale', { parts: parts.join(', ') })
      })
      opts.onRequest(cur.tokens, proposal)
    }, t('uiux.compare.mix.request.tip'))
    act.append(req)
    box.append(act)
  }

  function renderMix(): HTMLElement {
    const body = el('div', 'uxc-mix')
    body.append(el('h4', 'uxc-name', t('uiux.compare.mix.title')), el('p', 'uxc-muted', t('uiux.compare.mix.hint')))
    const list = effective()
    const form = el('div', 'uxc-mixform')
    for (const area of AREAS) {
      if (!list.some((p) => p.proposalId === picks[area])) picks[area] = 'base'
      const row = el('div', 'uxc-mixrow')
      const sel = el('select', 'uxc-select')
      sel.id = `${id}-${area}`
      const lab = el('label', 'uxc-label', areaLabel(area))
      lab.htmlFor = sel.id
      sel.setAttribute('aria-label', `${areaLabel(area)}: ${t('uiux.compare.mix.source')}`)
      sel.title = t('uiux.compare.mix.source')
      const baseOpt = el('option', undefined, t('uiux.compare.mix.source.base'))
      baseOpt.value = 'base'
      sel.append(baseOpt)
      list.forEach((p, i) => {
        const o = el('option', undefined, `${labelOf(p, i)} · ${p.name}`)
        o.value = p.proposalId
        sel.append(o)
      })
      sel.value = picks[area]
      sel.addEventListener('change', () => {
        picks[area] = sel.value
        renderMixResult()
      })
      row.append(lab, sel)
      form.append(row)
    }
    body.append(el('p', 'uxc-label uxc-source', t('uiux.compare.mix.source')), form)
    mixResultBox = el('div', 'uxc-mixresult')
    body.append(mixResultBox)
    renderMixResult()
    return body
  }

  // ---------- main render ----------

  function render(): void {
    const active = document.activeElement
    const focusedTab = active instanceof HTMLElement && root.contains(active) && active.dataset.tab ? active.dataset.tab : null
    mixResultBox = null
    root.replaceChildren()
    root.setAttribute('aria-label', t('uiux.compare.title'))

    const head = el('div', 'uxc-head')
    head.append(el('h3', 'uxc-title', t('uiux.compare.title')))
    root.append(head)

    const list = effective()
    if (list.length === 0) {
      root.append(el('p', 'uxc-empty', t('uiux.compare.empty')))
      return
    }
    root.append(el('p', 'uxc-muted', t('uiux.compare.intro')))
    if (selected !== MIX && !list.some((p) => p.proposalId === selected)) selected = list[0].proposalId

    const tabs = el('div', 'uxc-tabs')
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', t('uiux.compare.tabs'))
    const entries: { key: string; label: string; aria: string }[] = list.map((p, i) => ({
      key: p.proposalId, label: labelOf(p, i), aria: t('uiux.compare.candidateAria', { label: labelOf(p, i), name: p.name })
    }))
    if (list.length > 1) entries.push({ key: MIX, label: t('uiux.compare.tab.mix'), aria: t('uiux.compare.mix.title') })
    else if (selected === MIX) selected = list[0].proposalId
    const buttons: HTMLButtonElement[] = []
    for (const e of entries) {
      const b = el('button', 'uxc-tab', e.label)
      b.type = 'button'
      b.id = `${id}-tab-${buttons.length}`
      b.dataset.tab = e.key
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(e.key === selected))
      b.setAttribute('aria-controls', `${id}-panel`)
      b.setAttribute('aria-label', e.aria)
      b.tabIndex = e.key === selected ? 0 : -1
      b.addEventListener('click', () => select(e.key))
      b.addEventListener('keydown', (ev) => {
        const n = buttons.length
        const i = buttons.indexOf(b)
        let to = -1
        if (ev.key === 'ArrowRight') to = (i + 1) % n
        else if (ev.key === 'ArrowLeft') to = (i - 1 + n) % n
        else if (ev.key === 'Home') to = 0
        else if (ev.key === 'End') to = n - 1
        if (to >= 0) {
          ev.preventDefault()
          select(entries[to].key)
        }
      })
      buttons.push(b)
      tabs.append(b)
    }
    root.append(tabs)

    const panel = el('div', 'uxc-panel')
    panel.id = `${id}-panel`
    panel.setAttribute('role', 'tabpanel')
    const selIdx = buttons.findIndex((b) => b.dataset.tab === selected)
    if (selIdx >= 0) panel.setAttribute('aria-labelledby', buttons[selIdx].id)
    if (selected === MIX) panel.append(renderMix())
    else {
      const i = list.findIndex((p) => p.proposalId === selected)
      panel.append(renderCandidate(list[i], i))
    }
    root.append(panel)

    if (overlay) root.append(overlay)
    if (focusedTab) buttons.find((b) => b.dataset.tab === (focusedTab === selected ? focusedTab : selected))?.focus()
  }

  function select(key: string): void {
    if (key === selected) return
    selected = key
    viewMode = null
    render()
  }

  // ---------- overlay: original vs candidate at the same scale ----------

  function closeOverlay(): void {
    if (!overlay) return
    overlay.remove()
    overlay = null
    const back = overlayOpener
    overlayOpener = null
    if (back && root.contains(back)) back.focus()
    else root.querySelector<HTMLElement>('.uxc-tab[aria-selected="true"], .uxc-btn')?.focus()
  }

  function openOverlay(proposalId: string, opener: HTMLElement | null): void {
    overlayCandidate = proposalId
    overlayOpener = opener
    overlayZoom = 100
    buildOverlay()
    const close = overlay?.querySelector<HTMLElement>('.uxc-close')
    close?.focus()
  }

  function buildOverlay(): void {
    const keepFocus = overlay && overlay.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.ov : null
    overlay?.remove()
    const list = effective()
    const idx = list.findIndex((p) => p.proposalId === overlayCandidate)
    if (idx < 0) {
      overlay = null
      return
    }
    const p = list[idx]
    const ov = el('div', 'uxc-overlay')
    ov.setAttribute('role', 'dialog')
    ov.setAttribute('aria-modal', 'true')
    ov.setAttribute('aria-label', t('uiux.compare.overlay.title'))

    const bar = el('div', 'uxc-ovbar')
    bar.append(el('h4', 'uxc-ovtitle', t('uiux.compare.overlay.title')))
    const sel = el('select', 'uxc-select')
    sel.dataset.ov = 'cand'
    sel.setAttribute('aria-label', t('uiux.compare.overlay.candidate'))
    list.forEach((q, i) => {
      const o = el('option', undefined, `${labelOf(q, i)} · ${q.name}`)
      o.value = q.proposalId
      sel.append(o)
    })
    sel.value = p.proposalId
    sel.addEventListener('change', () => { overlayCandidate = sel.value; buildOverlay() })

    const zoomLab = el('label', 'uxc-label', t('uiux.compare.overlay.zoom'))
    const zoom = el('input', 'uxc-zoom')
    zoom.type = 'range'
    zoom.min = String(ZOOM_MIN)
    zoom.max = String(ZOOM_MAX)
    zoom.step = '10'
    zoom.value = String(overlayZoom)
    zoom.dataset.ov = 'zoom'
    zoom.id = `${id}-zoom`
    zoomLab.htmlFor = zoom.id
    const zoomVal = el('span', 'uxc-zoomval', `${overlayZoom}%`)
    const close = button('uxc-btn uxc-close', t('uiux.compare.overlay.close'), closeOverlay)
    close.dataset.ov = 'close'
    bar.append(sel, zoomLab, zoom, zoomVal, close)
    ov.append(bar)

    const panes = el('div', 'uxc-panes')
    const boxes: HTMLElement[] = []
    const scrollers: HTMLElement[] = []
    const pane = (caption: string, src: string | null, alt: string, missing: string): void => {
      const col = el('div', 'uxc-pane')
      col.append(el('p', 'uxc-cap', caption))
      if (src) {
        const sc = el('div', 'uxc-scroll')
        const inner = el('div', 'uxc-zoombox')
        inner.append(image(src, alt))
        sc.append(inner)
        boxes.push(inner)
        scrollers.push(sc)
        col.append(sc)
      } else {
        col.append(el('p', 'uxc-note-line', missing))
      }
      panes.append(col)
    }
    pane(t('uiux.compare.original'), opts.original, t('uiux.compare.originalAlt'), t('uiux.compare.noOriginal'))
    const mock = opts.mockups[p.proposalId]
    pane(t('uiux.compare.mockupLabel'), mock ?? null, t('uiux.compare.mockupAlt', { name: p.name }), t('uiux.compare.overlay.noMockup'))
    ov.append(panes)

    const applyZoom = (): void => {
      for (const b of boxes) b.style.width = `${overlayZoom}%`
      zoomVal.textContent = `${overlayZoom}%`
    }
    applyZoom()
    zoom.addEventListener('input', () => {
      overlayZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom.value) || 100))
      applyZoom()
    })
    // same position in both panes
    let syncing = false
    for (const sc of scrollers) {
      sc.addEventListener('scroll', () => {
        if (syncing) return
        syncing = true
        for (const other of scrollers) {
          if (other === sc) continue
          const maxX = sc.scrollWidth - sc.clientWidth
          const maxY = sc.scrollHeight - sc.clientHeight
          other.scrollLeft = maxX > 0 ? (sc.scrollLeft / maxX) * (other.scrollWidth - other.clientWidth) : 0
          other.scrollTop = maxY > 0 ? (sc.scrollTop / maxY) * (other.scrollHeight - other.clientHeight) : 0
        }
        syncing = false
      })
    }

    ov.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        closeOverlay()
        return
      }
      if (ev.key !== 'Tab') return
      const f = [...ov.querySelectorAll<HTMLElement>('select, input, button')].filter((x) => !x.hasAttribute('disabled'))
      if (f.length === 0) return
      const first = f[0]
      const last = f[f.length - 1]
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus() }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus() }
    })

    overlay = ov
    root.append(ov)
    if (keepFocus) ov.querySelector<HTMLElement>(`[data-ov="${keepFocus}"]`)?.focus()
  }

  // ---------- public ----------

  render()

  return {
    el: root,
    destroy(): void {
      overlay?.remove()
      overlay = null
      candSample?.destroy()
      mixSample?.destroy()
      candSample = null
      mixSample = null
      mixResultBox = null
      root.replaceChildren()
    }
  }
}
