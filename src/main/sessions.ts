// Session package: one folder per send with everything an agent (or a later
// backseat-mcp) needs. Layout documented in PLAN.md §5.
import { app } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AgentTarget, ExportPayload } from '../shared/types'
import { buildBrief } from './brief'

export interface SessionPackage {
  id: string
  dir: string
  annotatedPng: string
  briefMd: string
  strokesJson: string
  metaJson: string
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
  await Promise.all([
    writeFile(pkg.annotatedPng, pngBuffer(payload.pngDataUrl)),
    writeFile(pkg.briefMd, buildBrief(payload, 'annotated.png', target), 'utf8'),
    writeFile(pkg.strokesJson, JSON.stringify({ annotations: payload.annotations }, null, 2), 'utf8'),
    writeFile(
      pkg.metaJson,
      JSON.stringify({ id, memo: payload.memo, meta: payload.meta, target, files: ['annotated.png', 'brief.md', 'strokes.json'] }, null, 2),
      'utf8'
    )
  ])
  // Pointer for tools (and the future MCP server) that just want "the latest".
  await writeFile(join(root, 'latest.txt'), dir, 'utf8')
  return pkg
}
