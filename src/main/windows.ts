import { app, BrowserWindow, nativeImage, type BrowserWindowConstructorOptions, type WebContents } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export type Page = 'selector' | 'editor' | 'about'

export function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

/** Load a renderer page in dev (vite server) or production (built file). */
export function loadPage(win: BrowserWindow, page: Page): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return win.loadURL(`${devUrl}/${page}/index.html`)
  return win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
}

let iconCache: Electron.NativeImage | null = null

/** App icon for our windows' title bar and taskbar button (installed builds also get it from the exe). */
export function appIcon(): Electron.NativeImage | undefined {
  if (iconCache) return iconCache.isEmpty() ? undefined : iconCache
  const candidates = [join(app.getAppPath(), 'resources', 'icon.png'), join(process.resourcesPath ?? '', 'icon.png')]
  for (const p of candidates) {
    if (existsSync(p)) {
      iconCache = nativeImage.createFromPath(p)
      if (!iconCache.isEmpty()) return iconCache
    }
  }
  iconCache = nativeImage.createEmpty()
  return undefined
}

export function baseWebPreferences(): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false
  }
}

/** Collect renderer console errors, tolerant of both old and new Electron event shapes. */
export function watchRendererErrors(wc: WebContents, sink: string[], tag: string): void {
  wc.on('console-message', (event: unknown, ...rest: unknown[]) => {
    let level: string | number | undefined
    let message = ''
    if (typeof rest[0] === 'number') {
      level = rest[0]
      message = String(rest[1] ?? '')
    } else if (event && typeof event === 'object') {
      const e = event as { level?: string | number; message?: string }
      level = e.level
      message = String(e.message ?? '')
    }
    const isError = level === 'error' || level === 2 || level === 3
    if (isError) sink.push(`[${tag}] ${message}`)
  })
  wc.on('did-fail-load', (_e, code, desc) => sink.push(`[${tag}] did-fail-load ${code} ${desc}`))
  wc.on('render-process-gone', (_e, d) => sink.push(`[${tag}] render-process-gone ${d.reason}`))
  wc.on('preload-error', (_e, p, err) => sink.push(`[${tag}] preload-error ${p}: ${err.message}`))
}
