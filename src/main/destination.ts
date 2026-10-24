// Live inputs for the target model (src/main/targets.ts): windows, the pin, MCP agents, the remembered AI
// windows and the user's pick. Used at capture time, by the editor's target menu and by the tray menu.
import type { SendTargetView, WindowInfo } from '../shared/types'
import { loadSettings, sessionsRoot } from './config'
import { sameInstance } from './delivery'
import { pruneRegistry } from './mcp/registry'
import { liveWindow, listTopLevelWindows, processParents, processStartMs } from './native/win32'
import { candidateViews, resolveTarget, toView, type Candidate, type EditorTargets, type Resolved, type ResolveInput } from './targets'
import { getPicked, observeForeground, recentAgents, setPicked } from './tracker'

/** Everything resolveTarget() needs, read now. `windows` may be passed when already enumerated. */
export async function gatherInputs(front: WindowInfo | null, windows: WindowInfo[] = listTopLevelWindows()): Promise<ResolveInput> {
  const s = loadSettings()
  let agents: ResolveInput['agents'] = []
  try {
    agents = await pruneRegistry(sessionsRoot())
  } catch {
    agents = []
  }
  const parents = agents.length > 0 ? processParents() : new Map<number, number>()
  return {
    picked: getPicked(),
    pinned: s.pinnedTargetProcess ? { process: s.pinnedTargetProcess, title: s.pinnedTargetTitle ?? '' } : null,
    windows,
    recent: recentAgents(),
    front,
    agents,
    parentOf: (pid) => parents.get(pid),
    startOf: processStartMs,
    live: liveWindow,
    selfPid: process.pid
  }
}

/**
 * The target for a new capture plus the menu candidates. A pick whose window is gone gives 'none' once
 * (the editor says so) and is then forgotten, so the following captures go back to automatic.
 */
export async function resolveForCapture(
  front: WindowInfo | null,
  windows?: WindowInfo[],
  /** Self-test only: replace parts of the live input (no pin, no registered agents, only its own windows). */
  overrides: Partial<ResolveInput> = {}
): Promise<EditorTargets> {
  observeForeground() // the window in front right now counts as "recently used" if it is an AI tool
  const input = { ...(await gatherInputs(front, windows)), ...overrides }
  const current = resolveTarget(input)
  if (current.view.unavailable?.source === 'picked') setPicked(null)
  const cands = candidateViews(input, current.identity?.hwnd)
  return { current, candidates: new Map(cands.map((c) => [c.target.hwnd, { target: c.target, identity: c.identity }])) }
}

/** The editor's chip menu: its current target first (as 'none' when that window is gone), then fresh candidates. */
export async function listTargets(state: EditorTargets): Promise<{ views: SendTargetView[]; candidates: EditorTargets['candidates'] }> {
  const input = await gatherInputs(null)
  const cur = state.current
  let first: SendTargetView = cur.view
  if (cur.identity && !sameInstance(cur.identity, liveWindow(cur.identity.hwnd))) {
    first = { ...toView(null, 'none', null), unavailable: { source: cur.view.source, label: cur.view.label } }
  }
  const cands = candidateViews(input, cur.identity?.hwnd)
  return {
    views: [first, ...cands.map((c) => c.view)],
    candidates: new Map(cands.map((c) => [c.target.hwnd, { target: c.target, identity: c.identity }]))
  }
}

/**
 * For the tray menu, which is built synchronously: the same model without the MCP registry (a file read).
 * The tray shows the windows and the pick; MCP proof is added when a capture resolves its target.
 */
export function resolveForTray(): { current: Resolved; candidates: Candidate[] } {
  const s = loadSettings()
  const input: ResolveInput = {
    picked: getPicked(),
    pinned: s.pinnedTargetProcess ? { process: s.pinnedTargetProcess, title: s.pinnedTargetTitle ?? '' } : null,
    windows: listTopLevelWindows(),
    recent: recentAgents(),
    front: null,
    agents: [],
    parentOf: () => undefined,
    startOf: processStartMs,
    live: liveWindow,
    selfPid: process.pid
  }
  const current = resolveTarget(input)
  return { current, candidates: candidateViews(input, undefined, 24) }
}

export type { Resolved }
