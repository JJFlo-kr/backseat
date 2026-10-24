import type {
  EditorInit, ExportPayload, Annotation, AgentTarget, AgentKind, Point, Transcript, Rect, CompareMode, CaptureMeta, SendOptions,
  SendTargetView, DeliveryStatus, PreflightReport
} from '../../shared/types'
import { pointsForProgress, sessionEnd } from '../../shared/align'
import { History } from './history'
import { linksAt, type Doc } from './doc'
import { runSend, type SttOutcome } from './sendflow'
import { Hotkeys } from './hotkeys'
import { Timeline } from './timeline'
import { ColorPicker, colorButton, setColorButton } from './colorpicker'
import {
  type Tool, type TextStyle, type ToolPrefs, isDrawTool, isTextStyle, defaultPrefs, loadPrefs, savePrefs,
  nearest, PREFS_KEY, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH, TEXT_SIZES, BADGE_SIZES, BLUR_STRENGTHS, DEFAULT_BADGE_SIZE, DEFAULT_BLUR
} from './prefs'
import {
  preflight, summaryParts, voiceMissing, chipView, viewFromAgent, initialTarget, deliveryView, statusOf, mergeUpdate,
  type DeliveryAction, type DeliveryContext
} from './delivery'
import { normalizeHex } from '../../shared/palette'
import { t, setMessages, applyDom, isLocale, getLocale, type Locale } from '../../shared/i18n'
import '@fontsource/noto-sans-kr/500.css'
import '@fontsource/noto-sans-kr/700.css'
import '@fontsource/nanum-gothic/700.css'
import '@fontsource/nanum-pen-script/400.css'
import '@fontsource/jua/400.css'
import '@fontsource/do-hyeon/400.css'
import '@fontsource/black-han-sans/400.css'

type DragTool = 'arrow' | 'rect' | 'badge' | 'blur'
type StrokeAnn = Extract<Annotation, { kind: 'stroke' }>
type ArrowAnn = Extract<Annotation, { kind: 'arrow' }>
type RectAnn = Extract<Annotation, { kind: 'rect' }>
type BadgeAnn = Extract<Annotation, { kind: 'badge' }>
type BlurAnn = Extract<Annotation, { kind: 'blur' }>
type TextAnn = Extract<Annotation, { kind: 'text' }>

const DEFAULT_FONT = 'Noto Sans KR'
/** Text tool default per UI language: the Japanese / Chinese faces have the glyphs Noto Sans KR lacks. */
const LOCALE_FONT: Partial<Record<Locale, string>> = { ja: 'Noto Sans JP', 'zh-CN': 'Noto Sans SC', 'zh-TW': 'Noto Sans TC' }
const FALLBACK_FONTS = 'system-ui, "Malgun Gothic", "Yu Gothic UI", "Microsoft YaHei UI", "Microsoft JhengHei UI", sans-serif'
/**
 * The Japanese and Chinese faces are large (≈7 MB of subsets each): their @font-face rules are only
 * added when one of them is used (UI language, font menu, or a text annotation that names it).
 */
const LAZY_FONT_CSS: Record<string, () => Promise<unknown>> = {
  'Noto Sans JP': () => Promise.all([import('@fontsource/noto-sans-jp/400.css'), import('@fontsource/noto-sans-jp/700.css')]),
  'Noto Sans SC': () => Promise.all([import('@fontsource/noto-sans-sc/400.css'), import('@fontsource/noto-sans-sc/700.css')]),
  'Noto Sans TC': () => Promise.all([import('@fontsource/noto-sans-tc/400.css'), import('@fontsource/noto-sans-tc/700.css')])
}
/** Families shipped with the app (@fontsource); everything else is the system UI font. */
const BUNDLED_FONTS: ReadonlySet<string> = new Set([
  'Noto Sans KR', 'Nanum Gothic', 'Nanum Pen Script', 'Jua', 'Do Hyeon', 'Black Han Sans', ...Object.keys(LAZY_FONT_CSS)
])
/** Gothic faces are bundled bold; the display / handwriting faces only have a regular cut. */
const BOLD_FONTS: ReadonlySet<string> = new Set(['Noto Sans KR', 'Nanum Gothic', ...Object.keys(LAZY_FONT_CSS)])
const ERASE_TOLERANCE = 6 // CSS px around the eraser path
const MIN_DRAG = 3 // image px
const AUDIO_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

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
const toolbar = byId<HTMLElement>('toolbar')
const toolbar2 = byId<HTMLElement>('toolbar2')
const targetBtn = byId<HTMLButtonElement>('target-btn')
const undoBtn = byId<HTMLButtonElement>('undo')
const redoBtn = byId<HTMLButtonElement>('redo')
const timelineBtn = byId<HTMLButtonElement>('timeline-toggle') // a ⋯ menu item
const compareItem = byId<HTMLButtonElement>('compare-item')
const pinItem = byId<HTMLButtonElement>('pin')
const moreBtn = byId<HTMLButtonElement>('more')
const moreMenu = byId<HTMLElement>('more-menu')
const micBtn = byId<HTMLButtonElement>('mic')
const player = byId<HTMLAudioElement>('player')
const baseCtx = ctxOf(base, true) // blur and the compare diff read it back
const inkCtx = ctxOf(ink)
/** Tool buttons of row 1 and their ⋯ menu items (crop, eraser, and the row-1 tools that did not fit). */
const toolBtns = document.querySelectorAll<HTMLButtonElement>('[data-tool]')
const optEls = Array.from(toolbar2.querySelectorAll<HTMLElement>('[data-opt]'))
const widthInput = byId<HTMLInputElement>('width')
const widthDot = byId<HTMLElement>('width-dot')
const badgeSizeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-badge-size]'))
const badgeNext = byId<HTMLElement>('badge-next')
const blurBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-blur]'))
const cropApplyBtn = byId<HTMLButtonElement>('crop-apply')
const cropCancelBtn = byId<HTMLButtonElement>('crop-cancel')
const textMoreBtn = byId<HTMLButtonElement>('text-more')
const fontSelect = byId<HTMLSelectElement>('font')
const sizeSelect = byId<HTMLSelectElement>('font-size')
const styleBtns = Array.from(byId('text-style').querySelectorAll<HTMLButtonElement>('[data-text-style]'))
const textBar = byId<HTMLElement>('textbar')
const askBar = byId<HTMLElement>('askbar')
const sendBar = byId<HTMLElement>('sendbar')
const summaryEl = byId<HTMLElement>('summary')
const summaryText = byId<HTMLElement>('summary-text')
const voiceLinksBtn = byId<HTMLButtonElement>('voice-links')
const voiceMissingEl = byId<HTMLElement>('voice-missing')
const summaryChanged = byId<HTMLElement>('summary-changed')
const deliveryEl = byId<HTMLElement>('delivery')
const stepsEl = byId<HTMLOListElement>('steps')
const deliveryHeadline = byId<HTMLElement>('delivery-headline')
const deliveryDetail = byId<HTMLElement>('delivery-detail')
const actionBtns: Record<DeliveryAction, HTMLButtonElement> = {
  resend: byId('resend'),
  retarget: byId('retarget'),
  copy: byId('copy-direct'),
  confirm: byId('confirm-target')
}
const newCaptureBtn = byId<HTMLButtonElement>('new-capture')
const boldBtn = byId<HTMLButtonElement>('text-bold')
const italicBtn = byId<HTMLButtonElement>('text-italic')
const colorBtn = colorButton({ id: 'color', label: '', title: '' }) // titles are set in applyColorTitles() once the language is known
byId('color-group').append(colorBtn)
const bgBtn = colorButton({ id: 'text-bg', label: '', title: '' })
const bgAutoBtn = byId<HTMLButtonElement>('text-bg-auto')
bgAutoBtn.before(bgBtn)
const bgOpacityInput = byId<HTMLInputElement>('text-bg-opacity')
const invertBtn = byId<HTMLButtonElement>('text-invert')
const outlineBtn = colorButton({ id: 'text-outline', label: '', title: '' })
byId('outline-group').append(outlineBtn)
const shadowBtn = byId<HTMLButtonElement>('text-shadow')

function setColorTitle(btn: HTMLButtonElement, title: string): void {
  btn.title = title
  btn.setAttribute('aria-label', title)
}
/** The colour buttons are created in code (module scope runs before the language arrives): name them after init. */
function applyColorTitles(): void {
  setColorTitle(bgBtn, t('editor.text.plateColor'))
  setColorTitle(outlineBtn, t('editor.text.outlineColor'))
}

