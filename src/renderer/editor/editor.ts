import type {
  EditorInit, ExportPayload, Annotation, AgentTarget, Point, Transcript, Rect, CompareMode, CaptureMeta
} from '../../shared/types'
import { pointsForProgress, sessionEnd } from '../../shared/align'
import { History } from './history'
import { Hotkeys } from './hotkeys'
import { Timeline } from './timeline'

type Tool = 'pen' | 'text' | 'arrow' | 'rect' | 'badge' | 'blur' | 'crop'
type DragTool = 'arrow' | 'rect' | 'badge' | 'blur'
type StrokeAnn = Extract<Annotation, { kind: 'stroke' }>
type ArrowAnn = Extract<Annotation, { kind: 'arrow' }>
type RectAnn = Extract<Annotation, { kind: 'rect' }>
type BadgeAnn = Extract<Annotation, { kind: 'badge' }>
type BlurAnn = Extract<Annotation, { kind: 'blur' }>

const TEXT_SIZE = 18 // CSS px; scaled by meta.scaleFactor into image pixels
const BADGE_SIZE = 22 // CSS px diameter
const BLUR_BLOCK = 14 // CSS px per pixelation block
const MIN_DRAG = 3 // image px
const SEND_CLOSE_DELAY = 700 // ms the status stays visible before the editor closes
const AUDIO_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

/** The whole undoable document: drawings, manual speech-to-annotation links and the crop. */
interface Doc {
  annotations: readonly Annotation[]
  /** segmentIndex -> annotationIndex (null = forced global). Absent = automatic alignment. */
  links: ReadonlyMap<number, number | null>
  /** Visible region in px of the ORIGINAL capture. Annotation coordinates are relative to it. */
  crop: Rect
}

function isTool(v: string | undefined): v is Tool {
  return v === 'pen' || v === 'text' || v === 'arrow' || v === 'rect' || v === 'badge' || v === 'blur' || v === 'crop'
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el as T
}
function ctxOf(c: HTMLCanvasElement, readsOften = false): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', readsOften ? { willReadFrequently: true } : undefined)
  if (!ctx) throw new Error('2D canvas unavailable')
  return ctx
}

const stage = byId<HTMLElement>('stage')
const wrap = byId<HTMLDivElement>('wrap')
const base = byId<HTMLCanvasElement>('base')
const cmp = byId<HTMLCanvasElement>('cmp') // before/after layer between the image and the ink
const ink = byId<HTMLCanvasElement>('ink')
const compareBar = byId<HTMLElement>('comparebar')
const compareBtn = byId<HTMLButtonElement>('compare-toggle')
const compareModeBtns = document.querySelectorAll<HTMLButtonElement>('[data-cmp-mode]')
const opacityInput = byId<HTMLInputElement>('cmp-opacity')
const wipeInput = byId<HTMLInputElement>('cmp-wipe')
const diffLabel = byId<HTMLElement>('cmp-diff')
const cmpCtx = ctxOf(cmp, true)
const memoInput = byId<HTMLInputElement>('memo')
const statusEl = byId<HTMLElement>('status')
const targetBar = byId<HTMLElement>('targetbar')
const undoBtn = byId<HTMLButtonElement>('undo')
const redoBtn = byId<HTMLButtonElement>('redo')
const timelineBtn = byId<HTMLButtonElement>('timeline-toggle')
const micBtn = byId<HTMLButtonElement>('mic')
const player = byId<HTMLAudioElement>('player')
const baseCtx = ctxOf(base, true) // blur and the compare diff read it back
const inkCtx = ctxOf(ink)
const toolBtns = document.querySelectorAll<HTMLButtonElement>('[data-tool]')
const colorBtns = document.querySelectorAll<HTMLButtonElement>('[data-color]')
const widthBtns = document.querySelectorAll<HTMLButtonElement>('[data-width]')

let started = false // init received (guards double init)
let init: EditorInit | null = null // set once the image is drawn
let t0 = 0
let tool: Tool = 'pen'
let color = '#E5484D'
let widthCss = 3
let view = 1 // displayed size / natural on-screen size
let doc: Doc = { annotations: [], links: new Map(), crop: { x: 0, y: 0, width: 0, height: 0 } }
let annotations: readonly Annotation[] = doc.annotations
let links: ReadonlyMap<number, number | null> = doc.links
let crop: Rect = doc.crop // mirrors doc.crop; the canvases are exactly this big
let orig: HTMLImageElement | null = null // the untouched capture; crops re-blit from it
const history = new History<Doc>(100)
let drawing: StrokeAnn | null = null
/** In-progress drag of an arrow / rect / badge / blur. */
let shape: { tool: DragTool; start: Point; cur: Point; tStart: number } | null = null
/** In-progress crop drag (image px). */
let cropDrag: { start: Point; cur: Point } | null = null
/** Debug/self-test: how many pointer events the ink canvas saw. */
const pointerCounts = { down: 0, move: 0, up: 0, cancel: 0 }

// before/after comparison against the previous capture of the same region
let compareImg: HTMLImageElement | null = null
let compareDir = ''
let cmpOn = false
let cmpUsed = false // the user looked at the comparison at least once -> noted in brief.md
let cmpMode: CompareMode = 'overlay'
let cmpOpacity = 0.5
let cmpWipe = 0.5
let diffCache: number | null = null
let textBox: HTMLInputElement | null = null
let busy = false
let pinned = false // small always-on-top reference window; 전송 no longer closes it
let scrubT: number | null = null // non-null while the timeline is scrubbed/replaying

async function togglePin(): Promise<void> {
  try {
    pinned = await window.backseat.editor.pin()
    document.body.classList.toggle('pinned', pinned)
    setStatus(pinned ? '고정됨: 항상 위에 떠 있고 전송 후에도 남습니다 (Ctrl+P 해제)' : '고정 해제')
    layout()
  } catch (err) {
    setStatus(`고정 실패: ${err instanceof Error ? err.message : String(err)}`, true)
  }
}

// voice: the finished recording (replaces any previous one) and its transcript
let transcript: Transcript | null = null
let audioBytes: Uint8Array | null = null
let audioMime = ''
let audioUrl: string | null = null
let audioStartMs = 0 // editor-clock time of the recording's first sample
let audioDurationMs = 0

const now = (): number => performance.now() - t0

function setStatus(msg: string, isError = false): void {
  statusEl.textContent = msg
  statusEl.title = msg
  statusEl.classList.toggle('error', isError)
}

// ---------- rendering ----------

