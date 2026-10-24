// backseat-mcp: stdio MCP server that lets a coding agent (Claude Code, Cursor, …)
// read Backseat session packages, wait for the next one, and ask the user to draw.
// Runs under plain Node — it must never import 'electron'.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { existsSync, watch, type FSWatcher } from 'fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { basename, join } from 'path'
import {
  readRegistry,
  registerAgent,
  unregisterAgent,
  type RegistryEntry
} from './registry'
import { BUNDLES } from '../../shared/bundles'
import { createTranslator, mergeBundles, resolveLocale, type Locale, type Messages, type Translate } from '../../shared/i18n'

const SERVER_NAME = 'backseat'
const SERVER_VERSION = '0.1.0'

// ---------- locations ----------

function configFile(): string {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  return join(appData, 'backseat', 'config.json')
}

export async function sessionsRoot(): Promise<string> {
  if (process.env.BACKSEAT_SESSIONS) return process.env.BACKSEAT_SESSIONS
  try {
    const cfg = JSON.parse(await readFile(configFile(), 'utf8')) as { sessionsRoot?: string }
    if (cfg.sessionsRoot) return cfg.sessionsRoot
  } catch {
    /* no config yet */
  }
  return join(homedir(), 'Pictures', 'Backseat', 'sessions')
}

// ---------- language of the text returned to the agent ----------

const mergedByLocale = new Map<Locale, Messages>()

/**
 * Translator for what the agent reads: English when config.briefLocale is 'en', else the UI language
 * (config.locale, 'auto' = the system language). Plain Node: no Electron, so read config.json ourselves
 * (on every call, so a language change in the tray applies without restarting the agent).
 */
async function agentTranslator(): Promise<Translate> {
  let cfg: { locale?: string; briefLocale?: string } = {}
  try {
    cfg = JSON.parse(await readFile(configFile(), 'utf8')) as typeof cfg
  } catch {
    /* no config yet */
  }
  const lang: Locale = cfg.briefLocale === 'en' ? 'en' : resolveLocale(cfg.locale, Intl.DateTimeFormat().resolvedOptions().locale)
  let messages = mergedByLocale.get(lang)
  if (!messages) {
    messages = mergeBundles(lang, BUNDLES)
    mergedByLocale.set(lang, messages)
  }
  return createTranslator(lang, messages)
}

// ---------- packages ----------

interface PackageMeta {
  id: string
  memo?: string
  meta?: { capturedAt?: string; mode?: string; window?: { title?: string }; activeWindow?: { title?: string } }
  target?: { label?: string } | null
  files?: string[]
  requestId?: string
}

interface Loaded {
  id: string
  dir: string
  meta: PackageMeta
  brief: string
  png: Buffer | null
  /** screenshot.png (capture without annotations), when the package has one. */
  screenshot: Buffer | null
  transcript: unknown | null
}

async function listSessionDirs(root: string): Promise<string[]> {
  if (!existsSync(root)) return []
  const names = await readdir(root)
  const dirs: string[] = []
  for (const n of names) {
    if (!/^\d{8}-\d{6}/.test(n)) continue
    try {
      const s = await stat(join(root, n))
      if (s.isDirectory() && existsSync(join(root, n, 'meta.json'))) dirs.push(n)
    } catch {
      /* skip */
    }
  }
  return dirs.sort()
}

