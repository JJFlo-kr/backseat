// One registry for editor commands: bindings, tooltips and dispatch live together.
// Bindings use physical keys (KeyboardEvent.code) so they work on any keyboard layout.

export type CommandContext = 'global' | 'editor'

export interface Command {
  id: string
  label: string
  /** e.g. 'Ctrl+KeyS', 'Ctrl+Shift+KeyZ', 'Space', 'Escape'. First one is shown in tooltips. */
  keys: string[]
  /** 'global' also fires while typing in an input; 'editor' (default) does not. */
  context?: CommandContext
  /** Return false to let the event continue (e.g. command not applicable right now). */
  run: (e: KeyboardEvent) => void | boolean
}

interface Binding {
  code: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

function parse(binding: string): Binding {
  const parts = binding.split('+')
  const code = parts[parts.length - 1]
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()))
  return { code, ctrl: mods.has('ctrl') || mods.has('cmd'), shift: mods.has('shift'), alt: mods.has('alt') }
}

function matches(b: Binding, e: KeyboardEvent): boolean {
  return (
    e.code === b.code &&
    (e.ctrlKey || e.metaKey) === b.ctrl &&
    e.shiftKey === b.shift &&
    e.altKey === b.alt
  )
}

const CODE_LABELS: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Home: 'Home',
  End: 'End',
  ArrowLeft: '←',
  ArrowRight: '→',
  Delete: 'Del',
  Backspace: 'Backspace'
}

/** 'Ctrl+Shift+KeyZ' -> 'Ctrl+Shift+Z' */
export function bindingLabel(binding: string): string {
  const parts = binding.split('+')
  const code = parts[parts.length - 1]
  let key = CODE_LABELS[code]
  if (!key) {
    if (code.startsWith('Key')) key = code.slice(3)
    else if (code.startsWith('Digit')) key = code.slice(5)
    else key = code
  }
  return [...parts.slice(0, -1), key].join('+')
}

export function isTyping(e: KeyboardEvent): boolean {
  if (e.isComposing) return true
  const t = e.target
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  )
}

export class Hotkeys {
  private readonly commands: Command[]
  private readonly byId = new Map<string, Command>()

  constructor(commands: Command[]) {
    this.commands = commands
    for (const c of commands) this.byId.set(c.id, c)
  }

  install(target: Window = window): void {
    target.addEventListener('keydown', (e) => this.dispatch(e))
    // Dropping focus mid-chord must not leave a modifier "stuck" in any held-key logic later.
    target.addEventListener('blur', () => undefined)
  }

  dispatch(e: KeyboardEvent): void {
    const typing = isTyping(e)
    for (const cmd of this.commands) {
      if ((cmd.context ?? 'editor') === 'editor' && typing) continue
      if (!cmd.keys.some((k) => matches(parse(k), e))) continue
      const handled = cmd.run(e)
      if (handled !== false) {
        e.preventDefault()
        return
      }
    }
  }

  /** Sets `title` on every element carrying data-command="<id>". */
  applyTooltips(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>('[data-command]').forEach((el) => {
      const cmd = this.byId.get(el.dataset.command ?? '')
      if (!cmd) return
      el.title = cmd.keys.length ? `${cmd.label} (${bindingLabel(cmd.keys[0])})` : cmd.label
      el.addEventListener('click', (ev) => {
        ev.preventDefault()
        cmd.run(new KeyboardEvent('keydown'))
      })
    })
  }

  label(id: string): string {
    const cmd = this.byId.get(id)
    if (!cmd) return id
    return cmd.keys.length ? `${cmd.label} (${bindingLabel(cmd.keys[0])})` : cmd.label
  }
}
