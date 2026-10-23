// Pure timeline logic shared by main, renderer and tests. No DOM, no Electron.
// All times are milliseconds since the editor session started (same clock as Annotation.tStart).
import type { Annotation } from './types.ts'

export interface Word {
  start: number
  end: number
  text: string
}

/** One transcribed utterance. */
export interface Segment {
  start: number
  end: number
  text: string
  words?: Word[]
}

export type AlignReason = 'overlap' | 'proximity' | 'deictic' | 'global' | 'manual'

export interface Assignment {
  segmentIndex: number
  /** null = global instruction, not tied to any annotation. */
  annotationIndex: number | null
  score: number
  reason: AlignReason
  /** 0..1 how sure the alignment is. */
  confidence: number
  /** 'manual' when the user overrode the automatic result. */
  source: 'auto' | 'manual'
}

export interface AlignOptions {
  /** How long (ms) before an annotation starts that speech may still belong to it. Default 1500. */
  leadMs?: number
  /** How long (ms) after an annotation ends that speech may still belong to it. Default 800. */
  lagMs?: number
  /** @deprecated Symmetric window; used for both leadMs and lagMs when those are not given. */
  proximityMs?: number
  /** Gap (ms) within which a deictic phrase ("이거", "here") is forced onto the nearest annotation. */
  deicticReachMs?: number
  deictic?: RegExp
  /** segmentIndex -> annotationIndex (null = force global). Overrides the automatic result. */
  manual?: ReadonlyMap<number, number | null>
}

export const DEFAULT_DEICTIC =
  /이거|이건|이걸|여기|저기|이쪽|저쪽|이 부분|이 버튼|이 글자|요거|요기|\bthis\b|\bhere\b|\bthat\b|\bthere\b/i

export interface Span {
  start: number
  end: number
}

export function overlapMs(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

/** Distance between two spans; 0 when they overlap. */
export function gapMs(a: Span, b: Span): number {
  if (overlapMs(a, b) > 0) return 0
  return a.end <= b.start ? b.start - a.end : a.start - b.end
}

export function annotationSpan(a: Annotation): Span {
  // Text notes are instantaneous for the user, but typing takes time; keep the real span
  // and guarantee a minimum width so overlap scoring still works.
  const end = Math.max(a.tEnd, a.tStart + 250)
  return { start: a.tStart, end }
}

/**
 * Attach each speech segment to the annotation the user was drawing while saying it.
 * People start talking a bit before they draw and keep talking a bit after, so each
 * annotation has an asymmetric window [tStart - leadMs, tEnd + lagMs]. A segment's score
 * for an annotation is its coverage by that window (plus deictic bonus and a closeness
 * tie-breaker); deictic phrases can still reach further; otherwise the segment is global.
 * Manual overrides win over everything.
 */
export function alignSegments(
  annotations: readonly Annotation[],
  segments: Segment[],
  opts: AlignOptions = {}
): Assignment[] {
  const lead = opts.leadMs ?? opts.proximityMs ?? 1500
  const lag = opts.lagMs ?? opts.proximityMs ?? 800
  const reach = opts.deicticReachMs ?? 5000
  const deictic = opts.deictic ?? DEFAULT_DEICTIC
  const spans = annotations.map(annotationSpan)
  const windows: Span[] = spans.map((s) => ({ start: s.start - lead, end: s.end + lag }))

  return segments.map((seg, segmentIndex): Assignment => {
    const manual = opts.manual?.get(segmentIndex)
    if (manual === null) {
      return { segmentIndex, annotationIndex: null, score: 1, reason: 'manual', confidence: 1, source: 'manual' }
    }
    if (manual !== undefined && Number.isInteger(manual) && manual >= 0 && manual < spans.length) {
      return { segmentIndex, annotationIndex: manual, score: 1, reason: 'manual', confidence: 1, source: 'manual' }
    }

    deictic.lastIndex = 0
    const isDeictic = deictic.test(seg.text)
    const dur = Math.max(1, seg.end - seg.start)

    let best: { index: number; score: number; coverage: number } | null = null
    let nearest: { index: number; gap: number } | null = null

    spans.forEach((span, index) => {
      const gap = gapMs(seg, span)
      if (nearest === null || gap < nearest.gap) nearest = { index, gap }
      const coverage = Math.min(1, overlapMs(seg, windows[index]) / dur)
      if (coverage <= 0) return
      const score = coverage + (isDeictic ? 0.3 : 0) + 0.1 / (1 + gap / 1000)
      if (best === null || score > best.score) best = { index, score, coverage }
    })

    if (best !== null) {
      const b: { index: number; score: number; coverage: number } = best
      const onRaw = overlapMs(seg, spans[b.index]) > 0
      return {
        segmentIndex,
        annotationIndex: b.index,
        score: b.score,
        reason: onRaw ? 'overlap' : 'proximity',
        confidence: Math.min(1, b.coverage + (isDeictic ? 0.2 : 0)),
        source: 'auto'
      }
    }

    if (nearest !== null && isDeictic) {
      const n: { index: number; gap: number } = nearest
      if (n.gap <= reach) {
        return { segmentIndex, annotationIndex: n.index, score: 1, reason: 'deictic', confidence: 0.35, source: 'auto' }
      }
    }
    return {
      segmentIndex,
      annotationIndex: null,
      score: 0,
      reason: 'global',
      confidence: spans.length === 0 ? 1 : 0,
      source: 'auto'
    }
  })
}

/** Sorted unique tStart/tEnd values of all annotations, for snapping on the timeline. */
export function annotationBoundaries(annotations: readonly Annotation[]): number[] {
  const set = new Set<number>()
  for (const a of annotations) {
    set.add(a.tStart)
    set.add(a.tEnd)
  }
  return [...set].sort((x, y) => x - y)
}

/**
 * Closest value to t in a SORTED array, if within thresholdMs (inclusive); otherwise null.
 * On an exact tie the earlier boundary wins.
 */
export function nearestBoundary(boundaries: number[], t: number, thresholdMs: number): number | null {
  let lo = 0
  let hi = boundaries.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (boundaries[mid] < t) lo = mid + 1
    else hi = mid
  }
  let best: number | null = null
  let bestDist = Infinity
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= boundaries.length) continue
    const d = Math.abs(boundaries[i] - t)
    if (d < bestDist) {
      best = boundaries[i]
      bestDist = d
    }
  }
  return best !== null && bestDist <= thresholdMs ? best : null
}

