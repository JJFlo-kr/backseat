import type { AgentTarget, Annotation, ExportPayload, Segment } from '../shared/types'
import { alignSegments, groupByAnnotation, type Assignment } from '../shared/align'

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

/** Compact style note for text that deviates from the plain look, e.g. "(굵게·기울임)"; empty by default. */
function textStyleNote(a: Extract<Annotation, { kind: 'text' }>): string {
  const parts: string[] = []
  if (a.bold === true) parts.push('굵게')
  else if (a.bold === false) parts.push('보통 굵기')
  if (a.italic) parts.push('기울임')
  if (a.shadow) parts.push('그림자')
  return parts.length ? `(${parts.join('·')})` : ''
}

function describe(a: Annotation, i: number, withColor: boolean, withSpan: boolean): string {
  const span = withSpan ? ` [${fmtTime(a.tStart)}–${fmtTime(a.tEnd)}]` : ''
  const color = (c: string): string => (withColor ? ` ${c}` : '')
  switch (a.kind) {
    case 'text':
      return `${badge(i)} 텍스트${textStyleNote(a)} "${oneLine(a.text)}" @(${r(a.x)},${r(a.y)})${span}`
    case 'stroke': {
      const xs = a.points.map((p) => p.x)
      const ys = a.points.map((p) => p.y)
      return `${badge(i)} 펜${color(a.color)} (${r(Math.min(...xs))},${r(Math.min(...ys))})-(${r(Math.max(...xs))},${r(Math.max(...ys))})${span}`
    }
    case 'arrow':
      return `${badge(i)} 화살표${color(a.color)} (${r(a.x1)},${r(a.y1)}) → (${r(a.x2)},${r(a.y2)})${span}`
    case 'rect':
      return `${badge(i)} 사각형${color(a.color)} (${r(a.x)},${r(a.y)}) ${r(a.w)}×${r(a.h)}${span}`
    case 'badge':
      return `${badge(i)} 번호 ${a.n} @(${r(a.x)},${r(a.y)})${span}`
    case 'blur':
      return `${badge(i)} 블러(가림) (${r(a.x)},${r(a.y)}) ${r(a.w)}×${r(a.h)}${span}`
  }
}

export interface BriefOptions {
  /** File name (next to brief.md) of the capture without annotations; omit when the package has none. */
  screenshotFileName?: string
}

/** Markdown brief that accompanies a saved capture. Image path is relative to the .md file. */
export function buildBrief(
  payload: ExportPayload,
  imageFileName: string,
  target: AgentTarget | null = null,
  options: BriefOptions = {}
): string {
  const { meta, memo, annotations } = payload
  const shot = options.screenshotFileName
  const lines: string[] = []
  lines.push(`# Backseat brief ${meta.capturedAt}`)
  lines.push(
    `> 주의: annotated.png = 원래 화면 + 사용자가 Backseat로 그린 주석. 빨간(또는 선택한 색) 선·화살표·사각형, 보라 테두리 번호 원, 왼쪽 위에 보라 "B" 표시가 붙은 글자는 모두 사용자가 추가한 것이며 원래 화면에는 없다.${shot ? ` 원래 화면은 ${shot}.` : ''}`
  )
  const modeLabel =
    meta.mode === 'window' ? '창 캡처' : meta.mode === 'full' ? '전체 화면' : meta.mode === 'scroll' ? '스크롤 캡처' : '영역 캡처'
  const what = meta.window ? ` "${meta.window.title}" (${meta.window.process})` : ''
  const scroll = meta.scroll ? ` · ${meta.scroll.frames}장 이어붙임 (화면 높이 ${meta.scroll.viewportPx} px)` : ''
  lines.push(
    `캡처: ${modeLabel}${what} · 디스플레이 ${meta.displayId}, 영역 (${meta.rectDip.x},${meta.rectDip.y}) ${meta.rectDip.width}×${meta.rectDip.height} DIP → ${meta.rectPx.width}×${meta.rectPx.height} px (scale ${meta.scaleFactor})${scroll}`
  )
  if (meta.crop) {
    lines.push(`자르기: 원본 캡처의 (${r(meta.crop.x)},${r(meta.crop.y)}) ${r(meta.crop.width)}×${r(meta.crop.height)} px만 남김 · 아래 좌표는 모두 잘린 이미지 기준`)
  }
  if (meta.activeWindow) lines.push(`작업 중이던 창: "${meta.activeWindow.title}" (${meta.activeWindow.process})`)
  if (target) lines.push(`전송 대상: ${target.label}`)
  if (payload.compare) {
    const c = payload.compare
    const id = c.sessionDir.split(/[\\/]/).filter(Boolean).pop() ?? c.sessionDir
    const mode = c.mode === 'overlay' ? '겹치기' : c.mode === 'wipe' ? '와이프' : '차이'
    lines.push(`이전 캡처와 비교: 세션 ${id} (annotated.png) · ${mode} 모드 · 달라진 픽셀 ${c.diffPercent}%`)
  }
  const transcript = payload.transcript
  if (transcript) {
    lines.push(`음성: ${(transcript.durationMs / 1000).toFixed(1)}초, ${transcript.model} · 전문은 transcript.json`)
  }
  if (meta.request) {
    lines.push('')
    lines.push(`## ${meta.request.agent || '에이전트'}의 질문에 대한 답`)
    lines.push(`> ${oneLine(meta.request.question)}`)
  }
  lines.push('')
  lines.push(`![annotated](${imageFileName})`)
  if (shot) lines.push(`원본(주석 없음): ${shot}`)
  lines.push('')
  if (memo) {
    lines.push('## 메모')
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
    const how = a.source === 'manual' ? '수동 연결' : `자동 ${a.confidence.toFixed(2)}`
    return `🗣 "${oneLine(s.text)}" [${fmtTime(s.start)}–${fmtTime(s.end)}] (${how})`
  }

  if (annotations.length > 0) {
    const withColor = lineColors(annotations).size > 1
    lines.push('## Backseat 주석(사용자 추가) — 그린 순서')
    annotations.forEach((a, i) => {
      lines.push(`${i + 1}. ${describe(a, i, withColor, hasSpeech)}`)
      for (const segIdx of grouped.get(i) ?? []) lines.push(`   ${speechLine(segIdx)}`)
    })
    lines.push('')
  }
  const globals = grouped.get(null) ?? []
  if (globals.length > 0) {
    lines.push('## 전역 지시 (특정 주석과 무관한 발화)')
    for (const segIdx of globals) lines.push(`- ${speechLine(segIdx)}`)
    lines.push('')
  }
  lines.push('## 해석')
  lines.push('- 좌표는 annotated.png 픽셀. 번호는 그린 순서, 텍스트·번호는 그 위치 요소에 대한 지시, 화살표는 "이것 → 저기".')
  if (hasSpeech) {
    lines.push('- 🗣는 그 주석을 그리며 한 말. "이거/여기"는 그 주석 위치. 자동 전사라 숫자·고유명사가 틀릴 수 있음.')
  }
  if (annotations.some((a) => a.kind === 'blur')) {
    lines.push('- 블러는 민감정보를 가린 것.')
  }
  return lines.join('\n') + '\n'
}
