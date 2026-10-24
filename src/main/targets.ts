// Where 보내기 goes, decided apart from what was captured (plan 2026-10-25 §3 phase 2, request (1) item 1).
// Order: the user's pick → the pinned default → a window with a proven MCP agent → the AI window the user
// worked in last → the known AI app in front at capture time → nothing (the user picks). The captured page,
// a messenger or any unknown window is never chosen automatically. Pure (tests/targets.test.ts).
import type { AgentKind, AgentTarget, SendTargetView, TargetIdentity, TargetSource, WindowInfo } from '../shared/types'
import { agentForWindow, classifyTarget, isAutoTarget, matchPinned, MAX_CANDIDATES, withMcpAgent, type RegisteredAgent } from './agents'
import { sameInstance, type LiveWindow } from './delivery'

/** A known AI window the user focused, remembered by the foreground tracker (src/main/tracker.ts). */
export interface RecentEntry {
  identity: TargetIdentity
  kind: AgentKind
  /** ms since 1970 when it was last in front. */
  at: number
}

export interface TargetPick {
  identity: TargetIdentity
  target: AgentTarget
}

export interface ResolveInput {
  /** Chosen in the tray or the editor and still meant for the next captures. */
  picked: TargetPick | null
  /** config pinnedTargetProcess / pinnedTargetTitle ('' process = no pin). */
  pinned: { process: string; title: string } | null
  /** Live top-level windows, front-most first (minimised ones are missing). */
  windows: readonly WindowInfo[]
  /** Most recent first. */
  recent: readonly RecentEntry[]
  /** The foreground window right before the capture. */
  front: WindowInfo | null
  agents: readonly RegisteredAgent[]
  parentOf: (pid: number) => number | undefined
  startOf: (pid: number) => number
  /** The handle's current state (also for minimised windows); null = gone. */
  live: (hwnd: number) => LiveWindow | null
  selfPid?: number
}

export interface Resolved {
  /** null = nothing safe: package + clipboard only. Carries `.mcp` when an agent provably runs in it. */
  target: AgentTarget | null
  identity: TargetIdentity | null
  view: SendTargetView
}

export function identityOf(win: Pick<WindowInfo, 'hwnd' | 'pid' | 'title' | 'process'>, startOf: (pid: number) => number): TargetIdentity {
  return { hwnd: win.hwnd, pid: win.pid, processStartMs: startOf(win.pid), title: win.title, process: win.process }
}

function alive(id: TargetIdentity, live: ResolveInput['live']): boolean {
  return sameInstance(id, live(id.hwnd))
}

function asWindow(id: TargetIdentity): WindowInfo {
  return { hwnd: id.hwnd, pid: id.pid, title: id.title, process: id.process, bounds: { x: 0, y: 0, width: 0, height: 0 } }
}

function folder(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}

/** The chip for a target. `estimated` unless the user chose it or an MCP agent proves it. */
export function toView(target: AgentTarget | null, source: TargetSource, identity: TargetIdentity | null): SendTargetView {
  if (!target || source === 'none') return { source: 'none', label: '', estimated: false, method: 'clipboard' }
  const project = target.mcp ? folder(target.mcp.cwd) : undefined
  const label = target.mcp ? [target.mcp.name, project].filter(Boolean).join(' · ') : target.label
  return {
    source,
    label,
    kind: target.kind,
    ...(project ? { project } : {}),
    estimated: source === 'recent-agent' || source === 'foreground-agent',
    method: target.mcp ? 'mcp' : target.method,
    ...(identity ? { identity } : {})
  }
}

function none(unavailable?: SendTargetView['unavailable']): Resolved {
  return { target: null, identity: null, view: { ...toView(null, 'none', null), ...(unavailable ? { unavailable } : {}) } }
}

