import type { EditorInit, ExportPayload, Annotation, Point } from '../../shared/types'
import { pointsForProgress, sessionEnd } from '../../shared/align'
import { History } from './history'
import { Hotkeys } from './hotkeys'
import { Timeline } from './timeline'

type Tool = 'pen' | 'text'
type StrokeAnn = Extract<Annotation, { kind: 'stroke' }>

const TEXT_SIZE = 18 // CSS px; scaled by meta.scaleFactor into image pixels

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
const undoBtn = byId<HTMLButtonElement>('undo')
const redoBtn = byId<HTMLButtonElement>('redo')
const timelineBtn = byId<HTMLButtonElement>('timeline-toggle')
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
let annotations: readonly Annotation[] = []
const history = new History<readonly Annotation[]>(100)
let drawing: StrokeAnn | null = null
let textBox: HTMLInputElement | null = null
let busy = false
let scrubT: number | null = null // non-null while the timeline is scrubbed/replaying

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

function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation): void {
  if (a.kind === 'stroke') drawStroke(ctx, a)
  else drawText(ctx, a)
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
function drawAnnotationAt(ctx: CanvasRenderingContext2D, a: Annotation, t: number): void {
  if (a.kind === 'text') {
    if (t >= a.tEnd) drawText(ctx, a)
    return
  }
  drawStroke(ctx, a, pointsAt(a, t))
}

function render(): void {
  inkCtx.clearRect(0, 0, ink.width, ink.height)
  if (scrubT === null) for (const a of annotations) drawAnnotation(inkCtx, a)
  else for (const a of annotations) drawAnnotationAt(inkCtx, a, scrubT)
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
  for (const a of annotations) drawAnnotation(ctx, a) // always the full picture, even while scrubbed
  return out.toDataURL('image/png')
}

// ---------- document changes (one history command each) ----------

const timeline = new Timeline(byId('timeline'), {
  getAnnotations: () => annotations,
  liveNow: now,
  onScrub(t) {
    scrubT = t
    render()
  }
})

function afterChange(): void {
  render()
  timeline.refresh()
  undoBtn.disabled = !history.canUndo
  redoBtn.disabled = !history.canRedo
  undoBtn.title = history.undoLabel ? `되돌리기: ${history.undoLabel} (Ctrl+Z)` : hotkeys.label('undo')
  redoBtn.title = history.redoLabel ? `다시 실행: ${history.redoLabel} (Ctrl+Shift+Z)` : hotkeys.label('redo')
  timelineBtn.classList.toggle('has-items', annotations.length > 0)
}

function commit(label: string, next: readonly Annotation[]): void {
  history.commit(label, annotations, next)
  annotations = next
  afterChange()
}

function undo(): void {
  if (drawing) return
  commitPendingText()
  const prev = history.undo()
  if (prev === undefined) return
  annotations = prev
  afterChange()
}

function redo(): void {
  if (drawing) return
  commitPendingText()
  const next = history.redo()
  if (next === undefined) return
  annotations = next
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

ink.addEventListener('pointerdown', (e) => {
  if (!init || e.button !== 0 || drawing) return
  e.preventDefault()
  commitPendingText()
  ensureLive()
  const p = toImg(e)
  if (tool === 'text') { startText(p, e); return }
  const tStart = now()
  drawing = {
    kind: 'stroke', color, width: widthCss * init.meta.scaleFactor,
    points: [p], times: [tStart], tStart, tEnd: 0
  }
  ink.setPointerCapture(e.pointerId)
  segment(drawing, p, p)
})

ink.addEventListener('pointermove', (e) => {
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
ink.addEventListener('pointerup', endStroke)
ink.addEventListener('pointercancel', endStroke)

// ---------- export ----------

function buildPayload(): ExportPayload | null {
  if (!init) return null
  commitPendingText()
  return { pngDataUrl: flatten(), memo: memoInput.value.trim(), annotations: [...annotations], meta: init.meta }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function save(): Promise<void> {
  if (busy) return
  const payload = buildPayload()
  if (!payload) return
  busy = true
  setStatus('저장 중…')
  try {
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

async function copy(): Promise<void> {
  if (busy) return
  const payload = buildPayload()
  if (!payload) return
  busy = true
  try {
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
    for (const a of annotations) drawAnnotationAt(cctx, a, t)
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

toolBtns.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool === 'text' ? 'text' : 'pen')))
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
  { id: 'save', label: '저장', keys: ['Ctrl+KeyS'], context: 'global', run: () => void save() },
  { id: 'copy', label: '복사', keys: ['Ctrl+KeyC'], run: () => void copy() },
  { id: 'undo', label: '되돌리기', keys: ['Ctrl+KeyZ'], run: undo },
  { id: 'redo', label: '다시 실행', keys: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'], run: redo },
  { id: 'pen', label: '펜', keys: ['KeyP'], run: () => setTool('pen') },
  { id: 'text', label: '텍스트', keys: ['KeyT'], run: () => setTool('text') },
  { id: 'timeline', label: '타임라인', keys: ['KeyL'], run: () => { timeline.toggle(); syncToolbar() } },
  { id: 'play', label: '재생/일시정지', keys: ['Space'], run: () => { if (!timeline.isOpen) return false; timeline.togglePlay() } },
  { id: 'step-back', label: '0.2초 뒤로', keys: ['ArrowLeft'], run: () => { if (!timeline.isOpen) return false; timeline.stepFrames(-200) } },
  { id: 'step-fwd', label: '0.2초 앞으로', keys: ['ArrowRight'], run: () => { if (!timeline.isOpen) return false; timeline.stepFrames(200) } },
  { id: 'home', label: '처음으로', keys: ['Home'], run: () => { if (!timeline.isOpen) return false; timeline.pause(); timeline.seek(0) } },
  { id: 'live', label: '라이브로', keys: ['End'], run: () => { if (!timeline.isOpen) return false; timeline.setLive() } },
  { id: 'video', label: '녹화 내보내기', keys: ['Ctrl+KeyE'], run: () => void exportVideo() },
  {
    id: 'close', label: '닫기', keys: ['Escape'], context: 'global',
    run: (e) => {
      if (e.target === memoInput) { memoInput.blur(); return }
      if (e.target instanceof HTMLInputElement) return false // the text box handles its own Escape
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
  afterChange()
  const img = new Image()
  img.onload = () => {
    base.width = ink.width = data.width
    base.height = ink.height = data.height
    baseCtx.drawImage(img, 0, 0, data.width, data.height)
    init = data
    layout()
    render()
  }
  img.onerror = () => setStatus('이미지를 불러오지 못했습니다', true)
  img.src = data.imageDataUrl
})
