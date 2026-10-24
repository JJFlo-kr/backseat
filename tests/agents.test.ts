import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asFallback, buildCandidates, classifyTarget, matchPinned, pinParts } from '../src/main/agents.ts'
import type { WindowInfo } from '../src/shared/types.ts'

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

test('Claude app, Zed, Slack, Discord', () => {
  assert.equal(classifyTarget(win('claude.exe', 'Claude'))?.kind, 'claude-desktop')
  const zed = classifyTarget(win('zed.exe', 'main.rs — zed'))
  assert.equal(zed?.label, 'Zed')
  assert.equal(zed?.method, 'paste-path')
  const slack = classifyTarget(win('slack.exe', 'general - Slack'))
  assert.equal(slack?.kind, 'chat')
  assert.equal(slack?.label, 'Slack')
  assert.equal(slack?.method, 'paste-image')
  assert.equal(classifyTarget(win('Discord.exe', 'Discord'))?.label, 'Discord')
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

test('asFallback adds exactly one suffix to the original label', () => {
  const orig = classifyTarget(win('claude.exe', 'Claude'))!
  const fb = asFallback(orig)
  assert.equal(fb.label, 'Claude 앱 (직전 대상)')
  assert.equal(orig.label, 'Claude 앱')
  assert.equal(fb.confidence, 0.5)
})

test('buildCandidates: known apps first, front-most order, excludes detected/own/shell, max 12', () => {
  const detected = win('ChatGPT.exe', 'ChatGPT')
  const list = [
    win('notepad.exe', 'a'),
    detected,
    win('Backseat.exe', 'self', { pid: 7 }),
    win('explorer.exe', 'Program Manager', { className: 'Progman' }),
    win('claude.exe', 'Claude'),
    win('calc.exe', 'Calculator'),
    win('WindowsTerminal.exe', 'pwsh')
  ]
  const c = buildCandidates(list, { selfPid: 7, excludeHwnd: detected.hwnd })
  assert.deepEqual(
    c.map((t) => t.process),
    ['claude.exe', 'WindowsTerminal.exe', 'notepad.exe', 'calc.exe']
  )
  const many = Array.from({ length: 30 }, (_, i) => win('app.exe', `w${i}`))
  assert.equal(buildCandidates(many).length, 12)
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
