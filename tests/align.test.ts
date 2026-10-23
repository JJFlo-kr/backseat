// Run with: node --test tests/  (Node 24 strips types natively; imports need .ts extensions)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  alignSegments,
  annotationBoundaries,
  gapMs,
  groupByAnnotation,
  nearestBoundary,
  overlapMs,
  pointsForProgress,
  replayAt,
  sessionEnd
} from '../src/shared/align.ts'
import type { Annotation } from '../src/shared/types.ts'

const stroke = (tStart: number, tEnd: number): Annotation => ({
  kind: 'stroke',
  color: '#E5484D',
  width: 3,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 20 },
    { x: 30, y: 30 }
  ],
  tStart,
  tEnd
})

const text = (t: number, s: string): Annotation => ({
  kind: 'text',
  text: s,
  x: 0,
  y: 0,
  color: '#E5484D',
  fontSize: 18,
  tStart: t,
  tEnd: t + 50
})

test('overlap and gap', () => {
  assert.equal(overlapMs({ start: 0, end: 1000 }, { start: 500, end: 2000 }), 500)
  assert.equal(overlapMs({ start: 0, end: 1000 }, { start: 1000, end: 2000 }), 0)
  assert.equal(gapMs({ start: 0, end: 1000 }, { start: 1500, end: 2000 }), 500)
  assert.equal(gapMs({ start: 3000, end: 4000 }, { start: 1500, end: 2000 }), 1000)
  assert.equal(gapMs({ start: 0, end: 1000 }, { start: 500, end: 700 }), 0)
})

test('speech during a stroke attaches to that stroke', () => {
  const ann = [stroke(1000, 3000), stroke(5000, 7000)]
  const seg = [{ start: 1200, end: 2800, text: '이 버튼 너무 작아' }]
  const [a] = alignSegments(ann, seg)
  assert.equal(a.annotationIndex, 0)
  assert.equal(a.reason, 'overlap')
})

test('speech just after a stroke attaches by proximity', () => {
  const ann = [stroke(1000, 3000), stroke(9000, 11000)]
  const seg = [{ start: 3400, end: 4200, text: '키워줘' }]
  const [a] = alignSegments(ann, seg)
  assert.equal(a.annotationIndex, 0)
  assert.equal(a.reason, 'proximity')
})

test('speech far from any stroke is global', () => {
  const ann = [stroke(1000, 3000)]
  const seg = [{ start: 7000, end: 8000, text: '전체적으로 다크모드로' }]
  const [a] = alignSegments(ann, seg)
  assert.equal(a.annotationIndex, null)
  assert.equal(a.reason, 'global')
})

test('deictic phrase reaches the nearest stroke beyond the proximity window', () => {
  const ann = [stroke(1000, 3000), stroke(20000, 21000)]
  const seg = [{ start: 6000, end: 6800, text: '이거 없애줘' }]
  const [a] = alignSegments(ann, seg)
  assert.equal(a.annotationIndex, 0)
  assert.equal(a.reason, 'deictic')
})

test('overlap beats proximity when both exist', () => {
  const ann = [stroke(0, 1000), stroke(1200, 4000)]
  const seg = [{ start: 1100, end: 3000, text: '로고는 가운데로' }]
  const [a] = alignSegments(ann, seg)
  assert.equal(a.annotationIndex, 1)
})

test('text annotations get a minimum span so quick notes still overlap', () => {
  const ann = [text(2000, '여백 24px')]
  const seg = [{ start: 2100, end: 2600, text: '여백 좀' }]
  const [a] = alignSegments(ann, seg)
  assert.equal(a.annotationIndex, 0)
  assert.equal(a.reason, 'overlap')
})

test('groupByAnnotation collects segment indices', () => {
  const ann = [stroke(0, 1000), stroke(2000, 3000)]
  const seg = [
    { start: 100, end: 500, text: 'a' },
    { start: 2100, end: 2500, text: 'b' },
    { start: 600, end: 900, text: 'c' },
    { start: 30000, end: 31000, text: 'd' }
  ]
  const g = groupByAnnotation(alignSegments(ann, seg))
  assert.deepEqual(g.get(0), [0, 2])
  assert.deepEqual(g.get(1), [1])
  assert.deepEqual(g.get(null), [3])
})

test('replayAt reports progress and hides future annotations', () => {
  const ann = [stroke(1000, 2000), text(5000, 'x')]
  assert.deepEqual(replayAt(ann, 500), [])
  const mid = replayAt(ann, 1500)
  assert.equal(mid.length, 1)
  assert.equal(mid[0].progress, 0.5)
  const late = replayAt(ann, 9000)
  assert.equal(late.length, 2)
  assert.equal(late[0].progress, 1)
  assert.equal(pointsForProgress(4, 0.5), 2)
  assert.equal(pointsForProgress(4, 0.01), 1)
  assert.equal(pointsForProgress(4, 1), 4)
  assert.equal(sessionEnd(ann, [{ start: 0, end: 7000, text: '' }]), 7000)
})

test('speech starting 1.2 s before a stroke attaches via the lead window', () => {
  const ann = [stroke(5000, 7000)]
  const seg = [{ start: 3800, end: 4600, text: '여기 색을 바꿔줘' }]
  const [a] = alignSegments(ann, seg)
  assert.equal(a.annotationIndex, 0)
  assert.equal(a.reason, 'proximity')
  assert.equal(a.source, 'auto')
  // without deictic text too
  const [b] = alignSegments(ann, [{ start: 3800, end: 4600, text: '색을 바꿔줘' }])
  assert.equal(b.annotationIndex, 0)
  assert.equal(b.reason, 'proximity')
})

