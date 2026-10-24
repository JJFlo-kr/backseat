// Delivery diagnostics: one JSON line per step decision in <userData>/logs/delivery.log (rotated at 512 KB).
// Only steps, verdicts and reason codes (src/main/delivery.ts DeliveryLogEntry): never titles, clipboard
// text, memos, element names or values.
import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'fs/promises'
import { join } from 'path'
import type { DeliveryLogEntry } from './delivery'

const MAX_BYTES = 512 * 1024

export function deliveryLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'delivery.log')
}

let chain: Promise<void> = Promise.resolve()

/** Append one entry; never throws (a log problem must not break a send). */
export function logDelivery(entry: Omit<DeliveryLogEntry, 'at'>): Promise<void> {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'
  const file = deliveryLogPath()
  const run = async (): Promise<void> => {
    try {
      await mkdir(join(file, '..'), { recursive: true })
      const size = await stat(file).then((s) => s.size, () => 0)
      if (size > MAX_BYTES) await rename(file, file.replace(/\.log$/, '.1.log')).catch(() => undefined)
      await appendFile(file, line, 'utf8')
    } catch (err) {
      console.error('[backseat] delivery log:', err)
    }
  }
  chain = chain.then(run, run)
  return chain
}
