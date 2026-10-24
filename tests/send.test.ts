// The staged send (src/main/send.ts) with Win32 and UI Automation faked: only confirmed steps are reported,
// a password field / another window / a lost focus stops BEFORE Ctrl+V, the editor is never hidden and
// comes back on a stop, Enter only after a verified paste, and the delivery log holds no typed text.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { FakeBrowserWindow, installFakeElectron } from './support/fake-electron.ts'
import { fakeWin32 } from './support/fake-win32.ts'
import type { AgentTarget, ExportPayload, TargetIdentity } from '../src/shared/types.ts'
import type { FocusInfo, PasteCheck, SoleInput } from '../src/main/native/uia-types.ts'
import { setMessages } from '../src/shared/i18n.ts'
import ko from '../src/locales/ko.json' with { type: 'json' }

installFakeElectron()
setMessages('ko', ko)

const W = {
  foreground: 0,
  live: new Map<number, { pid: number; processStartMs: number; title: string }>(),
  focusOk: true,
  /** What UIA sees on each inputCheck call, in order (the last one repeats). */
  focus: [] as (FocusInfo | null)[],
  checks: 0,
  sole: { candidates: 0, focused: false } as SoleInput,
  soleCalls: 0,
  paste: { pasted: true } as PasteCheck,
  pastes: 0,
  enters: 0,
  enter: { pasted: true } as PasteCheck,
  uiaThrows: false,
  describeThrows: false
}
const PROCESS: Record<number, string> = { 777: 'WindowsTerminal.exe', 888: 'chrome.exe', 999: 'ChatGPT.exe', 555: 'KakaoTalk.exe' }

mock.module('../src/main/native/win32.ts', {
  exports: fakeWin32({
    liveWindow: (h: number) => W.live.get(h) ?? null,
    foregroundHwnd: () => W.foreground,
    focusWindow: async (h: number) => {
      if (W.focusOk) W.foreground = h
      return W.focusOk
    },
    describeWindow: (h: number) => {
      if (W.describeThrows && W.pastes > 0) throw new Error('window vanished mid-way')
      const l = W.live.get(h)
      return l ? { hwnd: h, pid: l.pid, title: l.title, process: PROCESS[h] ?? 'x.exe', bounds: { x: 0, y: 0, width: 1, height: 1 } } : null
    }
  })
})
mock.module('../src/main/native/uia.ts', {
  exports: {
    uiaInputCheck: async () => {
      if (W.uiaThrows) throw new Error('UI Automation did not answer in time')
      const f = W.focus[Math.min(W.checks, W.focus.length - 1)] ?? null
      W.checks++
      return f
    },
    uiaFocusSoleInput: async () => {
      W.soleCalls++
      return W.sole
    },
    uiaPasteIfUnchanged: async () => {
      W.pastes++
      return W.paste
    },
    uiaEnterIfUnchanged: async () => {
      if (W.enter.pasted) W.enters++
      return W.enter
    },
    uiaClear: () => undefined,
    uiaFocus: async () => null,
    uiaAvailable: () => true,
    stopUia: () => undefined
  }
})

const { sendToTarget } = await import('../src/main/send.ts')
const { toView } = await import('../src/main/targets.ts')
const { deliveryLogPath } = await import('../src/main/diaglog.ts')

