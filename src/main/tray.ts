import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

let tray: Tray | null = null

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

export function createTray(onCapture: () => void): Tray {
  if (tray) return tray
  tray = new Tray(trayIcon())
  tray.setToolTip('Backseat — AI 소통기 (Ctrl+Shift+A 캡처)')
  const menu = Menu.buildFromTemplate([
    { label: '캡처\tCtrl+Shift+A', click: onCapture },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', onCapture)
  return tray
}
