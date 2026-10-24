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
/** Tab titles of account pages (sign-in, billing, settings …) in the languages Backseat speaks. */
const ACCOUNT_PAGE =
  /billing|payment|checkout|subscri|pricing|upgrade|invoice|sign[ -]?in|sign[ -]?up|log[ -]?in|register|account|settings|password|결제|구독|요금|로그인|가입|계정|설정|비밀번호|ログイン|登録|支払|設定|パスワード|登录|注册|支付|设置|密码|登入|註冊|付款|密碼|anmelden|registrieren|zahlung|konto|einstellungen|passwort|iniciar sesión|registr|pago|cuenta|configuración|contraseña|cadastr|pagamento|configurações|senha|connexion|inscription|paiement|compte|paramètres|mot de passe/i

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
 * kind 'unknown' for apps we do not recognise (messengers included). Whether a target may be used
 * WITHOUT the user choosing it is isAutoTarget()'s decision, not this function's.
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
  if (BROWSERS.has(proc)) {
    const lower = title.toLowerCase()
    const aiChat = lower.includes('claude') || lower.includes('chatgpt') || lower.includes('gemini') || lower.includes('copilot')
    // An AI vendor's billing, sign-in or settings page is a form, not a chat: never an automatic target.
    if (aiChat && !ACCOUNT_PAGE.test(title)) {
      return { ...base, kind: 'chat', label: t('agents.webChat', { title: title.slice(0, 30) }), method: 'paste-image', confidence: 0.7 }
    }
  }
  // Any other real window (a web page, a messenger, …): offered in the target menu, never chosen automatically.
  return {
    ...base,
    kind: 'unknown',
    label: t('agents.window', { title: title.slice(0, 30), process: win.process }),
    method: 'paste-image',
    confidence: 0.4
  }
}

/**
 * Phase 0 safety: may 전송 paste into this target although the user did not choose it? Only known AI tools
 * (terminal / editor agents, the Claude and ChatGPT·Codex apps, AI chat tabs in a browser). Any other window
 * — the web page that was just captured (a sign-in or payment form), KakaoTalk, Slack, Discord, Teams … —
 * only when the user picked or pinned it: pasting the instruction there could fill a form field or reach a person.
 */
export function isAutoTarget(t: AgentTarget | null): t is AgentTarget {
  return t !== null && t.kind !== 'unknown' && t.hwnd !== 0
}

/** Max alternative windows offered in the editor's target menu. */
export const MAX_CANDIDATES = 12

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

/**
 * One-line instruction pasted into the agent. Paths are absolute so any cwd works. With `mcpSendId` (an
 * agent proven to have backseat-mcp) it asks for backseat_get with that send id, so the fetch receipt names
 * exactly this send (src/main/mcp/receipts.ts).
 */
export function instructionLine(briefPath: string, pngPath: string, memo: string, mcpSendId?: string, tr: Translate = t): string {
  const head = memo ? `${memo} — ` : ''
  if (mcpSendId) {
    return head + tr('agents.instruction.mcp', { id: mcpSendId, brief: briefPath })
  }
  return head + tr('agents.instruction.paths', { brief: briefPath, image: pngPath })
}

// ---------- MCP agents (backseat_register) ----------
/** An agent registered through backseat-mcp (see src/main/mcp/registry.ts). */
export interface RegisteredAgent {
  id: string
  name: string
  cwd: string
  /** pid of the backseat-mcp process the agent started. */
  pid: number
  registeredAt?: string
}

/** Processes that are ancestors of almost everything: owning a window proves nothing. */
const SESSION_ROOTS = new Set(['explorer.exe', 'svchost.exe', 'services.exe', 'wininit.exe', 'winlogon.exe', 'userinit.exe', 'sihost.exe', 'csrss.exe'])
/** Console hosts: the window belongs to conhost/OpenConsole, which is a child of the shell, not its parent. */
const CONSOLE_HOSTS = new Set(['conhost.exe', 'openconsole.exe'])

function ancestors(pid: number, parentOf: (pid: number) => number | undefined): Set<number> {
  const seen = new Set<number>()
  let p: number | undefined = pid
  for (let i = 0; i < 64 && p && !seen.has(p); i++) {
    seen.add(p)
    p = parentOf(p)
  }
  return seen
}

function folderName(cwd: string): string {
  return (cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '').toLowerCase()
}

/**
 * The registered agent that runs inside `win`, or null when nothing proves it. Evidence: the window's
 * process is an ancestor of the agent's backseat-mcp process (terminal → shell → agent → mcp), or the
 * window is a console host whose parent is. Several agents in one window (terminal tabs, the Claude app)
 * are told apart only by their project folder in the window title; otherwise none is chosen.
 */
export function agentForWindow(
  agents: readonly RegisteredAgent[],
  win: Pick<WindowInfo, 'pid' | 'process' | 'title'> | null,
  parentOf: (pid: number) => number | undefined
): RegisteredAgent | null {
  if (!win || !win.pid) return null
  const proc = (win.process ?? '').toLowerCase()
  if (SESSION_ROOTS.has(proc)) return null
  const hostParent = CONSOLE_HOSTS.has(proc) ? parentOf(win.pid) : undefined
  const inside = agents.filter((a) => {
    const chain = ancestors(a.pid, parentOf)
    return chain.has(win.pid) || (hostParent !== undefined && chain.has(hostParent))
  })
  if (inside.length <= 1) return inside[0] ?? null
  const title = (win.title ?? '').toLowerCase()
  const named = inside.filter((a) => {
    const f = folderName(a.cwd)
    return f.length > 0 && title.includes(f)
  })
  return named.length === 1 ? named[0] : null
}

/**
 * Bind the detected target to a registered MCP agent only when that agent provably runs in the target's
 * window (Codex review F03). Without that proof the target is returned unchanged: the pasted line then
 * carries file paths, which work for any agent.
 */
export function withMcpAgent(
  target: AgentTarget | null,
  agents: readonly RegisteredAgent[],
  win: Pick<WindowInfo, 'pid' | 'process' | 'title'> | null,
  parentOf: (pid: number) => number | undefined
): AgentTarget | null {
  if (!target || target.method === 'clipboard' || !target.hwnd) return target
  const agent = agentForWindow(agents, win, parentOf)
  if (!agent) return target
  const mcp = { id: agent.id, name: agent.name, cwd: agent.cwd }
  return { ...target, mcp, label: `${target.label} · MCP ${agent.name}`, confidence: Math.max(target.confidence, 0.9) }
}
