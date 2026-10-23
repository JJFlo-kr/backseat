import type { EditorInit, ExportPayload, Annotation, AgentTarget, Point, Transcript } from '../../shared/types'
import { pointsForProgress, sessionEnd } from '../../shared/align'
import { History } from './history'
import { Hotkeys } from './hotkeys'
import { Timeline } from './timeline'

type Tool = 'pen' | 'text' | 'arrow' | 'rect' | 'badge' | 'blur'
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

/** The whole undoable document: drawings plus manual speech-to-annotation links. */
interface Doc {
  annotations: readonly Annotation[]
  /** segmentIndex -> annotationIndex (null = forced global). Absent = automatic alignment. */
  links: ReadonlyMap<number, number | null>
}

function isTool(v: string | undefined): v is Tool {
  return v === 'pen' || v === 'text' || v === 'arrow' || v === 'rect' || v === 'badge' || v === 'blur'
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el as T
}
function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  return ctx
}

const stage = byId<HTMLElement>('stage')
const wrap = byId<HTMLDivElement>('wrap')
const base = byId<HTMLCanvasElement>('base')
const ink = byId<HTMLCanvasElement>('ink')
const memoInput = byId<HTMLInputElement>('memo')
const statusEl = byId<HTMLElement>('status')
const targetBar = byId<HTMLElement>('targetbar')
const undoBtn = byId<HTMLButtonElement>('undo')
const redoBtn = byId<HTMLButtonElement>('redo')
const timelineBtn = byId<HTMLButtonElement>('timeline-toggle')
const micBtn = byId<HTMLButtonElement>('mic')
const player = byId<HTMLAudioElement>('player')
const baseCtx = ctxOf(base)
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
let doc: Doc = { annotations: [], links: new Map() }
let annotations: readonly Annotation[] = doc.annotations
let links: ReadonlyMap<number, number | null> = doc.links
const history = new History<Doc>(100)
let drawing: StrokeAnn | null = null
/** In-progress drag of an arrow / rect / badge / blur. */
let shape: { tool: DragTool; start: Point; cur: Point; tStart: number } | null = null
let textBox: HTMLInputElement | null = null
let busy = false
let scrubT: number | null = null // non-null while the timeline is scrubbed/replaying

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

function render(): void {
  inkCtx.clearRect(0, 0, ink.width, ink.height)
  drawAll(inkCtx, scrubT)
  if (shape && init) {
    const prev = buildShape(shape.tool, shape.start, shape.cur, shape.tStart, now(), init.meta.scaleFactor, true)
    if (prev) drawAnnotation(inkCtx, prev, prev.kind === 'badge' ? prev.n : undefined)
  }
}

function layout(): void {
  if (!init) return
  const cssW = init.width / init.meta.scaleFactor
  const cssH = init.height / init.meta.scaleFactor
  const availW = Math.max(50, stage.clientWidth - 32 - 2)
  const availH = Math.max(50, stage.clientHeight - 32 - 2)
  view = Math.min(1, availW / cssW, availH / cssH)
  for (const c of [base, ink]) {
    c.style.width = `${cssW * view}px`
    c.style.height = `${cssH * view}px`
  }
}

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
  const after: Doc = { annotations: next, links }
  history.commit(label, doc, after)
  setDoc(after)
  afterChange()
}

function commitLinks(label: string, nextLinks: ReadonlyMap<number, number | null>): void {
  const after: Doc = { annotations, links: nextLinks }
  history.commit(label, doc, after)
  setDoc(after)
  afterChange()
}

function undo(): void {
  if (drawing || shape) return
  commitPendingText()
  const prev = history.undo()
  if (prev === undefined) return
  setDoc(prev)
  afterChange()
}

function redo(): void {
  if (drawing || shape) return
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
  if (!init || e.button !== 0 || drawing || shape) return
  e.preventDefault()
  commitPendingText()
  ensureLive()
  const p = toImg(e)
  if (tool === 'text') { startText(p, e); return }
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
ink.addEventListener('pointerup', (e) => {
  if (shape) shape.cur = toImg(e)
  endStroke()
  endShape(true)
})
ink.addEventListener('pointercancel', () => {
  endStroke()
  endShape(false)
})

// ---------- export ----------

function buildPayload(): ExportPayload | null {
  if (!init) return null
  commitPendingText()
  const payload: ExportPayload = {
    pngDataUrl: flatten(),
    memo: memoInput.value.trim(),
    annotations: [...annotations],
    meta: init.meta,
    links: [...links].map(([segmentIndex, annotationIndex]) => ({ segmentIndex, annotationIndex }))
  }
  if (transcript) payload.transcript = transcript
  if (audioBytes) payload.audio = { bytes: audioBytes, mimeType: audioMime }
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
      setTimeout(() => window.backseat.editor.close(), SEND_CLOSE_DELAY)
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
  const scale = Math.min(1, 1280 / init.width)
  const c = document.createElement('canvas')
  c.width = Math.round(init.width * scale)
  c.height = Math.round(init.height * scale)
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
  if (links.size > 0) setDoc({ annotations, links: new Map() })
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
  timelineBtn.classList.toggle('active', timeline.isOpen)
}

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
  { id: 'timeline', label: '타임라인', keys: ['KeyL'], run: () => { timeline.toggle(); syncToolbar() } },
  { id: 'play', label: '재생/일시정지', keys: ['Space'], run: () => { if (!timeline.isOpen) return false; timeline.togglePlay() } },
  { id: 'step-back', label: '0.2초 뒤로', keys: ['ArrowLeft'], run: () => { if (!timeline.isOpen) return false; timeline.stepFrames(-200) } },
  { id: 'step-fwd', label: '0.2초 앞으로', keys: ['ArrowRight'], run: () => { if (!timeline.isOpen) return false; timeline.stepFrames(200) } },
  { id: 'home', label: '처음으로', keys: ['Home'], run: () => { if (!timeline.isOpen) return false; timeline.pause(); timeline.seek(0) } },
  { id: 'live', label: '라이브로', keys: ['End'], run: () => { if (!timeline.isOpen) return false; timeline.setLive() } },
  { id: 'mic', label: '녹음', keys: ['KeyM'], run: () => void toggleRecording() },
  { id: 'video', label: '녹화 내보내기', keys: ['Ctrl+KeyE'], run: () => void exportVideo() },
  {
    id: 'close', label: '닫기', keys: ['Escape'], context: 'global',
    run: (e) => {
      if (e.target === memoInput) { memoInput.blur(); return }
      if (e.target instanceof HTMLInputElement) return false // the text box handles its own Escape
      if (timeline.cancelLinkDrag()) return // Esc aborts a speech link drag first
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
        annotations: annotations.map((a) => ({ kind: a.kind, tStart: Math.round(a.tStart), tEnd: Math.round(a.tEnd) })),
        links: [...links],
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        drawing: drawing !== null,
        shape: shape !== null,
        init: init !== null,
        transcript: transcript ? transcript.segments.length : 0
      })
    }
  }
  afterChange()
  const img = new Image()
  img.onload = () => {
    base.width = ink.width = data.width
    base.height = ink.height = data.height
    baseCtx.drawImage(img, 0, 0, data.width, data.height)
    init = data
    layout()
    render()
    if (data.autoRecord) void startRecording()
  }
  img.onerror = () => setStatus('이미지를 불러오지 못했습니다', true)
  img.src = data.imageDataUrl
})