const SECRET_TITLE = 'Private chat with Alice - Chrome'
const MEMO = 'my-secret-memo-text'
const id = (hwnd: number, title: string, process: string): TargetIdentity => ({ hwnd, pid: 500, processStartMs: 1000, title, process })
const terminal: AgentTarget = { kind: 'claude-code', label: 'Claude Code · 터미널', hwnd: 777, title: '✳ Claude Code', process: 'WindowsTerminal.exe', method: 'paste-path', confidence: 0.9 }
const kakao: AgentTarget = { kind: 'unknown', label: '창: 카카오톡', hwnd: 555, title: '카카오톡', process: 'KakaoTalk.exe', method: 'paste-image', confidence: 0.4 }
const browser: AgentTarget = { kind: 'chat', label: '웹 채팅', hwnd: 888, title: SECRET_TITLE, process: 'chrome.exe', method: 'paste-image', confidence: 0.7 }
const codexApp: AgentTarget = { kind: 'codex', label: 'Codex · ChatGPT 앱', hwnd: 999, title: 'ChatGPT', process: 'ChatGPT.exe', method: 'paste-image', confidence: 0.8 }
const ctx = (t: AgentTarget) => {
  const identity = id(t.hwnd, t.title, t.process)
  return { target: t, identity, view: toView(t, 'recent-agent', identity) }
}
const payload: ExportPayload = {
  pngDataUrl: 'data:image/png;base64,iVBORw0KGgo=', memo: MEMO, annotations: [],
  meta: { capturedAt: '', displayId: 0, scaleFactor: 1, rectDip: { x: 0, y: 0, width: 1, height: 1 }, rectPx: { x: 0, y: 0, width: 1, height: 1 }, mode: 'rect' }
}
const field = (over: Partial<FocusInfo> = {}): FocusInfo => ({
  pid: 500, controlType: 50004, className: 'Chrome_RenderWidgetHostHWND', frameworkId: 'Chrome', isPassword: false, hasKeyboardFocus: true,
  isEnabled: true, isKeyboardFocusable: true, valuePattern: true, valueReadOnly: false, textPattern: true, nativeHwnd: 0, ...over
})

beforeEach(() => {
  W.foreground = 0
  W.live = new Map([
    [777, { pid: 500, processStartMs: 1000, title: '✳ Claude Code' }],
    [555, { pid: 500, processStartMs: 1000, title: '카카오톡' }],
    [888, { pid: 500, processStartMs: 1000, title: SECRET_TITLE }],
    [999, { pid: 500, processStartMs: 1000, title: 'ChatGPT' }]
  ])
  W.focusOk = true
  W.focus = [field()]
  W.checks = 0
  W.sole = { candidates: 0, focused: false }
  W.soleCalls = 0
  W.paste = { pasted: true }
  W.pastes = 0
  W.enters = 0
  W.enter = { pasted: true }
  W.describeThrows = false
  W.uiaThrows = false
})

test('verified paste: all steps reached, attempt wording, editor never hidden', async () => {
  const win = new FakeBrowserWindow()
  win.show()
  const r = await sendToTarget(win as never, payload, ctx(browser), { pressEnter: false })
  assert.equal(r.delivered, 'pasted')
  assert.deepEqual(r.status?.reached, ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'])
  assert.equal(r.status?.stoppedAt, undefined)
  assert.equal(r.status?.enterPressed, undefined)
  assert.ok(r.status?.sendId)
  assert.equal(W.pastes, 1)
  assert.equal(W.enters, 0)
  assert.equal(win.isVisible(), true, 'the editor stays visible')
  assert.equal(W.foreground, 888)
  assert.match(r.message, /시도|Tried/)
})

test('password field: stopped at the input check, no Ctrl+V, editor comes back', async () => {
  W.focus = [field({ isPassword: true })]
  const win = new FakeBrowserWindow()
  win.show()
  win.focused = false
  const r = await sendToTarget(win as never, payload, ctx(browser), { pressEnter: true })
  assert.deepEqual(r.status?.stoppedAt, { step: 'inputVerified', reason: 'passwordField' })
  assert.deepEqual(r.status?.reached, ['saved', 'clipboard', 'targetVerified'])
  assert.equal(W.pastes, 0)
  assert.equal(W.enters, 0)
  assert.equal(r.delivered, 'clipboard', 'the package is on the clipboard for a manual paste')
  assert.equal(win.focused, true)
})

test('a browser tab switched to another page: targetChanged before focusing, nothing pasted', async () => {
  W.live.set(888, { pid: 500, processStartMs: 1000, title: 'Sign in - Acme - Chrome' })
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(browser))
  assert.deepEqual(r.status?.stoppedAt, { step: 'targetVerified', reason: 'targetChanged' })
  assert.equal(W.foreground, 0, 'the window was not even brought forward')
  assert.equal(W.pastes, 0)
})

