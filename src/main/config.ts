// App settings persisted in userData/config.json. The MCP server (plain Node) reads the
// same file to find the sessions root, so keep it flat JSON.
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from './fsutil'

export interface Settings {
  version: number
  sessionsRoot: string
  /** Start the microphone as soon as the editor opens. */
  autoRecord: boolean
  /** Press Enter after pasting into a terminal agent. */
  pressEnter: boolean
  /** transformers.js model id for speech recognition. */
  sttModel: string
  /**
   * Whisper language hint: 'auto' = the UI language (default), 'detect' = let Whisper detect it,
   * or a Whisper language name ('korean', 'english', …).
   */
  sttLanguage: string
  /** UI language: 'auto' (Windows display language) or a Locale from src/shared/i18n.ts. */
  locale: string
  /** Language of brief.md and the pasted instruction: 'follow' = the UI language, 'en' = always English. */
  briefLocale: 'follow' | 'en'
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
  version: 2,
  autoRecord: false,
  pressEnter: false,
  sttModel: 'onnx-community/whisper-small_timestamped',
  sttLanguage: 'auto',
  locale: 'auto',
  briefLocale: 'follow',
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

/** PicturesBackseatsessions: where packages go unless config.json says otherwise. */
export function defaultSessionsRoot(): string {
  return join(app.getPath('pictures'), 'Backseat', 'sessions')
}

/**
 * THE sessions root: config.json's sessionsRoot (default PicturesBackseatsessions). The package writer,
 * the backseat_ask watcher, markAnswered and the registry all use this; backseat-mcp reads the same key from
 * the same file (src/main/mcp/server.ts sessionsRoot) — Codex review F08.
 */
export function sessionsRoot(): string {
  return loadSettings().sessionsRoot || defaultSessionsRoot()
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
  // v1 files stored the then-default 'korean' hint; v2 follows the UI language instead.
  if ((stored.version ?? 1) < 2 && stored.sttLanguage === 'korean') delete stored.sttLanguage
  cached = { ...DEFAULTS, sessionsRoot: defaultSessionsRoot(), ...stored, version: DEFAULTS.version }
  if (cached.sttBackend !== 'openai') cached.sttBackend = 'local'
  if (cached.briefLocale !== 'en') cached.briefLocale = 'follow'
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

let saveError: ((err: unknown) => void) | null = null

/**
 * Called whenever a saveSettings() write fails (disk full, permission, ...), so the UI can tell the user
 * instead of failing silently — Codex review F13. saveSettings still rejects for callers that await it.
 */
export function onSettingsSaveError(listener: (err: unknown) => void): void {
  saveError = listener
}

/** Saves run strictly one after another so concurrent patches cannot reach the disk out of order. */
let saveChain: Promise<unknown> = Promise.resolve()

/**
 * Merge `patch` into the settings and persist it. The in-memory cache changes only after the file was
 * written, so loadSettings() never returns values that were not saved (Codex review F13).
 */
export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = async (): Promise<Settings> => {
    const next = { ...loadSettings(), ...patch }
    try {
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFileAtomic(configPath(), JSON.stringify(next, null, 2))
    } catch (err) {
      try {
        saveError?.(err)
      } catch {
        // a broken listener must not mask the save error
      }
      throw err
    }
    cached = next
    return next
  }
  const result = saveChain.then(run, run)
  saveChain = result.catch(() => undefined)
  return result
}

/** Make sure config.json exists with the current sessions root so backseat-mcp can find it. */
export async function ensureConfig(): Promise<Settings> {
  const s = loadSettings()
  if (!existsSync(configPath())) await saveSettings({})
  return s
}
