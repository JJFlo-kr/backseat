// Shared contract between main, preload and renderer. Keep this file dependency-free.

/** Rectangle in CSS pixels (DIP) relative to the window that produced it. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: number
  /** DIP bounds in the virtual desktop. */
  bounds: Rect
  scaleFactor: number
  isPrimary: boolean
}

/** main -> selector renderer, once per selector window. */
export interface SelectorInit {
  displayId: number
  /** PNG data URL of the frozen screenshot of this display (device pixels). */
  imageDataUrl: string
  /** Window (DIP) size, equals display bounds size. */
  width: number
  height: number
  scaleFactor: number
}

/** selector renderer -> main when the user confirms a region. */
export interface SelectionResult {
  displayId: number
  /** Region in DIP relative to that display's window. */
  rect: Rect
}

export interface CaptureMeta {
  capturedAt: string
  displayId: number
  scaleFactor: number
  /** Selected region in DIP within the display. */
  rectDip: Rect
  /** Same region in device pixels (the cropped image size). */
  rectPx: Rect
}

/** main -> editor renderer, once. */
export interface EditorInit {
  /** PNG data URL of the cropped capture (device pixels). */
  imageDataUrl: string
  width: number
  height: number
  meta: CaptureMeta
}

export interface Point {
  x: number
  y: number
}

/** Every annotation carries timing (ms since the editor opened) so M2 can align speech. */
export type Annotation =
  | {
      kind: 'stroke'
      color: string
      width: number
      points: Point[]
      /** Optional per-point timestamps (ms, same clock as tStart), parallel to points. */
      times?: number[]
      tStart: number
      tEnd: number
    }
  | {
      kind: 'text'
      text: string
      x: number
      y: number
      color: string
      fontSize: number
      tStart: number
      tEnd: number
    }

/** editor renderer -> main for Save / Copy. */
export interface ExportPayload {
  /** Flattened image (base + annotations) as PNG data URL, device pixels. */
  pngDataUrl: string
  /** One-line memo for the whole image, may be empty. */
  memo: string
  annotations: Annotation[]
  meta: CaptureMeta
}

export interface SaveResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

export interface CopyResult {
  ok: boolean
  error?: string
}

/** A recorded replay of the drawing session (WebM from MediaRecorder). */
export interface VideoSave {
  bytes: Uint8Array
  mimeType: string
  durationMs: number
}

/** API exposed on window.backseat by the preload script. */
export interface BackseatApi {
  selector: {
    onInit(cb: (init: SelectorInit) => void): void
    done(result: SelectionResult): void
    cancel(): void
  }
  editor: {
    onInit(cb: (init: EditorInit) => void): void
    save(payload: ExportPayload): Promise<SaveResult>
    copy(payload: ExportPayload): Promise<CopyResult>
    saveVideo(video: VideoSave): Promise<SaveResult>
    close(): void
  }
}

declare global {
  interface Window {
    backseat: BackseatApi
  }
}
