/**
 * Language self-test: `electron . --selftest --selftest-locale=<all|code[,code…]> --selftest-shots=<dir>`.
 * For each UI language it opens the selector, the editor (with text annotations in Korean, Japanese and
 * both Chinese scripts, the timeline and the text bar) and the About window, and checks that
 *   - the renderers report no errors,
 *   - <html lang> is the language and no raw message key is visible (text, title, aria-label, placeholder),
 *   - the toolbar rows fit on one line at 820 px (scrollWidth <= clientWidth),
 *   - the bundled CJK fonts are really used for the text annotations (document.fonts),
 * then writes screenshots and a sample brief.md in that language to <dir>/<locale>/.
 */
import { app, BrowserWindow, screen } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import { isLocale, LOCALES, type Locale } from '../shared/i18n'
import type { Annotation, EditorInit, ExportPayload } from '../shared/types'
import { createAboutWindow } from './about'
import { buildBrief } from './brief'
import { captureAllDisplays, cropDip } from './capture'
import { createEditorWindow } from './editor'
import { briefTranslator, mergedMessages, setBriefLocaleOverride, setLocaleOverride, uiLocale } from './locales'
import { createSelectorWindow, selectorInitFor } from './selector'
import { loadPage } from './windows'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitLoad(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoading()) return
  await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
}

