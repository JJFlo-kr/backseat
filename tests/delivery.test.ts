// Phase 2 checks before Ctrl+V (request (1) items 2–4): same window instance, an editable non-password
// input of that process, staged status with only confirmed steps, Enter only after a verified paste, and a
// log line without anything the user typed. src/main/delivery.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareIdentity, DeliveryTracker, elementForLog, judgeInput, mayFocusSoleInput, mayPressEnter, sameInstance } from '../src/main/delivery.ts'
import { UIA_CONTROL, type FocusInfo } from '../src/main/native/uia-types.ts'
import type { TargetIdentity } from '../src/shared/types.ts'

const id: TargetIdentity = { hwnd: 10, pid: 500, processStartMs: 1000, title: 'ChatGPT - Chrome', process: 'chrome.exe' }

test('identity: same instance, closed, reused handle, restarted process', () => {
  assert.equal(compareIdentity(id, { pid: 500, processStartMs: 1000, title: 'ChatGPT - Chrome' }, 'chat'), 'same')
  assert.equal(compareIdentity(id, null, 'chat'), 'expired')
  assert.equal(compareIdentity(id, { pid: 501, processStartMs: 1000, title: 'ChatGPT - Chrome' }, 'chat'), 'expired')
  assert.equal(compareIdentity(id, { pid: 500, processStartMs: 2000, title: 'ChatGPT - Chrome' }, 'chat'), 'expired')
  assert.equal(sameInstance(id, { pid: 500, processStartMs: 0, title: 'x' }), true, 'unknown start time: pid decides')
})

test('identity: a browser / picked window with another title changed; terminals and AI apps may retitle', () => {
  const other = { pid: 500, processStartMs: 1000, title: 'Sign in - Chrome' }
  assert.equal(compareIdentity(id, other, 'chat'), 'titleChanged')
  assert.equal(compareIdentity(id, other, 'unknown'), 'titleChanged')
  for (const k of ['claude-code', 'terminal', 'codex', 'claude-desktop', 'vscode', 'cursor'] as const) {
    assert.equal(compareIdentity(id, other, k), 'same', k)
  }
})

const field = (over: Partial<FocusInfo> = {}): FocusInfo => ({
  pid: 500, controlType: UIA_CONTROL.edit, className: '', frameworkId: 'Chrome', isPassword: false, hasKeyboardFocus: true,
  isEnabled: true, isKeyboardFocusable: true, valuePattern: true, valueReadOnly: false, textPattern: true, nativeHwnd: 0, ...over
})
const chat = { pid: 500, method: 'paste-image' as const, kind: 'chat' as const }
const terminal = { pid: 500, method: 'paste-path' as const, kind: 'claude-code' as const }

test('input table: password, read-only, other process, nothing focused, page, button, disabled', () => {
  assert.deepEqual(judgeInput(field(), chat), { ok: true, via: 'field' })
  assert.deepEqual(judgeInput(field({ controlType: UIA_CONTROL.document }), chat), { ok: true, via: 'field' }, 'contenteditable document')
  assert.deepEqual(judgeInput(field({ isPassword: true }), chat), { ok: false, reason: 'passwordField' })
  assert.deepEqual(judgeInput(field({ valueReadOnly: true }), chat), { ok: false, reason: 'notEditable' })
  assert.deepEqual(judgeInput(field({ pid: 999 }), chat), { ok: false, reason: 'focusLost' })
  assert.deepEqual(judgeInput(null, chat), { ok: false, reason: 'notEditable' })
  // the web page itself (Document, read-only value = URL), a button, a pane without Value pattern
  assert.deepEqual(judgeInput(field({ controlType: UIA_CONTROL.document, valueReadOnly: true }), chat), { ok: false, reason: 'notEditable' })
  assert.deepEqual(judgeInput(field({ controlType: 50000, valuePattern: false, valueReadOnly: null }), chat), { ok: false, reason: 'notEditable' })
  assert.deepEqual(judgeInput(field({ controlType: UIA_CONTROL.pane, valuePattern: false, valueReadOnly: null }), chat), { ok: false, reason: 'notEditable' })
  assert.deepEqual(judgeInput(field({ isEnabled: false }), chat), { ok: false, reason: 'notEditable' })
})

test('a password field is refused before anything else, even in a terminal or another process', () => {
  assert.deepEqual(judgeInput(field({ isPassword: true, className: 'TermControl' }), terminal), { ok: false, reason: 'passwordField' })
  assert.deepEqual(judgeInput(field({ isPassword: true, pid: 1 }), chat), { ok: false, reason: 'passwordField' })
})