export function resolveTarget(input: ResolveInput): Resolved {
  const opts = { selfPid: input.selfPid }
  const bind = (t: AgentTarget, win: WindowInfo): AgentTarget => withMcpAgent(t, input.agents, win, input.parentOf) ?? t
  const done = (t: AgentTarget, win: WindowInfo, source: TargetSource, identity: TargetIdentity): Resolved => {
    const bound = bind(t, win)
    return { target: bound, identity, view: toView(bound, source, identity) }
  }

  // 1. The user's pick, while that very window lives. A gone pick is NOT replaced by another window.
  if (input.picked) {
    const { identity, target } = input.picked
    if (!alive(identity, input.live)) return none({ source: 'picked', label: target.label })
    return done(target, asWindow(identity), 'picked', identity)
  }

  // 2. The pinned default. Pinned but not open: ask, do not guess another window.
  if (input.pinned?.process) {
    const win = matchPinned([...input.windows], input.pinned.process, input.pinned.title)
    const t = win ? classifyTarget(win, opts) : null
    if (!win || !t) return none({ source: 'pinned', label: input.pinned.process })
    return done(t, win, 'pinned', identityOf(win, input.startOf))
  }

  // 3. A window an MCP agent provably runs in. Several: the one the user was in last; otherwise skip.
  if (input.agents.length > 0) {
    const proven = input.windows.filter((w) => {
      const t = classifyTarget(w, opts)
      return isAutoTarget(t) && agentForWindow(input.agents, w, input.parentOf) !== null
    })
    let chosen: WindowInfo | undefined = proven.length === 1 ? proven[0] : undefined
    if (proven.length > 1) {
      for (const r of input.recent) {
        chosen = proven.find((w) => w.hwnd === r.identity.hwnd && w.pid === r.identity.pid)
        if (chosen) break
      }
    }
    const t = chosen ? classifyTarget(chosen, opts) : null
    if (chosen && t) return done(t, chosen, 'mcp-verified', identityOf(chosen, input.startOf))
  }

  // 4. The AI window the user worked in last (kept with the title it had then: a changed browser tab is caught at send time).
  for (const r of input.recent) {
    if (!alive(r.identity, input.live)) continue
    const t = classifyTarget(asWindow(r.identity), opts)
    if (isAutoTarget(t)) return done(t, asWindow(r.identity), 'recent-agent', r.identity)
  }

  // 5. The known AI app that was in front when the hotkey was pressed.
  const front = classifyTarget(input.front, opts)
  if (input.front && isAutoTarget(front)) return done(front, input.front, 'foreground-agent', identityOf(input.front, input.startOf))

  // 6. Nothing safe.
  return none()
}

/** What one editor window may send to: its current target and the windows its menu offered. */
export interface EditorTargets {
  current: Resolved
  candidates: ReadonlyMap<number, { target: AgentTarget; identity: TargetIdentity }>
}

export type SendChoice =
  | { kind: 'target'; ctx: Resolved; picked: boolean }
  /** The user asked for clipboard only: no window is focused or pasted into. */
  | { kind: 'clipboard' }
  /** The picked window is gone or was never offered: do NOT substitute another one (Codex review F09). */
  | { kind: 'expired'; label: string }

/**
 * Resolve one send's destination. Without a pick the editor's current target is used (its identity is
 * checked by the delivery itself). A picked window must be one the menu offered and still the same window
 * instance; otherwise 'expired' — never the automatic target, which the user did not choose.
 */
export function chooseForSend(
  state: EditorTargets,
  opts: { targetHwnd?: number; clipboardOnly?: boolean },
  live: ResolveInput['live']
): SendChoice {
  if (opts.clipboardOnly) return { kind: 'clipboard' }
  if (!opts.targetHwnd || opts.targetHwnd === state.current.identity?.hwnd) return { kind: 'target', ctx: state.current, picked: false }
  const c = state.candidates.get(opts.targetHwnd)
  if (!c) return { kind: 'expired', label: '' }
  if (!alive(c.identity, live)) return { kind: 'expired', label: c.target.label }
  return { kind: 'target', ctx: { target: c.target, identity: c.identity, view: toView(c.target, 'picked', c.identity) }, picked: true }
}

export interface Candidate {
  view: SendTargetView
  target: AgentTarget
  identity: TargetIdentity
}

/**
 * The other windows the chip menu offers, each with its identity: known AI tools first (marked
 * mcp-verified / recent-agent when that is why they are interesting), then any other window (source
 * 'picked': usable only by choosing it). The current target and our own / shell windows are left out.
 */
export function candidateViews(
  input: Pick<ResolveInput, 'windows' | 'recent' | 'agents' | 'parentOf' | 'startOf' | 'selfPid'>,
  excludeHwnd?: number,
  max = MAX_CANDIDATES
): Candidate[] {
  const known: Candidate[] = []
  const other: Candidate[] = []
  const seen = new Set<number>()
  for (const w of input.windows) {
    if (!w.hwnd || w.hwnd === excludeHwnd || seen.has(w.hwnd)) continue
    const t = classifyTarget(w, { selfPid: input.selfPid })
    if (!t) continue
    seen.add(w.hwnd)
    const bound = withMcpAgent(t, input.agents, w, input.parentOf) ?? t
    const identity = identityOf(w, input.startOf)
    const source: TargetSource = bound.mcp
      ? 'mcp-verified'
      : input.recent.some((r) => r.identity.hwnd === w.hwnd && r.identity.pid === w.pid)
        ? 'recent-agent'
        : 'picked'
    const entry: Candidate = { view: { ...toView(bound, source, identity), estimated: false }, target: bound, identity }
    ;(isAutoTarget(t) ? known : other).push(entry)
  }
  return [...known, ...other].slice(0, max)
}