test('speech starting 1.2 s after a stroke ends misses the 800 ms lag but a deictic phrase still attaches', () => {
  const ann = [stroke(1000, 3000)]
  const [plain] = alignSegments(ann, [{ start: 4200, end: 5000, text: '키워줘' }])
  assert.equal(plain.annotationIndex, null)
  assert.equal(plain.reason, 'global')
  const [deic] = alignSegments(ann, [{ start: 4200, end: 5000, text: '이거 키워줘' }])
  assert.equal(deic.annotationIndex, 0)
  assert.equal(deic.reason, 'deictic')
  assert.equal(deic.confidence, 0.35)
})

test('leadMs/lagMs are configurable and proximityMs is a symmetric deprecated alias', () => {
  const ann = [stroke(5000, 7000)]
  const seg = [{ start: 3800, end: 4400, text: '색' }]
  assert.equal(alignSegments(ann, seg, { leadMs: 500 })[0].annotationIndex, null)
  assert.equal(alignSegments(ann, seg, { proximityMs: 1500 })[0].annotationIndex, 0)
  const after = [{ start: 7900, end: 8500, text: '색' }]
  assert.equal(alignSegments(ann, after)[0].annotationIndex, null)
  assert.equal(alignSegments(ann, after, { proximityMs: 1500 })[0].annotationIndex, 0)
  assert.equal(alignSegments(ann, after, { proximityMs: 1500, lagMs: 100 })[0].annotationIndex, null)
})

test('manual override moves a segment to another annotation or forces global', () => {
  const ann = [stroke(1000, 3000), stroke(8000, 9000)]
  const seg = [
    { start: 1200, end: 2800, text: '이 버튼 작아' },
    { start: 1300, end: 2700, text: '여기 크게' }
  ]
  const auto = alignSegments(ann, seg)
  assert.equal(auto[0].annotationIndex, 0)
  const manual = new Map<number, number | null>([
    [0, 1],
    [1, null]
  ])
  const [m0, m1] = alignSegments(ann, seg, { manual })
  assert.equal(m0.annotationIndex, 1)
  assert.equal(m0.reason, 'manual')
  assert.equal(m0.source, 'manual')
  assert.equal(m0.confidence, 1)
  assert.equal(m0.score, 1)
  assert.equal(m1.annotationIndex, null)
  assert.equal(m1.reason, 'manual')
  assert.equal(m1.source, 'manual')
  assert.equal(m1.confidence, 1)
  assert.deepEqual(groupByAnnotation([m0, m1]).get(1), [0])
  assert.deepEqual(groupByAnnotation([m0, m1]).get(null), [1])
})

test('manual override with an out-of-range annotation index falls back to auto', () => {
  const ann = [stroke(1000, 3000)]
  const seg = [{ start: 1200, end: 2800, text: '이 버튼 작아' }]
  for (const bad of [5, -1, 1.5]) {
    const [a] = alignSegments(ann, seg, { manual: new Map([[0, bad]]) })
    assert.equal(a.annotationIndex, 0)
    assert.equal(a.source, 'auto')
    assert.equal(a.reason, 'overlap')
  }
})

test('confidence: fully covered segment beats a half covered one; deictic text adds a boost', () => {
  const ann = [stroke(5000, 7000)] // window 3500..7800
  const [full] = alignSegments(ann, [{ start: 5500, end: 6500, text: '크게' }])
  const [half] = alignSegments(ann, [{ start: 7300, end: 8300, text: '크게' }])
  assert.equal(full.confidence, 1)
  assert.equal(half.confidence, 0.5)
  assert.ok(full.confidence > half.confidence)
  assert.ok(full.score > half.score)
  assert.equal(half.reason, 'proximity')
  const [halfDeictic] = alignSegments(ann, [{ start: 7300, end: 8300, text: '이거 크게' }])
  assert.ok(Math.abs(halfDeictic.confidence - 0.7) < 1e-9)
  const [g] = alignSegments(ann, [{ start: 20000, end: 21000, text: '다크모드' }])
  assert.equal(g.confidence, 0)
})

test('no annotations at all: everything is global with confidence 1', () => {
  const out = alignSegments(
    [],
    [
      { start: 0, end: 1000, text: '전체적으로 다크모드' },
      { start: 1000, end: 2000, text: '이거 바꿔줘' }
    ]
  )
  for (const a of out) {
    assert.equal(a.annotationIndex, null)
    assert.equal(a.reason, 'global')
    assert.equal(a.confidence, 1)
    assert.equal(a.source, 'auto')
  }
})

test('nearestBoundary finds the closest value within the threshold', () => {
  const b = [1000, 3000, 3500, 9000]
  assert.equal(nearestBoundary(b, 1000, 0), 1000)
  assert.equal(nearestBoundary(b, 1100, 200), 1000)
  assert.equal(nearestBoundary(b, 3300, 300), 3500)
  assert.equal(nearestBoundary(b, 3200, 300), 3000)
  assert.equal(nearestBoundary(b, 8900, 150), 9000)
  assert.equal(nearestBoundary(b, 0, 1000), 1000)
  assert.equal(nearestBoundary(b, 99999, 100000), 9000)
  // misses
  assert.equal(nearestBoundary(b, 2000, 500), null)
  assert.equal(nearestBoundary(b, 1100, 99), null)
  assert.equal(nearestBoundary([], 100, 1000), null)
})

test('annotationBoundaries returns sorted unique tStart/tEnd values', () => {
  const ann = [stroke(5000, 7000), stroke(1000, 5000), text(1000, 'x')]
  assert.deepEqual(annotationBoundaries(ann), [1000, 1050, 5000, 7000])
  assert.deepEqual(annotationBoundaries([]), [])
})
