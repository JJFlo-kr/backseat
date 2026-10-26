/**
 * UI/UX tools self-test: `electron . --selftest --selftest-uiux --selftest-shots=<dir>`.
 * Drives the UI/UX panel in the real editor (stage A of the UI/UX spec): toggle and applied state (AC-02),
 * sends with and without guidance (AC-01, AC-03, AC-16), unreflected changes before a send, marks that
 * disappear (AC-13), Enter on a panel button, the narrow layout, memo phrases and the samples' font report.
 * The capture is the synthetic page of selftest-flows (never the real screen); send is answered by a stub;
 * the UI/UX store lives in a temporary userData folder, so nothing touches the user's own projects.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import type { EditorInit, ExportPayload, SendOptions, SendResult, SendTargetView, UiuxPayload } from '../shared/types'
import { createEditorWindow } from './editor'
import { setBriefLocaleOverride, setLocaleOverride } from './locales'
import { fakeCapture } from './selftest-flows'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const CLAUDE: SendTargetView = {
  source: 'mcp-verified', label: 'Claude Code', project: 'backseat', kind: 'claude-code', estimated: false, method: 'mcp',
  identity: { hwnd: 0, pid: 0, processStartMs: 0, title: 'backseat — claude', process: 'WindowsTerminal.exe' }
}

export async function runUiuxSelfTest(shotsDir: string | undefined): Promise<void> {
  const errors: string[] = []
  const warnings: string[] = []
  const report: Record<string, unknown> = {}
  const dir = shotsDir ?? join(app.getPath('temp'), 'backseat-selftest', 'uiux')
  await mkdir(dir, { recursive: true })
  report.shots = dir
  // The UI/UX store is created lazily from userData: point it at a throwaway folder first.
  const userData = await mkdtemp(join(tmpdir(), 'backseat-uiux-selftest-'))
  app.setPath('userData', userData)
  report.userData = userData
  setLocaleOverride('ko')
  setBriefLocaleOverride('follow')

  const sent: { uiux?: UiuxPayload; memo: string; marks: number }[] = []
  ipcMain.removeHandler(IPC.editorTargets)
  ipcMain.handle(IPC.editorTargets, (): SendTargetView[] => [CLAUDE])
  const stubSend = (): void => {
    ipcMain.removeHandler(IPC.editorSend)
    ipcMain.handle(IPC.editorSend, async (_e, payload: ExportPayload, _opts: SendOptions = {}): Promise<SendResult> => {
      sent.push({ uiux: payload.uiux, memo: payload.memo, marks: payload.annotations.length })
      await sleep(200)
      return { ok: true, delivered: 'pasted', sessionDir: `uiux-${sent.length}`, message: '', status: { sendId: `uiux-${sent.length}`, target: CLAUDE, reached: ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'] } }
    })
  }

  const cap = await fakeCapture()
  const init: EditorInit = {
    imageDataUrl: cap.dataUrl, width: cap.width, height: cap.height,
    meta: {
      capturedAt: new Date().toISOString(), displayId: 0, scaleFactor: 1, mode: 'rect',
      rectDip: { x: 0, y: 0, width: cap.width, height: cap.height }, rectPx: { x: 0, y: 0, width: cap.width, height: cap.height }
    },
    target: { kind: 'claude-code', label: 'Claude Code · Windows Terminal', hwnd: 0, title: 'backseat — claude', process: 'WindowsTerminal.exe', method: 'paste-path', confidence: 0.9 },
    sendTarget: CLAUDE,
    debug: true
  }

  let win: BrowserWindow | null = null
  try {
    win = createEditorWindow(init, errors)
    stubSend()
    const w = win
    const js = <T>(code: string): Promise<T> => w.webContents.executeJavaScript(code) as Promise<T>
    let ready = false
    for (let i = 0; i < 80 && !ready; i++) {
      await sleep(125)
      ready = !w.webContents.isLoading() && await js<boolean>(`Boolean(window.__backseat && window.__backseat.state().init)`).catch(() => false)
    }
    if (!ready) throw new Error('editor never became ready')
    w.setContentSize(1280, 800)
    w.show()
    w.focus()
    await sleep(400)

    const shot = async (file: string): Promise<void> => {
      await sleep(150)
      try {
        await writeFile(join(dir, file), (await w.webContents.capturePage()).toPNG())
      } catch (err) {
        warnings.push(`screenshot ${file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const click = async (sel: string, what: string): Promise<boolean> => {
      const ok = await js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.disabled) return false; e.click(); return true })()`)
      if (!ok) errors.push(`${what}: ${sel} not found or disabled`)
      await sleep(250)
      return ok
    }
    const ux = (name: string): string => `#uiux-panel [data-ux="${name}"]`
    const waitFor = async (cond: string, what: string, ms = 4000): Promise<boolean> => {
      for (let i = 0; i < ms / 100; i++) {
        if (await js<boolean>(`Boolean(${cond})`).catch(() => false)) return true
        await sleep(100)
      }
      errors.push(`timeout: ${what}`)
      return false
    }
    const send = async (): Promise<void> => {
      const before = sent.length
      await click('#send', 'send')
      for (let i = 0; i < 40 && sent.length === before; i++) await sleep(100)
    }
    const hidden = (sel: string): Promise<boolean> => js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !e || e.hidden || e.getBoundingClientRect().width === 0 })()`)

    // 1. Without the panel nothing changes (AC-01): toggle present, panel closed, a send carries no guidance.
    report.toggleVisible = !(await hidden('#uiux-toggle'))
    if (!report.toggleVisible) errors.push('UI/UX toggle is not visible')
    if (!(await hidden('#uiux-panel'))) errors.push('panel is open before the toggle was pressed')
    await shot('uiux-0-closed.png')
    await send()
    if (sent[0]?.uiux) errors.push('a send without the panel carried UI/UX guidance')

    // 2. Open the panel, register a project and type the overview (user input basis).
    await click('#uiux-toggle', 'toggle')
    await waitFor(`!document.getElementById('uiux-panel').hidden && document.querySelector('${ux('new-project')}')`, 'panel opened')
    await click(ux('new-project'), 'new project')
    await js(`(() => { const i = document.querySelector('${ux('project-name')}'); i.value = 'Acme Tasks'; return true })()`)
    await click(ux('create-project'), 'create project')
    await waitFor(`document.querySelector('${ux('save-overview')}')`, 'overview form after creating the project')
    await js(`(() => { const f = document.querySelectorAll('#uiux-panel .uxp-form .uxp-input'); const v = ['팀 업무 관리 앱', '작은 팀이 할 일을 한곳에서 관리', '팀장\\n팀원', '가독성\\n빠른 확인', '로그인\\n대시보드']; f.forEach((el, i) => { el.value = v[i] ?? '' }); return f.length })()`)
    await click(ux('save-overview'), 'save overview')
    await waitFor(`/사용자 입력 기준/.test(document.getElementById('uiux-panel').textContent)`, 'overview shown as user input basis')
    await shot('uiux-1-project.png')

    // 3. Colours: pick a built-in option, the samples and checks follow.
    const firstOption = await js<string | null>(`(() => { const b = document.querySelector('#uiux-panel [data-ux^="option-"]'); return b ? b.dataset.ux : null })()`)
    if (!firstOption) errors.push('no built-in colour options')
    else await click(ux(firstOption), 'colour option')
    report.recommendedBadge = await js<boolean>(`Boolean(document.querySelector('#uiux-panel .uxp-badge'))`)
    report.samples = await js<boolean>(`Boolean(document.querySelector('#uiux-panel .ux-samples'))`)
    if (!report.samples) errors.push('component samples are not shown')
    report.checks = await js<number>(`document.querySelectorAll('#uiux-panel .uxp-checks li').length`)
    await shot('uiux-2-colours.png')
    await js(`(() => { const s = document.querySelector('#uiux-panel .ux-samples'); if (s) s.scrollIntoView({ block: 'start' }); return true })()`)
    await shot('uiux-2-samples.png')
    await js(`(() => { const s = document.querySelector('#uiux-panel .ux-samples'); if (s) s.scrollIntoView({ block: 'end' }); return true })()`)
    await shot('uiux-2-samples-end.png')
    await js(`document.getElementById('uiux-panel').scrollTop = 0; true`)
    for (const a of ['ratio', 'shadows', 'type', 'box']) {
      await click(ux(`tab-${a}`), `tab ${a}`)
      await shot(`uiux-2-${a}.png`)
    }
    await click(ux('tab-colors'), 'tab colours')

    // 4. Apply, close the panel: the send bar still says it is applied (AC-02), and the send carries it (AC-16).
    await click(ux('add-to-request'), 'add to request')
    await click('#uiux-toggle', 'toggle closed')
    report.appliedBarWhileClosed = !(await hidden('#uiux-applied'))
    if (!report.appliedBarWhileClosed) errors.push('applied guidance not shown next to 보내기 while the panel is closed')
    await shot('uiux-3-applied-closed.png')
    await send()
    const req1 = sent[1]?.uiux?.request
    if (!req1) errors.push('applied guidance did not go with the send')
    else {
      report.request1 = { project: req1.projectName, changes: req1.changes.length, basis: req1.overviewBasis, checks: req1.checks.length, scope: req1.scope.kind }
      if (req1.overviewBasis !== 'user') errors.push(`overview basis ${String(req1.overviewBasis)}, expected user`)
      if (!req1.changes.length) warnings.push('the chosen option changed nothing against the defaults')
    }

    // 5. Change after applying: stale, and a send asks first; reflecting sends the new value.
    await click('#uiux-toggle', 'toggle open')
    await click(ux('tab-ratio'), 'tab ratio')
    await js(`(() => { const r = document.querySelector('#uiux-panel .uxp-area input[type=range]'); r.value = String(Number(r.value) - 10); r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); return true })()`)
    await sleep(200)
    report.staleShown = await js<boolean>(`/미반영/.test(document.getElementById('uiux-applied').textContent)`)
    if (!report.staleShown) errors.push('changes after applying are not marked as not reflected')
    const before = sent.length
    await js(`document.getElementById('send').click(); true`)
    await waitFor(`document.querySelector('dialog.uxp-dialog[open]')`, 'question before sending stale guidance')
    await shot('uiux-4-stale-dialog.png')
    await click('dialog.uxp-dialog [data-ux="dialog-reflect"]', 'reflect and send')
    for (let i = 0; i < 40 && sent.length === before; i++) await sleep(100)
    const req2 = sent[before]?.uiux?.request
    if (!req2) errors.push('no guidance after "reflect and send"')
    else if (req1 && JSON.stringify(req2.resolved.ratio) === JSON.stringify(req1.resolved.ratio)) errors.push('reflected ratio change did not reach the request')

    // 6. Enter on a focused panel button is that button, not 보내기.
    const n = sent.length
    await js(`document.querySelector('${ux('tab-colors')}').focus(); true`)
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await sleep(800)
    if (sent.length !== n) errors.push('Enter on a panel button sent the capture')

    // 7. Release: the next send carries nothing.
    await click(ux('release'), 'release')
    await send()
    if (sent[sent.length - 1]?.uiux) errors.push('guidance still sent after release')

    // 8. Guidance only (no marks, no memo) is still sent as guidance (AC-03 on the editor side).
    await click(ux('add-to-request'), 'add again')
    await send()
    const last = sent[sent.length - 1]
    report.guidanceOnly = { marks: last?.marks, memo: last?.memo, uiux: Boolean(last?.uiux) }
    if (!last?.uiux) errors.push('guidance-only send lost the guidance')

    // 9. A chosen mark that disappears is reported, not moved to another mark (AC-13).
    await js(`window.__backseat.addAnnotations([{ kind: 'badge', x: 300, y: 120, n: 1, color: '#E5484D', size: 22, tStart: 100, tEnd: 100 }]); true`)
    await sleep(200)
    await js(`(() => { const b = [...document.querySelectorAll('#uiux-panel .seg [role=radio]')][2]; b.click(); return true })()`)
    await sleep(200)
    await js(`(() => { const c = document.querySelector('#uiux-panel .uxp-scope input[type=checkbox]'); if (c) c.click(); return Boolean(c) })()`)
    await sleep(200)
    await click('#undo', 'undo the mark')
    await sleep(300)
    report.missingMarkShown = await js<boolean>(`/연결할 영역 없음/.test(document.getElementById('uiux-panel').textContent)`)
    if (!report.missingMarkShown) errors.push('a removed mark is not reported as "no area to link to"')
    await shot('uiux-5-missing-mark.png')

    // 10. Memo phrases and the font report.
    await js(`document.getElementById('memo').focus(); document.getElementById('memo').dispatchEvent(new Event('focus')); true`)
    await sleep(200)
    report.phrases = await js<number>(`document.querySelectorAll('#uiux-suggest .uxp-chip').length`)
    if (!report.phrases) warnings.push('no memo phrases shown')
    report.fontReport = await js<string>(`(document.querySelector('#uiux-panel .ux-samples') || {}).textContent ? document.querySelector('#uiux-panel .ux-samples').textContent.slice(-200) : ''`)
    await shot('uiux-6-phrases.png')

    // 11. Narrow window: the panel goes over the canvas instead of squeezing it.
    w.setContentSize(820, 700)
    await sleep(500)
    report.narrowPosition = await js<string>(`getComputedStyle(document.getElementById('uiux-panel')).position`)
    if (report.narrowPosition !== 'absolute') errors.push(`narrow window: panel position ${String(report.narrowPosition)}`)
    report.toolbarFits = await js<boolean>(`(() => { const t = document.getElementById('toolbar'); return t.scrollWidth <= t.clientWidth + 1 })()`)
    if (!report.toolbarFits) errors.push('toolbar overflows at 820 px with the UI/UX button')
    await shot('uiux-7-narrow.png')
  } catch (err) {
    errors.push(`exception: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  } finally {
    win?.destroy()
  }
  setLocaleOverride(null)
  setBriefLocaleOverride(null)
  report.sends = sent.length
  report.warnings = warnings
  report.errors = errors
  report.ok = errors.length === 0
  console.log('BACKSEAT_SELFTEST ' + JSON.stringify(report))
  app.exit(errors.length === 0 ? 0 : 1)
}
