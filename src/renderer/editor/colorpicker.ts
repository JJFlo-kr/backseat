import './colorpicker.css'
import { PALETTES, contrastText, normalizeHex, pushRecent } from '../../shared/palette'
import { t } from '../../shared/i18n'

export interface PickOptions {
  /** The popover opens below it (flips above if there is no room; clamped inside the window). */
  anchor: HTMLElement
  /** Current colour '#RRGGBB'. */
  value: string
  /** Small header, e.g. '펜 색' / '배경 상자 색' / '윤곽선 색'. */
  title?: string
  /** Called on every pick (swatch, recent, native input events, hex field, eyedropper). */
  onPick: (color: string) => void
  onClose?: () => void
  /** Fallback eyedropper when window.EyeDropper is missing: resolves the pixel colour, or null on cancel. */
  sampleFallback?: () => Promise<string | null>
}

const LS_PALETTE = 'backseat.palette'
const LS_RECENT = 'backseat.recentColors'
const MARGIN = 8
const GAP = 6

const EYEDROPPER_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/>' +
  '<path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>'

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}
function loadRecent(): string[] {
  try {
    const raw = JSON.parse(lsGet(LS_RECENT) ?? '[]')
    if (!Array.isArray(raw)) return []
    // normalise + dedup + cap by folding oldest-first through pushRecent
    let out: string[] = []
    for (const c of [...raw].reverse()) if (typeof c === 'string') out = pushRecent(out, c)
    return out
  } catch {
    return []
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  props?: Partial<HTMLElementTagNameMap[K]>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (props) Object.assign(e, props)
  return e
}

export class ColorPicker {
  readonly root: HTMLElement
  private opts: PickOptions | null = null
  private value = '#000000'
  private recent: string[] = loadRecent()
  private paletteId: string
  private picking = false

  private titleEl: HTMLElement
  private tabsEl: HTMLElement
  private gridEl: HTMLElement
  private recentEl: HTMLElement
  private nativeInput: HTMLInputElement
  private hexInput: HTMLInputElement
  private dropBtn: HTMLButtonElement
  private dropLabel: HTMLElement
  private recentLabel: HTMLElement
  private chip: HTMLElement

  constructor(host: HTMLElement = document.body) {
    const saved = lsGet(LS_PALETTE)
    this.paletteId = PALETTES.some((p) => p.id === saved) ? (saved as string) : PALETTES[0].id

    const root = el('div', 'cp-root')
    root.id = 'color-pop'
    root.setAttribute('role', 'dialog')
    root.hidden = true
    this.root = root

    // header
    this.titleEl = el('div', 'cp-title')
    this.tabsEl = el('div', 'cp-tabs')
    this.tabsEl.setAttribute('role', 'tablist')
    for (const p of PALETTES) {
      const b = el('button', 'cp-tab', { type: 'button', textContent: '' })
      b.dataset.id = p.id
      b.setAttribute('role', 'tab')
      b.addEventListener('click', () => {
        this.paletteId = p.id
        lsSet(LS_PALETTE, p.id)
        this.renderTabs()
        this.renderGrid()
      })
      this.tabsEl.append(b)
    }
    const head = el('div', 'cp-head')
    head.append(this.titleEl, this.tabsEl)

    this.gridEl = el('div', 'cp-grid')

    // recents
    const recentRow = el('div', 'cp-recent-row')
    const recentLabel = el('span', 'cp-label')
    this.recentLabel = recentLabel
    this.recentEl = el('div', 'cp-recent')
    recentRow.append(recentLabel, this.recentEl)

    // bottom row
    const chip = el('label', 'cp-native')
    this.chip = chip
    this.nativeInput = el('input', undefined, { type: 'color' })
    this.nativeInput.addEventListener('input', () => this.apply(this.nativeInput.value, false))
    this.nativeInput.addEventListener('change', () => this.remember(this.nativeInput.value))
    chip.append(this.nativeInput, el('span', 'cp-native-plus', { textContent: '+' }))

    this.hexInput = el('input', 'cp-hex', { type: 'text', maxLength: 24, spellcheck: false })
    this.hexInput.placeholder = '#RRGGBB'
    this.hexInput.addEventListener('input', () => {
      const v = this.hexInput.value.trim()
      this.hexInput.classList.toggle('bad', v !== '' && normalizeHex(v) === null)
    })
    this.hexInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      this.commitHex()
    })
    this.hexInput.addEventListener('blur', () => {
      this.commitHex()
      this.syncHex()
    })

    this.dropBtn = el('button', 'cp-drop', { type: 'button' })
    this.dropLabel = el('span')
    this.dropBtn.innerHTML = EYEDROPPER_SVG
    this.dropBtn.append(this.dropLabel)
    this.dropBtn.addEventListener('click', () => void this.eyedrop())

    const bottom = el('div', 'cp-bottom')
    bottom.append(chip, this.hexInput, this.dropBtn)

    root.append(head, this.gridEl, recentRow, bottom)

    // Keep focus where it was (the editor may have a text input open): buttons never take focus on mousedown.
    root.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault()
    })
    root.addEventListener('contextmenu', (e) => e.preventDefault())

    host.append(root)
  }

  /** Texts are set here (not in the constructor): the editor picks the language after this module loads. */
  private localize(): void {
    this.root.setAttribute('aria-label', t('colorpicker.dialog'))
    for (const b of Array.from(this.tabsEl.children) as HTMLElement[]) {
      const p = PALETTES.find((x) => x.id === b.dataset.id)
      if (p) b.textContent = t(p.labelKey)
    }
    this.recentLabel.textContent = t('colorpicker.recent')
    this.chip.title = t('colorpicker.custom')
    this.nativeInput.setAttribute('aria-label', t('colorpicker.custom'))
    this.hexInput.setAttribute('aria-label', t('colorpicker.hexCode'))
    this.dropBtn.title = t('colorpicker.eyedropperTitle')
    this.dropBtn.setAttribute('aria-label', t('colorpicker.eyedropperAria'))
    this.dropLabel.textContent = t('colorpicker.eyedropper')
  }

  isOpen(): boolean {
    return this.opts !== null
  }

  open(opts: PickOptions): void {
    if (this.opts) {
      const same = this.opts.anchor === opts.anchor
      this.close()
      if (same) return // second click on the anchor toggles closed
    }
    this.opts = opts
    this.value = normalizeHex(opts.value) ?? '#000000'
    this.recent = loadRecent()
    this.titleEl.textContent = opts.title ?? ''
    this.titleEl.hidden = !opts.title
    this.renderTabs()
    this.renderGrid()
    this.renderRecent()
    this.syncHex()
    this.nativeInput.value = this.value.toLowerCase()

    this.localize()
    this.root.hidden = false
    this.root.style.visibility = 'hidden'
    this.position()
    this.root.style.visibility = ''
    this.bindGlobal()
  }

  close(): void {
    const opts = this.opts
    if (!opts) return
    this.opts = null
    this.picking = false
    this.root.hidden = true
    this.root.style.visibility = ''
    this.unbindGlobal()
    opts.onClose?.()
  }

  // ---- picking -------------------------------------------------------------------------

  private apply(color: string, remember = true): void {
    const c = normalizeHex(color)
    if (!c || !this.opts) return
    this.value = c
    if (remember) this.remember(c)
    this.markCurrent()
    this.syncHex()
    if (this.nativeInput.value.toLowerCase() !== c.toLowerCase()) this.nativeInput.value = c.toLowerCase()
    this.opts.onPick(c)
  }

  private remember(color: string): void {
    const c = normalizeHex(color)
    if (!c) return
    this.recent = pushRecent(this.recent, c)
    lsSet(LS_RECENT, JSON.stringify(this.recent))
    this.renderRecent()
  }

  private commitHex(): void {
    const raw = this.hexInput.value.trim()
    if (raw === '') {
      this.hexInput.classList.remove('bad')
      return
    }
    const c = normalizeHex(raw)
    if (!c) {
      this.hexInput.classList.add('bad')
      return
    }
    this.hexInput.classList.remove('bad')
    if (c !== this.value) this.apply(c)
  }

  private async eyedrop(): Promise<void> {
    const opts = this.opts
    if (!opts || this.picking) return
    this.picking = true
    this.root.style.visibility = 'hidden'
    let color: string | null = null
    try {
      const ED = (window as any).EyeDropper
      if (typeof ED === 'function') {
        const r = await new ED().open()
        color = typeof r?.sRGBHex === 'string' ? r.sRGBHex : null
      } else if (opts.sampleFallback) {
        color = await opts.sampleFallback()
      }
    } catch {
      color = null // AbortError / cancel
    }
    if (this.opts !== opts) return // closed meanwhile
    this.picking = false
    this.root.style.visibility = ''
    this.position()
    if (color) this.apply(color)
  }

  // ---- rendering -----------------------------------------------------------------------

  private renderTabs(): void {
    for (const b of Array.from(this.tabsEl.children) as HTMLElement[]) {
      const on = b.dataset.id === this.paletteId
      b.classList.toggle('on', on)
      b.setAttribute('aria-selected', String(on))
    }
  }

  private swatch(hex: string): HTMLButtonElement {
    const b = el('button', 'cp-sw', { type: 'button' })
    b.dataset.hex = hex
    b.title = hex
    b.setAttribute('aria-label', hex)
    b.style.setProperty('--c', hex)
    b.style.setProperty('--edge', contrastText(hex) === '#000000' ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.2)')
    b.addEventListener('click', () => this.apply(hex))
    return b
  }

  private renderGrid(): void {
    const pal = PALETTES.find((p) => p.id === this.paletteId) ?? PALETTES[0]
    this.gridEl.replaceChildren(...pal.colors.map((c) => this.swatch(c)))
    this.markCurrent()
  }

  private renderRecent(): void {
    this.recentEl.replaceChildren(...this.recent.map((c) => this.swatch(c)))
    if (this.recent.length === 0) {
      this.recentEl.append(el('span', 'cp-empty', { textContent: t('colorpicker.noRecent') }))
    }
    this.markCurrent()
  }

  private markCurrent(): void {
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>('.cp-sw'))) {
      b.classList.toggle('cur', b.dataset.hex === this.value)
    }
  }

  private syncHex(): void {
    this.hexInput.value = this.value
    this.hexInput.classList.remove('bad')
  }

  // ---- placement + global listeners -----------------------------------------------------

  private position(): void {
    const opts = this.opts
    if (!opts) return
    const a = opts.anchor.getBoundingClientRect()
    const w = this.root.offsetWidth
    const h = this.root.offsetHeight
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const left = Math.max(MARGIN, Math.min(a.left, vw - w - MARGIN))
    let top = a.bottom + GAP
    if (top + h > vh - MARGIN) {
      const above = a.top - GAP - h
      top = above >= MARGIN ? above : Math.max(MARGIN, vh - h - MARGIN)
    }
    this.root.style.left = `${Math.round(left)}px`
    this.root.style.top = `${Math.round(top)}px`
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.picking || !this.opts) return
    const target = e.target as Node | null
    if (target && (this.root.contains(target) || this.opts.anchor.contains(target))) return
    this.close()
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || this.picking || !this.opts) return
    e.preventDefault()
    e.stopImmediatePropagation()
    this.close()
  }

  private onResize = (): void => this.position()

  private bindGlobal(): void {
    document.addEventListener('pointerdown', this.onPointerDown, true)
    window.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('resize', this.onResize)
  }

  private unbindGlobal(): void {
    document.removeEventListener('pointerdown', this.onPointerDown, true)
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('resize', this.onResize)
  }
}

/** A `.btn`-like toolbar button with a 16px colour dot (CSS var --c) and a small caret. */
export function colorButton(opts: { id: string; label: string; title: string }): HTMLButtonElement {
  const b = el('button', 'btn color-btn', { type: 'button' })
  b.id = opts.id
  b.title = opts.title
  b.setAttribute('aria-label', opts.title)
  b.setAttribute('aria-haspopup', 'dialog')
  if (opts.label) b.append(el('span', 'color-btn-label', { textContent: opts.label }))
  b.append(el('span', 'color-btn-dot'), el('span', 'color-btn-caret', { textContent: '▾' }))
  b.addEventListener('mousedown', (e) => e.preventDefault()) // keep focus where it was
  setColorButton(b, '#E5484D')
  return b
}

export function setColorButton(btn: HTMLButtonElement, hex: string): void {
  const c = normalizeHex(hex) ?? hex
  btn.style.setProperty('--c', c)
  btn.dataset.color = c
  btn.classList.toggle('light', contrastText(c) === '#000000')
}
