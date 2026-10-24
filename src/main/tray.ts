import { app, clipboard, Menu, nativeImage, shell, Tray } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { applyLoginItem, loadSettings, onSettingsSaveError, saveSettings, configPath, mcpServerPath } from './config'
import { SUPPORT_URL } from '../shared/links'
import { getLocale, LOCALE_NAMES, LOCALES, t } from '../shared/i18n'
import { showAbout } from './about'
import { applyLocale, STT_LANGUAGES } from './locales'
import { sessionsRoot } from './sessions'
import { pinParts } from './agents'
import { resolveForTray } from './destination'
import type { Candidate } from './targets'
import { getPicked, setPicked } from './tracker'

let tray: Tray | null = null

export interface TrayActions {
  capture: () => void
  captureWindow: () => void
  recaptureLast: () => void
  /** true when a previous region exists. */
  hasLast: () => boolean
}

function trayIcon(): Electron.NativeImage {
  const candidates = [
    join(app.getAppPath(), 'resources', 'tray.png'),
    join(process.resourcesPath ?? '', 'tray.png')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
    }
  }
  return nativeImage.createEmpty()
}

/** Put a ready-to-paste .mcp.json snippet pointing at this install's MCP server on the clipboard. */
function copyMcpConfig(): void {
  const snippet = { mcpServers: { backseat: { command: 'node', args: [mcpServerPath().replaceAll('\\', '/')] } } }
  clipboard.writeText(JSON.stringify(snippet, null, 2))
}

/** "Language" also in English, so someone who cannot read the current language still finds the menu. */
function languageLabel(): string {
  return getLocale() === 'en' ? t('tray.language') : `${t('tray.language')} / Language`
}

function languageMenu(onChange: () => void): Electron.MenuItemConstructorOptions[] {
  const pref = loadSettings().locale
  const pick = (locale: string) => (): void =>
    void saveSettings({ locale })
      .then(
        () => applyLocale(),
        () => undefined // already reported by onSettingsSaveError; the menu falls back to the unchanged setting
      )
      .then(onChange)
  return [
    { label: t('tray.languageAuto'), type: 'radio', checked: !pref || pref === 'auto', click: pick('auto') },
    { type: 'separator' },
    ...LOCALES.map((l): Electron.MenuItemConstructorOptions => ({
      label: LOCALE_NAMES[l],
      type: 'radio',
      checked: pref === l,
      click: pick(l)
    }))
  ]
}

function sttMenu(): Electron.MenuItemConstructorOptions[] {
  const pref = loadSettings().sttLanguage || 'auto'
  const pick = (sttLanguage: string) => (): void => void saveSettings({ sttLanguage }).catch(() => undefined)
  return [
    { label: t('tray.sttFollowUi'), type: 'radio', checked: pref === 'auto', click: pick('auto') },
    { label: t('tray.sttDetect'), type: 'radio', checked: pref === 'detect', click: pick('detect') },
    { type: 'separator' },
    ...STT_LANGUAGES.map((l): Electron.MenuItemConstructorOptions => ({
      label: t(`stt.lang.${l}`),
      type: 'radio',
      checked: pref === l,
      click: pick(l)
    }))
  ]
}

/**
 * "보낼 곳": where the next captures go (request (1) item 1). Picking a window keeps it while it lives, even
 * after the user moves to another page to capture; "자동" goes back to the last AI window used. Known AI
 * windows are listed first; any other window (a messenger, a page) only under "다른 창", by explicit choice.
 */
