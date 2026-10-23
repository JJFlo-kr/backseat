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

export type CaptureMode = 'rect' | 'window' | 'full' | 'scroll'

/** A top-level window as seen at capture time. */
export interface WindowInfo {
  hwnd: number
  pid: number
  title: string
  /** Executable base name, e.g. "WindowsTerminal.exe". */
  process: string
  /** DIP bounds. In SelectorInit they are relative to that display's window; elsewhere virtual-desktop. */
  bounds: Rect
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
  /** Initial mode; the user can switch with keys/buttons inside the selector. */
  mode: CaptureMode
  /** Top-level windows overlapping this display, front-most first, bounds clipped to the display. */
  windows: WindowInfo[]
}

/** selector renderer -> main when the user confirms a region. */
export interface SelectionResult {
  displayId: number
  /** Region in DIP relative to that display's window (for 'full' the whole display). */
  rect: Rect
  mode: CaptureMode
  /** The chosen window when mode === 'window'. */
  window?: WindowInfo
}

export type AgentKind =
  | 'claude-code'
  | 'claude-desktop'
  | 'cursor'
  | 'vscode'
  | 'codex'
  | 'orca'
  | 'terminal'
  | 'chat'
  | 'unknown'

/** Where "전송" delivers the package: the agent the user was working with before capturing. */
export interface AgentTarget {
  kind: AgentKind
  /** Human label shown in the editor, e.g. "Claude Code · Windows Terminal". */
  label: string
  hwnd: number
  title: string
  process: string
  /**
   * paste-path: focus the window and paste a one-line instruction with the brief path (terminals).
   * paste-image: focus the window and paste the image + memo (chat UIs).
   * clipboard: only put image + text on the clipboard.
   */
  method: 'paste-path' | 'paste-image' | 'clipboard'
  confidence: number
  /** Set when the agent registered through backseat-mcp; it can fetch packages itself. */
  mcp?: { id: string; name: string; cwd: string }
}

/** A question an agent posted through backseat_ask; answered by the next capture. */
export interface AskRequest {
  requestId: string
  question: string
  agent: string
  cwd: string
  createdAt: string
}

export interface CaptureMeta {
  capturedAt: string
  displayId: number
  scaleFactor: number
  /** Selected region in DIP within the display. */
  rectDip: Rect
  /** Same region in device pixels (the cropped image size). */
  rectPx: Rect
  mode: CaptureMode
  /** Captured window (mode === 'window'). */
  window?: { title: string; process: string }
  /** Foreground window right before the capture started. */
  activeWindow?: { title: string; process: string }
  /** When this capture answers a backseat_ask question. */
  request?: { requestId: string; question: string; agent: string }
  /** Scroll capture (mode === 'scroll'): how many frames were stitched into the tall image. */
  scroll?: { frames: number; viewportPx: number }
  /** Set by the editor when the user cropped: the kept region in px of the original capture. */
  crop?: Rect
}

/** A previous capture of the same region, for the editor's before/after comparison. */
export interface CompareSource {
  /** PNG data URL of the previous annotated.png. */
  imageDataUrl: string
  /** Session package directory the image came from. */
  sessionDir: string
  capturedAt?: string
}

export type CompareMode = 'overlay' | 'wipe' | 'diff'

/** What the editor records about a comparison the user looked at. */
export interface CompareInfo {
  sessionDir: string
  mode: CompareMode
  /** 0..100 share of sampled pixels that differ noticeably from the previous capture. */
  diffPercent: number
}

