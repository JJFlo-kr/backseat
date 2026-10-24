import type { AgentTarget, Annotation, ExportPayload, Segment } from '../shared/types.ts'
import { alignSegments, groupByAnnotation, type Assignment } from '../shared/align.ts'
import { t, type Translate } from '../shared/i18n.ts'

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

function badge(i: number): string {
  return i < CIRCLED.length ? CIRCLED[i] : `(${i + 1})`
}

function fmtTime(ms: number): string {
  const s = ms / 1000
  const m = Math.floor(s / 60)
  const rest = (s - m * 60).toFixed(1).padStart(4, '0')
  return `${String(m).padStart(2, '0')}:${rest}`
}

const r = Math.round

/** Keep every annotation / speech item on a single markdown line. */
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' / ')
}

/** Distinct colors among the line-like annotations (strokes, arrows, rects). */
function lineColors(annotations: Annotation[]): Set<string> {
  const colors = new Set<string>()
  for (const a of annotations) {
    if (a.kind === 'stroke' || a.kind === 'arrow' || a.kind === 'rect') colors.add(a.color.toLowerCase())
  }
  return colors
}

/** Compact style note for text that deviates from the plain look, e.g. "(bold·italic)"; empty by default. */
function textStyleNote(a: Extract<Annotation, { kind: 'text' }>, tr: Translate): string {
  const parts: string[] = []
  if (a.bold === true) parts.push(tr('brief.textStyle.bold'))
  else if (a.bold === false) parts.push(tr('brief.textStyle.normal'))
  if (a.italic) parts.push(tr('brief.textStyle.italic'))
  if (a.shadow) parts.push(tr('brief.textStyle.shadow'))
  return parts.length ? `(${parts.join('·')})` : ''
}

function describe(a: Annotation, i: number, withColor: boolean, withSpan: boolean, tr: Translate): string {
  const span = withSpan ? ` [${fmtTime(a.tStart)}–${fmtTime(a.tEnd)}]` : ''
  const color = (c: string): string => (withColor ? ` ${c}` : '')
  switch (a.kind) {
    case 'text':
      return `${badge(i)} ${tr('brief.annotation.text')}${textStyleNote(a, tr)} "${oneLine(a.text)}" @(${r(a.x)},${r(a.y)})${span}`
    case 'stroke': {
      const xs = a.points.map((p) => p.x)
      const ys = a.points.map((p) => p.y)
      return `${badge(i)} ${tr('brief.annotation.pen')}${color(a.color)} (${r(Math.min(...xs))},${r(Math.min(...ys))})-(${r(Math.max(...xs))},${r(Math.max(...ys))})${span}`
    }
    case 'arrow':
      return `${badge(i)} ${tr('brief.annotation.arrow')}${color(a.color)} (${r(a.x1)},${r(a.y1)}) → (${r(a.x2)},${r(a.y2)})${span}`
    case 'rect':
      return `${badge(i)} ${tr('brief.annotation.rect')}${color(a.color)} (${r(a.x)},${r(a.y)}) ${r(a.w)}×${r(a.h)}${span}`
    case 'badge':
      return `${badge(i)} ${tr('brief.annotation.number', { n: a.n })} @(${r(a.x)},${r(a.y)})${span}`
    case 'blur':
      return `${badge(i)} ${tr('brief.annotation.blur')} (${r(a.x)},${r(a.y)}) ${r(a.w)}×${r(a.h)}${span}`
  }
}

export interface BriefOptions {
  /** File name (next to brief.md) of the capture without annotations; omit when the package has none. */
  screenshotFileName?: string
  /** Translator for the brief's language (main passes briefTranslator()); defaults to the global t(). */
  t?: Translate
}

