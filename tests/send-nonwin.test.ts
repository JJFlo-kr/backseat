// macOS / Linux preview: win32 gives no API (win32Available() is false), so a send cannot pick a window,
// check the input box or paste. It puts the package on the clipboard and stops with pasteUnsupported —
// whatever target the caller passed — and never reports a target or an input check as done.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { FakeBrowserWindow, installFakeElectron } from './support/fake-electron.ts'
import { fakeWin32 } from './support/fake-win32.ts'
import type { AgentTarget, ExportPayload, TargetIdentity } from '../src/shared/types.ts'
import { setMessages } from '../src/shared/i18n.ts'
import { STEP_ORDER, deliveryView } from '../src/renderer/editor/delivery.ts'
import en from '../src/locales/en.json' with { type: 'json' }
import ko from '../src/locales/ko.json' with { type: 'json' }

installFakeElectron()
setMessages('en', en)

const calls = { focus: 0, uia: 0 }
mock.module('../src/main/native/win32.ts', {
  exports: fakeWin32({
    win32Available: () => false,
    focusWindow: async () => {
      calls.focus++
      return true
    }
  })
})
mock.module('../src/main/native/uia.ts', {
  exports: {
    uiaInputCheck: async () => { calls.uia++; return null },
    uiaFocusSoleInput: async () => { calls.uia++; return { candidates: 0, focused: false } },
    uiaPasteIfUnchanged: async () => { calls.uia++; return { pasted: true } },
    uiaEnterIfUnchanged: async () => { calls.uia++; return { pasted: true } },
    uiaClear: () => undefined,
    uiaFocus: async () => null,
    uiaAvailable: () => false,
    stopUia: () => undefined
  }
})

const { sendToTarget } = await import('../src/main/send.ts')
const { toView } = await import('../src/main/targets.ts')

const terminal: AgentTarget = { kind: 'claude-code', label: 'Claude Code', hwnd: 777, title: 'Claude Code', process: 'x', method: 'paste-path', confidence: 0.9 }
const id: TargetIdentity = { hwnd: 777, pid: 500, processStartMs: 1000, title: 'Claude Code', process: 'x' }
const payload: ExportPayload = {
  pngDataUrl: 'data:image/png;base64,iVBORw0KGgo=', memo: 'look here', annotations: [],
  meta: { capturedAt: '', displayId: 0, scaleFactor: 1, rectDip: { x: 0, y: 0, width: 1, height: 1 }, rectPx: { x: 0, y: 0, width: 1, height: 1 }, mode: 'rect' }
}
const none = { target: null, identity: null, view: toView(null, 'none', null) }
const withTarget = { target: terminal, identity: id, view: toView(terminal, 'recent-agent', id) }

async function capturingClipboard<T>(run: () => Promise<T>): Promise<{ result: T; written: Record<string, unknown>[] }> {
  const electron = (await import('electron')) as unknown as { clipboard: { write: (items: { parts: Record<string, unknown> }[]) => Promise<void> } }
  const written: Record<string, unknown>[] = []
  const original = electron.clipboard.write
  electron.clipboard.write = async (items) => {
    written.push(items[0].parts)
  }
  try {
    return { result: await run(), written }
  } finally {
    electron.clipboard.write = original
  }
}

test('no win32: the content goes to the clipboard and the send stops with pasteUnsupported', async () => {
  const { result: r, written } = await capturingClipboard(() => sendToTarget(new FakeBrowserWindow() as never, payload, none))
  assert.equal(written.length, 1)
  assert.ok(written[0]['image/png'], 'the image is on the clipboard')
  assert.match(String(written[0]['text/plain']), /look here/, 'with the instruction line')
  assert.deepEqual(r.status?.reached, ['saved', 'clipboard'])
  assert.deepEqual(r.status?.stoppedAt, { step: 'pasted', reason: 'pasteUnsupported' })
  assert.equal(r.delivered, 'clipboard')
  assert.equal(r.ok, true)
  assert.match(r.message, /Automatic paste isn't available on this operating system/)
  assert.match(r.message, /Cmd\+V/)
})

test('no win32: a target passed in is neither focused, checked nor claimed', async () => {
  for (const opts of [{}, { clipboardOnly: true }, { pressEnter: true }]) {
    const { result: r, written } = await capturingClipboard(() => sendToTarget(new FakeBrowserWindow() as never, payload, withTarget, opts))
    assert.equal(r.status?.stoppedAt?.reason, 'pasteUnsupported', JSON.stringify(opts))
    assert.equal(r.status?.reached.includes('targetVerified'), false)
    assert.equal(r.status?.reached.includes('inputVerified'), false)
    assert.equal(r.status?.reached.includes('pasted'), false)
    assert.equal(r.status?.enterPressed, undefined)
    assert.ok(written[0]['image/png'])
  }
  assert.equal(calls.focus, 0, 'no window was brought forward')
  assert.equal(calls.uia, 0, 'UI Automation was not asked')
})

test('no win32: a capture with nothing added is the picture alone', async () => {
  const { written } = await capturingClipboard(() => sendToTarget(new FakeBrowserWindow() as never, { ...payload, memo: '' }, none))
  assert.ok(written[0]['image/png'])
  assert.equal('text/plain' in written[0], false)
})

test('pasteUnsupported reads as clipboard-only in the editor: steps saved + clipboard, nothing verified, no resend', async () => {
  const { result: r } = await capturingClipboard(() => sendToTarget(new FakeBrowserWindow() as never, payload, none))
  for (const [name, tr] of [['en', (k: string) => (en as Record<string, string>)[k]], ['ko', (k: string) => (ko as Record<string, string>)[k]]] as const) {
    const v = deliveryView(r.status!, {}, (k) => tr(k) ?? k)
    assert.deepEqual(v.steps.map((s) => [s.step, s.state]), [['saved', 'done'], ['clipboard', 'done'], ['pasted', 'stopped']], name)
    assert.equal(v.primary, null)
    assert.ok(v.headline && !v.headline.startsWith('editor.'), name)
    assert.ok(v.detail && !v.detail.startsWith('editor.'), name)
    assert.match(v.detail, /Cmd\+V/)
  }
  assert.ok(STEP_ORDER.indexOf('pasted') > STEP_ORDER.indexOf('clipboard'))
})
