// Codex review F13: settings are published to the in-memory cache only after config.json was replaced,
// a failed write keeps the old state, and quick consecutive saves end in the last value on disk and in memory.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
// Through require: an ESM import of fs/promises here would load it before mock.module() can replace it.
const realFs = createRequire(import.meta.url)('fs/promises') as typeof import('node:fs/promises')
// Captured now: mock.module() patches the builtin's exports object in place.
const realWriteFile = realFs.writeFile
const realReadFile = realFs.readFile
import { readFileSync } from 'node:fs'
import { installFakeElectron } from './support/fake-electron.ts'

installFakeElectron()

let failWrites: string | null = null
/** Per-call delays (ms) for config writes, consumed in order: makes later saves finish first. */
const delays: number[] = []
const io = async (file: string): Promise<void> => {
  if (!String(file).includes('config.json')) return
  const d = delays.shift()
  if (d) await new Promise((r) => setTimeout(r, d))
  if (failWrites) throw Object.assign(new Error(`${failWrites}: no space left on device`), { code: failWrites })
}
mock.module('fs/promises', {
  exports: {
    ...realFs,
    default: realFs,
    writeFile: async (file: string, ...rest: unknown[]) => {
      await io(file)
      return (realWriteFile as (...a: unknown[]) => Promise<void>)(file, ...rest)
    }
  }
})

const { configPath, loadSettings, saveSettings } = await import('../src/main/config.ts')

const onDisk = (): Record<string, unknown> => JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>

test('a failed write leaves memory and disk on the old value', async () => {
  await saveSettings({ pressEnter: false })
  failWrites = 'ENOSPC'
  try {
    await assert.rejects(saveSettings({ pressEnter: true }), /ENOSPC/)
  } finally {
    failWrites = null
  }
  assert.equal(loadSettings().pressEnter, false, 'cache must not show an unsaved value')
  assert.equal(onDisk().pressEnter, false)
})

test('quick consecutive saves are applied in order; memory and disk agree on the last one', async () => {
  await saveSettings({ autoRecord: false, pressEnter: false })
  delays.push(80, 0) // the first write is slow: without serialisation the second one lands first
  await Promise.all([saveSettings({ pressEnter: true }), saveSettings({ autoRecord: true })])
  assert.equal(loadSettings().autoRecord, true)
  assert.equal(loadSettings().pressEnter, true)
  assert.equal(onDisk().autoRecord, true)
  assert.equal(onDisk().pressEnter, true)
})

test('a save after a failed save still works', async () => {
  failWrites = 'EPERM'
  await assert.rejects(saveSettings({ sttLanguage: 'english' }))
  failWrites = null
  await saveSettings({ sttLanguage: 'japanese' })
  assert.equal(loadSettings().sttLanguage, 'japanese')
  assert.equal(onDisk().sttLanguage, 'japanese')
})
