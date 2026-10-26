// File dialogs attached to a window when there is one (modal to it), free-standing otherwise.
import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions, type SaveDialogReturnValue } from 'electron'

/** The first chosen path of an open dialog, or null when it was cancelled. */
export async function showOpen(win: BrowserWindow | null | undefined, opts: OpenDialogOptions): Promise<string | null> {
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
}

export function showSave(win: BrowserWindow | null | undefined, opts: SaveDialogOptions): Promise<SaveDialogReturnValue> {
  return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts)
}
