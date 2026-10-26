// Where the app keeps its data, as seen by backseat-mcp (plain Node: no Electron). config.json and the UI/UX
// store both live under Electron's userData folder; this is the one place that works out that folder.
import { homedir } from 'os'
import { join } from 'path'

/**
 * Electron's userData folder for this app, without Electron (src/main/config.ts writes config.json there).
 * BACKSEAT_USER_DATA overrides it. That variable is for tests only (scripts/mcp-check.mjs, tests/uiux-jobs*.test.ts):
 * the installed app never sets it, and setting it points the MCP server away from the app's real data.
 */
export function userDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BACKSEAT_USER_DATA) return env.BACKSEAT_USER_DATA
  let base: string
  if (process.platform === 'win32') base = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  else if (process.platform === 'darwin') base = join(homedir(), 'Library', 'Application Support')
  else base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'backseat')
}

export function configFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(userDataDir(env), 'config.json')
}

/** Root of the UI/UX store (src/main/uiux/store.ts): <userData>/uiux. The app's service.ts uses the same folder. */
export function uiuxRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(userDataDir(env), 'uiux')
}
