import type { Annotation, ExportPayload } from '../shared/types'

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

function describe(a: Annotation, i: number): string {
  const span = `[${fmtTime(a.tStart)}–${fmtTime(a.tEnd)}]`
  if (a.kind === 'text') {
    return `${badge(i)} 텍스트 "${a.text}" (${Math.round(a.x)},${Math.round(a.y)}) ${span}`
  }
  const xs = a.points.map((p) => p.x)
  const ys = a.points.map((p) => p.y)
  const x0 = Math.round(Math.min(...xs))
  const y0 = Math.round(Math.min(...ys))
  const x1 = Math.round(Math.max(...xs))
  const y1 = Math.round(Math.max(...ys))
  return `${badge(i)} 펜 ${a.color} (${x0},${y0})-(${x1},${y1}) ${span}`
}

/** Markdown brief that accompanies a saved capture. Image path is relative to the .md file. */
export function buildBrief(payload: ExportPayload, imageFileName: string): string {
  const { meta, memo, annotations } = payload
  const lines: string[] = []
  lines.push(`# Backseat brief ${meta.capturedAt}`)
  lines.push('')
  lines.push(
    `캡처: 디스플레이 ${meta.displayId}, 영역 (${meta.rectDip.x},${meta.rectDip.y}) ${meta.rectDip.width}×${meta.rectDip.height} DIP → ${meta.rectPx.width}×${meta.rectPx.height} px (scale ${meta.scaleFactor})`
  )
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
  lines.push('- 번호는 그린 순서. 텍스트 주석은 그 위치의 요소에 대한 지시.')
  return lines.join('\n') + '\n'
}