/** Markdown brief that accompanies a saved capture. Image path is relative to the .md file. */
export function buildBrief(
  payload: ExportPayload,
  imageFileName: string,
  target: AgentTarget | null = null,
  options: BriefOptions = {}
): string {
  const { meta, memo, annotations } = payload
  const tr = options.t ?? t
  const shot = options.screenshotFileName
  const lines: string[] = []
  lines.push(`# Backseat brief ${meta.capturedAt}`)
  lines.push(`> ${tr('brief.notice')}${shot ? ` ${tr('brief.notice.original', { file: shot })}` : ''}`)
  const modeLabel = tr(`brief.mode.${meta.mode === 'window' ? 'window' : meta.mode === 'full' ? 'full' : meta.mode === 'scroll' ? 'scroll' : 'region'}`)
  const what = meta.window ? ` "${meta.window.title}" (${meta.window.process})` : ''
  const scroll = meta.scroll ? ` · ${tr('brief.scroll', { n: meta.scroll.frames, viewport: meta.scroll.viewportPx })}` : ''
  lines.push(
    tr('brief.capture', {
      mode: modeLabel,
      what,
      display: meta.displayId,
      x: meta.rectDip.x,
      y: meta.rectDip.y,
      w: meta.rectDip.width,
      h: meta.rectDip.height,
      pw: meta.rectPx.width,
      ph: meta.rectPx.height,
      scale: meta.scaleFactor,
      scroll
    })
  )
  if (meta.crop) {
    lines.push(tr('brief.crop', { x: r(meta.crop.x), y: r(meta.crop.y), w: r(meta.crop.width), h: r(meta.crop.height) }))
  }
  if (meta.activeWindow) lines.push(tr('brief.activeWindow', { title: meta.activeWindow.title, process: meta.activeWindow.process }))
  if (target) lines.push(tr('brief.target', { label: target.label }))
  if (payload.compare) {
    const c = payload.compare
    const id = c.sessionDir.split(/[\\/]/).filter(Boolean).pop() ?? c.sessionDir
    const mode = tr(`brief.compare.${c.mode === 'overlay' ? 'overlay' : c.mode === 'wipe' ? 'wipe' : 'diff'}`)
    lines.push(tr('brief.compare', { id, mode, percent: c.diffPercent }))
  }
  const transcript = payload.transcript
  if (transcript) {
    lines.push(tr('brief.voice', { seconds: (transcript.durationMs / 1000).toFixed(1), model: transcript.model }))
  }
  if (meta.request) {
    lines.push('')
    lines.push(`## ${tr('brief.request.title', { agent: meta.request.agent || tr('brief.request.agentFallback') })}`)
    lines.push(`> ${oneLine(meta.request.question)}`)
  }
  lines.push('')
  lines.push(`![annotated](${imageFileName})`)
  if (shot) lines.push(tr('brief.original', { file: shot }))
  lines.push('')
  if (memo) {
    lines.push(`## ${tr('brief.memo.heading')}`)
    lines.push(memo)
    lines.push('')
  }
  const segments: Segment[] = transcript?.segments ?? []
  const hasSpeech = segments.length > 0
  const assignments: Assignment[] = hasSpeech
    ? alignSegments(annotations, segments, { manual: new Map((payload.links ?? []).map((l) => [l.segmentIndex, l.annotationIndex])) })
    : []
  const grouped = groupByAnnotation(assignments)
  const speechLine = (segIdx: number): string => {
    const s = segments[segIdx]
    const a = assignments[segIdx]
    const how = a.source === 'manual' ? tr('brief.speech.manual') : tr('brief.speech.auto', { confidence: a.confidence.toFixed(2) })
    return `🗣 "${oneLine(s.text)}" [${fmtTime(s.start)}–${fmtTime(s.end)}] (${how})`
  }

  if (annotations.length > 0) {
    const withColor = lineColors(annotations).size > 1
    lines.push(`## ${tr('brief.annotations.heading')}`)
    annotations.forEach((a, i) => {
      lines.push(`${i + 1}. ${describe(a, i, withColor, hasSpeech, tr)}`)
      for (const segIdx of grouped.get(i) ?? []) lines.push(`   ${speechLine(segIdx)}`)
    })
    lines.push('')
  }
  const globals = grouped.get(null) ?? []
  if (globals.length > 0) {
    lines.push(`## ${tr('brief.globals.heading')}`)
    for (const segIdx of globals) lines.push(`- ${speechLine(segIdx)}`)
    lines.push('')
  }
  lines.push(`## ${tr('brief.interp.heading')}`)
  lines.push(`- ${tr('brief.interp.coords')}`)
  if (hasSpeech) {
    lines.push(`- ${tr('brief.interp.speech')}`)
  }
  if (annotations.some((a) => a.kind === 'blur')) {
    lines.push(`- ${tr('brief.interp.blur')}`)
  }
  return lines.join('\n') + '\n'
}
