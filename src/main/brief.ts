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

function describe(a: Annotation, i: number): string {
  const span = `[${fmtTime(a.tStart)}–${fmtTime(a.tEnd)}]`
  switch (a.kind) {
    case 'text':
      return `${badge(i)} 텍스트 "${a.text}" (${r(a.x)},${r(a.y)}) ${span}`
    case 'stroke': {
      const xs = a.points.map((p) => p.x)
      const ys = a.points.map((p) => p.y)
      return `${badge(i)} 펜 ${a.color} (${r(Math.min(...xs))},${r(Math.min(...ys))})-(${r(Math.max(...xs))},${r(Math.max(...ys))}) ${span}`
    }
    case 'arrow':
      return `${badge(i)} 화살표 (${r(a.x1)},${r(a.y1)}) → (${r(a.x2)},${r(a.y2)}) ${span}`
    case 'rect':
      return `${badge(i)} 사각형 (${r(a.x)},${r(a.y)}) ${r(a.w)}×${r(a.h)} ${span}`
    case 'badge':
      return `${badge(i)} 번호 ${a.n} (${r(a.x)},${r(a.y)}) ${span}`
    case 'blur':
      return `${badge(i)} 블러(가림) (${r(a.x)},${r(a.y)}) ${r(a.w)}×${r(a.h)} ${span}`
  }
}

/** Markdown brief that accompanies a saved capture. Image path is relative to the .md file. */
export function buildBrief(payload: ExportPayload, imageFileName: string, target: AgentTarget | null = null): string {
  const { meta, memo, annotations } = payload
  const lines: string[] = []
  lines.push(`# Backseat brief ${meta.capturedAt}`)
  lines.push('')
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
  if (meta.request) {
    lines.push('')
    lines.push(`## ${meta.request.agent || '에이전트'}의 질문에 대한 답`)
    lines.push(`> ${meta.request.question}`)
  }
  lines.push('')
  lines.push(`![capture](${imageFileName})`)
  lines.push('')
  if (memo) {
    lines.push('## 메모')
    lines.push(memo)
    lines.push('')
  }
  const transcript = payload.transcript
  const segments: Segment[] = transcript?.segments ?? []
  const assignments: Assignment[] =
    segments.length > 0
      ? alignSegments(annotations, segments, { manual: new Map((payload.links ?? []).map((l) => [l.segmentIndex, l.annotationIndex])) })
      : []
  const grouped = groupByAnnotation(assignments)
  const speechLine = (segIdx: number): string => {
    const s = segments[segIdx]
    const a = assignments[segIdx]
    const how = a.source === 'manual' ? '수동 연결' : `자동, 신뢰도 ${a.confidence.toFixed(2)}`
    return `   🗣 "${s.text}" [${fmtTime(s.start)}–${fmtTime(s.end)}] (${how})`
  }

  if (annotations.length > 0) {
    lines.push(segments.length > 0 ? '## 주석 ↔ 발화 (그린 순서, 시간은 편집기 열린 시점 기준)' : '## 주석 (그린 순서, 시간은 편집기 열린 시점 기준)')
    annotations.forEach((a, i) => {
      lines.push(`${i + 1}. ${describe(a, i)}`)
      for (const segIdx of grouped.get(i) ?? []) lines.push(speechLine(segIdx))
    })
    lines.push('')
  }
  const globals = grouped.get(null) ?? []
  if (globals.length > 0) {
    lines.push('## 전역 지시 (특정 주석과 무관한 발화)')
    for (const segIdx of globals) lines.push(`-${speechLine(segIdx).slice(2)}`)
    lines.push('')
  }
  if (transcript && transcript.text) {
    lines.push('## 전체 전사')
    lines.push(`"${transcript.text}" (${transcript.model}, ${(transcript.durationMs / 1000).toFixed(1)}초)`)
    lines.push('')
  }
  lines.push('## 해석 가이드')
  lines.push('- 좌표는 이미지 픽셀 기준. 캡처된 화면의 UI 요소와 대응시켜 수정할 것.')
  lines.push('- 번호는 그린 순서. 텍스트/번호 주석은 그 위치의 요소에 대한 지시. 화살표는 "이것을 → 저기로" 또는 "여기를 봐".')
  if (segments.length > 0) {
    lines.push('- 🗣 줄은 그 주석을 그리는 동안(또는 직전·직후) 말한 내용. 신뢰도가 낮으면 전역 지시일 수도 있음. "이거/여기"는 해당 주석 위치를 가리킴.')
    lines.push('- 전사는 자동 인식이라 숫자·고유명사가 틀릴 수 있음 (예: "1.5배"가 "1.5팩"으로).')
  }
  lines.push('- 블러 영역은 민감정보를 가린 것이니 무시할 것.')
  return lines.join('\n') + '\n'
}
