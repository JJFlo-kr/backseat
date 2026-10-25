import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceleratorLabel, modKeyLabel } from '../src/shared/platform.ts'

test('Cmd on macOS, Ctrl everywhere else', () => {
  assert.equal(modKeyLabel('darwin'), 'Cmd')
  for (const p of ['win32', 'linux', 'freebsd']) assert.equal(modKeyLabel(p), 'Ctrl')
})

test('accelerators are written for the platform they are shown on', () => {
  assert.equal(acceleratorLabel('CommandOrControl+Shift+A', 'darwin'), 'Cmd+Shift+A')
  assert.equal(acceleratorLabel('CommandOrControl+Shift+A', 'win32'), 'Ctrl+Shift+A')
  assert.equal(acceleratorLabel('CommandOrControl+Shift+W', 'linux'), 'Ctrl+Shift+W')
  assert.equal(acceleratorLabel('CmdOrCtrl+Alt+X', 'darwin'), 'Cmd+Alt+X')
  // On a Mac, Control and Command are different keys: only CommandOrControl follows the platform.
  assert.equal(acceleratorLabel('Control+Shift+Z', 'darwin'), 'Ctrl+Shift+Z')
  assert.equal(acceleratorLabel('Command+Shift+Z', 'win32'), 'Cmd+Shift+Z')
  assert.equal(acceleratorLabel('Alt+F10', 'linux'), 'Alt+F10')
})