let started = false // init received (guards double init)
let init: EditorInit | null = null // set once the image is drawn
let t0 = 0
let tool: Tool = 'pen'
/** Each tool's last options and the last drawing tool (prefs.ts); loaded in the init handler. */
let prefs: ToolPrefs = defaultPrefs(DEFAULT_FONT)
/** The self-test keeps its own key so it never changes what the user's editor remembers. */
let prefsKey = PREFS_KEY
function prefsStore(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
// The working values of the selected tool (the drawing code reads these); setTool() swaps them per tool.
let color = prefs.pen.color
let widthCss = DEFAULT_WIDTH
let badgeSizeCss = DEFAULT_BADGE_SIZE
let blurCss = DEFAULT_BLUR
let fontFamily: string | undefined = DEFAULT_FONT // undefined = system UI font
let fontSizeCss = 24
let textStyle: TextStyle = 'plate'
/** Plate colour '#RRGGBB'; undefined = automatic (dark or white by text brightness). */
let textBg: string | undefined
/** Plate opacity 0..1; undefined = the automatic plate's own alpha. */
let textBgOpacity: number | undefined
/** Outline colour '#RRGGBB'; undefined = translucent black. */
let textOutline: string | undefined
let textShadow = false
/** undefined = the font's default weight (see defaultBold). */
let textBold: boolean | undefined
let textItalic = false
let view = 1 // displayed size / natural on-screen size
/** Bumped by every new recording; manual links belong to one revision (see doc.ts linksAt). */
let transcriptRev = 0
let doc: Doc = { annotations: [], links: new Map(), crop: { x: 0, y: 0, width: 0, height: 0 }, linksRev: 0 }
let annotations: readonly Annotation[] = doc.annotations
let links: ReadonlyMap<number, number | null> = doc.links
let crop: Rect = doc.crop // mirrors doc.crop; the canvases are exactly this big
let orig: HTMLImageElement | null = null // the untouched capture; crops re-blit from it
const history = new History<Doc>(100)
let drawing: StrokeAnn | null = null
/** In-progress drag of an arrow / rect / badge / blur. */
let shape: { tool: DragTool; start: Point; cur: Point; tStart: number } | null = null
/** In-progress drag of an existing text annotation (text / move). */
let moveDrag: { index: number; orig: TextAnn; ann: TextAnn; start: Point; moved: boolean } | null = null
/** In-progress eraser sweep: indices hit so far (hidden live, deleted on pointerup). */
let erasing: { hits: Set<number>; last: Point } | null = null
/** In-progress crop drag (image px). */
let cropDrag: { start: Point; cur: Point } | null = null
/** A dragged crop waiting for 적용 (Enter) or 취소 (Esc), image px. */
let cropPending: Rect | null = null
/** The text tool's 세부 (details) row is open. */
let textDetailsOpen = false
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
/** The open text input: a new text (index -1) or an edit of annotations[index]. */
interface TextSession {
  box: HTMLTextAreaElement
  index: number
  orig: TextAnn | null
  at: Point
  tStart: number
  color: string
  font: string | undefined
  sizeCss: number
  style: TextStyle
  bg: string | undefined
  bgOpacity: number | undefined
  outline: string | undefined
  shadow: boolean
  bold: boolean | undefined
  italic: boolean
}
let textSession: TextSession | null = null
/** Keeps the text bar visible while an annotation is being re-edited with another tool active. */
let textbarPin = false
let busy = false
let pinned = false // small always-on-top reference window; 전송 no longer closes it
let scrubT: number | null = null // non-null while the timeline is scrubbed/replaying

async function togglePin(): Promise<void> {
  try {
    pinned = await window.backseat.editor.pin()
    document.body.classList.toggle('pinned', pinned)
    pinItem.setAttribute('aria-checked', String(pinned))
    setStatus(pinned ? t('editor.status.pinned') : t('editor.status.unpinned'))
    layout()
    fitToolbar()
  } catch (err) {
    setStatus(t('editor.status.pinFailed', { error: err instanceof Error ? err.message : String(err) }), true)
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

/** Gothic faces and the system font default to bold; display / handwriting faces to regular. */
const defaultBold = (family: string | undefined): boolean => !family || BOLD_FONTS.has(family)

/** Canvas / CSS font shorthand for a text annotation's family, size (px), weight and slant. bold undefined = the font's default. */
function fontString(family: string | undefined, sizePx: number, bold?: boolean, italic?: boolean): string {
  const weight = (bold ?? defaultBold(family)) ? 700 : 400
  const slant = italic ? 'italic ' : ''
  return `${slant}${weight} ${sizePx}px ${family ? `"${family}", ` : ''}${FALLBACK_FONTS}`
}

const fontLoads = new Set<string>() // "font|text" combos already requested
const fontCss = new Map<string, Promise<unknown>>() // lazily added @font-face rules, by family
const fontCssReady = new Set<string>()

/** Add a lazy family's @font-face rules once (no-op for the always-declared faces). */
function loadFontCss(family: string | undefined): Promise<unknown> {
  const load = family ? LAZY_FONT_CSS[family] : undefined
  if (!family || !load) return Promise.resolve()
  let p = fontCss.get(family)
  if (!p) {
    p = load().then(() => { fontCssReady.add(family) }, () => undefined)
    fontCss.set(family, p)
  }
  return p
}

/** Bundled faces load lazily (and per unicode-range subset): request them once and repaint when ready. */
function ensureFont(font: string, text: string): void {
  const family = font.split('"')[1] ?? ''
  if (!BUNDLED_FONTS.has(family)) return
  const key = `${font}|${text}`
  if (fontLoads.has(key) || (!LAZY_FONT_CSS[family] || fontCssReady.has(family)) && document.fonts.check(font, text)) return
  fontLoads.add(key)
  void loadFontCss(family)
    .then(() => document.fonts.load(font, text))
    .then(() => { render(); timeline.refresh() }, () => undefined)
}

/** Resolves once every bundled font the document uses is available (before exporting pixels). */
async function loadDocFonts(): Promise<void> {
  const jobs: Promise<unknown>[] = []
  for (const a of annotations) {
    if (a.kind !== 'text') continue
    const f = fontString(a.font, a.fontSize, a.bold, a.italic)
    if (BUNDLED_FONTS.has(a.font ?? '')) jobs.push(loadFontCss(a.font).then(() => document.fonts.load(f, a.text)).catch(() => undefined))
  }
  if (jobs.length) await Promise.all(jobs)
}

const measureCtx = ctxOf(document.createElement('canvas'))

const LINE_HEIGHT = 1.3 // text line height, in font sizes

interface TextMetrics {
  font: string
  lines: string[]
  /** Widest line. */
  width: number
  /** Ink ascent of the first line / descent of the last, relative to the middle baseline. */
  ascent: number
  descent: number
  pad: number
  lineH: number
  /** Ink height from the first line's top to the last line's bottom (no padding). */
  height: number
}

/** Multi-line box of a text annotation: a.y is the middle of the FIRST line, lines are left-aligned. */
function measureText(a: TextAnn): TextMetrics {
  const font = fontString(a.font, a.fontSize, a.bold, a.italic)
  measureCtx.font = font
  measureCtx.textBaseline = 'middle'
  const lines = a.text.split('\n')
  let width = 0
  for (const l of lines) width = Math.max(width, measureCtx.measureText(l).width)
  // a blank line has no ink: measure a CJK glyph instead so the box keeps its height
  const edge = (l: string): ReturnType<CanvasRenderingContext2D['measureText']> => measureCtx.measureText(l.trim() ? l : '가')
  const lineH = a.fontSize * LINE_HEIGHT
  const ascent = edge(lines[0]).actualBoundingBoxAscent
  const descent = edge(lines[lines.length - 1]).actualBoundingBoxDescent
  return { font, lines, width, ascent, descent, pad: a.fontSize * 0.35, lineH, height: ascent + (lines.length - 1) * lineH + descent }
}

function rectOf(a: TextAnn, m: TextMetrics): Rect {
  return { x: a.x - m.pad, y: a.y - m.ascent - m.pad, width: m.width + m.pad * 2, height: m.height + m.pad * 2 }
}

/** Rect (image px) the text occupies including its plate padding: used for drawing and hit-testing. */
function textRect(a: TextAnn): Rect {
  return rectOf(a, measureText(a))
}

/** '#rrggbb' or 'rgb(r, g, b)' -> perceived brightness 0..1 (unknown strings count as dark). */
function brightness(c: string): number {
  let r = 0
  let g = 0
  let b = 0
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1]
    r = parseInt(h.slice(0, 2), 16)
    g = parseInt(h.slice(2, 4), 16)
    b = parseInt(h.slice(4, 6), 16)
  } else {
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c)
    if (m) { r = Number(m[1]); g = Number(m[2]); b = Number(m[3]) }
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** The automatic plate: light text gets a dark plate, dark / saturated text a white one. */
function autoPlate(textColor: string): { hex: string; alpha: number } {
  return brightness(textColor) > 0.6 ? { hex: '#141418', alpha: 0.78 } : { hex: '#FFFFFF', alpha: 0.85 }
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Plate fill as a CSS colour: bg (or the automatic plate) at bgOpacity (or the automatic alpha). */
function plateColor(textColor: string, bg?: string, bgOpacity?: number): string {
  const auto = autoPlate(textColor)
  const [r, g, b] = hexToRgb(bg ?? auto.hex) ?? hexToRgb(auto.hex) ?? [0, 0, 0]
  return `rgba(${r},${g},${b},${bgOpacity ?? auto.alpha})`
}

/** Soft drop shadow shared by the canvas and the CSS preview (blur / offset scale with the font size). */
const SHADOW_COLOR = 'rgba(0,0,0,0.55)'
const shadowBlur = (fontSize: number): number => fontSize * 0.25
const shadowDy = (fontSize: number): number => fontSize * 0.08

/** Violet "made in Backseat" mark so an AI can tell typed text / numbered badges from real screen content. */
const TAG_COLOR = '#6E56CF'

/** Small rounded square with a white bold "B", centred just inside the box's top-left corner (x, y). s = size in image px. */
function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const cx = x + s * 0.25
  const cy = y + s * 0.25
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(cx - s / 2, cy - s / 2, s, s, s * 0.28)
  ctx.fillStyle = TAG_COLOR
  ctx.fill()
  ctx.lineWidth = s / 10
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${Math.round(s * 0.7)}px system-ui, "Malgun Gothic", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('B', cx, cy + s * 0.04)
  ctx.restore()
}

function drawText(ctx: CanvasRenderingContext2D, a: TextAnn): void {
  const m = measureText(a)
  ensureFont(m.font, a.text)
  const box = rectOf(a, m)
  ctx.save()
  ctx.font = m.font
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'start'
  const style = a.style ?? 'plate'
  const shadowOn = (): void => {
    ctx.shadowColor = SHADOW_COLOR
    ctx.shadowBlur = shadowBlur(a.fontSize)
    ctx.shadowOffsetY = shadowDy(a.fontSize)
  }
  const shadowOff = (): void => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0 }
  if (style === 'plate') {
    ctx.fillStyle = plateColor(a.color, a.bg, a.bgOpacity)
    if (a.shadow) shadowOn()
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, box.width, box.height, a.fontSize * 0.3)
    ctx.fill()
    shadowOff()
  } else if (style === 'outline') {
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(1, a.fontSize / 9)
    ctx.strokeStyle = a.outline ?? 'rgba(0,0,0,0.6)'
    if (a.shadow) shadowOn() // the outlined silhouette casts the shadow; the fill below stays crisp
    m.lines.forEach((l, i) => ctx.strokeText(l, a.x, a.y + i * m.lineH))
    shadowOff()
  } else if (a.shadow) shadowOn()
  ctx.fillStyle = a.color
  m.lines.forEach((l, i) => ctx.fillText(l, a.x, a.y + i * m.lineH))
  ctx.restore() // also clears the shadow before the tag
  drawTag(ctx, box.x, box.y, Math.max(9 * (init?.meta.scaleFactor ?? 1), a.fontSize * 0.42))
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
  const stroke = ctx.lineWidth
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.stroke()
  // violet outer ring = Backseat mark
  const ring = Math.max(1.5, a.size / 9)
  ctx.beginPath()
  ctx.arc(a.x, a.y, r + ring / 2 + stroke, 0, Math.PI * 2)
  ctx.lineWidth = ring
  ctx.strokeStyle = TAG_COLOR
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

/**
 * Draw the whole document: live (t = null) or as it looked at time t. Badges are numbered by array order.
 * skipBlur: the blurs are already in the background (maskedBase), as in video frames.
 */
function drawAll(ctx: CanvasRenderingContext2D, t: number | null, skipBlur = false): void {
  let badgeNo = 0
  for (let i = 0; i < annotations.length; i++) {
    if (skipBlur && annotations[i].kind === 'blur') continue
    if (textSession && textSession.index === i) continue // being edited: the text box shows it
    if (erasing?.hits.has(i)) continue // swept by the eraser: already gone visually, committed on pointerup
    const a = moveDrag && moveDrag.index === i ? moveDrag.ann : annotations[i]
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
  const cropSel = cropDrag ? normRect(cropDrag.start, cropDrag.cur) : cropPending
  if (cropSel && init) {
    // Dim everything outside the future crop; dashed outline on it.
    const r = cropSel
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
  const prev = view
  view = Math.min(1, availW / cssW, availH / cssH)
  for (const c of [base, cmp, ink]) {
    c.style.width = `${cssW * view}px`
    c.style.height = `${cssH * view}px`
  }
  // A row opening or closing (세부, comparison, send bar) resizes the image under an open text box.
  if (textSession && view !== prev) placeTextBox(textSession)
}

/** Keep an open text box on its anchor and at its size after the image was re-laid-out. */
function placeTextBox(sess: TextSession): void {
  const k = (cssPx(1) * view) // image px -> wrap CSS px
  sess.box.style.left = `${sess.at.x * k}px`
  sess.box.style.top = `${sess.at.y * k}px`
  styleTextBox(sess)
}

/** CSS px (at view 1) per image px. */
const cssPx = (imgPx: number): number => imgPx / (init?.meta.scaleFactor ?? 1)

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
      return textRect(a)
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
    crop: { x: crop.x + x, y: crop.y + y, width: w, height: h },
    linksRev: transcriptRev
  }
  history.commit(t('editor.history.crop'), doc, after)
  setDoc(after)
  afterChange()
  const dropped = before - kept.length
  setStatus(dropped > 0 ? t('editor.status.croppedDropped', { w, h, n: dropped }) : t('editor.status.cropped', { w, h }))
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
    const before = t('editor.compare.before')
    const after = t('editor.compare.after')
    // wide enough for the (language-dependent) labels; 3.2 font sizes fits the Korean ones
    const boxW = Math.max(fs * 3.2, cmpCtx.measureText(before).width + 8, cmpCtx.measureText(after).width + 8)
    cmpCtx.fillRect(Math.max(0, wx - boxW), 0, boxW, fs * 1.5)
    cmpCtx.fillRect(wx, 0, boxW, fs * 1.5)
    cmpCtx.fillStyle = '#fff'
    cmpCtx.textAlign = 'right'
    cmpCtx.fillText(before, wx - 4, fs * 0.25)
    cmpCtx.textAlign = 'left'
    cmpCtx.fillText(after, wx + 4, fs * 0.25)
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

/** The comparison bar shows only while comparing; it is turned on from ⋯ or with O. */
function syncCompareUi(): void {
  compareBar.hidden = compareImg === null || !cmpOn
  compareItem.setAttribute('aria-checked', String(cmpOn))
  compareModeBtns.forEach((b) => b.classList.toggle('active', b.dataset.cmpMode === cmpMode))
  opacityInput.parentElement?.classList.toggle('off', cmpMode !== 'overlay')
  wipeInput.parentElement?.classList.toggle('off', cmpMode !== 'wipe')
  compareBar.classList.toggle('on', cmpOn)
  if (compareImg) diffLabel.textContent = t('editor.compare.diffLabel', { percent: diffPercent() })
}

function setCompare(on: boolean): void {
  if (!compareImg) { setStatus(t('editor.compare.none', { item: t('tray.recaptureLast') })); return }
  cmpOn = on
  if (on) cmpUsed = true
  syncCompareUi()
  renderCompare()
  setStatus(on ? t('editor.compare.status', { mode: cmpLabel(cmpMode) }) : t('editor.compare.off'))
}

function setCompareMode(m: CompareMode): void {
  cmpMode = m
  if (!cmpOn && compareImg) { cmpOn = true; cmpUsed = true }
  syncCompareUi()
  renderCompare()
  if (cmpOn) setStatus(t('editor.compare.status', { mode: cmpLabel(m) }))
}

function cmpLabel(m: CompareMode): string {
  switch (m) {
    case 'overlay': return t('editor.compare.overlay')
    case 'wipe': return t('editor.compare.wipe')
    case 'diff': return t('editor.compare.diff')
  }
}

/** Base image + every annotation on one canvas (image px). */
function flattenCanvas(): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = base.width
  out.height = base.height
  const ctx = ctxOf(out, true)
  ctx.drawImage(base, 0, 0)
  drawAll(ctx, null) // always the full picture, even while scrubbed
  return out
}

function flatten(): string {
  return flattenCanvas().toDataURL('image/png')
}

/**
 * The original capture with only the blur (privacy) annotations applied: no other annotations, no tags.
 * The common background of every export that shows the capture over time (screenshot.png, video frames).
 */
function maskedBase(): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = base.width
  out.height = base.height
  const ctx = ctxOf(out)
  ctx.drawImage(base, 0, 0)
  for (const a of annotations) if (a.kind === 'blur') drawBlur(ctx, a)
  return out
}

function flattenBase(): string {
  return maskedBase().toDataURL('image/png')
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
    commitLinks(t('editor.history.linkAdd'), next)
  },
  onUnlink(segmentIndex) {
    if (!links.has(segmentIndex)) return
    const next = new Map(links)
    next.delete(segmentIndex)
    commitLinks(t('editor.history.linkRemove'), next)
  },
  getAudio: () => (audioUrl ? player : null),
  getAudioStartMs: () => audioStartMs,
  getAudioDurationMs: () => audioDurationMs
})

function setDoc(next: Doc): void {
  doc = next
  annotations = next.annotations
  links = linksAt(next, transcriptRev) // an undo across a new recording must not revive its old links
  if (!sameRect(next.crop, crop)) applyCrop(next.crop) // undo/redo across a crop re-blits the image
}

function afterChange(): void {
  render()
  timeline.refresh()
  undoBtn.disabled = !history.canUndo
  redoBtn.disabled = !history.canRedo
  undoBtn.title = history.undoLabel ? t('editor.history.undoTip', { label: history.undoLabel }) : hotkeys.label('undo')
  redoBtn.title = history.redoLabel ? t('editor.history.redoTip', { label: history.redoLabel }) : hotkeys.label('redo')
  syncBadgeNext()
  contentChanged()
}

function commit(label: string, next: readonly Annotation[]): void {
  const after: Doc = { annotations: next, links, crop, linksRev: transcriptRev }
  history.commit(label, doc, after)
  setDoc(after)
  afterChange()
}

function commitLinks(label: string, nextLinks: ReadonlyMap<number, number | null>): void {
  const after: Doc = { annotations, links: nextLinks, crop, linksRev: transcriptRev }
  history.commit(label, doc, after)
  setDoc(after)
  afterChange()
}

function undo(): void {
  if (drawing || shape || cropDrag || moveDrag || erasing) return
  if (cropPending) { cancelPendingCrop(); return } // first undo drops the waiting crop selection
  commitPendingText()
  const prev = history.undo()
  if (prev === undefined) return
  setDoc(prev)
  afterChange()
}

