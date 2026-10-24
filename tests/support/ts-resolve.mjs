// Resolve hook for tests: the app is bundled by electron-vite, so its sources import relative modules
// without an extension ('./config', './stt'). Under plain Node, map those to the .ts file / index.ts.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../')
  if (relative && context.parentURL?.startsWith('file:') && !/\.[cm]?[jt]s$|\.json$/.test(specifier)) {
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      const url = new URL(candidate, context.parentURL)
      if (existsSync(fileURLToPath(url))) return next(url.href, context)
    }
  }
  return next(specifier, context)
}
