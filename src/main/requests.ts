// Watches <sessionsRoot>/requests for questions posted by agents through backseat_ask,
// shows a desktop notification, and hands the request to the capture flow on click.
import { Notification } from 'electron'
import { existsSync, watch, type FSWatcher } from 'fs'
import { mkdir, readdir, readFile, rename } from 'fs/promises'
import { join } from 'path'
import type { AskRequest } from '../shared/types'
import { t } from '../shared/i18n'

let watcher: FSWatcher | null = null
const seen = new Set<string>()
let pendingRequest: AskRequest | null = null

export function requestsDir(root: string): string {
  return join(root, 'requests')
}

/** The most recent unanswered request, consumed by the next capture. */
export function takePendingRequest(): AskRequest | null {
  const r = pendingRequest
  pendingRequest = null
  return r
}

/**
 * The request a new capture answers: the one it was started for (notification click), else the pending one.
 * Either way it is consumed by id, so the next ordinary capture does not carry it again (Codex review F07).
 * Policy: a capture that is then cancelled has used the request up; the agent's backseat_ask times out and
 * the agent can ask again.
 */
export function requestForCapture(explicit?: AskRequest): AskRequest | undefined {
  const r = explicit ?? pendingRequest ?? undefined
  if (r && pendingRequest?.requestId === r.requestId) pendingRequest = null
  return r
}

export function peekPendingRequest(): AskRequest | null {
  return pendingRequest
}

/** Mark a request answered (rename so it is not re-read after a restart). */
export async function markAnswered(root: string, requestId: string): Promise<void> {
  const file = join(requestsDir(root), `${requestId}.json`)
  if (existsSync(file)) {
    try {
      await rename(file, `${file}.answered`)
    } catch {
      /* ignore */
    }
  }
}

async function scan(root: string, onRequest: (r: AskRequest) => void): Promise<void> {
  const dir = requestsDir(root)
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const n of names.sort()) {
    if (!n.endsWith('.json') || seen.has(n)) continue
    seen.add(n)
    try {
      const r = JSON.parse(await readFile(join(dir, n), 'utf8')) as AskRequest
      if (!r.requestId || !r.question) continue
      // Ignore stale requests from before this app started (older than 1 hour).
      if (Date.now() - Date.parse(r.createdAt) > 60 * 60 * 1000) continue
      onRequest(r)
    } catch {
      /* partial write; the next event re-reads it */
      seen.delete(n)
    }
  }
}

export async function startRequestWatcher(root: string, onCapture: (r: AskRequest) => void): Promise<void> {
  const dir = requestsDir(root)
  await mkdir(dir, { recursive: true })
  // Everything already there is old news.
  for (const n of await readdir(dir)) seen.add(n)

  const handle = (r: AskRequest): void => {
    pendingRequest = r
    if (Notification.isSupported()) {
      const n = new Notification({
        title: t('requests.title', { agent: r.agent || t('requests.agentFallback') }),
        body: t('requests.body', { question: r.question }),
        silent: false
      })
      n.on('click', () => onCapture(r))
      n.show()
    } else {
      onCapture(r)
    }
  }

  let debounce: NodeJS.Timeout | null = null
  try {
    watcher = watch(dir, () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => void scan(root, handle), 150)
    })
  } catch (err) {
    console.error('[backseat] request watcher failed:', err)
  }
}

export function stopRequestWatcher(): void {
  watcher?.close()
  watcher = null
}