function redo(): void {
  if (drawing || shape || cropDrag || moveDrag || erasing) return
  cancelPendingCrop()
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

/** The optional annotation fields of a text: written only when they differ from the default look, so old text stays byte-identical. */
type TextExtras = Pick<TextAnn, 'bg' | 'bgOpacity' | 'outline' | 'shadow' | 'bold' | 'italic'>
const EXTRA_KEYS = ['bg', 'bgOpacity', 'outline', 'shadow', 'bold', 'italic'] as const

function textExtras(sess: TextSession): TextExtras {
  const out: TextExtras = {}
  if (sess.style === 'plate') {
    if (sess.bg !== undefined) out.bg = sess.bg
    if (sess.bgOpacity !== undefined && Math.abs(sess.bgOpacity - autoPlate(sess.color).alpha) > 0.004) {
      out.bgOpacity = Math.round(sess.bgOpacity * 100) / 100
    }
  }
  if (sess.style === 'outline' && sess.outline !== undefined) out.outline = sess.outline
  if (sess.shadow) out.shadow = true
  if (sess.bold !== undefined && sess.bold !== defaultBold(sess.font)) out.bold = sess.bold
  if (sess.italic) out.italic = true
  return out
}

/** A copy of the annotation whose optional style fields are exactly `ex`. */
function withExtras(a: TextAnn, ex: TextExtras): TextAnn {
  const next = { ...a }
  for (const k of EXTRA_KEYS) delete next[k]
  return Object.assign(next, ex)
}

/** Mirror the session's font, size, colour, plate, outline, shadow, weight and slant onto the live text box. */
function styleTextBox(sess: TextSession): void {
  const box = sess.box
  const px = sess.sizeCss * view
  const plate = sess.style === 'plate'
  const outline = sess.style === 'outline'
  const shadow = `0 ${shadowDy(px)}px ${shadowBlur(px)}px ${SHADOW_COLOR}`
  box.style.font = fontString(sess.font, px, sess.bold, sess.italic)
  box.style.lineHeight = String(LINE_HEIGHT)
  box.style.color = sess.color
  box.style.background = plate ? plateColor(sess.color, sess.bg, sess.bgOpacity) : 'transparent'
  box.style.boxShadow = plate && sess.shadow ? shadow : 'none'
  box.style.setProperty('-webkit-text-stroke', outline ? `${Math.max(1, px / 9)}px ${sess.outline ?? 'rgba(0,0,0,0.6)'}` : '0')
  box.style.textShadow = !plate && sess.shadow ? shadow : 'none'
  box.classList.toggle('st-outline', outline)
}

function finishText(sess: TextSession, commitIt: boolean): void {
  if (textSession !== sess) return
  textSession = null // first, so the blur fired by remove() is a no-op
  textbarPin = false
  const text = sess.box.value.trim()
  sess.box.remove()
  syncToolbar() // the text bar hides again unless the text tool is active
  if (!commitIt || !text || !init) { render(); return }
  const fontSize = sess.sizeCss * init.meta.scaleFactor
  const ex = textExtras(sess)
  if (sess.orig) {
    const o = sess.orig
    const unchanged =
      o.text === text && o.color === sess.color && o.font === sess.font &&
      (o.style ?? 'plate') === sess.style && Math.abs(o.fontSize - fontSize) < 0.01 &&
      EXTRA_KEYS.every((k) => o[k] === ex[k])
    if (unchanged || annotations[sess.index] !== o) { render(); return }
    const next = [...annotations]
    next[sess.index] = { ...withExtras(o, ex), text, color: sess.color, font: sess.font, style: sess.style, fontSize, tEnd: now() }
    commit(t('editor.history.textEdit'), next)
    return
  }
  commit(t('editor.history.text'), [
    ...annotations,
    {
      kind: 'text', text, x: sess.at.x, y: sess.at.y, color: sess.color, fontSize,
      font: sess.font, style: sess.style, ...ex, tStart: sess.tStart, tEnd: now()
    }
  ])
}

function commitPendingText(): void {
  if (textSession) finishText(textSession, true)
}

const isToolbarControl = (n: EventTarget | null): boolean =>
  n instanceof HTMLSelectElement || (n instanceof HTMLInputElement && n.type === 'range') ||
  (n instanceof HTMLElement && n.closest('#toolbar2, #textbar') !== null) ||
  (n instanceof Node && picker.root.contains(n)) // the colour popover works on the open text box

/** Controls that need the real mouse-down (focus / drag): selects and sliders (the colour popover has its own handling). */
const isNativeToolbarControl = (n: EventTarget | null): boolean =>
  n instanceof HTMLSelectElement || (n instanceof HTMLInputElement && n.type === 'range')

/** Shift+Enter: insert a line break at the caret (execCommand keeps the box's own undo history). */
function insertNewline(box: HTMLTextAreaElement): void {
  if (document.execCommand('insertText', false, '\n')) return
  box.setRangeText('\n', box.selectionStart, box.selectionEnd, 'end')
  box.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Open the text box at (left, top) in wrap CSS px; `orig` = existing annotation being edited. */
function openTextBox(left: number, top: number, at: Point, index: number, orig: TextAnn | null, initial: string): void {
  const box = document.createElement('textarea')
  box.rows = 1 // auto-grows with the text (field-sizing: content), no scrollbars
  box.wrap = 'off'
  box.className = 'textbox'
  box.spellcheck = false
  box.value = initial
  box.style.left = `${left}px`
  box.style.top = `${top}px`
  const sess: TextSession = {
    box, index, orig, at, tStart: orig ? orig.tStart : now(),
    color, font: fontFamily, sizeCss: fontSizeCss, style: textStyle,
    bg: textBg, bgOpacity: textBgOpacity, outline: textOutline, shadow: textShadow, bold: textBold, italic: textItalic
  }
  styleTextBox(sess)
  box.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return // Korean IME: Enter confirms the composition
    if (ev.key === 'Enter') {
      ev.preventDefault()
      if (ev.shiftKey) insertNewline(box)
      else finishText(sess, true)
    } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finishText(sess, false) }
  })
  box.addEventListener('blur', (ev) => {
    if (isToolbarControl(ev.relatedTarget)) return // picking a font / size / style keeps the box open
    if (picker.isOpen()) return // the colour popover (or its eyedropper) took the focus: the box stays open
    finishText(sess, true)
  })
  textSession = sess
  wrap.appendChild(box)
  syncToolbar() // shows the text bar
  if (orig) render() // hide the original under the box
  setTimeout(() => { box.focus(); if (orig) box.select() }, 0) // after the browser's own mousedown focus handling
}

function startText(p: Point, e: PointerEvent): void {
  const rect = ink.getBoundingClientRect()
  openTextBox(e.clientX - rect.left, e.clientY - rect.top, p, -1, null, '')
}

/** Edit annotations[index] in place: the toolbar adopts its font / size / colour / style / effects. */
function startEditText(index: number): void {
  const a = annotations[index]
  if (!init || !a || a.kind !== 'text') return
  commitPendingText()
  fontFamily = a.font
  textStyle = a.style ?? 'plate'
  color = a.color
  textBg = a.bg
  textBgOpacity = a.bgOpacity
  textOutline = a.outline
  textShadow = a.shadow === true
  textBold = a.bold
  textItalic = a.italic === true
  const css = a.fontSize / init.meta.scaleFactor
  fontSizeCss = nearest(css, TEXT_SIZES)
  textbarPin = true // the text bar shows (and the image is re-laid-out) before the box is positioned
  syncToolbar()
  const r = ink.getBoundingClientRect()
  openTextBox(a.x * (r.width / ink.width), a.y * (r.height / ink.height), { x: a.x, y: a.y }, index, a, a.text)
  if (textSession) { textSession.sizeCss = css; styleTextBox(textSession) } // keep the exact size until the user picks another
}

/** Topmost text annotation whose measured box contains p (image px), or -1. */
function hitText(p: Point): number {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]
    if (a.kind !== 'text' || (textSession && textSession.index === i)) continue
    const r = textRect(a)
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return i
  }
  return -1
}

function endMove(commitIt: boolean): void {
  if (!moveDrag) return
  const m = moveDrag
  moveDrag = null
  if (commitIt && m.moved && annotations[m.index] === m.orig) {
    const next = [...annotations]
    next[m.index] = m.ann
    commit(t('editor.history.textMove'), next)
  } else render()
}

// ---------- eraser ----------

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

function ptSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return dist(p, a)
  const t = clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

function segsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  const o1 = o(a, b, c)
  const o2 = o(a, b, d)
  const o3 = o(c, d, a)
  const o4 = o(c, d, b)
  return o1 !== o2 && o3 !== o4
}

function segSegDist(a: Point, b: Point, c: Point, d: Point): number {
  if (segsCross(a, b, c, d)) return 0
  return Math.min(ptSegDist(a, c, d), ptSegDist(b, c, d), ptSegDist(c, a, b), ptSegDist(d, a, b))
}

/** Distance from segment a-b to the filled rectangle (0 when it touches or lies inside). */
function segRectDist(a: Point, b: Point, r: Rect): number {
  const inside = (p: Point): boolean => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
  if (inside(a) || inside(b)) return 0
  const tl = { x: r.x, y: r.y }
  const tr = { x: r.x + r.width, y: r.y }
  const br = { x: r.x + r.width, y: r.y + r.height }
  const bl = { x: r.x, y: r.y + r.height }
  return Math.min(segSegDist(a, b, tl, tr), segSegDist(a, b, tr, br), segSegDist(a, b, br, bl), segSegDist(a, b, bl, tl))
}

/** Does the eraser path segment p0-p1 touch this annotation? `tol` is the slack in image px. */
function eraserHits(a: Annotation, p0: Point, p1: Point, tol: number): boolean {
  switch (a.kind) {
    case 'stroke': {
      const reach = a.width / 2 + tol
      if (a.points.length === 1) return ptSegDist(a.points[0], p0, p1) <= reach
      for (let i = 1; i < a.points.length; i++) {
        if (segSegDist(a.points[i - 1], a.points[i], p0, p1) <= reach) return true
      }
      return false
    }
    case 'arrow':
      return segSegDist({ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }, p0, p1) <= a.width / 2 + tol
    case 'rect':
    case 'blur':
      return segRectDist(p0, p1, { x: a.x, y: a.y, width: a.w, height: a.h }) <= tol
    case 'badge':
      return ptSegDist({ x: a.x, y: a.y }, p0, p1) <= a.size / 2
    case 'text':
      return segRectDist(p0, p1, textRect(a)) <= 0
  }
}

function eraseSweep(from: Point, to: Point): void {
  if (!erasing || !init) return
  const tol = ERASE_TOLERANCE * init.meta.scaleFactor
  let added = false
  annotations.forEach((a, i) => {
    if (!erasing || erasing.hits.has(i)) return
    if (eraserHits(a, from, to, tol)) { erasing.hits.add(i); added = true }
  })
  erasing.last = to
  if (added) render()
}

function endErase(commitIt: boolean): void {
  if (!erasing) return
  const hits = erasing.hits
  erasing = null
  if (!commitIt || hits.size === 0) { render(); return }
  const kept: Annotation[] = []
  const remap = new Map<number, number>()
  annotations.forEach((a, i) => {
    if (hits.has(i)) return
    remap.set(i, kept.length)
    kept.push(a)
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
  const after: Doc = { annotations: renumbered, links: nextLinks, crop, linksRev: transcriptRev }
  history.commit(t('editor.history.erase'), doc, after)
  setDoc(after)
  afterChange()
  setStatus(t('editor.status.erased', { n: hits.size }))
}

// ---------- pen tool ----------

function toImg(e: MouseEvent): Point {
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
      return { kind, x, y, w, h, strength: blurCss * scale, tStart, tEnd }
    }
    case 'badge': {
      return { kind, x: a.x, y: a.y, n: nextBadgeNo(), color, size: badgeSizeCss * scale, tStart, tEnd }
    }
  }
}

/** Badges number themselves in creation order (renumbered on undo / erase / crop). */
const nextBadgeNo = (): number => annotations.reduce((c, x) => c + (x.kind === 'badge' ? 1 : 0), 0) + 1

function shapeLabel(k: DragTool): string {
  switch (k) {
    case 'arrow': return t('editor.history.arrow')
    case 'rect': return t('editor.history.rect')
    case 'badge': return t('editor.history.badge')
    case 'blur': return t('editor.history.blur')
  }
}

function endShape(commitIt: boolean): void {
  if (!shape || !init) return
  const s = shape
  shape = null
  const a = commitIt ? buildShape(s.tool, s.start, s.cur, s.tStart, now(), init.meta.scaleFactor) : null
  if (a) commit(shapeLabel(s.tool), [...annotations, a])
  else render() // drop the preview
}

