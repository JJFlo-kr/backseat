/**
 * Delivery self-test (plan 2026-10-25 §4, request (1) "검증"): the six situations of the incident report,
 * against real windows — a fake AI chat and a fake sign-in page (tests/fixtures/delivery, fake account only)
 * opened in a separate Chrome / Edge profile — and the real pipeline: target model, editor IPC
 * (window.backseat.editor.send through preload), UI Automation checks and Ctrl+V.
 *
 *   electron . --selftest-delivery
 *
 * Prints one `BACKSEAT_DELIVERY_TEST {json}` line. It moves the focus between windows and uses the
 * clipboard (restored at the end): run it only while nobody uses the machine, and hold D:\backseat-ui-test.lock.
 * Verdicts: nothing ever lands in a sign-in field, a changed / closed target stops the paste, the status
 * names exactly the steps that happened, and the same content can be sent again after a failure.
 */
import { app, clipboard, type BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { createServer, type Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import type { EditorInit, ExportPayload, SendOptions, SendResult, SendTargetView, WindowInfo } from '../shared/types'
import { resolveForCapture } from './destination'
import { createEditorWindow } from './editor'
import { classifyTarget } from './agents'
import { judgeInput } from './delivery'
import { closeWindow, describeWindow, focusWindow, getForegroundWindow, listTopLevelWindows, processStartMs, tapKeys } from './native/win32'
import { stopUia, uiaFocus } from './native/uia'
import { identityOf, toView } from './targets'
import { observeForeground, resetTracker } from './tracker'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const VK_CONTROL = 0x11
const VK_A = 0x41
const VK_BACK = 0x08

interface Field {
  len: number
  marker: boolean
}
interface PageState {
  page: string
  title: string
  active: string
  prompt?: Field
  user?: Field
  pass?: Field
}

interface ScenarioResult {
  name: string
  pass: boolean
  source?: SendTargetView['source']
  reached?: string[]
  stoppedAt?: string
  notes: string[]
}

// ---------- fake pages ----------

function fixtureDir(): string {
  return join(app.getAppPath(), 'tests', 'fixtures', 'delivery')
}

class Pages {
  readonly states = new Map<string, PageState>()
  private readonly cmds = new Map<string, Record<string, unknown>[]>()
  server: Server | null = null
  port = 0

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'POST' && url.pathname === '/state') {
        let body = ''
        req.on('data', (c: Buffer) => (body += c.toString()))
        req.on('end', () => {
          try {
            const s = JSON.parse(body) as PageState
            this.states.set(s.page, s)
          } catch {
            /* ignore */
          }
          res.end('ok')
        })
        return
      }
      if (url.pathname === '/cmd') {
        const q = this.cmds.get(url.searchParams.get('page') ?? '') ?? []
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(q.shift() ?? {}))
        return
      }
      const file = { '/chat.html': 'chat.html', '/login.html': 'login.html' }[url.pathname]
      if (file) {
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(readFileSync(join(fixtureDir(), file)))
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', () => resolve()))
    const addr = this.server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : 0
  }

  cmd(page: string, c: Record<string, unknown>): void {
    const q = this.cmds.get(page) ?? []
    q.push(c)
    this.cmds.set(page, q)
  }

  /** Send a command and wait until the page has applied it (its next report after the command). */
  async apply(page: string, c: Record<string, unknown>, until?: (s: PageState) => boolean): Promise<PageState | null> {
    this.cmd(page, c)
    return this.waitFor(page, until ?? (() => true), 3000, true)
  }

  async waitFor(page: string, pred: (s: PageState) => boolean, timeoutMs = 3000, fresh = false): Promise<PageState | null> {
    if (fresh) this.states.delete(page)
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      const s = this.states.get(page)
      if (s && pred(s)) return s
      await sleep(60)
    }
    return this.states.get(page) ?? null
  }

  stop(): void {
    this.server?.close()
  }
}

// ---------- a separate browser profile ----------

function browserExe(): string | null {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA ?? ''
  const list = [
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]
  return list.find((p) => existsSync(p)) ?? null
}

class Browser {
  readonly profile = mkdtempSync(join(tmpdir(), 'backseat-delivery-profile-'))
  private first: ChildProcess | null = null
  constructor(private readonly exe: string) {}

