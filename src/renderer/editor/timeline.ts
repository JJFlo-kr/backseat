// Timeline panel: one shared time axis, one lane per annotation kind plus a speech lane,
// a playhead, pointer scrubbing coalesced to one seek per animation frame, drag-to-link of
// speech segments onto annotations, and replay (audio is the master clock when a recording exists).
// Time is milliseconds on the editor's clock (same as Annotation.tStart).
import type { Annotation, Segment, Transcript } from '../../shared/types'
import { alignSegments, fmtClock, sessionEnd } from '../../shared/align'
import type { Assignment } from '../../shared/align'

export interface TimelineHost {
  getAnnotations(): readonly Annotation[]
  /** Current live time (ms since the editor opened). */
  liveNow(): number
  /** t = scrub position, null = back to live (show everything). */
  onScrub(t: number | null): void
  getTranscript(): Transcript | null
  getLinks(): ReadonlyMap<number, number | null>
  /** The user dragged a segment onto an annotation (or null = force global). */
  onLink(segmentIndex: number, annotationIndex: number | null): void
  /** The user dropped a segment on empty speech-lane space: back to automatic alignment. */
  onUnlink(segmentIndex: number): void
  getAudio(): HTMLAudioElement | null
  /** Editor-clock time at which the audio's first sample was recorded. */
  getAudioStartMs(): number
  /** Reliable audio length (the element's own duration can be Infinity for MediaRecorder output). */
  getAudioDurationMs(): number
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
/** Index of the speech lane, right below the annotation lanes. */
const VOICE_LANE = LANES.length
const LANE_COUNT = LANES.length + 1
const SEG_FILL = '#3d6fd6'
const SNIPPET_MS = 90
const SNIPPET_THROTTLE_MS = 120
const DRAG_THRESHOLD = 4
const MARKER_HIT = 8
/** Point-in-time annotations are drawn as a diamond at tStart instead of a [tStart,tEnd] bar. */
const isMarker = (a: Annotation): boolean => a.kind === 'text' || a.kind === 'badge' || a.kind === 'blur'
const TICK_STEPS = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000]
const laneY = (li: number): number => RULER_H + li * (LANE_H + LANE_GAP)

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

interface LinkDrag {
  seg: number
  startX: number
  startY: number
  x: number
  y: number
  moved: boolean
  /** Annotation under the pointer. */
  target: number | null
  pointerId: number
}

