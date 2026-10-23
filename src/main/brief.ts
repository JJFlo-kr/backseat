import type { AgentTarget, Annotation, ExportPayload } from '../shared/types'

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
  const modeLabel = meta.mode === 'window' ? '창 캡처' : meta.mode === 'full' ? '전체 화면' : '영역 캡처'
  const what = meta.window ? ` "${meta.window.title}" (${meta.window.process})` : ''
  lines.push(
    `캡처: ${modeLabel}${what} · 디스플레이 ${meta.displayId}, 영역 (${meta.rectDip.x},${meta.rectDip.y}) ${meta.rectDip.width}×${meta.rectDip.height} DIP → ${meta.rectPx.width}×${meta.rectPx.height} px (scale ${meta.scaleFactor})`
  )
  if (meta.activeWindow) lines.push(`작업 중이던 창: "${meta.activeWindow.title}" (${meta.activeWindow.process})`)
  if (target) lines.push(`전송 대상: ${target.label}`)
  lines.push('')
  lines.push(`![capture](${imageFileName})`)
  lines.push('')
  if (memo) {
    lines.push('## 메모')
    lines.push(memo)
    lines.push('')
  }
  if (annotations.length > 0) {
    lines.push('## 주석 (그린 순서, 시간은 편집기 열린 시점 기준)')
    annotations.forEach((a, i) => lines.push(`${i + 1}. ${describe(a, i)}`))
    lines.push('')
  }
  lines.push('## 해석 가이드')
  lines.push('- 좌표는 이미지 픽셀 기준. 캡처된 화면의 UI 요소와 대응시켜 수정할 것.')
  lines.push('- 번호는 그린 순서. 텍스트/번호 주석은 그 위치의 요소에 대한 지시. 화살표는 "이것을 → 저기로" 또는 "여기를 봐".')
  lines.push('- 블러 영역은 민감정보를 가린 것이니 무시할 것.')
  return lines.join('\n') + '\n'
}
