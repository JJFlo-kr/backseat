// Codex review F05 (main side) + the 2026-10-25 decision "the editor stays open after a send": the editor,
// pinned or not, is visible again after a successful paste, without taking the focus. Real src/main/send.ts.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { FakeBrowserWindow, installFakeElectron } from './support/fake-electron.ts'
import type { AgentTarget, ExportPayload } from '../src/shared/types.ts'

installFakeElectron()

let foreground = 0
mock.module('../src/main/native/win32.ts', {
  exports: {
    isWindow: () => true,
    win32Available: () => true,
    getForegroundWindow: () => (foreground ? { hwnd: foreground, pid: 1, title: 't', process: 'p', bounds: { x: 0, y: 0, width: 1, height: 1 } } : null),
    listTopLevelWindows: () => [],
    focusWindow: async (h: number) => {
      foreground = h
      return true
    },
    sendCtrlV: () => true,
    sendEnter: () => true
  }
})

const { sendToTarget } = await import('../src/main/send.ts')

const target: AgentTarget = { kind: 'claude-code', label: 'T', hwnd: 777, title: 'T', process: 'WindowsTerminal.exe', method: 'paste-path', confidence: 1 }
const payload: ExportPayload = {
  pngDataUrl: 'data:image/png;base64,iVBORw0KGgo=', memo: '', annotations: [],
  meta: { capturedAt: '', displayId: 0, scaleFactor: 1, rectDip: { x: 0, y: 0, width: 1, height: 1 }, rectPx: { x: 0, y: 0, width: 1, height: 1 }, mode: 'rect' }
}

test('pinned editor: shown again (without taking focus) after the paste', async () => {
  const win = new FakeBrowserWindow()
  win.show()
  win.setAlwaysOnTop(true)
  const r = await sendToTarget(win as never, payload, target, { pressEnter: false })
  assert.equal(r.delivered, 'pasted')
  assert.equal(win.isVisible(), true, 'pinned reference window must stay usable')
  assert.equal(foreground, 777, 'focus stays on the agent window')
})

test('unpinned editor: also shown again (it stays open now), focus stays on the agent window', async () => {
  const win = new FakeBrowserWindow()
  win.show()
  foreground = 0
  const r = await sendToTarget(win as never, payload, target, { pressEnter: false })
  assert.equal(r.delivered, 'pasted')
  assert.equal(win.isVisible(), true)
  assert.equal(win.focused, false)
  assert.equal(foreground, 777)
})