ink.addEventListener('pointerdown', (e) => {
  pointerCounts.down++
  if (!init || e.button !== 0 || drawing || shape || cropDrag || moveDrag || erasing) return
  e.preventDefault()
  commitPendingText()
  ensureLive()
  const p = toImg(e)
  if (tool === 'text') {
    const hit = hitText(p)
    if (hit < 0) { startText(p, e); return }
    const orig = annotations[hit]
    if (orig.kind !== 'text') return
    moveDrag = { index: hit, orig, ann: orig, start: p, moved: false }
    ink.setPointerCapture(e.pointerId)
    return
  }
  if (tool === 'eraser') {
    erasing = { hits: new Set<number>(), last: p }
    ink.setPointerCapture(e.pointerId)
    eraseSweep(p, p)
    return
  }
  if (tool === 'crop') {
    cropPending = null // a new drag replaces the waiting selection
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
  if (moveDrag && init) {
    const p = toImg(e)
    const m = moveDrag
    if (!m.moved && dist(p, m.start) < 4 * init.meta.scaleFactor) return // a click, not a drag
    m.moved = true
    m.ann = { ...m.orig, x: m.orig.x + (p.x - m.start.x), y: m.orig.y + (p.y - m.start.y) }
    render()
    return
  }
  if (erasing) {
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    for (const ev of coalesced.length ? coalesced : [e]) {
      if (erasing) eraseSweep(erasing.last, toImg(ev))
    }
    return
  }
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
  if (!drawing) {
    if (tool === 'text' && init) wrap.classList.toggle('over-text', hitText(toImg(e)) >= 0)
    return
  }
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
  commit(t('editor.history.pen'), [...annotations, done])
}
/** End a crop drag: the selection waits for 적용 / Enter (or 취소 / Esc); a tiny drag drops it. */
function endCrop(keep: boolean, at?: Point): void {
  if (!cropDrag) return
  const c = cropDrag
  cropDrag = null
  if (at) c.cur = at
  const r = normRect(c.start, c.cur)
  cropPending = keep && r.width >= MIN_DRAG && r.height >= MIN_DRAG ? r : null
  syncCropButtons()
  render()
  if (cropPending) setStatus(t('editor.status.cropPending'))
}

/** 적용 / Enter: crop, then back to the drawing tool the user had (cropping is a one-off). */
function applyPendingCrop(): void {
  const r = cropPending
  cropPending = null
  syncCropButtons()
  if (!r) return
  applyCropSelection(r)
  if (tool === 'crop') setTool(prefs.tool)
}

function cancelPendingCrop(): void {
  if (!cropPending && !cropDrag) return
  cropDrag = null
  cropPending = null
  syncCropButtons()
  render()
}

function syncCropButtons(): void {
  cropApplyBtn.disabled = cropPending === null
  cropCancelBtn.disabled = cropPending === null
}

ink.addEventListener('pointerup', (e) => {
  pointerCounts.up++
  if (moveDrag) { endMove(true); return }
  if (erasing) { endErase(true); return }
  if (cropDrag) { endCrop(true, toImg(e)); return }
  if (shape) shape.cur = toImg(e)
  endStroke()
  endShape(true)
})
ink.addEventListener('pointerleave', () => wrap.classList.remove('over-text'))
ink.addEventListener('dblclick', (e) => {
  if (!init || tool !== 'text' || drawing || shape || cropDrag || moveDrag || erasing) return
  const hit = hitText(toImg(e))
  if (hit >= 0) { e.preventDefault(); startEditText(hit) }
})
// A capture lost without an up (window focus change, synthetic input): finish instead of sticking.
ink.addEventListener('lostpointercapture', () => {
  if (moveDrag) endMove(true)
  if (erasing) endErase(true)
  if (cropDrag) endCrop(true)
  if (drawing) endStroke()
  if (shape) endShape(true)
})
ink.addEventListener('pointercancel', () => {
  pointerCounts.cancel++
  endMove(false)
  endErase(false)
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
    basePngDataUrl: flattenBase(),
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
  setStatus(t('editor.status.saving'))
  try {
    await settleRecording()
    const payload = buildPayload()
    if (!payload) return
    setStatus(t('editor.status.saving'))
    const r = await window.backseat.editor.save(payload)
    if (r.ok) setStatus(t('editor.status.saved', { path: r.path ?? '' }))
    else if (r.canceled) setStatus(t('editor.status.saveCanceled'))
    else setStatus(t('editor.status.saveFailed', { error: r.error ?? t('editor.status.unknownError') }), true)
  } catch (err) {
    setStatus(t('editor.status.saveFailed', { error: errText(err) }), true)
  } finally {
    busy = false
  }
}

/**
 * 보내기. No question first when everything is ready (request 2): the send bar shows what will go, and
 * afterwards the steps main confirmed. A recording without text stops it: the send bar offers 다시 변환 /
 * 음성 없이 보내기 instead of sending the image as if the spoken part were in it (Codex review F12).
 */
/** How this send differs from a plain 보내기: without the failed voice part, or into the window whose title changed. */
interface SendExtra {
  withoutVoice?: boolean
  confirmTarget?: boolean
}

async function send(extra: SendExtra = {}): Promise<void> {
  const withoutVoice = extra.withoutVoice === true
  if (busy || !init) return
  if (mustPickTarget) {
    setStatus(t('editor.status.pickTarget'), true)
    openTargetMenu()
    return
  }
  busy = true
  let voiceStopped = false
  try {
    const o = await runSend(
      {
        settle: async () => {
          await settleRecording()
          return sttOutcome()
        },
        chooseOnSttFailure: async () => {
          if (withoutVoice) return 'image'
          voiceStopped = true
          return 'cancel'
        },
        retryTranscription: async () => {
          await retryTranscription()
          return sttOutcome()
        },
        deliver: () => {
          const payload = buildPayload()
          if (!payload) throw new Error(t('editor.status.unknownError'))
          const target = currentTarget()
          lastDeliveryCtx = { clipboardOnly: isClipboardOnly(chosenTarget), mcp: target?.method === 'mcp' || target?.source === 'mcp-verified' }
          lastSentWithoutVoice = withoutVoice
          sending = true
          renderSendbar()
          return window.backseat.editor.send(payload, sendOptions(extra))
        }
      }
    )
    const r = o.result
    if (!r) {
      if (voiceStopped) {
        setStatus(t('editor.status.voiceMissing'), true)
        flashSendbar()
      } else setStatus(t('editor.status.sendCanceled'))
      return
    }
    lastDelivery = statusOf(r, { clipboardOnly: lastDeliveryCtx.clipboardOnly === true, target: currentTarget() })
    if (r.error) lastDeliveryCtx.error = r.error
    dirtySinceSend = false
    // The send bar tells what happened; the status line only repeats a failure.
    setStatus(r.ok ? '' : r.message, !r.ok)
    if (r.targetExpired) {
      // The picked window closed: drop it from the menu and make the user choose again (or the clipboard).
      const gone = chosenTarget?.identity?.hwnd
      if (gone) goneHwnds.add(gone)
      chosenTarget = null
      mustPickTarget = true
      showTarget()
      openTargetMenu()
    }
    // The editor stays open after a send (also a pasted one): resend, another destination or copy in place.
  } catch (err) {
    lastDelivery = { sendId: '', reached: [], stoppedAt: { step: 'saved', reason: 'error' } }
    lastDeliveryCtx = { ...lastDeliveryCtx, error: errText(err) }
    dirtySinceSend = false
    setStatus(t('editor.status.sendFailed', { error: errText(err) }), true)
  } finally {
    sending = false
    busy = false
    renderSendbar()
  }
}

/** What the recording amounts to right now: no audio, audio with its transcript, or audio whose transcription failed. */
function sttOutcome(): SttOutcome {
  if (!audioBytes) return 'none'
  return transcript ? 'ok' : 'failed'
}

/** Run speech recognition again on the current recording (after a failure). */
async function retryTranscription(): Promise<void> {
  if (!audioBytes || recTask) return
  const task = transcribeAudio(audioBytes.slice().buffer as ArrayBuffer, audioStartMs, recGen)
  recTask = task
  renderSendbar()
  try {
    await task
  } finally {
    if (recTask === task) recTask = null
    renderSendbar()
  }
}

// ---------- the send bar: what will be sent, then what main could confirm ----------

/** The last send's delivery state (null before the first send) and how to read it. */
let lastDelivery: DeliveryStatus | null = null
let lastDeliveryCtx: DeliveryContext = {}
/** Something 보내기 would send changed after the last send: the bar shows the summary again. */
let dirtySinceSend = false
/** 보내기 is between "deliver" and its result. */
let sending = false
let lastSentWithoutVoice = false

function voiceState(): PreflightReport['voice'] {
  if (active || startingMic) return 'recording'
  if (transcribing || recTask) return 'transcribing'
  if (!audioBytes) return 'none'
  return transcript ? 'ready' : 'failed'
}

const currentPreflight = (): PreflightReport => preflight(init !== null, annotations.length, memoInput.value, voiceState())

function renderSendbar(): void {
  const delivery = sending || (lastDelivery !== null && !dirtySinceSend)
  summaryEl.hidden = delivery
  deliveryEl.hidden = !delivery
  if (delivery) renderDelivery()
  else renderSummary()
}

function renderSummary(): void {
  const r = currentPreflight()
  summaryText.textContent = summaryParts(r, t).join(' · ')
  voiceMissingEl.hidden = !voiceMissing(r)
  voiceLinksBtn.hidden = !(r.voice === 'ready' && transcript !== null && transcript.segments.length > 0)
  summaryChanged.hidden = !(lastDelivery && dirtySinceSend)
}

function renderDelivery(): void {
  const s = sending ? null : lastDelivery
  if (!s) {
    stepsEl.replaceChildren()
    deliveryEl.dataset.tone = 'wait'
    deliveryHeadline.textContent = t('editor.delivery.sending')
    deliveryDetail.textContent = ''
    for (const b of Object.values(actionBtns)) {
      b.disabled = true
      b.classList.remove('primary-action')
    }
    actionBtns.confirm.hidden = true
    return
  }
  const v = deliveryView(s, lastDeliveryCtx, t)
  stepsEl.replaceChildren(...v.steps.map((st) => {
    const li = document.createElement('li')
    li.textContent = st.label
    li.dataset.step = st.step
    if (st.state === 'stopped') li.className = 'stopped'
    return li
  }))
  deliveryEl.dataset.tone = v.tone
  deliveryHeadline.textContent = v.headline
  deliveryDetail.textContent = v.detail
  for (const [k, b] of Object.entries(actionBtns) as [DeliveryAction, HTMLButtonElement][]) {
    b.disabled = false
    b.classList.toggle('primary-action', k === v.primary)
  }
  actionBtns.confirm.hidden = v.primary !== 'confirm' // only after a title change
}

/** Anything 보내기 would send changed (annotations, links, memo, recording). */
function contentChanged(): void {
  if (lastDelivery && !sending) dirtySinceSend = true
  renderSendbar()
}

function flashSendbar(): void {
  sendBar.classList.remove('flash')
  void sendBar.offsetWidth // restart the animation
  sendBar.classList.add('flash')
}

window.backseat.editor.onDeliveryUpdate?.((upd) => {
  const merged = mergeUpdate(lastDelivery, upd)
  if (!merged) return
  lastDelivery = merged
  // Edited since that send: the bar shows the summary, so say it on the status line instead.
  if (dirtySinceSend) setStatus(deliveryView(merged, lastDeliveryCtx, t).headline)
  renderSendbar()
})

memoInput.addEventListener('input', contentChanged)
voiceLinksBtn.addEventListener('click', () => {
  if (!timeline.isOpen) timeline.toggle()
  syncToolbar()
})
byId('stt-retry').addEventListener('click', () => void retryTranscription())
byId('stt-image').addEventListener('click', () => void send({ withoutVoice: true }))
// 다시 보내기 repeats the last choice: a send the user made without its failed voice part stays without it.
actionBtns.resend.addEventListener('click', () => void send({ withoutVoice: lastSentWithoutVoice }))
// The title of the target changed (another tab or chat?): the user says it is the right window, once.
actionBtns.confirm.addEventListener('click', () => void send({ withoutVoice: lastSentWithoutVoice, confirmTarget: true }))
actionBtns.retarget.addEventListener('click', () => openTargetMenu())
actionBtns.copy.addEventListener('click', () => void copy())
byId('close-editor').addEventListener('click', () => window.backseat.editor.close())
newCaptureBtn.addEventListener('click', () => {
  window.backseat.editor.newCapture?.()
})
for (const b of [...Object.values(actionBtns), byId('stt-retry'), byId('stt-image'), voiceLinksBtn]) {
  b.addEventListener('mousedown', (e) => e.preventDefault()) // an open text box keeps the focus
}

// ---------- send target: the chip, and the menu to pick another window for the next sends ----------

let initData: EditorInit | null = null // the init payload as received (`init` is set once the image is drawn)
/** Candidates as main describes them (editor.targets(), phase 2); null = derived from initData.candidates. */
let targetViews: SendTargetView[] | null = null
/** The row picked in the target menu; null = the automatic / pinned target main chose. */
let chosenTarget: SendTargetView | null = null
/** State of the "pin as default" checkbox. */
let pinChecked = false
/** The picked window closed: 보내기 waits until the user picks again (never falls back to another window). */
let mustPickTarget = false

/** The target menu's last row: write the package and copy it, paste nowhere. */
function clipboardOnlyView(): SendTargetView {
  return { source: 'picked', label: t('editor.target.clipboardOnly'), estimated: false, method: 'clipboard' }
}

const isClipboardOnly = (v: SendTargetView | null): boolean => v !== null && v.method === 'clipboard' && !v.identity?.hwnd

/** The target came from the user's pinned default. */
const startPinned = (): boolean => initData?.targetPinned === true || initData?.sendTarget?.source === 'pinned'

/** Where 보내기 goes right now. */
function currentTarget(): SendTargetView | null {
  return chosenTarget ?? (initData ? initialTarget(initData) : null)
}

function showTarget(): void {
  const label = targetBtn.querySelector<HTMLElement>('.tb-label')
  const state = targetBtn.querySelector<HTMLElement>('.tb-state')
  if (!label || !state) return
  const v = currentTarget()
  const chip = chipView(v, t, { expired: mustPickTarget })
  label.textContent = chip.label
  state.textContent = chip.state
  targetBtn.dataset.tone = chip.tone
  const lines = [hotkeys.label('target')]
  if (chip.tone === 'none') lines.unshift(t('editor.chip.noneTip'))
  const id = v?.identity
  if (id?.title && !mustPickTarget) lines.push(`${id.title}${id.process ? ` (${id.process})` : ''}`)
  targetBtn.title = lines.join('\n')
  targetBtn.setAttribute('aria-label', [chip.label, chip.state].filter(Boolean).join(' · '))
  requestAnimationFrame(fitToolbar) // the chip's width changed
}

/** What 보내기 passes to the main process: the picked window and / or a changed pin state. */
function sendOptions(extra: SendExtra = {}): SendOptions {
  const o: SendOptions = { pressEnter: false }
  if (isClipboardOnly(chosenTarget)) o.clipboardOnly = true
  else if (chosenTarget?.identity?.hwnd) o.targetHwnd = chosenTarget.identity.hwnd
  if (pinChecked !== startPinned()) o.pinTarget = pinChecked
  if (extra.withoutVoice) o.withoutVoice = true
  if (extra.confirmTarget) o.confirmTarget = true
  return o
}

function kindName(k: AgentKind): string {
  switch (k) {
    case 'claude-code': return 'Claude Code'
    case 'claude-desktop': return t('editor.target.kindClaudeDesktop')
    case 'cursor': return 'Cursor'
    case 'vscode': return 'VS Code'
    case 'codex': return 'Codex'
    case 'orca': return 'Orca'
    case 'terminal': return t('editor.target.kindTerminal')
    case 'chat': return t('editor.target.kindChat')
    case 'unknown': return t('editor.target.kindUnknown')
  }
}
function kindChip(v: SendTargetView): string {
  const k = v.kind ?? 'unknown'
  if (k === 'chat') return /^slack/i.test(v.label) ? 'Slack' : /^discord/i.test(v.label) ? 'Discord' : kindName('chat')
  return kindName(k)
}
function methodRowHint(m: SendTargetView['method']): string {
  switch (m) {
    case 'paste-path':
    case 'mcp':
      return t('editor.target.hintPastePath')
    case 'paste-image': return t('editor.target.hintPasteImage')
    case 'clipboard': return t('editor.target.hintClipboard')
  }
}

/** Picked windows that turned out closed: not offered again in this editor. */
const goneHwnds = new Set<number>()

/** Other windows the user may pick, front-most first. */
function candidateViews(): SendTargetView[] {
  const views = targetViews ?? (initData?.candidates ?? []).map((c: AgentTarget) => viewFromAgent(c, 'picked'))
  return views.filter((v) => v.identity?.hwnd && !goneHwnds.has(v.identity.hwnd))
}

const targetMenu = document.createElement('div')
targetMenu.id = 'target-menu'
targetMenu.hidden = true
targetMenu.setAttribute('role', 'listbox')
document.body.append(targetMenu) // its aria-label is set in the init handler
let menuRows: { el: HTMLElement; target: SendTargetView | null }[] = []
let menuActive = 0

const targetMenuOpen = (): boolean => !targetMenu.hidden

function setMenuActive(i: number): void {
  menuActive = (i + menuRows.length) % menuRows.length
  menuRows.forEach((r, k) => r.el.classList.toggle('active', k === menuActive))
  menuRows[menuActive]?.el.scrollIntoView({ block: 'nearest' })
}

function pickMenuRow(i: number): void {
  const row = menuRows[i]
  if (!row) return
  chosenTarget = row.target && !isClipboardOnly(row.target) ? { ...row.target, source: 'picked', estimated: false } : row.target
  mustPickTarget = false
  closeTargetMenu()
  showTarget()
}

function closeTargetMenu(): void {
  if (!targetMenuOpen()) return
  targetMenu.hidden = true
  targetMenu.replaceChildren()
  menuRows = []
  targetBtn.setAttribute('aria-expanded', 'false')
  document.removeEventListener('pointerdown', onMenuPointerDown, true)
  window.removeEventListener('keydown', onMenuKey, true)
  window.removeEventListener('resize', closeTargetMenu)
}

function onMenuPointerDown(e: PointerEvent): void {
  const t = e.target as Node | null
  if (t && (targetMenu.contains(t) || targetBtn.contains(t))) return
  closeTargetMenu()
}

function onMenuKey(e: KeyboardEvent): void {
  if (e.isComposing) return
  const stop = (): void => { e.preventDefault(); e.stopImmediatePropagation() }
  if (e.key === 'Escape') { stop(); closeTargetMenu() }
  else if (e.key === 'ArrowDown') { stop(); setMenuActive(menuActive + 1) }
  else if (e.key === 'ArrowUp') { stop(); setMenuActive(menuActive - 1) }
  else if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement)) { stop(); pickMenuRow(menuActive) }
}

/** refresh: ask main for the windows open now and rebuild the menu with them (it opens at once with the last list). */
function openTargetMenu(refresh = true): void {
  if (!initData) return
  commitPendingText() // the menu and an open text box would fight over the keyboard
  picker.close()
  closeMoreMenu()
  const auto = initialTarget(initData)
  const list = document.createElement('div')
  list.className = 'tm-list'
  menuRows = []
  const addRow = (tg: SendTargetView | null, chip: string, agent: boolean, text: string, hint: string, current: boolean): void => {
    const el = document.createElement('div')
    el.className = 'tm-item'
    el.setAttribute('role', 'option')
    el.setAttribute('aria-selected', String(current))
    const mark = document.createElement('span')
    mark.className = 'tm-mark'
    mark.textContent = current ? '✓' : ''
    const c = document.createElement('span')
    c.className = `tm-chip${agent ? ' agent' : ''}`
    c.textContent = chip
    const title = document.createElement('span')
    title.className = 'tm-title'
    title.textContent = text
    title.title = text
    const h = document.createElement('span')
    h.className = 'tm-hint'
    h.textContent = hint
    el.append(mark, c, title, h)
    const idx = menuRows.length
    el.addEventListener('click', () => pickMenuRow(idx))
    el.addEventListener('mousemove', () => { if (menuActive !== idx) setMenuActive(idx) })
    menuRows.push({ el, target: tg })
    list.append(el)
  }
  const pinned = startPinned()
  const autoChip = chipView(auto, t)
  addRow(
    null, pinned ? t('editor.target.chipPinned') : t('editor.target.chipAuto'), true,
    auto && auto.source !== 'none'
      ? t(pinned ? 'editor.target.rowPinned' : 'editor.target.rowAuto', { label: autoChip.label })
      : t('editor.target.rowAutoNone'),
    auto && auto.source !== 'none' ? autoChip.state || methodRowHint(auto.method) : '', chosenTarget === null
  )
  let sepDone = false
  for (const v of candidateViews()) {
    if (!sepDone && (v.kind ?? 'unknown') === 'unknown') {
      sepDone = true
      const sep = document.createElement('div')
      sep.className = 'tm-sep'
      list.append(sep)
    }
    const id = v.identity
    addRow(v, kindChip(v), (v.kind ?? 'unknown') !== 'unknown', id?.title.slice(0, 40) || id?.process || v.label, methodRowHint(v.method),
      chosenTarget?.identity?.hwnd !== undefined && chosenTarget.identity.hwnd === id?.hwnd)
  }
  const clipSep = document.createElement('div')
  clipSep.className = 'tm-sep'
  list.append(clipSep)
  const clip = clipboardOnlyView()
  addRow(clip, t('editor.target.chipClipboard'), false, clip.label, methodRowHint('clipboard'), isClipboardOnly(chosenTarget))
  const foot = document.createElement('div')
  foot.className = 'tm-foot'
  const pin = document.createElement('label')
  pin.className = 'tm-pin'
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.checked = pinChecked
  box.addEventListener('change', () => { pinChecked = box.checked })
  pin.append(box, t('editor.target.pinDefault'))
  foot.append(pin)
  targetMenu.replaceChildren(list, foot)

  targetMenu.hidden = false
  targetMenu.style.visibility = 'hidden'
  const a = targetBtn.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const top = Math.round(toolbar.getBoundingClientRect().bottom + 2)
  list.style.maxHeight = `${Math.max(80, vh - top - 8 - 48)}px` // keep room for the footer row
  const w = targetMenu.offsetWidth
  targetMenu.style.left = `${Math.round(Math.max(8, Math.min(a.right - w, vw - w - 8)))}px` // right-aligned under the chip
  targetMenu.style.top = `${top}px`
  targetMenu.style.visibility = ''
  targetBtn.setAttribute('aria-expanded', 'true')
  const current = isClipboardOnly(chosenTarget)
    ? menuRows.length - 1
    : menuRows.findIndex((r) => (r.target?.identity?.hwnd ?? null) === (chosenTarget?.identity?.hwnd ?? null))
  setMenuActive(Math.max(0, current))
  document.addEventListener('pointerdown', onMenuPointerDown, true)
  window.addEventListener('keydown', onMenuKey, true)
  window.addEventListener('resize', closeTargetMenu)
  if (refresh && window.backseat.editor.targets) {
    window.backseat.editor.targets().then((views) => {
      targetViews = views
      if (!targetMenuOpen()) return
      const active = menuActive
      closeTargetMenu()
      openTargetMenu(false)
      if (active < menuRows.length) setMenuActive(active)
    }, () => undefined)
  }
}

function toggleTargetMenu(): void {
  if (targetMenuOpen()) closeTargetMenu()
  else openTargetMenu()
}
targetBtn.addEventListener('mousedown', (e) => e.preventDefault())

async function copy(): Promise<void> {
  if (busy || !init) return
  busy = true
  try {
    await settleRecording()
    const payload = buildPayload()
    if (!payload) return
    const r = await window.backseat.editor.copy(payload)
    if (r.ok) setStatus(t('editor.status.copied'))
    else setStatus(t('editor.status.copyFailed', { error: r.error ?? t('editor.status.unknownError') }), true)
  } catch (err) {
    setStatus(t('editor.status.copyFailed', { error: errText(err) }), true)
  } finally {
    busy = false
  }
}

/** The replayed time span of the exported video: a little before the first and after the last annotation. */
function videoRange(): { start: number; end: number } {
  const first = Math.min(...annotations.map((a) => a.tStart))
  return { start: Math.max(0, first - 400), end: sessionEnd(annotations) + 700 }
}

/** readsOften: a CPU-backed canvas for getImageData; MediaRecorder's canvas must stay GPU-backed (it records nothing otherwise). */
function videoCanvas(readsOften = false): { c: HTMLCanvasElement; cctx: CanvasRenderingContext2D; scale: number } {
  const scale = Math.min(1, 1280 / base.width)
  const c = document.createElement('canvas')
  c.width = Math.round(base.width * scale)
  c.height = Math.round(base.height * scale)
  return { c, cctx: ctxOf(c, readsOften), scale }
}

/**
 * One frame of the exported video: the annotations as they looked at time t over the MASKED capture.
 * Blurs are privacy masks, not drawings: they cover their area in every frame, also before the moment
 * they were drawn (Codex review F01), so they live in `masked` and are skipped as timed annotations.
 */
function drawVideoFrame(cctx: CanvasRenderingContext2D, masked: HTMLCanvasElement, scale: number, t: number): void {
  cctx.setTransform(scale, 0, 0, scale, 0, 0)
  cctx.drawImage(masked, 0, 0)
  drawAll(cctx, t, true)
}

const videoMime = (): string =>
  ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'

/**
 * Replay [start, end] into a WebM: deterministic sampling via drawVideoFrame(t),
 * one frame per animation frame, encoder backpressure handled by MediaRecorder.
 */
async function recordVideo(start: number, end: number): Promise<Blob> {
  const { c, cctx, scale } = videoCanvas()
  const masked = maskedBase()
  const mime = videoMime()
  await loadDocFonts()
  const stream = c.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve() })
  drawVideoFrame(cctx, masked, scale, start)
  rec.start(200)
  const wall = performance.now()
  await new Promise<void>((resolve) => {
    const loop = (): void => {
      const t = start + (performance.now() - wall)
      drawVideoFrame(cctx, masked, scale, Math.min(t, end))
      if (t >= end) resolve()
      else requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  rec.stop()
  await stopped
  return new Blob(chunks, { type: mime })
}

async function exportVideo(): Promise<void> {
  if (busy || !init) return
  if (annotations.length === 0) { setStatus(t('editor.video.noAnnotations')); return }
  commitPendingText()
  const { start, end } = videoRange()
  busy = true
  setStatus(t('editor.video.exporting', { seconds: ((end - start) / 1000).toFixed(1) }))
  try {
    const blob = await recordVideo(start, end)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const r = await window.backseat.editor.saveVideo({ bytes, mimeType: blob.type, durationMs: end - start })
    if (r.ok) setStatus(t('editor.video.saved', { path: r.path ?? '' }))
    else if (r.canceled) setStatus(t('editor.video.canceled'))
    else setStatus(t('editor.video.failed', { error: r.error ?? t('editor.status.unknownError') }), true)
  } catch (err) {
    setStatus(t('editor.video.failed', { error: errText(err) }), true)
  } finally {
    busy = false
  }
}

/**
 * Self-test probe for the video's privacy masking (Codex review F01). Puts a temporary blur on the most
 * detailed 64 px block of the capture, renders video frames before / during / after the blur's draw time and
 * a short real WebM recording, and returns how far the blurred area of each frame is from the masked capture
 * and from the raw capture (mean absolute channel difference, 0..255). Restores the document afterwards.
 */
async function videoMaskProbe(): Promise<unknown> {
  const { c, cctx, scale } = videoCanvas(true)
  // The most detailed block: there the blur changes the pixels the most, so a leak is measurable.
  const B = 64
  const img = baseCtx.getImageData(0, 0, base.width, base.height).data
  let best = { x: 0, y: 0, v: -1 }
  for (let y = 0; y + B <= base.height; y += B / 2) {
    for (let x = 0; x + B <= base.width; x += B / 2) {
      let sum = 0
      let sq = 0
      for (let yy = y; yy < y + B; yy += 2) {
        for (let xx = x; xx < x + B; xx += 2) {
          const v = img[(yy * base.width + xx) * 4 + 1]
          sum += v
          sq += v * v
        }
      }
      const n = (B / 2) * (B / 2)
      const variance = sq / n - (sum / n) ** 2
      if (variance > best.v) best = { x, y, v: variance }
    }
  }
  const saved = annotations
  const last = Math.max(0, ...annotations.map((a) => a.tEnd))
  const blur: BlurAnn = { kind: 'blur', x: best.x, y: best.y, w: B, h: B, strength: 14, tStart: last + 2000, tEnd: last + 2600 }
  annotations = [...saved, blur]
  try {
    const ref = (src: CanvasImageSource): Uint8ClampedArray => {
      const r = videoCanvas(true)
      r.cctx.setTransform(scale, 0, 0, scale, 0, 0)
      r.cctx.drawImage(src, 0, 0)
      return r.cctx.getImageData(0, 0, r.c.width, r.c.height).data
    }
    const maskedCanvas = document.createElement('canvas')
    maskedCanvas.width = base.width
    maskedCanvas.height = base.height
    const mctx = ctxOf(maskedCanvas)
    mctx.drawImage(base, 0, 0)
    drawBlur(mctx, blur)
    const refMasked = ref(maskedCanvas)
    const refRaw = ref(base)
    const rx = Math.round(best.x * scale) + 2
    const ry = Math.round(best.y * scale) + 2
    const rw = Math.max(1, Math.round(B * scale) - 4)
    const dist = (data: Uint8ClampedArray, other: Uint8ClampedArray): number => {
      let d = 0
      let n = 0
      for (let y = ry; y < ry + rw; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const i = (y * c.width + x) * 4
          d += Math.abs(data[i] - other[i]) + Math.abs(data[i + 1] - other[i + 1]) + Math.abs(data[i + 2] - other[i + 2])
          n += 3
        }
      }
      return Math.round((d / n) * 10) / 10
    }
    const sample = (data: Uint8ClampedArray): { masked: number; raw: number } => ({ masked: dist(data, refMasked), raw: dist(data, refRaw) })
    const { start, end } = videoRange()
    const frames: Record<string, { masked: number; raw: number }> = {}
    const times: [string, number][] = [['start', start], ['beforeBlur', blur.tStart - 1], ['duringBlur', (blur.tStart + blur.tEnd) / 2], ['end', end]]
    const masked = maskedBase()
    for (const [name, t] of times) {
      drawVideoFrame(cctx, masked, scale, t)
      frames[name] = sample(cctx.getImageData(0, 0, c.width, c.height).data)
    }
    // A short real recording of the very beginning, decoded again frame by frame.
    const blob = await recordVideo(start, start + 700)
    const encoded: { masked: number; raw: number }[] = []
    const video = document.createElement('video')
    video.muted = true
    video.src = URL.createObjectURL(blob)
    const grab = (): void => {
      cctx.setTransform(1, 0, 0, 1, 0, 0)
      cctx.drawImage(video, 0, 0, c.width, c.height)
      encoded.push(sample(cctx.getImageData(0, 0, c.width, c.height).data))
    }
    let encodedError = ''
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => resolve(), 5000)
      video.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error(`video decode failed: ${video.error?.code ?? '?'} ${video.error?.message ?? ''} (${blob.size} bytes, ${blob.type})`))
      }
      video.onended = () => { window.clearTimeout(timer); resolve() }
      video.onloadeddata = () => {
        grab()
        const onFrame = (): void => {
          grab()
          if (!video.ended) video.requestVideoFrameCallback(onFrame)
        }
        video.requestVideoFrameCallback(onFrame)
        void video.play()
      }
    }).catch((err: unknown) => { encodedError = errText(err) })
    URL.revokeObjectURL(video.src)
    return { block: { x: best.x, y: best.y, size: B, variance: Math.round(best.v) }, rawVsMasked: dist(refRaw, refMasked), frames, encoded, encodedError, bytes: blob.size }
  } finally {
    annotations = saved
    render()
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

const micText = micBtn.querySelector<HTMLElement>('.mic-text')

function updateMicUi(): void {
  const wasRecording = micBtn.classList.contains('recording')
  micBtn.classList.toggle('recording', active !== null)
  if (micText) micText.textContent = active ? t('editor.mic.stop', { time: mmss(performance.now() - active.startedPerf) }) : t('editor.mic.label')
  micBtn.title = hotkeys.label('mic')
  if (wasRecording !== (active !== null)) {
    fitToolbar() // the button got wider / narrower
    renderSendbar()
  }
}

function releaseMic(a: ActiveRecording): void {
  window.clearInterval(a.ticker)
  a.stream.getTracks().forEach((t) => t.stop())
}

window.backseat.editor.onSttProgress?.((p) => {
  if (!transcribing) return
  switch (p.stage) {
    case 'loading': setStatus(p.message ?? t('editor.mic.loadingModel')); break
    case 'downloading':
      setStatus(t('editor.mic.downloading', { file: p.file ?? '', percent: Math.round(p.progress ?? 0) }).replace(/\s+/g, ' '))
      break
    case 'transcribing': setStatus(t('editor.mic.transcribing')); break
    case 'error': setStatus(p.message ?? t('editor.mic.transcribeError'), true); break
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
    setStatus(t('editor.mic.unavailable', { error: errText(err) }), true)
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
    rec.addEventListener('error', () => setStatus(t('editor.mic.recordError'), true))
    active = a
    rec.start(250)
    updateMicUi()
    setStatus(t('editor.mic.recording'))
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    active = null
    updateMicUi()
    setStatus(t('editor.mic.startFailed', { error: errText(err) }), true)
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
    renderSendbar() // "음성을 글로 바꾸는 중"
    void task.finally(() => {
      if (recTask === task) recTask = null
      renderSendbar()
    })
  }
  return recTask ?? Promise.resolve()
}

/** Called before save / copy / send: end a running recording and wait for its transcript. */
async function settleRecording(): Promise<void> {
  await stopRecording()
  await loadDocFonts() // the flattened PNG must not fall back to a system font
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
    setStatus(t('editor.mic.stopFailed', { error: errText(err) }), true)
  } finally {
    releaseMic(a) // the microphone is free again, whatever happened
  }
  const wallMs = performance.now() - a.startedPerf
  if (a.chunks.length === 0) { setStatus(t('editor.mic.noSound'), true); return }
  const blob = new Blob(a.chunks, { type: a.mime })
  let buf: ArrayBuffer
  try {
    buf = await blob.arrayBuffer()
  } catch (err) {
    setStatus(t('editor.mic.readFailed', { error: errText(err) }), true)
    return
  }
  if (a.gen !== recGen) return // a newer recording already took over

  replaceRecording(blob, new Uint8Array(buf), a.startMs, wallMs)
  await transcribeAudio(buf, a.startMs, a.gen)
}

/** A new recording replaces the previous audio and transcript, and the manual links into it (also in the undo history). */
function replaceRecording(blob: Blob, bytes: Uint8Array, startMs: number, durationMs: number): void {
  transcript = null
  transcriptRev++
  setDoc({ annotations, links: new Map(), crop, linksRev: transcriptRev })
  replaceAudio(blob, bytes, startMs, durationMs)
  afterChange()
}

/** Decode and transcribe one recording (also the 다시 시도 after a failure). Results of an older recording are dropped. */
async function transcribeAudio(buf: ArrayBuffer, startMs: number, gen: number): Promise<void> {
  transcribing = true
  try {
    setStatus(t('editor.mic.processing'))
    let pcm16k: Float32Array
    const ac = new AudioContext({ sampleRate: 16000 })
    try {
      const decoded = await ac.decodeAudioData(buf.slice(0))
      pcm16k = decoded.getChannelData(0).slice() // already resampled to 16 kHz by the context
      if (gen === recGen && decoded.duration > 0) audioDurationMs = decoded.duration * 1000
    } finally {
      void ac.close()
    }
    const r = await window.backseat.editor.transcribe({ pcm16k, audioStartMs: startMs })
    if (gen !== recGen) return
    if (r.ok && r.transcript) {
      transcript = r.transcript
      const words = r.transcript.segments.reduce(
        (n, seg) => n + (seg.words ? seg.words.length : seg.text.split(/\s+/).filter(Boolean).length), 0
      )
      afterChange()
      setStatus(t('editor.mic.transcribed', { n: words }))
    } else {
      setStatus(t('editor.mic.transcribeFailed', { error: r.error ?? t('editor.status.unknownError') }), true)
    }
  } catch (err) {
    if (gen === recGen) setStatus(t('editor.mic.transcribeFailed', { error: errText(err) }), true)
  } finally {
    if (gen === recGen) transcribing = false
    renderSendbar()
  }
}

// closing the window mid-recording must not leave the microphone open
window.addEventListener('pagehide', () => { if (active) releaseMic(active) })

// ---------- toolbar & keyboard ----------

/** Copy the working values into the remembered options of `tl` (the tool that owns them). */
function storeToolVars(tl: Tool): void {
  switch (tl) {
    case 'pen':
    case 'arrow':
    case 'rect':
      prefs[tl] = { color, width: widthCss }
      break
    case 'badge': prefs.badge = { color, size: badgeSizeCss }; break
    case 'blur': prefs.blur = { strength: blurCss }; break
    case 'text':
      prefs.text = {
        color, font: fontFamily ?? null, size: fontSizeCss, style: textStyle, bold: textBold ?? null, italic: textItalic,
        bg: textBg ?? null, bgOpacity: textBgOpacity ?? null, outline: textOutline ?? null, shadow: textShadow
      }
      break
    case 'crop':
    case 'eraser':
      break
  }
}

/** Load `tl`'s remembered options into the working values. */
function loadToolVars(tl: Tool): void {
  switch (tl) {
    case 'pen':
    case 'arrow':
    case 'rect':
      color = prefs[tl].color
      widthCss = prefs[tl].width
      break
    case 'badge':
      color = prefs.badge.color
      badgeSizeCss = prefs.badge.size
      break
    case 'blur': blurCss = prefs.blur.strength; break
    case 'text': {
      const p = prefs.text
      color = p.color
      fontFamily = p.font ?? undefined
      fontSizeCss = p.size
      textStyle = p.style
      textBold = p.bold ?? undefined
      textItalic = p.italic
      textBg = p.bg ?? undefined
      textBgOpacity = p.bgOpacity ?? undefined
      textOutline = p.outline ?? undefined
      textShadow = p.shadow
      void loadFontCss(fontFamily)
      break
    }
    case 'crop':
    case 'eraser':
      break
  }
}

/** Remember the selected tool's options (and the tool itself) now; a storage that refuses only means nothing is remembered. */
function persistPrefs(): void {
  storeToolVars(tool)
  if (isDrawTool(tool)) prefs.tool = tool
  savePrefs(prefsStore(), prefs, prefsKey)
}

function setTool(next: Tool): void {
  closeMoreMenu()
  if (next === tool) { syncToolbar(); return }
  if (next !== 'text') commitPendingText() // its style belongs to the text tool
  if (tool === 'crop') cancelPendingCrop()
  storeToolVars(tool)
  tool = next
  loadToolVars(next)
  if (next !== 'text') textDetailsOpen = false // 세부 is folded again the next time the text tool is picked
  if (isDrawTool(next)) {
    prefs.tool = next
    savePrefs(prefsStore(), prefs, prefsKey)
  }
  syncToolbar()
}

/** Which [data-opt] items of row 2 each tool shows. */
const TOOL_OPTS: Record<Tool, readonly string[]> = {
  pen: ['color', 'width'],
  arrow: ['color', 'width'],
  rect: ['color', 'width'],
  badge: ['color', 'badge-size'],
  blur: ['blur-strength'],
  text: ['color', 'font', 'effect', 'text-more'],
  crop: ['crop'],
  eraser: ['eraser']
}

const toolName = (tl: Tool): string => t(`editor.tool.${tl}`)
const rowToolBtn = (tl: Tool): HTMLButtonElement | null => toolbar.querySelector<HTMLButtonElement>(`#tools [data-tool="${tl}"]`)
const moreToolEl = moreBtn.querySelector<HTMLElement>('.more-tool')

function toggleTextDetails(open = !textDetailsOpen): void {
  textDetailsOpen = open
  syncTextBar()
  textSession?.box.focus()
}

/** Reflect the text props into the text options and the 세부 row; the row shows only when opened and the text tool is in use. */
function syncTextBar(): void {
  const show = textDetailsOpen && (tool === 'text' || textSession !== null || textbarPin)
  textMoreBtn.setAttribute('aria-expanded', String(show))
  const caret = textMoreBtn.querySelector('.caret')
  if (caret) caret.textContent = show ? '▾' : '▸'
  if (textBar.hidden === show) {
    textBar.hidden = !show
    layout() // the stage got shorter / taller
  }
  const auto = autoPlate(color)
  const plate = textStyle === 'plate'
  boldBtn.setAttribute('aria-pressed', String(textBold ?? defaultBold(fontFamily)))
  italicBtn.setAttribute('aria-pressed', String(textItalic))
  shadowBtn.setAttribute('aria-pressed', String(textShadow))
  setColorButton(bgBtn, textBg ?? auto.hex)
  bgBtn.classList.toggle('auto', textBg === undefined)
  bgBtn.title = textBg === undefined ? t('editor.text.plateColorAuto') : t('editor.text.plateColor')
  bgAutoBtn.setAttribute('aria-pressed', String(textBg === undefined))
  bgOpacityInput.value = String(Math.round((textBgOpacity ?? auto.alpha) * 100))
  setColorButton(outlineBtn, textOutline ?? '#000000')
  const dimGroup = (el: HTMLElement, off: boolean): void => {
    const g = el.closest<HTMLElement>('.group')
    if (!g) return
    g.classList.toggle('dim', off)
    g.inert = off // not clickable, not focusable: a click falls through to the bar, which keeps the box focused
  }
  dimGroup(bgBtn, !plate)
  dimGroup(outlineBtn, textStyle !== 'outline')
}

function syncBadgeNext(): void {
  badgeNext.textContent = t('editor.opt.badgeNext', { n: nextBadgeNo() })
}

function syncToolbar(): void {
  const shown = new Set(TOOL_OPTS[tool])
  for (const el of optEls) el.hidden = !shown.has(el.dataset.opt ?? '')
  toolBtns.forEach((b) => {
    const on = b.dataset.tool === tool
    if (b.classList.contains('mi')) b.setAttribute('aria-checked', String(on))
    else b.classList.toggle('active', on)
  })
  // ⋯ names the selected tool when it lives there (crop, eraser, or a tool the row had no room for)
  const btn = rowToolBtn(tool)
  const inMenu = !btn || btn.classList.contains('collapsed')
  moreBtn.classList.toggle('active', inMenu)
  if (moreToolEl && moreToolEl.textContent !== (inMenu ? toolName(tool) : '')) {
    moreToolEl.textContent = inMenu ? toolName(tool) : ''
    fitToolbar()
  }
  setColorButton(colorBtn, color)
  setColorTitle(colorBtn, t('editor.color.titleFor', { tool: toolName(tool) })) // each tool has its own colour
  widthInput.value = String(widthCss)
  widthDot.style.width = widthDot.style.height = `${widthCss}px`
  widthDot.style.background = color
  badgeSizeBtns.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.badgeSize) === badgeSizeCss)))
  blurBtns.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.blur) === blurCss)))
  syncBadgeNext()
  fontSelect.value = fontFamily ?? ''
  sizeSelect.value = String(fontSizeCss)
  styleBtns.forEach((b) => {
    const on = b.dataset.textStyle === textStyle
    b.classList.toggle('active', on)
    b.setAttribute('aria-checked', String(on))
  })
  syncCropButtons()
  syncTextBar()
  wrap.classList.toggle('text-tool', tool === 'text')
  wrap.classList.toggle('eraser-tool', tool === 'eraser')
  if (tool !== 'text') wrap.classList.remove('over-text')
  wrap.classList.toggle('crop-tool', tool === 'crop')
  timelineBtn.setAttribute('aria-checked', String(timeline.isOpen))
  fitRow2()
}

