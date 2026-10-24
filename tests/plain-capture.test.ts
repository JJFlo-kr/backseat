// A capture sent without any additions goes out as the picture alone (no instruction line to spend tokens on).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPlainCapture, plainPathLine } from '../src/main/agents.ts'
import type { ExportPayload } from '../src/shared/types.ts'

const base: ExportPayload = {
  pngDataUrl: 'data:image/png;base64,iVBORw0KGgo=', memo: '', annotations: [],
  meta: { capturedAt: '', displayId: 0, scaleFactor: 1, rectDip: { x: 0, y: 0, width: 1, height: 1 }, rectPx: { x: 0, y: 0, width: 1, height: 1 }, mode: 'rect' }
}

test('nothing added: plain', () => {
  assert.equal(isPlainCapture(base), true)
  assert.equal(isPlainCapture({ ...base, memo: '   ' }), true, 'a blank memo is no memo')
  assert.equal(isPlainCapture({ ...base, links: [] }), true)
  assert.equal(isPlainCapture({ ...base, transcript: { text: ' ', segments: [], audioStartMs: 0, durationMs: 0, model: 'm', language: 'ko' } }), true, 'an empty transcript adds nothing')
  assert.equal(isPlainCapture({ ...base, meta: { ...base.meta, crop: { x: 0, y: 0, width: 1, height: 1 } } as never }), true, 'crop only changes the picture')
})

test('any addition: not plain', () => {
  const arrow = { type: 'arrow', id: 'a', color: '#E5484D', width: 4, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, t0: 0, t1: 1 } as never
  assert.equal(isPlainCapture({ ...base, annotations: [arrow] }), false)
  assert.equal(isPlainCapture({ ...base, memo: '버튼 키워 줘' }), false)
  assert.equal(isPlainCapture({ ...base, audio: { bytes: new Uint8Array(1), mimeType: 'audio/webm' } }), false)
  assert.equal(isPlainCapture({ ...base, transcript: { text: '이거', segments: [], audioStartMs: 0, durationMs: 1, model: 'm', language: 'ko' } }), false)
  assert.equal(isPlainCapture({ ...base, links: [{}] as never }), false)
  assert.equal(isPlainCapture({ ...base, compare: {} as never }), false)
  assert.equal(isPlainCapture({ ...base, meta: { ...base.meta, request: { requestId: 'r', question: 'q', agent: 'a' } } }), false, 'an answer to an agent question keeps its instructions')
})

test('terminal line is the path alone, quoted only with spaces', () => {
  const p = String.raw`C:\Users\a\Pictures\Backseat\sessions\x\annotated.png`
  assert.equal(plainPathLine(p), p)
  const spaced = String.raw`C:\My Pictures\annotated.png`
  assert.equal(plainPathLine(spaced), `"${spaced}"`)
})
