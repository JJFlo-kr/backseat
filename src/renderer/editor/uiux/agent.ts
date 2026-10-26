// The agent side of the UI/UX panel (stages B–D): jobs the project's agent answers through the Backseat MCP
// server — project overview, its skills and what they need, design proposals, style audit and the report of
// what it changed after a send. The panel owns the layout; this module renders those parts and keeps the jobs.
// Each part has its own mount node, so a job event re-renders only the agent parts (renderParts), never the
// user's form fields around them.
// Agent results are shown as the agent's claims: nothing here marks work done without the user.
import type { UiuxApi, UiuxProjectState } from '../../../shared/types'
import type { Translate } from '../../../shared/i18n'
import type {
  DesignProposal, DesignScope, DesignTokens, JobOutcome, JobRequest, JobStatus, JobType, SkillContext, SkillRef,
  TokenPath, UiuxJob
} from '../../../shared/uiux/types'
import { overviewCompleteness } from '../../../shared/uiux/validate'
import { errText } from '../../../shared/errors'
import { button, el, showValue } from './dom'

export interface AgentHost {
  t: Translate
  api: UiuxApi
  state(): UiuxProjectState | null
  /** Reload the project state (overview, rules) and re-render the panel. */
  refresh(): Promise<void>
  /** Agent data changed: re-render the agent parts (the panel may defer it while the user is typing). */
  rerender(): void
  setStatus(msg: string, isError?: boolean): void
  /** The capture for proposals and audits, blur applied: the clean capture and the one with marks. */
  capture(): { capturePng: string; annotatedPng: string }
  draft(): { tokens: DesignTokens; locks: TokenPath[]; scope: DesignScope; preserve: string[] }
  skill(): SkillRef
  setSkill(s: SkillRef): void
  openOverview(): void
  openCompare(jobId: string, proposals: DesignProposal[]): void
  /** Puts a phrase into the memo of this send (the user clicked it). */
  addToMemo(text: string): void
}

export interface AgentParts {
  /** Project changed (or first open): reload jobs, skills and proposals. */
  load(projectId: string | null): Promise<void>
  /** A job made elsewhere (the report job of a send): make sure it is listed, without reloading the rest. */
  track(jobId: string): Promise<void>
  /** Re-fill the agent parts that are on screen, in place. */
  renderParts(): void
  overview(): HTMLElement
  skills(builtin: SkillRef): HTMLElement
  proposals(): HTMLElement
  report(): HTMLElement
  profile(onImported: (projectId: string) => void): HTMLElement
  /** An agent skill the project chose earlier, once the skill list is loaded. */
  findSkill(id: string): SkillRef | undefined
}

const ACTIVE: readonly JobStatus[] = ['pending', 'fetched']
/** Items of the after-send checklist (checklist()). */
const CHECK_ITEMS = 6

