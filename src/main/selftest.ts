/**
 * Headless-ish self test: exercises the whole M0 pipeline without a human.
 *   electron . --selftest [--selftest-out=<png path>]
 * Captures the primary display, crops its centre, writes the PNG, then opens the
 * selector and editor windows briefly to make sure both renderers load without
 * console errors. Exits 0 on success, 1 on failure, printing a JSON report.
 */
import { app, BrowserWindow, clipboard, screen } from 'electron'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { IPC } from '../shared/ipc'
import type { AgentTarget, EditorInit, ExportPayload } from '../shared/types'
import { classifyTarget, instructionLine } from './agents'
import { buildBrief } from './brief'
import { captureAllDisplays, cropDip } from './capture'
import { copyToClipboard, createEditorWindow } from './editor'
import { getForegroundWindow, listTopLevelWindows, win32Available } from './native/win32'
import { writeSessionPackage } from './sessions'
import { createSelectorWindow, selectorInitFor } from './selector'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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
        activeWindow: fg ? { title: fg.title, process: fg.process } : undefined
      },
      target
    }
    const ed = createEditorWindow(init, errors)
    await waitLoad(ed)
    await sleep(900)
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
    }
    ed.destroy()

    // Clipboard + brief: the two export paths the editor uses.
    step = 'clipboard'
    const payload: ExportPayload = {
      pngDataUrl: init.imageDataUrl,
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
    report.briefLines = brief.split('\n').length

    // Session package (what "전송" writes before delivering).
    step = 'package'
    const pkg = await writeSessionPackage(payload, target, join(dirname(out), 'sessions'))
    for (const f of [pkg.annotatedPng, pkg.briefMd, pkg.strokesJson, pkg.metaJson]) {
      try {
        await access(f)
      } catch {
        errors.push(`package file missing: ${f}`)
      }
    }
    const metaBack = JSON.parse(await readFile(pkg.metaJson, 'utf8')) as { target?: { label?: string } }
    if (metaBack.target?.label !== target.label) errors.push('meta.json target mismatch')
    report.sessionDir = pkg.dir
    report.instruction = instructionLine(pkg.briefMd, pkg.annotatedPng, payload.memo)
  } catch (err) {
    errors.push(`exception at ${step}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  }
  report.warnings = warnings
  report.errors = errors
  report.ok = errors.length === 0
  console.log('BACKSEAT_SELFTEST ' + JSON.stringify(report))
  app.exit(errors.length === 0 ? 0 : 1)
}
