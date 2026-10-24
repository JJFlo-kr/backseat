import { app, clipboard, Menu, nativeImage, shell, Tray } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { loadSettings, saveSettings, configPath, mcpServerPath } from './config'
import { sessionsRoot } from './sessions'

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

function buildMenu(actions: TrayActions): Menu {
  const s = loadSettings()
  return Menu.buildFromTemplate([
    { label: `영역 캡처\t${s.hotkeyRect.replace('CommandOrControl', 'Ctrl')}`, click: actions.capture },
    { label: `창 캡처\t${s.hotkeyWindow.replace('CommandOrControl', 'Ctrl')}`, click: actions.captureWindow },
    { label: '마지막 영역 다시 캡처', enabled: actions.hasLast(), click: actions.recaptureLast },
    { type: 'separator' },
    {
      label: '편집기 열리면 자동 녹음',
      type: 'checkbox',
      checked: s.autoRecord,
      click: (item) => void saveSettings({ autoRecord: item.checked })
    },
    {
      label: '전송 후 Enter 자동 입력',
      type: 'checkbox',
      checked: s.pressEnter,
      click: (item) => void saveSettings({ pressEnter: item.checked })
    },
    { type: 'separator' },
    { label: '에이전트 연결 설정(MCP) 복사', click: copyMcpConfig },
    { label: '세션 폴더 열기', click: () => void shell.openPath(sessionsRoot()) },
    { label: '설정 파일 열기', click: () => void shell.openPath(configPath()) },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() }
  ])
}

export function createTray(actions: TrayActions): Tray {
  if (tray) return tray
  tray = new Tray(trayIcon())
  tray.setToolTip('Backseat — AI 소통기 (Ctrl+Shift+A 캡처)')
  const refresh = (): void => tray?.setContextMenu(buildMenu(actions))
  refresh()
  // Rebuild on open so "마지막 영역" and checkboxes reflect the current state.
  tray.on('right-click', refresh)
  tray.on('click', actions.capture)
  return tray
}
