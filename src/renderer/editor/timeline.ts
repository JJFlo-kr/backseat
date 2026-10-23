// Timeline panel: one shared time axis, one lane per annotation kind, a playhead,
// pointer scrubbing coalesced to one seek per animation frame, and replay.
// Time is milliseconds on the editor's clock (same as Annotation.tStart).
import type { Annotation } from '../../shared/types'
import { fmtClock, sessionEnd } from '../../shared/align'

export interface TimelineHost {
  getAnnotations(): readonly Annotation[]
  /** Current live time (ms since the editor opened). */
  liveNow(): number
  /** t = scrub position, null = back to live (show everything). */
  onScrub(t: number | null): void
}

const PAD_L = 10
const PAD_R = 14
const RULER_H = 18
const LANE_H = 16
const LANE_GAP = 4
const LANES: { kinds: readonly Annotation['kind'][]; label: string }[] = [
  { kinds: ['stroke'], label: '펜' },
  { kinds: ['arrow', 'rect', 'badge', 'blur'], label: '도형' },
  { kinds: ['text'], label: '텍스트' }
]
/** Point-in-time annotations are drawn as a diamond at tStart instead of a [tStart,tEnd] bar. */
const isMarker = (a: Annotation): boolean => a.kind === 'text' || a.kind === 'badge' || a.kind === 'blur'
const TICK_STEPS = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000]

export class TimeAxis {
  constructor(
    readonly width: number,
    readonly durationMs: number
  ) {}
  get span(): number {
    return Math.max(1, this.width - PAD_L - PAD_R)
  }
  xOf(t: number): number {
    return PAD_L + (t / this.durationMs) * this.span
  }
  tOf(x: number): number {
    const t = ((x - PAD_L) / this.span) * this.durationMs
    return Math.min(this.durationMs, Math.max(0, t))
  }
}

export class Timeline {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly clockEl: HTMLElement
  private readonly playBtn: HTMLButtonElement
  private readonly liveBtn: HTMLButtonElement
  private scrubT: number | null = null
  private playing = false
  private playRaf = 0
  private pendingT: number | null = null
  private pendingRaf = 0
  private liveTimer = 0
  private axis = new TimeAxis(300, 1000)

