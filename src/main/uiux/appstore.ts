// The app's UI/UX store: <userData>/uiux, the same folder the MCP server reads and writes (jobs, results).
import { app } from 'electron'
import { join } from 'path'
import { UiuxStore } from './store'

let store: UiuxStore | null = null

/** Created on first use; userData exists once the app is ready. */
export function uiuxStore(): UiuxStore {
  store ??= new UiuxStore(join(app.getPath('userData'), 'uiux'))
  return store
}