/** main -> editor renderer, once. */
export interface EditorInit {
  /** PNG data URL of the cropped capture (device pixels). */
  imageDataUrl: string
  width: number
  height: number
  meta: CaptureMeta
  /** Detected delivery target, or null when nothing plausible was in front. */
  target: AgentTarget | null
  /** Start recording as soon as the editor opens (user setting). */
  autoRecord?: boolean
  /** The agent's question this capture is answering, if any. */
  request?: AskRequest
  /** Previous capture of the same region (tray "마지막 영역 다시 캡처"): enables the compare view (O). */
  compare?: CompareSource
  /** Self-test only: lets the harness inject a transcript via a DOM event. */
  debug?: boolean
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
  | {
      kind: 'arrow'
      x1: number
      y1: number
      x2: number
      y2: number
      color: string
      width: number
      tStart: number
      tEnd: number
    }
  | {
      kind: 'rect'
      x: number
      y: number
      w: number
      h: number
      color: string
      width: number
      tStart: number
      tEnd: number
    }
  | {
      /** Numbered circle; n is assigned in creation order and renumbered on undo. */
      kind: 'badge'
      x: number
      y: number
      n: number
      color: string
      size: number
      tStart: number
      tEnd: number
    }
  | {
      /** Pixelates the base image inside the box (privacy). strength = block size in image px. */
      kind: 'blur'
      x: number
      y: number
      w: number
      h: number
      strength: number
      tStart: number
      tEnd: number
    }

// ---------- speech ----------

/** One recognised word. Times are ms on the editor clock (same as Annotation.tStart). */
export interface Word {
  start: number
  end: number
  text: string
}

/** One transcribed utterance (sentence-ish), editor-clock ms. */
export interface Segment {
  start: number
  end: number
  text: string
  words?: Word[]
}

export interface Transcript {
  text: string
  segments: Segment[]
  /** Editor-clock time when the recording started; segment times already include it. */
  audioStartMs: number
  durationMs: number
  model: string
  language: string
}

/** editor renderer -> main: run speech recognition on decoded audio. */
export interface TranscribeRequest {
  /** Mono PCM at 16 kHz, -1..1. */
  pcm16k: Float32Array
  audioStartMs: number
  /** Optional language hint ('korean', 'english', ...). */
  language?: string
}

export interface TranscribeResult {
  ok: boolean
  transcript?: Transcript
  error?: string
  elapsedMs?: number
}

/** main -> editor renderer while a transcription runs. */
export interface SttProgress {
  stage: 'loading' | 'downloading' | 'transcribing' | 'done' | 'error'
  file?: string
  /** 0..100 for downloads. */
  progress?: number
  message?: string
}

/** A manual speech-to-annotation link made by dragging in the timeline. */
export interface ManualLink {
  segmentIndex: number
  /** null = forced global (not tied to any annotation). */
  annotationIndex: number | null
}

/** editor renderer -> main for Save / Copy / Send. */
export interface ExportPayload {
  /** Flattened image (base + annotations) as PNG data URL, device pixels. */
  pngDataUrl: string
  /** One-line memo for the whole image, may be empty. */
  memo: string
  annotations: Annotation[]
  meta: CaptureMeta
  transcript?: Transcript
  /** The recording itself, stored in the session package as audio.<ext>. */
  audio?: { bytes: Uint8Array; mimeType: string }
  links?: ManualLink[]
  /** Present when the user compared this capture with the previous one. */
  compare?: CompareInfo
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

export interface SendOptions {
  /** Press Enter after pasting (default false: the user reviews the line first). */
  pressEnter?: boolean
}

export interface SendResult {
  ok: boolean
  /** pasted: delivered into the target window; clipboard: only copied; file-only: package written, nothing else. */
  delivered: 'pasted' | 'clipboard' | 'file-only'
  /** Session package directory. */
  sessionDir?: string
  /** Short human message for the status bar. */
  message: string
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
    /** Write the session package and deliver it to the detected agent (see AgentTarget.method). */
    send(payload: ExportPayload, opts?: SendOptions): Promise<SendResult>
    /** Speech recognition on decoded audio; progress arrives via onSttProgress. */
    transcribe(req: TranscribeRequest): Promise<TranscribeResult>
    onSttProgress(cb: (p: SttProgress) => void): void
    /** Toggle "pinned": a small always-on-top reference window that survives 전송. Resolves the new state. */
    pin(): Promise<boolean>
    close(): void
  }
}

declare global {
  interface Window {
    backseat: BackseatApi
  }
}
