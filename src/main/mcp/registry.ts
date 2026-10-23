// Agent registry shared between the Electron app and backseat-mcp processes:
// <sessionsRoot>/registry.json. Plain Node, no Electron imports.
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

export interface RegistryEntry {
  id: string
  name: string
  kind: string
  cwd: string
  pid: number
  registeredAt: string
  lastSeen: string
}

interface RegistryFile {
  agents: RegistryEntry[]
}

function registryPath(root: string): string {
  return join(root, 'registry.json')
}

export async function readRegistry(root: string): Promise<RegistryEntry[]> {
  try {
    const raw = JSON.parse(await readFile(registryPath(root), 'utf8')) as RegistryFile
    return Array.isArray(raw.agents) ? raw.agents : []
  } catch {
    return []
  }
}

async function writeRegistry(root: string, agents: RegistryEntry[]): Promise<void> {
  await mkdir(root, { recursive: true })
  const tmp = registryPath(root) + '.tmp'
  await writeFile(tmp, JSON.stringify({ agents }, null, 2), 'utf8')
  const { rename } = await import('fs/promises')
  await rename(tmp, registryPath(root))
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Drop entries whose process is gone (stale after a crash). */
export async function pruneRegistry(root: string): Promise<RegistryEntry[]> {
  const agents = (await readRegistry(root)).filter((a) => isAlive(a.pid))
  await writeRegistry(root, agents)
  return agents
}

export async function registerAgent(
  root: string,
  entry: { name: string; kind: string; cwd: string; pid: number }
): Promise<RegistryEntry> {
  const agents = (await readRegistry(root)).filter((a) => a.pid !== entry.pid && isAlive(a.pid))
  const now = new Date().toISOString()
  const me: RegistryEntry = { id: `${entry.pid}`, ...entry, registeredAt: now, lastSeen: now }
  agents.push(me)
  await writeRegistry(root, agents)
  return me
}

export async function unregisterAgent(root: string, id: string): Promise<void> {
  const agents = (await readRegistry(root)).filter((a) => a.id !== id)
  await writeRegistry(root, agents)
}
