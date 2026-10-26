// Pasting a job's request text into the editor's send target (src/main/uiux/jobpaste.ts): the same staged checks as
// a send, text only, never Enter. Win32 and UI Automation are faked, as in send.test.ts.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { installFakeElectron } from './support/fake-electron.ts'
import { fakeWin32 } from './support/fake-win32.ts'
import type { AgentTarget, TargetIdentity } from '../src/shared/types.ts'
import type { FocusInfo, PasteCheck, SoleInput } from '../src/main/native/uia-types.ts'
import { setMessages } from '../src/shared/i18n.ts'
import ko from '../src/locales/ko.json' with { type: 'json' }

installFakeElectron()
setMessages('ko', ko)

const W = {
  foreground: 0,
  live: new Map<number, { pid: number; processStartMs: number; title: string }>(),
  focusOk: true,
  focus: [] as (FocusInfo | null)[],
  checks: 0,
  sole: { candidates: 0, focused: false } as SoleInput,
  paste: { pasted: true } as PasteCheck,
  pastes: 0,
  enters: 0,
  uiaThrows: false
}
mock.module('../src/main/native/win32.ts', {
  exports: fakeWin32({
    liveWindow: (h: number) => W.live.get(h) ?? null,
    foregroundHwnd: () => W.foreground,
    focusWindow: async (h: number) => {
      if (W.focusOk) W.foreground = h
      return W.focusOk
    },
    describeWindow: (h: number) => {
      const l = W.live.get(h)
      return l ? { hwnd: h, pid: l.pid, title: l.title, process: 'x.exe', bounds: { x: 0, y: 0, width: 1, height: 1 } } : null
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
    uiaFocusSoleInput: async () => W.sole,
    uiaPasteIfUnchanged: async () => {
      W.pastes++
      return W.paste
    },
    uiaEnterIfUnchanged: async () => {
      W.enters++
      return { pasted: true }
    },
    uiaClear: () => undefined,
    uiaFocus: async () => null,
    uiaAvailable: () => true,
    stopUia: () => undefined
  }
})

const { pasteTextToTarget } = await import('../src/main/uiux/jobpaste.ts')
const { toView } = await import('../src/main/targets.ts')

const id = (hwnd: number, title: string, process: string): TargetIdentity => ({ hwnd, pid: 500, processStartMs: 1000, title, process })
const terminal: AgentTarget = { kind: 'claude-code', label: 'Claude Code', hwnd: 777, title: 'Claude Code', process: 'WindowsTerminal.exe', method: 'paste-path', confidence: 0.9 }
const browser: AgentTarget = { kind: 'chat', label: 'Web chat', hwnd: 888, title: 'Chat - Chrome', process: 'chrome.exe', method: 'paste-image', confidence: 0.7 }
const ctx = (t: AgentTarget) => {
  const identity = id(t.hwnd, t.title, t.process)
  return { target: t, identity, view: toView(t, 'recent-agent', identity) }
}
const field = (over: Partial<FocusInfo> = {}): FocusInfo => ({
  pid: 500, controlType: 50004, className: 'Chrome_RenderWidgetHostHWND', frameworkId: 'Chrome', isPassword: false, hasKeyboardFocus: true,
  isEnabled: true, isKeyboardFocusable: true, valuePattern: true, valueReadOnly: false, textPattern: true, nativeHwnd: 0, ...over
})
const TEXT = 'Backseat job job-1: call backseat_job_get'

beforeEach(() => {
  W.foreground = 0
  W.live = new Map([
    [777, { pid: 500, processStartMs: 1000, title: 'Claude Code' }],
    [888, { pid: 500, processStartMs: 1000, title: 'Chat - Chrome' }]
  ])
  W.focusOk = true
  W.focus = [field()]
  W.checks = 0
  W.sole = { candidates: 0, focused: false }
  W.paste = { pasted: true }
  W.pastes = 0
  W.enters = 0
  W.uiaThrows = false
})

test('verified field: Ctrl+V is sent once, Enter never, and the message says it was an attempt', async () => {
  const r = await pasteTextToTarget(ctx(browser), TEXT)
  assert.equal(r.pasted, true)
  assert.equal(W.pastes, 1)
  assert.equal(W.enters, 0)
  assert.equal(W.foreground, 888)
  assert.match(r.message, /시도/)
})

test('a terminal target is accepted by its text area', async () => {
  W.focus = [field({ className: 'TermControl', controlType: 50033 })]
  const r = await pasteTextToTarget(ctx(terminal), TEXT)
  assert.equal(r.pasted, true)
  assert.equal(W.enters, 0)
})

test('a password field: nothing pasted, the reason is named', async () => {
  W.focus = [field({ isPassword: true })]
  const r = await pasteTextToTarget(ctx(browser), TEXT)
  assert.deepEqual([r.pasted, r.reason], [false, 'passwordField'])
  assert.equal(W.pastes, 0)
  assert.match(r.message, /비밀번호/)
})

test('no target, a clipboard-only target or no input check: not pasted, and the message does not claim it was', async () => {
  const none = await pasteTextToTarget(null, TEXT)
  assert.deepEqual([none.pasted, none.reason], [false, 'noTarget'])
  assert.match(none.message, /클립보드/)
  const clip = await pasteTextToTarget(ctx({ ...terminal, method: 'clipboard' }), TEXT)
  assert.equal(clip.pasted, false)
  W.focus = [null]
  const blank = await pasteTextToTarget(ctx(browser), TEXT)
  assert.deepEqual([blank.pasted, blank.reason], [false, 'notEditable'])
  assert.equal(W.pastes, 0)
})

test('the window closed, changed its page, could not be focused, or UIA hung: not pasted', async () => {
  W.live.delete(777)
  assert.equal((await pasteTextToTarget(ctx(terminal), TEXT)).reason, 'targetExpired')
  W.live.set(888, { pid: 500, processStartMs: 1000, title: 'Sign in - Chrome' })
  const changed = await pasteTextToTarget(ctx(browser), TEXT)
  assert.equal(changed.reason, 'targetChanged')
  assert.equal(W.foreground, 0, 'not even brought forward')
  W.live.set(888, { pid: 500, processStartMs: 1000, title: 'Chat - Chrome' })
  W.focusOk = false
  assert.equal((await pasteTextToTarget(ctx(browser), TEXT)).reason, 'focusLost')
  W.focusOk = true
  W.uiaThrows = true
  assert.equal((await pasteTextToTarget(ctx(browser), TEXT)).reason, 'uiaUnavailable')
  W.uiaThrows = false
  W.paste = { pasted: false, reason: 'focus' }
  assert.equal((await pasteTextToTarget(ctx(browser), TEXT)).reason, 'focusLost')
  assert.equal(W.enters, 0)
})
