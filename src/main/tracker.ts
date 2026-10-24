// Remembers the AI windows the user works in, so 보내기 can go to "the AI I was just talking to" after the
// user moved on to capture something else — without clicking the AI's input box first (request (1)).
// A short poll of the foreground window (cheap: one Win32 call while nothing changes); our own windows, the
// desktop / taskbar and windows that are not known AI tools are ignored. Also holds the user's pick
// (tray "보낼 곳" or the editor's target menu) for the next captures.
import type { AgentTarget, TargetIdentity } from '../shared/types'
import { classifyTarget, isAutoTarget } from './agents'
import { sameInstance } from './delivery'
import { describeWindow, foregroundHwnd, liveWindow, processStartMs, windowTitle } from './native/win32'
import type { RecentEntry, TargetPick } from './targets'

const POLL_MS = 400
const MAX_RECENT = 8

let timer: NodeJS.Timeout | null = null
let lastHwnd = 0
let lastTitle = ''
let recent: RecentEntry[] = []
let picked: TargetPick | null = null

/** Record the window in front now, when it is a known AI tool. Exposed for the self-test. */
export function observeForeground(): void {
  const hwnd = foregroundHwnd()
  if (!hwnd) return
  const title = windowTitle(hwnd)
  if (hwnd === lastHwnd && title === lastTitle) return
  lastHwnd = hwnd
  lastTitle = title
  const win = describeWindow(hwnd)
  if (!win) return
  const t = classifyTarget(win, { selfPid: process.pid })
  if (!isAutoTarget(t)) return
  const identity: TargetIdentity = { hwnd, pid: win.pid, processStartMs: processStartMs(win.pid), title: win.title, process: win.process }
  remember({ identity, kind: t.kind, at: Date.now() })
}

function remember(entry: RecentEntry): void {
  const same = (r: RecentEntry): boolean => r.identity.hwnd === entry.identity.hwnd && r.identity.pid === entry.identity.pid
  recent = [entry, ...recent.filter((r) => !same(r))].slice(0, MAX_RECENT)
}

export function startForegroundTracker(): void {
  if (timer || process.platform !== 'win32') return
  observeForeground()
  timer = setInterval(() => {
    try {
      observeForeground()
    } catch (err) {
      console.error('[backseat] foreground tracker:', err)
    }
  }, POLL_MS)
  timer.unref()
}

export function stopForegroundTracker(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Remembered AI windows that are still the same window instance, most recent first. */
export function recentAgents(): RecentEntry[] {
  recent = recent.filter((r) => sameInstance(r.identity, liveWindow(r.identity.hwnd)))
  return [...recent]
}

/** Test hook: forget everything. */
export function resetTracker(): void {
  recent = []
  picked = null
  lastHwnd = 0
  lastTitle = ''
}

export function getPicked(): TargetPick | null {
  return picked
}

/** The user chose this window (tray or editor) — it stays the target while it lives. null = back to automatic. */
export function setPicked(target: AgentTarget | null, identity?: TargetIdentity): void {
  if (!target || !identity) {
    picked = null
    return
  }
  picked = { target, identity }
}