/** Row 2 in a long language: the effect buttons drop their words (the sample glyph and tooltip stay). */
function fitRow2(): void {
  toolbar2.classList.remove('tight')
  if (toolbar2.scrollWidth > toolbar2.clientWidth) toolbar2.classList.add('tight')
}

compareBtn.addEventListener('click', () => setCompare(false))
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

/** The selected tool's colour. The open text box follows. */
function setColor(c: string, refocus = false): void {
  color = c
  refreshTextSession(refocus)
}
function setWidth(v: number): void {
  widthCss = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(v)))
  syncToolbar()
  persistPrefs()
}
widthInput.addEventListener('input', () => setWidth(Number(widthInput.value) || widthCss))
widthInput.addEventListener('change', () => widthInput.blur())
function setBadgeSize(v: number): void {
  badgeSizeCss = nearest(v, BADGE_SIZES)
  syncToolbar()
  persistPrefs()
}
function setBlurStrength(v: number): void {
  blurCss = nearest(v, BLUR_STRENGTHS)
  syncToolbar()
  persistPrefs()
}
badgeSizeBtns.forEach((b) => b.addEventListener('click', () => setBadgeSize(Number(b.dataset.badgeSize))))
blurBtns.forEach((b) => b.addEventListener('click', () => setBlurStrength(Number(b.dataset.blur))))

