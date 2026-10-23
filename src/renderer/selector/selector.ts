import type { SelectorInit, Rect } from '../../shared/types'

const MIN_SIZE = 3 // DIP; anything smaller is treated as a click
const DIM = 'rgba(0, 0, 0, 0.45)'

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el as T
}

const shot = byId<HTMLImageElement>('shot')
const canvas = byId<HTMLCanvasElement>('overlay')
const sizeLabel = byId<HTMLDivElement>('size')
const ctx = canvas.getContext('2d')
if (!ctx) throw new Error('2d context unavailable')

let init: SelectorInit | null = null
let start: { x: number; y: number } | null = null // set while dragging
let rect: Rect | null = null // current selection (normalized, clamped)

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
  render()
}

function render(): void {
  if (!init || !ctx) return
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, init.width, init.height)
  ctx.fillStyle = DIM
  ctx.fillRect(0, 0, init.width, init.height)
  if (!rect) {
    sizeLabel.style.display = 'none'
    return
  }
  const { x, y, width: w, height: h } = rect
  ctx.clearRect(x, y, w, h) // hole: undimmed screenshot shows through
  // Red 1px border just outside the hole, thin white outline just inside it.
  ctx.lineWidth = 1
  ctx.strokeStyle = '#E5484D'
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1)
  if (w > 2 && h > 2) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  }
  updateLabel(rect)
}

function updateLabel(r: Rect): void {
  if (!init) return
  const sf = init.scaleFactor
  sizeLabel.textContent = `${Math.round(r.width * sf)} × ${Math.round(r.height * sf)} px`
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

function toRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

function point(e: PointerEvent): { x: number; y: number } {
  return {
    x: clamp(e.clientX, 0, init?.width ?? window.innerWidth),
    y: clamp(e.clientY, 0, init?.height ?? window.innerHeight)
  }
}

function confirm(): void {
  if (!init || !rect || rect.width < MIN_SIZE || rect.height < MIN_SIZE) return
  window.backseat.selector.done({ displayId: init.displayId, rect })
}

function reset(): void {
  start = null
  rect = null
  document.body.classList.remove('dragging')
  render()
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  if (!init || e.button !== 0 || start) return
  canvas.setPointerCapture(e.pointerId)
  start = point(e)
  rect = null
  document.body.classList.add('dragging')
  render()
})

canvas.addEventListener('pointermove', (e) => {
  e.preventDefault()
  if (!start) return
  rect = toRect(start, point(e))
  render()
})

canvas.addEventListener('pointerup', (e) => {
  e.preventDefault()
  if (!start) return
  rect = toRect(start, point(e))
  start = null
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
    reset() // a click, not a selection
    return
  }
  render()
  confirm() // M0: mouse-up confirms
})

canvas.addEventListener('pointercancel', reset)

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    window.backseat.selector.cancel()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    confirm()
  }
})

for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
  window.addEventListener(type, (e) => e.preventDefault())
}

window.backseat.selector.onInit((i) => {
  if (init) return // ignore duplicate init
  setup(i)
})
