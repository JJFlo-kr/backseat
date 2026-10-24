/**
 * Headless-ish self test: exercises the whole M0 pipeline without a human.
 *   electron . --selftest [--selftest-out=<png path>]
 * Captures the primary display, crops its centre, writes the PNG, then opens the
 * selector and editor windows briefly to make sure both renderers load without
 * console errors. Exits 0 on success, 1 on failure, printing a JSON report.
 */
import { app, BrowserWindow, clipboard, nativeImage, screen } from 'electron'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { createServer } from 'http'
import { dirname, join } from 'path'
import { IPC } from '../shared/ipc'
import type { AgentTarget, Annotation, CaptureMeta, CompareInfo, EditorInit, ExportPayload, Transcript } from '../shared/types'
import { classifyTarget, instructionLine } from './agents'
import { buildBrief } from './brief'
import { captureAllDisplays, cropDip } from './capture'
import { loadSettings } from './config'
import { copyToClipboard, createEditorWindow } from './editor'
import { getForegroundWindow, listTopLevelWindows, win32Available } from './native/win32'
import { scrollCapture } from './scroll'
import { writeSessionPackage } from './sessions'
import { stopStt, transcribe } from './stt'
import { wavToFloat16k } from './stt/wav'
import { createSelectorWindow, selectorInitFor } from './selector'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Copy of an image with the left half's colours inverted (alpha untouched). */
function invertedHalf(img: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = img.getSize()
  const bmp = Buffer.from(img.toBitmap())
  const half = Math.floor(width / 2)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < half; x++) {
      const i = (y * width + x) * 4
      bmp[i] = 255 - bmp[i]
      bmp[i + 1] = 255 - bmp[i + 1]
      bmp[i + 2] = 255 - bmp[i + 2]
    }
  }
  return nativeImage.createFromBitmap(bmp, { width, height })
}

/** HWND of one of our own BrowserWindows (x64: 8-byte little-endian handle). */
function hwndOf(win: BrowserWindow): number {
  const buf = win.getNativeWindowHandle()
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0)
}