/** [ / ]: the selected tool's size option one step down / up. false = not applicable (the key goes on). */
function stepOption(dir: -1 | 1): boolean {
  const step = <T extends number>(choices: readonly T[], cur: number): T => {
    const i = choices.indexOf(nearest(cur, choices))
    return choices[Math.min(choices.length - 1, Math.max(0, i + dir))]
  }
  switch (tool) {
    case 'pen':
    case 'arrow':
    case 'rect':
      setWidth(widthCss + dir)
      return true
    case 'badge': setBadgeSize(step(BADGE_SIZES, badgeSizeCss)); return true
    case 'blur': setBlurStrength(step(BLUR_STRENGTHS, blurCss)); return true
    case 'text':
      fontSizeCss = step(TEXT_SIZES, fontSizeCss)
      textPropChanged(sizeSelect)
      return true
    case 'crop':
    case 'eraser':
      return false
  }
}

textMoreBtn.addEventListener('click', () => toggleTextDetails())
byId('text-more-close').addEventListener('click', () => toggleTextDetails(false))
cropApplyBtn.addEventListener('click', applyPendingCrop)
cropCancelBtn.addEventListener('click', cancelPendingCrop)

// ---------- ⋯ menu: crop, eraser, views, exports (and row-1 tools the row had no room for) ----------

