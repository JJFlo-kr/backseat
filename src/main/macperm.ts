// macOS only: screen capture needs the Screen Recording permission. Without it desktopCapturer still answers, but
// with empty pictures, so a capture would open on a blank image. When the permission is denied, say so and offer
// the System Settings pane instead of capturing.
import { dialog, shell, systemPreferences } from 'electron'
import { t } from '../shared/i18n'

const SCREEN_PRIVACY_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

/**
 * true when a capture can go ahead. 'not-determined' also goes ahead: the first capture is what makes macOS ask.
 * Elsewhere than macOS always true.
 */
export async function screenCaptureAllowed(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted' || status === 'not-determined') return true
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: t('dialog.macScreenPermission.title'),
    message: t('dialog.macScreenPermission.message'),
    detail: t('dialog.macScreenPermission.detail'),
    buttons: [t('dialog.macScreenPermission.open'), t('dialog.macScreenPermission.later')],
    defaultId: 0,
    cancelId: 1
  })
  if (response === 0) await shell.openExternal(SCREEN_PRIVACY_PANE)
  return false
}
