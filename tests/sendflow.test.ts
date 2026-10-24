// Codex review F05 (renderer side) and F12: what 전송 does after the recording settled and after delivery.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSend, type SendSteps, type SttOutcome, type TranscriptChoice } from '../src/renderer/editor/sendflow.ts'
import type { SendResult } from '../src/shared/types.ts'

const PASTED: SendResult = { ok: true, delivered: 'pasted', message: 'pasted' }
const CLIPBOARD: SendResult = { ok: true, delivered: 'clipboard', message: 'clipboard' }

function steps(stt: SttOutcome[], choices: TranscriptChoice[], result: SendResult = PASTED) {
  const log: string[] = []
  const s: SendSteps = {
    settle: async () => { log.push('settle'); return stt.shift() ?? 'none' },
    chooseOnSttFailure: async () => { const c = choices.shift() ?? 'cancel'; log.push(`ask:${c}`); return c },
    retryTranscription: async () => { log.push('retry'); return stt.shift() ?? 'failed' },
    deliver: async () => { log.push('deliver'); return result }
  }
  return { s, log }
}

test('F05: pinned editor is not left busy after a successful paste', async () => {
  const { s } = steps(['none'], [])
  const o = await runSend(s, () => true)
  assert.equal(o.close, false)
  assert.equal(o.stayBusy, false, 'copy / save / send must work again in the pinned window')
})

test('F05: unpinned editor closes and stays busy until then (no double send)', async () => {
  const { s } = steps(['ok'], [])
  const o = await runSend(s, () => false)
  assert.equal(o.close, true)
  assert.equal(o.stayBusy, true)
})

test('clipboard-only delivery keeps the editor open and usable', async () => {
  const { s } = steps(['none'], [], CLIPBOARD)
  const o = await runSend(s, () => false)
  assert.deepEqual([o.close, o.stayBusy], [false, false])
})

test('F12: a failed transcription asks first; cancel sends nothing', async () => {
  const { s, log } = steps(['failed'], ['cancel'])
  const o = await runSend(s, () => false)
  assert.deepEqual(log, ['settle', 'ask:cancel'])
  assert.equal(o.result, null)
  assert.equal(o.canceled, true)
  assert.deepEqual([o.close, o.stayBusy], [false, false])
})

test('F12: retry until it works, then send', async () => {
  const { s, log } = steps(['failed', 'failed', 'ok'], ['retry', 'retry'])
  const o = await runSend(s, () => false)
  assert.deepEqual(log, ['settle', 'ask:retry', 'retry', 'ask:retry', 'retry', 'deliver'])
  assert.equal(o.result?.delivered, 'pasted')
})

test('F12: "image only" sends without the transcript after the user chose it', async () => {
  const { s, log } = steps(['failed'], ['image'])
  await runSend(s, () => false)
  assert.deepEqual(log, ['settle', 'ask:image', 'deliver'])
})

test('no recording / transcript fine: no question', async () => {
  for (const stt of ['none', 'ok'] as const) {
    const { s, log } = steps([stt], [])
    await runSend(s, () => false)
    assert.deepEqual(log, ['settle', 'deliver'])
  }
})
