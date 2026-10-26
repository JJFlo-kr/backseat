// Stable annotation ids. Pure (no Electron, no DOM): tests/annotation-ids.test.ts.
// The on-screen number of a badge and an annotation's index both change on erase / crop / undo; references that
// must survive those (UI/UX design conditions tied to a marked area) use Annotation.id instead.
import type { Annotation } from './types'

export type IdGen = () => string

let counter = 0

/** A new id: unique within a session for practical purposes (time, a counter and a little randomness). */
export function newAnnotationId(): string {
  counter += 1
  return `a${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * The same list when every annotation already has a unique id; otherwise a copy in which a missing or repeated
 * id (an older package, a copied annotation) is replaced by a new one. Existing unique ids never change, so
 * calling this again on its own result is a no-op.
 */
export function withAnnotationIds(list: readonly Annotation[], gen: IdGen = newAnnotationId): readonly Annotation[] {
  const seen = new Set<string>()
  let changed = false
  const out = list.map((a) => {
    if (a.id && !seen.has(a.id)) {
      seen.add(a.id)
      return a
    }
    changed = true
    let id = gen()
    while (seen.has(id)) id = gen()
    seen.add(id)
    return { ...a, id }
  })
  return changed ? out : list
}
