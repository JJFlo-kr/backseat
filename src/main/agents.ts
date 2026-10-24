// Guess which agent the user was talking to from the window that had focus
// right before the capture hotkey. Pure function: easy to extend and test.
import type { AgentKind, AgentTarget, WindowInfo } from '../shared/types.ts'
import { t, type Translate } from '../shared/i18n.ts'

const TERMINALS = new Set([
  'windowsterminal.exe',
  'openconsole.exe',
  'conhost.exe',
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'wezterm-gui.exe',
  'alacritty.exe',
  'hyper.exe',
  'mintty.exe',
  'tabby.exe'
])
const BROWSERS = new Set(['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'arc.exe', 'whale.exe'])

function agentInTitle(title: string): { kind: AgentKind; name: string } | null {
  const t = title.toLowerCase()
  if (t.includes('claude')) return { kind: 'claude-code', name: 'Claude Code' }
  if (t.includes('codex')) return { kind: 'codex', name: 'Codex' }
  if (t.includes('orca')) return { kind: 'orca', name: 'Orca' }
  if (t.includes('gemini')) return { kind: 'terminal', name: 'Gemini CLI' }
  if (t.includes('aider')) return { kind: 'terminal', name: 'Aider' }
  return null
}

export interface ClassifyOptions {
  /** Our own process id: our windows are never a delivery target. */
  selfPid?: number
}

/** Desktop / taskbar shell windows (explorer.exe) are not apps the user could be talking to. */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'])

/**
 * Classify a window as a delivery target. Returns null only when it is not a real app window
 * (null, untitled, desktop/taskbar, our own window); every other window gets a target, with
 * kind 'unknown' for apps we do not recognise.
 */
export function classifyTarget(win: WindowInfo | null, opts: ClassifyOptions = {}): AgentTarget | null {
  if (!win) return null
  if (opts.selfPid !== undefined && win.pid === opts.selfPid) return null
  const title = win.title ?? ''
  if (!title.trim()) return null
  const proc = (win.process ?? '').toLowerCase()
  if (proc === 'explorer.exe' && win.className && SHELL_CLASSES.has(win.className)) return null
  const base = { hwnd: win.hwnd, title, process: win.process }

  if (proc === 'claude.exe') {
    return { ...base, kind: 'claude-desktop', label: t('agents.claudeApp'), method: 'paste-image', confidence: 0.8 }
  }
  if (proc === 'chatgpt.exe' || proc === 'codex.exe') {
    return { ...base, kind: 'codex', label: t('agents.codexApp'), method: 'paste-image', confidence: 0.8 }
  }
  if (TERMINALS.has(proc)) {
    const agent = agentInTitle(title)
    if (agent) {
      return { ...base, kind: agent.kind, label: t('agents.terminalAgent', { agent: agent.name }), method: 'paste-path', confidence: 0.9 }
    }
    return { ...base, kind: 'terminal', label: t('agents.terminal', { process: win.process }), method: 'paste-path', confidence: 0.6 }
  }
  if (proc === 'cursor.exe') {
    return { ...base, kind: 'cursor', label: 'Cursor', method: 'paste-path', confidence: 0.7 }
  }
  if (proc === 'zed.exe') {
    return { ...base, kind: 'vscode', label: 'Zed', method: 'paste-path', confidence: 0.7 }
  }
  if (proc === 'code.exe' || proc === 'code - insiders.exe' || proc === 'windsurf.exe') {
    const name = proc.startsWith('windsurf') ? 'Windsurf' : 'VS Code'
    const agent = agentInTitle(title)
    return {
      ...base,
      kind: agent?.kind === 'claude-code' ? 'claude-code' : 'vscode',
      label: agent ? `${agent.name} · ${name}` : name,
      method: 'paste-path',
      confidence: agent ? 0.85 : 0.7
    }
  }
  if (proc === 'slack.exe') return { ...base, kind: 'chat', label: 'Slack', method: 'paste-image', confidence: 0.6 }
  if (proc === 'discord.exe') return { ...base, kind: 'chat', label: 'Discord', method: 'paste-image', confidence: 0.6 }
  if (BROWSERS.has(proc)) {
    const lower = title.toLowerCase()
    if (lower.includes('claude') || lower.includes('chatgpt') || lower.includes('gemini') || lower.includes('copilot')) {
      return { ...base, kind: 'chat', label: t('agents.webChat', { title: title.slice(0, 30) }), method: 'paste-image', confidence: 0.7 }
    }
  }
  // Any other real window: the user may well have been talking to it, so deliver there by pasting the image.
  return {
    ...base,
    kind: 'unknown',
    label: t('agents.window', { title: title.slice(0, 30), process: win.process }),
    method: 'paste-image',
    confidence: 0.4
  }
}

/** Max alternative windows offered in the editor's target menu. */
export const MAX_CANDIDATES = 12

/**
 * Other open windows the user may pick as the delivery target: known agent/chat apps first, then the
 * remaining windows (kind 'unknown'); each group keeps the given (front-most first) order.
 * The window with hwnd `excludeHwnd` (the detected target) and our own / shell windows are left out.
 */
export function buildCandidates(
  windows: WindowInfo[],
  opts: { selfPid?: number; excludeHwnd?: number; max?: number } = {}
): AgentTarget[] {
  const known: AgentTarget[] = []
  const other: AgentTarget[] = []
  const seen = new Set<number>()
  for (const w of windows) {
    if (!w.hwnd || w.hwnd === opts.excludeHwnd || seen.has(w.hwnd)) continue
    const t = classifyTarget(w, { selfPid: opts.selfPid })
    if (!t) continue
    seen.add(w.hwnd)
    ;(t.kind === 'unknown' ? other : known).push(t)
  }
  return [...known, ...other].slice(0, opts.max ?? MAX_CANDIDATES)
}

/**
 * The pinned default target: first window (front-most first) whose process equals `process`
 * (case-insensitive) and whose title contains `titlePart` (may be empty). null when nothing matches.
 */
export function matchPinned(windows: WindowInfo[], process: string, titlePart: string): WindowInfo | null {
  const p = process.trim().toLowerCase()
  if (!p) return null
  const part = titlePart.toLowerCase()
  return windows.find((w) => w.process.toLowerCase() === p && w.title.toLowerCase().includes(part)) ?? null
}

/** The persisted form of a pin: process + a short part of the title. */
export function pinParts(t: Pick<AgentTarget, 'process' | 'title'>): { process: string; title: string } {
  return { process: t.process, title: t.title.slice(0, 20) }
}

// ---------- "previous target" memory ----------

/** The " (previous target)" decoration in the current UI language. */
function fallbackSuffix(): string {
  return ` ${t('agents.fallbackSuffix')}`
}

/** Last target that was a real window, reused when the hotkey is pressed from the desktop/tray. Always stored in its original form. */
let lastTarget: AgentTarget | null = null

export function getLastTarget(): AgentTarget | null {
  return lastTarget
}

/** Remember a target. Display decorations (previous-target / MCP suffixes, mcp info) are stripped so labels never accumulate. */
export function rememberTarget(t: AgentTarget | null): void {
  if (!t || !t.hwnd) return
  let label = t.label
  const suffix = fallbackSuffix()
  while (label.endsWith(suffix)) label = label.slice(0, -suffix.length)
  label = label.replace(/ · MCP .*$/, '')
  const { mcp: _mcp, ...rest } = t
  lastTarget = { ...rest, label }
}

/** The remembered target as shown for a fallback: lower confidence and a single suffix, from the original label. */
export function asFallback(t: AgentTarget): AgentTarget {
  return { ...t, confidence: Math.min(t.confidence, 0.5), label: t.label + fallbackSuffix() }
}

/** One-line instruction pasted into a terminal agent. Paths are absolute so any cwd works. */
export function instructionLine(briefPath: string, pngPath: string, memo: string, viaMcp = false, tr: Translate = t): string {
  const head = memo ? `${memo} — ` : ''
  if (viaMcp) {
    return head + tr('agents.instruction.mcp', { brief: briefPath })
  }
  return head + tr('agents.instruction.paths', { brief: briefPath, image: pngPath })
}
