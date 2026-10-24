// Phase 0 safety (real incident, 2026-10-24): 전송 pasted the instruction into the captured Chrome page
// (a sign-up / payment form) and into KakaoTalk, because any unknown front window became the target.
// Only known AI tools may be pasted into automatically; anything else only when the user picks or pins it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyTarget, detectTarget, isAutoTarget, resolveSendTarget } from '../src/main/agents.ts'
import { setMessages } from '../src/shared/i18n.ts'
import type { AgentTarget, WindowInfo } from '../src/shared/types.ts'
import ko from '../src/locales/ko.json' with { type: 'json' }

setMessages('ko', ko)

let nextHwnd = 500
const win = (process: string, title: string): WindowInfo => ({
  hwnd: nextHwnd++, pid: 4242, title, process, bounds: { x: 0, y: 0, width: 800, height: 600 }
})
const alive = (): boolean => true
const front = (w: WindowInfo, prev: AgentTarget | null = null) => detectTarget({ pinned: null, front: w, prev }, alive)

const CHROME_SIGNUP = win('chrome.exe', 'Buy Me a Coffee - 가입하기 - Chrome')
const CHROME_PAYMENT = win('chrome.exe', '결제 설정 · Buy Me a Coffee - Chrome')
const KAKAO = win('KakaoTalk.exe', '카카오톡')
const MESSENGERS = [
  KAKAO,
  win('slack.exe', 'general - Slack'),
  win('Discord.exe', 'Discord'),
  win('ms-teams.exe', 'Microsoft Teams'),
  win('Telegram.exe', 'Telegram'),
  win('LINE.exe', 'LINE')
]

test('the captured sign-up / payment page in front: no target (clipboard + pick)', () => {
  for (const w of [CHROME_SIGNUP, CHROME_PAYMENT]) {
    const r = front(w)
    assert.equal(r.target, null, w.title)
    assert.equal(r.detected, null)
  }
})

test('messengers in front: no target', () => {
  for (const w of MESSENGERS) assert.equal(front(w).target, null, w.process)
})

test('known AI tools in front are still used', () => {
  assert.equal(front(win('ChatGPT.exe', 'ChatGPT')).target?.kind, 'codex')
  assert.equal(front(win('claude.exe', 'Claude')).target?.kind, 'claude-desktop')
  assert.equal(front(win('WindowsTerminal.exe', '✳ Claude Code')).target?.kind, 'claude-code')
  assert.equal(front(win('Cursor.exe', 'main.ts - Cursor')).target?.kind, 'cursor')
  const tab = front(win('chrome.exe', 'ChatGPT - Chrome')).target
  assert.equal(tab?.kind, 'chat')
  assert.equal(tab?.method, 'paste-image')
  assert.equal(front(win('msedge.exe', 'Claude - Microsoft Edge')).target?.kind, 'chat')
})

test('an unknown front window does not fall back to the previous target either', () => {
  const prev = classifyTarget(win('ChatGPT.exe', 'ChatGPT'))
  assert.equal(front(KAKAO, prev).target, null, 'something real was in front: no silent fallback')
  // Desktop / taskbar / our own window in front: the previous AI target is reused.
  const desktop: WindowInfo = { ...win('explorer.exe', 'Program Manager'), className: 'Progman' }
  assert.match(front(desktop, prev).target?.label ?? '', /ChatGPT|Codex/)
})

test('a previous target that was an explicitly picked unknown window is not reused automatically', () => {
  const picked = classifyTarget(KAKAO)
  const desktop: WindowInfo = { ...win('explorer.exe', 'Program Manager'), className: 'Progman' }
  assert.equal(front(desktop, picked).target, null)
})

test('a pinned window is the user’s explicit choice and is used even when unknown', () => {
  const r = detectTarget({ pinned: CHROME_SIGNUP, front: KAKAO, prev: null }, alive)
  assert.equal(r.target?.hwnd, CHROME_SIGNUP.hwnd)
  assert.equal(r.pinned, true)
})

test('an unknown window picked in the target menu is used for that send', () => {
  const picked = classifyTarget(KAKAO)!
  assert.equal(isAutoTarget(picked), false)
  const r = resolveSendTarget(null, [picked], { targetHwnd: KAKAO.hwnd }, alive)
  assert.equal(r.kind === 'target' && r.target?.hwnd, KAKAO.hwnd)
})
