// Codex review F09: a window the user picked in the target menu that has closed since must not be
// silently replaced by the automatic target. Real src/main/editor.ts IPC; send and Win32 are faked.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { FakeBrowserWindow, installFakeElectron } from './support/fake-electron.ts'
import type { AgentTarget, EditorInit, ExportPayload, SendResult } from '../src/shared/types.ts'

const fake = installFakeElectron()

const alive = new Set<number>()
const sends: { target: AgentTarget | null }[] = []
mock.module('../src/main/native/win32.ts', {
  exports: {
    isWindow: (h: number) => alive.has(h),
    win32Available: () => true,
    getForegroundWindow: () => null,
    listTopLevelWindows: () => [],
    focusWindow: async () => true,
    sendCtrlV: () => true,
    sendEnter: () => true
  }
})
mock.module('../src/main/send.ts', {
  exports: {
    sendToTarget: async (_win: unknown, _p: ExportPayload, target: AgentTarget | null): Promise<SendResult> => {
      sends.push({ target })
      return { ok: true, delivered: 'pasted', message: 'ok' }
    }
  }
})

const { createEditorWindow, installEditorIpc } = await import('../src/main/editor.ts')
const { IPC } = await import('../src/shared/ipc.ts')

const target = (hwnd: number, label: string): AgentTarget => ({
  kind: 'claude-code', label, hwnd, title: label, process: 'WindowsTerminal.exe', method: 'paste-path', confidence: 0.9
})
const A = target(101, 'auto A')
const B = target(202, 'picked B')

const meta: EditorInit['meta'] = {
  capturedAt: '2026-10-25T10:00:00.000Z', displayId: 0, scaleFactor: 1,
  rectDip: { x: 0, y: 0, width: 10, height: 10 }, rectPx: { x: 0, y: 0, width: 10, height: 10 }, mode: 'rect'
}
const payload: ExportPayload = { pngDataUrl: 'data:image/png;base64,AA==', memo: '', annotations: [], meta }

function openEditor(): FakeBrowserWindow {
  installEditorIpc()
  createEditorWindow({ imageDataUrl: '', width: 10, height: 10, meta, target: A, candidates: [B], autoRecord: false })
  return FakeBrowserWindow.all.at(-1)!
}

async function send(win: FakeBrowserWindow, targetHwnd?: number): Promise<SendResult> {
  const h = fake.ipcHandlers.get(IPC.editorSend)!
  return (await h({ sender: win.webContents }, payload, targetHwnd ? { targetHwnd } : {})) as SendResult
}

test('picked window still open: it is the one used', async () => {
  alive.clear(); alive.add(101); alive.add(202); sends.length = 0
  const win = openEditor()
  await send(win, 202)
  assert.equal(sends.at(-1)?.target?.hwnd, 202)
})

test('picked window closed: nothing goes to the automatic target, the editor hears targetExpired', async () => {
  alive.clear(); alive.add(101); sends.length = 0 // B (202) was closed after it was picked
  const win = openEditor()
  const r = await send(win, 202)
  assert.equal(sends.find((s) => s.target?.hwnd === 101), undefined, 'must not fall back to the automatic target A')
  assert.equal(sends.length, 0)
  assert.equal(r.ok, false)
  assert.equal(r.targetExpired, true)
})

test('no pick: the automatic target is used as before', async () => {
  alive.clear(); alive.add(101); sends.length = 0
  const win = openEditor()
  await send(win)
  assert.equal(sends.at(-1)?.target?.hwnd, 101)
})