test('terminal text areas pass for terminal targets only', () => {
  const wt = field({ controlType: UIA_CONTROL.text, className: 'TermControl', valuePattern: false, valueReadOnly: null })
  assert.deepEqual(judgeInput(wt, terminal), { ok: true, via: 'terminal' })
  const conhost = field({ pid: 4321, controlType: UIA_CONTROL.pane, className: 'ConsoleWindowClass', valuePattern: false, valueReadOnly: null })
  assert.deepEqual(judgeInput(conhost, terminal), { ok: true, via: 'terminal' }, 'conhost element pid differs from the shell pid of the window')
  assert.deepEqual(judgeInput(wt, chat), { ok: false, reason: 'notEditable' })
})

test('only the Claude and ChatGPT·Codex apps may get their sole input focused', () => {
  assert.equal(mayFocusSoleInput('claude-desktop'), true)
  assert.equal(mayFocusSoleInput('codex'), true)
  for (const k of ['chat', 'unknown', 'terminal', 'claude-code', 'vscode'] as const) assert.equal(mayFocusSoleInput(k), false, k)
})

test('status: steps in order, each once; a stop records step and reason', () => {
  const tr = new DeliveryTracker({ source: 'recent-agent', label: 'Codex', estimated: true, method: 'paste-image' })
  tr.reach('clipboard')
  tr.reach('saved')
  tr.reach('saved')
  assert.deepEqual(tr.status.reached, ['saved', 'clipboard'])
  tr.stop('inputVerified', 'passwordField')
  assert.deepEqual(tr.status.stoppedAt, { step: 'inputVerified', reason: 'passwordField' })
  assert.equal(tr.has('pasted'), false)
})

test('Enter only after target, input and paste were all confirmed, and never after a stop', () => {
  const ok = { sendId: 'x', reached: ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'] as const }
  const ai = { kind: 'claude-code' as const, sameKindNow: true, confirmed: false }
  assert.equal(mayPressEnter({ ...ok, reached: [...ok.reached] }, true, ai), true)
  assert.equal(mayPressEnter({ ...ok, reached: [...ok.reached] }, false, ai), false)
  assert.equal(mayPressEnter({ sendId: 'x', reached: ['saved', 'clipboard', 'targetVerified', 'pasted'] }, true, ai), false)
  assert.equal(mayPressEnter({ ...ok, reached: [...ok.reached], stoppedAt: { step: 'pasted', reason: 'focusLost' } }, true, ai), false)
})

test('Enter never into a plain shell, a picked messenger / page, a retitled terminal or a merely confirmed target', () => {
  const st = { sendId: 'x', reached: ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'] as ('saved' | 'clipboard' | 'targetVerified' | 'inputVerified' | 'pasted')[] }
  assert.equal(mayPressEnter(st, true, { kind: 'terminal', sameKindNow: true, confirmed: false }), false, 'shell would run it')
  assert.equal(mayPressEnter(st, true, { kind: 'unknown', sameKindNow: true, confirmed: false }), false, 'a person could get it')
  assert.equal(mayPressEnter(st, true, { kind: 'claude-code', sameKindNow: false, confirmed: false }), false, 'tab is a shell now')
  assert.equal(mayPressEnter(st, true, { kind: 'chat', sameKindNow: true, confirmed: true }), false, 'confirmed title change')
  for (const k of ['claude-code', 'claude-desktop', 'codex', 'cursor', 'vscode', 'chat'] as const) {
    assert.equal(mayPressEnter(st, true, { kind: k, sameKindNow: true, confirmed: false }), true, k)
  }
})

test('log element: type and flags only — no name, value or title can get in; page class names are not logged', () => {
  const e = elementForLog(field({ isPassword: true, className: 'x'.repeat(200), frameworkId: 'Win32' }), 500)
  assert.deepEqual(Object.keys(e ?? {}).sort(), ['className', 'controlType', 'frameworkId', 'isPassword', 'readOnly', 'samePid'])
  assert.equal(e?.className.length, 64)
  assert.equal(e?.isPassword, true)
  assert.equal(elementForLog(field({ className: 'secret-user-name-css-class', frameworkId: 'Chrome' }), 500)?.className, '(web)')
  assert.equal(elementForLog(field({ className: 'Chrome_RenderWidgetHostHWND', frameworkId: 'Chrome' }), 500)?.className, 'Chrome_RenderWidgetHostHWND')
  assert.equal(elementForLog(null, 1), undefined)
})