const moreItems = (): HTMLButtonElement[] =>
  Array.from(moreMenu.querySelectorAll<HTMLButtonElement>('.mi')).filter((b) => !b.hidden && !b.disabled)
let moreActive = -1

const moreMenuOpen = (): boolean => !moreMenu.hidden

function setMoreActive(i: number): void {
  const items = moreItems()
  if (!items.length) return
  moreActive = (i + items.length) % items.length
  items.forEach((b, k) => b.classList.toggle('active', k === moreActive))
}

function openMoreMenu(): void {
  commitPendingText()
  closeTargetMenu()
  picker.close()
  moreMenu.querySelectorAll<HTMLElement>('.mi[data-command]').forEach((mi) => {
    const k = mi.querySelector('kbd')
    if (k) k.textContent = hotkeys.keyLabel(mi.dataset.command ?? '')
  })
  compareItem.disabled = compareImg === null
  compareItem.title = compareImg ? '' : t('editor.compare.none', { item: t('tray.recaptureLast') })
  compareItem.setAttribute('aria-checked', String(cmpOn))
  timelineBtn.setAttribute('aria-checked', String(timeline.isOpen))
  pinItem.setAttribute('aria-checked', String(pinned))
  syncToolbar()
  moreActive = -1
  moreMenu.querySelectorAll('.mi.active').forEach((b) => b.classList.remove('active'))
  moreMenu.hidden = false
  moreMenu.style.visibility = 'hidden'
  const a = moreBtn.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  const w = moreMenu.offsetWidth
  moreMenu.style.left = `${Math.round(Math.max(8, Math.min(a.left, vw - w - 8)))}px`
  moreMenu.style.top = `${Math.round(toolbar.getBoundingClientRect().bottom + 2)}px`
  moreMenu.style.visibility = ''
  moreBtn.setAttribute('aria-expanded', 'true')
  document.addEventListener('pointerdown', onMorePointerDown, true)
  window.addEventListener('keydown', onMoreKey, true)
  window.addEventListener('resize', closeMoreMenu)
}

function closeMoreMenu(): void {
  if (!moreMenuOpen()) return
  moreMenu.hidden = true
  moreBtn.setAttribute('aria-expanded', 'false')
  document.removeEventListener('pointerdown', onMorePointerDown, true)
  window.removeEventListener('keydown', onMoreKey, true)
  window.removeEventListener('resize', closeMoreMenu)
}

function onMorePointerDown(e: PointerEvent): void {
  const n = e.target as Node | null
  if (n && (moreMenu.contains(n) || moreBtn.contains(n))) return
  closeMoreMenu()
}

/** Arrows move, Enter runs the item, Esc closes; any other key closes the menu and does its usual job. */
function onMoreKey(e: KeyboardEvent): void {
  if (e.isComposing) return
  const stop = (): void => { e.preventDefault(); e.stopImmediatePropagation() }
  if (e.key === 'Escape') { stop(); closeMoreMenu() }
  else if (e.key === 'ArrowDown') { stop(); setMoreActive(moreActive + 1) }
  else if (e.key === 'ArrowUp') { stop(); setMoreActive(moreActive < 0 ? -1 : moreActive - 1) }
  else if (e.key === 'Enter') {
    stop()
    const item = moreItems()[moreActive]
    if (item) item.click()
    else closeMoreMenu()
  } else closeMoreMenu()
}

moreBtn.addEventListener('click', () => (moreMenuOpen() ? closeMoreMenu() : openMoreMenu()))
moreMenu.addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('.mi')) closeMoreMenu() // after the item's own command ran
})
moreMenu.addEventListener('mousedown', (e) => e.preventDefault()) // an open text box keeps the focus

/**
 * Push the module-level text props (colour, effects; not font / size) into the open box and, usually, hand focus
 * back to it. Every option change of the selected tool comes through here, so it is also where they are remembered.
 */
function refreshTextSession(refocus = true): void {
  const s = textSession
  if (s) {
    s.color = color
    s.style = textStyle
    s.bg = textBg
    s.bgOpacity = textBgOpacity
    s.outline = textOutline
    s.shadow = textShadow
    s.bold = textBold
    s.italic = textItalic
    styleTextBox(s)
  }
  syncToolbar()
  persistPrefs()
  if (refocus) s?.box.focus()
}

// One setter per text prop: the toolbar controls (and a later colour popover) go through these.
function setTextStyle(v: TextStyle, refocus = true): void { textStyle = v; refreshTextSession(refocus) }
/** '#RRGGBB' or undefined = automatic plate colour. */
function setTextBg(v: string | undefined, refocus = true): void { textBg = v?.toUpperCase(); refreshTextSession(refocus) }
/** 0..1 or undefined = the automatic plate's own alpha. */
function setTextBgOpacity(v: number | undefined, refocus = true): void {
  textBgOpacity = v === undefined ? undefined : Math.min(1, Math.max(0.1, Math.round(v * 100) / 100))
  refreshTextSession(refocus)
}
/** '#RRGGBB' or undefined = translucent black. */
function setTextOutline(v: string | undefined, refocus = true): void { textOutline = v?.toUpperCase(); refreshTextSession(refocus) }
function setTextShadow(on: boolean, refocus = true): void { textShadow = on; refreshTextSession(refocus) }
/** undefined = the font's default weight. */
function setTextBold(v: boolean | undefined, refocus = true): void { textBold = v; refreshTextSession(refocus) }
function setTextItalic(on: boolean, refocus = true): void { textItalic = on; refreshTextSession(refocus) }