  open(urls: string[], x: number): void {
    const args = [
      `--user-data-dir=${this.profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--new-window',
      `--window-position=${x},60`,
      '--window-size=760,620',
      ...urls
    ]
    const p = spawn(this.exe, args, { detached: false, stdio: 'ignore' })
    this.first ??= p
  }

  close(): void {
    if (this.first?.pid) spawn('taskkill', ['/PID', String(this.first.pid), '/T', '/F'], { stdio: 'ignore' })
  }

  cleanup(): void {
    try {
      rmSync(this.profile, { recursive: true, force: true })
    } catch {
      /* the browser may still hold files for a moment */
    }
  }
}

async function findWindow(part: string, timeoutMs = 15000): Promise<WindowInfo | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const w = listTopLevelWindows().find((x) => x.title.includes(part))
    if (w) return w
    await sleep(200)
  }
  return null
}

/** Bring a test window forward the way the user would (and let the tracker see it). */
async function front(w: WindowInfo): Promise<boolean> {
  const ok = await focusWindow(w.hwnd)
  await sleep(250)
  observeForeground()
  return ok
}

// ---------- the editor, driven through its real IPC ----------

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

function payload(): ExportPayload {
  return {
    pngDataUrl: `data:image/png;base64,${PNG_1x1}`,
    memo: 'Backseat delivery self-test',
    annotations: [{ kind: 'badge', x: 10, y: 10, n: 1, color: '#E5484D', size: 24, tStart: 0, tEnd: 10 }],
    meta: {
      capturedAt: new Date().toISOString(),
      displayId: 0,
      scaleFactor: 1,
      rectDip: { x: 0, y: 0, width: 1, height: 1 },
      rectPx: { x: 0, y: 0, width: 1, height: 1 },
      mode: 'rect'
    }
  }
}

/** A capture taken while `capturedWin` is in front: target resolved like startCapture() does, editor opened. */
async function capture(capturedWin: WindowInfo, errors: string[]): Promise<BrowserWindow> {
  const targets = await resolveForCapture(capturedWin)
  const init: EditorInit = {
    imageDataUrl: `data:image/png;base64,${PNG_1x1}`,
    width: 1,
    height: 1,
    meta: payload().meta,
    target: targets.current.target,
    targetPinned: targets.current.view.source === 'pinned' ? true : undefined,
    candidates: [...targets.candidates.values()].map((c) => c.target),
    sendTarget: targets.current.view,
    autoRecord: false
  }
  const ed = createEditorWindow(init, errors, targets)
  await new Promise<void>((resolve) => ed.webContents.once('did-finish-load', () => resolve()))
  await sleep(700)
  ed.focus()
  return ed
}

async function edSend(ed: BrowserWindow, opts: SendOptions = {}): Promise<SendResult> {
  ed.show()
  ed.focus()
  await sleep(200)
  return (await ed.webContents.executeJavaScript(`window.backseat.editor.send(${JSON.stringify(payload())}, ${JSON.stringify(opts)})`)) as SendResult
}

async function edTargets(ed: BrowserWindow): Promise<SendTargetView[]> {
  return (await ed.webContents.executeJavaScript(`window.backseat.editor.targets()`)) as SendTargetView[]
}

// ---------- one real app window (manual verification, never presses Enter) ----------

/**
 * `--selftest-real=<hwnd>`: send a harmless test payload to that window through the editor IPC with Enter
 * off, and print the status. `--real-dry`: only bring it forward and report the UI Automation verdict (no
 * Ctrl+V). `--real-clear`: empty the input box the paste went into (Ctrl+A, Backspace) — only after the same
 * checks as a paste (same window in front, an editable non-password field). Used for the user-approved
 * real-app checks of plan 2026-10-25 §5.2; whoever runs it prepares a NEW window / conversation first.
 */
export async function runRealAppCheck(hwnd: number): Promise<void> {
  const out: Record<string, unknown> = { hwnd }
  const errors: string[] = []
  try {
    const win = describeWindow(hwnd)
    const t = win ? classifyTarget(win, { selfPid: process.pid }) : null
    if (!win || !t) throw new Error('no such window')
    const identity = identityOf(win, processStartMs)
    out.process = win.process
    out.kind = t.kind
    out.method = t.method
    if (process.argv.includes('--real-dry') || process.argv.includes('--real-clear')) {
      await focusWindow(hwnd)
      await sleep(400)
      const f = await uiaFocus()
      const v = judgeInput(f, { pid: identity.pid, method: t.method, kind: t.kind })
      out.element = f ? { controlType: f.controlType, className: f.className, frameworkId: f.frameworkId, isPassword: f.isPassword, readOnly: f.valueReadOnly, samePid: f.pid === identity.pid } : null
      out.verdict = v
      if (process.argv.includes('--real-clear') && v.ok && v.via === 'field' && f && !f.isPassword) {
        tapKeys([VK_CONTROL, VK_A])
        await sleep(80)
        for (let i = 0; i < 4; i++) tapKeys([VK_BACK])
        out.cleared = true
      }
    } else {
      const state = { current: { target: t, identity, view: toView(t, 'picked', identity) }, candidates: new Map() }
      const init: EditorInit = {
        imageDataUrl: `data:image/png;base64,${PNG_1x1}`, width: 1, height: 1, meta: payload().meta,
        target: t, candidates: [], sendTarget: state.current.view, autoRecord: false
      }
      const ed = createEditorWindow(init, errors, state)
      await new Promise<void>((resolve) => ed.webContents.once('did-finish-load', () => resolve()))
      await sleep(700)
      const r = await edSend(ed, { pressEnter: false })
      out.status = r.status
      out.message = r.message
      await sleep(400)
      ed.destroy()
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  } finally {
    stopUia()
  }
  console.log('BACKSEAT_REAL_CHECK ' + JSON.stringify({ ...out, errors }))
  app.exit(errors.length ? 1 : 0)
}

// ---------- run ----------

export async function runDeliverySelfTest(): Promise<void> {
  const errors: string[] = []
  const results: ScenarioResult[] = []
  const exe = browserExe()
  // The sends overwrite the clipboard: keep what the user had (every format) and put it back afterwards.
  const saved = await clipboard.read().catch(() => [])
  const pages = new Pages()
  let browser: Browser | null = null
  const token = Math.random().toString(16).slice(2, 6)
  try {
    if (process.platform !== 'win32' || !exe) throw new Error('needs Windows with Chrome or Edge')
    await pages.start()
    browser = new Browser(exe)
    const url = (file: string, id: string, title = ''): string =>
      `http://127.0.0.1:${pages.port}/${file}?id=${id}&port=${pages.port}${title ? `&title=${encodeURIComponent(title)}` : ''}`
    const titleA = `ChatGPT · fake chat A ${token}`
    const titleB = `ChatGPT · fake chat B ${token}`
    browser.open([url('chat.html', 'A', titleA)], 40)
    await sleep(2500)
    browser.open([url('chat.html', 'B', titleB)], 420)
    browser.open([url('login.html', 'L')], 800)
    const A = await findWindow(titleA)
    const B = await findWindow(titleB)
    const L = await findWindow('Acme Tasks · Sign in (fake)')
    if (!A || !B || !L) throw new Error(`test windows did not appear (A ${Boolean(A)}, B ${Boolean(B)}, L ${Boolean(L)})`)
    for (const p of ['A', 'B', 'L']) if (!(await pages.waitFor(p, () => true, 8000))) throw new Error(`page ${p} never reported`)

    const clearAll = async (): Promise<void> => {
      await pages.apply('A', { clear: true, stealMs: 0 })
      await pages.apply('B', { clear: true, stealMs: 0 })
      await pages.apply('L', { clear: true })
    }
    const fieldsOf = async (): Promise<{ A: PageState | null; B: PageState | null; L: PageState | null }> => {
      await sleep(500)
      return { A: await pages.waitFor('A', () => true, 2000, true), B: await pages.waitFor('B', () => true, 2000, true), L: await pages.waitFor('L', () => true, 2000, true) }
    }
    const loginUntouched = (s: PageState | null): boolean => Boolean(s && s.user?.len === 0 && s.pass?.len === 0)
    const record = (name: string, r: SendResult | null, pass: boolean, notes: string[]): void => {
      results.push({
        name,
        pass,
        source: r?.status?.target?.source,
        reached: r?.status?.reached,
        stoppedAt: r?.status?.stoppedAt ? `${r.status.stoppedAt.step}:${r.status.stoppedAt.reason}` : undefined,
        notes
      })
    }

    // 1. AI input clicked, then another page (a sign-in form with a blinking cursor) captured and sent.
    {
      resetTracker()
      await clearAll()
      await pages.apply('A', { focus: 'prompt' }, (s) => s.active === 'prompt')
      await front(A)
      await pages.apply('L', { focus: 'user' }, (s) => s.active === 'user')
      await front(L)
      const ed = await capture(L, errors)
      const r = await edSend(ed, { pressEnter: false })
      const f = await fieldsOf()
      const pass = r.status?.target?.source === 'recent-agent' && r.status.reached.includes('pasted') && f.A?.prompt?.marker === true && loginUntouched(f.L)
      record('1 AI input, then capture of a sign-in page', r, pass, [`chat A got it: ${f.A?.prompt?.marker}`, `login fields: ${f.L?.user?.len}/${f.L?.pass?.len}`])
      ed.destroy()
    }

    // 2. A sign-in page with the cursor in the ID / password field: never pasted into, even when picked.
    {
      resetTracker()
      await clearAll()
      await pages.apply('L', { focus: 'pass' }, (s) => s.active === 'pass')
      await front(L)
      const ed = await capture(L, errors)
      const r1 = await edSend(ed)
      const views = await edTargets(ed)
      const pickL = views.find((v) => v.identity?.hwnd === L.hwnd)
      await pages.apply('L', { focus: 'pass' }, (s) => s.active === 'pass')
      const r2 = pickL ? await edSend(ed, { targetHwnd: L.hwnd }) : null
      const f = await fieldsOf()
      const pass =
        r1.status?.target?.source === 'none' && r1.status.stoppedAt?.reason === 'noTarget' &&
        r2?.status?.stoppedAt?.reason === 'passwordField' && !r2.status.reached.includes('pasted') && loginUntouched(f.L)
      record('2a sign-in page in front, nothing chosen', r1, r1.status?.stoppedAt?.reason === 'noTarget', ['no automatic target'])
      record('2b sign-in page explicitly picked, password field focused', r2, pass, [`login fields: ${f.L?.user?.len}/${f.L?.pass?.len}`, `offered in menu: ${Boolean(pickL)}`])
      ed.destroy()
    }

    // 3. The AI window is open but its input box does not have the focus.
    {
      resetTracker()
      await clearAll()
      await pages.apply('A', { focus: 'button' }, (s) => s.active === 'newchat')
      await front(A)
      await front(L)
      const ed = await capture(L, errors)
      const r = await edSend(ed)
      const f = await fieldsOf()
      const pass = r.status?.stoppedAt?.reason === 'notEditable' && r.status.reached.includes('targetVerified') && f.A?.prompt?.len === 0 && loginUntouched(f.L)
      record('3 AI window open, input not focused', r, pass, [`chat A empty: ${f.A?.prompt?.len === 0}`])
      ed.destroy()
    }

    // 4a. Two windows of the same app: the picked one gets it, the other (used more recently) does not.
    {
      resetTracker()
      await clearAll()
      await pages.apply('A', { focus: 'prompt' }, (s) => s.active === 'prompt')
      await pages.apply('B', { focus: 'prompt' }, (s) => s.active === 'prompt')
      await front(A)
      await front(B)
      await front(L)
      const ed = await capture(L, errors)
      const auto = (await edTargets(ed))[0]
      await edTargets(ed) // the menu was opened
      const r = await edSend(ed, { targetHwnd: A.hwnd, pressEnter: false })
      const f = await fieldsOf()
      const pass = auto?.identity?.hwnd === B.hwnd && r.status?.target?.source === 'picked' && f.A?.prompt?.marker === true && f.B?.prompt?.len === 0
      record('4a same app, two windows: picked one only', r, pass, [`automatic was B: ${auto?.identity?.hwnd === B.hwnd}`, `A got it: ${f.A?.prompt?.marker}`, `B empty: ${f.B?.prompt?.len === 0}`])
      ed.destroy()
    }

    // 4b. Same window, another conversation / page now showing (title changed): stop, ask once.
    {
      resetTracker()
      await clearAll()
      await pages.apply('A', { focus: 'prompt' }, (s) => s.active === 'prompt')
      await front(A)
      await front(L)
      const ed = await capture(L, errors)
      await pages.apply('A', { title: `Acme Tasks · other page ${token}` }, (s) => s.title.startsWith('Acme'))
      await sleep(300)
      const r = await edSend(ed, { pressEnter: false })
      const f1 = await fieldsOf()
      const r2 = await edSend(ed, { confirmTarget: true, pressEnter: false })
      const f2 = await fieldsOf()
      const pass = r.status?.stoppedAt?.reason === 'targetChanged' && f1.A?.prompt?.len === 0 && r2.status?.reached.includes('pasted') === true && f2.A?.prompt?.marker === true
      record('4b same window, title changed: stop, then confirmed once', r, pass, [`stopped before paste: ${f1.A?.prompt?.len === 0}`, `after confirm: ${r2.status?.stoppedAt?.reason ?? 'pasted'}`])
      await pages.apply('A', { title: titleA }, (s) => s.title === titleA)
      ed.destroy()
    }

    // 5b. The focus moves inside the target right after it comes forward.
    {
      resetTracker()
      await clearAll()
      await pages.apply('A', { focus: 'prompt' }, (s) => s.active === 'prompt')
      await front(A)
      await front(L)
      await pages.apply('A', { stealMs: 30 })
      const ed = await capture(L, errors)
      const r = await edSend(ed, { pressEnter: true })
      const f = await fieldsOf()
      const stopped = r.status?.stoppedAt?.reason === 'notEditable' || r.status?.stoppedAt?.reason === 'focusLost'
      const pass = stopped && !r.status?.reached.includes('pasted') && f.A?.prompt?.len === 0 && r.status?.enterPressed !== true
      record('5b focus moved right before Ctrl+V', r, pass, [`chat A empty: ${f.A?.prompt?.len === 0}`])
      await pages.apply('A', { stealMs: 0 })
      ed.destroy()
    }

    // 5a + 6. The target closes while editing: stop (no other window), then the same content goes to a re-picked window.
    {
      resetTracker()
      await clearAll()
      await pages.apply('B', { focus: 'prompt' }, (s) => s.active === 'prompt')
      await pages.apply('A', { focus: 'prompt' }, (s) => s.active === 'prompt')
      await front(A)
      await front(B)
      await front(L)
      const ed = await capture(L, errors)
      closeWindow(B.hwnd)
      await sleep(1200)
      const r = await edSend(ed, { pressEnter: true })
      const f = await fieldsOf()
      const pass5 = r.status?.stoppedAt?.reason === 'targetExpired' && f.A?.prompt?.len === 0 && loginUntouched(f.L) && r.status.reached.includes('saved')
      record('5a target closed while editing', r, pass5, [`A untouched: ${f.A?.prompt?.len === 0}`, `package kept: ${r.status?.reached.includes('saved')}`])
      const views = await edTargets(ed)
      const again = views.find((v) => v.identity?.hwnd === A.hwnd)
      const r2 = again ? await edSend(ed, { targetHwnd: A.hwnd, pressEnter: false }) : null
      const f2 = await fieldsOf()
      let same = false
      if (r.status?.sessionDir && r2?.status?.sessionDir) {
        const s1 = readFileSync(join(r.status.sessionDir, 'strokes.json'), 'utf8')
        const s2 = readFileSync(join(r2.status.sessionDir, 'strokes.json'), 'utf8')
        same = s1 === s2
      }
      const pass6 = Boolean(r2?.status?.reached.includes('pasted')) && f2.A?.prompt?.marker === true && same
      record('6 retry the same content after the failure', r2, pass6, [`same annotations in both packages: ${same}`, `first view after close: ${views[0]?.source}`])
      ed.destroy()
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  } finally {
    browser?.close()
    pages.stop()
    stopUia()
    // Leave the user's clipboard as it was.
    if (saved.length > 0) await clipboard.write(saved).catch(() => undefined)
    else clipboard.clear()
    await sleep(800)
    browser?.cleanup()
  }
  const ok = errors.length === 0 && results.length > 0 && results.every((r) => r.pass)
  const fg = getForegroundWindow()
  console.log('BACKSEAT_DELIVERY_TEST ' + JSON.stringify({ ok, errors, results, foregroundAfter: fg?.process }))
  app.exit(ok ? 0 : 1)
}
