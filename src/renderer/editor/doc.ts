// The editor's undoable document. Pure (no DOM): tests/doc-links.test.ts.
import type { Annotation, Rect } from '../../shared/types'

/** The whole undoable document: drawings, manual speech-to-annotation links and the crop. */
export interface Doc {
  annotations: readonly Annotation[]
  /** segmentIndex -> annotationIndex (null = forced global). Absent = automatic alignment. */
  links: ReadonlyMap<number, number | null>
  /** Visible region in px of the ORIGINAL capture. Annotation coordinates are relative to it. */
  crop: Rect
  /** The recording (transcript revision) `links` point into; a new recording bumps the editor's revision. */
  linksRev: number
}

const NO_LINKS: ReadonlyMap<number, number | null> = new Map()

/**
 * The manual links that apply to the current recording. A document state saved in the undo history before
 * a new recording replaced the transcript keeps links into the OLD transcript; restoring that state must not
 * attach them to the new one's segments (Codex review F10).
 */
export function linksAt(doc: Doc, transcriptRev: number): ReadonlyMap<number, number | null> {
  return doc.linksRev === transcriptRev ? doc.links : NO_LINKS
}