/** '#RRGGBB' (upper case) for any hex colour, or null. */
function normHex(c: string): string | null {
  const rgb = hexToRgb(c)
  return rgb ? `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase() : null
}

/** Swap the text colour and the plate colour (an automatic plate counts as its effective colour); turns the plate on. */
function invertTextColors(): void {
  const auto = autoPlate(color)
  const plateHex = normHex(textBg ?? auto.hex) ?? auto.hex
  const alpha = textBgOpacity ?? auto.alpha
  const textHex = normHex(color) ?? '#FFFFFF'
  color = plateHex
  textBg = textHex
  // keep the plate as translucent as it was; "automatic" only if that matches the new text colour's own alpha
  textBgOpacity = Math.abs(alpha - autoPlate(color).alpha) > 0.004 ? alpha : undefined
  textStyle = 'plate'
  refreshTextSession()
}

/** A font / size pick applies to the open text box too, and hands focus back to it. */
function textPropChanged(sel: HTMLElement): void {
  if (textSession) {
    textSession.font = fontFamily
    textSession.sizeCss = fontSizeCss
  }
  refreshTextSession(false)
  sel.blur()
  textSession?.box.focus()
}
fontSelect.addEventListener('change', () => {
  fontFamily = fontSelect.value || undefined
  void loadFontCss(fontFamily)
  textPropChanged(fontSelect)
})
sizeSelect.addEventListener('change', () => {
  fontSizeCss = Number(sizeSelect.value) || fontSizeCss
  textPropChanged(sizeSelect)
})
styleBtns.forEach((b) => b.addEventListener('click', () => {
  const v = b.dataset.textStyle ?? ''
  if (isTextStyle(v)) setTextStyle(v)
}))
boldBtn.addEventListener('click', () => setTextBold(!(textBold ?? defaultBold(fontFamily))))
italicBtn.addEventListener('click', () => setTextItalic(!textItalic))
shadowBtn.addEventListener('click', () => setTextShadow(!textShadow))
invertBtn.addEventListener('click', invertTextColors)
bgAutoBtn.addEventListener('click', () => setTextBg(textBg === undefined ? autoPlate(color).hex : undefined))
bgOpacityInput.addEventListener('input', () => setTextBgOpacity(Number(bgOpacityInput.value) / 100, false))
// the slider is a native control: give the focus back to the open box once it is done
bgOpacityInput.addEventListener('change', () => textSession?.box.focus())
bgOpacityInput.addEventListener('blur', (ev) => {
  const sess = textSession
  if (!sess || ev.relatedTarget === sess.box || isToolbarControl(ev.relatedTarget)) return
  if (!document.hasFocus()) return
  finishText(sess, true)
})
window.addEventListener('focus', () => { // back from the popover's native colour dialog
  const ae = document.activeElement
  if (textSession && ae instanceof HTMLInputElement && ae.type === 'color') textSession.box.focus()
})
// keep focus (e.g. in the text box) when clicking toolbar buttons; selects and sliders need the mouse
for (const bar of [toolbar, toolbar2, textBar]) {
  bar.addEventListener('mousedown', (e) => { if (!isNativeToolbarControl(e.target)) e.preventDefault() })
}

// ---------- colour popover ----------

const picker = new ColorPicker()

/** One-shot "pick a colour from the capture" mode (the popover's eyedropper when window.EyeDropper is missing). */
function sampleFromCanvas(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!init) { resolve(null); return }
    setStatus(t('editor.status.pickColor'))
    stage.classList.add('sampling')
    let done = false
    const finish = (c: string | null): void => {
      if (done) return
      done = true
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('mousedown', onMouse, true)
      window.removeEventListener('keydown', onKey, true)
      stage.classList.remove('sampling')
      setStatus(c ? t('editor.status.colorPicked', { color: c }) : t('editor.status.pickCanceled'))
      resolve(c)
    }
    const swallowClick = (ev: MouseEvent): void => ev.stopPropagation() // the click that ends sampling must not hit a button
    const onMouse = (ev: MouseEvent): void => ev.preventDefault() // keep the focus (an open text box stays open)
    const onDown = (ev: PointerEvent): void => {
      ev.preventDefault()
      ev.stopImmediatePropagation() // never reaches the ink handler: no stroke, no move-drag
      document.addEventListener('click', swallowClick, { capture: true, once: true })
      setTimeout(() => document.removeEventListener('click', swallowClick, true), 400)
      if (ev.target !== ink || ev.button !== 0) { finish(null); return }
      const p = toImg(ev)
      const x = Math.floor(p.x)
      const y = Math.floor(p.y)
      if (x < 0 || y < 0 || x >= ink.width || y >= ink.height) { finish(null); return }
      const d = ctxOf(flattenCanvas(), true).getImageData(x, y, 1, 1).data
      finish(normalizeHex(`rgb(${d[0]},${d[1]},${d[2]})`))
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      finish(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('mousedown', onMouse, true)
    window.addEventListener('keydown', onKey, true)
  })
}

/** Open the popover under `anchor`; `onPick` receives every live pick. The open text box keeps its focus and gets it back on close. */
function openPicker(anchor: HTMLButtonElement, title: string, value: string, onPick: (c: string) => void): void {
  anchor.setAttribute('aria-expanded', 'true')
  picker.open({
    anchor, value, title, onPick,
    sampleFallback: sampleFromCanvas,
    onClose: () => {
      anchor.setAttribute('aria-expanded', 'false')
      if (textSession && document.activeElement !== textSession.box) textSession.box.focus()
    }
  })
}

colorBtn.addEventListener('click', () => openPicker(colorBtn, t('editor.color.titleFor', { tool: toolName(tool) }), color, (c) => setColor(c, false)))
bgBtn.addEventListener('click', () => openPicker(bgBtn, t('editor.text.plateColor'), textBg ?? autoPlate(color).hex, (c) => setTextBg(c, false)))
outlineBtn.addEventListener('click', () => openPicker(outlineBtn, t('editor.text.outlineColor'), textOutline ?? '#000000', (c) => setTextOutline(c, false)))

const hotkeys = new Hotkeys([
  {
    id: 'send', label: () => t('editor.hotkey.send'), keys: ['Enter', 'Ctrl+Enter'],
    run: (e) => {
      if (e.code === 'Enter' && textSession) return false // Enter belongs to the open text box
      if (e.code === 'Enter' && cropPending) { applyPendingCrop(); return } // and to a crop waiting for 적용
      void send()
    }
  },
  { id: 'save', label: () => t('editor.hotkey.save'), keys: ['Ctrl+KeyS'], context: 'global', run: () => void save() },
  { id: 'copy', label: () => t('editor.hotkey.copy'), keys: ['Ctrl+KeyC'], run: () => void copy() },
  { id: 'undo', label: () => t('editor.hotkey.undo'), keys: ['Ctrl+KeyZ'], run: undo },
  { id: 'redo', label: () => t('editor.hotkey.redo'), keys: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'], run: redo },
  { id: 'pen', label: () => t('editor.hotkey.pen'), keys: ['KeyP'], run: () => setTool('pen') },
  { id: 'text', label: () => t('editor.hotkey.text'), keys: ['KeyT'], run: () => setTool('text') },
  { id: 'target', label: () => t('editor.hotkey.target'), keys: ['Ctrl+KeyT'], context: 'global', run: toggleTargetMenu },
  { id: 'arrow', label: () => t('editor.hotkey.arrow'), keys: ['KeyA'], run: () => setTool('arrow') },
  { id: 'rect', label: () => t('editor.hotkey.rect'), keys: ['KeyR'], run: () => setTool('rect') },
  { id: 'badge', label: () => t('editor.hotkey.badge'), keys: ['KeyN'], run: () => setTool('badge') },
  { id: 'blur', label: () => t('editor.hotkey.blur'), keys: ['KeyB'], run: () => setTool('blur') },
  { id: 'crop', label: () => t('editor.hotkey.crop'), keys: ['KeyC'], run: () => setTool('crop') },
  { id: 'eraser', label: () => t('editor.hotkey.eraser'), keys: ['KeyE'], run: () => setTool('eraser') },
  { id: 'width-down', label: () => t('editor.hotkey.widthDown'), keys: ['BracketLeft'], run: () => stepOption(-1) },
  { id: 'width-up', label: () => t('editor.hotkey.widthUp'), keys: ['BracketRight'], run: () => stepOption(1) },
  { id: 'compare', label: () => t('editor.hotkey.compare'), keys: ['KeyO'], run: () => setCompare(!cmpOn) },
  { id: 'timeline', label: () => t('editor.hotkey.timeline'), keys: ['KeyL'], run: () => { timeline.toggle(); syncToolbar() } },
  { id: 'play', label: () => t('editor.hotkey.play'), keys: ['Space'], run: () => { if (!timeline.isOpen) return false; timeline.togglePlay() } },
  { id: 'step-back', label: () => t('editor.hotkey.stepBack'), keys: ['ArrowLeft'], run: () => { if (!timeline.isOpen) return false; timeline.stepFrames(-200) } },
  { id: 'step-fwd', label: () => t('editor.hotkey.stepFwd'), keys: ['ArrowRight'], run: () => { if (!timeline.isOpen) return false; timeline.stepFrames(200) } },
  { id: 'home', label: () => t('editor.hotkey.home'), keys: ['Home'], run: () => { if (!timeline.isOpen) return false; timeline.pause(); timeline.seek(0) } },
  { id: 'live', label: () => t('editor.hotkey.live'), keys: ['End'], run: () => { if (!timeline.isOpen) return false; timeline.setLive() } },
  { id: 'mic', label: () => t('editor.hotkey.mic'), keys: ['KeyM'], run: () => void toggleRecording() },
  { id: 'video', label: () => t('editor.hotkey.video'), keys: ['Ctrl+KeyE'], run: () => void exportVideo() },
  { id: 'pin', label: () => t('editor.hotkey.pin'), keys: ['Ctrl+KeyP'], run: () => void togglePin() },
  {
    id: 'close', label: () => t('editor.hotkey.close'), keys: ['Escape'], context: 'global',
    run: (e) => {
      if (e.target === memoInput) { memoInput.blur(); return }
      if (e.target instanceof HTMLSelectElement) { e.target.blur(); return }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return false // the text box handles its own Escape
      if (moveDrag) { endMove(false); return }
      if (erasing) { endErase(false); return }
      if (timeline.cancelLinkDrag()) return // Esc aborts a speech link drag first
      if (cropDrag) { endCrop(false); return }
      if (cropPending) { cancelPendingCrop(); return }
      if (cmpOn) { setCompare(false); return }
      if (scrubT !== null) { timeline.setLive(); return }
      window.backseat.editor.close()
    }
  }
])
hotkeys.install()
hotkeys.applyTooltips() // binds the click handlers; the titles are refreshed in the init handler once the language is known

/** Row-1 tools that move into ⋯ when the row has no room, least important first (request 3: arrow · number first). */
const COLLAPSIBLE: readonly Tool[] = ['rect', 'text', 'blur', 'badge', 'pen']

/**
 * Row 1 must stay one line at any window width (the pinned window is 480 px) and in any language: first a
 * tighter button style, then the least important items fold into ⋯ one by one. 보내기, the target chip, undo /
 * redo and the recording control always stay.
 */
function fitToolbar(): void {
  toolbar.classList.remove('tight', 'chip-compact')
  micBtn.classList.remove('compact')
  for (const tl of COLLAPSIBLE) rowToolBtn(tl)?.classList.remove('collapsed')
  const overflows = (): boolean => toolbar.scrollWidth > toolbar.clientWidth
  const cut = (el: Element | null): boolean => el !== null && el.scrollWidth > el.clientWidth + 1
  // A cut-off destination ("Codex · Chat…", "guess · la…") may only cost the tighter style and the rectangle.
  const chipCut = (): boolean => cut(targetBtn.querySelector('.tb-label')) || cut(targetBtn.querySelector('.tb-state'))
  const steps: { run: () => void; forChip: boolean }[] = [
    { run: () => toolbar.classList.add('tight'), forChip: true },
    { run: () => rowToolBtn('rect')?.classList.add('collapsed'), forChip: true },
    { run: () => rowToolBtn('text')?.classList.add('collapsed'), forChip: false },
    { run: () => micBtn.classList.add('compact'), forChip: false },
    { run: () => toolbar.classList.add('chip-compact'), forChip: false },
    { run: () => rowToolBtn('blur')?.classList.add('collapsed'), forChip: false },
    { run: () => rowToolBtn('badge')?.classList.add('collapsed'), forChip: false },
    { run: () => rowToolBtn('pen')?.classList.add('collapsed'), forChip: false }
  ]
  const collapsed = (tl: string | undefined): boolean => rowToolBtn(tl as Tool)?.classList.contains('collapsed') === true
  const sep = toolbar.querySelector<HTMLElement>('#tools .sep')
  /** ⋯ names the selected tool when it is folded there; that label takes room too, so it is set before each check. */
  const syncFolded = (): void => {
    const btn = rowToolBtn(tool)
    const inMenu = !btn || btn.classList.contains('collapsed')
    moreBtn.classList.toggle('active', inMenu)
    if (moreToolEl) moreToolEl.textContent = inMenu ? toolName(tool) : ''
    // the separator before 텍스트 · 사각형 goes when both folded away
    if (sep) sep.hidden = collapsed('text') && collapsed('rect')
  }
  for (const step of steps) {
    syncFolded()
    if (!overflows() && !(step.forChip && chipCut())) break
    step.run()
  }
  syncFolded()
  moreMenu.querySelectorAll<HTMLElement>('.mi.overflow').forEach((mi) => { mi.hidden = !collapsed(mi.dataset.tool) })
}

window.addEventListener('resize', () => {
  commitPendingText()
  layout()
  fitToolbar()
  fitRow2()
})
// Rows that open and close (세부, comparison, timeline, send bar wrapping) change the stage: re-fit the image.
// Row 1 and 2 re-fit whenever their width changes (window resize, pinning); the window resize event alone
// is not reliable after a programmatic resize.
let fitRaf = 0
new ResizeObserver(() => {
  cancelAnimationFrame(fitRaf)
  fitRaf = requestAnimationFrame(() => { fitToolbar(); fitRow2() })
}).observe(toolbar)
let layoutRaf = 0
new ResizeObserver(() => {
  // next frame: resizing the canvases inside the observer callback would re-trigger observers in the same frame
  cancelAnimationFrame(layoutRaf)
  layoutRaf = requestAnimationFrame(() => layout())
}).observe(stage)

// ---------- init ----------

window.backseat.editor.onInit((data) => {
  if (started) return
  started = true
  // The language first: nothing may use t() before this (module scope runs before init arrives).
  setMessages(isLocale(data.locale) ? data.locale : 'ko', data.messages ?? {})
  applyDom(document)
  hotkeys.applyTooltips()
  applyColorTitles()
  targetMenu.setAttribute('aria-label', t('editor.target.menuLabel'))
  requestAnimationFrame(() => { fitToolbar(); fitRow2() }) // after the rest of init has set the labels
  // The last tool and its options; the text tool starts in the UI language's font. The self-test has its own key.
  prefsKey = data.debug ? 'backseat.selftest.tools' : PREFS_KEY
  prefs = loadPrefs(prefsStore(), defaultPrefs(LOCALE_FONT[getLocale()] ?? DEFAULT_FONT), prefsKey)
  tool = prefs.tool
  loadToolVars('text') // the text vars also serve a re-edited text
  loadToolVars(tool)
  void loadFontCss(prefs.text.font ?? undefined)
  t0 = performance.now()
  document.title = 'Backseat'
  syncToolbar()
  updateMicUi()
  initData = data
  pinChecked = startPinned()
  mustPickTarget = data.sendTarget?.source === 'none' && data.sendTarget.unavailable !== undefined
  showTarget()
  window.backseat.editor.targets?.().then((views) => { targetViews = views }, () => undefined)
  newCaptureBtn.hidden = typeof window.backseat.editor.newCapture !== 'function'
  if (data.request) {
    askBar.textContent = t('editor.ask.label', { agent: data.request.agent || t('editor.target.agentFallback'), question: data.request.question })
    askBar.title = data.request.question
    askBar.hidden = false
  }
  if (data.debug) {
    // Harness hooks: inject a transcript without a microphone, inspect state (see src/main/selftest.ts).
    window.addEventListener('backseat:debug-transcript', (e) => {
      transcript = (e as CustomEvent<Transcript>).detail
      afterChange()
      setStatus(t('editor.debug.transcriptInjected', { count: transcript.segments.length }))
    })
    const w = window as unknown as { __backseat?: unknown }
    w.__backseat = {
      state: () => ({
        annotations: annotations.map((a) => {
          const b = annotationBox(a)
          const x = a.kind === 'text' ? a.x : b.x
          const y = a.kind === 'text' ? a.y - a.fontSize / 2 : b.y
          return { kind: a.kind, tStart: Math.round(a.tStart), tEnd: Math.round(a.tEnd), x: Math.round(x), y: Math.round(y) }
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
        color,
        width: widthCss,
        badgeSize: badgeSizeCss,
        blurStrength: blurCss,
        fontSize: fontSizeCss,
        textStyle,
        textBg: textBg ?? null,
        textOutline: textOutline ?? null,
        textDetails: !textBar.hidden,
        pickerOpen: picker.isOpen(),
        targetMenuOpen: targetMenuOpen(),
        moreMenuOpen: moreMenuOpen(),
        cropDrag: cropDrag !== null,
        cropPending: cropPending ? { ...cropPending } : null,
        pointer: { ...pointerCounts },
        compare: { available: compareImg !== null, on: cmpOn, mode: cmpMode, diffPercent: compareImg ? diffPercent() : null }
      }),
      /** Crop programmatically (image px of the current canvas); same path as a pointer drag. */
      crop: (x: number, y: number, w: number, h: number) => applyCropSelection({ x, y, width: w, height: h }),
      /** Commit annotations (image px of the current canvas) as ONE history step; undo removes them together. */
      addAnnotations: (list: Annotation[]) => { commit(t('editor.debug.addAnnotations'), [...annotations, ...list]) },
      /** Restore the pen colour without the popover (self-test cleanup). */
      setColor: (c: string) => setColor(c, false),
      /** The SendOptions 전송 would pass right now (nothing is sent). */
      sendOptions: () => sendOptions(),
      setCompare: (on: boolean, mode?: CompareMode) => { if (mode) setCompareMode(mode); setCompare(on) },
      /** Manual link as the timeline's drag does it (one history step). */
      linkSegment: (segmentIndex: number, annotationIndex: number) => {
        const next = new Map(links)
        next.set(segmentIndex, annotationIndex)
        commitLinks(t('editor.history.linkAdd'), next)
      },
      /** A new recording whose recognition failed: same path as a real one, without the microphone (F10 / F12). */
      fakeFailedRecording: () => replaceRecording(new Blob([new Uint8Array([0])], { type: 'audio/webm' }), new Uint8Array([0]), now(), 1000),
      /** A finished recording with this transcript, without the microphone (voice flow screenshots). */
      fakeRecording: (tr: Transcript) => {
        replaceRecording(new Blob([new Uint8Array([0])], { type: 'audio/webm' }), new Uint8Array([0]), tr.audioStartMs, tr.durationMs)
        transcript = tr
        afterChange()
      },
      /** Drop the recording again (self-test cleanup). */
      clearRecording: () => {
        audioBytes = null
        transcript = null
        transcriptRev++
        setDoc({ annotations, links: new Map(), crop, linksRev: transcriptRev })
        afterChange()
      },
      /** The send bar offers 다시 변환 / 음성 없이 보내기 (a recording without text). */
      sttChoiceOpen: () => !summaryEl.hidden && !voiceMissingEl.hidden,
      busy: () => busy,
      /** Start from the defaults (the self-test's own key is cleared; the user's key is never touched here). */
      resetPrefs: () => {
        try { localStorage.removeItem(prefsKey) } catch { /* storage unavailable */ }
        prefs = defaultPrefs(LOCALE_FONT[getLocale()] ?? DEFAULT_FONT)
        tool = prefs.tool
        loadToolVars('text')
        loadToolVars(tool)
        textDetailsOpen = false
        syncToolbar()
      },
      /** What the editor remembers (under the self-test's own key) and the row-1 fit. */
      prefs: () => ({ key: prefsKey, prefs, stored: (() => { try { return localStorage.getItem(prefsKey) } catch { return null } })() }),
      fit: () => ({
        tight: toolbar.classList.contains('tight'),
        collapsed: COLLAPSIBLE.filter((tl) => rowToolBtn(tl)?.classList.contains('collapsed')),
        micCompact: micBtn.classList.contains('compact'),
        chipCompact: toolbar.classList.contains('chip-compact')
      }),
      /** The send bar as the user sees it. */
      sendbar: () => ({
        mode: deliveryEl.hidden ? 'summary' : 'delivery',
        summary: summaryText.textContent,
        voiceMissing: !voiceMissingEl.hidden,
        voiceLinks: !voiceLinksBtn.hidden,
        changed: !summaryChanged.hidden,
        steps: Array.from(stepsEl.children).map((li) => `${li.classList.contains('stopped') ? '✕' : '✓'}${li.textContent ?? ''}`),
        headline: deliveryHeadline.textContent,
        detail: deliveryDetail.textContent,
        tone: deliveryEl.dataset.tone ?? '',
        primary: (Object.keys(actionBtns) as DeliveryAction[]).find((k) => actionBtns[k].classList.contains('primary-action')) ?? null
      }),
      /** Show a delivery state as if main had answered 보내기 with it (screens for every step / stop reason). */
      fakeDelivery: (s: DeliveryStatus, ctx: DeliveryContext = {}) => {
        lastDelivery = s
        lastDeliveryCtx = ctx
        dirtySinceSend = false
        renderSendbar()
      },
      /** A later delivery:update from main (e.g. fetched). */
      deliveryUpdate: (s: DeliveryStatus) => {
        const merged = mergeUpdate(lastDelivery, s)
        if (merged) { lastDelivery = merged; renderSendbar() }
        return merged !== null
      },
      /** Show a target chip as main would describe it. */
      fakeTarget: (v: SendTargetView | null) => {
        if (initData) initData.sendTarget = v ?? { source: 'none', label: '', estimated: true, method: 'clipboard' }
        chosenTarget = null
        mustPickTarget = false
        showTarget()
      },
      /** Codex review F01: how far the blurred area of video frames is from the masked / raw capture. */
      videoMaskProbe: () => videoMaskProbe(),
      payload: () => { const p = buildPayload(); return p ? { meta: p.meta, compare: p.compare, annotations: p.annotations, basePngDataUrl: p.basePngDataUrl } : null }
    }
  }
  afterChange()
  const img = new Image()
  img.onload = () => {
    orig = img
    init = data
    setDoc({ annotations: [], links: new Map(), crop: { x: 0, y: 0, width: data.width, height: data.height }, linksRev: transcriptRev })
    render()
    renderSendbar() // "이미지 1"
    if (data.compare) {
      const prev = new Image()
      prev.onload = () => {
        compareImg = prev
        compareDir = data.compare?.sessionDir ?? ''
        diffCache = null
        syncCompareUi()
        setStatus(t('editor.compare.available'))
      }
      prev.onerror = () => setStatus(t('editor.compare.loadFailed'), true)
      prev.src = data.compare.imageDataUrl
    }
    if (data.autoRecord) void startRecording()
  }
  img.onerror = () => setStatus(t('editor.status.imageFailed'), true)
  img.src = data.imageDataUrl
})
