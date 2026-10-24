import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import { APP_NAME, APP_TAGLINE, ISSUES_URL, LICENSE_NAME, REPO_URL, SUPPORT_URL } from '../shared/links'
import type { AboutInfo } from '../shared/types'
import { appIcon, baseWebPreferences, loadPage, watchRendererErrors } from './windows'

let aboutWin: BrowserWindow | null = null
let ipcInstalled = false

export function aboutInfo(): AboutInfo {
  return {
    name: APP_NAME,
    version: app.getVersion(),
    tagline: APP_TAGLINE,
    license: LICENSE_NAME,
    repoUrl: REPO_URL,
    supportUrl: SUPPORT_URL,
    issuesUrl: ISSUES_URL
  }
}

/** Only web links ever leave the app; the renderer cannot ask for file: or custom schemes. */
function openWebUrl(url: unknown): void {
  if (typeof url !== 'string') return
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(u.toString())
  } catch {
    /* not a URL */
  }
}

/** Bundled doc: next to the exe in the installed app (extraResources), in the project root in dev. */
function docPath(doc: 'license' | 'notices'): string {
  const [packed, dev] = doc === 'license' ? ['LICENSE.txt', 'LICENSE'] : ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md']
  const candidates = [join(process.resourcesPath ?? '', packed), join(app.getAppPath(), dev)]
  return candidates.find((p) => existsSync(p)) ?? candidates[1]
}

function installIpc(): void {
  if (ipcInstalled) return
  ipcInstalled = true
  ipcMain.handle(IPC.aboutInfo, () => aboutInfo())
  ipcMain.handle(IPC.aboutOpen, (_e, url: unknown) => openWebUrl(url))
  ipcMain.handle(IPC.aboutOpenDoc, async (_e, doc: unknown) => {
    if (doc === 'license' || doc === 'notices') await shell.openPath(docPath(doc))
  })
}

/** Create the About window without showing it (used by showAbout and the self test). */
export function createAboutWindow(errors?: string[]): BrowserWindow {
  installIpc()
  const win = new BrowserWindow({
    icon: appIcon(),
    width: 420,
    height: 360,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: `${APP_NAME} 정보`,
    backgroundColor: '#1b1b1f',
    webPreferences: baseWebPreferences()
  })
  win.setMenuBarVisibility(false)
  if (errors) watchRendererErrors(win.webContents, errors, 'about')
  win.webContents.setWindowOpenHandler(({ url }) => {
    openWebUrl(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  return win
}

/** Show the About window; there is only ever one. */
export function showAbout(): void {
  if (aboutWin && !aboutWin.isDestroyed()) {
    if (aboutWin.isMinimized()) aboutWin.restore()
    aboutWin.show()
    aboutWin.focus()
    return
  }
  const win = createAboutWindow()
  aboutWin = win
  win.on('closed', () => {
    if (aboutWin === win) aboutWin = null
  })
  win.once('ready-to-show', () => win.show())
  void loadPage(win, 'about')
}