async function shot(win: BrowserWindow, file: string, warnings: string[]): Promise<void> {
  for (let i = 0; i < 4; i++) {
    try {
      await writeFile(file, (await win.webContents.capturePage()).toPNG())
      return
    } catch (err) {
      await sleep(250)
      if (i === 3) warnings.push(`screenshot ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/** Every visible string of a page: text nodes plus title / aria-label / placeholder attributes. */
const COLLECT_TEXT = `(() => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const s = n.textContent.trim(); if (s) out.push(s) }
  document.querySelectorAll('[title],[aria-label],[placeholder]').forEach((e) => {
    for (const a of ['title', 'aria-label', 'placeholder']) { const v = e.getAttribute(a); if (v) out.push(v) }
  });
  out.push(document.title);
  return { lang: document.documentElement.lang, texts: out };
})()`

/** Strings that are a message key (or contain one as a token): the translation was not applied. */
function rawKeys(texts: string[], keys: ReadonlySet<string>): string[] {
  const found = new Set<string>()
  for (const s of texts) {
    for (const m of s.matchAll(/[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+/g)) if (keys.has(m[0])) found.add(m[0])
  }
  return [...found]
}

async function checkPage(win: BrowserWindow, what: string, locale: Locale, keys: ReadonlySet<string>, errors: string[]): Promise<void> {
  const r = (await win.webContents.executeJavaScript(COLLECT_TEXT)) as { lang: string; texts: string[] }
  if (r.lang !== locale) errors.push(`${locale} ${what}: <html lang> is "${r.lang}"`)
  const raw = rawKeys(r.texts, keys)
  if (raw.length) errors.push(`${locale} ${what}: untranslated keys visible: ${raw.join(', ')}`)
}

/** Sample annotations: one text per CJK script (bundled fonts) plus a shape, for the screenshots and the brief. */
function sampleAnnotations(w: number, h: number, sf: number): Annotation[] {
  const T = { tStart: 100, tEnd: 900 }
  const text = (s: string, font: string, row: number): Annotation => ({
    kind: 'text', text: s, x: Math.round(w * 0.05), y: Math.round(h * (0.12 + row * 0.2)), color: '#FFFFFF',
    fontSize: 22 * sf, font, style: 'plate', ...T
  })
  return [
    text('한국어 글자 확인 · 로그인', 'Noto Sans KR', 0),
    text('日本語の文字・ログイン画面', 'Noto Sans JP', 1),
    text('简体中文·登录按钮太小', 'Noto Sans SC', 2),
    text('繁體中文·登入按鈕太小', 'Noto Sans TC', 3),
    { kind: 'arrow', x1: Math.round(w * 0.7), y1: Math.round(h * 0.2), x2: Math.round(w * 0.85), y2: Math.round(h * 0.6), color: '#E5484D', width: 4 * sf, ...T }
  ]
}

async function runOne(locale: Locale, root: string, report: Record<string, unknown>, errors: string[], warnings: string[]): Promise<void> {
  setLocaleOverride(locale)
  setBriefLocaleOverride('follow')
  const dir = join(root, locale)
  await mkdir(dir, { recursive: true })
  const keys = new Set(Object.keys(mergedMessages('en')))
  const caps = await captureAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const cap = caps.find((c) => c.display.id === primary.id) ?? caps[0]
  const w = Math.min(640, cap.display.bounds.width)
  const h = Math.min(400, cap.display.bounds.height)
  const rectDip = { x: Math.round((cap.display.bounds.width - w) / 2), y: Math.round((cap.display.bounds.height - h) / 2), width: w, height: h }
  const { image, rectPx } = cropDip(cap, rectDip)
  const r: Record<string, unknown> = {}
  report[locale] = r

  // Selector
  const sel = createSelectorWindow(cap, errors)
  await Promise.all([waitLoad(sel), sel.loadFile(join(__dirname, '../renderer/selector/index.html'))])
  sel.webContents.send(IPC.selectorInit, { ...selectorInitFor(cap, []), locale: uiLocale(), messages: mergedMessages() })
  await sleep(600)
  await checkPage(sel, 'selector', locale, keys, errors)
  await shot(sel, join(dir, 'selector.png'), warnings)
  sel.destroy()

  // Editor
  const init: EditorInit = {
    imageDataUrl: `data:image/png;base64,${image.toPNG().toString('base64')}`,
    width: rectPx.width,
    height: rectPx.height,
    meta: { capturedAt: new Date().toISOString(), displayId: cap.display.id, scaleFactor: cap.display.scaleFactor, rectDip, rectPx, mode: 'rect' },
    target: { kind: 'claude-code', label: 'Claude Code · Windows Terminal', hwnd: 0, title: '', process: 'WindowsTerminal.exe', method: 'paste-path', confidence: 0.9 },
    compare: { imageDataUrl: `data:image/png;base64,${image.toPNG().toString('base64')}`, sessionDir: join(app.getPath('temp'), 'backseat-selftest', '20260101-000000') },
    debug: true
  }
  const ed = createEditorWindow(init, errors)
  await waitLoad(ed)
  let ready = false
  for (let i = 0; i < 80 && !ready; i++) {
    await sleep(125)
    ready = (await ed.webContents.executeJavaScript(`Boolean(window.__backseat && window.__backseat.state().init)`)) as boolean
  }
  if (!ready) {
    errors.push(`${locale} editor never became ready`)
    ed.destroy()
    return
  }
  const js = <T>(code: string): Promise<T> => ed.webContents.executeJavaScript(code) as Promise<T>
  const sf = cap.display.scaleFactor
  await js(`window.__backseat.addAnnotations(${JSON.stringify(sampleAnnotations(rectPx.width, rectPx.height, sf))}); true`)
  await js(`document.fonts.ready.then(() => true)`)
  await sleep(500)
  r.defaultFont = await js<string>(`document.getElementById('font').value`)

  // Bundled CJK faces: document.fonts must have loaded each family (not fallen back to a system font / tofu).
  const loaded = await js<string[]>(`(async () => { await document.fonts.ready; const out = new Set(); document.fonts.forEach((f) => { if (f.status === 'loaded') out.add(f.family.replace(/"/g, '')) }); return [...out] })()`)
  r.fontsLoaded = loaded
  for (const fam of ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC']) {
    if (!loaded.includes(fam)) errors.push(`${locale}: font ${fam} was not loaded for its text annotation`)
  }

  // Layout at 820 px with the text tool (all three toolbar rows) and the compare bar.
  const size = ed.getContentSize()
  ed.setContentSize(820, Math.max(size[1], 560))
  await js(`document.querySelector('[data-tool="text"]').click(); true`)
  await sleep(400)
  const fits = await js<Record<string, { hidden: boolean; fits: boolean; w: number; sw: number }>>(
    `(() => { const fit = (id) => { const e = document.getElementById(id); return e ? { hidden: e.hidden, fits: e.scrollWidth <= e.clientWidth, w: e.clientWidth, sw: e.scrollWidth } : null };
       return { toolbar: fit('toolbar'), toolbar2: fit('toolbar2'), textbar: fit('textbar'), targetbar: fit('targetbar'), comparebar: fit('comparebar') }; })()`
  )
  r.fits = fits
  for (const [id, f] of Object.entries(fits)) {
    if (f && !f.hidden && !f.fits) errors.push(`${locale}: #${id} overflows at 820 px (${f.sw} > ${f.w})`)
  }
  if (fits.textbar?.hidden) errors.push(`${locale}: #textbar hidden with the text tool`)
  await checkPage(ed, 'editor', locale, keys, errors)
  await shot(ed, join(dir, 'editor.png'), warnings)

  // Timeline open
  await js(`document.getElementById('timeline-toggle').click(); true`)
  await sleep(400)
  await checkPage(ed, 'editor+timeline', locale, keys, errors)
  await shot(ed, join(dir, 'editor-timeline.png'), warnings)

  // Sample brief in this language (the brief follows the UI language here)
  const payload = (await js<ExportPayload>(`window.__backseat.payload ? window.__backseat.payload() : null`)) ?? null
  const annotations = (await js<Annotation[]>(`window.__backseat.state().annotations`)) ?? []
  const briefPayload: ExportPayload = payload ?? { pngDataUrl: '', memo: '', annotations, meta: init.meta }
  const brief = buildBrief(
    { ...briefPayload, memo: briefPayload.memo || 'memo', meta: { ...briefPayload.meta, request: { requestId: 'x', question: '?', agent: 'selftest' } } },
    'annotated.png',
    init.target,
    { screenshotFileName: 'screenshot.png', t: briefTranslator() }
  )
  await writeFile(join(dir, 'brief.md'), brief, 'utf8')
  if (rawKeys(brief.split('\n'), keys).length) errors.push(`${locale}: brief has untranslated keys`)
  ed.destroy()

  // About
  const about = createAboutWindow(errors)
  await Promise.all([waitLoad(about), loadPage(about, 'about')])
  for (let i = 0; i < 40; i++) {
    await sleep(100)
    if ((await about.webContents.executeJavaScript(`document.body.dataset.ready === '1'`)) as boolean) break
  }
  about.show()
  await sleep(300)
  await checkPage(about, 'about', locale, keys, errors)
  const aboutFits = (await about.webContents.executeJavaScript(
    `(() => { const a = document.querySelector('.actions'); return a ? a.scrollWidth <= a.clientWidth : true })()`
  )) as boolean
  if (!aboutFits) errors.push(`${locale}: About buttons overflow`)
  await shot(about, join(dir, 'about.png'), warnings)
  about.destroy()
}

export async function runLocaleSelfTest(arg: string, shotsDir: string | undefined): Promise<void> {
  const errors: string[] = []
  const warnings: string[] = []
  const report: Record<string, unknown> = {}
  const list: Locale[] = arg === 'all' ? [...LOCALES] : arg.split(',').filter(isLocale)
  if (!list.length) errors.push(`unknown --selftest-locale=${arg} (use all or a comma-separated list of ${LOCALES.join(', ')})`)
  const root = shotsDir ?? join(app.getPath('temp'), 'backseat-selftest', 'locales')
  report.shots = root
  for (const l of list) {
    try {
      await runOne(l, root, report, errors, warnings)
    } catch (err) {
      errors.push(`exception in ${l}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    }
  }
  setLocaleOverride(null)
  setBriefLocaleOverride(null)
  report.warnings = warnings
  report.errors = errors
  report.ok = errors.length === 0
  console.log('BACKSEAT_SELFTEST ' + JSON.stringify(report))
  app.exit(errors.length === 0 ? 0 : 1)
}
