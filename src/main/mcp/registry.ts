// Agent registry shared between the Electron app and backseat-mcp processes.
// Each MCP process owns one file, <sessionsRoot>/agents/<pid>.json, so concurrent
// registrations never read-modify-write a shared file. The older single
// <sessionsRoot>/registry.json (written by backseat-mcp before 0.4) is still read.
// Plain Node, no Electron imports.
import { rmSync } from 'fs'
import { mkdir, readdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { writeFileAtomic } from '../fsutil'

export interface RegistryEntry {
  id: string
  name: string
  kind: string
  cwd: string
  pid: number
  registeredAt: string
  lastSeen: string
}

function agentsDir(root: string): string {
  return join(root, 'agents')
}

function agentFile(root: string, pid: number): string {
  return join(agentsDir(root), `${pid}.json`)
}

function legacyPath(root: string): string {
  return join(root, 'registry.json')
}

function isEntry(v: unknown): v is RegistryEntry {
  const e = v as Partial<RegistryEntry> | null
  return Boolean(e) && typeof e?.id === 'string' && typeof e.pid === 'number' && typeof e.name === 'string'
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readLegacy(root: string): Promise<RegistryEntry[]> {
  try {
    const raw = JSON.parse(await readFile(legacyPath(root), 'utf8')) as { agents?: unknown }
    return Array.isArray(raw.agents) ? raw.agents.filter(isEntry) : []
  } catch {
    return []
  }
}

async function readOwnFiles(root: string): Promise<RegistryEntry[]> {
  let names: string[]
  try {
    names = await readdir(agentsDir(root))
  } catch {
    return []
  }
  const out: RegistryEntry[] = []
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue
    try {
      const e = JSON.parse(await readFile(join(agentsDir(root), n), 'utf8')) as unknown
      if (isEntry(e)) out.push(e)
    } catch {
      /* being replaced right now; the next read sees it */
    }
  }
  return out
}

/** Every registered agent (alive or not), oldest registration first; one entry per pid. */
export async function readRegistry(root: string): Promise<RegistryEntry[]> {
  const byPid = new Map<number, RegistryEntry>()
  for (const e of await readLegacy(root)) byPid.set(e.pid, e)
  for (const e of await readOwnFiles(root)) byPid.set(e.pid, e) // per-process files win over the legacy list
  return [...byPid.values()].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt))
}

/** Live agents only; files of processes that are gone (crash, kill) are removed. */
export async function pruneRegistry(root: string): Promise<RegistryEntry[]> {
  const all = await readRegistry(root)
  const alive: RegistryEntry[] = []
  for (const e of all) {
    if (isAlive(e.pid)) alive.push(e)
    else await rm(agentFile(root, e.pid), { force: true }).catch(() => undefined)
  }
  return alive
}

export async function registerAgent(
  root: string,
  entry: { name: string; kind: string; cwd: string; pid: number }
): Promise<RegistryEntry> {
  await mkdir(agentsDir(root), { recursive: true })
  const now = new Date().toISOString()
  const me: RegistryEntry = { id: `${entry.pid}`, ...entry, registeredAt: now, lastSeen: now }
  await writeFileAtomic(agentFile(root, entry.pid), JSON.stringify(me, null, 2))
  return me
}

export async function unregisterAgent(root: string, id: string): Promise<void> {
  if (!/^\d+$/.test(id)) return
  await rm(agentFile(root, Number(id)), { force: true })
}

/** For process 'exit' handlers, where asynchronous work never completes. */
export function unregisterAgentSync(root: string, id: string): void {
  if (!/^\d+$/.test(id)) return
  try {
    rmSync(agentFile(root, Number(id)), { force: true })
  } catch {
    /* best effort; pruneRegistry drops it once the pid is gone */
  }
}