async function loadPackage(root: string, id: string): Promise<Loaded | null> {
  const dir = join(root, id)
  if (!existsSync(join(dir, 'meta.json'))) return null
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as PackageMeta
  const brief = existsSync(join(dir, 'brief.md')) ? await readFile(join(dir, 'brief.md'), 'utf8') : ''
  const png = existsSync(join(dir, 'annotated.png')) ? await readFile(join(dir, 'annotated.png')) : null
  const screenshot = existsSync(join(dir, 'screenshot.png')) ? await readFile(join(dir, 'screenshot.png')) : null
  const transcript = existsSync(join(dir, 'transcript.json'))
    ? (JSON.parse(await readFile(join(dir, 'transcript.json'), 'utf8')) as unknown)
    : null
  return { id, dir, meta, brief, png, screenshot, transcript }
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

function packageContent(p: Loaded, tr: Translate, includeImage = true, includeOriginal = false): Content[] {
  const out: Content[] = []
  const header = [
    `# Backseat session ${p.id}`,
    tr('mcp.folder', { dir: p.dir }),
    tr('mcp.files', { files: (p.meta.files ?? []).join(', ') }),
    ''
  ].join('\n')
  out.push({ type: 'text', text: header + p.brief })
  if (includeImage && p.png) {
    out.push({ type: 'text', text: tr('mcp.annotationNotice') })
    out.push({ type: 'image', data: p.png.toString('base64'), mimeType: 'image/png' })
  }
  if (includeOriginal && p.screenshot) {
    out.push({ type: 'text', text: tr('mcp.originalScreen') })
    out.push({ type: 'image', data: p.screenshot.toString('base64'), mimeType: 'image/png' })
  }
  return out
}

/** Resolve when a new session dir (optionally matching requestId) appears, or null on timeout. */
async function waitForPackage(root: string, timeoutMs: number, requestId?: string): Promise<Loaded | null> {
  await mkdir(root, { recursive: true })
  const seen = new Set(await listSessionDirs(root))
  const deadline = Date.now() + timeoutMs
  const h: { watcher: FSWatcher | null; timer: NodeJS.Timeout | null } = { watcher: null, timer: null }
  try {
    return await new Promise<Loaded | null>((resolve) => {
      let done = false
      const finish = (v: Loaded | null): void => {
        if (done) return
        done = true
        if (h.timer) clearInterval(h.timer)
        resolve(v)
      }
      const check = async (): Promise<void> => {
        if (done) return
        const now = await listSessionDirs(root)
        for (const id of now) {
          if (seen.has(id)) continue
          // The package is written file by file; meta.json is written last, brief.md before it.
          if (!existsSync(join(root, id, 'brief.md'))) continue
          const p = await loadPackage(root, id)
          if (!p) continue
          if (requestId && p.meta.requestId !== requestId) {
            seen.add(id)
            continue
          }
          finish(p)
          return
        }
        if (Date.now() > deadline) finish(null)
      }
      try {
        h.watcher = watch(root, { recursive: true }, () => void check())
      } catch {
        h.watcher = null
      }
      h.timer = setInterval(() => void check(), 1000)
      void check()
    })
  } finally {
    h.watcher?.close()
    if (h.timer) clearInterval(h.timer)
  }
}

// ---------- server ----------

export async function createServer(): Promise<McpServer> {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  const root = await sessionsRoot()
  let me: RegistryEntry | null = null

  server.registerTool(
    'backseat_register',
    {
      title: 'Register this agent with Backseat',
      description:
        'Tell Backseat which agent is listening so the user can send captures here. Call once at session start with the project folder.',
      inputSchema: {
        name: z.string().describe('Agent name shown to the user, e.g. "Claude Code"'),
        cwd: z.string().describe('Project folder the agent works in'),
        kind: z.string().optional().describe('claude-code | cursor | codex | orca | other')
      }
    },
    async ({ name, cwd, kind }) => {
      me = await registerAgent(root, { name, cwd, kind: kind ?? 'other', pid: process.pid })
      return { content: [{ type: 'text', text: `registered ${name} (${me.id}) for ${cwd}; sessions root: ${root}` }] }
    }
  )

  server.registerTool(
    'backseat_latest',
    {
      title: 'Latest Backseat capture',
      description:
        'Return the most recent session package: the brief (markdown) and annotated.png (original screen + the user-drawn Backseat annotations). screenshot.png, the capture without annotations, is attached only with includeOriginal.',
      inputSchema: {
        includeImage: z.boolean().optional().describe('Attach annotated.png (default true)'),
        includeOriginal: z.boolean().optional().describe('Also attach screenshot.png, the capture without annotations (default false)')
      }
    },
    async ({ includeImage, includeOriginal }) => {
      const tr = await agentTranslator()
      const ids = await listSessionDirs(root)
      const id = ids[ids.length - 1]
      const p = id ? await loadPackage(root, id) : null
      if (!p) return { content: [{ type: 'text', text: tr('mcp.noSession', { root }) }] }
      return { content: packageContent(p, tr, includeImage ?? true, includeOriginal ?? false) }
    }
  )

  server.registerTool(
    'backseat_list',
    {
      title: 'List Backseat captures',
      description: 'List recent session packages (newest last) with id, time, memo and target.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() }
    },
    async ({ limit }) => {
      const tr = await agentTranslator()
      const ids = (await listSessionDirs(root)).slice(-(limit ?? 10))
      const lines: string[] = []
      for (const id of ids) {
        const p = await loadPackage(root, id)
        if (!p) continue
        const memo = p.meta.memo ? ` · ${p.meta.memo}` : ''
        lines.push(`${id} · ${p.meta.meta?.mode ?? ''} ${p.meta.meta?.window?.title ?? ''}${memo} · → ${p.meta.target?.label ?? '-'}`)
      }
      return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : tr('mcp.listEmpty') }] }
    }
  )

  server.registerTool(
    'backseat_get',
    {
      title: 'Get a Backseat capture by id',
      description: 'Return one session package by id (from backseat_list): brief + annotated.png; screenshot.png (no annotations) with includeOriginal.',
      inputSchema: {
        id: z.string(),
        includeImage: z.boolean().optional().describe('Attach annotated.png (default true)'),
        includeOriginal: z.boolean().optional().describe('Also attach screenshot.png, the capture without annotations (default false)')
      }
    },
    async ({ id, includeImage, includeOriginal }) => {
      const tr = await agentTranslator()
      const p = await loadPackage(root, basename(id))
      if (!p) return { content: [{ type: 'text', text: tr('mcp.notFound', { id }) }], isError: true }
      return { content: packageContent(p, tr, includeImage ?? true, includeOriginal ?? false) }
    }
  )

  server.registerTool(
    'backseat_wait',
    {
      title: 'Wait for the next Backseat capture',
      description:
        'Block until the user sends a new capture from Backseat (or the timeout passes), then return it (brief + annotated.png; screenshot.png with includeOriginal). Use when you asked the user to show or draw something.',
      inputSchema: {
        timeoutSec: z.number().min(1).max(1800).optional().describe('Default 300'),
        includeOriginal: z.boolean().optional().describe('Also attach screenshot.png, the capture without annotations (default false)')
      }
    },
    async ({ timeoutSec, includeOriginal }) => {
      const p = await waitForPackage(root, (timeoutSec ?? 300) * 1000)
      const tr = await agentTranslator()
      if (!p) return { content: [{ type: 'text', text: tr('mcp.waitTimeout') }] }
      return { content: packageContent(p, tr, true, includeOriginal ?? false) }
    }
  )

  server.registerTool(
    'backseat_ask',
    {
      title: 'Ask the user to show something in Backseat',
      description:
        'Post a question to the Backseat tray app; the user answers by capturing, drawing and speaking. Blocks until that package arrives or the timeout passes. Returns brief + annotated.png (screenshot.png with includeOriginal).',
      inputSchema: {
        question: z.string().describe('What you want the user to show or mark, in their language'),
        timeoutSec: z.number().min(5).max(1800).optional().describe('Default 600'),
        includeOriginal: z.boolean().optional().describe('Also attach screenshot.png, the capture without annotations (default false)')
      }
    },
    async ({ question, timeoutSec, includeOriginal }) => {
      const requestsDir = join(root, 'requests')
      await mkdir(requestsDir, { recursive: true })
      const requestId = `${Date.now()}-${process.pid}`
      await writeFile(
        join(requestsDir, `${requestId}.json`),
        JSON.stringify({ requestId, question, agent: me?.name ?? 'agent', cwd: me?.cwd ?? '', createdAt: new Date().toISOString() }, null, 2),
        'utf8'
      )
      const p = await waitForPackage(root, (timeoutSec ?? 600) * 1000, requestId)
      const tr = await agentTranslator()
      if (!p) return { content: [{ type: 'text', text: tr('mcp.askTimeout', { seconds: timeoutSec ?? 600, requestId }) }] }
      return { content: packageContent(p, tr, true, includeOriginal ?? false) }
    }
  )

  server.registerTool(
    'backseat_agents',
    {
      title: 'Registered agents',
      description: 'List agents currently registered with Backseat (for debugging).',
      inputSchema: {}
    },
    async () => {
      const reg = await readRegistry(root)
      return { content: [{ type: 'text', text: JSON.stringify(reg, null, 2) }] }
    }
  )

  const cleanup = (): void => {
    if (me) void unregisterAgent(root, me.id)
  }
  process.on('exit', cleanup)
  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })
  return server
}

async function main(): Promise<void> {
  const server = await createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`backseat-mcp failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    process.exit(1)
  })
}
