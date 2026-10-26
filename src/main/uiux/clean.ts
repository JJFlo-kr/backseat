// Bounded text from untrusted input (renderer IPC, imported files): non-strings become empty, strings are trimmed
// and cut. Pure.

export const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** The non-empty strings of a list, each bounded, at most `count` of them. */
export const texts = (v: unknown, max: number, count = 12): string[] => (Array.isArray(v) ? v.map((x) => text(x, max)).filter(Boolean).slice(0, count) : [])

/** A copy without the given keys (a profile without this PC's fields, an overview without its job id). */
export function omit<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const out: Partial<T> = { ...o }
  for (const k of keys) delete out[k]
  return out as Omit<T, K>
}