function targetMenu(onChange: () => void): Electron.MenuItemConstructorOptions[] {
  const s = loadSettings()
  const { current, candidates } = resolveForTray()
  const picked = getPicked()
  const now = current.view.source === 'none' ? t('tray.target.none') : t('tray.target.current', { label: current.view.label })
  const isPicked = (c: Candidate): boolean => picked?.identity.hwnd === c.identity.hwnd && picked.identity.pid === c.identity.pid
  const pick = (c: Candidate) => (): void => {
    setPicked(c.target, c.identity)
    onChange()
  }
  const item = (c: Candidate): Electron.MenuItemConstructorOptions => ({ label: c.view.label, type: 'radio', checked: isPicked(c), click: pick(c) })
  const known = candidates.filter((c) => c.target.kind !== 'unknown')
  const other = candidates.filter((c) => c.target.kind === 'unknown')
  const pinnable = current.target && current.view.source !== 'pinned' ? current.target : null
  return [
    { label: now, enabled: false },
    { type: 'separator' },
    {
      label: t('tray.target.auto'),
      type: 'radio',
      checked: !picked,
      click: () => {
        setPicked(null)
        onChange()
      }
    },
    ...(known.length ? known.map(item) : [{ label: t('tray.target.noAgents'), enabled: false }]),
    ...(other.length ? [{ label: t('tray.target.otherWindows'), submenu: other.map(item) }] : []),
    { type: 'separator' },
    {
      label: pinnable ? t('tray.target.pin', { label: pinnable.label }) : t('tray.target.pinNone'),
      enabled: Boolean(pinnable),
      click: () => {
        if (!pinnable) return
        const p = pinParts(pinnable)
        void saveSettings({ pinnedTargetProcess: p.process, pinnedTargetTitle: p.title }).catch(() => undefined).then(onChange)
      }
    },
    ...(s.pinnedTargetProcess
      ? [
          {
            label: t('tray.unpinTarget', { process: s.pinnedTargetProcess }),
            click: () => void saveSettings({ pinnedTargetProcess: '', pinnedTargetTitle: '' }).catch(() => undefined).then(onChange)
          }
        ]
      : [])
  ]
}

function buildMenu(actions: TrayActions, onChange: () => void): Menu {
  const s = loadSettings()
  return Menu.buildFromTemplate([
    { label: `${t('tray.captureRegion')}\t${s.hotkeyRect.replace('CommandOrControl', 'Ctrl')}`, click: actions.capture },
    { label: `${t('tray.captureWindow')}\t${s.hotkeyWindow.replace('CommandOrControl', 'Ctrl')}`, click: actions.captureWindow },
    { label: t('tray.recaptureLast'), enabled: actions.hasLast(), click: actions.recaptureLast },
    { type: 'separator' },
    {
      label: t('tray.autoRecord'),
      type: 'checkbox',
      checked: s.autoRecord,
      click: (item) => void saveSettings({ autoRecord: item.checked }).catch(() => undefined)
    },
    {
      label: t('tray.pressEnter'),
      type: 'checkbox',
      checked: s.pressEnter,
      click: (item) => void saveSettings({ pressEnter: item.checked }).catch(() => undefined)
    },
    {
      label: app.isPackaged ? t('tray.launchAtLogin') : t('tray.launchAtLoginDev'),
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: app.isPackaged && s.launchAtLogin,
      click: (item) => void saveSettings({ launchAtLogin: item.checked }).then(applyLoginItem).catch(() => undefined)
    },
    { type: 'separator' },
    { label: t('tray.target'), submenu: targetMenu(onChange) },
    { type: 'separator' },
    { label: languageLabel(), submenu: languageMenu(onChange) },
    {
      label: t('tray.briefInEnglish'),
      type: 'checkbox',
      checked: s.briefLocale === 'en',
      click: (item) => void saveSettings({ briefLocale: item.checked ? 'en' : 'follow' }).catch(() => undefined)
    },
    { label: t('tray.sttLanguage'), submenu: sttMenu() },
    { type: 'separator' },
    { label: t('tray.copyMcp'), click: copyMcpConfig },
    { label: t('tray.openSessions'), click: () => void shell.openPath(sessionsRoot()) },
    { label: t('tray.openConfig'), click: () => void shell.openPath(configPath()) },
    { type: 'separator' },
    { label: t('tray.support'), click: () => void shell.openExternal(SUPPORT_URL) },
    { label: t('tray.about'), click: showAbout },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => app.quit() }
  ])
}

export function createTray(actions: TrayActions): Tray {
  if (tray) return tray
  tray = new Tray(trayIcon())
  // saveSettings rejects on a failed write (Codex review F13); the callers swallow it, so tell the user here.
  onSettingsSaveError((err) => {
    console.error('[backseat] saving settings failed:', err)
    tray?.displayBalloon({
      iconType: 'error',
      title: t('tray.settingsSaveFailedTitle'),
      content: t('tray.settingsSaveFailed', { error: err instanceof Error ? err.message : String(err) })
    })
  })
  const refresh = (): void => {
    tray?.setToolTip(t('tray.tooltip', { hotkey: loadSettings().hotkeyRect.replace('CommandOrControl', 'Ctrl') }))
    tray?.setContextMenu(buildMenu(actions, refresh))
  }
  refresh()
  // Rebuild on open so the last region, checkboxes and the language reflect the current state.
  tray.on('right-click', refresh)
  tray.on('click', actions.capture)
  return tray
}
