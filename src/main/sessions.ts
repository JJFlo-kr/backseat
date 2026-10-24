// Session package: one folder per send with everything an agent (or a later
// backseat-mcp) needs. Layout documented in PLAN.md §5.
//
// A package is written into a hidden staging folder (<root>/.writing-<id>) and published with one
// directory rename once every file is complete, so readers (backseat-mcp, latest.txt users) only
// ever see whole packages. Ids are unique per send (time + milliseconds + random) and a published
// folder is never written again.
import { app } from 'electron'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AgentTarget, CompareSource, ExportPayload } from '../shared/types'
import { alignSegments } from '../shared/align'
import { buildBrief } from './brief'
import { renameRetry, writeFileAtomic } from './fsutil'
import { briefTranslator } from './locales'


export interface SessionPackage {
  id: string
  dir: string
  annotatedPng: string
  briefMd: string
  strokesJson: string
  metaJson: string
  /** The capture without annotations; only when the editor sent basePngDataUrl. */
  screenshotPng?: string
  audioFile?: string
  transcriptJson?: string
}

export function sessionsRoot(): string {
  return join(app.getPath('pictures'), 'Backseat', 'sessions')
}

function audioExt(mime: string): string {
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

export function manualLinks(payload: ExportPayload): Map<number, number | null> {
  return new Map((payload.links ?? []).map((l) => [l.segmentIndex, l.annotationIndex]))
}

/** 20261025-143012-123-9f3a: sorts by time; the random part keeps editors sending in the same ms apart. */
function sessionId(d = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${date}-${time}-${p(d.getMilliseconds(), 3)}-${randomBytes(2).toString('hex')}`
}

function pngBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

/** Write every file of the package into `staging`; the returned paths point at the published folder `dir`. */
async function writeFiles(
  staging: string,
  dir: string,
  id: string,
  payload: ExportPayload,
  target: AgentTarget | null
): Promise<SessionPackage> {
  const at = (name: string): string => join(dir, name)
  const pkg: SessionPackage = {
    id,
    dir,
    annotatedPng: at('annotated.png'),
    briefMd: at('brief.md'),
    strokesJson: at('strokes.json'),
    metaJson: at('meta.json')
  }
  const out: [name: string, data: string | Uint8Array][] = []
  const hasShot = Boolean(payload.basePngDataUrl)
  out.push(['annotated.png', pngBuffer(payload.pngDataUrl)])
  out.push(['brief.md', buildBrief(payload, 'annotated.png', target, { ...(hasShot ? { screenshotFileName: 'screenshot.png' } : {}), t: briefTranslator() })])
  out.push(['strokes.json', JSON.stringify({ annotations: payload.annotations }, null, 2)])
  if (payload.basePngDataUrl) {
    pkg.screenshotPng = at('screenshot.png')
    out.push(['screenshot.png', pngBuffer(payload.basePngDataUrl)])
  }
  if (payload.audio) {
    const name = `audio.${audioExt(payload.audio.mimeType)}`
    pkg.audioFile = at(name)
    out.push([name, Buffer.from(payload.audio.bytes)])
  }
  if (payload.transcript) {
    pkg.transcriptJson = at('transcript.json')
    const alignment = alignSegments(payload.annotations, payload.transcript.segments, { manual: manualLinks(payload) })
    out.push(['transcript.json', JSON.stringify({ ...payload.transcript, alignment, manualLinks: payload.links ?? [] }, null, 2)])
  }
  const files = [...out.map(([name]) => name), 'meta.json']
  out.push([
    'meta.json',
    JSON.stringify({ id, memo: payload.memo, requestId: payload.meta.request?.requestId, meta: payload.meta, target, files }, null, 2)
  ])
  await Promise.all(out.map(([name, data]) => (typeof data === 'string' ? writeFile(join(staging, name), data, 'utf8') : writeFile(join(staging, name), data))))
  return pkg
}

export async function writeSessionPackage(
  payload: ExportPayload,
  target: AgentTarget | null,
  root = sessionsRoot()
): Promise<SessionPackage> {
  await mkdir(root, { recursive: true })
  for (let attempt = 0; ; attempt++) {
    const id = sessionId()
    const dir = join(root, id)
    const staging = join(root, `.writing-${id}`)
    try {
      await mkdir(staging) // exclusive: fails with EEXIST instead of sharing a folder
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST' && attempt < 8) continue
      throw err
    }
    try {
      if (existsSync(dir)) throw Object.assign(new Error(`session ${id} exists`), { code: 'EEXIST' })
      const pkg = await writeFiles(staging, dir, id, payload, target)
      await renameRetry(staging, dir, true)
      // Pointer for tools that just want "the latest" (replaced atomically as well).
      await writeFileAtomic(join(root, 'latest.txt'), dir).catch((err: unknown) => console.error('[backseat] latest.txt not updated:', err))
      return pkg
    } catch (err) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      // Another writer published the same id in the meantime: take a new one.
      if (existsSync(dir) && attempt < 8) continue
      throw err
    }
  }
}

/**
 * The most recent session package's annotated.png, for the editor's before/after view.
 * null when there is no package yet or it cannot be read.
 */
export async function latestCompareSource(root = sessionsRoot()): Promise<CompareSource | null> {
  try {
    const dir = (await readFile(join(root, 'latest.txt'), 'utf8')).trim()
    if (!dir) return null
    const png = await readFile(join(dir, 'annotated.png'))
    let capturedAt: string | undefined
    try {
      const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { meta?: { capturedAt?: string } }
      capturedAt = meta.meta?.capturedAt
    } catch {
      /* optional */
    }
    return { imageDataUrl: `data:image/png;base64,${png.toString('base64')}`, sessionDir: dir, capturedAt }
  } catch {
    return null
  }
}
