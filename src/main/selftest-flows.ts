/**
 * Editor flow self-test: `electron . --selftest --selftest-flows --selftest-shots=<dir>`.
 * Walks the four flows of the editor request (plan 2026-10-25 §4) in the real editor with real input events:
 *   1. mark three places and send, 2. add a spoken explanation and send, 3. open the text details, change them and
 *   come back, 4. hide an area, undo and redo it; plus option memory across editors and the delivery stops.
 * The capture is a synthetic app page rendered offscreen (never the real screen), and the send / transcribe IPC
 * are answered by stubs in this process: nothing is pasted, written to the sessions folder or recognised for real.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import type { DeliveryStatus, EditorInit, ExportPayload, SendOptions, SendResult, SendTargetView, TranscribeRequest, TranscribeResult } from '../shared/types'
import { createEditorWindow } from './editor'
import { setBriefLocaleOverride, setLocaleOverride } from './locales'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const FAKE_APP = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px "Segoe UI","Malgun Gothic",sans-serif;background:#f6f7f9;color:#1b1f24;width:900px;height:520px;overflow:hidden}
header{height:54px;background:#fff;border-bottom:1px solid #e4e6ea;display:flex;align-items:center;padding:0 20px;gap:12px}
.logo{width:24px;height:24px;border-radius:50%;background:#4465e9}.brand{font-weight:600;font-size:17px;flex:1}
nav span{margin-left:28px;color:#5b616b}aside{position:absolute;top:55px;left:0;bottom:0;width:190px;background:#fff;border-right:1px solid #e4e6ea;padding-top:12px}
aside div{padding:9px 28px;color:#3b414b}aside .on{background:#eef1fd;margin:0 10px;padding-left:18px;border-radius:6px}
main{position:absolute;top:55px;left:191px;right:0;bottom:0;padding:18px 28px}h1{font-size:22px;margin:4px 0 16px}
.row{display:flex;align-items:center;background:#fff;border:1px solid #e4e6ea;border-radius:6px;height:42px;margin-bottom:8px;padding:0 14px}
.row .who{flex:1}.row .mail{width:210px;color:#5b616b}.row .st{width:70px;color:#30a46c}.row .st.bad{color:#e5484d}
.row button{background:#4465e9;color:#fff;border:0;border-radius:5px;padding:5px 12px;font-weight:600;font-size:12px}
</style></head><body><header><div class="logo"></div><div class="brand">Acme Dashboard</div><nav><span>Projects</span><span>Reports</span><span>Settings</span></nav></header>
<aside><div>Overview</div><div class="on">Orders</div><div>Customers</div><div>Products</div><div>Analytics</div><div>Billing</div></aside>
<main><h1>Orders</h1>${['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang'].map((n, i) =>
  `<div class="row"><span class="who">#104${2 + i} Order for ${n}</span><span class="mail">${n.toLowerCase()}@example.com</span><span class="st${i === 2 ? ' bad' : ''}">${i === 2 ? 'Failed' : 'Paid'}</span><button>Details</button></div>`).join('')}</main></body></html>`

/** The fake app page as a PNG data URL (offscreen: nothing of the real screen is captured). */
async function fakeCapture(): Promise<{ dataUrl: string; width: number; height: number }> {
  const w = new BrowserWindow({ width: 900, height: 520, show: false, useContentSize: true, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true } })
  await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(FAKE_APP)}`)
  await w.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await sleep(600)
  const img = await w.webContents.capturePage(undefined, { stayHidden: true })
  w.destroy()
  const size = img.getSize()
  return { dataUrl: `data:image/png;base64,${img.toPNG().toString('base64')}`, width: size.width, height: size.height }
}

const CLAUDE: SendTargetView = {
  source: 'mcp-verified', label: 'Claude Code', project: 'backseat', kind: 'claude-code', estimated: false, method: 'mcp',
  identity: { hwnd: 0, pid: 0, processStartMs: 0, title: 'backseat — claude', process: 'WindowsTerminal.exe' }
}

interface SentCall { annotations: string[]; memo: string; transcript: boolean; audio: boolean; opts: SendOptions }

export async function runFlowsSelfTest(shotsDir: string | undefined): Promise<void> {
  const errors: string[] = []
  const warnings: string[] = []
  const report: Record<string, unknown> = {}
  const dir = shotsDir ?? join(app.getPath('temp'), 'backseat-selftest', 'flows')
  await mkdir(dir, { recursive: true })
  report.shots = dir
  setLocaleOverride('ko')
  setBriefLocaleOverride('follow')

  // Stubs: the editor's own IPC path is used, main's answers are canned (a phase-2 style DeliveryStatus).
  const sent: SentCall[] = []
  let nextStatus: (n: number) => DeliveryStatus = (n) => ({
    sendId: `selftest-flow-${n}`, target: CLAUDE, reached: ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted']
  })
  const ensureIpc = (): void => {
    ipcMain.removeHandler(IPC.editorSend)
    ipcMain.handle(IPC.editorSend, async (_e, payload: ExportPayload, opts: SendOptions = {}): Promise<SendResult> => {
      sent.push({ annotations: payload.annotations.map((a) => a.kind), memo: payload.memo, transcript: Boolean(payload.transcript), audio: Boolean(payload.audio), opts })
      await sleep(300)
      const status = nextStatus(sent.length)
      return { ok: true, delivered: 'pasted', sessionDir: status.sendId, message: '', status }
    })
    ipcMain.removeHandler(IPC.editorTranscribe)
    ipcMain.handle(IPC.editorTranscribe, async (_e, req: TranscribeRequest): Promise<TranscribeResult> => {
      await sleep(300)
      const s = req.audioStartMs
      return {
        ok: true,
        transcript: {
          text: '이 버튼을 더 크게 해 주세요', audioStartMs: s, durationMs: 1800, model: 'selftest', language: 'korean',
          segments: [{ start: s + 150, end: s + 1500, text: '이 버튼을 더 크게 해 주세요' }]
        }
      }
    })
  }

  const cap = await fakeCapture()
  const baseInit = (): EditorInit => ({
    imageDataUrl: cap.dataUrl, width: cap.width, height: cap.height,
    meta: {
      capturedAt: new Date().toISOString(), displayId: 0, scaleFactor: 1, mode: 'rect',
      rectDip: { x: 0, y: 0, width: cap.width, height: cap.height }, rectPx: { x: 0, y: 0, width: cap.width, height: cap.height }
    },
    target: { kind: 'claude-code', label: 'Claude Code · Windows Terminal', hwnd: 0, title: 'backseat — claude', process: 'WindowsTerminal.exe', method: 'paste-path', confidence: 0.9 },
    candidates: [
      { kind: 'codex', label: 'Codex · ChatGPT 앱', hwnd: 900002, title: 'ChatGPT', process: 'ChatGPT.exe', method: 'paste-image', confidence: 0.8 },
      { kind: 'claude-desktop', label: 'Claude 앱', hwnd: 900001, title: 'Claude', process: 'claude.exe', method: 'paste-image', confidence: 0.8 }
    ],
    sendTarget: CLAUDE,
    debug: true
  })

  type Js = <T>(code: string) => Promise<T>
  interface Ed { win: BrowserWindow; js: Js }

  async function open(name: string, reset: boolean, init: EditorInit = baseInit()): Promise<Ed> {
    const win = createEditorWindow(init, errors)
    ensureIpc()
    const js: Js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>
    let ready = false
    for (let i = 0; i < 80 && !ready; i++) {
      await sleep(125)
      ready = !win.webContents.isLoading() && await js<boolean>(`Boolean(window.__backseat && window.__backseat.state().init)`).catch(() => false)
    }
    if (!ready) errors.push(`${name}: editor never became ready`)
    win.setContentSize(960, 720)
    // typed characters go to the focused window
    win.show()
    win.focus()
    win.webContents.focus()
    if (reset) await js(`window.__backseat.resetPrefs(); true`)
    await sleep(350)
    return { win, js }
  }

  const center = async (ed: Ed, sel: string): Promise<{ x: number; y: number } | null> => ed.js(
    `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
       if (!r.width) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
  )
  async function click(ed: Ed, sel: string, what: string): Promise<boolean> {
    const p = await center(ed, sel)
    if (!p) { errors.push(`${what}: ${sel} is not visible`); return false }
    ed.win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    ed.win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    ed.win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await sleep(180)
    return true
  }
  /** Image fraction -> window point. */
  const at = (ed: Ed, fx: number, fy: number): Promise<{ x: number; y: number }> => ed.js(
    `(() => { const r = document.getElementById('ink').getBoundingClientRect(); return { x: Math.round(r.left + r.width * ${fx}), y: Math.round(r.top + r.height * ${fy}) }; })()`
  )
  async function drag(ed: Ed, from: [number, number], to: [number, number]): Promise<void> {
    const a = await at(ed, ...from)
    const b = await at(ed, ...to)
    ed.win.webContents.sendInputEvent({ type: 'mouseMove', x: a.x, y: a.y })
    ed.win.webContents.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 8; i++) {
      ed.win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(a.x + (b.x - a.x) * i / 8), y: Math.round(a.y + (b.y - a.y) * i / 8), button: 'left' })
      await sleep(20)
    }
    ed.win.webContents.sendInputEvent({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 })
    await sleep(200)
  }
  async function tap(ed: Ed, fx: number, fy: number): Promise<void> {
    const p = await at(ed, fx, fy)
    ed.win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    ed.win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await sleep(200)
  }
  async function key(ed: Ed, keyCode: string, modifiers: ('control' | 'shift')[] = []): Promise<void> {
    ed.win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    ed.win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await sleep(150)
  }
  async function shot(ed: Ed, file: string): Promise<void> {
    await sleep(120)
    try {
      await writeFile(join(dir, file), (await ed.win.webContents.capturePage()).toPNG())
    } catch (err) {
      warnings.push(`screenshot ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  type Bar = { mode: string; summary: string; voiceMissing: boolean; voiceLinks: boolean; steps: string[]; headline: string; detail: string; tone: string; primary: string | null }
  const bar = (ed: Ed): Promise<Bar> => ed.js<Bar>(`window.__backseat.sendbar()`)
  type St = { tool: string; annotations: { kind: string }[]; canUndo: boolean; canRedo: boolean; width: number; textDetails: boolean; timeline?: boolean }
  const state = (ed: Ed): Promise<St> => ed.js<St>(`window.__backseat.state()`)
  const kinds = async (ed: Ed): Promise<string[]> => (await state(ed)).annotations.map((a) => a.kind)
  const opts = (ed: Ed): Promise<string[]> => ed.js<string[]>(`[...document.querySelectorAll('#toolbar2 [data-opt]')].filter((e) => !e.hidden).map((e) => e.dataset.opt)`)
  const rowFits = (ed: Ed): Promise<Record<string, boolean>> => ed.js(
    `(() => { const f = (id) => { const e = document.getElementById(id); return e.hidden || e.scrollWidth <= e.clientWidth }; return { toolbar: f('toolbar'), toolbar2: f('toolbar2'), textbar: f('textbar') } })()`
  )
  const check = (cond: boolean, msg: string): void => { if (!cond) errors.push(msg) }

  try {
    // ---- flow 1: mark three places, send ----
    {
      const ed = await open('flow1', true)
      await shot(ed, 'flow1-0-open.png')
      const r: Record<string, unknown> = {}
      report.flow1 = r
      r.defaultOptions = await opts(ed)
      check((await state(ed)).width === 4, `default width should be 4: ${(await state(ed)).width}`)
      await click(ed, '#tools [data-tool="arrow"]', 'flow1')
      check(JSON.stringify(await opts(ed)) === JSON.stringify(['color', 'width']), `arrow options: ${JSON.stringify(await opts(ed))}`)
      await drag(ed, [0.62, 0.12], [0.5, 0.36])
      await click(ed, '#tools [data-tool="badge"]', 'flow1')
      check(JSON.stringify(await opts(ed)) === JSON.stringify(['color', 'badge-size']), `number options: ${JSON.stringify(await opts(ed))}`)
      await tap(ed, 0.93, 0.47)
      await click(ed, '#tools [data-tool="blur"]', 'flow1')
      check(JSON.stringify(await opts(ed)) === JSON.stringify(['blur-strength']), `hide options: ${JSON.stringify(await opts(ed))}`)
      await drag(ed, [0.465, 0.62], [0.705, 0.69])
      r.marks = await kinds(ed)
      check(JSON.stringify(r.marks) === JSON.stringify(['arrow', 'badge', 'blur']), `flow1 marks: ${JSON.stringify(r.marks)}`)
      const before = await bar(ed)
      r.summary = before.summary
      check(before.mode === 'summary' && before.summary === '이미지 1장 · 주석 3개', `flow1 summary: ${JSON.stringify(before)}`)
      await shot(ed, 'flow1-1-marked.png')
      await click(ed, '#send', 'flow1')
      await sleep(700)
      const after = await bar(ed)
      r.sent = sent.at(-1)
      r.delivery = after
      check(sent.length === 1 && JSON.stringify(sent[0].annotations) === JSON.stringify(['arrow', 'badge', 'blur']) && sent[0].opts.pressEnter === false, `flow1 send: ${JSON.stringify(sent)}`)
      check(after.mode === 'delivery' && after.headline === '붙여넣기를 시도했어요 · 제출은 직접 해주세요' && after.steps.length === 5 && after.steps.every((s) => s.startsWith('✓')), `flow1 delivery: ${JSON.stringify(after)}`)
      check(after.tone === 'wait', `flow1: an MCP target should wait for the fetch: ${after.tone}`)
      check(!ed.win.isDestroyed() && ed.win.isVisible(), 'flow1: the editor closed after sending')
      await shot(ed, 'flow1-2-sent.png')
      const merged = await ed.js<boolean>(`window.__backseat.deliveryUpdate(${JSON.stringify({
        sendId: 'selftest-flow-1', reached: ['fetched'],
        fetchedBy: { agentId: 'a1', name: 'Claude Code', cwd: 'D:\\backseat', at: new Date().toISOString(), tool: 'backseat_get', expected: true }
      })})`)
      const fetched = await bar(ed)
      r.fetched = fetched
      check(merged && fetched.headline === 'AI가 자료를 가져갔어요 · Claude Code' && fetched.steps.length === 6, `flow1 fetched: ${JSON.stringify(fetched)}`)
      await shot(ed, 'flow1-3-fetched.png')
      // an edit after sending: the bar shows what would be sent now, marked as changed
      await click(ed, '#tools [data-tool="pen"]', 'flow1')
      await drag(ed, [0.3, 0.85], [0.45, 0.9])
      const changed = await ed.js<{ mode: string; changed: boolean }>(`window.__backseat.sendbar()`)
      check(changed.mode === 'summary' && changed.changed, `flow1 edit after send: ${JSON.stringify(changed)}`)
      ed.win.destroy()
    }

    // ---- flow 2: spoken explanation, then send ----
    {
      const ed = await open('flow2', true)
      const r: Record<string, unknown> = {}
      report.flow2 = r
      await click(ed, '#tools [data-tool="arrow"]', 'flow2')
      await click(ed, '#mic', 'flow2')
      let recording = false
      for (let i = 0; i < 30 && !recording; i++) {
        await sleep(100)
        recording = await ed.js<boolean>(`document.getElementById('mic').classList.contains('recording')`)
      }
      r.recording = recording
      if (recording) {
        await drag(ed, [0.98, 0.3], [0.9, 0.22])
        await sleep(500)
        r.whileRecording = (await bar(ed)).summary
        check(String(r.whileRecording).includes('녹음 중'), `flow2: summary while recording: ${String(r.whileRecording)}`)
        await shot(ed, 'flow2-1-recording.png')
        await click(ed, '#mic', 'flow2')
      } else {
        warnings.push('flow2: the microphone did not start; the recording is simulated')
        await drag(ed, [0.98, 0.3], [0.9, 0.22])
        await ed.js(`window.__backseat.fakeRecording({ text: '이 버튼을 더 크게 해 주세요', audioStartMs: 0, durationMs: 1800, model: 'selftest', language: 'korean', segments: [{ start: 150, end: 1500, text: '이 버튼을 더 크게 해 주세요' }] }); true`)
      }
      let ready: Bar | null = null
      for (let i = 0; i < 40; i++) {
        ready = await bar(ed)
        if (ready.summary.includes('음성 설명 준비됨')) break
        await sleep(150)
      }
      r.ready = ready
      check(ready?.summary === '이미지 1장 · 주석 1개 · 음성 설명 준비됨' && ready.voiceLinks, `flow2 voice ready: ${JSON.stringify(ready)}`)
      await shot(ed, 'flow2-2-voice-ready.png')
      await click(ed, '#voice-links', 'flow2')
      await sleep(400)
      const tlOpen = await ed.js<boolean>(`!document.getElementById('timeline').hidden`)
      check(tlOpen, 'flow2: 음성 연결 확인 did not open the timeline')
      await shot(ed, 'flow2-3-voice-links.png')
      await key(ed, 'L')
      await click(ed, '#send', 'flow2')
      await sleep(700)
      r.sent = sent.at(-1)
      check(sent.at(-1)?.transcript === true && sent.at(-1)?.audio === true, `flow2 send lacks the voice: ${JSON.stringify(sent.at(-1))}`)
      r.delivery = await bar(ed)
      await shot(ed, 'flow2-4-sent.png')
      ed.win.destroy()
    }

    // ---- flow 3: text details open, change, back to the basic row; the options are remembered ----
    {
      const ed = await open('flow3', true)
      const r: Record<string, unknown> = {}
      report.flow3 = r
      await click(ed, '#tools [data-tool="text"]', 'flow3')
      r.textOptions = await opts(ed)
      check(JSON.stringify(r.textOptions) === JSON.stringify(['color', 'font', 'effect', 'text-more']), `text options: ${JSON.stringify(r.textOptions)}`)
      check(await ed.js<boolean>(`document.getElementById('textbar').hidden`), 'flow3: details row should start folded')
      await shot(ed, 'flow3-1-text-options.png')
      await tap(ed, 0.27, 0.235)
      for (const ch of '버튼 글자가 너무 작아요') ed.win.webContents.sendInputEvent({ type: 'char', keyCode: ch })
      await sleep(150)
      await click(ed, '#text-more', 'flow3')
      check(!(await ed.js<boolean>(`document.getElementById('textbar').hidden`)), 'flow3: 세부 did not open')
      check(await ed.js<boolean>(`document.querySelector('textarea.textbox') !== null`), 'flow3: opening 세부 closed the text box')
      await click(ed, '#text-invert', 'flow3')
      await click(ed, '#text-shadow', 'flow3')
      r.fitsWithDetails = await rowFits(ed)
      await shot(ed, 'flow3-2-details.png')
      await key(ed, 'Return')
      await sleep(200)
      const text = await ed.js<{ text: string; shadow?: boolean; bg?: string; color: string } | undefined>(`window.__backseat.payload().annotations.find((a) => a.kind === 'text')`)
      r.text = text
      check(text?.text === '버튼 글자가 너무 작아요' && text.shadow === true && text.bg === '#E5484D', `flow3 text: ${JSON.stringify(text)}`)
      await click(ed, '#text-more-close', 'flow3')
      await click(ed, '#tools [data-tool="arrow"]', 'flow3')
      r.backOptions = await opts(ed)
      check(JSON.stringify(r.backOptions) === JSON.stringify(['color', 'width']) && await ed.js<boolean>(`document.getElementById('textbar').hidden`), `flow3 back: ${JSON.stringify(r.backOptions)}`)
      await ed.js(`(() => { const w = document.getElementById('width'); w.value = '9'; w.dispatchEvent(new Event('input')); })()`)
      await shot(ed, 'flow3-3-back.png')
      ed.win.destroy()
      // a new capture opens with the last tool and each tool's last options
      const again = await open('flow3-reopen', false)
      const st = await state(again)
      r.reopened = { tool: st.tool, width: st.width }
      check(st.tool === 'arrow' && st.width === 9, `reopened editor should start with the arrow at width 9: ${JSON.stringify(r.reopened)}`)
      await click(again, '#tools [data-tool="text"]', 'flow3-reopen')
      const shadow = await again.js<string | null>(`document.getElementById('text-shadow').getAttribute('aria-pressed')`)
      check(shadow === 'true', `text shadow not remembered: ${shadow}`)
      await click(again, '#tools [data-tool="arrow"]', 'flow3-reopen')
      await shot(again, 'flow3-4-reopened.png')
      again.win.destroy()
    }

    // ---- flow 4: hide, undo, redo ----
    {
      const ed = await open('flow4', true)
      const r: Record<string, unknown> = {}
      report.flow4 = r
      await click(ed, '#tools [data-tool="blur"]', 'flow4')
      await drag(ed, [0.465, 0.27], [0.705, 0.86])
      r.hidden = await kinds(ed)
      await shot(ed, 'flow4-1-hidden.png')
      await key(ed, 'Z', ['control'])
      const undone = await state(ed)
      r.undone = { n: undone.annotations.length, canRedo: undone.canRedo }
      await shot(ed, 'flow4-2-undo.png')
      await key(ed, 'Z', ['control', 'shift'])
      const redone = await state(ed)
      r.redone = { n: redone.annotations.length, canUndo: redone.canUndo }
      await shot(ed, 'flow4-3-redo.png')
      check(JSON.stringify(r.hidden) === JSON.stringify(['blur']) && undone.annotations.length === 0 && undone.canRedo && redone.annotations.length === 1, `flow4 undo/redo: ${JSON.stringify(r)}`)
      // the strongest choice covers the area with one colour
      await click(ed, '[data-blur="100000"]', 'flow4')
      await drag(ed, [0.21, 0.025], [0.42, 0.085])
      await click(ed, '#undo', 'flow4')
      await click(ed, '#redo', 'flow4')
      r.final = await kinds(ed)
      check(JSON.stringify(r.final) === JSON.stringify(['blur', 'blur']), `flow4 buttons: ${JSON.stringify(r.final)}`)
      await shot(ed, 'flow4-4-solid.png')
      ed.win.destroy()
    }

    // ---- stops and the narrow window ----
    {
      const ed = await open('stops', true)
      const r: Record<string, unknown> = {}
      report.stops = r
      await ed.js(`window.__backseat.addAnnotations([{ kind: 'arrow', x1: 560, y1: 60, x2: 450, y2: 180, color: '#E5484D', width: 4, tStart: 10, tEnd: 20 }]); true`)
      await ed.js(`window.__backseat.fakeDelivery({ sendId: 'x', reached: ['saved', 'clipboard', 'targetVerified'], stoppedAt: { step: 'inputVerified', reason: 'passwordField' } }); true`)
      r.password = await bar(ed)
      await shot(ed, 'stop-password-field.png')
      await ed.js(`window.__backseat.fakeTarget(null); window.__backseat.fakeDelivery({ sendId: 'y', reached: ['saved', 'clipboard'], stoppedAt: { step: 'targetVerified', reason: 'noTarget' } }); true`)
      r.noTarget = await bar(ed)
      await shot(ed, 'stop-no-target.png')
      await click(ed, '#target-btn', 'stops')
      await shot(ed, 'target-menu.png')
      await key(ed, 'Escape')
      await click(ed, '#more', 'stops')
      await shot(ed, 'more-menu.png')
      await key(ed, 'Escape')
      ed.win.setMinimumSize(0, 0)
      ed.win.setContentSize(820, 600)
      await sleep(350)
      r.at820 = { fits: await rowFits(ed), fold: await ed.js<unknown>(`window.__backseat.fit()`) }
      await shot(ed, 'width-820.png')
      ed.win.setContentSize(480, 520)
      await sleep(350)
      r.at480 = { fits: await rowFits(ed), fold: await ed.js<unknown>(`window.__backseat.fit()`) }
      check((r.at480 as { fits: Record<string, boolean> }).fits.toolbar, `row 1 overflows at 480 px: ${JSON.stringify(r.at480)}`)
      await shot(ed, 'width-480.png')
      ed.win.destroy()
    }

    // ---- languages: row 1, the text options with 세부 open and the send bar after a stop, at 820 px ----
    const langs: Record<string, unknown> = {}
    report.languages = langs
    for (const l of ['ko', 'en', 'ja', 'de'] as const) {
      setLocaleOverride(l)
      const ed = await open(`lang-${l}`, true)
      ed.win.setMinimumSize(0, 0)
      ed.win.setContentSize(820, 600)
      await ed.js(`window.__backseat.addAnnotations([{ kind: 'arrow', x1: 560, y1: 60, x2: 450, y2: 180, color: '#E5484D', width: 4, tStart: 10, tEnd: 20 },
        { kind: 'badge', x: 836, y: 246, n: 1, color: '#E5484D', size: 22, tStart: 30, tEnd: 30 }]);
        document.querySelector('#tools [data-tool="text"]').click(); if (document.getElementById('textbar').hidden) document.getElementById('text-more').click(); true`)
      await sleep(400)
      const fits = await rowFits(ed)
      const fold = await ed.js<unknown>(`window.__backseat.fit()`)
      await shot(ed, `lang-${l}.png`)
      await ed.js(`window.__backseat.fakeDelivery({ sendId: 'x', reached: ['saved', 'clipboard', 'targetVerified'], stoppedAt: { step: 'inputVerified', reason: 'passwordField' } }); true`)
      await sleep(200)
      const delivered = await bar(ed)
      await shot(ed, `lang-${l}-delivery.png`)
      langs[l] = { fits, fold, headline: delivered.headline }
      for (const [id, ok] of Object.entries(fits)) check(ok, `${l}: #${id} overflows at 820 px`)
      ed.win.destroy()
    }
  } catch (err) {
    errors.push(`exception: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
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