export function createAgentParts(host: AgentHost): AgentParts {
  const { t, api } = host
  let projectId: string | null = null
  let jobs: UiuxJob[] = []
  /** Outcome per submitted job of this project: the value, or the request in flight (so it is asked once). */
  const outcomes = new Map<string, JobOutcome | null | Promise<JobOutcome | null>>()
  /** Request text per job, kept so the user can copy or paste it again. */
  const requestTexts = new Map<string, string>()
  let agentSkills: SkillRef[] = []
  let contexts: SkillContext[] = []
  let proposalSets: { jobId: string; proposals: DesignProposal[]; overviewRevision?: number }[] = []
  let screenPurpose = ''
  /** The user's look at the latest report: checks ticked (by check id) and the confirm. Reset when the report changes. */
  /** The checklist of the report on screen; `confirmed` once the user's check is stored (or was stored earlier). */
  let review = { jobId: '', ticked: new Set<string>(), confirmed: false, synced: false }
  let builtinSkill: SkillRef | null = null

  // Mount nodes: the panel places them, job events re-fill them in place.
  const mounts = {
    overview: el('div', 'uxp-agent-overview'),
    skills: el('div', 'uxp-agent-skills'),
    proposals: el('div', 'uxp-agent-proposals'),
    report: el('div', 'uxp-report')
  }
  mounts.report.dataset.ux = 'report'
  // The screen-purpose field stays the same element across job renders (IME composition, caret).
  const purpose = el('input', 'uxp-input')
  purpose.dataset.ux = 'screen-purpose'
  purpose.addEventListener('input', () => { screenPurpose = purpose.value })
  const purposeLabel = el('label', 'uxp-label')
  const purposeTitle = document.createTextNode('')
  purposeLabel.append(purposeTitle, purpose)
  const proposalsBody = el('div')
  mounts.proposals.append(purposeLabel, proposalsBody)

  const fail = (err: unknown): void => host.setStatus(t('uiux.panel.error', { error: errText(err) }), true)

  const upsert = (job: UiuxJob): void => {
    jobs = [job, ...jobs.filter((j) => j.jobId !== job.jobId)]
  }

  api.onJobUpdate((job) => {
    if (job.projectId !== projectId) return
    upsert(job)
    // The status line follows the job: an old "request created" must not stay after it failed or ended.
    if (job.status !== 'pending' && job.status !== 'submitted') host.setStatus(t(`uiux.job.status.${job.status}`), job.status === 'failed' || job.status === 'rejected')
    if (job.status === 'submitted') void afterSubmit(job)
    else host.rerender()
  })

  async function afterSubmit(job: UiuxJob): Promise<void> {
    try {
      await fetchOutcome(job.jobId)
      if (job.type === 'project_overview') {
        await host.refresh()
        host.setStatus(t('uiux.agent.overviewArrived'))
      }
      if (job.type === 'capabilities' || job.type === 'skill_setup') await loadSkills()
      if (job.type === 'design_proposal') proposalSets = await api.proposals(job.projectId)
    } catch (err) {
      fail(err)
    }
    host.rerender()
  }

  /** The job's outcome, fetched once: concurrent asks share the request in flight. */
  async function fetchOutcome(jobId: string): Promise<JobOutcome | null> {
    const cur = outcomes.get(jobId)
    if (cur !== undefined) return cur
    const p = api.jobOutcome(jobId)
    outcomes.set(jobId, p)
    try {
      const o = await p
      if (outcomes.get(jobId) === p) outcomes.set(jobId, o)
      return o
    } catch (err) {
      if (outcomes.get(jobId) === p) outcomes.delete(jobId)
      throw err
    }
  }

  /** For rendering: the outcome when known; otherwise undefined, and it is fetched and the parts re-rendered. */
  function outcomeOf(job: UiuxJob): JobOutcome | null | undefined {
    const cur = outcomes.get(job.jobId)
    if (cur instanceof Promise) return undefined
    if (cur !== undefined) return cur
    void fetchOutcome(job.jobId).then(() => host.rerender(), fail)
    return undefined
  }

  async function loadSkills(): Promise<void> {
    if (!projectId) return
    const s = await api.skills(projectId)
    agentSkills = s.agent
    contexts = s.contexts
  }

  async function load(id: string | null): Promise<void> {
    if (id !== projectId) {
      projectId = id
      jobs = []
      outcomes.clear()
      agentSkills = []
      contexts = []
      proposalSets = []
    }
    if (!id) return
    const [j, s, p] = await Promise.all([api.listJobs(id), api.skills(id), api.proposals(id)])
    if (id !== projectId) return
    jobs = j
    agentSkills = s.agent
    contexts = s.contexts
    proposalSets = p
    const shown = [latest('implementation_report'), latest('project_overview')]
    await Promise.all(shown.filter((job): job is UiuxJob => job?.status === 'submitted').map((job) => fetchOutcome(job.jobId)))
  }

  async function track(jobId: string): Promise<void> {
    const id = projectId
    if (!id || jobs.some((j) => j.jobId === jobId)) return
    try {
      const job = (await api.listJobs(id)).find((j) => j.jobId === jobId)
      // An update may have delivered the job (newer) while the list was on its way.
      if (job && id === projectId && !jobs.some((j) => j.jobId === jobId)) upsert(job)
    } catch (err) {
      fail(err)
    }
    host.rerender()
  }

  const latest = (type: JobType, skillId?: string): UiuxJob | undefined =>
    jobs
      .filter((j) => j.type === type && (skillId === undefined || j.skillId === skillId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

  // ---------- one job: request, deliver, wait ----------

  async function request(req: JobRequest): Promise<void> {
    if (!projectId) return
    try {
      const r = await api.requestJob(projectId, req)
      upsert(r.job)
      requestTexts.set(r.job.jobId, r.requestText)
      host.setStatus(t('uiux.job.created'))
    } catch (err) {
      fail(err)
    }
    host.rerender()
  }

  /** Cancel or extend: the store answers with the changed job. */
  async function act(fn: () => Promise<UiuxJob>): Promise<void> {
    try {
      upsert(await fn())
    } catch (err) {
      fail(err)
    }
    host.rerender()
  }

  async function deliver(jobId: string, how: 'copy' | 'paste'): Promise<void> {
    try {
      const r = await api.deliverJob(jobId, how)
      host.setStatus(r.message, !r.ok)
    } catch (err) {
      fail(err)
    }
  }

  const until = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  /**
   * Status of the latest job of a kind with what the user can do next (spec §5.4): request, or while waiting
   * paste / copy the request text, extend, cancel; after a failure the reason and a retry.
   */
  function jobBox(type: JobType, startKey: string, make: () => JobRequest | null, skillId?: string): HTMLElement {
    const box = el('div', 'uxp-job')
    box.dataset.uxJob = type
    const job = latest(type, skillId)
    const start = (): void => {
      const req = make()
      if (req) void request(req)
    }
    if (!job || !ACTIVE.includes(job.status)) {
      const row = el('div', 'uxp-row')
      if (job) row.append(el('span', `uxp-grow uxp-job-${job.status}`, t(`uiux.job.status.${job.status}`)))
      row.append(button(t(job && job.status !== 'submitted' ? 'uiux.job.retry' : startKey), start, 'btn small', `job-${type}`))
      box.append(row)
      if (job?.error && (job.status === 'rejected' || job.status === 'failed')) box.append(el('p', 'uxp-warn', t('uiux.job.reason', { error: job.error })))
      if (job?.status === 'rejected') box.append(el('p', 'uxp-hint', t('uiux.job.rejectedHint')))
      return box
    }
    const head = el('div', 'uxp-row')
    head.append(
      el('span', `uxp-grow uxp-job-${job.status}`, t(`uiux.job.status.${job.status}`)),
      el('span', 'uxp-muted', t('uiux.job.until', { time: until(job.expiresAt) }))
    )
    const row = el('div', 'uxp-row')
    row.append(
      button(t('uiux.job.paste'), () => void deliver(job.jobId, 'paste'), 'btn small accent', `job-paste-${type}`),
      button(t('uiux.job.copy'), () => void deliver(job.jobId, 'copy'), 'btn small', `job-copy-${type}`),
      button(t('uiux.job.extend'), () => void act(() => api.extendJob(job.jobId, 5))),
      button(t('uiux.job.cancel'), () => void act(() => api.cancelJob(job.jobId)), 'btn small', `job-cancel-${type}`)
    )
    box.append(head, row)
    if (job.status === 'pending') box.append(el('p', 'uxp-hint', t('uiux.job.hint')))
    return box
  }

  // ---------- overview (stage B) ----------

  function fillOverview(): void {
    const st = host.state()
    const o = st?.overview ?? null
    const done = o ? overviewCompleteness(o) : { complete: false, gaps: [] }
    const doneB = button(t('uiux.ov.done'), () => host.openOverview(), done.complete ? 'btn small accent' : 'btn small', 'overview-done')
    doneB.title = t('uiux.ov.doneTip')
    doneB.disabled = !done.complete
    const row = el('div', 'uxp-row')
    row.append(doneB)
    if (o) {
      row.append(el('span', 'uxp-muted uxp-grow', t('uiux.ov.checkedAt', { date: new Date(o.generatedAt).toLocaleDateString() })))
    }
    const parts: Node[] = [row]
    if (o && !done.complete) {
      parts.push(el('p', 'uxp-warn', t('uiux.ov.needMore', { items: done.gaps.map((g) => t(`uiux.ov.gap.${g}`)).join(', ') })))
    }
    parts.push(jobBox('project_overview', o ? 'uiux.ov.refresh' : 'uiux.ov.request', () => ({ type: 'project_overview' })))
    const exportB = (key: string, format: 'md' | 'json'): HTMLButtonElement => {
      const b = button(t(key), () => void exportOverview(format))
      b.disabled = !o
      return b
    }
    const io = el('div', 'uxp-row')
    io.append(
      button(t('uiux.ov.import'), () => void importOverview(), 'btn small', 'overview-import'),
      exportB('uiux.ov.exportMd', 'md'),
      exportB('uiux.ov.exportJson', 'json')
    )
    parts.push(io)
    mounts.overview.replaceChildren(...parts)
  }

  async function importOverview(): Promise<void> {
    if (!projectId) return
    try {
      const r = await api.importOverview(projectId)
      if (r.ok) {
        await host.refresh()
        host.setStatus(t('uiux.ov.imported'))
      } else if (r.errors?.length) host.setStatus(t('uiux.ov.importFailed', { errors: r.errors.slice(0, 3).join(' · ') }), true)
    } catch (err) {
      fail(err)
    }
  }

  async function exportOverview(format: 'md' | 'json'): Promise<void> {
    if (!projectId) return
    try {
      const r = await api.exportOverview(projectId, format)
      if (r.ok) host.setStatus(t('uiux.ov.exported'))
    } catch (err) {
      fail(err)
    }
  }

  // ---------- skills ----------

  function fillSkills(builtin: SkillRef): void {
    const current = host.skill()
    const sel = el('select', 'uxp-select')
    sel.dataset.ux = 'skill-select'
    sel.setAttribute('aria-label', t('uiux.panel.skill'))
    const all = [builtin, ...agentSkills]
    for (const s of all) {
      const o = el('option', undefined, s.source === 'builtin' ? t('uiux.panel.builtinSkill') : s.name)
      o.value = s.id
      if (s.id === current.id) o.selected = true
      sel.append(o)
    }
    sel.addEventListener('change', () => {
      const s = all.find((x) => x.id === sel.value)
      if (s) host.setSkill(s)
    })
    const parts: Node[] = [sel]
    if (current.source === 'agent') {
      if (current.description) parts.push(el('p', 'uxp-text uxp-muted', current.description))
      parts.push(el('p', 'uxp-hint', t('uiux.sk.runsAtAgent')))
      const ctx = contexts.find((c) => c.skill.id === current.id)
      if (ctx) {
        parts.push(el('p', 'uxp-muted', t('uiux.sk.ready', { revision: ctx.revision })))
        // What the agent found for the skill (field names are the skill's own words).
        const fields = Object.entries(ctx.fields)
        if (fields.length) {
          const ul = el('ul', 'uxp-list')
          for (const [k, c] of fields.slice(0, 12)) ul.append(el('li', undefined, `${k}: ${c.value}`))
          parts.push(el('p', 'uxp-label', t('uiux.sk.fields')), ul)
        }
        if (ctx.missing.length) parts.push(el('p', 'uxp-warn', t('uiux.sk.missing', { fields: ctx.missing.join(', ') })))
      }
      parts.push(jobBox('skill_setup', ctx ? 'uiux.sk.refresh' : 'uiux.sk.setup', () => ({ type: 'skill_setup', skillId: current.id }), current.id))
    } else parts.push(el('p', 'uxp-hint', t('uiux.panel.skillHint')))
    if (!agentSkills.length) parts.push(el('p', 'uxp-hint', t('uiux.sk.none')))
    parts.push(jobBox('capabilities', agentSkills.length ? 'uiux.sk.askAgain' : 'uiux.sk.ask', () => ({ type: 'capabilities' })))
    mounts.skills.replaceChildren(...parts)
  }

  // ---------- proposals and audit (stage C) ----------

  function proposalRequest(): JobRequest {
    const d = host.draft()
    const c = host.capture()
    const skill = host.skill()
    return {
      type: 'design_proposal',
      ...(skill.source === 'agent' ? { skillId: skill.id } : {}),
      capturePng: c.capturePng,
      annotatedPng: c.annotatedPng,
      scope: d.scope,
      preserve: d.preserve,
      tokens: d.tokens,
      locks: d.locks,
      ...(screenPurpose.trim() ? { screenPurpose: screenPurpose.trim() } : {}),
      minutes: 10
    }
  }

  function fillProposals(): void {
    if (purpose.value !== screenPurpose) purpose.value = screenPurpose
    purpose.placeholder = t('uiux.pr.purposeHint')
    purpose.setAttribute('aria-label', t('uiux.pr.purpose'))
    purposeTitle.data = t('uiux.pr.purpose')
    const parts: Node[] = [jobBox('design_proposal', 'uiux.pr.request', proposalRequest)]
    const rev = host.state()?.overview?.revision
    for (const set of proposalSets.slice(0, 3)) {
      const row = el('div', 'uxp-row')
      row.append(el('span', 'uxp-grow', t('uiux.pr.count', { n: set.proposals.length })))
      if (rev !== undefined && set.overviewRevision !== undefined && set.overviewRevision < rev) row.append(el('span', 'uxp-badge uxp-old', t('uiux.pr.oldOverview')))
      row.append(button(t('uiux.pr.compare'), () => host.openCompare(set.jobId, set.proposals), 'btn small', `compare-${set.jobId}`))
      parts.push(row)
    }
    parts.push(jobBox('style_audit', 'uiux.pr.audit', () => {
      const c = host.capture()
      return { type: 'style_audit', capturePng: c.capturePng, annotatedPng: c.annotatedPng, scope: host.draft().scope }
    }))
    const audit = latest('style_audit')
    if (audit?.status === 'submitted') parts.push(findingsList(audit))
    proposalsBody.replaceChildren(...parts)
  }

  function findingsList(job: UiuxJob): HTMLElement {
    const box = el('div', 'uxp-findings')
    const out = outcomeOf(job)
    if (out === undefined) return box
    const findings = out?.findings ?? []
    if (!findings.length) {
      box.append(el('p', 'uxp-muted', t('uiux.pr.noFindings')))
      return box
    }
    box.append(el('p', 'uxp-muted', t('uiux.pr.findings', { n: findings.length })))
    const ul = el('ul', 'uxp-list')
    for (const f of findings.slice(0, 12)) {
      const li = el('li')
      li.append(el('strong', undefined, f.area), document.createTextNode(` · ${f.issue}`), el('div', 'uxp-muted', `→ ${f.suggestion}`))
      li.append(button(t('uiux.pr.toMemo'), () => host.addToMemo(`${f.area}: ${f.suggestion}`), 'btn small', 'finding-to-memo'))
      ul.append(li)
    }
    box.append(ul, el('p', 'uxp-hint', t('uiux.pr.findingsHint')))
    return box
  }

  // ---------- after the send (stage D) ----------

  /** Spec §10.3: sent → fetched by the agent → its result received → confirmed by the user. A fetch alone is never "done". */
  function fillReport(): void {
    const box = mounts.report
    const job = latest('implementation_report')
    if (!job) {
      box.replaceChildren(el('p', 'uxp-hint', t('uiux.rp.none')))
      return
    }
    if (review.jobId !== job.jobId) review = { jobId: job.jobId, ticked: new Set(), confirmed: false, synced: false }
    const known = outcomes.get(job.jobId)
    const stored = known && !(known instanceof Promise) ? known.confirmation : undefined
    if (stored && !review.synced) review = { jobId: job.jobId, ticked: new Set(stored.ticked), confirmed: true, synced: true }
    const steps: [string, boolean][] = [
      ['sent', true],
      ['fetched', job.status !== 'pending'],
      ['received', job.status === 'submitted'],
      ['confirmed', review.confirmed]
    ]
    const ol = el('ol', 'uxp-steps')
    for (const [k, on] of steps) {
      // The user's check says how much they checked: "checked 0 of 6" must never look like a full pass.
      const label = k === 'confirmed' && on ? t('uiux.rp.step.confirmedN', { n: review.ticked.size, total: CHECK_ITEMS }) : t(`uiux.rp.step.${k}`)
      ol.append(el('li', on ? 'uxp-step-on' : 'uxp-step', label))
    }
    const parts: Node[] = [ol]
    if (ACTIVE.includes(job.status)) parts.push(jobBox(job.type, 'uiux.job.retry', () => null))
    else if (job.status !== 'submitted') parts.push(el('p', 'uxp-muted', t(`uiux.job.status.${job.status}`)))
    const r = job.status === 'submitted' ? outcomeOf(job)?.report : undefined
    if (r) {
      parts.push(el('p', 'uxp-hint', t('uiux.rp.claim')), el('p', 'uxp-text', r.summary))
      const list = (key: string, items: string[]): void => {
        if (!items.length) return
        const ul = el('ul', 'uxp-list')
        for (const s of items.slice(0, 20)) ul.append(el('li', undefined, s))
        parts.push(el('p', 'uxp-label', t(key)), ul)
      }
      list('uiux.rp.files', r.changedFiles.map((f) => (f.note ? `${f.path} · ${f.note}` : f.path)))
      list('uiux.rp.notDone', r.notDone)
      list('uiux.rp.checksRun', r.checksRun)
    }
    // What was asked for, so the new capture can be compared with it.
    const requested = job.status === 'submitted' ? outcomeOf(job)?.requested : undefined
    if (requested?.length) {
      const ul = el('ul', 'uxp-list')
      for (const c of requested.slice(0, 12)) ul.append(el('li', undefined, `${c.path}: ${showValue(c.to)}`))
      parts.push(el('p', 'uxp-label', t('uiux.rp.requested')), ul)
    }
    parts.push(checklist(job))
    box.replaceChildren(...parts)
  }

  /**
   * What the user checks on a new capture. Visual checks can be seen on the capture; runtime ones (focus,
   * responsive, screen reader) need the running app. Ticks stay in this editor; the confirm button records
   * that the user looked.
   */
  function checklist(job: UiuxJob): HTMLElement {
    const box = el('div', 'uxp-checklist')
    const items: { id: string; label: string; kind: 'visual' | 'runtime' }[] = [
      { id: 'look', label: t('uiux.rp.check.look'), kind: 'visual' },
      { id: 'preserve', label: t('uiux.rp.check.preserve'), kind: 'visual' },
      { id: 'contrast', label: t('uiux.rp.check.contrast'), kind: 'visual' },
      { id: 'clip', label: t('uiux.rp.check.clip'), kind: 'visual' },
      { id: 'focus', label: t('uiux.rp.check.focus'), kind: 'runtime' },
      { id: 'responsive', label: t('uiux.rp.check.responsive'), kind: 'runtime' }
    ]
    box.append(el('p', 'uxp-label', t('uiux.rp.checklist')))
    for (const it of items) {
      const lab = el('label', 'uxp-check')
      const cb = el('input')
      cb.type = 'checkbox'
      cb.checked = review.ticked.has(it.id)
      cb.addEventListener('change', () => {
        if (cb.checked) review.ticked.add(it.id)
        else review.ticked.delete(it.id)
        confirm.disabled = review.ticked.size === 0
      })
      lab.append(cb, document.createTextNode(`${it.label} · ${t(`uiux.rp.${it.kind}`)}`))
      box.append(lab)
    }
    box.append(el('p', 'uxp-hint', t('uiux.rp.recapture')))
    const confirm = button(t('uiux.rp.confirm'), () => {
      void api.confirmReport(job.jobId, [...review.ticked]).then((conf) => {
        review = { jobId: job.jobId, ticked: new Set(conf.ticked), confirmed: true, synced: true }
        const known = outcomes.get(job.jobId)
        if (known && !(known instanceof Promise)) outcomes.set(job.jobId, { ...known, confirmation: conf })
        host.setStatus(t('uiux.rp.confirmed', { n: conf.ticked.length, total: items.length }))
        host.rerender()
      }, fail)
    }, 'btn small', 'report-confirm')
    // Nothing ticked is not a check: the button waits for at least one item.
    confirm.disabled = review.ticked.size === 0
    box.append(confirm)
    return box
  }

  // ---------- profile export / import ----------

  function profile(onImported: (projectId: string) => void): HTMLElement {
    const row = el('div', 'uxp-row')
    const exp = button(t('uiux.pf.export'), () => {
      if (!projectId) return
      void api.exportProfile(projectId).then((r) => { if (r.ok) host.setStatus(t('uiux.pf.exported')) }, fail)
    }, 'btn small', 'profile-export')
    exp.disabled = !projectId
    const imp = button(t('uiux.pf.import'), () => {
      void api.importProfile().then((r) => {
        if (r.ok && r.projectId) {
          host.setStatus(t('uiux.pf.imported'))
          onImported(r.projectId)
        } else if (r.errors?.length) host.setStatus(t('uiux.ov.importFailed', { errors: r.errors.slice(0, 3).join(' · ') }), true)
      }, fail)
    }, 'btn small', 'profile-import')
    row.append(exp, imp)
    return row
  }

  function renderParts(): void {
    if (mounts.overview.isConnected) fillOverview()
    if (mounts.skills.isConnected && builtinSkill) fillSkills(builtinSkill)
    if (mounts.proposals.isConnected) fillProposals()
    if (mounts.report.isConnected) fillReport()
  }

  return {
    load,
    track,
    renderParts,
    overview: () => { fillOverview(); return mounts.overview },
    skills: (builtin) => { builtinSkill = builtin; fillSkills(builtin); return mounts.skills },
    proposals: () => { fillProposals(); return mounts.proposals },
    report: () => { fillReport(); return mounts.report },
    profile,
    findSkill: (id) => agentSkills.find((s) => s.id === id)
  }
}
