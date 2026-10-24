import type { SelectorInit, SelectionResult, Rect, WindowInfo, CaptureMode } from '../../shared/types'
import { applyDom, isLocale, setMessages, t } from '../../shared/i18n'

const MIN_SIZE = 3 // DIP; anything smaller is treated as a click
const DIM = 'rgba(0, 0, 0, 0.45)'
const TITLE_MAX = 40

/** Hint text per mode (message keys; resolved when the mode is set, after the language is known). */
const HINT_KEYS: Record<CaptureMode, string> = {
  rect: 'selector.hint.rect',
  window: 'selector.hint.window',
  full: 'selector.hint.full',
  scroll: 'selector.hint.scroll'
}

const MODE_KEYS: Record<string, CaptureMode> = { KeyR: 'rect', KeyW: 'window', KeyF: 'full', KeyS: 'scroll' }
const MODES: CaptureMode[] = ['rect', 'window', 'full', 'scroll']
/** Modes where hovering highlights the window under the cursor and a click picks it. */
const picksWindow = (m: CaptureMode): boolean => m === 'window' || m === 'scroll'

interface Pt {
  x: number
  y: number
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el as T
}

const shot = byId<HTMLImageElement>('shot')
const canvas = byId<HTMLCanvasElement>('overlay')
const sizeLabel = byId<HTMLDivElement>('size')
const hintEl = byId<HTMLDivElement>('hint')
const modesEl = byId<HTMLDivElement>('modes')
const modeButtons = Array.from(modesEl.querySelectorAll<HTMLButtonElement>('button[data-mode]'))
const ctx = canvas.getContext('2d')
if (!ctx) throw new Error('2d context unavailable')

let init: SelectorInit | null = null
let mode: CaptureMode = 'rect'
let start: Pt | null = null // set while a button is held
let dragged = false // pointer moved > MIN_SIZE since pointerdown
let rect: Rect | null = null // current drag selection (normalized, clamped)
let hover: WindowInfo | null = null // window under the cursor
let lastPos: Pt | null = null // last known pointer position over the canvas

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function setup(i: SelectorInit): void {
  init = i
  shot.src = i.imageDataUrl
  const dpr = window.devicePixelRatio || 1
  for (const el of [shot, canvas]) {
    el.style.width = `${i.width}px`
    el.style.height = `${i.height}px`
  }
  canvas.width = Math.round(i.width * dpr)
  canvas.height = Math.round(i.height * dpr)
  window.focus()
  setMode(i.mode)
}

function setMode(m: CaptureMode): void {
  mode = m
  start = null
  dragged = false
  rect = null
  document.body.classList.remove('dragging', 'mode-rect', 'mode-window', 'mode-full', 'mode-scroll')
  document.body.classList.add(`mode-${m}`)
  hintEl.textContent = t(HINT_KEYS[m])
  for (const b of modeButtons) b.classList.toggle('active', b.dataset.mode === m)
  hover = lastPos ? hitTest(lastPos) : null
  render()
}

function hitTest(p: Pt): WindowInfo | null {
  if (!init) return null
  for (const w of init.windows) {
    const b = w.bounds
    if (b.width <= 0 || b.height <= 0) continue
    if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height) return w
  }
  return null
}

function drawHighlight(r: Rect, inset: number): void {
  if (!ctx) return
  const { x, y, width: w, height: h } = r
  // Red 1px border just outside the hole, thin white outline just inside it.
  ctx.lineWidth = 1
  ctx.strokeStyle = '#E5484D'
  ctx.strokeRect(x - 0.5 + inset, y - 0.5 + inset, w + 1 - 2 * inset, h + 1 - 2 * inset)
  if (w > 2 && h > 2) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.strokeRect(x + 0.5 + inset, y + 0.5 + inset, w - 1 - 2 * inset, h - 1 - 2 * inset)
  }
}

function px(dip: number): number {
  return Math.round(dip * (init?.scaleFactor ?? 1))
}

