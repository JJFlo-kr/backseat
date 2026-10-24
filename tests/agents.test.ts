import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyTarget, instructionLine, matchPinned, pinParts } from '../src/main/agents.ts'
import { setMessages } from '../src/shared/i18n.ts'
import type { WindowInfo } from '../src/shared/types.ts'
import ko from '../src/locales/ko.json' with { type: 'json' }
import en from '../src/locales/en.json' with { type: 'json' }

// The labels are translated: assert against the Korean bundle (the source language).
setMessages('ko', ko)

let nextHwnd = 100
const win = (process: string, title: string, extra: Partial<WindowInfo> = {}): WindowInfo => ({
  hwnd: nextHwnd++,
  pid: 4242,
  title,
  process,
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  ...extra
})

test('ChatGPT.exe and Codex.exe are the Codex app (paste-image)', () => {
  const a = classifyTarget(win('ChatGPT.exe', 'ChatGPT'))
  assert.equal(a?.kind, 'codex')
  assert.equal(a?.method, 'paste-image')
  assert.equal(a?.label, 'Codex · ChatGPT 앱')
  assert.equal(a?.confidence, 0.8)
  assert.equal(classifyTarget(win('Codex.exe', 'Codex'))?.kind, 'codex')
})

test('Windows Terminal with a Claude Code title is claude-code (paste-path)', () => {
  const t = classifyTarget(win('WindowsTerminal.exe', '✳ Claude Code'))
  assert.equal(t?.kind, 'claude-code')
  assert.equal(t?.method, 'paste-path')
})

test('Claude app, Zed; Slack and Discord are plain windows (messengers, Phase 0 safety)', () => {
  assert.equal(classifyTarget(win('claude.exe', 'Claude'))?.kind, 'claude-desktop')
  const zed = classifyTarget(win('zed.exe', 'main.rs — zed'))
  assert.equal(zed?.label, 'Zed')
  assert.equal(zed?.method, 'paste-path')
  assert.equal(classifyTarget(win('slack.exe', 'general - Slack'))?.kind, 'unknown')
  assert.equal(classifyTarget(win('Discord.exe', 'Discord'))?.kind, 'unknown')
})

test('unknown apps and plain browser windows become the unknown-window target', () => {
  const n = classifyTarget(win('notepad.exe', '메모'))
  assert.equal(n?.kind, 'unknown')
  assert.equal(n?.method, 'paste-image')
  assert.equal(n?.confidence, 0.4)
  assert.ok(n?.label.startsWith('창: '))
  assert.equal(n?.label, '창: 메모 (notepad.exe)')
  const b = classifyTarget(win('chrome.exe', 'Weather'))
  assert.equal(b?.kind, 'unknown')
  assert.equal(b?.label, '창: Weather (chrome.exe)')
  assert.equal(classifyTarget(win('chrome.exe', 'Claude - Google Chrome'))?.kind, 'chat')
})

test('desktop, taskbar, untitled and own windows are not targets', () => {
  assert.equal(classifyTarget(win('explorer.exe', 'Program Manager', { className: 'Progman' })), null)
  assert.equal(classifyTarget(win('explorer.exe', '', { className: 'WorkerW' })), null)
  assert.equal(classifyTarget(win('explorer.exe', 'x', { className: 'WorkerW' })), null)
  assert.equal(classifyTarget(win('explorer.exe', 'Taskbar', { className: 'Shell_TrayWnd' })), null)
  assert.equal(classifyTarget(win('explorer.exe', 'Taskbar', { className: 'Shell_SecondaryTrayWnd' })), null)
  assert.equal(classifyTarget(win('notepad.exe', '')), null)
  assert.equal(classifyTarget(win('notepad.exe', '   ')), null)
  assert.equal(classifyTarget(null), null)
  assert.equal(classifyTarget(win('Backseat.exe', 'Backseat', { pid: 7 }), { selfPid: 7 }), null)
  assert.ok(classifyTarget(win('Backseat.exe', 'Backseat', { pid: 7 }), { selfPid: 8 }))
  // a real File Explorer folder window is still a real window
  assert.equal(classifyTarget(win('explorer.exe', 'Downloads', { className: 'CabinetWClass' }))?.kind, 'unknown')
})

test('matchPinned: process case-insensitive, title substring, front-most wins, none -> null', () => {
  const list = [win('chrome.exe', 'Docs'), win('CHATGPT.exe', 'ChatGPT - project A'), win('ChatGPT.exe', 'ChatGPT - project B')]
  assert.equal(matchPinned(list, 'chatgpt.exe', '')?.hwnd, list[1].hwnd)
  assert.equal(matchPinned(list, 'ChatGPT.exe', 'project B')?.hwnd, list[2].hwnd)
  assert.equal(matchPinned(list, 'chatgpt.exe', 'project C'), null)
  assert.equal(matchPinned(list, 'claude.exe', ''), null)
  assert.equal(matchPinned(list, '', ''), null)
  assert.deepEqual(pinParts({ process: 'a.exe', title: 'x'.repeat(40) }), { process: 'a.exe', title: 'x'.repeat(20) })
})

test('labels follow the current language', () => {
  setMessages('en', en)
  try {
    assert.equal(classifyTarget(win('ChatGPT.exe', 'ChatGPT'))?.label, 'Codex · ChatGPT app')
    assert.equal(classifyTarget(win('notepad.exe', 'Memo'))?.label, 'Window: Memo (notepad.exe)')
  } finally {
    setMessages('ko', ko)
  }
})

test('instructionLine: Korean by default, a given translator wins, memo is prefixed; MCP asks for backseat_get with the send id', () => {
  assert.equal(
    instructionLine('C:/s/brief.md', 'C:/s/annotated.png', ''),
    'Backseat 브리프 C:/s/brief.md 와 이미지 C:/s/annotated.png 를 읽고, 주석과 메모가 가리키는 대로 수정해줘.'
  )
  const mcp = instructionLine('C:/s/brief.md', 'C:/s/annotated.png', 'fix this', '20261025-100000-123-ab12')
  assert.ok(mcp.startsWith('fix this — Backseat로 방금 캡처를 보냈어. backseat_get 툴에 id "20261025-100000-123-ab12"'), mcp)
  assert.ok(mcp.endsWith('(파일: C:/s/brief.md)'))
  const tr = (key: string, p?: Record<string, string | number>): string => `<${key}:${p?.brief}:${p?.id ?? ''}>`
  assert.equal(instructionLine('b', 'p', '', undefined, tr), '<agents.instruction.paths:b:>')
  assert.equal(instructionLine('b', 'p', '', 'X1', tr), '<agents.instruction.mcp:b:X1>')
})