test('a confirmed title is accepted only while the window still shows exactly that title, and gets no Enter', async () => {
  W.live.set(888, { pid: 500, processStartMs: 1000, title: 'ChatGPT - new chat - Chrome' })
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(browser), { pressEnter: true }, { acceptTitle: 'ChatGPT - new chat - Chrome' })
  assert.equal(r.delivered, 'pasted')
  assert.equal(W.enters, 0, 'no auto Enter on a confirmed title change')
  W.live.set(888, { pid: 500, processStartMs: 1000, title: 'Billing - Chrome' })
  const r2 = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(browser), {}, { acceptTitle: 'ChatGPT - new chat - Chrome' })
  assert.equal(r2.status?.stoppedAt?.reason, 'targetChanged', 'it changed again after the user looked: stop again')
  assert.equal(W.pastes, 1)
})

test('the target closed or its process restarted: targetExpired, no other window used', async () => {
  W.live.delete(777)
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(terminal))
  assert.deepEqual(r.status?.stoppedAt, { step: 'targetVerified', reason: 'targetExpired' })
  assert.equal(r.targetExpired, true)
  assert.equal(W.foreground, 0)
  W.live.set(777, { pid: 500, processStartMs: 2000, title: '✳ Claude Code' })
  const r2 = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(terminal))
  assert.equal(r2.status?.stoppedAt?.reason, 'targetExpired')
  assert.ok(r2.status?.reached.includes('saved'), 'the package is kept')
})

test('the window could not be brought forward: focusLost, nothing pasted', async () => {
  W.focusOk = false
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(terminal))
  assert.deepEqual(r.status?.stoppedAt, { step: 'targetVerified', reason: 'focusLost' })
  assert.equal(W.pastes, 0)
})

test('focus moved between the check and Ctrl+V: stopped at pasted with focusLost', async () => {
  W.paste = { pasted: false, reason: 'focus' }
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(browser), { pressEnter: true })
  assert.deepEqual(r.status?.stoppedAt, { step: 'pasted', reason: 'focusLost' })
  assert.deepEqual(r.status?.reached, ['saved', 'clipboard', 'targetVerified', 'inputVerified'])
  assert.equal(W.enters, 0)
})

test('UIA not answering: uiaUnavailable, nothing pasted blind', async () => {
  W.uiaThrows = true
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(terminal), { pressEnter: true })
  assert.deepEqual(r.status?.stoppedAt, { step: 'inputVerified', reason: 'uiaUnavailable' })
  assert.equal(W.pastes, 0)
  assert.equal(W.enters, 0)
})

test('Codex app without a focused input: the only input box is focused through UIA, then pasted', async () => {
  W.focus = [field({ controlType: 50030, valueReadOnly: true }), field()]
  W.sole = { candidates: 1, focused: true }
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(codexApp), { pressEnter: false })
  assert.equal(W.soleCalls, 1)
  assert.equal(r.delivered, 'pasted')
})

test('Codex app with several or no input boxes: stops with notEditable (no guessing, no Tab, no clicks)', async () => {
  W.focus = [field({ controlType: 50000, valuePattern: false, valueReadOnly: null })]
  W.sole = { candidates: 2, focused: false }
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(codexApp))
  assert.deepEqual(r.status?.stoppedAt, { step: 'inputVerified', reason: 'notEditable' })
  assert.equal(W.pastes, 0)
})

test('a browser page without a focused input is not tried with UIA focus (apps only)', async () => {
  W.focus = [field({ controlType: 50030, valueReadOnly: true })]
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(browser))
  assert.equal(W.soleCalls, 0)
  assert.equal(r.status?.stoppedAt?.reason, 'notEditable')
})

test('auto Enter after a verified paste only, and reported as enterPressed', async () => {
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(terminal), { pressEnter: true })
  assert.equal(W.enters, 1)
  assert.equal(r.status?.enterPressed, true)
})

