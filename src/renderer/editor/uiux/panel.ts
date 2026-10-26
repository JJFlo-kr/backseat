// UI/UX tools panel (spec §4, stage A): project and the user's own overview, design skill, direct adjustments
// with local samples and built-in options, project rules, and what goes with the send.
// The toggle only shows or hides the panel; what is applied lives in the session state (src/shared/uiux/session.ts)
// and is shown next to 보내기 while the panel is closed. DOM is built with textContent only.
import type { Annotation, UiuxApi, UiuxPayload, UiuxProjectState, UserOverviewInput } from '../../../shared/types'
import type { Translate } from '../../../shared/i18n'
import {
  COLOR_ROLES, SHADOW_ROLES, TYPE_ROLES, type Check, type ColorRole, type DesignProposal, type DesignTokens, type ProjectProfile,
  type ShadowSpec, type SkillRef, type TokenPath
} from '../../../shared/uiux/types'
import {
  BUILTIN_SKILL, boxOptions, colorStrategies, defaultTokens, diffTokens, ratioOptions, shadowOptions, typeOptions,
  type Option, type RecommendInput
} from '../../../shared/uiux/builtin'
import { tokenChecks } from '../../../shared/uiux/contrast'
import { suggestions } from '../../../shared/uiux/autocomplete'
import {
  apply, buildRequest, discardDraftChanges, editDraft, isSent, markSent, missingAnnotations, newSession, release,
  status, switchProject, type UiuxDraft, type UiuxSession, type UiuxStatus
} from '../../../shared/uiux/session'
import { errText } from '../../../shared/errors'
import { createSampleView, type SampleView } from './samples'
import { createAgentParts } from './agent'
import { createCompareView } from './compare'
import { openOverviewView } from './overview-view'
import { button, el } from './dom'

export interface UiuxHost {
  t: Translate
  api: UiuxApi
  annotations(): readonly Annotation[]
  memo: HTMLInputElement
  setStatus(msg: string, isError?: boolean): void
  /** Applied state changed: the editor re-renders its send summary. */
  onStatusChange(): void
  /** The capture with only the blur applied, and with all marks: what proposals and audits look at. */
  capture(): { capturePng: string; annotatedPng: string }
  /** Only the clean capture (blur applied, no marks): the original in the proposal comparison. */
  baseCapture(): string
}

export interface UiuxMounts {
  panel: HTMLElement
  toggle: HTMLButtonElement
  /** Next to the send summary: "UI/UX guidance applied · 해제" while something is applied. */
  appliedBar: HTMLElement
  /** Under the memo: request phrases to insert. */
  suggestBar: HTMLElement
}

export interface UiuxPanel {
  toggle(force?: boolean): void
  isOpen(): boolean
  status(): UiuxStatus
  /** What the send carries, or undefined when nothing is applied. */
  payload(): UiuxPayload | undefined
  /** Before 보내기: settles "changes not reflected" with the user. false = do not send. */
  beforeSend(): Promise<boolean>
  /** After a successful send; reportJobId = the implementation_report job main made for it. */
  markSent(reportJobId?: string): void
  /** Annotations changed (draw, erase, crop, undo). */
  annotationsChanged(): void
}

type Area = 'colors' | 'ratio' | 'shadows' | 'type' | 'box'
const AREAS: readonly Area[] = ['colors', 'ratio', 'shadows', 'type', 'box']

