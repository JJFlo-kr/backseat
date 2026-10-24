// Small file helpers shared by the app and backseat-mcp (plain Node: no Electron imports).
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { rename, rm, writeFile } from 'fs/promises'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * rename() with a few retries: on Windows a reader, virus scanner or indexer briefly holding the file
 * makes it fail with EPERM / EACCES / EBUSY. A directory target that already exists is never retried
 * (directories are not replaced; the caller picks another name).
 */
export async function renameRetry(from: string, to: string, isDir = false): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      const transient = ['EPERM', 'EACCES', 'EBUSY'].includes(code) && !(isDir && existsSync(to))
      if (i >= 9 || !transient) throw err
      await sleep(20 * (i + 1))
    }
  }
}

/** Replace `file` in one step: readers see the old content or the new one, never a partial write. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, data, 'utf8')
    await renameRetry(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}