test('no auto Enter when the focus moved after the paste, the terminal tab became a plain shell, or the target is a picked messenger', async () => {
  W.enter = { pasted: false, reason: 'focus' }
  const a = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(terminal), { pressEnter: true })
  assert.equal(a.delivered, 'pasted')
  assert.equal(a.status?.enterPressed, undefined)
  W.enter = { pasted: true }
  // the paste went in, then the tab shows a plain PowerShell: Enter would run the line as a command
  W.focus = [field({ className: 'TermControl', controlType: 50020, valuePattern: false, valueReadOnly: null })]
  W.live.set(777, { pid: 500, processStartMs: 1000, title: 'Windows PowerShell' })
  const b = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(terminal), { pressEnter: true })
  assert.equal(b.delivered, 'pasted')
  assert.equal(b.status?.enterPressed, undefined)
  W.focus = [field()]
  const c = await sendToTarget(new FakeBrowserWindow() as never, payload, { ...ctx(kakao), view: toView(kakao, 'picked', id(555, '카카오톡', 'KakaoTalk.exe')) }, { pressEnter: true })
  assert.equal(c.delivered, 'pasted')
  assert.equal(c.status?.enterPressed, undefined, 'Enter in a messenger would message a person')
  assert.equal(W.enters, 0)
})

test('an error after Ctrl+V still reports the paste (no "failed")', async () => {
  W.describeThrows = true // the first call after Ctrl+V
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(browser), { pressEnter: false })
  assert.equal(W.pastes, 1)
  assert.equal(r.ok, true)
  assert.deepEqual(r.status?.reached, ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'])
  assert.equal(r.delivered, 'pasted')
})

test('no target / clipboard only: saved + clipboard, stopped with noTarget, nothing focused', async () => {
  const none = { target: null, identity: null, view: toView(null, 'none', null) }
  const r = await sendToTarget(new FakeBrowserWindow() as never, payload, none)
  assert.deepEqual(r.status?.reached, ['saved', 'clipboard'])
  assert.deepEqual(r.status?.stoppedAt, { step: 'targetVerified', reason: 'noTarget' })
  const c = await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(terminal), { clipboardOnly: true })
  assert.equal(c.status?.stoppedAt?.reason, 'noTarget')
  assert.equal(c.status?.target?.source, 'none')
  assert.equal(W.foreground, 0)
})

test('the delivery log has steps and verdicts but no window title, memo or clipboard text', async () => {
  W.focus = [field({ isPassword: true })]
  await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(browser))
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(existsSync(deliveryLogPath()))
  const log = readFileSync(deliveryLogPath(), 'utf8')
  assert.match(log, /"passwordField"/)
  assert.match(log, /"isPassword":true/)
  for (const secret of [SECRET_TITLE, 'Alice', MEMO, 'brief.md', 'annotated.png']) assert.equal(log.includes(secret), false, secret)
})

test('a capture with nothing added goes out as the picture alone: no instruction text', async () => {
  const electron = (await import('electron')) as unknown as { clipboard: { write: (items: { parts: Record<string, unknown> }[]) => Promise<void> } }
  const written: Record<string, unknown>[] = []
  const original = electron.clipboard.write
  electron.clipboard.write = async (items) => {
    written.push(items[0].parts)
  }
  try {
    const plain = { ...payload, memo: '' }
    // chat UI: image only
    const r = await sendToTarget(new FakeBrowserWindow() as never, plain, ctx(browser))
    assert.equal(r.delivered, 'pasted')
    assert.ok(written.at(-1)!['image/png'], 'the image is on the clipboard')
    assert.equal('text/plain' in written.at(-1)!, false, 'no instruction line next to it')
    // terminal: the image path alone
    await sendToTarget(new FakeBrowserWindow() as never, plain, ctx(terminal))
    const line = String(written.at(-1)!['text/plain'])
    assert.match(line, /annotated\.png"?$/)
    assert.equal(line.includes('brief'), false, 'no brief, no instructions')
    // no target: image only as well
    await sendToTarget(new FakeBrowserWindow() as never, plain, { target: null, identity: null, view: toView(null, 'none', null) })
    assert.equal('text/plain' in written.at(-1)!, false)
    // with a memo the instruction line is back
    await sendToTarget(new FakeBrowserWindow() as never, payload, ctx(browser))
    assert.match(String(written.at(-1)!['text/plain']), new RegExp(MEMO))
  } finally {
    electron.clipboard.write = original
  }
})
