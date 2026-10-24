// App settings persisted in userData/config.json. The MCP server (plain Node) reads the
// same file to find the sessions root, so keep it flat JSON.
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { sessionsRoot } from './sessions'

export interface Settings {
  version: number
  sessionsRoot: string
  /** Start the microphone as soon as the editor opens. */
  autoRecord: boolean
  /** Press Enter after pasting into a terminal agent. */
  pressEnter: boolean
  /** transformers.js model id for speech recognition. */
  sttModel: string
  /** Whisper language hint. */
  sttLanguage: string
  /**
   * 'local' runs Whisper in-process (default). 'openai' posts the audio to an OpenAI-compatible
   * /audio/transcriptions endpoint; the API key comes ONLY from the BACKSEAT_STT_API_KEY
   * environment variable and is never written to this file.
   */
  sttBackend: 'local' | 'openai'
  /** Base URL of the OpenAI-compatible API (without the trailing /audio/transcriptions). */
  sttApiBase: string
  /** Model name sent to the cloud backend. */
  sttCloudModel: string
  /** Capture hotkeys (Electron accelerator syntax). */
  hotkeyRect: string
  hotkeyWindow: string
  /** Scroll capture: stop once the stitched image is this tall (device px). */
  scrollMaxHeightPx: number
  /**
   * Start the tray app when the user logs in to Windows. Only the installed app registers itself;
   * a development run (`electron .`) would register electron.exe, so there it is ignored.
   */
  launchAtLogin: boolean
  /** Pinned default delivery target: process name (e.g. "ChatGPT.exe") + a short part of its title; "" = none. */
  pinnedTargetProcess: string
  pinnedTargetTitle: string
}

const DEFAULTS: Omit<Settings, 'sessionsRoot'> = {
  version: 1,
  autoRecord: false,
  pressEnter: false,
  sttModel: 'onnx-community/whisper-small_timestamped',
  sttLanguage: 'korean',
  sttBackend: 'local',
  sttApiBase: 'https://api.openai.com/v1',
  sttCloudModel: 'whisper-1',
  scrollMaxHeightPx: 16000,
  launchAtLogin: app.isPackaged,
  pinnedTargetProcess: '',
  pinnedTargetTitle: '',
  hotkeyRect: 'CommandOrControl+Shift+A',
  hotkeyWindow: 'CommandOrControl+Shift+W'
}

export function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

let cached: Settings | null = null

export function loadSettings(): Settings {
  if (cached) return cached
  let stored: Partial<Settings> = {}
  try {
    if (existsSync(configPath())) stored = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<Settings>
  } catch (err) {
    console.error('[backseat] config unreadable, using defaults:', err)
  }
  cached = { ...DEFAULTS, sessionsRoot: sessionsRoot(), ...stored }
  if (cached.sttBackend !== 'openai') cached.sttBackend = 'local'
  return cached
}

/** Mirror settings.launchAtLogin into the Windows Run key (installed app only). */
export function applyLoginItem(s: Settings = loadSettings()): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, path: process.execPath, args: [] })
}

/** Where the MCP server lives: unpacked next to app.asar when installed, out/main in a dev checkout. */
export function mcpServerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'mcp-server.js')
    : join(app.getAppPath(), 'out', 'main', 'mcp-server.js')
}

/** The cloud STT key is environment-only on purpose: config.json is plain text next to the sessions. */
export function sttApiKey(): string {
  return process.env.BACKSEAT_STT_API_KEY ?? ''
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...loadSettings(), ...patch }
  cached = next
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(configPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/** Make sure config.json exists with the current sessions root so backseat-mcp can find it. */
export async function ensureConfig(): Promise<Settings> {
  const s = loadSettings()
  if (!existsSync(configPath())) await saveSettings({})
  return s
}
