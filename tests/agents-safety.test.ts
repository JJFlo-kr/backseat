// Phase 0 safety (real incident, 2026-10-24): 전송 pasted the instruction into the captured Chrome page
// (a sign-up / payment form) and into KakaoTalk, because any unknown front window became the target.
// Only known AI tools may be chosen automatically; anything else only when the user picks or pins it.
// Since phase 2 the decision is src/main/targets.ts resolveTarget (the order is tested in targets.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyTarget, isAutoTarget } from '../src/main/agents.ts'
import { chooseForSend, identityOf, resolveTarget, type EditorTargets, type RecentEntry, type ResolveInput } from '../src/main/targets.ts'
import { setMessages } from '../src/shared/i18n.ts'
import type { WindowInfo } from '../src/shared/types.ts'
import type { LiveWindow } from '../src/main/delivery.ts'
import ko from '../src/locales/ko.json' with { type: 'json' }

setMessages('ko', ko)

const live = new Map<number, LiveWindow>()
const startOf = (pid: number): number => 1_000_000 + pid
let nextHwnd = 500
let nextPid = 4000
const win = (process: string, title: string, extra: Partial<WindowInfo> = {}): WindowInfo => {
  const w: WindowInfo = { hwnd: nextHwnd++, pid: nextPid++, title, process, bounds: { x: 0, y: 0, width: 800, height: 600 }, ...extra }
  live.set(w.hwnd, { pid: w.pid, processStartMs: startOf(w.pid), title: w.title })
  return w
}
const input = (over: Partial<ResolveInput>): ResolveInput => ({
  picked: null, pinned: null, windows: [], recent: [], front: null, agents: [],
  parentOf: () => undefined, startOf, live: (h) => live.get(h) ?? null, ...over
})
const recentOf = (w: WindowInfo): RecentEntry => ({ identity: identityOf(w, startOf), kind: classifyTarget(w)!.kind, at: Date.now() })

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
    const r = resolveTarget(input({ front: w, windows: [w] }))
    assert.equal(r.target, null, w.title)
    assert.equal(r.view.source, 'none')
  }
})

test('messengers in front: no target', () => {
  for (const w of MESSENGERS) assert.equal(resolveTarget(input({ front: w, windows: [w] })).target, null, w.process)
})

test('known AI tools in front are still used', () => {
  const kind = (w: WindowInfo): string | undefined => resolveTarget(input({ front: w, windows: [w] })).target?.kind
  assert.equal(kind(win('ChatGPT.exe', 'ChatGPT')), 'codex')
  assert.equal(kind(win('claude.exe', 'Claude')), 'claude-desktop')
  assert.equal(kind(win('WindowsTerminal.exe', '✳ Claude Code')), 'claude-code')
  assert.equal(kind(win('Cursor.exe', 'main.ts - Cursor')), 'cursor')
  const tab = resolveTarget(input({ front: win('chrome.exe', 'ChatGPT - Chrome') })).target
  assert.equal(tab?.kind, 'chat')
  assert.equal(tab?.method, 'paste-image')
  assert.equal(kind(win('msedge.exe', 'Claude - Microsoft Edge')), 'chat')
})

test('the AI window used last wins over the captured page, and the page itself is never the target', () => {
  const codex = win('ChatGPT.exe', 'ChatGPT')
  const r = resolveTarget(input({ front: CHROME_SIGNUP, windows: [CHROME_SIGNUP, codex], recent: [recentOf(codex)] }))
  assert.equal(r.target?.hwnd, codex.hwnd)
  assert.equal(r.view.source, 'recent-agent')
  assert.equal(r.view.estimated, true)
})

test('a messenger is never "the AI window used last"', () => {
  // The tracker only remembers known AI windows; even if one slipped in, it is not chosen automatically.
  const r = resolveTarget(input({ front: CHROME_SIGNUP, recent: [{ identity: identityOf(KAKAO, startOf), kind: 'unknown', at: 1 }] }))
  assert.equal(r.target, null)
})

test('a pinned window is the user’s explicit choice and is used even when unknown', () => {
  const r = resolveTarget(input({ pinned: { process: 'chrome.exe', title: 'Buy Me a Coffee - 가입' }, windows: [CHROME_SIGNUP, KAKAO], front: KAKAO }))
  assert.equal(r.target?.hwnd, CHROME_SIGNUP.hwnd)
  assert.equal(r.view.source, 'pinned')
  assert.equal(r.view.estimated, false)
})

test('an unknown window picked in the target menu is used for that send', () => {
  const picked = classifyTarget(KAKAO)!
  assert.equal(isAutoTarget(picked), false)
  const state: EditorTargets = {
    current: { target: null, identity: null, view: { source: 'none', label: '', estimated: false, method: 'clipboard' } },
    candidates: new Map([[KAKAO.hwnd, { target: picked, identity: identityOf(KAKAO, startOf) }]])
  }
  const r = chooseForSend(state, { targetHwnd: KAKAO.hwnd }, (h) => live.get(h) ?? null)
  assert.equal(r.kind === 'target' && r.ctx.target?.hwnd, KAKAO.hwnd)
  assert.equal(r.kind === 'target' && r.ctx.view.source, 'picked')
})

test('an AI vendor’s sign-in, billing or settings tab is a form, not an automatic chat target', () => {
  for (const title of ['Billing - Claude - Chrome', 'Log in - ChatGPT - Chrome', 'ChatGPT 결제 설정 - Chrome', 'Settings - Claude - Microsoft Edge', 'Gemini - Anmelden - Chrome']) {
    assert.equal(classifyTarget(win('chrome.exe', title))?.kind, 'unknown', title)
  }
  assert.equal(classifyTarget(win('chrome.exe', 'Fix tray bug - Claude - Chrome'))?.kind, 'chat')
})