/** Segments grouped per annotation index (and the global ones under null). */
export function groupByAnnotation(assignments: Assignment[]): Map<number | null, number[]> {
  const out = new Map<number | null, number[]>()
  for (const a of assignments) {
    const list = out.get(a.annotationIndex) ?? []
    list.push(a.segmentIndex)
    out.set(a.annotationIndex, list)
  }
  return out
}

export interface ReplayItem {
  index: number
  annotation: Annotation
  /** 0..1 fraction of the annotation drawn at time t. */
  progress: number
}

/**
 * Which annotations are visible at time t, and how far along each one is.
 * Used by the editor's scrubber and by GIF export; strokes without per-point
 * timestamps are interpolated linearly between tStart and tEnd.
 */
export function replayAt(annotations: readonly Annotation[], t: number): ReplayItem[] {
  const out: ReplayItem[] = []
  annotations.forEach((annotation, index) => {
    if (t < annotation.tStart) return
    const dur = Math.max(1, annotation.tEnd - annotation.tStart)
    const progress = Math.min(1, (t - annotation.tStart) / dur)
    out.push({ index, annotation, progress })
  })
  return out
}

/** Number of stroke points to draw for a given progress. */
export function pointsForProgress(total: number, progress: number): number {
  if (total === 0) return 0
  if (progress >= 1) return total
  return Math.max(1, Math.round(total * progress))
}

/** End of the session on the shared clock: last annotation or segment end. */
export function sessionEnd(annotations: readonly Annotation[], segments: Segment[] = []): number {
  let end = 0
  for (const a of annotations) end = Math.max(end, a.tEnd)
  for (const s of segments) end = Math.max(end, s.end)
  return end
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, ms) / 1000
  const m = Math.floor(s / 60)
  const rest = (s - m * 60).toFixed(1).padStart(4, '0')
  return `${String(m).padStart(2, '0')}:${rest}`
}
