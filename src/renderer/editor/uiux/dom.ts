// DOM helpers shared by the UI/UX panel and its views. Text goes in through textContent only, never as HTML.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** A design value as the user reads it: shadows and type specs in their parts, never "[object Object]". */
export function showValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v !== 'object') return String(v)
  const o = v as Record<string, unknown>
  if ('blur' in o) return `${String(o.x)} ${String(o.y)} ${String(o.blur)} ${String(o.spread)} ${String(o.color)} @${Math.round(Number(o.opacity) * 100)}%`
  if ('family' in o) return `${String(o.family)} ${String(o.size)}px / ${String(o.lineHeight)} · ${String(o.weight)}`
  return JSON.stringify(v)
}

/** name = data-ux attribute: a stable handle for the self-test, independent of the UI language. */
export function button(label: string, onClick: () => void, cls = 'btn small', name?: string): HTMLButtonElement {
  const b = el('button', cls, label)
  b.type = 'button'
  if (name) b.dataset.ux = name
  b.addEventListener('click', onClick)
  return b
}
