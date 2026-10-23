import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toTranscript, type Chunk } from '../src/shared/transcript.ts'

const ctx = { audioStartMs: 1000, sampleCount: 16000 * 8, language: 'korean' }

test('word chunks are grouped into sentences by punctuation and pauses, on the editor clock', () => {
  const chunks: Chunk[] = [
    { text: ' 이', timestamp: [0.24, 0.36] },
    { text: ' 로그인', timestamp: [0.36, 0.88] },
    { text: ' 버튼이', timestamp: [0.88, 1.38] },
    { text: ' 작아.', timestamp: [1.64, 2.44] },
    { text: ' 한', timestamp: [2.92, 3.18] },
    { text: ' 키워줘.', timestamp: [3.5, 4.96] },
    { text: ' 그리고', timestamp: [5.44, 5.8] },
    { text: ' 옮기고.', timestamp: [6.1, 6.6] }
  ]
  const t = toTranscript(' 이 로그인 버튼이 작아. 한 키워줘. 그리고 옮기고.', chunks, ctx, 'm')
  assert.equal(t.segments.length, 3)
  assert.equal(t.segments[0].text, '이 로그인 버튼이 작아.')
  assert.equal(t.segments[0].start, 1240)
  assert.equal(t.segments[0].end, 3440)
  assert.equal(t.segments[0].words?.length, 4)
  assert.equal(t.segments[1].text, '한 키워줘.')
  assert.equal(t.segments[2].text, '그리고 옮기고.')
  assert.equal(t.segments[2].end, 7600)
  assert.equal(t.durationMs, 8000)
  assert.equal(t.audioStartMs, 1000)
  assert.equal(t.text, '이 로그인 버튼이 작아. 한 키워줘. 그리고 옮기고.')
})

test('punctuation-led pieces are glued without a space', () => {
  const chunks: Chunk[] = [
    { text: ' 한', timestamp: [0, 0.2] },
    { text: ' 1', timestamp: [0.2, 0.4] },
    { text: '.5배', timestamp: [0.4, 0.8] },
    { text: ' 키워줘.', timestamp: [0.8, 1.2] }
  ]
  const t = toTranscript('', chunks, ctx, 'm')
  assert.equal(t.segments[0].text, '한 1.5배 키워줘.')
})

test('a long pause splits a segment even without punctuation', () => {
  const chunks: Chunk[] = [
    { text: ' 여기', timestamp: [0, 0.3] },
    { text: ' 크게', timestamp: [0.3, 0.6] },
    { text: ' 저기', timestamp: [1.6, 1.9] },
    { text: ' 작게', timestamp: [1.9, 2.2] }
  ]
  const t = toTranscript('', chunks, ctx, 'm')
  assert.deepEqual(
    t.segments.map((s) => s.text),
    ['여기 크게', '저기 작게']
  )
})

test('segment-level chunks pass through without words', () => {
  const chunks: Chunk[] = [{ text: ' 이 로그인 버튼이 너무 작아. 한 1.5배 키워줘.', timestamp: [0, 7.4] }]
  const t = toTranscript('x', chunks, ctx, 'm')
  assert.equal(t.segments.length, 1)
  assert.equal(t.segments[0].words, undefined)
  assert.equal(t.segments[0].start, 1000)
  assert.equal(t.segments[0].end, 8400)
})

test('a null end timestamp gets a small default length', () => {
  const t = toTranscript('', [{ text: ' 끝', timestamp: [2, null] }], ctx, 'm')
  assert.equal(t.segments[0].start, 3000)
  assert.equal(t.segments[0].end, 3300)
})