function windowLabel(w: WindowInfo): string {
  const size = `${px(w.bounds.width)} × ${px(w.bounds.height)} px`
  const chars = Array.from(w.title.trim())
  if (chars.length === 0) return size
  const title = chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX).join('')}…` : chars.join('')
  return `${title} · ${size}`
}

function render(): void {
  if (!init || !ctx) return
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, init.width, init.height)

  if (mode === 'full') {
    const r: Rect = { x: 0, y: 0, width: init.width, height: init.height }
    drawHighlight(r, 1) // inset so the border is not clipped by the display edge
    updateLabel(r, `${px(r.width)} × ${px(r.height)} px`)
    return
  }

  ctx.fillStyle = DIM
  ctx.fillRect(0, 0, init.width, init.height)

  let target: Rect | null = null
  let text = ''
  if (dragged && rect) {
    target = rect
    text = `${px(rect.width)} × ${px(rect.height)} px`
  } else if (picksWindow(mode) && hover) {
    target = hover.bounds
    text = mode === 'scroll' ? t('selector.scrollLabel', { label: windowLabel(hover) }) : windowLabel(hover)
  }
  if (!target) {
    sizeLabel.style.display = 'none'
    return
  }
  ctx.clearRect(target.x, target.y, target.width, target.height) // hole: undimmed screenshot
  drawHighlight(target, 0)
  updateLabel(target, text)
}

function updateLabel(r: Rect, text: string): void {
  if (!init) return
  sizeLabel.textContent = text
  sizeLabel.style.display = 'block'
  const lw = sizeLabel.offsetWidth
  const lh = sizeLabel.offsetHeight
  const gap = 8
  let top = r.y + r.height + gap // below the rect
  if (top + lh > init.height) top = r.y - lh - gap // else above
  if (top < 0) top = r.y + gap // else inside the top edge
  sizeLabel.style.left = `${clamp(r.x, 0, Math.max(0, init.width - lw))}px`
  sizeLabel.style.top = `${top}px`
}

function toRect(a: Pt, b: Pt): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

function point(e: PointerEvent): Pt {
  return {
    x: clamp(e.clientX, 0, init?.width ?? window.innerWidth),
    y: clamp(e.clientY, 0, init?.height ?? window.innerHeight)
  }
}

function send(result: SelectionResult): void {
  window.backseat.selector.done(result)
}

function pickWindow(w: WindowInfo): void {
  if (!init) return
  send({ displayId: init.displayId, rect: { ...w.bounds }, mode: mode === 'scroll' ? 'scroll' : 'window', window: w })
}

function pickFull(): void {
  if (!init) return
  send({
    displayId: init.displayId,
    rect: { x: 0, y: 0, width: init.width, height: init.height },
    mode: 'full'
  })
}

function confirmRect(): void {
  if (!init || !rect || rect.width < MIN_SIZE || rect.height < MIN_SIZE) return
  send({ displayId: init.displayId, rect, mode: 'rect' })
}

function confirm(): void {
  if (mode === 'full') pickFull()
  else if (picksWindow(mode) && !(dragged && rect)) {
    if (hover) pickWindow(hover)
  } else confirmRect()
}

function reset(): void {
  start = null
  dragged = false
  rect = null
  document.body.classList.remove('dragging')
  render()
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  if (!init || e.button !== 0 || start) return
  canvas.setPointerCapture(e.pointerId)
  start = point(e)
  lastPos = start
  dragged = false
  rect = null
  render()
})

canvas.addEventListener('pointermove', (e) => {
  e.preventDefault()
  const p = point(e)
  lastPos = p
  if (!start) {
    if (picksWindow(mode)) {
      const next = hitTest(p)
      if (next !== hover) {
        hover = next
        render()
      }
    }
    return
  }
  if (mode === 'full' || mode === 'scroll') return // scroll capture always takes a whole window
  if (!dragged && Math.hypot(p.x - start.x, p.y - start.y) > MIN_SIZE) {
    dragged = true
    document.body.classList.add('dragging')
  }
  if (dragged) {
    rect = toRect(start, p)
    render()
  }
})

canvas.addEventListener('pointerleave', () => {
  if (start) return
  lastPos = null
  if (hover) {
    hover = null
    render()
  }
})

canvas.addEventListener('pointerup', (e) => {
  e.preventDefault()
  if (!start) return
  const p = point(e)
  lastPos = p
  const wasDragged = dragged
  if (wasDragged) rect = toRect(start, p)
  start = null
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)

  if (mode === 'full') {
    reset()
    pickFull()
    return
  }
  if (!wasDragged) {
    // A click: pick the window under the cursor (window mode, or rect-mode fallback).
    const w = hitTest(p)
    reset()
    if (w) pickWindow(w)
    return
  }
  if (!rect || rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
    reset()
    return
  }
  render()
  confirmRect() // mouse-up confirms
})

canvas.addEventListener('pointercancel', reset)

for (const b of modeButtons) {
  b.addEventListener('mousedown', (e) => e.preventDefault()) // keep focus off the buttons
  b.addEventListener('click', () => {
    const m = b.dataset.mode as CaptureMode | undefined
    if (m && MODES.includes(m)) setMode(m)
  })
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    window.backseat.selector.cancel()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    confirm()
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
    const m = MODE_KEYS[e.code]
    if (m) {
      e.preventDefault()
      if (m !== mode) setMode(m)
    }
  }
})

for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
  window.addEventListener(type, (e) => e.preventDefault())
}

window.backseat.selector.onInit((i) => {
  if (init) return // ignore duplicate init
  setMessages(isLocale(i.locale) ? i.locale : 'ko', i.messages ?? {})
  applyDom(document)
  setup(i)
})