/** A long numbered page in our own window: the scroll-capture target nobody else has to provide. */
function longPageHtml(rows: number): string {
  const items: string[] = []
  for (let i = 1; i <= rows; i++) {
    const hue = (i * 47) % 360
    items.push(`<div class="r" style="background:hsl(${hue} 70% ${i % 2 ? 88 : 80}%)">row ${i} · ${'▮'.repeat((i * 7) % 23)}</div>`)
  }
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#fff;font:bold 18px/40px Consolas,monospace;color:#222}
    .h{position:sticky;top:0;height:44px;line-height:44px;background:#1b1b1f;color:#fff;padding:0 12px}
    .r{height:40px;padding:0 12px;white-space:nowrap}
  </style><div class="h">Backseat scroll-capture self-test</div>${items.join('')}`
}

/** Minimal OpenAI-compatible /audio/transcriptions mock: records the request, answers verbose_json. */
function mockSttServer(): Promise<{ port: number; seen: { url?: string; auth?: string; bytes: number }[]; close: () => void }> {
  const seen: { url?: string; auth?: string; bytes: number }[] = []
  const server = createServer((req, res) => {
    let bytes = 0
    req.on('data', (c: Buffer) => { bytes += c.length })
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, bytes })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        text: '이 로그인 버튼이 너무 작아. 한 1.5배 키워줘.',
        language: 'ko',
        duration: 4.2,
        words: [
          { word: '이', start: 0.2, end: 0.35 }, { word: '로그인', start: 0.35, end: 0.8 }, { word: '버튼이', start: 0.8, end: 1.2 },
          { word: '너무', start: 1.25, end: 1.5 }, { word: '작아.', start: 1.5, end: 2.0 },
          { word: '한', start: 2.6, end: 2.8 }, { word: '1.5배', start: 2.8, end: 3.4 }, { word: '키워줘.', start: 3.4, end: 4.1 }
        ],
        segments: [{ text: '이 로그인 버튼이 너무 작아. 한 1.5배 키워줘.', start: 0.2, end: 4.1 }]
      }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({ port, seen, close: () => server.close() })
    })
  })
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function waitLoad(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoading()) return
  await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
}

/** capturePage can throw a transient viz error; retry, and downgrade a final failure to a warning. */
async function shot(win: BrowserWindow, file: string, warnings: string[]): Promise<void> {
  for (let i = 0; i < 4; i++) {
    try {
      const img = await win.webContents.capturePage()
      await writeFile(file, img.toPNG())
      return
    } catch (err) {
      await sleep(250)
      if (i === 3) warnings.push(`screenshot ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export async function runSelfTest(): Promise<void> {
  const errors: string[] = []
  const warnings: string[] = []
  const report: Record<string, unknown> = {}
  let step = 'capture'
  try {
    const t0 = Date.now()
    const caps = await captureAllDisplays()
    report.captureMs = Date.now() - t0
    report.displays = caps.map((c) => ({
      id: c.display.id,
      bounds: c.display.bounds,
      scaleFactor: c.display.scaleFactor,
      px: [c.pxWidth, c.pxHeight],
      imagePx: c.image.getSize()
    }))

    const primary = screen.getPrimaryDisplay()
    const cap = caps.find((c) => c.display.id === primary.id) ?? caps[0]
    const w = Math.min(400, cap.display.bounds.width)
    const h = Math.min(300, cap.display.bounds.height)
    const rectDip = {
      x: Math.round((cap.display.bounds.width - w) / 2),
      y: Math.round((cap.display.bounds.height - h) / 2),
      width: w,
      height: h
    }
    const { image, rectPx } = cropDip(cap, rectDip)
    report.rectDip = rectDip
    report.rectPx = rectPx
    report.cropPx = image.getSize()

    const out =
      argValue('selftest-out') ?? join(app.getPath('temp'), 'backseat-selftest', 'crop.png')
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, image.toPNG())
    report.out = out

    // Win32 layer: foreground window, window list, agent classification.
    step = 'win32'
    const fg = getForegroundWindow()
    const windows = listTopLevelWindows()
    report.win32 = win32Available()
    report.foreground = fg ? { title: fg.title, process: fg.process, bounds: fg.bounds } : null
    report.windowCount = windows.length
    report.windowsTop = windows.slice(0, 4).map((w) => `${w.process} | ${w.title.slice(0, 40)} | ${w.bounds.width}x${w.bounds.height}`)
    if (win32Available() && windows.length === 0) errors.push('no top-level windows enumerated')
    if (win32Available() && !fg) errors.push('no foreground window')
    const detected = classifyTarget(fg)
    report.target = detected
    const target: AgentTarget =
      detected ?? { kind: 'claude-code', label: 'Claude Code · 터미널 (테스트)', hwnd: 0, title: '', process: '', method: 'paste-path', confidence: 1 }

    // Speech recognition: WAV -> PCM -> worker. Runs early so the editor test can show the speech lane.
    const wav = argValue('selftest-wav')
    let sttTranscript: Transcript | null = null
    let wavBytes: Buffer | null = null
    if (wav && !process.argv.includes('--selftest-no-stt')) {
      step = 'stt'
      wavBytes = await readFile(wav)
      const pcm = wavToFloat16k(wavBytes)
      const progress: string[] = []
      const t0s = Date.now()
      const r = await transcribe({ pcm16k: pcm, audioStartMs: 1000, language: 'korean' }, (p) => {
        progress.push(`${p.stage}${p.file ? ' ' + p.file : ''}${p.progress !== undefined ? ' ' + Math.round(p.progress) + '%' : ''}`)
      })
      report.stt = {
        ok: r.ok,
        wallMs: Date.now() - t0s,
        elapsedMs: r.elapsedMs,
        text: r.transcript?.text,
        segments: r.transcript?.segments.map((s) => [s.start, s.end, s.text]),
        error: r.error,
        progressTail: progress.slice(-3)
      }
      if (!r.ok || !r.transcript) {
        errors.push(`stt failed: ${r.error ?? 'no transcript'}`)
      } else {
        sttTranscript = r.transcript
        if (!/로그인/.test(r.transcript.text) || !/버튼/.test(r.transcript.text)) {
          errors.push(`stt text unexpected: ${r.transcript.text}`)
        }
        if (r.transcript.segments.length < 2) errors.push('expected several speech segments')
      }
    }

    // Selector renderer smoke test (with the real window list so hover hit-testing has data).
    step = 'selector'
    const sel = createSelectorWindow(cap, errors)
    await Promise.all([
      waitLoad(sel),
      sel.loadFile(join(__dirname, '../renderer/selector/index.html'))
    ])
    sel.webContents.send(IPC.selectorInit, selectorInitFor(cap, windows))
    await sleep(700)
    const shotsDir = argValue('selftest-shots')
    if (shotsDir) {
      await mkdir(shotsDir, { recursive: true })
      // Simulate a drag so the screenshot shows a live selection.
      const sx = rectDip.x
      const sy = rectDip.y
      const ex = rectDip.x + rectDip.width
      const ey = rectDip.y + rectDip.height
      sel.webContents.sendInputEvent({ type: 'mouseMove', x: sx, y: sy })
      sel.webContents.sendInputEvent({ type: 'mouseDown', x: sx, y: sy, button: 'left', clickCount: 1 })
      sel.webContents.sendInputEvent({ type: 'mouseMove', x: ex, y: ey, button: 'left' })
      await sleep(150)
      await shot(sel, join(shotsDir, 'selector.png'), warnings)
      report.selectorShot = join(shotsDir, 'selector.png')
    }
    sel.destroy()

    // Editor renderer smoke test.
    step = 'editor'
    const init: EditorInit = {
      imageDataUrl: `data:image/png;base64,${image.toPNG().toString('base64')}`,
      width: rectPx.width,
      height: rectPx.height,
      meta: {
        capturedAt: new Date().toISOString(),
        displayId: cap.display.id,
        scaleFactor: cap.display.scaleFactor,
        rectDip,
        rectPx,
        mode: 'rect',
        activeWindow: fg ? { title: fg.title, process: fg.process } : undefined,
        request: { requestId: 'selftest-1', question: '어느 버튼이 문제인지 표시해 주세요', agent: 'selftest' }
      },
      target,
      request: { requestId: 'selftest-1', question: '어느 버튼이 문제인지 표시해 주세요', agent: 'selftest', cwd: '', createdAt: new Date().toISOString() },
      // "Previous capture" for the compare view: the same image with its left half inverted, so it
      // differs whatever happens to be on screen (the diff share must come out near 50%).
      compare: {
        imageDataUrl: `data:image/png;base64,${invertedHalf(image).toPNG().toString('base64')}`,
        sessionDir: join(app.getPath('temp'), 'backseat-selftest', 'sessions', '20260101-000000')
      },
      debug: true
    }
    const ed = createEditorWindow(init, errors)
    await waitLoad(ed)
    // Wait until the renderer has processed editor:init and drawn the image (debug hook).
    const tReady = Date.now()
    let ready = false
    for (let i = 0; i < 80; i++) {
      await sleep(125)
      ready = (await ed.webContents.executeJavaScript(
        `Boolean(window.__backseat && window.__backseat.state().init)`
      )) as boolean
      if (ready) break
    }
    report.editorReadyMs = Date.now() - tReady
    if (!ready) errors.push('editor never became ready (init not processed)')
    await sleep(200)
    if (shotsDir) {
      // Draw a stroke through the renderer's own pointer handling, then screenshot.
      const bounds = ed.getContentBounds()
      const cx = Math.round(bounds.width / 2)
      const cy = Math.round(bounds.height / 2)
      ed.webContents.sendInputEvent({ type: 'mouseMove', x: cx - 60, y: cy - 20 })
      ed.webContents.sendInputEvent({ type: 'mouseDown', x: cx - 60, y: cy - 20, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 12; i++) {
        ed.webContents.sendInputEvent({
          type: 'mouseMove',
          x: cx - 60 + i * 10,
          y: cy - 20 + Math.round(Math.sin(i / 2) * 25),
          button: 'left'
        })
        await sleep(16)
      }
      ed.webContents.sendInputEvent({ type: 'mouseUp', x: cx + 60, y: cy, button: 'left', clickCount: 1 })
      await sleep(200)
      await shot(ed, join(shotsDir, 'editor.png'), warnings)
      report.editorShot = join(shotsDir, 'editor.png')
      step = 'timeline'

      // Second stroke a bit later so the timeline has two bars, then open the timeline.
      await sleep(400)
      ed.webContents.sendInputEvent({ type: 'mouseDown', x: cx - 40, y: cy + 50, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 8; i++) {
        ed.webContents.sendInputEvent({ type: 'mouseMove', x: cx - 40 + i * 12, y: cy + 50, button: 'left' })
        await sleep(16)
      }
      ed.webContents.sendInputEvent({ type: 'mouseUp', x: cx + 56, y: cy + 50, button: 'left', clickCount: 1 })
      await sleep(100)
      const tlState = (await ed.webContents.executeJavaScript(
        `(() => { document.getElementById('timeline-toggle').click();
           const c = document.getElementById('tl-canvas').getBoundingClientRect();
           return { open: !document.getElementById('timeline').hidden, x: c.left, y: c.top, w: c.width, h: c.height,
                    undoDisabled: document.getElementById('undo').disabled }; })()`
      )) as { open: boolean; x: number; y: number; w: number; h: number; undoDisabled: boolean }
      report.timeline = tlState
      if (!tlState.open) errors.push('timeline did not open')
      if (tlState.undoDisabled) errors.push('undo should be enabled after drawing')
      await sleep(300)
      await shot(ed, join(shotsDir, 'editor-timeline.png'), warnings)

      // Scrub to 35% of the axis: the first stroke should be partially drawn, the second absent.
      const sx = Math.round(tlState.x + tlState.w * 0.35)
      const sy = Math.round(tlState.y + tlState.h * 0.5)
      ed.webContents.sendInputEvent({ type: 'mouseDown', x: sx, y: sy, button: 'left', clickCount: 1 })
      ed.webContents.sendInputEvent({ type: 'mouseMove', x: sx + 10, y: sy, button: 'left' })
      await sleep(80)
      ed.webContents.sendInputEvent({ type: 'mouseUp', x: sx + 10, y: sy, button: 'left', clickCount: 1 })
      await sleep(250)
      const scrubbed = (await ed.webContents.executeJavaScript(
        `document.getElementById('timeline').classList.contains('scrubbed') + ' ' + document.querySelector('[data-tl=clock]').textContent`
      )) as string
      report.scrub = scrubbed
      if (!scrubbed.startsWith('true')) errors.push(`scrub did not engage: ${scrubbed}`)
      await shot(ed, join(shotsDir, 'editor-scrub.png'), warnings)

      // Undo twice -> no annotations; redo once -> one annotation.
      const hist = (await ed.webContents.executeJavaScript(
        `(() => { const u = document.getElementById('undo'), r = document.getElementById('redo');
           u.click(); u.click(); const afterUndo = u.disabled; r.click();
           return { afterUndo, redoLeft: !r.disabled, undoNow: !u.disabled }; })()`
      )) as { afterUndo: boolean; redoLeft: boolean; undoNow: boolean }
      report.history = hist
      if (!hist.afterUndo || !hist.redoLeft || !hist.undoNow) errors.push(`history state wrong: ${JSON.stringify(hist)}`)

      // Crop: drag the middle half of the image with the crop tool; the canvas, meta and the
      // remaining stroke must all move together, and one undo must bring everything back.
      step = 'crop'
      type DbgAnn = { kind: string; x: number; y: number }
      type DbgState = { tool: string; size: [number, number]; crop: { x: number; y: number; width: number; height: number }; annotations: DbgAnn[]; meta: CaptureMeta | null; canUndo: boolean; compare: { available: boolean; on: boolean; mode: string; diffPercent: number | null } }
      const state = (): Promise<DbgState> => ed.webContents.executeJavaScript(`window.__backseat.state()`) as Promise<DbgState>
      const before = await state()
      // Drag inside the part of the image that is actually on screen (the stage clips a tall image;
      // a mouse-up over the timeline panel never reaches the canvas).
      const geo = (await ed.webContents.executeJavaScript(
        `(() => { document.querySelector('[data-tool=crop]').click();
           const r = document.getElementById('ink').getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect();
           const top = Math.max(r.top, s.top), bottom = Math.min(r.bottom, s.bottom), left = Math.max(r.left, s.left), right = Math.min(r.right, s.right);
           return { left, top, width: right - left, height: bottom - top, inkLeft: r.left, inkTop: r.top, inkWidth: r.width }; })()`
      )) as { left: number; top: number; width: number; height: number; inkLeft: number; inkTop: number; inkWidth: number }
      const cx0 = Math.round(geo.left + geo.width * 0.25)
      const cy0 = Math.round(geo.top + geo.height * 0.25)
      const cx1 = Math.round(geo.left + geo.width * 0.75)
      const cy1 = Math.round(geo.top + geo.height * 0.75)
      ed.webContents.sendInputEvent({ type: 'mouseMove', x: cx0, y: cy0 })
      ed.webContents.sendInputEvent({ type: 'mouseDown', x: cx0, y: cy0, button: 'left', clickCount: 1 })
      ed.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round((cx0 + cx1) / 2), y: Math.round((cy0 + cy1) / 2), button: 'left' })
      await sleep(40)
      ed.webContents.sendInputEvent({ type: 'mouseMove', x: cx1, y: cy1, button: 'left' })
      await sleep(40)
      ed.webContents.sendInputEvent({ type: 'mouseUp', x: cx1, y: cy1, button: 'left', clickCount: 1 })
      await sleep(250)
      const after = await state()
      report.cropPointer = (after as unknown as { pointer: unknown; cropDrag: boolean }).pointer
      const pxPerCss = before.size[0] / geo.inkWidth
      const expW = Math.round((cx1 - cx0) * pxPerCss)
      const expH = Math.round((cy1 - cy0) * pxPerCss)
      const expX = Math.round((cx0 - geo.inkLeft) * pxPerCss)
      const expY = Math.round((cy0 - geo.inkTop) * pxPerCss)
      const near = (a: number, b: number, tol = 3): boolean => Math.abs(a - b) <= tol
      report.crop = { before: before.size, after: after.size, crop: after.crop, expected: [expX, expY, expW, expH], annBefore: before.annotations[0], annAfter: after.annotations[0] }
      if (!near(after.size[0], expW) || !near(after.size[1], expH)) errors.push(`crop size wrong: ${JSON.stringify(report.crop)}`)
      if (!near(after.crop.x, expX) || !near(after.crop.y, expY)) errors.push(`crop origin wrong: ${JSON.stringify(after.crop)}`)
      if (!after.canUndo) errors.push('crop should be undoable')
      if (before.annotations.length === 1 && after.annotations.length === 1) {
        // The stroke crosses the middle of the image, so it survives and shifts by the crop origin.
        if (!near(after.annotations[0].x, before.annotations[0].x - after.crop.x) || !near(after.annotations[0].y, before.annotations[0].y - after.crop.y)) {
          errors.push(`annotation did not move with the crop: ${JSON.stringify(report.crop)}`)
        }
      } else errors.push(`unexpected annotation count around crop: ${before.annotations.length} -> ${after.annotations.length}`)
      const m = after.meta
      if (!m || !m.crop || m.rectPx.width !== after.size[0] || m.rectPx.height !== after.size[1] || m.rectPx.x !== rectPx.x + after.crop.x) {
        errors.push(`meta after crop wrong: ${JSON.stringify(m && { rectPx: m.rectPx, crop: m.crop })}`)
      }
      if (m && Math.abs(m.rectDip.width - after.size[0] / cap.display.scaleFactor) > 0.2) errors.push(`rectDip after crop wrong: ${JSON.stringify(m.rectDip)}`)
      await shot(ed, join(shotsDir, 'editor-crop.png'), warnings)
      const cropPayload = (await ed.webContents.executeJavaScript(`window.__backseat.payload()`)) as { meta: CaptureMeta; annotations: Annotation[] }
      const cropBrief = buildBrief({ pngDataUrl: '', memo: '', annotations: cropPayload.annotations, meta: cropPayload.meta }, 'annotated.png')
      if (!cropBrief.includes('자르기: 원본 캡처의') || !cropBrief.includes(`${after.size[0]}×${after.size[1]} px`)) errors.push('brief lacks the crop line / cropped size')
      const stroke = cropPayload.annotations[0]
      if (stroke && stroke.kind === 'stroke' && stroke.points.some((p) => p.x < -1 || p.y < -1 || p.x > after.size[0] + 1 || p.y > after.size[1] + 1)) {
        warnings.push('cropped stroke has points outside the cropped image (it crosses the crop edge: fine)')
      }
      await ed.webContents.executeJavaScript(`document.getElementById('undo').click(); true`)
      await sleep(150)
      const restored = await state()
      if (restored.size[0] !== before.size[0] || restored.size[1] !== before.size[1]) errors.push(`undo did not restore the image size: ${restored.size}`)
      if (!restored.annotations[0] || restored.annotations[0].x !== before.annotations[0].x) errors.push('undo did not restore annotation coordinates')
      if (restored.meta?.crop) errors.push('meta.crop should be gone after undo')
      await ed.webContents.executeJavaScript(`document.querySelector('[data-tool=pen]').click(); true`)

      // Before/after comparison: the init carried a shifted "previous capture"; toggle and cycle the modes.
      step = 'compare'
      let cmpReady = false
      for (let i = 0; i < 40 && !cmpReady; i++) {
        cmpReady = (await state()).compare.available
        if (!cmpReady) await sleep(100)
      }
      if (!cmpReady) errors.push('compare image never became available')
      else {
        const barVisible = (await ed.webContents.executeJavaScript(`!document.getElementById('comparebar').hidden`)) as boolean
        if (!barVisible) errors.push('compare bar hidden although a previous capture exists')
        // O key toggles it on (through the real hotkey path), buttons switch the mode.
        ed.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'O' })
        ed.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'O' })
        await sleep(150)
        const on = await state()
        if (!on.compare.on) errors.push(`O did not turn the comparison on: ${JSON.stringify(on.compare)}`)
        if (on.compare.diffPercent === null || on.compare.diffPercent < 40 || on.compare.diffPercent > 60) errors.push(`compare diff percent off (expected ~50): ${on.compare.diffPercent}`)
        const cmpShots: Record<string, number> = {}
        for (const mode of ['overlay', 'wipe', 'diff']) {
          await ed.webContents.executeJavaScript(`document.querySelector('[data-cmp-mode=${mode}]').click(); true`)
          await sleep(120)
          const s = await state()
          if (s.compare.mode !== mode || !s.compare.on) errors.push(`compare mode ${mode} not applied: ${JSON.stringify(s.compare)}`)
          // The compare layer must hold pixels in every mode (overlay/wipe show the previous image, diff lights up changes).
          cmpShots[mode] = (await ed.webContents.executeJavaScript(
            `(() => { const c = document.getElementById('cmp'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
               let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) n++; return n; })()`
          )) as number
          if (cmpShots[mode] === 0) errors.push(`compare layer empty in ${mode} mode`)
          await shot(ed, join(shotsDir, `editor-compare-${mode}.png`), warnings)
        }
        report.compare = { diffPercent: on.compare.diffPercent, layerPixels: cmpShots }
        const cmpPayload = (await ed.webContents.executeJavaScript(`window.__backseat.payload()`)) as { meta: CaptureMeta; annotations: Annotation[]; compare?: CompareInfo }
        if (!cmpPayload.compare || cmpPayload.compare.mode !== 'diff') errors.push(`payload.compare missing: ${JSON.stringify(cmpPayload.compare)}`)
        const cmpBrief = buildBrief({ pngDataUrl: '', memo: '', annotations: [], meta: cmpPayload.meta, compare: cmpPayload.compare }, 'annotated.png')
        const cmpLines = cmpBrief.split('\n').filter((l) => l.startsWith('이전 캡처와 비교:'))
        if (cmpLines.length !== 1 || !cmpLines[0].includes('20260101-000000') || !cmpLines[0].includes('차이')) errors.push(`brief compare line wrong: ${cmpLines.join(' | ')}`)
        report.compareLine = cmpLines[0]
        // Esc turns it off (before anything else Esc would do).
        ed.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        ed.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
        await sleep(120)
        if ((await state()).compare.on) errors.push('Esc did not turn the comparison off')
        if (ed.isDestroyed()) errors.push('Esc closed the editor instead of the comparison')
      }

      // Text styling (round 2): multi-line plate with custom colour / opacity / shadow / bold, outline colour + italic,
      // plain text and badges are added as ONE history step, must round-trip through the payload, then shot and undone.
      step = 'text-style'
      {
        const sz = (await state()).size
        const sf = cap.display.scaleFactor
        const count = async (): Promise<number> => (await state()).annotations.length
        const base0 = await count()
        const T = { tStart: 100, tEnd: 200 }
        // the timeline panel eats the stage height; close it so the shot shows the image at a readable size
        const tlWasOpen = (await ed.webContents.executeJavaScript(`!document.getElementById('timeline').hidden`)) as boolean
        if (tlWasOpen) { await ed.webContents.executeJavaScript(`document.getElementById('timeline-toggle').click(); true`); await sleep(200) }
        const styled: Annotation[] = [
          { kind: 'text', text: '첫 줄\n둘째 줄', x: Math.round(sz[0] * 0.06), y: Math.round(sz[1] * 0.12), color: '#FFFFFF', fontSize: 30 * sf, font: 'Jua', style: 'plate', bg: '#1E5EFF', bgOpacity: 0.7, shadow: true, bold: true, ...T },
          { kind: 'text', text: '윤곽선 이탤릭\nOutline two', x: Math.round(sz[0] * 0.06), y: Math.round(sz[1] * 0.45), color: '#FFE066', fontSize: 30 * sf, font: 'Noto Sans KR', style: 'outline', outline: '#1A1AFF', italic: true, ...T },
          { kind: 'text', text: '효과 없음', x: Math.round(sz[0] * 0.06), y: Math.round(sz[1] * 0.8), color: '#E5484D', fontSize: 30 * sf, font: 'Nanum Pen Script', style: 'plain', shadow: true, ...T },
          { kind: 'badge', x: Math.round(sz[0] * 0.5), y: Math.round(sz[1] * 0.3), n: 1, color: '#E5484D', size: 22 * sf, ...T },
          { kind: 'badge', x: Math.round(sz[0] * 0.6), y: Math.round(sz[1] * 0.3), n: 2, color: '#2F80ED', size: 22 * sf, ...T }
        ]
        await ed.webContents.executeJavaScript(`window.__backseat.addAnnotations(${JSON.stringify(styled)}); document.querySelector('[data-tool="text"]').click(); true`)
        await sleep(500) // fonts load lazily, then the canvas repaints
        if ((await count()) !== base0 + styled.length) errors.push(`styled annotations were not added: ${base0} -> ${await count()}`)
        const stPayload = (await ed.webContents.executeJavaScript(`window.__backseat.payload()`)) as { annotations: Annotation[] }
        const texts = stPayload.annotations.filter((a): a is Extract<Annotation, { kind: 'text' }> => a.kind === 'text').slice(-3)
        const [pl, ou, pn] = texts
        if (!pl || !ou || !pn) errors.push('styled texts missing from the payload')
        else {
          if (!pl.text.includes('\n') || pl.bg !== '#1E5EFF' || pl.bgOpacity !== 0.7 || pl.shadow !== true || pl.bold !== true || pl.style !== 'plate') errors.push(`plate text did not round-trip: ${JSON.stringify(pl)}`)
          if (!ou.text.includes('\n') || ou.outline !== '#1A1AFF' || ou.italic !== true || ou.style !== 'outline') errors.push(`outline text did not round-trip: ${JSON.stringify(ou)}`)
          if (pn.style !== 'plain' || pn.shadow !== true || pn.bg !== undefined) errors.push(`plain text did not round-trip: ${JSON.stringify(pn)}`)
          const stBrief = buildBrief({ pngDataUrl: '', memo: '', annotations: stPayload.annotations, meta: (await state()).meta as CaptureMeta }, 'annotated.png')
          if (!stBrief.includes('텍스트(굵게·그림자) "첫 줄 / 둘째 줄"') || !stBrief.includes('텍스트(기울임) "윤곽선 이탤릭 / Outline two"')) errors.push('brief lacks the text style note / one-line multi-line text')
        }
        const bar = (await ed.webContents.executeJavaScript(
          `(() => { const fit = (id) => { const e = document.getElementById(id); return { hidden: e.hidden, fits: e.scrollWidth <= e.clientWidth, w: e.clientWidth, sw: e.scrollWidth, h: e.clientHeight }; };
             return { textbar: fit('textbar'), toolbar2: fit('toolbar2'), win: window.innerWidth }; })()`
        )) as { textbar: { hidden: boolean; fits: boolean; w: number; sw: number; h: number }; toolbar2: { fits: boolean; w: number; sw: number; h: number }; win: number }
        report.textbar = bar
        if (bar.textbar.hidden) errors.push('#textbar is hidden while the text tool is active')
        if (!bar.textbar.fits || !bar.toolbar2.fits) errors.push(`toolbar rows overflow at ${bar.win}px: ${JSON.stringify(bar)}`)
        await shot(ed, join(shotsDir, 'editor-text.png'), warnings)

        // Re-editing: double-click a styled text -> the toolbar adopts its props and the box mirrors them.
        const at = (x: number, y: number): Promise<{ x: number; y: number }> => ed.webContents.executeJavaScript(
          `(() => { const i = document.getElementById('ink'), r = i.getBoundingClientRect(); return { x: Math.round(r.left + ${x} * r.width / i.width), y: Math.round(r.top + ${y} * r.height / i.height) }; })()`
        ) as Promise<{ x: number; y: number }>
        const boxOpen = (): Promise<boolean> => ed.webContents.executeJavaScript(`document.querySelector('textarea.textbox') !== null`) as Promise<boolean>
        const dbl = async (p: { x: number; y: number }): Promise<void> => {
          for (let attempt = 0; attempt < 3; attempt++) {
            for (const clickCount of [1, 2]) {
              ed.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount })
              ed.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount })
              await sleep(40)
            }
            await sleep(300)
            if (await boxOpen()) return
          }
        }
        // Enter with no box open would be the editor's "send" hotkey: only press it while a box exists.
        const enterInBox = async (): Promise<void> => {
          if (!(await boxOpen())) { errors.push('expected an open text box before pressing Enter'); return }
          ed.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
          ed.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
        }
        const editInfo = (): Promise<{ value: string; bgChip: string; bold: string; italic: string; shadow: string; auto: string; outline: string; barHidden: boolean } | null> =>
          ed.webContents.executeJavaScript(
            `(() => { const b = document.querySelector('textarea.textbox'); if (!b) return null; const g = (id) => document.getElementById(id);
               return { value: b.value, bgChip: g('text-bg').dataset.color, bold: g('text-bold').getAttribute('aria-pressed'), italic: g('text-italic').getAttribute('aria-pressed'),
                        shadow: g('text-shadow').getAttribute('aria-pressed'), auto: g('text-bg-auto').getAttribute('aria-pressed'), outline: g('text-outline').dataset.color, barHidden: g('textbar').hidden }; })()`
          ) as Promise<{ value: string; bgChip: string; bold: string; italic: string; shadow: string; auto: string; outline: string; barHidden: boolean } | null>
        await dbl(await at(sz[0] * 0.06 + 30, sz[1] * 0.12))
        const e1 = await editInfo()
        if (!e1 || e1.value !== '첫 줄\n둘째 줄' || e1.bgChip !== '#1E5EFF' || e1.bold !== 'true' || e1.shadow !== 'true' || e1.auto !== 'false') errors.push(`editing the plate text did not adopt its props: ${JSON.stringify(e1)}`)
        ed.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }) // collapse the selection so the styled text is visible
        ed.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
        await sleep(100)
        await shot(ed, join(shotsDir, 'editor-text-edit.png'), warnings)
        await enterInBox() // unchanged -> no history step
        await sleep(200)
        await dbl(await at(sz[0] * 0.06 + 30, sz[1] * 0.45))
        const e2 = await editInfo()
        if (!e2 || !e2.value.includes('\n') || e2.outline !== '#1A1AFF' || e2.italic !== 'true' || e2.shadow !== 'false') errors.push(`editing the outline text did not adopt its props: ${JSON.stringify(e2)}`)
        await ed.webContents.executeJavaScript(`document.getElementById('text-shadow').click(); document.getElementById('text-bold').click(); true`)
        await sleep(150)
        const e3 = await editInfo()
        if (!e3 || e3.value !== e2?.value || e3.shadow !== 'true') errors.push(`toggling an effect lost the text box content: ${JSON.stringify(e3)}`)
        ed.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }) // collapse the selection so the styled text is visible
        ed.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
        await sleep(100)
        await shot(ed, join(shotsDir, 'editor-text-edit2.png'), warnings)
        await enterInBox()
        await sleep(250)
        const edited = ((await ed.webContents.executeJavaScript(`window.__backseat.payload()`)) as { annotations: Annotation[] }).annotations.filter((a): a is Extract<Annotation, { kind: 'text' }> => a.kind === 'text')[1]
        if (!edited || edited.shadow !== true || edited.italic !== true || edited.bold !== false || edited.outline !== '#1A1AFF') errors.push(`edited text fields wrong: ${JSON.stringify(edited)}`)
        await ed.webContents.executeJavaScript(`document.getElementById('undo').click(); true`) // back to the styled batch
        await sleep(150)

        // Real input path: type two lines with Shift+Enter, commit with Enter, expect one text containing a newline.
        const ib = (await ed.webContents.executeJavaScript(
          `(() => { const r = document.getElementById('ink').getBoundingClientRect(); return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.75 }; })()`
        )) as { x: number; y: number }
        const px = Math.round(ib.x)
        const py = Math.round(ib.y)
        ed.webContents.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 })
        ed.webContents.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 })
        await sleep(250)
        for (const ch of 'ab') ed.webContents.sendInputEvent({ type: 'char', keyCode: ch })
        ed.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['shift'] })
        ed.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['shift'] })
        for (const ch of 'cd') ed.webContents.sendInputEvent({ type: 'char', keyCode: ch })
        await sleep(100)
        const boxState = (await ed.webContents.executeJavaScript(
          `(() => { const b = document.querySelector('textarea.textbox'); return b ? { value: b.value, h: b.getBoundingClientRect().height } : null; })()`
        )) as { value: string; h: number } | null
        if (!boxState || boxState.value !== 'ab\ncd') errors.push(`Shift+Enter did not insert a newline: ${JSON.stringify(boxState)}`)
        await shot(ed, join(shotsDir, 'editor-text-live.png'), warnings)
        await enterInBox()
        await sleep(300)
        const multi = (await ed.webContents.executeJavaScript(`window.__backseat.payload()`)) as { annotations: Annotation[] }
        const last = multi.annotations[multi.annotations.length - 1]
        if (multi.annotations.length !== base0 + styled.length + 1 || last.kind !== 'text' || last.text !== 'ab\ncd') errors.push(`typed multi-line text wrong: ${JSON.stringify(last)}`)
        report.textStyle = { typed: last.kind === 'text' ? last.text : null, boxHeight: boxState?.h }

        // Undo the typed text and the styled batch so later steps see the original document.
        await ed.webContents.executeJavaScript(`document.getElementById('undo').click(); document.getElementById('undo').click(); document.querySelector('[data-tool="pen"]').click(); true`)
        await sleep(200)
        if ((await count()) !== base0) errors.push(`undo did not remove the styled annotations: ${await count()} vs ${base0}`)
        if (tlWasOpen) { await ed.webContents.executeJavaScript(`document.getElementById('timeline-toggle').click(); true`); await sleep(200) }
      }

      // Colour popover: one colour button per colour (pen, text background, outline) opening the shared picker. Real mouse / key
      // input; checks palette pick, recents, Esc handling (the editor must not see it), anchoring, the open text box, the
      // eyedropper fallback (sample mode) and that the toolbar rows still fit on one line at 820 px.
      step = 'colors'
      {
        type ColorState = { color: string; textBg: string | null; textOutline: string | null; pickerOpen: boolean; annotations: unknown[]; compare: { on: boolean }; pointer: { down: number } }
        const cs = (): Promise<ColorState> => state() as unknown as Promise<ColorState>
        const js = <T>(code: string): Promise<T> => ed.webContents.executeJavaScript(code) as Promise<T>
        const LS_KEYS = ['backseat.color', 'backseat.recentColors', 'backseat.palette']
        const savedLs = await js<(string | null)[]>(`${JSON.stringify(LS_KEYS)}.map((k) => { try { return localStorage.getItem(k) } catch { return null } })`)
        const origColor = (await cs()).color
        const tlWasOpen = await js<boolean>(`!document.getElementById('timeline').hidden`)
        if (tlWasOpen) { await js(`document.getElementById('timeline-toggle').click(); true`); await sleep(200) }
        const rectOf = (sel: string): Promise<{ x: number; y: number; l: number; t: number; r: number; b: number } | null> => js(
          `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
             return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`
        )
        const click = async (sel: string): Promise<boolean> => {
          const p = await rectOf(sel)
          if (!p) { errors.push(`colors: ${sel} not found`); return false }
          ed.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
          ed.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
          ed.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
          await sleep(160)
          return true
        }
        const pressEsc = async (): Promise<void> => {
          ed.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
          ed.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
          await sleep(150)
        }
        const popInfo = (): Promise<{ hidden: boolean; l: number; t: number; r: number; b: number; w: number; h: number; tab: string | null; title: string }> => js(
          `(() => { const p = document.getElementById('color-pop'), r = p.getBoundingClientRect(), t = p.querySelector('.cp-tab.on');
             return { hidden: p.hidden, l: r.left, t: r.top, r: r.right, b: r.bottom, w: window.innerWidth, h: window.innerHeight, tab: t ? t.dataset.id : null, title: p.querySelector('.cp-title').textContent }; })()`
        )
        const fits = (): Promise<Record<string, { fits: boolean; w: number; sw: number; h: number; hidden: boolean }> & { win: number }> => js(
          `(() => { const fit = (id) => { const e = document.getElementById(id); return { hidden: e.hidden, fits: e.scrollWidth <= e.clientWidth, w: e.clientWidth, sw: e.scrollWidth, h: e.clientHeight }; };
             return { toolbar: fit('toolbar'), toolbar2: fit('toolbar2'), textbar: fit('textbar'), win: window.innerWidth }; })()`
        )
        const inside = (p: { l: number; t: number; r: number; b: number; w: number; h: number }): boolean => p.l >= 0 && p.t >= 0 && p.r <= p.w && p.b <= p.h
        const boxOpen = (): Promise<boolean> => js<boolean>(`document.querySelector('textarea.textbox') !== null`)
        const annCount = async (): Promise<number> => (await cs()).annotations.length
        const ann0 = await annCount()
        const origBg = (await cs()).textBg
        const origStyle = await js<string>(`document.querySelector('#text-style .active').dataset.textStyle`)

        await js(`document.querySelector('[data-tool="pen"]').click(); true`)
        await sleep(100)

        // 1. pen colour button: open, screenshot, pick from 차분, recents, Escape
        if (await click('#color')) {
          const open = await cs()
          const pop = await popInfo()
          const anchor = await rectOf('#color')
          if (!open.pickerOpen || pop.hidden) errors.push(`colour popover did not open: ${JSON.stringify({ open: open.pickerOpen, hidden: pop.hidden })}`)
          if (!inside(pop)) errors.push(`colour popover is not inside the window: ${JSON.stringify(pop)}`)
          if (anchor && (pop.t < anchor.b || Math.abs(pop.l - anchor.l) > 2)) errors.push(`colour popover is not anchored under #color: ${JSON.stringify({ pop, anchor })}`)
          report.colorPop = pop
          await shot(ed, join(shotsDir, 'editor-colors.png'), warnings)
          const picked = '#4465E9' // 차분 palette
          await click('#color-pop .cp-tab[data-id="calm"]')
          await click(`#color-pop .cp-grid .cp-sw[data-hex="${picked}"]`)
          const after = await cs()
          const dot = await js<string>(`document.getElementById('color').dataset.color`)
          const dotCss = await js<string>(`getComputedStyle(document.querySelector('#color .color-btn-dot')).backgroundColor`)
          const recents = await js<string[]>(`JSON.parse(localStorage.getItem('backseat.recentColors') || '[]')`)
          const savedColor = await js<string | null>(`localStorage.getItem('backseat.color')`)
          if (after.color !== picked) errors.push(`pen colour did not change to ${picked}: ${after.color}`)
          if (dot !== picked || dotCss !== 'rgb(68, 101, 233)') errors.push(`colour button dot not updated: ${dot} / ${dotCss}`)
          if (!recents.map((c) => c.toUpperCase()).includes(picked)) errors.push(`recents lack ${picked}: ${JSON.stringify(recents)}`)
          if (savedColor !== picked) errors.push(`backseat.color not persisted: ${savedColor}`)
          if ((await popInfo()).tab !== 'calm') errors.push('차분 tab not selected')
          if (!after.pickerOpen) errors.push('popover closed after a swatch pick (should stay open)')
          const before = await cs()
          await pressEsc()
          const afterEsc = await cs()
          if (afterEsc.pickerOpen || !(await popInfo()).hidden) errors.push('Escape did not close the colour popover')
          if (ed.isDestroyed()) errors.push('Escape in the colour popover closed the editor')
          else if (afterEsc.annotations.length !== before.annotations.length || afterEsc.compare.on !== before.compare.on || afterEsc.color !== picked) {
            errors.push(`Escape in the colour popover had side effects: ${JSON.stringify({ before, afterEsc })}`)
          }
        }

        // 2. layout at 820 px content width: all three rows on one line (text bar shown with the text tool)
        if (!ed.isDestroyed()) {
          const prevSize = ed.getContentSize()
          await js(`document.querySelector('[data-tool="text"]').click(); true`)
          ed.setContentSize(820, prevSize[1])
          await sleep(350)
          const f = await fits()
          report.colorRows = f
          for (const id of ['toolbar', 'toolbar2', 'textbar'] as const) {
            if (!f[id].fits || (id !== 'textbar' && f[id].hidden)) errors.push(`#${id} does not fit on one line at ${f.win}px: ${JSON.stringify(f[id])}`)
          }
          if (f.textbar.hidden) errors.push('#textbar hidden with the text tool')
          ed.setContentSize(prevSize[0], prevSize[1])
          await sleep(300)
        }

        // 3. text background colour button (text tool): anchored popover, pastel pick, 자동 off
        if (!ed.isDestroyed()) await js(`document.querySelector('[data-text-style="plate"]').click(); true`) // earlier steps may have left another style
        if (!ed.isDestroyed() && (await click('#text-bg'))) {
          const pop = await popInfo()
          const anchor = await rectOf('#text-bg')
          if (!(await cs()).pickerOpen) errors.push('text background popover did not open')
          if (!inside(pop)) errors.push(`text background popover is not inside the window: ${JSON.stringify(pop)}`)
          if (anchor && (pop.t < anchor.b || Math.abs(pop.l - anchor.l) > 2 || pop.title !== '배경 상자 색')) errors.push(`text background popover is not anchored under #text-bg: ${JSON.stringify({ pop, anchor })}`)
          await shot(ed, join(shotsDir, 'editor-colors-textbg.png'), warnings)
          const pastel = '#B2F2BB'
          await click('#color-pop .cp-tab[data-id="pastel"]')
          await click(`#color-pop .cp-grid .cp-sw[data-hex="${pastel}"]`)
          const st = await cs()
          const autoPressed = await js<string | null>(`document.getElementById('text-bg-auto').getAttribute('aria-pressed')`)
          const bgDot = await js<string>(`document.getElementById('text-bg').dataset.color`)
          if (st.textBg !== pastel || autoPressed !== 'false' || bgDot !== pastel) errors.push(`text background pick failed: ${JSON.stringify({ textBg: st.textBg, autoPressed, bgDot })}`)
          await pressEsc()
          if ((await cs()).pickerOpen || ed.isDestroyed()) errors.push('Escape did not just close the text background popover')
          // the plate must follow into a live text box, and the box must survive working in the popover
          if (!ed.isDestroyed()) {
            const ib = await rectOf('#ink')
            if (ib) {
              const px = Math.round(ib.l + (ib.r - ib.l) * 0.8)
              const py = Math.round(ib.t + (ib.b - ib.t) * 0.12)
              ed.webContents.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 })
              ed.webContents.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 })
              await sleep(250)
              for (const ch of 'hi') ed.webContents.sendInputEvent({ type: 'char', keyCode: ch })
              await sleep(80)
              const bgOf = (): Promise<string | null> => js(`(() => { const b = document.querySelector('textarea.textbox'); return b ? getComputedStyle(b).backgroundColor : null; })()`)
              if (await click('#text-bg')) {
                await click('#color-pop .cp-grid .cp-sw[data-hex="#FFC9C9"]')
                const live = await bgOf()
                if (!live || !live.startsWith('rgba(255, 201, 201') && !live.startsWith('rgb(255, 201, 201')) errors.push(`live text box plate did not follow the popover pick: ${live}`)
                if (!(await boxOpen())) errors.push('the open text box was closed by working in the colour popover')
                await click('#color-pop .cp-tab[data-id="mono"]')
                if (!(await boxOpen())) errors.push('the open text box was closed by a click inside the popover')
                await pressEsc()
                const focused = await js<boolean>(`document.activeElement === document.querySelector('textarea.textbox')`)
                if (!(await boxOpen()) || !focused) errors.push(`closing the popover did not hand the focus back to the text box (open=${await boxOpen()}, focused=${focused})`)
                await pressEsc() // now the text box's own Escape: cancels without a history step
                if (await boxOpen()) errors.push('Escape did not cancel the text box')
                if (ed.isDestroyed()) errors.push('Escape closed the editor instead of the text box')
              }
            }
          }
          // back to automatic plate (UI path) so later steps see the original look
          if (!ed.isDestroyed()) {
            if (origBg === null) {
              await js(`document.getElementById('text-bg-auto').click(); true`)
              await sleep(100)
              if ((await cs()).textBg !== null) errors.push('could not restore the automatic plate colour')
            }
          }
        }

        // 4. eyedropper fallback: sample mode (window.EyeDropper hidden for the test)
        if (!ed.isDestroyed()) {
          await js(`document.querySelector('[data-tool="pen"]').click(); window.__edBackup = window.EyeDropper; window.EyeDropper = undefined; true`)
          const before = await cs()
          if (await click('#color')) {
            await click('#color-pop .cp-drop')
            const status = await js<string>(`document.getElementById('status').textContent`)
            const sampling = await js<boolean>(`document.getElementById('stage').classList.contains('sampling')`)
            const cursor = await js<string>(`getComputedStyle(document.getElementById('ink')).cursor`)
            if (!status.includes('캡처 화면을 클릭해 색을 집으세요') || !sampling || cursor !== 'crosshair') errors.push(`sample mode not shown: ${JSON.stringify({ status, sampling, cursor })}`)
            await pressEsc() // cancel: popover stays, nothing changes
            const cancelled = await cs()
            if (!cancelled.pickerOpen || cancelled.color !== before.color || await js<boolean>(`document.getElementById('stage').classList.contains('sampling')`)) {
              errors.push(`Escape in sample mode: ${JSON.stringify({ open: cancelled.pickerOpen, color: cancelled.color })}`)
            }
            await click('#color-pop .cp-drop')
            const ink = await rectOf('#ink')
            if (ink) {
              const px = Math.round(ink.l + (ink.r - ink.l) * 0.04)
              const py = Math.round(ink.t + (ink.b - ink.t) * 0.04)
              const expected = await js<string>(
                `(() => { const i = document.getElementById('ink'), r = i.getBoundingClientRect(), b = document.getElementById('base');
                   const d = b.getContext('2d').getImageData(Math.floor((${px} - r.left) * i.width / r.width), Math.floor((${py} - r.top) * i.height / r.height), 1, 1).data;
                   return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(); })()`
              )
              ed.webContents.sendInputEvent({ type: 'mouseMove', x: px, y: py })
              ed.webContents.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 })
              ed.webContents.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 })
              await sleep(200)
              const sampled = await cs()
              report.colorSample = { expected, got: sampled.color }
              if (sampled.color !== expected) errors.push(`sampled colour ${sampled.color} != pixel ${expected}`)
              if (sampled.annotations.length !== before.annotations.length || sampled.pointer.down !== before.pointer.down) {
                errors.push(`sampling leaked into the editor (annotation / pointer): ${JSON.stringify({ before: before.pointer, sampled: sampled.pointer, n: sampled.annotations.length })}`)
              }
              if (!sampled.pickerOpen) errors.push('popover closed after sampling')
            }
            await pressEsc()
          }
          await js(`window.EyeDropper = window.__edBackup; delete window.__edBackup; true`)
        }

        // restore: pen colour, text style, storage, tool, timeline
        if (!ed.isDestroyed()) {
          await js(`document.querySelector('[data-text-style="${origStyle}"]').click(); true`)
          await js(`window.__backseat.setColor(${JSON.stringify(origColor)}); document.querySelector('[data-tool="pen"]').click(); true`)
          await js(
            `${JSON.stringify(LS_KEYS)}.forEach((k, i) => { const v = ${JSON.stringify(savedLs)}[i]; try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch {} }); true`
          )
          await sleep(100)
          const fin = await cs()
          if (fin.color !== origColor || fin.pickerOpen || (await annCount()) !== ann0) errors.push(`colour step left the editor changed: ${JSON.stringify({ color: fin.color, origColor, open: fin.pickerOpen, ann: await annCount(), ann0 })}`)
          if (tlWasOpen) { await js(`document.getElementById('timeline-toggle').click(); true`); await sleep(200) }
        }
      }

      // Microphone path: start/stop a real recording (silence is fine) and let it run through STT.
      step = 'mic'
      const statusText = (): Promise<string> =>
        ed.webContents.executeJavaScript(`document.getElementById('status').textContent`) as Promise<string>
      report.audioInputs = await ed.webContents.executeJavaScript(
        `navigator.mediaDevices.enumerateDevices().then(ds => ds.filter(d => d.kind === 'audioinput').length)`
      )
      report.stateBeforeMic = await ed.webContents.executeJavaScript(`JSON.stringify(window.__backseat.state())`)
      report.gumProbe = await ed.webContents.executeJavaScript(
        `Promise.race([
           navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { const n = s.getTracks().length; s.getTracks().forEach(t => t.stop()); return 'ok tracks=' + n }),
           new Promise(r => setTimeout(() => r('timeout 4s'), 4000))
         ]).catch(e => 'err ' + e.name + ': ' + e.message)`
      )
      await ed.webContents.executeJavaScript(`document.getElementById('mic').click(); true`)
      await sleep(1500)
      const recording = (await ed.webContents.executeJavaScript(
        `document.getElementById('mic').classList.contains('recording')`
      )) as boolean
      await ed.webContents.executeJavaScript(`document.getElementById('mic').click(); true`)
      let micStatus = ''
      for (let i = 0; i < 160; i++) {
        await sleep(250)
        micStatus = await statusText()
        if (!/녹음 중|해석 중|전사 중|내려받는 중|모델/.test(micStatus)) break
      }
      report.mic = { recording, status: micStatus }
      if (!recording) warnings.push(`microphone did not start: ${micStatus}`)

      // Inject the real transcript from the WAV so the speech lane and links render.
      if (sttTranscript) {
        step = 'speech-lane'
        await ed.webContents.executeJavaScript(
          `window.dispatchEvent(new CustomEvent('backseat:debug-transcript', { detail: ${JSON.stringify(sttTranscript)} })); true`
        )
        await sleep(300)
        const lane = (await ed.webContents.executeJavaScript(
          `document.getElementById('status').textContent + ' | ' + document.getElementById('tl-canvas').getBoundingClientRect().height`
        )) as string
        report.speechLane = lane
        if (!lane.includes('디버그 전사 주입')) errors.push(`transcript injection failed: ${lane}`)
        await shot(ed, join(shotsDir, 'editor-speech.png'), warnings)

        // Text tool: type Korean, commit with Enter, then erase it with the eraser.
        step = 'text-eraser'
        const countAnn = (): Promise<number> =>
          ed.webContents.executeJavaScript(`window.__backseat.state().annotations.length`) as Promise<number>
        const before = await countAnn()
        await ed.webContents.executeJavaScript(`document.querySelector('[data-tool="text"]').click(); true`)
        ed.webContents.sendInputEvent({ type: 'mouseDown', x: cx - 80, y: cy - 90, button: 'left', clickCount: 1 })
        ed.webContents.sendInputEvent({ type: 'mouseUp', x: cx - 80, y: cy - 90, button: 'left', clickCount: 1 })
        await sleep(250)
        for (const ch of '가독성 OK') ed.webContents.sendInputEvent({ type: 'char', keyCode: ch })
        await sleep(100)
        ed.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
        ed.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
        await sleep(400)
        const afterText = await countAnn()
        const lastKind = (await ed.webContents.executeJavaScript(
          `(() => { const s = window.__backseat.state().annotations; return s.length ? s[s.length - 1].kind : 'none' })()`
        )) as string
        report.textTool = { before, afterText, lastKind }
        if (afterText !== before + 1 || lastKind !== 'text') errors.push(`text tool did not add a text: ${JSON.stringify(report.textTool)}`)
        await shot(ed, join(shotsDir, 'editor-text-typed.png'), warnings)

        await ed.webContents.executeJavaScript(`document.querySelector('[data-tool="eraser"]').click(); true`)
        ed.webContents.sendInputEvent({ type: 'mouseDown', x: cx - 90, y: cy - 90, button: 'left', clickCount: 1 })
        for (let i = 1; i <= 6; i++) {
          ed.webContents.sendInputEvent({ type: 'mouseMove', x: cx - 90 + i * 15, y: cy - 90, button: 'left' })
          await sleep(16)
        }
        ed.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy - 90, button: 'left', clickCount: 1 })
        await sleep(300)
        const afterErase = await countAnn()
        report.eraser = { afterErase, status: await statusText() }
        if (afterErase !== before) errors.push(`eraser did not remove exactly the text: ${afterText} -> ${afterErase}`)
        await ed.webContents.executeJavaScript(`document.querySelector('[data-tool="pen"]').click(); true`)
      }
    }
    ed.destroy()

    // Scroll capture: a long page in our own always-on-top window, wheeled by the real Win32 path.
    step = 'scroll'
    if (win32Available() && !process.argv.includes('--selftest-no-scroll')) {
      const wa = cap.display.workArea
      const sw = Math.min(520, wa.width - 40)
      const sh = Math.min(420, wa.height - 40)
      const page = new BrowserWindow({
        x: Math.round(wa.x + (wa.width - sw) / 2), y: Math.round(wa.y + (wa.height - sh) / 2), width: sw, height: sh,
        frame: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#ffffff', show: false,
        webPreferences: { sandbox: true, contextIsolation: true }
      })
      page.setMenu(null)
      page.setAlwaysOnTop(true, 'screen-saver')
      await Promise.all([
        new Promise<void>((r) => page.once('ready-to-show', () => r())),
        page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(longPageHtml(70))}`)
      ])
      page.show()
      page.focus()
      await sleep(500)
      const cb = page.getContentBounds() // DIP, virtual desktop
      const pageRect = { x: cb.x - cap.display.bounds.x, y: cb.y - cap.display.bounds.y, width: cb.width, height: cb.height }
      const t0s = Date.now()
      const r = await scrollCapture(cap.display, { hwnd: hwndOf(page) }, pageRect, {
        maxHeightPx: 2600, showProgress: false, escCancels: false, dumpDir: argValue('selftest-scroll-dump')
      })
      page.destroy()
      const scrollPng = join(shotsDir ?? dirname(out), 'scroll.png')
      await writeFile(scrollPng, r.image.toPNG())
      report.scroll = { frames: r.frames, viewportPx: r.viewportPx, heightPx: r.heightPx, widthPx: r.widthPx, stoppedBy: r.stoppedBy, wallMs: Date.now() - t0s, png: scrollPng }
      const expectedW = Math.round(cb.width * cap.display.scaleFactor)
      if (r.frames < 3) errors.push(`scroll capture stitched too few frames: ${JSON.stringify(report.scroll)}`)
      if (r.heightPx < r.viewportPx * 2) errors.push(`scroll capture not tall enough: ${JSON.stringify(report.scroll)}`)
      if (Math.abs(r.widthPx - expectedW) > 2) errors.push(`scroll capture width ${r.widthPx} != window ${expectedW}`)
      if (r.stoppedBy !== 'end' && r.stoppedBy !== 'limit') warnings.push(`scroll capture stopped by ${r.stoppedBy}`)
      const sz = r.image.getSize()
      if (sz.height !== r.heightPx) errors.push(`stitched image height ${sz.height} != reported ${r.heightPx}`)
    } else report.scroll = 'skipped'

    // Cloud STT adapter against a local mock of /v1/audio/transcriptions.
    step = 'cloud-stt'
    {
      const settings = loadSettings()
      if (settings.sttBackend !== 'local' && !process.env.BACKSEAT_SELFTEST_ALLOW_CLOUD) warnings.push(`sttBackend is ${settings.sttBackend} in config.json`)
      if ('sttApiKey' in settings || JSON.stringify(settings).includes('BACKSEAT_STT_API_KEY')) errors.push('the API key must never live in settings')
      const mock = await mockSttServer()
      try {
        const pcm = new Float32Array(16000 * 2)
        for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 20) * 0.2
        const cloud = await transcribe({ pcm16k: pcm, audioStartMs: 1000, language: 'korean' }, undefined, {
          backend: 'openai', apiBase: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'selftest-key', model: 'whisper-1'
        })
        report.cloudStt = { ok: cloud.ok, error: cloud.error, segments: cloud.transcript?.segments.map((s) => [s.start, s.end, s.text]), model: cloud.transcript?.model, request: mock.seen[0] }
        if (!cloud.ok || !cloud.transcript) errors.push(`cloud stt failed: ${cloud.error}`)
        else {
          if (cloud.transcript.segments.length !== 2 || cloud.transcript.segments[0].start !== 1200) errors.push(`cloud stt segments wrong: ${JSON.stringify(report.cloudStt)}`)
          if (!cloud.transcript.segments[1].text.includes('1.5배')) errors.push('cloud stt lost the "1.5배" glue')
          if (cloud.transcript.durationMs !== 2000) errors.push(`cloud stt duration ${cloud.transcript.durationMs}`)
        }
        const seen = mock.seen[0]
        if (!seen || seen.url !== '/v1/audio/transcriptions' || seen.auth !== 'Bearer selftest-key' || seen.bytes < 16000 * 2 * 2) {
          errors.push(`cloud stt request wrong: ${JSON.stringify(seen)}`)
        }
        // Without a key the adapter must refuse before touching the network.
        const noKey = await transcribe({ pcm16k: new Float32Array(100), audioStartMs: 0 }, undefined, {
          backend: 'openai', apiBase: `http://127.0.0.1:${mock.port}/v1`, apiKey: '', model: 'whisper-1'
        })
        if (noKey.ok || !/BACKSEAT_STT_API_KEY/.test(noKey.error ?? '')) errors.push(`cloud stt without key should fail clearly: ${JSON.stringify(noKey)}`)
        if (mock.seen.length !== 1) errors.push('cloud stt contacted the server without a key')
      } finally {
        mock.close()
      }
    }

    // Clipboard + brief: the two export paths the editor uses.
    step = 'clipboard'
    const payload: ExportPayload = {
      pngDataUrl: init.imageDataUrl,
      basePngDataUrl: init.imageDataUrl,
      memo: '자가 테스트 메모',
      annotations: [
        {
          kind: 'stroke',
          color: '#E5484D',
          width: 3,
          points: [
            { x: 10, y: 10 },
            { x: 120, y: 80 }
          ],
          tStart: 1200,
          tEnd: 3000
        },
        { kind: 'text', text: '여기 키워줘', x: 200, y: 150, color: '#E5484D', fontSize: 18, tStart: 4500, tEnd: 7000 },
        { kind: 'arrow', x1: 20, y1: 200, x2: 150, y2: 120, color: '#2F80ED', width: 3, tStart: 7500, tEnd: 8200 },
        { kind: 'rect', x: 30, y: 30, w: 80, h: 40, color: '#F5A623', width: 3, tStart: 8500, tEnd: 9100 },
        { kind: 'badge', x: 300, y: 60, n: 1, color: '#E5484D', size: 22, tStart: 9500, tEnd: 9500 },
        { kind: 'blur', x: 250, y: 200, w: 100, h: 50, strength: 14, tStart: 10000, tEnd: 10600 }
      ],
      meta: init.meta
    }
    const copy = await copyToClipboard(payload)
    if (!copy.ok) errors.push(`clipboard: ${copy.error}`)
    const items = await clipboard.read()
    const types = items.flatMap((it) => it.types)
    report.clipboardTypes = types
    if (!types.includes('image/png')) errors.push(`clipboard has no image/png: ${types.join(',')}`)
    const text = await clipboard.readText()
    if (text !== payload.memo) errors.push(`clipboard text mismatch: ${JSON.stringify(text)}`)

    const brief = buildBrief(payload, 'crop.png')
    await writeFile(out.replace(/\.png$/i, '.md'), brief, 'utf8')
    if (!brief.includes('① 펜') || !brief.includes('② 텍스트 "여기 키워줘"')) errors.push('brief format')
    for (const needle of ['③ 화살표', '④ 사각형', '⑤ 번호 1', '⑥ 블러']) {
      if (!brief.includes(needle)) errors.push(`brief missing ${needle}`)
    }
    if (!brief.includes('Backseat 주석(사용자 추가)')) errors.push('brief lacks the Backseat annotation heading')
    if (!brief.split('\n').some((l) => l.startsWith('> 주의:'))) errors.push('brief lacks the 주의 line')
    if (brief.includes('screenshot.png')) errors.push('brief mentions screenshot.png without a screenshot')
    if (brief.includes('## 전체 전사')) errors.push('brief still has the 전체 전사 section')
    const shotBrief = buildBrief(payload, 'crop.png', null, { screenshotFileName: 'screenshot.png' })
    if (!shotBrief.includes('원본(주석 없음): screenshot.png')) errors.push('brief lacks the screenshot reference line')
    report.briefLines = brief.split('\n').length

    // Session package (what "전송" writes before delivering).
    step = 'package'
    const pkg = await writeSessionPackage(payload, target, join(dirname(out), 'sessions'))
    if (!pkg.screenshotPng) errors.push('package has no screenshot.png despite basePngDataUrl')
    for (const f of [pkg.annotatedPng, pkg.briefMd, pkg.strokesJson, pkg.metaJson, ...(pkg.screenshotPng ? [pkg.screenshotPng] : [])]) {
      try {
        await access(f)
      } catch {
        errors.push(`package file missing: ${f}`)
      }
    }
    const pkgBrief = await readFile(pkg.briefMd, 'utf8')
    if (!pkgBrief.includes('원본(주석 없음): screenshot.png') || !pkgBrief.includes('원래 화면은 screenshot.png')) errors.push('package brief does not reference screenshot.png')
    if (pkgBrief.includes('## 전체 전사')) errors.push('package brief still has the 전체 전사 section')
    const metaBack = JSON.parse(await readFile(pkg.metaJson, 'utf8')) as { target?: { label?: string }; files?: string[] }
    if (!metaBack.files?.includes('screenshot.png')) errors.push('meta.json files lacks screenshot.png')
    if (metaBack.target?.label !== target.label) errors.push('meta.json target mismatch')
    report.sessionDir = pkg.dir
    report.instruction = instructionLine(pkg.briefMd, pkg.annotatedPng, payload.memo)

    // Voice package: transcript + audio + a manual link end up in brief.md / transcript.json.
    if (sttTranscript && wavBytes) {
      step = 'voice-package'
      const voicePayload: ExportPayload = {
        ...payload,
        transcript: sttTranscript,
        audio: { bytes: new Uint8Array(wavBytes), mimeType: 'audio/wav' },
        links: [{ segmentIndex: 0, annotationIndex: 1 }]
      }
      const pkg2 = await writeSessionPackage(voicePayload, target, join(dirname(out), 'sessions'))
      const brief2 = await readFile(pkg2.briefMd, 'utf8')
      if (!brief2.includes('🗣')) errors.push('brief has no speech lines')
      if (!brief2.includes('음성:') || !brief2.includes('transcript.json')) errors.push('brief lacks the 음성 line')
      if (brief2.includes('## 전체 전사')) errors.push('voice brief still has the 전체 전사 section')
      if (!brief2.includes('수동 연결')) errors.push('brief missing the manual link')
      if (!brief2.includes('selftest의 질문')) errors.push('brief missing the agent question')
      if (!pkg2.transcriptJson || !pkg2.audioFile) errors.push('package missing transcript/audio')
      const meta2 = JSON.parse(await readFile(pkg2.metaJson, 'utf8')) as { requestId?: string }
      if (meta2.requestId !== 'selftest-1') errors.push('meta.json missing requestId')
      report.briefVoice = brief2.split('\n').filter((l) => l.includes('🗣')).slice(0, 5)
    }
    stopStt()
  } catch (err) {
    errors.push(`exception at ${step}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  }
  report.warnings = warnings
  report.errors = errors
  report.ok = errors.length === 0
  console.log('BACKSEAT_SELFTEST ' + JSON.stringify(report))
  app.exit(errors.length === 0 ? 0 : 1)
}
