// Guess which agent the user was talking to from the window that had focus
// right before the capture hotkey. Pure function: easy to extend and test.
import type { AgentKind, AgentTarget, WindowInfo } from '../shared/types'

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

export function classifyTarget(win: WindowInfo | null): AgentTarget | null {
  if (!win) return null
  const proc = win.process.toLowerCase()
  const base = { hwnd: win.hwnd, title: win.title, process: win.process }

  if (proc === 'claude.exe') {
    return { ...base, kind: 'claude-desktop', label: 'Claude 앱', method: 'paste-image', confidence: 0.8 }
  }
  if (TERMINALS.has(proc)) {
    const agent = agentInTitle(win.title)
    if (agent) {
      return { ...base, kind: agent.kind, label: `${agent.name} · 터미널`, method: 'paste-path', confidence: 0.9 }
    }
    return { ...base, kind: 'terminal', label: `터미널 (${win.process})`, method: 'paste-path', confidence: 0.6 }
  }
  if (proc === 'cursor.exe') {
    return { ...base, kind: 'cursor', label: 'Cursor', method: 'paste-path', confidence: 0.7 }
  }
  if (proc === 'code.exe' || proc === 'code - insiders.exe' || proc === 'windsurf.exe') {
    const name = proc.startsWith('windsurf') ? 'Windsurf' : 'VS Code'
    const agent = agentInTitle(win.title)
    return {
      ...base,
      kind: agent?.kind === 'claude-code' ? 'claude-code' : 'vscode',
      label: agent ? `${agent.name} · ${name}` : name,
      method: 'paste-path',
      confidence: agent ? 0.85 : 0.7
    }
  }
  if (BROWSERS.has(proc)) {
    const t = win.title.toLowerCase()
    if (t.includes('claude') || t.includes('chatgpt') || t.includes('gemini') || t.includes('copilot')) {
      return { ...base, kind: 'chat', label: `웹 채팅 (${win.title.slice(0, 30)})`, method: 'paste-image', confidence: 0.7 }
    }
    return null
  }
  return null
}

/** One-line instruction pasted into a terminal agent. Paths are absolute so any cwd works. */
export function instructionLine(briefPath: string, pngPath: string, memo: string): string {
  const head = memo ? `${memo} — ` : ''
  return `${head}Backseat 브리프 ${briefPath} 와 이미지 ${pngPath} 를 읽고, 주석과 메모가 가리키는 대로 수정해줘.`
}
