// Undo/redo as a bounded stack of labelled before/after snapshots.
// State is treated as immutable: every edit produces a new value, so a
// snapshot is just a reference and commits are cheap.

export interface Command<T> {
  label: string
  before: T
  after: T
}

export class History<T> {
  private undoStack: Command<T>[] = []
  private redoStack: Command<T>[] = []

  constructor(private readonly limit = 100) {}

  commit(label: string, before: T, after: T): void {
    this.undoStack.push({ label, before, after })
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  /** Returns the state to restore, or undefined when nothing to undo. */
  undo(): T | undefined {
    const cmd = this.undoStack.pop()
    if (!cmd) return undefined
    this.redoStack.push(cmd)
    return cmd.before
  }

  redo(): T | undefined {
    const cmd = this.redoStack.pop()
    if (!cmd) return undefined
    this.undoStack.push(cmd)
    return cmd.after
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null
  }
}