export class Timeline {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly clockEl: HTMLElement
  private readonly playBtn: HTMLButtonElement
  private readonly liveBtn: HTMLButtonElement
  private readonly hintEl: HTMLElement | null
  private readonly hintDefault: string
  private scrubT: number | null = null
  private playing = false
  private playToken = 0
  private playRaf = 0
  private pendingT: number | null = null
  private pendingRaf = 0
  private liveTimer = 0
  private axis = new TimeAxis(300, 1000)
  private link: LinkDrag | null = null
  private snippetTimer = 0
  private snippetActive = false
  private lastSnippetAt = -Infinity
  private assignCache: {
    anns: readonly Annotation[]
    tr: Transcript
    links: ReadonlyMap<number, number | null>
    result: Assignment[]
  } | null = null

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
    this.hintEl = root.querySelector<HTMLElement>('.tl-hint')
    this.hintDefault = this.hintEl?.textContent ?? ''

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e))
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e))
    canvas.addEventListener('pointercancel', () => {
      if (this.link) this.cancelLinkDrag()
      else this.flushPending()
    })
    canvas.addEventListener('pointerleave', () => {
      if (!this.link) this.setHint(null)
    })
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

  get isLinking(): boolean {
    return this.link !== null
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
    this.cancelLinkDrag()
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

  /** Move the playhead. Silent: pointer scrubbing goes through scrubTo(), which adds the audio snippet. */
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
    else void this.play()
  }

  /**
   * Replay from the playhead. While a recording covers the current time, the audio element
   * is the clock (so picture and voice cannot drift); outside the recording, or after it
   * ended, the wall clock takes over from where the audio left off.
   */
  async play(): Promise<void> {
    if (this.playing) return
    const end = this.sessionLength()
    if (end <= 0) return
    let start = this.scrubT ?? 0
    if (start >= end - 1) start = 0
    this.playing = true
    this.playBtn.textContent = '⏸'
    this.stopSnippet()
    const token = ++this.playToken
    const audio = this.host.getAudio()
    const aStart = this.host.getAudioStartMs()
    const aEnd = aStart + Math.max(0, this.host.getAudioDurationMs())

    const startAudioAt = async (t: number): Promise<boolean> => {
      if (!audio || t < aStart || t >= aEnd) return false
      try {
        audio.currentTime = (t - aStart) / 1000
        await audio.play()
        return true
      } catch {
        return false // missing/blocked/aborted audio must never break replay
      }
    }

    let audioOn = false
    let audioTried = false
    if (audio && start >= aStart && start < aEnd) {
      audioTried = true
      audioOn = await startAudioAt(start)
      if (token !== this.playToken) {
        if (audioOn) this.pauseAudio()
        return // paused / restarted while the audio was starting
      }
    }

    let baseT = start
    let baseWall = performance.now()
    const loop = (): void => {
      if (!this.playing || token !== this.playToken) return
      let t = baseT
      if (audioOn && audio) {
        const at = aStart + audio.currentTime * 1000
        if (audio.ended || audio.paused || at >= aEnd) {
          audioOn = false // hand over to the wall clock from here
          baseT = at
          baseWall = performance.now()
        } else {
          t = at
        }
      }
      if (!audioOn) {
        t = baseT + (performance.now() - baseWall)
        if (audio && !audioTried && t >= aStart && t < aEnd) {
          audioTried = true // entering the recording mid-replay: start the voice in sync
          void startAudioAt(t).then((ok) => {
            if (!ok) return
            if (this.playing && token === this.playToken) audioOn = true
            else this.pauseAudio()
          })
        }
      }
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
    this.stopSnippet()
    if (!this.playing) return
    this.playing = false
    this.playToken++
    cancelAnimationFrame(this.playRaf)
    this.playBtn.textContent = '▶'
    this.pauseAudio()
  }

  private pauseAudio(): void {
    try {
      this.host.getAudio()?.pause()
    } catch {
      /* no audio, nothing to pause */
    }
  }

  // ---------- audio snippet while scrubbing ----------

  private stopSnippet(): void {
    window.clearTimeout(this.snippetTimer)
    this.snippetTimer = 0
    if (this.snippetActive) {
      this.snippetActive = false
      this.pauseAudio()
    }
  }

  /** ~90 ms of the recording at t, at most once per 120 ms, so dragging the playhead is audible. */
  private playSnippet(t: number): void {
    if (this.playing) return
    const audio = this.host.getAudio()
    if (!audio) return
    const aStart = this.host.getAudioStartMs()
    const aEnd = aStart + Math.max(0, this.host.getAudioDurationMs())
    if (t < aStart || t >= aEnd) return
    const stamp = performance.now()
    if (stamp - this.lastSnippetAt < SNIPPET_THROTTLE_MS) return
    this.lastSnippetAt = stamp
    window.clearTimeout(this.snippetTimer)
    try {
      audio.currentTime = (t - aStart) / 1000
      this.snippetActive = true
      audio.play().catch(() => undefined)
    } catch {
      this.snippetActive = false
      return
    }
    this.snippetTimer = window.setTimeout(() => {
      this.snippetTimer = 0
      this.snippetActive = false
      this.pauseAudio()
    }, SNIPPET_MS)
  }

  private scrubTo(t: number): void {
    this.seek(t)
    this.playSnippet(this.scrubT ?? t)
  }

  // ---------- pointer: scrub, or drag a speech segment onto an annotation ----------

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    this.pause()
    const x = this.localX(e)
    const y = this.localY(e)
    const seg = this.segmentAt(x, y)
    this.canvas.setPointerCapture(e.pointerId)
    if (seg !== null) {
      this.link = { seg, startX: x, startY: y, x, y, moved: false, target: null, pointerId: e.pointerId }
      this.canvas.style.cursor = 'grabbing'
      this.setHint('주석 위에 놓아 연결 · 음성 빈 곳은 자동 연결로 되돌림 · Esc 취소')
      this.refresh()
      return
    }
    this.queue(this.axis.tOf(x))
  }

  private onPointerMove(e: PointerEvent): void {
    const x = this.localX(e)
    const y = this.localY(e)
    if (this.link) {
      const l = this.link
      l.x = x
      l.y = y
      if (!l.moved && Math.hypot(x - l.startX, y - l.startY) >= DRAG_THRESHOLD) l.moved = true
      l.target = l.moved ? this.annotationAt(x, y) : null
      this.refresh()
      return
    }
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.queue(this.axis.tOf(x))
      return
    }
    // hover: full text of the segment under the pointer
    const seg = this.segmentAt(x, y)
    const tr = this.host.getTranscript()
    this.canvas.style.cursor = seg !== null ? 'grab' : ''
    this.setHint(seg !== null && tr ? (tr.segments[seg]?.text ?? null) : null)
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.canvas.hasPointerCapture(e.pointerId)) return
    this.canvas.releasePointerCapture(e.pointerId)
    const x = this.localX(e)
    const y = this.localY(e)
    if (this.link) {
      const l = this.link
      this.endLink()
      if (!l.moved) {
        this.scrubTo(this.axis.tOf(x)) // a plain click on a segment just scrubs
        return
      }
      const target = this.annotationAt(x, y)
      if (target !== null) this.host.onLink(l.seg, target)
      else if (this.inVoiceLane(y) && this.segmentAt(x, y) === null && this.host.getLinks().has(l.seg)) {
        this.host.onUnlink(l.seg)
      }
      this.refresh()
      return
    }
    cancelAnimationFrame(this.pendingRaf)
    this.pendingRaf = 0
    this.pendingT = null
    this.scrubTo(this.axis.tOf(x)) // exact final position
  }

  /** Escape: abort a link drag. Returns true when there was one. */
  cancelLinkDrag(): boolean {
    const l = this.link
    if (!l) return false
    try {
      if (this.canvas.hasPointerCapture(l.pointerId)) this.canvas.releasePointerCapture(l.pointerId)
    } catch {
      /* capture already gone */
    }
    this.endLink()
    this.refresh()
    return true
  }

  private endLink(): void {
    this.link = null
    this.canvas.style.cursor = ''
    this.setHint(null)
  }

  private setHint(text: string | null): void {
    if (this.hintEl) this.hintEl.textContent = text ?? this.hintDefault
  }

  private localX(e: PointerEvent): number {
    return e.clientX - this.canvas.getBoundingClientRect().left
  }

  private localY(e: PointerEvent): number {
    return e.clientY - this.canvas.getBoundingClientRect().top
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
    this.scrubTo(t)
  }

  // ---------- hit testing ----------

  private inVoiceLane(y: number): boolean {
    const ly = laneY(VOICE_LANE)
    return y >= ly - 2 && y <= ly + LANE_H + 2
  }

  private segBounds(seg: Segment): { x0: number; x1: number } {
    const x0 = this.axis.xOf(seg.start)
    return { x0, x1: Math.max(x0 + 3, this.axis.xOf(seg.end)) }
  }

  private segmentAt(x: number, y: number): number | null {
    const tr = this.host.getTranscript()
    if (!tr || !this.inVoiceLane(y)) return null
    for (let i = tr.segments.length - 1; i >= 0; i--) {
      const { x0, x1 } = this.segBounds(tr.segments[i])
      if (x >= x0 - 2 && x <= x1 + 2) return i
    }
    return null
  }

  /** Annotation bar / marker under the pointer in any of the annotation lanes. */
  private annotationAt(x: number, y: number): number | null {
    const anns = this.host.getAnnotations()
    let best: number | null = null
    let bestD = Infinity
    LANES.forEach((lane, li) => {
      const ly = laneY(li)
      if (y < ly - 2 || y > ly + LANE_H + 2) return
      anns.forEach((a, i) => {
        if (!lane.kinds.includes(a.kind)) return
        const x0 = this.axis.xOf(a.tStart)
        if (isMarker(a)) {
          const d = Math.abs(x - x0)
          if (d <= MARKER_HIT && d < bestD) {
            best = i
            bestD = d
          }
        } else {
          const x1 = Math.max(x0 + 3, this.axis.xOf(a.tEnd))
          if (x >= x0 - 2 && x <= x1 + 2) {
            best = i // later index is drawn on top
            bestD = 0
          }
        }
      })
    })
    return best
  }

  // ---------- drawing ----------

  /** Everything the replay has to cover: annotations, speech and the recording itself. */
  private sessionLength(): number {
    const tr = this.host.getTranscript()
    let end = sessionEnd(this.host.getAnnotations(), tr?.segments ?? [])
    if (this.host.getAudio()) {
      end = Math.max(end, this.host.getAudioStartMs() + Math.max(0, this.host.getAudioDurationMs()))
    }
    return end
  }

  private duration(): number {
    const live = this.scrubT === null ? this.host.liveNow() : 0
    return Math.max(1000, this.sessionLength(), live) * 1.02
  }

  private assignments(): Assignment[] {
    const tr = this.host.getTranscript()
    if (!tr) return []
    const anns = this.host.getAnnotations()
    const links = this.host.getLinks()
    const c = this.assignCache
    if (c && c.anns === anns && c.tr === tr && c.links === links) return c.result
    const result = alignSegments(anns, tr.segments, { manual: links })
    this.assignCache = { anns, tr, links, result }
    return result
  }

  refresh(): void {
    if (!this.isOpen) return
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(120, this.root.clientWidth - 16)
    const height = RULER_H + LANE_COUNT * (LANE_H + LANE_GAP) + 4
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

    for (let li = 0; li < LANE_COUNT; li++) {
      const y = laneY(li)
      ctx.fillStyle = '#26262c'
      ctx.fillRect(PAD_L, y, axis.span, LANE_H)
      ctx.fillStyle = '#6d6d78'
      ctx.font = '10px system-ui, "Malgun Gothic", sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(li === VOICE_LANE ? '음성' : LANES[li].label, PAD_L + 3, y + LANE_H / 2)
    }
    LANES.forEach((lane, li) => {
      const y = laneY(li)
      annotations.forEach((a, i) => {
        if (!lane.kinds.includes(a.kind)) return
        this.drawBar(ctx, axis, a, i, y)
      })
    })
    this.drawSegments(ctx, axis, laneY(VOICE_LANE))

    const t = this.scrubT ?? this.host.liveNow()
    this.drawPlayhead(ctx, axis.xOf(Math.min(t, duration)), height)
    this.drawLinkDrag(ctx, axis)

    const annTotal = fmtClock(sessionEnd(annotations))
    this.clockEl.textContent =
      this.scrubT === null
        ? `LIVE ${fmtClock(this.host.liveNow())} · 주석 ${annTotal}`
        : `${fmtClock(this.scrubT)} / ${fmtClock(this.sessionLength())}`
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

  /** One bar per transcript segment: text, faint word ticks and the linked annotation number. */
  private drawSegments(ctx: CanvasRenderingContext2D, axis: TimeAxis, y: number): void {
    const tr = this.host.getTranscript()
    if (!tr) return
    const assigns = this.assignments()
    ctx.textBaseline = 'middle'
    tr.segments.forEach((seg, i) => {
      const { x0, x1 } = this.segBounds(seg)
      const w = x1 - x0
      ctx.fillStyle = SEG_FILL
      ctx.beginPath()
      ctx.roundRect(x0, y + 2, w, LANE_H - 4, 3)
      ctx.fill()

      if (seg.words) {
        ctx.fillStyle = 'rgba(255,255,255,0.28)'
        for (const word of seg.words) {
          const wx = Math.round(axis.xOf(word.start))
          if (wx > x0 + 1 && wx < x1 - 1) ctx.fillRect(wx, y + 4, 1, LANE_H - 8)
        }
      }

      const a = assigns[i]
      let badgeW = 0
      if (a && a.annotationIndex !== null) {
        const linked = String(a.annotationIndex + 1)
        ctx.font = 'bold 10px system-ui, sans-serif'
        const bw = Math.ceil(ctx.measureText(linked).width) + 8
        const inside = w >= bw + 24
        const bx = inside ? x1 - bw - 2 : x1 + 2
        const manual = a.source === 'manual'
        ctx.fillStyle = manual ? '#ffffff' : 'rgba(10,20,60,0.55)'
        ctx.beginPath()
        ctx.roundRect(bx, y + 3, bw, LANE_H - 6, 3)
        ctx.fill()
        ctx.fillStyle = manual ? '#1b3a8a' : '#fff'
        ctx.textAlign = 'center'
        ctx.fillText(linked, bx + bw / 2, y + LANE_H / 2 + 0.5)
        ctx.textAlign = 'start'
        if (inside) badgeW = bw
      }

      const textW = w - 6 - badgeW
      if (textW > 6) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(x0 + 3, y + 2, textW, LANE_H - 4)
        ctx.clip()
        ctx.fillStyle = '#fff'
        ctx.font = '10px system-ui, "Malgun Gothic", sans-serif'
        ctx.fillText(seg.text.trim(), x0 + 4, y + LANE_H / 2)
        ctx.restore()
      }
    })
  }

  /** Highlight of the annotation under the pointer plus the rubber-band line from the dragged segment. */
  private drawLinkDrag(ctx: CanvasRenderingContext2D, axis: TimeAxis): void {
    const l = this.link
    const tr = this.host.getTranscript()
    if (!l || !tr) return
    const seg = tr.segments[l.seg]
    if (!seg) return
    const vy = laneY(VOICE_LANE)
    const { x0, x1 } = this.segBounds(seg)
    ctx.save()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x0 - 1, vy + 1, x1 - x0 + 2, LANE_H - 2, 4)
    ctx.stroke()

    if (l.target !== null) {
      const a = this.host.getAnnotations()[l.target]
      if (a) {
        const li = LANES.findIndex((lane) => lane.kinds.includes(a.kind))
        const ay = laneY(Math.max(0, li))
        const ax0 = axis.xOf(a.tStart)
        ctx.strokeStyle = '#ffe066'
        ctx.lineWidth = 2
        ctx.beginPath()
        if (isMarker(a)) {
          ctx.moveTo(ax0, ay + 1)
          ctx.lineTo(ax0 + 8, ay + LANE_H / 2)
          ctx.lineTo(ax0, ay + LANE_H - 1)
          ctx.lineTo(ax0 - 8, ay + LANE_H / 2)
          ctx.closePath()
        } else {
          const ax1 = Math.max(ax0 + 3, axis.xOf(a.tEnd))
          ctx.roundRect(ax0 - 2, ay + 1, ax1 - ax0 + 4, LANE_H - 2, 4)
        }
        ctx.stroke()
      }
    }

    if (l.moved) {
      const lineColor = l.target !== null ? '#ffe066' : 'rgba(255,255,255,0.8)'
      ctx.strokeStyle = lineColor
      ctx.fillStyle = lineColor
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo((x0 + x1) / 2, vy + LANE_H / 2)
      ctx.lineTo(l.x, l.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(l.x, l.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
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
