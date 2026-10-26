// Watches the jobs folder while an editor window is open and reports jobs whose status changed (an agent fetched,
// submitted, failed; a deadline passed). Polling, not fs.watch: the folder is written by another process (the MCP
// server), and a short poll over a handful of small files is the same on every OS. Plain Node (tests/uiux-app-jobs).
import type { UiuxJob } from '../../shared/uiux/types.ts'
import { effectiveJob } from '../mcp/jobs.ts'
import type { UiuxStore } from './store.ts'

export const JOB_POLL_MS = 1500

const keyOf = (j: UiuxJob): string => `${j.status}|${j.updatedAt}|${j.expiresAt}`

export class JobWatcher {
  private seen = new Map<string, string>()
  private primed = false
  private timer: NodeJS.Timeout | null = null
  private running = false

  private readonly store: UiuxStore
  private readonly emit: (job: UiuxJob) => void

  constructor(store: UiuxStore, emit: (job: UiuxJob) => void) {
    this.store = store
    this.emit = emit
  }

  /** One look at the folder: emits jobs that changed since the last look (the first look only remembers). */
  async poll(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const jobs = (await this.store.listJobs()).map((j) => effectiveJob(j))
      const next = new Map<string, string>()
      for (const j of jobs) {
        const k = keyOf(j)
        next.set(j.jobId, k)
        if (this.primed && this.seen.get(j.jobId) !== k) this.emit(j)
      }
      this.seen = next
      this.primed = true
    } catch {
      /* the folder may be mid-write; the next look will see it */
    } finally {
      this.running = false
    }
  }

  start(): void {
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll(), JOB_POLL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.primed = false
    this.seen.clear()
  }

  get active(): boolean {
    return this.timer !== null
  }
}
