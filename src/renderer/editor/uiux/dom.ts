// DOM helpers shared by the UI/UX panel and its views. Text goes in through textContent only, never as HTML.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** name = data-ux attribute: a stable handle for the self-test, independent of the UI language. */
export function button(label: string, onClick: () => void, cls = 'btn small', name?: string): HTMLButtonElement {
  const b = el('button', cls, label)
  b.type = 'button'
  if (name) b.dataset.ux = name
  b.addEventListener('click', onClick)
  return b
}
