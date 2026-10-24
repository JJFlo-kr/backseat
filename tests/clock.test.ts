// Codex review F15: mm:ss.s never shows 60 seconds; the timeline clock and brief.md agree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtClock } from '../src/shared/align.ts'
import { buildBrief } from '../src/main/brief.ts'
import { setMessages } from '../src/shared/i18n.ts'
import type { ExportPayload } from '../src/shared/types.ts'
import ko from '../src/locales/ko.json' with { type: 'json' }

setMessages('ko', ko)

test('fmtClock rounds to tenths before splitting minutes and seconds', () => {
  assert.equal(fmtClock(59949), '00:59.9')
  assert.equal(fmtClock(59950), '01:00.0')
  assert.equal(fmtClock(59999), '01:00.0')
  assert.equal(fmtClock(60000), '01:00.0')
  assert.equal(fmtClock(0), '00:00.0')
  assert.equal(fmtClock(-5), '00:00.0')
  assert.equal(fmtClock(119_960), '02:00.0')
  assert.equal(fmtClock(61_234), '01:01.2')
})

test('no generated time between 0 and 10 minutes ever shows 60 seconds (seed 0xBACC5EA7)', () => {
  let s = 0xbacc5ea7
  const next = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  for (let i = 0; i < 2000; i++) {
    const ms = Math.floor(next() * 600_000)
    const out = fmtClock(ms)
    assert.match(out, /^\d{2}:[0-5]\d\.\d$/, `${ms} -> ${out}`)
    const [m, sec] = out.split(':')
    assert.ok(Math.abs(Number(m) * 60_000 + Number(sec) * 1000 - ms) <= 50, `${ms} -> ${out}`)
  }
})

test('brief.md speech times use the same clock', () => {
  const payload: ExportPayload = {
    pngDataUrl: '', memo: '',
    annotations: [{ kind: 'badge', x: 1, y: 1, n: 1, color: '#E5484D', size: 22, tStart: 59_000, tEnd: 59_000 }],
    meta: { capturedAt: '', displayId: 0, scaleFactor: 1, rectDip: { x: 0, y: 0, width: 1, height: 1 }, rectPx: { x: 0, y: 0, width: 1, height: 1 }, mode: 'rect' },
    transcript: { text: '여기', segments: [{ start: 59_960, end: 61_000, text: '여기' }], audioStartMs: 0, durationMs: 61_000, model: 'x', language: 'korean' }
  }
  const brief = buildBrief(payload, 'annotated.png')
  assert.ok(brief.includes('[01:00.0–01:01.0]'), brief)
  assert.ok(!brief.includes('00:60'), brief)
})
