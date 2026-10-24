// Codex review F10: undo / redo must never bring back a manual speech link that belongs to an earlier
// recording. Replays the editor's document transitions with the real History and linksAt().
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { History } from '../src/renderer/editor/history.ts'
import { linksAt, type Doc } from '../src/renderer/editor/doc.ts'
import type { Annotation } from '../src/shared/types.ts'

const badge = (n: number): Annotation => ({ kind: 'badge', x: 10 * n, y: 10, n, color: '#E5484D', size: 22, tStart: n * 1000, tEnd: n * 1000 })
const crop = { x: 0, y: 0, width: 100, height: 100 }

/** The editor's document state machine, reduced to what links depend on (see editor.ts setDoc/commit). */
class EditorModel {
  history = new History<Doc>(100)
  rev = 0
  doc: Doc = { annotations: [], links: new Map(), crop, linksRev: 0 }
  get links(): ReadonlyMap<number, number | null> {
    return linksAt(this.doc, this.rev)
  }
  private apply(next: Doc): void {
    this.doc = next
  }
  commit(annotations: readonly Annotation[]): void {
    const after: Doc = { annotations, links: this.links, crop, linksRev: this.rev }
    this.history.commit('edit', this.doc, after)
    this.apply(after)
  }
  link(seg: number, ann: number): void {
    const next = new Map(this.links)
    next.set(seg, ann)
    const after: Doc = { annotations: this.doc.annotations, links: next, crop, linksRev: this.rev }
    this.history.commit('link', this.doc, after)
    this.apply(after)
  }
  /** finishRecording(): a new recording replaces the transcript and drops the links into the old one. */
  newRecording(): void {
    this.rev++
    this.apply({ annotations: this.doc.annotations, links: new Map(), crop, linksRev: this.rev })
  }
  undo(): void {
    const d = this.history.undo()
    if (d) this.apply(d)
  }
  redo(): void {
    const d = this.history.redo()
    if (d) this.apply(d)
  }
}

test('recording A linked → annotation → recording B → undo: A’s link does not come back', () => {
  const m = new EditorModel()
  m.newRecording() // A
  m.commit([badge(1)])
  m.link(0, 0)
  m.commit([badge(1), badge(2)])
  m.newRecording() // B replaces A
  assert.equal(m.links.size, 0)
  m.undo() // back to "badge 1 + link of A"
  assert.equal(m.doc.annotations.length, 1, 'the annotation undo itself still works')
  assert.equal(m.links.size, 0, 'a link into recording A must not attach to recording B')
  m.undo()
  assert.equal(m.links.size, 0)
  m.redo()
  m.redo()
  assert.equal(m.links.size, 0)
})

test('links of the current recording survive undo / redo', () => {
  const m = new EditorModel()
  m.newRecording()
  m.commit([badge(1)])
  m.link(0, 0)
  m.commit([badge(1), badge(2)])
  m.undo()
  assert.deepEqual([...m.links], [[0, 0]])
  m.undo()
  assert.equal(m.links.size, 0)
  m.redo()
  assert.deepEqual([...m.links], [[0, 0]])
})