function applyStroke(ctx: CanvasRenderingContext2D, a: StrokeAnn): void {
  ctx.strokeStyle = a.color
  ctx.lineWidth = a.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

function drawText(ctx: CanvasRenderingContext2D, a: Extract<Annotation, { kind: 'text' }>): void {
  ctx.font = `bold ${a.fontSize}px system-ui, "Malgun Gothic", sans-serif`
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(3, a.fontSize / 6)
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'
  ctx.strokeText(a.text, a.x, a.y)
  ctx.fillStyle = a.color
  ctx.fillText(a.text, a.x, a.y)
}

/** Draw the first `count` points of a stroke (all when undefined). */
function drawStroke(ctx: CanvasRenderingContext2D, a: StrokeAnn, count?: number): void {
  const n = count === undefined ? a.points.length : Math.min(count, a.points.length)
  if (n <= 0) return
  applyStroke(ctx, a)
  ctx.beginPath()
  ctx.moveTo(a.points[0].x, a.points[0].y)
  if (n === 1) ctx.lineTo(a.points[0].x, a.points[0].y) // single click -> dot
  for (let i = 1; i < n; i++) ctx.lineTo(a.points[i].x, a.points[i].y)
  ctx.stroke()
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** 0 before tStart, 1 from tEnd on, linear in between. */
function progressAt(a: { tStart: number; tEnd: number }, t: number): number {
  if (t < a.tStart) return 0
  if (a.tEnd <= a.tStart) return 1
  return clamp01((t - a.tStart) / (a.tEnd - a.tStart))
}

function drawArrow(ctx: CanvasRenderingContext2D, a: ArrowAnn, x2 = a.x2, y2 = a.y2): void {
  const dx = x2 - a.x1
  const dy = y2 - a.y1
  const len = Math.hypot(dx, dy)
  if (len < 0.5) return
  const ux = dx / len
  const uy = dy / len
  const head = Math.min(len, a.width * 4 + 8)
  const bx = x2 - ux * head // base centre of the head
  const by = y2 - uy * head
  const half = head * 0.42
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  ctx.lineWidth = a.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(a.x1, a.y1)
  ctx.lineTo(bx + ux * head * 0.3, by + uy * head * 0.3) // tuck the line under the head
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(bx - uy * half, by + ux * half)
  ctx.lineTo(bx + uy * half, by - ux * half)
  ctx.closePath()
  ctx.fill()
}

function drawRect(ctx: CanvasRenderingContext2D, a: RectAnn, w = a.w, h = a.h): void {
  ctx.strokeStyle = a.color
  ctx.lineWidth = a.width
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.roundRect(a.x, a.y, w, h, 3)
  ctx.stroke()
}

function drawBadge(ctx: CanvasRenderingContext2D, a: BadgeAnn, no: number): void {
  const r = a.size / 2
  ctx.beginPath()
  ctx.arc(a.x, a.y, r, 0, Math.PI * 2)
  ctx.fillStyle = a.color
  ctx.fill()
  ctx.lineWidth = Math.max(1, a.size / 16)
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${Math.round(a.size * 0.58)}px system-ui, "Malgun Gothic", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(no), a.x, a.y + a.size * 0.04)
  ctx.textAlign = 'start'
}

/** Pixelate the base image inside the box with opaque average-colour blocks. */
function drawBlur(ctx: CanvasRenderingContext2D, a: BlurAnn): void {
  const x0 = Math.max(0, Math.floor(a.x))
  const y0 = Math.max(0, Math.floor(a.y))
  const x1 = Math.min(base.width, Math.ceil(a.x + a.w))
  const y1 = Math.min(base.height, Math.ceil(a.y + a.h))
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return
  const data = baseCtx.getImageData(x0, y0, w, h).data
  const bs = Math.max(2, Math.round(a.strength))
  for (let by = 0; by < h; by += bs) {
    for (let bx = 0; bx < w; bx += bs) {
      const ex = Math.min(w, bx + bs)
      const ey = Math.min(h, by + bs)
      let r = 0
      let g = 0
      let b = 0
      for (let y = by; y < ey; y++) {
        let i = (y * w + bx) * 4
        for (let x = bx; x < ex; x++, i += 4) {
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
        }
      }
      const n = (ex - bx) * (ey - by)
      ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`
      ctx.fillRect(x0 + bx, y0 + by, ex - bx, ey - by)
    }
  }
}

/** `no` = display number for badges (position among badges); falls back to the stored n. */
function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, no?: number): void {
  switch (a.kind) {
    case 'stroke': drawStroke(ctx, a); break
    case 'text': drawText(ctx, a); break
    case 'arrow': drawArrow(ctx, a); break
    case 'rect': drawRect(ctx, a); break
    case 'badge': drawBadge(ctx, a, no ?? a.n); break
    case 'blur': drawBlur(ctx, a); break
  }
}

/** How many points of a stroke existed at time t. */
function pointsAt(a: StrokeAnn, t: number): number {
  if (t < a.tStart) return 0
  if (a.times && a.times.length === a.points.length) {
    let n = 0
    while (n < a.times.length && a.times[n] <= t) n++
    return Math.max(1, n)
  }
  const progress = (t - a.tStart) / Math.max(1, a.tEnd - a.tStart)
  return pointsForProgress(a.points.length, progress)
}

/** The scene as it looked at time t: the heart of scrubbing, replay and video export. */
function drawAnnotationAt(ctx: CanvasRenderingContext2D, a: Annotation, t: number, no?: number): void {
  switch (a.kind) {
    case 'text':
    case 'badge':
    case 'blur':
      if (t >= a.tEnd) drawAnnotation(ctx, a, no)
      return
    case 'arrow': {
      if (t < a.tStart) return
      const p = progressAt(a, t)
      drawArrow(ctx, a, a.x1 + (a.x2 - a.x1) * p, a.y1 + (a.y2 - a.y1) * p)
      return
    }
    case 'rect': {
      if (t < a.tStart) return
      const p = progressAt(a, t)
      drawRect(ctx, a, a.w * p, a.h * p)
      return
    }
    case 'stroke':
      drawStroke(ctx, a, pointsAt(a, t))
  }
}

/** Draw the whole document: live (t = null) or as it looked at time t. Badges are numbered by array order. */
function drawAll(ctx: CanvasRenderingContext2D, t: number | null): void {
  let badgeNo = 0
  for (const a of annotations) {
    const no = a.kind === 'badge' ? ++badgeNo : undefined
    if (t === null) drawAnnotation(ctx, a, no)
    else drawAnnotationAt(ctx, a, t, no)
  }
}

function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

function render(): void {
  inkCtx.clearRect(0, 0, ink.width, ink.height)
  drawAll(inkCtx, scrubT)
  if (shape && init) {
    const prev = buildShape(shape.tool, shape.start, shape.cur, shape.tStart, now(), init.meta.scaleFactor, true)
    if (prev) drawAnnotation(inkCtx, prev, prev.kind === 'badge' ? prev.n : undefined)
  }
  if (cropDrag && init) {
    // Dim everything outside the future crop; dashed outline on it.
    const r = normRect(cropDrag.start, cropDrag.cur)
    inkCtx.save()
    inkCtx.fillStyle = 'rgba(0,0,0,0.55)'
    inkCtx.beginPath()
    inkCtx.rect(0, 0, ink.width, ink.height)
    inkCtx.rect(r.x, r.y, r.width, r.height)
    inkCtx.fill('evenodd')
    inkCtx.strokeStyle = '#fff'
    inkCtx.lineWidth = Math.max(1, init.meta.scaleFactor)
    inkCtx.setLineDash([6 * init.meta.scaleFactor, 4 * init.meta.scaleFactor])
    inkCtx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height)
    inkCtx.restore()
  }
}

function layout(): void {
  if (!init || base.width === 0) return
  const cssW = base.width / init.meta.scaleFactor
  const cssH = base.height / init.meta.scaleFactor
  const availW = Math.max(50, stage.clientWidth - 32 - 2)
  const availH = Math.max(50, stage.clientHeight - 32 - 2)
  view = Math.min(1, availW / cssW, availH / cssH)
  for (const c of [base, cmp, ink]) {
    c.style.width = `${cssW * view}px`
    c.style.height = `${cssH * view}px`
  }
}

// ---------- crop ----------

/** Resize every canvas to the crop and re-blit that region of the original capture. */
function applyCrop(c: Rect): void {
  crop = c
  for (const cv of [base, cmp, ink]) {
    cv.width = c.width
    cv.height = c.height
  }
  if (orig) baseCtx.drawImage(orig, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height)
  diffCache = null
  layout()
  renderCompare()
}

function shiftAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.kind) {
    case 'stroke':
      return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
    case 'arrow':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
    default:
      return { ...a, x: a.x + dx, y: a.y + dy }
  }
}

/** Bounding box of an annotation in image px (text/badge get a nominal box around their anchor). */
function annotationBox(a: Annotation): Rect {
  switch (a.kind) {
    case 'stroke': {
      const xs = a.points.map((p) => p.x)
      const ys = a.points.map((p) => p.y)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
    }
    case 'arrow':
      return normRect({ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 })
    case 'rect':
    case 'blur':
      return { x: a.x, y: a.y, width: a.w, height: a.h }
    case 'badge':
      return { x: a.x - a.size / 2, y: a.y - a.size / 2, width: a.size, height: a.size }
    case 'text':
      return { x: a.x, y: a.y - a.fontSize / 2, width: a.fontSize * a.text.length * 0.6, height: a.fontSize }
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
}

/**
 * Crop to `sel` (px of the current canvas). One history step: the image region, every annotation
 * (shifted; those entirely outside are dropped) and the speech links move together.
 */
function applyCropSelection(sel: Rect): void {
  if (!init) return
  const x = Math.max(0, Math.round(sel.x))
  const y = Math.max(0, Math.round(sel.y))
  const w = Math.min(base.width - x, Math.round(sel.width))
  const h = Math.min(base.height - y, Math.round(sel.height))
  if (w < 8 || h < 8) { render(); return }
  const area: Rect = { x, y, width: w, height: h }
  const before = annotations.length
  const kept: Annotation[] = []
  const remap = new Map<number, number>()
  annotations.forEach((a, i) => {
    if (!intersects(annotationBox(a), area)) return
    remap.set(i, kept.length)
    kept.push(shiftAnnotation(a, -x, -y))
  })
  let badgeNo = 0
  const renumbered = kept.map((a) => (a.kind === 'badge' ? { ...a, n: ++badgeNo } : a))
  const nextLinks = new Map<number, number | null>()
  for (const [seg, ai] of links) {
    if (ai === null) nextLinks.set(seg, null)
    else {
      const ni = remap.get(ai)
      if (ni !== undefined) nextLinks.set(seg, ni)
    }
  }
  const after: Doc = {
    annotations: renumbered,
    links: nextLinks,
    crop: { x: crop.x + x, y: crop.y + y, width: w, height: h }
  }
  history.commit('자르기', doc, after)
  setDoc(after)
  afterChange()
  const dropped = before - kept.length
  setStatus(`잘라냄: ${w}×${h} px${dropped > 0 ? ` · 바깥 주석 ${dropped}개 제거` : ''} (Ctrl+Z로 되돌리기)`)
}

// ---------- before/after comparison ----------

/** Source rect of the previous image matching the current crop (it may have a different size). */
function compareSrcRect(): Rect {
  if (!compareImg || !orig) return crop
  const sx = compareImg.naturalWidth / orig.naturalWidth
  const sy = compareImg.naturalHeight / orig.naturalHeight
  return { x: crop.x * sx, y: crop.y * sy, width: crop.width * sx, height: crop.height * sy }
}

function renderCompare(): void {
  cmpCtx.clearRect(0, 0, cmp.width, cmp.height)
  if (!cmpOn || !compareImg || !orig || cmp.width === 0) return
  const s = compareSrcRect()
  const w = cmp.width
  const h = cmp.height
  cmpCtx.save()
  if (cmpMode === 'overlay') {
    cmpCtx.globalAlpha = cmpOpacity
    cmpCtx.drawImage(compareImg, s.x, s.y, s.width, s.height, 0, 0, w, h)
  } else if (cmpMode === 'wipe') {
    const wx = Math.round(w * cmpWipe)
    cmpCtx.beginPath()
    cmpCtx.rect(0, 0, wx, h)
    cmpCtx.clip()
    cmpCtx.drawImage(compareImg, s.x, s.y, s.width, s.height, 0, 0, w, h)
    cmpCtx.restore()
    cmpCtx.save()
    cmpCtx.fillStyle = '#fff'
    cmpCtx.fillRect(wx - 1, 0, 2, h)
    const fs = Math.round(12 * (init?.meta.scaleFactor ?? 1))
    cmpCtx.font = `bold ${fs}px system-ui, "Malgun Gothic", sans-serif`
    cmpCtx.textBaseline = 'top'
    cmpCtx.fillStyle = 'rgba(0,0,0,0.6)'
    cmpCtx.fillRect(Math.max(0, wx - fs * 3.2), 0, fs * 3.2, fs * 1.5)
    cmpCtx.fillRect(wx, 0, fs * 3.2, fs * 1.5)
    cmpCtx.fillStyle = '#fff'
    cmpCtx.textAlign = 'right'
    cmpCtx.fillText('이전', wx - 4, fs * 0.25)
    cmpCtx.textAlign = 'left'
    cmpCtx.fillText('현재', wx + 4, fs * 0.25)
  } else {
    // |current - previous|: identical areas go black, changes light up.
    cmpCtx.drawImage(base, 0, 0)
    cmpCtx.globalCompositeOperation = 'difference'
    cmpCtx.drawImage(compareImg, s.x, s.y, s.width, s.height, 0, 0, w, h)
  }
  cmpCtx.restore()
}

/** Share (0..100) of sampled pixels that differ noticeably between the current crop and the previous image. */
function diffPercent(): number {
  if (diffCache !== null) return diffCache
  if (!compareImg || !orig || base.width === 0) return 0
  const w = base.width
  const h = base.height
  const t = document.createElement('canvas')
  t.width = w
  t.height = h
  const s = compareSrcRect()
  const tctx = ctxOf(t, true)
  tctx.drawImage(compareImg, s.x, s.y, s.width, s.height, 0, 0, w, h)
  const a = baseCtx.getImageData(0, 0, w, h).data
  const b = tctx.getImageData(0, 0, w, h).data
  let n = 0
  let d = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4
      n++
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 48) d++
    }
  }
  diffCache = n ? Math.round((d / n) * 1000) / 10 : 0
  return diffCache
}

function syncCompareUi(): void {
  compareBar.hidden = compareImg === null
  compareBtn.classList.toggle('active', cmpOn)
  compareModeBtns.forEach((b) => b.classList.toggle('active', b.dataset.cmpMode === cmpMode))
  opacityInput.parentElement?.classList.toggle('off', cmpMode !== 'overlay')
  wipeInput.parentElement?.classList.toggle('off', cmpMode !== 'wipe')
  compareBar.classList.toggle('on', cmpOn)
  if (compareImg) diffLabel.textContent = `달라진 픽셀 ${diffPercent()}%`
}

function setCompare(on: boolean): void {
  if (!compareImg) { setStatus('비교할 이전 캡처가 없습니다 (트레이 "마지막 영역 다시 캡처"로 찍으면 생깁니다)'); return }
  cmpOn = on
  if (on) cmpUsed = true
  syncCompareUi()
  renderCompare()
  setStatus(on ? `이전 캡처와 비교 중 (${CMP_LABELS[cmpMode]}) · O로 끄기` : '비교 끔')
}

function setCompareMode(m: CompareMode): void {
  cmpMode = m
  if (!cmpOn && compareImg) { cmpOn = true; cmpUsed = true }
  syncCompareUi()
  renderCompare()
  if (cmpOn) setStatus(`이전 캡처와 비교 중 (${CMP_LABELS[m]}) · O로 끄기`)
}

const CMP_LABELS: Record<CompareMode, string> = { overlay: '겹치기', wipe: '와이프', diff: '차이' }

function flatten(): string {
  const out = document.createElement('canvas')
  out.width = base.width
  out.height = base.height
  const ctx = ctxOf(out)
  ctx.drawImage(base, 0, 0)
  drawAll(ctx, null) // always the full picture, even while scrubbed
  return out.toDataURL('image/png')
}

// ---------- document changes (one history command each) ----------

const timeline = new Timeline(byId('timeline'), {
  getAnnotations: () => annotations,
  liveNow: now,
  onScrub(t) {
    scrubT = t
    render()
  },
  getTranscript: () => transcript,
  getLinks: () => links,
  onLink(segmentIndex, annotationIndex) {
    if (links.has(segmentIndex) && links.get(segmentIndex) === annotationIndex) return
    const next = new Map(links)
    next.set(segmentIndex, annotationIndex)
    commitLinks('발화 연결', next)
  },
  onUnlink(segmentIndex) {
    if (!links.has(segmentIndex)) return
    const next = new Map(links)
    next.delete(segmentIndex)
    commitLinks('발화 연결 해제', next)
  },
  getAudio: () => (audioUrl ? player : null),
  getAudioStartMs: () => audioStartMs,
  getAudioDurationMs: () => audioDurationMs
})

function setDoc(next: Doc): void {
  doc = next
  annotations = next.annotations
  links = next.links
  if (!sameRect(next.crop, crop)) applyCrop(next.crop) // undo/redo across a crop re-blits the image
}

function afterChange(): void {
  render()
  timeline.refresh()
  undoBtn.disabled = !history.canUndo
  redoBtn.disabled = !history.canRedo
  undoBtn.title = history.undoLabel ? `되돌리기: ${history.undoLabel} (Ctrl+Z)` : hotkeys.label('undo')
  redoBtn.title = history.redoLabel ? `다시 실행: ${history.redoLabel} (Ctrl+Shift+Z)` : hotkeys.label('redo')
  timelineBtn.classList.toggle('has-items', annotations.length > 0 || transcript !== null)
}

function commit(label: string, next: readonly Annotation[]): void {
  const after: Doc = { annotations: next, links, crop }
  history.commit(label, doc, after)
  setDoc(after)
  afterChange()
}

function commitLinks(label: string, nextLinks: ReadonlyMap<number, number | null>): void {
  const after: Doc = { annotations, links: nextLinks, crop }
  history.commit(label, doc, after)
  setDoc(after)
  afterChange()
}

function undo(): void {
  if (drawing || shape || cropDrag) return
  commitPendingText()
  const prev = history.undo()
  if (prev === undefined) return
  setDoc(prev)
  afterChange()
}

function redo(): void {
  if (drawing || shape || cropDrag) return
  commitPendingText()
  const next = history.redo()
  if (next === undefined) return
  setDoc(next)
  afterChange()
}

/** Editing while scrubbed makes no sense: snap back to live first. */
function ensureLive(): void {
  if (scrubT !== null) timeline.setLive()
}

// ---------- text tool ----------

function finishText(box: HTMLInputElement, commitIt: boolean, tStart: number, at: Point): void {
  if (textBox !== box) return
  textBox = null // first, so the blur fired by remove() is a no-op
  const text = box.value.trim()
  const boxColor = box.style.color
  box.remove()
  if (!commitIt || !text || !init) return
  commit('텍스트', [
    ...annotations,
    {
      kind: 'text', text, x: at.x, y: at.y, color: boxColor,
      fontSize: TEXT_SIZE * init.meta.scaleFactor, tStart, tEnd: now()
    }
  ])
}

function commitPendingText(): void {
  textBox?.blur() // blur handler commits
}

function startText(p: Point, e: PointerEvent): void {
  const rect = ink.getBoundingClientRect()
  const box = document.createElement('input')
  box.type = 'text'
  box.className = 'textbox'
  box.spellcheck = false
  box.style.color = color
  box.style.fontSize = `${TEXT_SIZE * view}px`
  box.style.left = `${e.clientX - rect.left}px`
  box.style.top = `${e.clientY - rect.top}px`
  const tStart = now()
  box.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return // Korean IME: Enter confirms the composition
    if (ev.key === 'Enter') { ev.preventDefault(); finishText(box, true, tStart, p) }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finishText(box, false, tStart, p) }
  })
  box.addEventListener('blur', () => finishText(box, true, tStart, p))
  textBox = box
  wrap.appendChild(box)
  setTimeout(() => box.focus(), 0) // after the browser's own mousedown focus handling
}

// ---------- pen tool ----------

function toImg(e: PointerEvent): Point {
  const r = ink.getBoundingClientRect()
  return { x: (e.clientX - r.left) * (ink.width / r.width), y: (e.clientY - r.top) * (ink.height / r.height) }
}

function segment(a: StrokeAnn, from: Point, to: Point): void {
  applyStroke(inkCtx, a)
  inkCtx.beginPath()
  inkCtx.moveTo(from.x, from.y)
  inkCtx.lineTo(to.x, to.y)
  inkCtx.stroke()
}

// Event timestamps share performance.now()'s origin, so coalesced samples keep their real times.
const evTime = (ev: PointerEvent): number => Math.max(0, ev.timeStamp - t0)

/** Build a finished (or preview) shape annotation; null when too small to keep. */
function buildShape(
  kind: DragTool, a: Point, b: Point, tStart: number, tEnd: number, scale: number, preview = false
): Extract<Annotation, { kind: DragTool }> | null {
  const width = widthCss * scale
  switch (kind) {
    case 'arrow':
      if (!preview && Math.hypot(b.x - a.x, b.y - a.y) < MIN_DRAG) return null
      return { kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, width, tStart, tEnd }
    case 'rect':
    case 'blur': {
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      const w = Math.abs(b.x - a.x)
      const h = Math.abs(b.y - a.y)
      if (!preview && (w < MIN_DRAG || h < MIN_DRAG)) return null
      if (kind === 'rect') return { kind, x, y, w, h, color, width, tStart, tEnd }
      return { kind, x, y, w, h, strength: BLUR_BLOCK * scale, tStart, tEnd }
    }
    case 'badge': {
      const n = annotations.reduce((c, x) => c + (x.kind === 'badge' ? 1 : 0), 0) + 1
      return { kind, x: a.x, y: a.y, n, color, size: BADGE_SIZE * scale, tStart, tEnd }
    }
  }
}

const LABELS: Record<DragTool, string> = { arrow: '화살표', rect: '사각형', badge: '번호', blur: '블러' }

function endShape(commitIt: boolean): void {
  if (!shape || !init) return
  const s = shape
  shape = null
  const a = commitIt ? buildShape(s.tool, s.start, s.cur, s.tStart, now(), init.meta.scaleFactor) : null
  if (a) commit(LABELS[s.tool], [...annotations, a])
  else render() // drop the preview
}

ink.addEventListener('pointerdown', (e) => {
  pointerCounts.down++
  if (!init || e.button !== 0 || drawing || shape || cropDrag) return
  e.preventDefault()
  commitPendingText()
  ensureLive()
  const p = toImg(e)
  if (tool === 'text') { startText(p, e); return }
  if (tool === 'crop') {
    cropDrag = { start: p, cur: p }
    ink.setPointerCapture(e.pointerId)
    render()
    return
  }
  if (tool !== 'pen') {
    shape = { tool, start: p, cur: p, tStart: now() }
    ink.setPointerCapture(e.pointerId)
    render()
    return
  }
  const tStart = now()
  drawing = {
    kind: 'stroke', color, width: widthCss * init.meta.scaleFactor,
    points: [p], times: [tStart], tStart, tEnd: 0
  }
  ink.setPointerCapture(e.pointerId)
  segment(drawing, p, p)
})

ink.addEventListener('pointermove', (e) => {
  pointerCounts.move++
  if (cropDrag) {
    cropDrag.cur = toImg(e)
    render()
    return
  }
  if (shape) {
    shape.cur = toImg(e)
    render()
    return
  }
  if (!drawing) return
  const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
  for (const ev of coalesced.length ? coalesced : [e]) {
    const last = drawing.points[drawing.points.length - 1]
    const p = toImg(ev)
    if (last) segment(drawing, last, p)
    drawing.points.push(p)
    drawing.times?.push(evTime(ev))
  }
})

function endStroke(): void {
  if (!drawing) return
  drawing.tEnd = now()
  const done = drawing
  drawing = null
  commit('펜', [...annotations, done])
}
function endCrop(commitIt: boolean, at?: Point): void {
  if (!cropDrag) return
  const c = cropDrag
  cropDrag = null
  if (at) c.cur = at
  const r = normRect(c.start, c.cur)
  if (commitIt && r.width >= MIN_DRAG && r.height >= MIN_DRAG) applyCropSelection(r)
  else render() // drop the preview
}

ink.addEventListener('pointerup', (e) => {
  pointerCounts.up++
  if (cropDrag) { endCrop(true, toImg(e)); return }
  if (shape) shape.cur = toImg(e)
  endStroke()
  endShape(true)
})
// A capture lost without an up (window focus change, synthetic input): finish instead of sticking.
ink.addEventListener('lostpointercapture', () => {
  if (cropDrag) endCrop(true)
  if (drawing) endStroke()
  if (shape) endShape(true)
})
ink.addEventListener('pointercancel', () => {
  pointerCounts.cancel++
  endCrop(false)
  endStroke()
  endShape(false)
})

// ---------- export ----------

/** Capture metadata as exported: after a crop, rectDip/rectPx describe the kept region only. */
function exportMeta(): CaptureMeta {
  if (!init) throw new Error('no init')
  const m = init.meta
  if (!orig || (crop.x === 0 && crop.y === 0 && crop.width === orig.naturalWidth && crop.height === orig.naturalHeight)) {
    return m
  }
  const s = m.scaleFactor
  const r1 = (v: number): number => Math.round(v * 10) / 10
  return {
    ...m,
    crop: { ...crop },
    rectPx: { x: m.rectPx.x + crop.x, y: m.rectPx.y + crop.y, width: crop.width, height: crop.height },
    rectDip: {
      x: r1(m.rectDip.x + crop.x / s),
      y: r1(m.rectDip.y + crop.y / s),
      width: r1(crop.width / s),
      height: r1(crop.height / s)
    }
  }
}

function buildPayload(): ExportPayload | null {
  if (!init) return null
  commitPendingText()
  const payload: ExportPayload = {
    pngDataUrl: flatten(),
    memo: memoInput.value.trim(),
    annotations: [...annotations],
    meta: exportMeta(),
    links: [...links].map(([segmentIndex, annotationIndex]) => ({ segmentIndex, annotationIndex }))
  }
  if (transcript) payload.transcript = transcript
  if (audioBytes) payload.audio = { bytes: audioBytes, mimeType: audioMime }
  if (compareImg && cmpUsed) payload.compare = { sessionDir: compareDir, mode: cmpMode, diffPercent: diffPercent() }
  return payload
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function save(): Promise<void> {
  if (busy || !init) return
  busy = true
  setStatus('저장 중…')
  try {
    await settleRecording()
    const payload = buildPayload()
    if (!payload) return
    setStatus('저장 중…')
    const r = await window.backseat.editor.save(payload)
    if (r.ok) setStatus(`저장됨: ${r.path ?? ''}`)
    else if (r.canceled) setStatus('저장 취소')
    else setStatus(`저장 실패: ${r.error ?? '알 수 없는 오류'}`, true)
  } catch (err) {
    setStatus(`저장 실패: ${errText(err)}`, true)
  } finally {
    busy = false
  }
}

async function send(): Promise<void> {
  if (busy || !init) return
  busy = true
  setStatus('전송 중…')
  let closing = false
  try {
    await settleRecording()
    const payload = buildPayload()
    if (!payload) return
    setStatus('전송 중…')
    const r = await window.backseat.editor.send(payload, { pressEnter: false })
    setStatus(r.message, !r.ok)
    if (r.ok) {
      closing = true // stay busy: no double send while the status is visible
      if (!pinned) setTimeout(() => window.backseat.editor.close(), SEND_CLOSE_DELAY)
    }
  } catch (err) {
    setStatus(`전송 실패: ${errText(err)}`, true)
  } finally {
    if (!closing) busy = false
  }
}

const METHOD_HINT: Record<AgentTarget['method'], string> = {
  'paste-path': '붙여넣기',
  'paste-image': '붙여넣기',
  clipboard: '클립보드'
}

function showTarget(target: AgentTarget | null): void {
  targetBar.textContent = ''
  if (!target) {
    targetBar.textContent = '대상 없음 · 전송하면 클립보드에 복사됩니다'
    targetBar.title = ''
    return
  }
  targetBar.append(`→ ${target.label}`)
  const hint = document.createElement('span')
  hint.className = 'hint'
  hint.textContent = METHOD_HINT[target.method]
  targetBar.append(hint)
  targetBar.title = `${target.title} (${target.process})`
}

async function copy(): Promise<void> {
  if (busy || !init) return
  busy = true
  try {
    await settleRecording()
    const payload = buildPayload()
    if (!payload) return
    const r = await window.backseat.editor.copy(payload)
    if (r.ok) setStatus('클립보드에 복사됨')
    else setStatus(`복사 실패: ${r.error ?? '알 수 없는 오류'}`, true)
  } catch (err) {
    setStatus(`복사 실패: ${errText(err)}`, true)
  } finally {
    busy = false
  }
}

/**
 * Replay the session into a WebM: deterministic sampling via drawAnnotationAt(t),
 * one frame per animation frame, encoder backpressure handled by MediaRecorder.
 */
async function exportVideo(): Promise<void> {
  if (busy || !init) return
  if (annotations.length === 0) { setStatus('내보낼 주석이 없습니다'); return }
  commitPendingText()
  const first = Math.min(...annotations.map((a) => a.tStart))
  const start = Math.max(0, first - 400)
  const end = sessionEnd(annotations) + 700
  const scale = Math.min(1, 1280 / base.width)
  const c = document.createElement('canvas')
  c.width = Math.round(base.width * scale)
  c.height = Math.round(base.height * scale)
  const cctx = ctxOf(c)
  const frame = (t: number): void => {
    cctx.setTransform(scale, 0, 0, scale, 0, 0)
    cctx.drawImage(base, 0, 0)
    drawAll(cctx, t)
  }
  const mime =
    ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ??
    'video/webm'
  busy = true
  setStatus(`녹화 중… (${((end - start) / 1000).toFixed(1)}초)`)
  try {
    const stream = c.captureStream(30)
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve() })
    frame(start)
    rec.start(200)
    const wall = performance.now()
    await new Promise<void>((resolve) => {
      const loop = (): void => {
        const t = start + (performance.now() - wall)
        frame(Math.min(t, end))
        if (t >= end) resolve()
        else requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
    rec.stop()
    await stopped
    const blob = new Blob(chunks, { type: mime })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const r = await window.backseat.editor.saveVideo({ bytes, mimeType: mime, durationMs: end - start })
    if (r.ok) setStatus(`녹화 저장됨: ${r.path ?? ''}`)
    else if (r.canceled) setStatus('녹화 저장 취소')
    else setStatus(`녹화 실패: ${r.error ?? '알 수 없는 오류'}`, true)
  } catch (err) {
    setStatus(`녹화 실패: ${errText(err)}`, true)
  } finally {
    busy = false
  }
}

// ---------- voice: record, decode, transcribe ----------

interface ActiveRecording {
  rec: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  mime: string
  startedPerf: number
  /** Editor-clock time of the recorder's 'start' event. */
  startMs: number
  gen: number
  stopped: Promise<void>
  ticker: number
}

let active: ActiveRecording | null = null
let startingMic = false
let recTask: Promise<void> | null = null // stop + decode + transcribe of the latest recording
let recGen = 0 // bumped per recording; stale transcription results are dropped
let transcribing = false

const mmss = (ms: number): string => {
  const s = Math.floor(Math.max(0, ms) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function updateMicUi(): void {
  micBtn.classList.toggle('recording', active !== null)
  micBtn.textContent = active ? `■ 정지 ${mmss(performance.now() - active.startedPerf)}` : '🎤 녹음'
}

function releaseMic(a: ActiveRecording): void {
  window.clearInterval(a.ticker)
  a.stream.getTracks().forEach((t) => t.stop())
}

window.backseat.editor.onSttProgress?.((p) => {
  if (!transcribing) return
  switch (p.stage) {
    case 'loading': setStatus(p.message ?? '음성 모델 불러오는 중…'); break
    case 'downloading':
      setStatus(`모델 내려받는 중 ${p.file ?? ''} ${Math.round(p.progress ?? 0)}%`.replace(/\s+/g, ' '))
      break
    case 'transcribing': setStatus('전사 중…'); break
    case 'error': setStatus(p.message ?? '전사 오류', true); break
    case 'done': break
  }
})

async function startRecording(): Promise<void> {
  if (active || startingMic || !init) return
  startingMic = true
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    startingMic = false
    setStatus(`마이크를 사용할 수 없습니다: ${errText(err)}`, true)
    return
  }
  try {
    const mimeType = AUDIO_MIMES.find((m) => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const a: ActiveRecording = {
      rec, stream, chunks: [], mime: rec.mimeType || mimeType || 'audio/webm',
      startedPerf: performance.now(), startMs: now(), gen: ++recGen,
      stopped: new Promise<void>((resolve) => rec.addEventListener('stop', () => resolve(), { once: true })),
      ticker: window.setInterval(updateMicUi, 250)
    }
    rec.addEventListener('dataavailable', (e) => { if (e.data.size > 0) a.chunks.push(e.data) })
    rec.addEventListener('start', () => { a.startMs = now() }, { once: true })
    rec.addEventListener('error', () => setStatus('녹음 오류가 발생했습니다', true))
    active = a
    rec.start(250)
    updateMicUi()
    setStatus('녹음 중')
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    active = null
    updateMicUi()
    setStatus(`녹음을 시작하지 못했습니다: ${errText(err)}`, true)
  } finally {
    startingMic = false
  }
}

/** Stop the current recording (if any) and resolve once its transcript attempt has finished. */
function stopRecording(): Promise<void> {
  const a = active
  if (a) {
    active = null
    updateMicUi()
    const task = finishRecording(a)
    recTask = task
    void task.finally(() => { if (recTask === task) recTask = null })
  }
  return recTask ?? Promise.resolve()
}

/** Called before save / copy / send: end a running recording and wait for its transcript. */
async function settleRecording(): Promise<void> {
  await stopRecording()
}

async function toggleRecording(): Promise<void> {
  if (active) await stopRecording()
  else await startRecording()
}

/** Makes <audio> report a finite duration for MediaRecorder WebM (which lacks one). */
function fixInfiniteDuration(el: HTMLAudioElement): void {
  const onMeta = (): void => {
    if (el.duration !== Infinity) return
    const back = (): void => {
      el.removeEventListener('timeupdate', back)
      el.currentTime = 0
    }
    el.addEventListener('timeupdate', back)
    el.currentTime = 1e101
  }
  el.addEventListener('loadedmetadata', onMeta, { once: true })
}

function replaceAudio(blob: Blob, bytes: Uint8Array, startMs: number, durationMs: number): void {
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioBytes = bytes
  audioMime = blob.type
  audioStartMs = startMs
  audioDurationMs = durationMs
  audioUrl = URL.createObjectURL(blob)
  fixInfiniteDuration(player)
  player.src = audioUrl
  player.load()
}

async function finishRecording(a: ActiveRecording): Promise<void> {
  try {
    if (a.rec.state !== 'inactive') a.rec.stop()
    await a.stopped
  } catch (err) {
    setStatus(`녹음 종료 실패: ${errText(err)}`, true)
  } finally {
    releaseMic(a) // the microphone is free again, whatever happened
  }
  const wallMs = performance.now() - a.startedPerf
  if (a.chunks.length === 0) { setStatus('녹음된 소리가 없습니다', true); return }
  const blob = new Blob(a.chunks, { type: a.mime })
  let buf: ArrayBuffer
  try {
    buf = await blob.arrayBuffer()
  } catch (err) {
    setStatus(`녹음 읽기 실패: ${errText(err)}`, true)
    return
  }
  if (a.gen !== recGen) return // a newer recording already took over

  // a new recording replaces the previous audio and transcript (and the links into it)
  transcript = null
  if (links.size > 0) setDoc({ annotations, links: new Map(), crop })
  replaceAudio(blob, new Uint8Array(buf), a.startMs, wallMs)
  afterChange()

  transcribing = true
  try {
    setStatus('음성 해석 중…')
    let pcm16k: Float32Array
    const ac = new AudioContext({ sampleRate: 16000 })
    try {
      const decoded = await ac.decodeAudioData(buf.slice(0))
      pcm16k = decoded.getChannelData(0).slice() // already resampled to 16 kHz by the context
      if (a.gen === recGen && decoded.duration > 0) audioDurationMs = decoded.duration * 1000
    } finally {
      void ac.close()
    }
    const r = await window.backseat.editor.transcribe({ pcm16k, audioStartMs: a.startMs, language: 'korean' })
    if (a.gen !== recGen) return
    if (r.ok && r.transcript) {
      transcript = r.transcript
      const words = r.transcript.segments.reduce(
        (n, seg) => n + (seg.words ? seg.words.length : seg.text.split(/\s+/).filter(Boolean).length), 0
      )
      afterChange()
      setStatus(`전사 완료: ${words} 단어`)
    } else {
      setStatus(`전사 실패: ${r.error ?? '알 수 없는 오류'}`, true)
    }
  } catch (err) {
    if (a.gen === recGen) setStatus(`전사 실패: ${errText(err)}`, true)
  } finally {
    if (a.gen === recGen) transcribing = false
  }
}

// closing the window mid-recording must not leave the microphone open
window.addEventListener('pagehide', () => { if (active) releaseMic(active) })

// ---------- toolbar & keyboard ----------

function setTool(next: Tool): void {
  tool = next
  syncToolbar()
}

function syncToolbar(): void {
  toolBtns.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool))
  colorBtns.forEach((b) => b.classList.toggle('active', b.dataset.color === color))
  widthBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.width) === widthCss))
  wrap.classList.toggle('text-tool', tool === 'text')
  wrap.classList.toggle('crop-tool', tool === 'crop')
  timelineBtn.classList.toggle('active', timeline.isOpen)
}

compareBtn.addEventListener('click', () => setCompare(!cmpOn))
compareModeBtns.forEach((b) => b.addEventListener('click', () => {
  const m = b.dataset.cmpMode
  if (m === 'overlay' || m === 'wipe' || m === 'diff') setCompareMode(m)
}))
opacityInput.addEventListener('input', () => {
  cmpOpacity = Number(opacityInput.value) / 100
  renderCompare()
})
wipeInput.addEventListener('input', () => {
  cmpWipe = Number(wipeInput.value) / 100
  renderCompare()
})
compareBar.addEventListener('mousedown', (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault() })

toolBtns.forEach((b) => b.addEventListener('click', () => setTool(isTool(b.dataset.tool) ? b.dataset.tool : 'pen')))
colorBtns.forEach((b) => b.addEventListener('click', () => {
  color = b.dataset.color ?? color
  if (textBox) textBox.style.color = color
  syncToolbar()
}))
widthBtns.forEach((b) => b.addEventListener('click', () => {
  widthCss = Number(b.dataset.width) || widthCss
  syncToolbar()
}))
// keep focus (e.g. in the text box) when clicking toolbar controls
byId('toolbar').addEventListener('mousedown', (e) => e.preventDefault())

const hotkeys = new Hotkeys([
  {
    id: 'send', label: '전송', keys: ['Enter', 'Ctrl+Enter'],
    run: (e) => {
      if (e.code === 'Enter' && textBox) return false // Enter belongs to the open text box
      void send()
    }
  },
  { id: 'save', label: '저장', keys: ['Ctrl+KeyS'], context: 'global', run: () => void save() },
  { id: 'copy', label: '복사', keys: ['Ctrl+KeyC'], run: () => void copy() },
  { id: 'undo', label: '되돌리기', keys: ['Ctrl+KeyZ'], run: undo },
  { id: 'redo', label: '다시 실행', keys: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'], run: redo },
  { id: 'pen', label: '펜', keys: ['KeyP'], run: () => setTool('pen') },
  { id: 'text', label: '텍스트', keys: ['KeyT'], run: () => setTool('text') },
  { id: 'arrow', label: '화살표', keys: ['KeyA'], run: () => setTool('arrow') },
  { id: 'rect', label: '사각형', keys: ['KeyR'], run: () => setTool('rect') },
  { id: 'badge', label: '번호', keys: ['KeyN'], run: () => setTool('badge') },
  { id: 'blur', label: '블러', keys: ['KeyB'], run: () => setTool('blur') },
  { id: 'crop', label: '자르기', keys: ['KeyC'], run: () => setTool('crop') },
  { id: 'compare', label: '이전 캡처와 비교', keys: ['KeyO'], run: () => setCompare(!cmpOn) },
  { id: 'timeline', label: '타임라인', keys: ['KeyL'], run: () => { timeline.toggle(); syncToolbar() } },
  { id: 'play', label: '재생/일시정지', keys: ['Space'], run: () => { if (!timeline.isOpen) return false; timeline.togglePlay() } },
  { id: 'step-back', label: '0.2초 뒤로', keys: ['ArrowLeft'], run: () => { if (!timeline.isOpen) return false; timeline.stepFrames(-200) } },
  { id: 'step-fwd', label: '0.2초 앞으로', keys: ['ArrowRight'], run: () => { if (!timeline.isOpen) return false; timeline.stepFrames(200) } },
  { id: 'home', label: '처음으로', keys: ['Home'], run: () => { if (!timeline.isOpen) return false; timeline.pause(); timeline.seek(0) } },
  { id: 'live', label: '라이브로', keys: ['End'], run: () => { if (!timeline.isOpen) return false; timeline.setLive() } },
  { id: 'mic', label: '녹음', keys: ['KeyM'], run: () => void toggleRecording() },
  { id: 'video', label: '녹화 내보내기', keys: ['Ctrl+KeyE'], run: () => void exportVideo() },
  { id: 'pin', label: '고정 (참조창)', keys: ['Ctrl+KeyP'], run: () => void togglePin() },
  {
    id: 'close', label: '닫기', keys: ['Escape'], context: 'global',
    run: (e) => {
      if (e.target === memoInput) { memoInput.blur(); return }
      if (e.target instanceof HTMLInputElement) return false // the text box handles its own Escape
      if (timeline.cancelLinkDrag()) return // Esc aborts a speech link drag first
      if (cropDrag) { endCrop(false); return }
      if (cmpOn) { setCompare(false); return }
      if (scrubT !== null) { timeline.setLive(); return }
      window.backseat.editor.close()
    }
  }
])
hotkeys.install()
hotkeys.applyTooltips()

window.addEventListener('resize', () => {
  commitPendingText()
  layout()
})

// ---------- init ----------

window.backseat.editor.onInit((data) => {
  if (started) return
  started = true
  t0 = performance.now()
  document.title = 'Backseat'
  syncToolbar()
  showTarget(data.target)
  if (data.request) {
    const q = document.createElement('span')
    q.className = 'ask'
    q.textContent = ` · ❓ ${data.request.agent || '에이전트'}: ${data.request.question}`
    q.title = data.request.question
    targetBar.appendChild(q)
  }
  if (data.debug) {
    // Harness hooks: inject a transcript without a microphone, inspect state (see src/main/selftest.ts).
    window.addEventListener('backseat:debug-transcript', (e) => {
      transcript = (e as CustomEvent<Transcript>).detail
      afterChange()
      setStatus(`디버그 전사 주입: ${transcript.segments.length} 세그먼트`)
    })
    const w = window as unknown as { __backseat?: unknown }
    w.__backseat = {
      state: () => ({
        annotations: annotations.map((a) => {
          const b = annotationBox(a)
          return { kind: a.kind, tStart: Math.round(a.tStart), tEnd: Math.round(a.tEnd), x: Math.round(b.x), y: Math.round(b.y) }
        }),
        links: [...links],
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        drawing: drawing !== null,
        shape: shape !== null,
        init: init !== null,
        transcript: transcript ? transcript.segments.length : 0,
        size: [base.width, base.height],
        crop: { ...crop },
        meta: init ? exportMeta() : null,
        tool,
        cropDrag: cropDrag !== null,
        pointer: { ...pointerCounts },
        compare: { available: compareImg !== null, on: cmpOn, mode: cmpMode, diffPercent: compareImg ? diffPercent() : null }
      }),
      /** Crop programmatically (image px of the current canvas); same path as a pointer drag. */
      crop: (x: number, y: number, w: number, h: number) => applyCropSelection({ x, y, width: w, height: h }),
      setCompare: (on: boolean, mode?: CompareMode) => { if (mode) setCompareMode(mode); setCompare(on) },
      payload: () => { const p = buildPayload(); return p ? { meta: p.meta, compare: p.compare, annotations: p.annotations } : null }
    }
  }
  afterChange()
  const img = new Image()
  img.onload = () => {
    orig = img
    init = data
    setDoc({ annotations: [], links: new Map(), crop: { x: 0, y: 0, width: data.width, height: data.height } })
    render()
    if (data.compare) {
      const prev = new Image()
      prev.onload = () => {
        compareImg = prev
        compareDir = data.compare?.sessionDir ?? ''
        diffCache = null
        syncCompareUi()
        setStatus('이전 캡처가 있습니다: O 키로 전/후 비교')
      }
      prev.onerror = () => setStatus('이전 캡처를 불러오지 못했습니다', true)
      prev.src = data.compare.imageDataUrl
    }
    if (data.autoRecord) void startRecording()
  }
  img.onerror = () => setStatus('이미지를 불러오지 못했습니다', true)
  img.src = data.imageDataUrl
})
