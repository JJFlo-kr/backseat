// Phase 2 target model (plan 2026-10-25 §3, request (1) item 1): pick → pin → MCP-verified → recent AI
// window → AI app in front → none; a gone pick / pin is never replaced by another window; the menu
// candidates; and which window a send may use. src/main/targets.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyTarget } from '../src/main/agents.ts'
import { candidateViews, chooseForSend, identityOf, resolveTarget, toView, type EditorTargets, type RecentEntry, type ResolveInput } from '../src/main/targets.ts'
import { setMessages } from '../src/shared/i18n.ts'
import type { WindowInfo } from '../src/shared/types.ts'
import type { LiveWindow } from '../src/main/delivery.ts'
import ko from '../src/locales/ko.json' with { type: 'json' }

setMessages('ko', ko)

const live = new Map<number, LiveWindow>()
const startOf = (pid: number): number => 1_000_000 + pid
const liveOf = (h: number): LiveWindow | null => live.get(h) ?? null
let nextHwnd = 100
let nextPid = 2000
const win = (process: string, title: string, extra: Partial<WindowInfo> = {}): WindowInfo => {
  const w: WindowInfo = { hwnd: nextHwnd++, pid: nextPid++, title, process, bounds: { x: 0, y: 0, width: 800, height: 600 }, ...extra }
  live.set(w.hwnd, { pid: w.pid, processStartMs: startOf(w.pid), title: w.title })
  return w
}
const input = (over: Partial<ResolveInput>): ResolveInput => ({
  picked: null, pinned: null, windows: [], recent: [], front: null, agents: [],
  parentOf: () => undefined, startOf, live: liveOf, selfPid: 7, ...over
})
const recentOf = (w: WindowInfo, at = Date.now()): RecentEntry => ({ identity: identityOf(w, startOf), kind: classifyTarget(w)!.kind, at })
const pickOf = (w: WindowInfo) => ({ identity: identityOf(w, startOf), target: classifyTarget(w)! })

const page = win('chrome.exe', 'Sign in - Acme - Chrome')
const codex = win('ChatGPT.exe', 'ChatGPT')
const claude = win('claude.exe', 'Claude')
const term = win('WindowsTerminal.exe', '✳ Claude Code')
const kakao = win('KakaoTalk.exe', '카카오톡')

test('order: a pick beats the pin, the pin beats MCP, MCP beats the recent window, recent beats the front app', () => {
  const windows = [page, codex, claude, term, kakao]
  // term hosts a registered MCP agent: mcp pid 9001 -> parent node 9000 -> parent term
  const parents = new Map([[9001, 9000], [9000, term.pid]])
  const agents = [{ id: '9001', name: 'Claude Code', cwd: 'D:\\backseat', pid: 9001 }]
  const base = { windows, agents, parentOf: (p: number) => parents.get(p), recent: [recentOf(codex)], front: claude }
  assert.equal(resolveTarget(input({ ...base, picked: pickOf(kakao), pinned: { process: 'claude.exe', title: '' } })).view.source, 'picked')
  assert.equal(resolveTarget(input({ ...base, pinned: { process: 'claude.exe', title: '' } })).view.source, 'pinned')
  const m = resolveTarget(input(base))
  assert.equal(m.view.source, 'mcp-verified')
  assert.equal(m.target?.hwnd, term.hwnd)
  assert.equal(m.view.method, 'mcp')
  assert.equal(m.view.project, 'backseat')
  assert.equal(m.view.label, 'Claude Code · backseat')
  assert.equal(m.view.estimated, false)
  const r = resolveTarget(input({ ...base, agents: [] }))
  assert.equal(r.view.source, 'recent-agent')
  assert.equal(r.target?.hwnd, codex.hwnd)
  assert.equal(r.view.estimated, true)
  const f = resolveTarget(input({ ...base, agents: [], recent: [] }))
  assert.equal(f.view.source, 'foreground-agent')
  assert.equal(f.target?.hwnd, claude.hwnd)
  assert.equal(f.view.estimated, true)
  assert.equal(resolveTarget(input({ windows, front: page })).view.source, 'none')
})

test('every view carries the window identity (hwnd + pid + process start + title)', () => {
  const r = resolveTarget(input({ windows: [codex], recent: [recentOf(codex)] }))
  assert.deepEqual(r.view.identity, { hwnd: codex.hwnd, pid: codex.pid, processStartMs: startOf(codex.pid), title: 'ChatGPT', process: 'ChatGPT.exe' })
  assert.deepEqual(r.identity, r.view.identity)
})

test('a picked window that closed gives none with the reason — never another window', () => {
  const gone = win('ChatGPT.exe', 'ChatGPT')
  const p = pickOf(gone)
  live.delete(gone.hwnd)
  const r = resolveTarget(input({ picked: p, recent: [recentOf(codex)], windows: [codex], front: codex }))
  assert.equal(r.target, null)
  assert.equal(r.view.source, 'none')
  assert.deepEqual(r.view.unavailable, { source: 'picked', label: p.target.label })
})

test('a picked window whose process restarted (handle reused) counts as gone', () => {
  const w = win('claude.exe', 'Claude')
  const p = pickOf(w)
  live.set(w.hwnd, { pid: w.pid, processStartMs: startOf(w.pid) + 5000, title: 'Claude' })
  assert.equal(resolveTarget(input({ picked: p })).view.source, 'none')
  live.set(w.hwnd, { pid: w.pid + 1, processStartMs: startOf(w.pid), title: 'Claude' })
  assert.equal(resolveTarget(input({ picked: p })).view.source, 'none')
})

