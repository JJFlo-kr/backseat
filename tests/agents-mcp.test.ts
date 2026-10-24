// Codex review F03: a registered MCP agent is bound to the delivery target only when it provably runs
// inside the target window (process tree), never just because it registered last.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withMcpAgent, type RegisteredAgent } from '../src/main/agents.ts'
import type { AgentTarget, WindowInfo } from '../src/shared/types.ts'

// pid -> parent pid. explorer(10) started Windows Terminal(600) and ChatGPT(500).
// WT(600) -> pwsh(700) -> claude(800) -> backseat-mcp(900)          project D:\work\backseat
// WT(600) -> pwsh(710) -> claude(810) -> backseat-mcp(910)          project D:\work\other
// cmd(720) -> conhost(650) owns the classic console window; cmd(720) -> claude(820) -> mcp(920)
const PARENT = new Map<number, number>([
  [500, 10], [600, 10], [700, 600], [800, 700], [900, 800], [710, 600], [810, 710], [910, 810],
  [720, 10], [650, 720], [820, 720], [920, 820]
])
const parentOf = (p: number): number | undefined => PARENT.get(p)

const agent = (pid: number, cwd: string, registeredAt = '2026-10-25T10:00:00.000Z'): RegisteredAgent => ({
  id: String(pid), name: 'Claude Code', cwd, pid, registeredAt
})
const BACKSEAT = agent(900, 'D:\\work\\backseat')
const OTHER = agent(910, 'D:\\work\\other', '2026-10-25T11:00:00.000Z')
const CONSOLE = agent(920, 'D:\\work\\console')

const win = (pid: number, process: string, title: string): WindowInfo => ({
  hwnd: pid * 10, pid, process, title, bounds: { x: 0, y: 0, width: 800, height: 600 }
})
const targetFor = (w: WindowInfo, kind: AgentTarget['kind'], method: AgentTarget['method']): AgentTarget => ({
  kind, label: w.title, hwnd: w.hwnd, title: w.title, process: w.process, method, confidence: 0.8
})

test('ChatGPT window + an agent of another project registered: no MCP binding', () => {
  const w = win(500, 'ChatGPT.exe', 'ChatGPT')
  const t = withMcpAgent(targetFor(w, 'codex', 'paste-image'), [BACKSEAT], w, parentOf)
  assert.equal(t?.mcp, undefined)
  assert.equal(t?.label, 'ChatGPT')
})

test('the terminal the agent runs in: bound to that agent', () => {
  const w = win(600, 'WindowsTerminal.exe', 'Claude Code')
  const t = withMcpAgent(targetFor(w, 'claude-code', 'paste-path'), [BACKSEAT], w, parentOf)
  assert.equal(t?.mcp?.id, '900')
  assert.match(t?.label ?? '', /MCP Claude Code/)
})

test('two agents in tabs of one terminal: the project folder in the title decides, else nobody', () => {
  const titled = win(600, 'WindowsTerminal.exe', 'backseat — claude')
  assert.equal(withMcpAgent(targetFor(titled, 'claude-code', 'paste-path'), [BACKSEAT, OTHER], titled, parentOf)?.mcp?.id, '900')
  const plain = win(600, 'WindowsTerminal.exe', 'Claude Code')
  assert.equal(withMcpAgent(targetFor(plain, 'claude-code', 'paste-path'), [BACKSEAT, OTHER], plain, parentOf)?.mcp, undefined)
})

test('a classic console window (conhost) binds the agent started from its shell', () => {
  const w = win(650, 'conhost.exe', 'cmd - claude')
  assert.equal(withMcpAgent(targetFor(w, 'claude-code', 'paste-path'), [BACKSEAT, CONSOLE], w, parentOf)?.mcp?.id, '920')
})

test('explorer.exe is an ancestor of everything and proves nothing', () => {
  const w = win(10, 'explorer.exe', 'Downloads')
  assert.equal(withMcpAgent(targetFor(w, 'unknown', 'paste-image'), [BACKSEAT], w, parentOf)?.mcp, undefined)
})

test('no window in front: no MCP-only target is invented', () => {
  assert.equal(withMcpAgent(null, [BACKSEAT], null, parentOf), null)
})
