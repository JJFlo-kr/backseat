/**
 * Usability evaluation harness: `electron . --selftest --eval-harness=<dir> [--eval-image=<png>] --remote-debugging-port=<n>`.
 * Opens the real editor (renderer, UI/UX panel, package writer, brief, job store, MCP job logic) for an evaluator who
 * drives it through Chrome DevTools Protocol input events. Only what would reach outside this PC is replaced:
 * - 보내기 writes the real session package under <dir>/sessions but pastes into no window (two fake AI targets);
 * - copy / request-text copy record instead of touching the user's clipboard; file dialogs answer from <dir>;
 * - the project's AI is a stand-in answering through the MCP job code when the evaluator says so (<dir>/cmd).
 * Everything is recorded in <dir>/inbox.jsonl. A fresh userData lives in <dir>/userData.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import type { AgentTarget, CopyResult, EditorInit, ExportPayload, SendOptions, SendResult, SendTargetView } from '../shared/types'
import type { JobType, UiuxJob } from '../shared/uiux/types'
import { createEditorWindow } from './editor'
import { setBriefLocaleOverride, setLocaleOverride } from './locales'
import { openJob, reportJobStatus, submitJobResult } from './mcp/jobs'
import { fakeCapture } from './selftest-flows'
import { answerJob } from './selftest-uiux-agent'
import { writeSessionPackage } from './sessions'
import { uiuxStore } from './uiux/appstore'
import { jobRequestText, listJobs, sendWithReportJob } from './uiux/jobs-app'

const argValue = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const TARGETS: { target: AgentTarget; view: SendTargetView }[] = [
  ['claude-code', 'Claude Code · acme-tasks', 910001, 'acme-tasks — claude', 'WindowsTerminal.exe', 'paste-path'],
  ['codex', 'Codex · ChatGPT 앱', 910002, 'Codex - acme-tasks', 'codex.exe', 'paste-image']
].map(([kind, label, hwnd, title, process, method]) => {
  const identity = { hwnd: hwnd as number, pid: 4000 + (hwnd as number) % 10, processStartMs: 1, title: title as string, process: process as string }
  const target = { kind, label, hwnd, title, process, method, confidence: 0.9 } as AgentTarget
  const view: SendTargetView = { source: 'recent-agent', label: label as string, kind: kind as AgentTarget['kind'], estimated: false, method: method as SendTargetView['method'], identity }
  return { target, view }
})

const KIND: Record<string, JobType> = {
  overview: 'project_overview', skills: 'capabilities', skill: 'skill_setup', proposals: 'design_proposal', audit: 'style_audit', report: 'implementation_report'
}

export async function runEvalHarness(dir: string): Promise<void> {
  await rm(join(dir, 'userData'), { recursive: true, force: true })
  await mkdir(join(dir, 'userData'), { recursive: true })
  await mkdir(join(dir, 'cmd'), { recursive: true })
  await mkdir(join(dir, 'saved'), { recursive: true })
  app.setPath('userData', join(dir, 'userData'))
  setLocaleOverride('ko')
  setBriefLocaleOverride('follow')
  const inbox = join(dir, 'inbox.jsonl')
  const record = (entry: Record<string, unknown>): Promise<void> =>
    writeFile(inbox, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { flag: 'a' })

  // File dialogs answer from <dir>: saves go to <dir>/saved, opens take the path in <dir>/open-path.txt (or cancel).
  const d = dialog as unknown as Record<string, unknown>
  d.showSaveDialog = async (...args: unknown[]) => {
    const opts = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string }
    const name = (opts?.defaultPath ?? 'file').split(/[\\/]/).pop() ?? 'file'
    const filePath = join(dir, 'saved', name)
    await record({ event: 'saveDialog', filePath })
    return { canceled: false, filePath }
  }
  d.showOpenDialog = async () => {
    const p = (await readFile(join(dir, 'open-path.txt'), 'utf8').catch(() => '')).trim()
    await record({ event: 'openDialog', path: p || null })
    return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }
  }

  const image = argValue('eval-image')
  const cap = image
    ? await (async () => {
        const buf = await readFile(image)
        return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
      })()
    : await fakeCapture()
  const initFor = (c: { dataUrl: string; width: number; height: number }): EditorInit => ({
    imageDataUrl: c.dataUrl, width: c.width, height: c.height,
    meta: {
      capturedAt: new Date().toISOString(), displayId: 0, scaleFactor: 1, mode: 'rect',
      rectDip: { x: 0, y: 0, width: c.width, height: c.height }, rectPx: { x: 0, y: 0, width: c.width, height: c.height }
    },
    target: TARGETS[0].target,
    candidates: TARGETS.map((x) => x.target),
    sendTarget: TARGETS[0].view
  })

  const windows: BrowserWindow[] = []
  const open = (c: { dataUrl: string; width: number; height: number }): BrowserWindow => {
    const w = createEditorWindow(initFor(c))
    windows.push(w)
    return w
  }
  open(cap)

  // After the first editor installed the real IPC: replace only what leaves this PC.
  ipcMain.removeHandler(IPC.editorTargets)
  ipcMain.handle(IPC.editorTargets, (): SendTargetView[] => TARGETS.map((x) => x.view))
  ipcMain.removeHandler(IPC.editorSend)
  ipcMain.handle(IPC.editorSend, (_e, payload: ExportPayload, opts: SendOptions = {}): Promise<SendResult> =>
    sendWithReportJob(payload, async (p, onPackage) => {
      const chosen = opts.clipboardOnly ? null : TARGETS.find((x) => x.target.hwnd === opts.targetHwnd) ?? TARGETS[0]
      const pkg = await writeSessionPackage(p, chosen?.target ?? null, join(dir, 'sessions'))
      await onPackage(pkg.dir)
      await record({ event: 'send', target: chosen?.view.label ?? '(클립보드만)', dir: pkg.dir, memo: p.memo, annotations: p.annotations.length, uiux: Boolean(p.uiux), opts })
      await sleep(300)
      const reached: NonNullable<SendResult['status']>['reached'] = chosen ? ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'] : ['saved', 'clipboard']
      return { ok: true, delivered: chosen ? 'pasted' : 'clipboard', sessionDir: pkg.dir, message: '', status: { sendId: pkg.id, ...(chosen ? { target: chosen.view } : {}), reached } }
    })
  )
  ipcMain.removeHandler(IPC.editorCopy)
  ipcMain.handle(IPC.editorCopy, async (_e, payload: ExportPayload): Promise<CopyResult> => {
    await record({ event: 'copy', memo: payload.memo, annotations: payload.annotations.length })
    return { ok: true }
  })
  ipcMain.removeHandler(IPC.uiuxDeliverJob)
  ipcMain.handle(IPC.uiuxDeliverJob, async (_e, jobId: unknown, how: unknown) => {
    const found = await jobRequestText(jobId)
    if (!found) return { ok: false, message: '작업을 찾을 수 없습니다' }
    await record({ event: how === 'paste' ? 'jobPaste' : 'jobCopy', jobId: found.job.jobId, type: found.job.type, text: found.text })
    return { ok: true, message: how === 'paste' ? `${TARGETS[0].view.label}에 붙여넣기를 시도했어요. 제출은 직접 해 주세요.` : '요청 문장을 복사했어요.' }
  })

  // Commands from the evaluator's tool: <dir>/cmd/<id>.json → <dir>/cmd/<id>.out.json
  const run = async (c: Record<string, string>): Promise<unknown> => {
    const store = uiuxStore()
    const w = windows.filter((x) => !x.isDestroyed()).at(-1)
    switch (c.op) {
      case 'resize':
        w?.setContentSize(Number(c.width), Number(c.height))
        return { ok: true }
      case 'zoom':
        w?.webContents.setZoomFactor(Number(c.factor))
        return { ok: true }
      case 'capture': {
        const buf = await readFile(c.image)
        open({ dataUrl: `data:image/png;base64,${buf.toString('base64')}`, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) })
        return { ok: true, windows: windows.filter((x) => !x.isDestroyed()).length }
      }
      case 'ai': {
        const projects = await store.listProjects()
        const all = (await Promise.all(projects.map((p) => listJobs(p.projectId)))).flat()
        const type = KIND[c.kind] ?? null
        const pick = (j: UiuxJob): boolean => !type || j.type === type
        const job = all.filter(pick).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        if (!job) return { ok: false, said: 'AI에게 온 요청이 없습니다' }
        if (c.action === 'fetch') return { ok: true, outcome: (await openJob(store, job.jobId)).kind }
        if (c.action === 'fail') return { ok: true, outcome: (await reportJobStatus(store, { jobId: job.jobId, status: 'failed', message: '작업 중 연결이 끊겼습니다' })).kind }
        if (c.action === 'reject') {
          await openJob(store, job.jobId)
          return { ok: true, outcome: (await submitJobResult(store, { jobId: job.jobId, inputRevision: job.inputRevision, result: { nonsense: true } })).kind }
        }
        return { ok: true, outcome: await answerJob(job.projectId, job), status: job.status }
      }
      default:
        return { ok: false, error: 'unknown op' }
    }
  }
  const cmdDir = join(dir, 'cmd')
  const poll = async (): Promise<void> => {
    for (const f of (await readdir(cmdDir).catch(() => [] as string[])).filter((n) => n.endsWith('.json') && !n.endsWith('.out.json'))) {
      const p = join(cmdDir, f)
      const c = JSON.parse(await readFile(p, 'utf8')) as Record<string, string>
      await rm(p, { force: true })
      const out = await run(c).catch((err: unknown) => ({ ok: false, error: String(err) }))
      await record({ event: 'cmd', cmd: c, out })
      await writeFile(p.replace(/\.json$/, '.out.json'), JSON.stringify(out))
    }
  }
  setInterval(() => void poll(), 250)
  app.on('window-all-closed', () => app.exit(0))
  await writeFile(join(dir, 'ready.txt'), String(process.pid))
}