  constructor(
    private readonly root: HTMLElement,
    private readonly host: TimelineHost
  ) {
    const canvas = root.querySelector<HTMLCanvasElement>('canvas')
    const clockEl = root.querySelector<HTMLElement>('[data-tl=clock]')
    const playBtn = root.querySelector<HTMLButtonElement>('[data-tl=play]')
    const liveBtn = root.querySelector<HTMLButtonElement>('[data-tl=live]')
    if (!canvas || !clockEl || !playBtn || !liveBtn) throw new Error('timeline markup missing')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    this.canvas = canvas
    this.ctx = ctx
    this.clockEl = clockEl
    this.playBtn = playBtn
    this.liveBtn = liveBtn

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e))
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e))
    canvas.addEventListener('pointercancel', () => this.flushPending())
    playBtn.addEventListener('click', () => this.togglePlay())
    liveBtn.addEventListener('click', () => this.setLive())
    new ResizeObserver(() => this.refresh()).observe(root)
  }

  // ---------- state ----------

  get isOpen(): boolean {
    return !this.root.hidden
  }

  /** Scrub position, or null while live. */
  get time(): number | null {
    return this.scrubT
  }

  get isPlaying(): boolean {
    return this.playing
  }

  open(): void {
    if (this.isOpen) return
    this.root.hidden = false
    this.liveTimer = window.setInterval(() => {
      if (this.scrubT === null) this.refresh()
    }, 250)
    this.refresh()
  }

  close(): void {
    if (!this.isOpen) return
    this.setLive()
    window.clearInterval(this.liveTimer)
    this.root.hidden = true
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  setLive(): void {
    this.pause()
    if (this.scrubT !== null) {
      this.scrubT = null
      this.host.onScrub(null)
    }
    this.refresh()
  }

  seek(t: number): void {
    const end = this.duration()
    this.scrubT = Math.min(end, Math.max(0, t))
    this.host.onScrub(this.scrubT)
    this.refresh()
  }

  stepFrames(deltaMs: number): void {
    const from = this.scrubT ?? this.sessionLength()
    this.pause()
    this.seek(from + deltaMs)
  }

  togglePlay(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  play(): void {
    if (this.playing) return
    const end = this.sessionLength()
    if (end <= 0) return
    let start = this.scrubT ?? 0
    if (start >= end - 1) start = 0
    this.playing = true
    this.playBtn.textContent = '⏸'
    const wall = performance.now()
    const loop = (): void => {
      if (!this.playing) return
      const t = start + (performance.now() - wall)
      if (t >= end) {
        this.seek(end)
        this.pause()
        return
      }
      this.seek(t)
      this.playRaf = requestAnimationFrame(loop)
    }
    this.playRaf = requestAnimationFrame(loop)
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.playRaf)
    this.playBtn.textContent = '▶'
  }

  // ---------- scrubbing (one seek per animation frame) ----------

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    this.pause()
    this.canvas.setPointerCapture(e.pointerId)
    this.queue(this.axis.tOf(this.localX(e)))
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.canvas.hasPointerCapture(e.pointerId)) return
    this.queue(this.axis.tOf(this.localX(e)))
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.canvas.hasPointerCapture(e.pointerId)) return
    this.canvas.releasePointerCapture(e.pointerId)
    cancelAnimationFrame(this.pendingRaf)
    this.pendingT = null
    this.seek(this.axis.tOf(this.localX(e))) // exact final position
  }

  private localX(e: PointerEvent): number {
    return e.clientX - this.canvas.getBoundingClientRect().left
  }

  private queue(t: number): void {
    this.pendingT = t
    if (this.pendingRaf) return
    this.pendingRaf = requestAnimationFrame(() => this.flushPending())
  }

  private flushPending(): void {
    this.pendingRaf = 0
    if (this.pendingT === null) return
    const t = this.pendingT
    this.pendingT = null
    this.seek(t)
  }

  // ---------- drawing ----------

  private sessionLength(): number {
    return sessionEnd(this.host.getAnnotations())
  }

  private duration(): number {
    const live = this.scrubT === null ? this.host.liveNow() : 0
    return Math.max(1000, this.sessionLength(), live) * 1.02
  }

  refresh(): void {
    if (!this.isOpen) return
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(120, this.root.clientWidth - 16)
    const height = RULER_H + LANES.length * (LANE_H + LANE_GAP) + 4
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr)
      this.canvas.height = Math.round(height * dpr)
      this.canvas.style.width = `${width}px`
      this.canvas.style.height = `${height}px`
    }
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const annotations = this.host.getAnnotations()
    const duration = this.duration()
    this.axis = new TimeAxis(width, duration)
    const axis = this.axis

    this.drawRuler(ctx, axis, width)

    LANES.forEach((lane, li) => {
      const y = RULER_H + li * (LANE_H + LANE_GAP)
      ctx.fillStyle = '#26262c'
      ctx.fillRect(PAD_L, y, axis.span, LANE_H)
      ctx.fillStyle = '#6d6d78'
      ctx.font = '10px system-ui, "Malgun Gothic", sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(lane.label, PAD_L + 3, y + LANE_H / 2)
      annotations.forEach((a, i) => {
        if (!lane.kinds.includes(a.kind)) return
        this.drawBar(ctx, axis, a, i, y)
      })
    })

    const t = this.scrubT ?? this.host.liveNow()
    this.drawPlayhead(ctx, axis.xOf(Math.min(t, duration)), height)
    const total = fmtClock(this.sessionLength())
    this.clockEl.textContent =
      this.scrubT === null ? `LIVE ${fmtClock(this.host.liveNow())} · 주석 ${total}` : `${fmtClock(this.scrubT)} / ${total}`
    this.liveBtn.classList.toggle('active', this.scrubT === null)
    this.root.classList.toggle('scrubbed', this.scrubT !== null)
  }

  private drawRuler(ctx: CanvasRenderingContext2D, axis: TimeAxis, width: number): void {
    const targetPx = 70
    const step = TICK_STEPS.find((s) => axis.xOf(s) - axis.xOf(0) >= targetPx) ?? TICK_STEPS[TICK_STEPS.length - 1]
    ctx.strokeStyle = '#3c3c45'
    ctx.fillStyle = '#9a9aa6'
    ctx.font = '10px ui-monospace, Consolas, monospace'
    ctx.textBaseline = 'top'
    ctx.beginPath()
    for (let t = 0; t <= axis.durationMs; t += step) {
      const x = Math.round(axis.xOf(t)) + 0.5
      ctx.moveTo(x, RULER_H - 6)
      ctx.lineTo(x, RULER_H)
      ctx.fillText(fmtClock(t), x + 2, 1)
    }
    ctx.stroke()
    ctx.strokeStyle = '#4a4a54'
    ctx.beginPath()
    ctx.moveTo(PAD_L, RULER_H - 0.5)
    ctx.lineTo(width - PAD_R, RULER_H - 0.5)
    ctx.stroke()
  }

  private drawBar(ctx: CanvasRenderingContext2D, axis: TimeAxis, a: Annotation, index: number, y: number): void {
    const x0 = axis.xOf(a.tStart)
    const x1 = Math.max(x0 + 3, axis.xOf(a.tEnd))
    // Hold tail: the annotation stays visible after it is finished.
    ctx.fillStyle = 'color' in a ? a.color : '#8a8a96' // blur has no colour
    ctx.globalAlpha = 0.16
    ctx.fillRect(x1, y + LANE_H / 2 - 1, axis.xOf(axis.durationMs) - x1, 2)
    ctx.globalAlpha = 1
    const marker = isMarker(a)
    if (marker) {
      ctx.beginPath()
      ctx.moveTo(x0, y + 2)
      ctx.lineTo(x0 + 6, y + LANE_H / 2)
      ctx.lineTo(x0, y + LANE_H - 2)
      ctx.lineTo(x0 - 6, y + LANE_H / 2)
      ctx.closePath()
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.roundRect(x0, y + 2, x1 - x0, LANE_H - 4, 3)
      ctx.fill()
    }
    if (x1 - x0 >= 14 || marker) {
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 10px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(index + 1), (marker ? x0 + 9 : x0 + 4), y + LANE_H / 2)
    }
  }

  private drawPlayhead(ctx: CanvasRenderingContext2D, x: number, height: number): void {
    const px = Math.round(x) + 0.5
    ctx.strokeStyle = '#ff5c61'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, height)
    ctx.stroke()
    ctx.fillStyle = '#ff5c61'
    ctx.beginPath()
    ctx.moveTo(px - 5, 0)
    ctx.lineTo(px + 5, 0)
    ctx.lineTo(px, 6)
    ctx.closePath()
    ctx.fill()
  }
}