test('pinned but not open: none (pinned label), not the recent AI window', () => {
  const r = resolveTarget(input({ pinned: { process: 'Codex.exe', title: '' }, windows: [claude], recent: [recentOf(claude)], front: claude }))
  assert.equal(r.view.source, 'none')
  assert.deepEqual(r.view.unavailable, { source: 'pinned', label: 'Codex.exe' })
})

test('the recent window keeps the title it had: a browser tab switched since is caught at send time', () => {
  const tab = win('chrome.exe', 'ChatGPT - Chrome')
  const rec = recentOf(tab)
  live.set(tab.hwnd, { pid: tab.pid, processStartMs: startOf(tab.pid), title: 'Sign in - Acme - Chrome' })
  const r = resolveTarget(input({ recent: [rec], front: { ...tab, title: 'Sign in - Acme - Chrome' } }))
  assert.equal(r.view.source, 'recent-agent')
  assert.equal(r.identity?.title, 'ChatGPT - Chrome')
})

test('closed recent windows are skipped; the next one is used', () => {
  const old = win('claude.exe', 'Claude')
  const closed = win('ChatGPT.exe', 'ChatGPT')
  live.delete(closed.hwnd)
  const r = resolveTarget(input({ recent: [recentOf(closed, 2), recentOf(old, 1)] }))
  assert.equal(r.target?.hwnd, old.hwnd)
})

test('several MCP windows: the one used most recently; none of them recent: fall through', () => {
  const t1 = win('WindowsTerminal.exe', 'pwsh - a')
  const t2 = win('WindowsTerminal.exe', 'pwsh - b')
  const parents = new Map([[8001, t1.pid], [8002, t2.pid]])
  const agents = [
    { id: '8001', name: 'Claude Code', cwd: 'D:\\a', pid: 8001 },
    { id: '8002', name: 'Codex', cwd: 'D:\\b', pid: 8002 }
  ]
  const base = { windows: [t1, t2, codex], agents, parentOf: (p: number) => parents.get(p) }
  assert.equal(resolveTarget(input({ ...base, recent: [recentOf(t2), recentOf(t1)] })).target?.hwnd, t2.hwnd)
  const none = resolveTarget(input({ ...base, recent: [recentOf(codex)] }))
  assert.equal(none.view.source, 'recent-agent')
  assert.equal(none.target?.hwnd, codex.hwnd)
})

test('our own windows, the desktop and unknown front windows are never chosen', () => {
  const own = win('Backseat.exe', 'Backseat', { pid: 7 })
  assert.equal(resolveTarget(input({ front: own, windows: [own] })).view.source, 'none')
  const desk = win('explorer.exe', 'Program Manager', { className: 'Progman' })
  assert.equal(resolveTarget(input({ front: desk })).view.source, 'none')
})

test('candidates: known AI windows first (marked recent / MCP), then other windows; excludes the current target, own and shell', () => {
  const own = win('Backseat.exe', 'self', { pid: 7 })
  const desk = win('explorer.exe', 'Program Manager', { className: 'Progman' })
  const note = win('notepad.exe', 'a')
  const windows = [note, codex, own, desk, claude, kakao, term]
  const c = candidateViews(input({ windows, recent: [recentOf(claude)] }), codex.hwnd)
  assert.deepEqual(c.map((x) => x.target.process), ['claude.exe', 'WindowsTerminal.exe', 'notepad.exe', 'KakaoTalk.exe'])
  assert.equal(c[0].view.source, 'recent-agent')
  assert.equal(c[1].view.source, 'picked')
  assert.ok(c.every((x) => x.view.identity && x.view.estimated === false))
  const many = Array.from({ length: 30 }, (_, i) => win('app.exe', `w${i}`))
  assert.equal(candidateViews(input({ windows: many })).length, 12)
})

test('chooseForSend: current target, a live pick, a gone pick (expired), never-offered window (expired), clipboard', () => {
  const cur = resolveTarget(input({ front: codex }))
  const kakaoT = classifyTarget(kakao)!
  const state: EditorTargets = { current: cur, candidates: new Map([[kakao.hwnd, { target: kakaoT, identity: identityOf(kakao, startOf) }]]) }
  const a = chooseForSend(state, {}, liveOf)
  assert.equal(a.kind === 'target' && a.ctx.target?.hwnd, codex.hwnd)
  assert.equal(a.kind === 'target' && a.picked, false)
  const b = chooseForSend(state, { targetHwnd: kakao.hwnd }, liveOf)
  assert.equal(b.kind === 'target' && b.picked && b.ctx.view.source, 'picked')
  assert.deepEqual(chooseForSend(state, { targetHwnd: 999999 }, liveOf), { kind: 'expired', label: '' })
  live.delete(kakao.hwnd)
  assert.deepEqual(chooseForSend(state, { targetHwnd: kakao.hwnd }, liveOf), { kind: 'expired', label: kakaoT.label })
  assert.deepEqual(chooseForSend(state, { clipboardOnly: true, targetHwnd: codex.hwnd }, liveOf), { kind: 'clipboard' })
})

test('toView: none is a clipboard chip without identity', () => {
  assert.deepEqual(toView(null, 'none', null), { source: 'none', label: '', estimated: false, method: 'clipboard' })
})