const lines = (s: string): string[] => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function createUiuxPanel(host: UiuxHost, m: UiuxMounts): UiuxPanel {
  const { t } = host
  let open = false
  let projects: ProjectProfile[] = []
  let state: UiuxProjectState | null = null
  let session: UiuxSession = newSession(defaultTokens(), null)
  const undoStack: UiuxDraft[] = []
  const redoStack: UiuxDraft[] = []
  let area: Area = 'colors'
  let overviewFormOpen = false
  let newProjectOpen = false
  let samples: SampleView | null = null
  let loaded = false
  /** A slider drag in progress: one undo step for the whole drag, and no re-render under the pointer. */
  let gesture = false

  /** The mock-up of the proposal the user picked: goes with the send as design-preview.png while its values are what is applied. */
  let mockup: { proposalId: string; dataUrl: string; tokens: DesignTokens } | null = null
  /** Mock-up images per proposal job (proposalId → data URL), fetched once per job. */
  const previews = new Map<string, Record<string, string>>()

  /** IME composition in progress in a panel field: job-driven renders wait for it (and for blur). */
  let composing = false
  let pendingJobRender: 'parts' | 'full' | null = null

  m.panel.dataset.hotkeysOff = ''
  // Focusable itself, so focus can stay in the panel when a re-render removes the focused control.
  m.panel.tabIndex = -1
  m.panel.setAttribute('aria-label', t('uiux.panel.title'))
  m.panel.addEventListener('compositionstart', () => { composing = true })
  m.panel.addEventListener('compositionend', () => { composing = false; flushJobRender() })
  m.panel.addEventListener('focusout', () => { composing = false; flushJobRender() })

  const fail = (err: unknown): void => host.setStatus(t('uiux.panel.error', { error: errText(err) }), true)

  const agent = createAgentParts({
    t,
    api: host.api,
    state: () => state,
    refresh: async () => {
      if (state) state = await host.api.projectState(state.profile.projectId)
      jobRender('full')
    },
    rerender: () => jobRender('parts'),
    setStatus: host.setStatus,
    capture: host.capture,
    draft: () => session.draft,
    skill: () => session.draft.skill ?? BUILTIN_SKILL,
    setSkill: (s) => void chooseSkill(s),
    openOverview: () => openOverview(),
    openCompare: (jobId, list) => void openCompare(jobId, list)
  })

  // ---------- state helpers ----------

  const recommendInput = (): RecommendInput => ({
    overview: state?.overview ?? null,
    base: session.draft.tokens,
    locks: session.draft.locks
  })

  function setDraft(patch: Partial<UiuxDraft>, record = true): void {
    if (record) {
      undoStack.push(clone(session.draft))
      if (undoStack.length > 100) undoStack.shift()
      redoStack.length = 0
    }
    session = editDraft(session, patch)
    changed()
  }

  function setTokens(next: DesignTokens, record = true): void {
    setDraft({ tokens: next }, record)
  }

  function changed(): void {
    samples?.update(session.draft.tokens)
    render()
    renderApplied()
    host.onStatusChange()
  }

  const isLocked = (path: TokenPath): boolean => session.draft.locks.some((l) => path === l || path.startsWith(`${l}.`))

  function toggleLock(path: TokenPath): void {
    const locks = isLocked(path) && session.draft.locks.includes(path)
      ? session.draft.locks.filter((l) => l !== path)
      : [...session.draft.locks, path]
    setDraft({ locks })
  }

  // ---------- projects ----------

  async function loadProjects(selectId?: string): Promise<void> {
    projects = await host.api.listProjects()
    const id = selectId ?? state?.profile.projectId ?? projects[0]?.projectId ?? null
    await selectProject(id)
  }

  async function selectProject(id: string | null): Promise<void> {
    state = id ? await host.api.projectState(id) : null
    const base = state?.rules?.tokens ?? defaultTokens()
    const locks = state?.rules?.locks ?? []
    if (session.projectId !== (state?.profile.projectId ?? null)) {
      const wasApplied = status(session) !== 'off'
      session = switchProject(session, state?.profile.projectId ?? null, base, locks)
      undoStack.length = 0
      redoStack.length = 0
      if (wasApplied) host.setStatus(t('uiux.panel.releasedOnSwitch'))
      mockup = null
      previews.clear()
    }
    await agent.load(state?.profile.projectId ?? null)
    session = editDraft(session, { skill: skillFor(state?.profile ?? null) })
    changed()
  }

  /** The project's chosen skill; an agent skill the agent no longer lists falls back to the built-in rules. */
  const skillFor = (p: ProjectProfile | null): SkillRef => {
    const id = p?.skillIds?.[0]
    return (id && id !== BUILTIN_SKILL.id && agent.findSkill(id)) || BUILTIN_SKILL
  }

  async function chooseSkill(s: SkillRef): Promise<void> {
    setDraft({ skill: s })
    if (!state) return
    try {
      await host.api.saveProject({ ...state.profile, skillIds: [s.id] })
      state = await host.api.projectState(state.profile.projectId)
      render()
    } catch (err) {
      fail(err)
    }
  }

  // ---------- big views: overview and proposal comparison ----------

  function openBig(titleKey: string, body: HTMLElement, onClose?: () => void): () => void {
    const d = el('dialog', 'uxp-big')
    d.dataset.hotkeysOff = ''
    d.setAttribute('aria-label', t(titleKey))
    const head = el('div', 'uxp-head')
    const close = (): void => {
      onClose?.()
      d.close()
      d.remove()
    }
    const x = button('✕', close, 'btn icon uxp-close', 'big-close')
    x.setAttribute('aria-label', t('uiux.panel.close'))
    // The view brings its own heading; the frame only adds the close button.
    head.append(el('span', 'uxp-grow'), x)
    d.append(head, body)
    d.addEventListener('cancel', (e) => { e.preventDefault(); close() })
    document.body.append(d)
    d.showModal()
    return close
  }

  async function mockupsFor(jobId: string, list: DesignProposal[]): Promise<Record<string, string>> {
    const cached = previews.get(jobId)
    if (cached) return cached
    const urls = await Promise.all(list.map((p) => (p.previewKind === 'mockup' ? host.api.proposalPreview(jobId, p.proposalId) : null)))
    const mockups: Record<string, string> = {}
    list.forEach((p, i) => { const url = urls[i]; if (url) mockups[p.proposalId] = url })
    previews.set(jobId, mockups)
    return mockups
  }

  async function openCompare(jobId: string, list: DesignProposal[]): Promise<void> {
    let mockups: Record<string, string>
    try {
      mockups = await mockupsFor(jobId, list)
    } catch (err) {
      fail(err)
      return
    }
    let close = (): void => undefined
    const view = createCompareView({
      t,
      original: host.baseCapture(),
      base: session.base,
      locks: session.draft.locks,
      proposals: list,
      mockups,
      currentOverviewRevision: state?.overview?.revision,
      onRequest: (tokens, proposal) => {
        setDraft({ tokens: clone(tokens), selectedProposalId: proposal.proposalId })
        const shot = mockups[proposal.proposalId]
        mockup = shot ? { proposalId: proposal.proposalId, dataUrl: shot, tokens: clone(tokens) } : null
        session = apply(session)
        changed()
        close()
        host.setStatus(t('uiux.panel.proposalApplied', { name: proposal.name }))
      }
    })
    close = openBig('uiux.compare.title', view.el, () => view.destroy())
  }

  function openOverview(): void {
    const o = state?.overview
    if (!o) return
    const projectId = o.projectId
    const view = openOverviewView(o, {
      t,
      onExport: (format, pngDataUrl) => {
        void host.api.exportOverview(projectId, format, pngDataUrl).then(
          (r) => { if (r.ok) host.setStatus(t('uiux.ov.exported')) },
          fail
        )
      },
      onEdit: () => {
        view.close()
        overviewFormOpen = true
        if (!open) toggle(true)
        else render()
      }
    })
  }

  async function createProject(name: string): Promise<void> {
    if (!name.trim()) return
    try {
      const p = await host.api.createProject({ name })
      newProjectOpen = false
      await loadProjects(p.projectId)
      overviewFormOpen = true
      render()
    } catch (err) {
      fail(err)
    }
  }

  async function pickFolder(): Promise<void> {
    if (!state) return
    const f = await host.api.pickFolder()
    if (!f) return
    await host.api.setPath(state.profile.projectId, f)
    state = await host.api.projectState(state.profile.projectId)
    render()
  }

  async function saveOverview(input: UserOverviewInput): Promise<void> {
    if (!state) return
    try {
      await host.api.saveUserOverview(state.profile.projectId, input)
      state = await host.api.projectState(state.profile.projectId)
      overviewFormOpen = false
      host.setStatus(t('uiux.panel.overviewSaved'))
      render()
    } catch (err) {
      fail(err)
    }
  }

  async function saveRules(): Promise<void> {
    if (!state) return
    try {
      await host.api.saveRules(state.profile.projectId, { tokens: session.draft.tokens, locks: session.draft.locks, skill: session.draft.skill })
      state = await host.api.projectState(state.profile.projectId)
      host.setStatus(t('uiux.panel.rulesSaved', { revision: state?.rules?.revision ?? 0 }))
      render()
    } catch (err) {
      fail(err)
    }
  }

  // ---------- render ----------

  /**
   * Re-rendering replaces the controls; keep focus on the same one (by its data-ux handle), or a key the user
   * presses next would go to the editor (Enter = 보내기). Read before building: the agent parts move their nodes.
   */
  function keepFocus(build: () => void): void {
    const active = document.activeElement
    const focused = active instanceof HTMLElement && m.panel.contains(active) ? active.dataset.ux : undefined
    const scroll = m.panel.scrollTop
    build()
    m.panel.scrollTop = scroll
    const target = focused ? m.panel.querySelector<HTMLElement>(`[data-ux="${CSS.escape(focused)}"]`) : null
    if (target) {
      if (target !== document.activeElement) target.focus()
    } else if (active instanceof HTMLElement && !active.isConnected) m.panel.focus()
  }

  /** The whole panel: after the user's edits and project changes. */
  function render(): void {
    if (!open) return
    pendingJobRender = null
    keepFocus(() => {
      const frag = document.createDocumentFragment()
      const head = el('div', 'uxp-head')
      head.append(el('h2', 'uxp-title', t('uiux.panel.title')), button('✕', () => toggle(false), 'btn icon uxp-close'))
      head.lastElementChild?.setAttribute('aria-label', t('uiux.panel.close'))
      frag.append(head, renderProject())
      if (state) frag.append(renderSkill(), section('uiux.pr.title', agent.proposals()), renderAdjust(), renderRules())
      frag.append(renderSummary())
      if (state) frag.append(section('uiux.rp.title', agent.report()))
      m.panel.replaceChildren(frag)
    })
  }

  /**
   * After a job event: only the agent parts ('full' when the project state changed). Waits while the user is
   * composing text (Korean IME) in a panel field, until compositionend or blur.
   */
  function jobRender(kind: 'parts' | 'full'): void {
    if (!open) return
    const a = document.activeElement
    if (composing && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) && m.panel.contains(a)) {
      if (pendingJobRender !== 'full') pendingJobRender = kind
      return
    }
    if (kind === 'full') render()
    else keepFocus(() => agent.renderParts())
  }

  function flushJobRender(): void {
    const kind = pendingJobRender
    if (!kind) return
    pendingJobRender = null
    queueMicrotask(() => jobRender(kind))
  }

  function section(titleKey: string, ...children: Node[]): HTMLElement {
    const s = el('section', 'uxp-section')
    s.append(el('h3', 'uxp-h', t(titleKey)), ...children)
    return s
  }

  function renderProject(): HTMLElement {
    const sel = el('select', 'uxp-select')
    sel.setAttribute('aria-label', t('uiux.panel.project'))
    const none = el('option', undefined, t('uiux.panel.noProject'))
    none.value = ''
    sel.append(none)
    for (const p of projects) {
      const o = el('option', undefined, p.name)
      o.value = p.projectId
      if (p.projectId === state?.profile.projectId) o.selected = true
      sel.append(o)
    }
    sel.addEventListener('change', () => void selectProject(sel.value || null))
    const row = el('div', 'uxp-row')
    row.append(sel, button(t('uiux.panel.newProject'), () => { newProjectOpen = !newProjectOpen; render() }, 'btn small', 'new-project'))
    const parts: Node[] = [row]
    if (newProjectOpen) {
      const name = el('input', 'uxp-input')
      name.dataset.ux = 'project-name'
      name.placeholder = t('uiux.panel.projectName')
      name.setAttribute('aria-label', t('uiux.panel.projectName'))
      const form = el('div', 'uxp-row')
      form.append(name, button(t('uiux.panel.create'), () => void createProject(name.value), 'btn small accent', 'create-project'))
      parts.push(form)
      queueMicrotask(() => name.focus())
    }
    if (state) {
      const folder = el('div', 'uxp-row uxp-muted')
      folder.append(el('span', 'uxp-grow', state.folder ? t('uiux.panel.folder', { path: state.folder }) : t('uiux.panel.noFolder')), button(t('uiux.panel.pickFolder'), () => void pickFolder()))
      parts.push(folder, renderOverview(), agent.profile((id) => void loadProjects(id)))
    }
    return section('uiux.panel.project', ...parts)
  }

  function renderOverview(): HTMLElement {
    const box = el('div', 'uxp-overview')
    const o = state?.overview ?? null
    const line = el('div', 'uxp-row')
    const statusText = !o
      ? t('uiux.panel.overviewNone')
      : o.basis === 'user'
        ? t('uiux.panel.overviewUser', { revision: o.revision })
        : t('uiux.panel.overviewAgent', { revision: o.revision })
    line.append(el('span', 'uxp-grow', statusText), button(o ? t('uiux.panel.editOverview') : t('uiux.panel.enterOverview'), () => { overviewFormOpen = !overviewFormOpen; render() }, 'btn small', 'overview-form'))
    box.append(line)
    if (o && !overviewFormOpen) {
      if (o.summary.value) box.append(el('p', 'uxp-text', o.summary.value))
      if (o.purpose.value) box.append(el('p', 'uxp-text uxp-muted', o.purpose.value))
    }
    if (overviewFormOpen) box.append(overviewForm(o))
    box.append(agent.overview())
    return box
  }

  function overviewForm(o: UiuxProjectState['overview']): HTMLElement {
    const form = el('div', 'uxp-form')
    const field = (key: string, value: string, multi: boolean): HTMLInputElement | HTMLTextAreaElement => {
      const label = el('label', 'uxp-label', t(key))
      const input = multi ? el('textarea', 'uxp-input') : el('input', 'uxp-input')
      input.value = value
      if (multi) (input as HTMLTextAreaElement).rows = 2
      label.append(input)
      form.append(label)
      return input
    }
    const summary = field('uiux.panel.ovSummary', o?.summary.value ?? '', false)
    const purpose = field('uiux.panel.ovPurpose', o?.purpose.value ?? '', true)
    const audiences = field('uiux.panel.ovAudiences', (o?.audiences ?? []).map((c) => c.value).join('\n'), true)
    const goals = field('uiux.panel.ovGoals', (o?.goals ?? []).map((c) => c.value).join('\n'), true)
    const screens = field('uiux.panel.ovScreens', (o?.designState ?? []).filter((c) => c.value.startsWith('screen: ')).map((c) => c.value.slice(8)).join('\n'), true)
    form.append(el('p', 'uxp-hint', t('uiux.panel.ovUserBasis')))
    form.append(button(t('uiux.panel.save'), () => void saveOverview({
      summary: summary.value, purpose: purpose.value, audiences: lines(audiences.value), goals: lines(goals.value), screenKinds: lines(screens.value)
    }), 'btn small accent', 'save-overview'))
    return form
  }

  function renderSkill(): HTMLElement {
    return section('uiux.panel.skill', agent.skills(BUILTIN_SKILL))
  }

  function renderAdjust(): HTMLElement {
    const parts: Node[] = [renderScope()]
    const tabs = el('div', 'uxp-tabs')
    tabs.setAttribute('role', 'tablist')
    for (const a of AREAS) {
      const b = button(t(`uiux.panel.area.${a}`), () => { area = a; render() }, 'uxp-tab', `tab-${a}`)
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(a === area))
      tabs.append(b)
    }
    const hist = el('div', 'uxp-row')
    const undoB = button(t('uiux.panel.undo'), () => {
      const prev = undoStack.pop()
      if (!prev) return
      redoStack.push(clone(session.draft))
      setDraft(prev, false)
    })
    undoB.disabled = !undoStack.length
    const redoB = button(t('uiux.panel.redo'), () => {
      const next = redoStack.pop()
      if (!next) return
      undoStack.push(clone(session.draft))
      setDraft(next, false)
    })
    redoB.disabled = !redoStack.length
    hist.append(undoB, redoB, button(t('uiux.panel.resetArea'), () => resetArea()), button(t('uiux.panel.resetAll'), () => setTokens(clone(session.base))))
    parts.push(tabs, renderArea(), hist, renderSamples(), renderChecks(), renderPreserve())
    return section('uiux.panel.adjust', ...parts)
  }

  function resetArea(): void {
    const next = clone(session.draft.tokens) as unknown as Record<Area, unknown>
    const base = session.base as unknown as Record<Area, unknown>
    if (isLocked(area)) return
    if (area === 'colors') {
      for (const r of COLOR_ROLES) if (!isLocked(`colors.${r}`)) (next.colors as Record<ColorRole, string>)[r] = (base.colors as Record<ColorRole, string>)[r]
    } else next[area] = clone(base[area])
    setTokens(next as unknown as DesignTokens)
  }

  function renderScope(): HTMLElement {
    const box = el('div', 'uxp-scope')
    const sc = session.draft.scope
    const kinds: ('all' | 'component' | 'annotations')[] = ['all', 'component', 'annotations']
    const seg = el('div', 'seg')
    seg.setAttribute('role', 'radiogroup')
    seg.setAttribute('aria-label', t('uiux.panel.scope'))
    for (const k of kinds) {
      const b = button(t(`uiux.panel.scope.${k}`), () => setDraft({ scope: k === 'annotations' ? { kind: k, annotationIds: sc.annotationIds ?? [] } : k === 'component' ? { kind: k, component: sc.component ?? 'button' } : { kind: 'all' } }), '')
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(sc.kind === k))
      if (sc.kind === k) b.classList.add('active')
      seg.append(b)
    }
    box.append(el('span', 'uxp-label', t('uiux.panel.scope')), seg)
    if (sc.kind === 'component') {
      const sel = el('select', 'uxp-select')
      for (const c of ['button', 'card', 'input', 'table'] as const) {
        const o = el('option', undefined, t(`uiux.panel.component.${c}`))
        o.value = c
        if (sc.component === c) o.selected = true
        sel.append(o)
      }
      sel.addEventListener('change', () => setDraft({ scope: { kind: 'component', component: sel.value as 'button' } }))
      box.append(sel)
    }
    if (sc.kind === 'annotations') {
      const anns = host.annotations()
      const ids = new Set(sc.annotationIds ?? [])
      if (!anns.length) box.append(el('p', 'uxp-hint', t('uiux.panel.noMarks')))
      anns.forEach((a, i) => {
        if (!a.id) return
        const id = a.id
        const lab = el('label', 'uxp-check')
        const cb = el('input')
        cb.type = 'checkbox'
        cb.checked = ids.has(id)
        cb.addEventListener('change', () => {
          const next = new Set(session.draft.scope.annotationIds ?? [])
          if (cb.checked) next.add(id)
          else next.delete(id)
          setDraft({ scope: { kind: 'annotations', annotationIds: [...next] } })
        })
        lab.append(cb, document.createTextNode(t('uiux.panel.markItem', { n: i + 1, kind: t(`uiux.panel.kind.${a.kind}`) })))
        box.append(lab)
      })
      const missing = missingAnnotations(sc, anns.map((a) => a.id ?? ''))
      if (missing.length) {
        const row = el('div', 'uxp-row uxp-warn')
        row.append(el('span', 'uxp-grow', t('uiux.panel.missingMarks', { n: missing.length })), button(t('uiux.panel.dropMissing'), () => setDraft({ scope: { kind: 'annotations', annotationIds: (sc.annotationIds ?? []).filter((x) => !missing.includes(x)) } })))
        box.append(row)
      }
    }
    return box
  }

  function optionChips<T>(opts: Option<T>[], applyOpt: (o: Option<T>) => void): HTMLElement {
    const box = el('div', 'uxp-options')
    if (!state?.overview) box.append(el('p', 'uxp-hint', t('uiux.panel.optionsGeneral')))
    for (const o of opts) {
      const card = el('div', 'uxp-option')
      const b = button(t(o.labelKey, o.params), () => applyOpt(o), 'btn small', `option-${o.id}`)
      if (o.recommended) {
        b.classList.add('accent')
        card.append(el('span', 'uxp-badge', t('uiux.panel.recommended')))
      }
      card.append(b, el('p', 'uxp-reason', t(o.reasonKey, o.params)))
      box.append(card)
    }
    return box
  }

  function lockButton(path: TokenPath): HTMLButtonElement {
    const locked = session.draft.locks.includes(path)
    const b = button(locked ? t('uiux.panel.locked') : t('uiux.panel.lock'), () => toggleLock(path), 'btn small uxp-lock')
    b.setAttribute('aria-pressed', String(locked))
    return b
  }

  function numberField(label: string, value: number, min: number, max: number, step: number, onChange: (v: number, live: boolean) => void, disabled = false): HTMLElement {
    const lab = el('label', 'uxp-field')
    const range = el('input')
    range.type = 'range'
    range.min = String(min)
    range.max = String(max)
    range.step = String(step)
    range.value = String(value)
    range.disabled = disabled
    const num = el('input', 'uxp-numin')
    num.type = 'number'
    num.min = String(min)
    num.max = String(max)
    num.step = String(step)
    num.value = String(value)
    num.disabled = disabled
    // Sliders update the samples live without filling the undo history; the history records on release.
    range.addEventListener('input', () => { num.value = range.value; onChange(Number(range.value), true) })
    range.addEventListener('change', () => onChange(Number(range.value), false))
    num.addEventListener('change', () => { range.value = num.value; onChange(Number(num.value), false) })
    lab.append(el('span', 'uxp-label', label), range, num)
    return lab
  }

  function renderArea(): HTMLElement {
    const box = el('div', 'uxp-area')
    const tk = session.draft.tokens
    const areaLocked = isLocked(area)
    box.append(lockButton(area))
    const patch = (fn: (draft: DesignTokens) => void, live = false): void => {
      if (areaLocked) return
      const next = clone(session.draft.tokens)
      fn(next)
      if (live) {
        if (!gesture) {
          undoStack.push(clone(session.draft))
          redoStack.length = 0
          gesture = true
        }
        session = editDraft(session, { tokens: next })
        samples?.update(next)
        renderApplied()
        host.onStatusChange()
      } else if (gesture) {
        gesture = false
        session = editDraft(session, { tokens: next })
        changed()
      } else setTokens(next)
    }
    if (area === 'colors') {
      box.append(optionChips(colorStrategies(recommendInput()), (o) => patch((d) => { for (const r of COLOR_ROLES) if (!isLocked(`colors.${r}`)) d.colors[r] = o.value[r] })))
      for (const r of COLOR_ROLES) {
        const row = el('div', 'uxp-row uxp-color')
        const locked = isLocked(`colors.${r}`)
        const picker = el('input')
        picker.type = 'color'
        picker.value = tk.colors[r].toLowerCase()
        picker.disabled = locked
        picker.setAttribute('aria-label', t(`uiux.panel.role.${r}`))
        const hex = el('input', 'uxp-hex')
        hex.value = tk.colors[r]
        hex.disabled = locked
        hex.setAttribute('aria-label', t('uiux.panel.hexOf', { role: t(`uiux.panel.role.${r}`) }))
        picker.addEventListener('change', () => patch((d) => { d.colors[r] = picker.value.toUpperCase() }))
        hex.addEventListener('change', () => {
          if (/^#[0-9a-fA-F]{6}$/.test(hex.value.trim())) patch((d) => { d.colors[r] = hex.value.trim().toUpperCase() })
          else hex.value = tk.colors[r]
        })
        row.append(el('span', 'uxp-label uxp-grow', t(`uiux.panel.role.${r}`)), picker, hex, lockButton(`colors.${r}`))
        box.append(row)
      }
    } else if (area === 'ratio') {
      box.append(optionChips(ratioOptions(recommendInput()), (o) => patch((d) => { d.ratio = clone(o.value) })))
      box.append(el('p', 'uxp-hint', t('uiux.panel.ratioTarget')))
      box.append(numberField(t('uiux.panel.ratio.background'), tk.ratio.background, 0, 100, 1, (v, live) => patch((d) => { d.ratio.background = v; d.ratio.surface = Math.max(0, 100 - v - d.ratio.accent) }, live), areaLocked))
      box.append(numberField(t('uiux.panel.ratio.accent'), tk.ratio.accent, 0, 50, 1, (v, live) => patch((d) => { d.ratio.accent = v; d.ratio.surface = Math.max(0, 100 - v - d.ratio.background) }, live), areaLocked))
      box.append(el('p', 'uxp-muted', t('uiux.panel.ratio.sum', { bg: tk.ratio.background, surface: tk.ratio.surface, accent: tk.ratio.accent })))
    } else if (area === 'shadows') {
      box.append(optionChips(shadowOptions(recommendInput()), (o) => patch((d) => { d.shadows = clone(o.value) })))
      for (const r of SHADOW_ROLES) {
        const s = tk.shadows[r]
        const sub = el('div', 'uxp-sub')
        const on = el('input')
        on.type = 'checkbox'
        on.checked = s !== null
        on.disabled = areaLocked
        on.addEventListener('change', () => patch((d) => { d.shadows[r] = on.checked ? { x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.12 } : null }))
        const lab = el('label', 'uxp-check')
        lab.append(on, document.createTextNode(t(`uiux.panel.shadowRole.${r}`)))
        sub.append(lab)
        if (s) {
          const set = (k: keyof ShadowSpec) => (v: number, live: boolean) => patch((d) => { const sh = d.shadows[r]; if (sh) (sh[k] as number) = v }, live)
          sub.append(
            numberField(t('uiux.panel.shadow.y'), s.y, -20, 20, 1, set('y'), areaLocked),
            numberField(t('uiux.panel.shadow.blur'), s.blur, 0, 48, 1, set('blur'), areaLocked),
            numberField(t('uiux.panel.shadow.spread'), s.spread, -10, 10, 1, set('spread'), areaLocked),
            numberField(t('uiux.panel.shadow.opacity'), Math.round(s.opacity * 100), 0, 60, 1, (v, live) => set('opacity')(v / 100, live), areaLocked)
          )
        }
        box.append(sub)
      }
    } else if (area === 'type') {
      box.append(optionChips(typeOptions(recommendInput()), (o) => patch((d) => { d.type = clone(o.value) })))
      for (const r of TYPE_ROLES) {
        const ty = tk.type[r]
        const sub = el('div', 'uxp-sub')
        sub.append(el('span', 'uxp-label', t(`uiux.panel.typeRole.${r}`)))
        const fam = el('input', 'uxp-input')
        fam.value = ty.family
        fam.disabled = areaLocked
        fam.setAttribute('aria-label', t('uiux.panel.fontFamily'))
        fam.addEventListener('change', () => {
          const v = fam.value.trim().replace(/[;{}<>"]/g, '').slice(0, 80)
          if (v) patch((d) => { d.type[r].family = v })
        })
        sub.append(fam,
          numberField(t('uiux.panel.fontSize'), ty.size, 10, 48, 1, (v, live) => patch((d) => { d.type[r].size = v }, live), areaLocked),
          numberField(t('uiux.panel.fontWeight'), ty.weight, 100, 900, 100, (v, live) => patch((d) => { d.type[r].weight = v }, live), areaLocked),
          numberField(t('uiux.panel.lineHeight'), ty.lineHeight, 1, 2.2, 0.05, (v, live) => patch((d) => { d.type[r].lineHeight = v }, live), areaLocked))
        box.append(sub)
      }
    } else {
      box.append(optionChips(boxOptions(recommendInput()), (o) => patch((d) => { d.box = clone(o.value) })))
      box.append(
        numberField(t('uiux.panel.box.radius'), tk.box.radius, 0, 24, 1, (v, live) => patch((d) => { d.box.radius = v }, live), areaLocked),
        numberField(t('uiux.panel.box.paddingX'), tk.box.paddingX, 0, 40, 1, (v, live) => patch((d) => { d.box.paddingX = v }, live), areaLocked),
        numberField(t('uiux.panel.box.paddingY'), tk.box.paddingY, 0, 32, 1, (v, live) => patch((d) => { d.box.paddingY = v }, live), areaLocked),
        numberField(t('uiux.panel.box.gap'), tk.box.gap, 0, 40, 1, (v, live) => patch((d) => { d.box.gap = v }, live), areaLocked)
      )
      box.append(el('p', 'uxp-hint', t('uiux.panel.box.units')))
    }
    return box
  }

  function renderSamples(): HTMLElement {
    const box = el('div', 'uxp-samples-host')
    if (!samples) samples = createSampleView(session.draft.tokens, { t })
    else samples.update(session.draft.tokens)
    box.append(samples.el)
    return box
  }

  function currentChecks(): Check[] {
    return tokenChecks(session.draft.tokens)
  }

  function renderChecks(): HTMLElement {
    const list = el('ul', 'uxp-checks')
    for (const c of currentChecks()) {
      const li = el('li', c.status === 'fail' ? 'uxp-fail' : 'uxp-pass')
      li.textContent = `${c.status === 'fail' ? '✕' : '✓'} ${t(c.label)}${c.note ? ` · ${c.note}` : ''}`
      list.append(li)
    }
    return list
  }

  function renderPreserve(): HTMLElement {
    const lab = el('label', 'uxp-label', t('uiux.panel.preserve'))
    const ta = el('textarea', 'uxp-input')
    ta.rows = 2
    ta.value = session.draft.preserve.join('\n')
    ta.placeholder = t('uiux.panel.preserveHint')
    ta.addEventListener('change', () => setDraft({ preserve: lines(ta.value).slice(0, 20) }))
    lab.append(ta)
    return lab
  }

  function renderRules(): HTMLElement {
    const r = state?.rules ?? null
    const text = r ? t('uiux.panel.rulesStatus', { revision: r.revision, skill: r.skill?.name ?? t('uiux.panel.builtinSkill') }) : t('uiux.panel.rulesNone')
    const row = el('div', 'uxp-row')
    row.append(button(t('uiux.panel.saveRules'), () => void saveRules(), 'btn small', 'save-rules'))
    if (r) row.append(button(t('uiux.panel.loadRules'), () => setDraft({ tokens: clone(r.tokens), locks: [...r.locks] })))
    return section('uiux.panel.rules', el('p', 'uxp-muted', text), row, el('p', 'uxp-hint', t('uiux.panel.rulesHint')))
  }

  function renderSummary(): HTMLElement {
    const st = status(session)
    const changes = diffTokens(session.base, session.draft.tokens)
    const parts: Node[] = []
    const stateText = st === 'off' ? t('uiux.panel.stateOff') : st === 'applied' ? (isSent(session) ? t('uiux.panel.stateSent') : t('uiux.panel.stateApplied')) : t('uiux.panel.stateStale')
    parts.push(el('p', `uxp-state uxp-state-${st}`, stateText))
    if (changes.length) {
      const ul = el('ul', 'uxp-changes')
      for (const c of changes.slice(0, 12)) ul.append(el('li', undefined, `${c.path}: ${String(c.from)} → ${String(c.to)}`))
      if (changes.length > 12) ul.append(el('li', 'uxp-muted', t('uiux.panel.moreChanges', { n: changes.length - 12 })))
      parts.push(ul)
    } else parts.push(el('p', 'uxp-hint', t('uiux.panel.noChanges')))
    const row = el('div', 'uxp-row')
    if (!state) {
      parts.push(el('p', 'uxp-hint', t('uiux.panel.needProject')))
    } else if (st === 'off') {
      row.append(button(t('uiux.panel.addToRequest'), () => { session = apply(session); changed() }, 'btn small accent', 'add-to-request'))
    } else {
      if (st === 'stale') {
        row.append(button(t('uiux.panel.reflect'), () => { session = apply(session); changed() }, 'btn small accent'))
        row.append(button(t('uiux.panel.discard'), () => { session = discardDraftChanges(session); changed() }))
      }
      row.append(button(t('uiux.panel.release'), () => { session = release(session); changed() }, 'btn small', 'release'))
    }
    parts.push(row)
    return section('uiux.panel.summary', ...parts)
  }

  function renderApplied(): void {
    const st = status(session)
    m.toggle.classList.toggle('uxp-on', st !== 'off')
    m.toggle.setAttribute('aria-pressed', String(open))
    if (st === 'off') {
      m.appliedBar.hidden = true
      m.appliedBar.replaceChildren()
      return
    }
    m.appliedBar.hidden = false
    const text = el('span', st === 'stale' ? 'sb-warn' : 'uxp-applied-text', st === 'stale' ? t('uiux.panel.barStale') : t('uiux.panel.barApplied'))
    const parts: Node[] = [text]
    if (st === 'stale') parts.push(button(t('uiux.panel.reflect'), () => { session = apply(session); changed() }))
    parts.push(button(t('uiux.panel.release'), () => { session = release(session); changed() }))
    m.appliedBar.replaceChildren(...parts)
  }

  // ---------- memo suggestions ----------

  function renderSuggestions(): void {
    if (!state) {
      m.suggestBar.hidden = true
      return
    }
    const list = suggestions({
      memo: host.memo.value,
      annotationKinds: host.annotations().map((a) => a.kind),
      tokens: session.draft.tokens,
      rules: state.rules,
      skill: session.draft.skill ?? BUILTIN_SKILL,
      checks: currentChecks()
    }, 4)
    if (!list.length) {
      m.suggestBar.hidden = true
      return
    }
    m.suggestBar.hidden = false
    const items = list.map((s) => {
      const phrase = t(s.key, s.params)
      return button(phrase, () => {
        const cur = host.memo.value.trim()
        host.memo.value = cur ? `${cur} · ${phrase}` : phrase
        host.memo.dispatchEvent(new Event('input'))
        host.memo.focus()
      }, 'uxp-chip')
    })
    const label = el('span', 'uxp-suggest-label', t('uiux.panel.suggestLabel'))
    m.suggestBar.replaceChildren(label, ...items)
  }
  host.memo.addEventListener('input', renderSuggestions)
  host.memo.addEventListener('focus', renderSuggestions)

  // ---------- send ----------

  function staleDialog(): Promise<'reflect' | 'discard' | 'cancel'> {
    return new Promise((resolve) => {
      const d = el('dialog', 'uxp-dialog')
      d.dataset.hotkeysOff = ''
      d.append(el('p', undefined, t('uiux.panel.staleQuestion')))
      const row = el('div', 'uxp-row')
      const done = (v: 'reflect' | 'discard' | 'cancel') => () => { d.close(); d.remove(); resolve(v) }
      row.append(button(t('uiux.panel.reflectAndSend'), done('reflect'), 'btn small accent', 'dialog-reflect'), button(t('uiux.panel.sendWithoutChanges'), done('discard'), 'btn small', 'dialog-discard'), button(t('uiux.panel.cancel'), done('cancel'), 'btn small', 'dialog-cancel'))
      d.append(row)
      d.addEventListener('cancel', () => { d.remove(); resolve('cancel') })
      document.body.append(d)
      d.showModal()
    })
  }

  function toggle(force?: boolean): void {
    open = force ?? !open
    m.panel.hidden = !open
    if (open && !loaded) {
      loaded = true
      void loadProjects().catch(fail)
    }
    render()
    renderApplied()
    if (open) m.panel.querySelector<HTMLElement>('select, button')?.focus()
    else m.toggle.focus()
  }

  m.toggle.addEventListener('click', () => toggle())
  renderApplied()

  return {
    toggle,
    isOpen: () => open,
    status: () => status(session),
    payload(): UiuxPayload | undefined {
      const req = buildRequest(session, {
        projectName: state?.profile.name ?? '',
        overview: state?.overview ?? null,
        rules: state?.rules ?? null,
        checks: tokenChecks(session.applied?.tokens ?? session.draft.tokens)
      })
      if (!req) return undefined
      const shot = mockup && req.selectedProposalId === mockup.proposalId && JSON.stringify(req.resolved) === JSON.stringify(mockup.tokens) ? mockup.dataUrl : undefined
      return shot ? { request: req, previewPngDataUrl: shot } : { request: req }
    },
    async beforeSend(): Promise<boolean> {
      if (status(session) !== 'stale') return true
      const c = await staleDialog()
      if (c === 'cancel') return false
      session = c === 'reflect' ? apply(session) : discardDraftChanges(session)
      changed()
      return true
    },
    markSent(reportJobId) {
      session = markSent(session)
      render()
      // A send with guidance made an implementation_report job: show it under "AI 작업 결과". Its later states
      // arrive as job updates; only the job itself is fetched here when the update has not come yet.
      if (reportJobId) void agent.track(reportJobId)
    },
    annotationsChanged() {
      if (open && session.draft.scope.kind === 'annotations') render()
      renderSuggestions()
    }
  }
}
