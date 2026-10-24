// Session package: one folder per send with everything an agent (or a later
// backseat-mcp) needs. Layout documented in PLAN.md §5.
import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AgentTarget, CompareSource, ExportPayload } from '../shared/types'
import { alignSegments } from '../shared/align'
import { buildBrief } from './brief'

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

function audioExt(mime: string): string {
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

export function manualLinks(payload: ExportPayload): Map<number, number | null> {
  return new Map((payload.links ?? []).map((l) => [l.segmentIndex, l.annotationIndex]))
}

export function sessionsRoot(): string {
  return join(app.getPath('pictures'), 'Backseat', 'sessions')
}

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function pngBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

export async function writeSessionPackage(
  payload: ExportPayload,
  target: AgentTarget | null,
  root = sessionsRoot()
): Promise<SessionPackage> {
  const id = stamp()
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  const pkg: SessionPackage = {
    id,
    dir,
    annotatedPng: join(dir, 'annotated.png'),
    briefMd: join(dir, 'brief.md'),
    strokesJson: join(dir, 'strokes.json'),
    metaJson: join(dir, 'meta.json')
  }
  const files = ['annotated.png', 'brief.md', 'strokes.json', 'meta.json']
  const hasShot = Boolean(payload.basePngDataUrl)
  const writes: Promise<void>[] = [
    writeFile(pkg.annotatedPng, pngBuffer(payload.pngDataUrl)),
    writeFile(pkg.briefMd, buildBrief(payload, 'annotated.png', target, hasShot ? { screenshotFileName: 'screenshot.png' } : {}), 'utf8'),
    writeFile(pkg.strokesJson, JSON.stringify({ annotations: payload.annotations }, null, 2), 'utf8')
  ]
  if (payload.basePngDataUrl) {
    pkg.screenshotPng = join(dir, 'screenshot.png')
    files.push('screenshot.png')
    writes.push(writeFile(pkg.screenshotPng, pngBuffer(payload.basePngDataUrl)))
  }
  if (payload.audio) {
    const name = `audio.${audioExt(payload.audio.mimeType)}`
    pkg.audioFile = join(dir, name)
    files.push(name)
    writes.push(writeFile(pkg.audioFile, Buffer.from(payload.audio.bytes)))
  }
  if (payload.transcript) {
    pkg.transcriptJson = join(dir, 'transcript.json')
    files.push('transcript.json')
    const alignment = alignSegments(payload.annotations, payload.transcript.segments, { manual: manualLinks(payload) })
    writes.push(
      writeFile(
        pkg.transcriptJson,
        JSON.stringify({ ...payload.transcript, alignment, manualLinks: payload.links ?? [] }, null, 2),
        'utf8'
      )
    )
  }
  writes.push(
    writeFile(
      pkg.metaJson,
      JSON.stringify(
        { id, memo: payload.memo, requestId: payload.meta.request?.requestId, meta: payload.meta, target, files },
        null,
        2
      ),
      'utf8'
    )
  )
  await Promise.all(writes)
  // Pointer for tools (and the future MCP server) that just want "the latest".
  await writeFile(join(root, 'latest.txt'), dir, 'utf8')
  return pkg
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
