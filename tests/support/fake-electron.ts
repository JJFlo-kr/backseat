// A stand-in for the 'electron' module so main-process modules can run under plain Node in tests.
// Call installFakeElectron() BEFORE dynamically importing the module under test; every test file
// runs in its own process, so the mock never leaks into another file.
// Needs `node --experimental-test-module-mocks --import ./tests/support/register.mjs` (see package.json).
import { mock } from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface FakeElectron {
  /** app.getPath() returns <base>/<name> (userData, pictures, temp, …). */
  base: string
  ipcHandlers: Map<string, (e: unknown, ...args: unknown[]) => unknown>
  notifications: FakeNotification[]
}

export class FakeNotification extends EventEmitter {
  static created: FakeNotification[] = []
  static isSupported(): boolean {
    return true
  }
  shown = false
  readonly opts: { title?: string; body?: string }
  constructor(opts: { title?: string; body?: string }) {
    super()
    this.opts = opts
    FakeNotification.created.push(this)
  }
  show(): void {
    this.shown = true
  }
}

export class FakeWebContents extends EventEmitter {
  sent: { channel: string; args: unknown[] }[] = []
  send(channel: string, ...args: unknown[]): void {
    this.sent.push({ channel, args })
  }
  isDestroyed(): boolean {
    return false
  }
}

/** Enough of BrowserWindow for the editor / send code: visibility and always-on-top are tracked. */
export class FakeBrowserWindow extends EventEmitter {
  static all: FakeBrowserWindow[] = []
  static fromWebContents(wc: unknown): FakeBrowserWindow | null {
    return FakeBrowserWindow.all.find((w) => w.webContents === wc) ?? null
  }
  webContents = new FakeWebContents()
  visible = false
  focused = false
  onTop = false
  constructor() {
    super()
    FakeBrowserWindow.all.push(this)
  }
  setMenu(): void {}
  loadFile(): Promise<void> { return Promise.resolve() }
  loadURL(): Promise<void> { return Promise.resolve() }
  show(): void { this.visible = true; this.focused = true }
  showInactive(): void { this.visible = true }
  hide(): void { this.visible = false; this.focused = false }
  focus(): void { this.focused = true }
  close(): void { this.visible = false }
  isDestroyed(): boolean { return false }
  isVisible(): boolean { return this.visible }
  isAlwaysOnTop(): boolean { return this.onTop }
  setAlwaysOnTop(v: boolean): void { this.onTop = v }
  getSize(): number[] { return [800, 600] }
  setSize(): void {}
  setPosition(): void {}
  getBounds(): { x: number; y: number; width: number; height: number } { return { x: 0, y: 0, width: 800, height: 600 } }
}

export function installFakeElectron(): FakeElectron {
  const base = mkdtempSync(join(tmpdir(), 'backseat-test-'))
  // Main-process modules are bundled to CommonJS by electron-vite and may use __dirname.
  const g = globalThis as { __dirname?: string }
  g.__dirname ??= join(base, 'out-main')
  const ipcHandlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
  const app = {
    isPackaged: false,
    getPath: (name: string) => join(base, name),
    getAppPath: () => join(base, 'app'),
    getLocale: () => 'ko',
    getPreferredSystemLanguages: () => ['ko-KR'],
    getVersion: () => '0.0.0-test',
    setLoginItemSettings: () => undefined,
    whenReady: () => new Promise<never>(() => undefined),
    on: () => app
  }
  const noop = (): void => undefined
  mock.module('electron', {
    exports: {
      app,
      ipcMain: {
        handle: (ch: string, fn: (e: unknown, ...args: unknown[]) => unknown) => ipcHandlers.set(ch, fn),
        on: (ch: string, fn: (e: unknown, ...args: unknown[]) => unknown) => ipcHandlers.set(ch, fn)
      },
      Notification: FakeNotification,
      BrowserWindow: FakeBrowserWindow,
      clipboard: { write: async () => undefined, writeText: noop, readText: () => '' },
      ClipboardItem: class {
        readonly parts: Record<string, unknown>
        constructor(parts: Record<string, unknown>) {
          this.parts = parts
        }
      },
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
      screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ id: 0, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({ isEmpty: () => true }) },
      shell: { openExternal: async () => undefined },
      Menu: { buildFromTemplate: () => ({}) },
      Tray: class {},
      desktopCapturer: { getSources: async () => [] },
      globalShortcut: { register: () => true, unregisterAll: noop },
      session: { defaultSession: {} }
    }
  })
  return { base, ipcHandlers, notifications: FakeNotification.created }
}
