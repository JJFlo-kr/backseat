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
  /** Capture hotkeys (Electron accelerator syntax). */
  hotkeyRect: string
  hotkeyWindow: string
}

const DEFAULTS: Omit<Settings, 'sessionsRoot'> = {
  version: 1,
  autoRecord: false,
  pressEnter: false,
  sttModel: 'onnx-community/whisper-small_timestamped',
  sttLanguage: 'korean',
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
  return cached
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
