// Shared contract between main, preload and renderer. Keep this file dependency-free (types only; the UI/UX
// contracts live in ./uiux/types, equally pure).
import type { DesignProposal, DesignRequest, DesignRules, DesignTokens, JobOutcome, JobRequest, ProjectOverview, ProjectProfile, ReportConfirmation, SkillContext, SkillRef, UiuxJob } from './uiux/types'

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
  /** Win32 window class (e.g. "Progman", "Shell_TrayWnd"), when known: tells the desktop / taskbar apart from apps. */
  className?: string
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
  /** UI language and its merged message bundle (see EditorInit.locale). */
  locale?: string
  messages?: Record<string, string>
  /** Window and scrolling capture need the Win32 layer (window list, wheel events). Absent = true; false hides both modes. */
  windowModes?: boolean
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
  /**
   * Other open top-level windows the user may pick as this capture's target instead (front-most first,
   * our own windows excluded, at most 12). Each is already classified; unknown apps are kind 'unknown'.
   */
  candidates?: AgentTarget[]
  /** The detected target came from the user's pinned default (config pinnedTargetProcess/Title). */
  targetPinned?: boolean
  /** Previous capture of the same region (tray "마지막 영역 다시 캡처"): enables the compare view (O). */
  compare?: CompareSource
  /** Self-test only: lets the harness inject a transcript via a DOM event. */
  debug?: boolean
  /** UI language (src/shared/i18n.ts Locale) and its merged message bundle; set by main when sending. */
  locale?: string
  messages?: Record<string, string>
  /** The target chip at open time (plan 2026-10-25 §7); `target` stays for old callers. */
  sendTarget?: SendTargetView
  /** Reopen a sent capture from its session package (phase 3). */
  restore?: { sessionDir: string }
  /** process.platform of the main process, for shortcut labels (Cmd on 'darwin', Ctrl elsewhere). */
  platform?: string
  /**
   * Window targeting, the input check and the automatic paste exist (Windows only). Absent = true; false hides
   * the destination chip and the target picker, because the app is then a clipboard-only tool.
   */
  canTarget?: boolean
}

export interface Point {
  x: number
  y: number
}

/**
 * Stable identity of an annotation. Optional: packages written before it existed have none, and the editor
 * assigns one when it loads them (src/shared/annotationIds.ts). Unlike the index or a badge's number it survives
 * erase, crop and undo, so references to a marked area (UI/UX design conditions) use it.
 */
export interface AnnotationIdentity {
  id?: string
}

/** Every annotation carries timing (ms since the editor opened) so M2 can align speech. */
export type Annotation = AnnotationIdentity & AnnotationShape

export type AnnotationShape =
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
      /** CSS font-family name, e.g. "Noto Sans KR"; undefined = system UI font. */
      font?: string
      /** How the text is made legible over the screenshot: dark outline, a translucent plate, or nothing. */
      style?: 'outline' | 'plate' | 'plain'
      // Optional styling (round 2). Absent = the round-1 look, so older packages render unchanged.
      // `text` may contain '\n' (Shift+Enter): lines are left-aligned, y is the middle of the first line.
      /** Plate colour '#RRGGBB' for style 'plate'; undefined = automatic (dark or white by text brightness). */
      bg?: string
      /** Plate opacity 0..1; undefined = the automatic plate's own alpha. */
      bgOpacity?: number
      /** Outline colour '#RRGGBB' for style 'outline'; undefined = translucent black. */
      outline?: string
      /** Soft drop shadow (behind the plate for 'plate', behind the glyphs otherwise). */
      shadow?: boolean
      /** undefined = the font's default weight (gothic faces bold, display faces regular). */
      bold?: boolean
      italic?: boolean
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
  /**
   * The capture WITHOUT Backseat's annotations (same size and crop as pngDataUrl), saved as
   * screenshot.png so an agent can tell the original screen apart from what the user drew.
   * Blur (privacy) boxes are still applied. Optional: older callers / tests may omit it.
   */
  basePngDataUrl?: string
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
  /**
   * UI/UX guidance the user applied to this send (spec §10.1). Absent = none: drafts are never sent. A send
   * with only this (no marks, memo or voice) is still a request, not a plain picture.
   */
  uiux?: UiuxPayload
}

/** The applied UI/UX guidance for one send: the request snapshot and, optionally, the chosen mock-up. */
export interface UiuxPayload {
  request: DesignRequest
  /** PNG data URL of the selected screen mock-up, saved as design-preview.png; never replaces the capture. */
  previewPngDataUrl?: string
  /** Set by main only (any value from a renderer is replaced): the implementation_report job of this send. */
  reportJobId?: string
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
  /** Deliver to this window (one of EditorInit.candidates / the detected target) instead of the detected target. */
  targetHwnd?: number
  /** Also make that window the default target from now on (config pinnedTargetProcess/Title); false = unpin. */
  pinTarget?: boolean
  /** The user chose "clipboard only" in the target menu: write the package and copy, paste nowhere. */
  clipboardOnly?: boolean
  /** The user chose "음성 없이 보내기" after a failed or unfinished transcription. */
  withoutVoice?: boolean
  /**
   * The previous send stopped with 'targetChanged' (a browser / picked window shows another title) and the
   * user confirmed that window. Main treats the next send to that same window as the confirmation anyway,
   * for exactly the title it showed at the stop (a further change stops again; no auto Enter on it).
   */
  confirmTarget?: boolean
}

export interface SendResult {
  ok: boolean
  /** pasted: delivered into the target window; clipboard: only copied; file-only: package written (if sessionDir), nothing else. */
  delivered: 'pasted' | 'clipboard' | 'file-only'
  /** Session package directory. */
  sessionDir?: string
  /**
   * The window picked in the target menu has closed (or is not one of this editor's candidates). Nothing was
   * written or sent; the editor asks the user to pick again instead of falling back to another window.
   */
  targetExpired?: boolean
  /** Short human message for the status bar. */
  message: string
  error?: string
  /** Staged result: only steps main could confirm (plan 2026-10-25 §7). `delivered` stays for old callers. */
  status?: DeliveryStatus
  /** UI/UX sends: the implementation_report job created for this send (the agent reports the change there). */
  reportJobId?: string
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
    /** Send targets for the chip menu, best first (plan 2026-10-25 §7). Optional until main implements it. */
    targets?(): Promise<SendTargetView[]>
    /** Later delivery news for a send, e.g. an MCP agent fetched it (DeliveryStatus.fetchedBy). */
    onDeliveryUpdate?(cb: (s: DeliveryStatus) => void): void
    /** "새 캡처" after a send: main closes this editor and starts a region capture. */
    newCapture?(): void
  }
  /** UI/UX tools (optional panel in the editor). Optional so older preloads still satisfy the type. */
  uiux?: UiuxApi
  about: {
    getInfo(): Promise<AboutInfo>
    /** Open an http(s) URL in the default browser (main refuses anything else). */
    open(url: string): Promise<void>
    /** Open a bundled document (LICENSE / THIRD_PARTY_NOTICES.md) with the default app. */
    openDoc(doc: 'license' | 'notices'): Promise<void>
  }
}

/** Static facts shown in the About window. */
export interface AboutInfo {
  name: string
  version: string
  tagline: string
  license: string
  repoUrl: string
  supportUrl: string
  issuesUrl: string
  /** UI language and its merged message bundle (see EditorInit.locale). */
  locale?: string
  messages?: Record<string, string>
}

// ---- Delivery contract (plan 2026-10-25 §7). Shared by the main-process and editor work. ----

/** Why "보내기" goes where it goes, as shown in the editor's target chip. */
export type TargetSource =
  /** Chosen in the editor menu / tray for this send. */
  | 'picked'
  /** The pinned default (config pinnedTargetProcess/Title), window alive. */
  | 'pinned'
  /** An MCP agent proven to run in that window (process ancestry, F03). */
  | 'mcp-verified'
  /** The last known AI window the user worked in, tracked by main while Backseat runs. */
  | 'recent-agent'
  /** The known AI app that was in front at capture time. */
  | 'foreground-agent'
  /** Nothing safe to paste into: the user must pick. Never the captured page or a messenger. */
  | 'none'

/** Same window, same process instance: hwnd values are reused, so pid + process start time pin it down. */
export interface TargetIdentity {
  hwnd: number
  pid: number
  /** Process creation time (ms since epoch). */
  processStartMs: number
  title: string
  process: string
}

/** The editor's target chip. */
export interface SendTargetView {
  source: TargetSource
  /** e.g. "Claude Code · backseat", "Codex · ChatGPT 앱"; empty when source is 'none'. */
  label: string
  kind?: AgentKind
  /** MCP agent's project folder name, when known. */
  project?: string
  /** true unless picked / pinned / mcp-verified: the chip says "추정". */
  estimated: boolean
  method: 'paste-path' | 'paste-image' | 'mcp' | 'clipboard'
  identity?: TargetIdentity
  /**
   * source 'none' because the window the user picked or pinned is not open: what it was. Backseat does not
   * fall back to another window; the editor asks the user to pick again.
   */
  unavailable?: { source: TargetSource; label: string }
}

/** Steps main could confirm, in order. Only confirmed steps are shown as done. */
export type DeliveryStep =
  | 'saved'          // session package written
  | 'clipboard'      // clipboard holds the image / instruction
  | 'targetVerified' // the target window is the same instance and came to the front
  | 'inputVerified'  // focused element is an editable, non-password field of that process (or a terminal)
  | 'pasted'         // Ctrl+V was sent after re-checking focus: an ATTEMPT, never "delivered"
  | 'fetched'        // an MCP agent fetched this send id (later, via delivery:update)

export type DeliveryStopReason =
  | 'noTarget'       // source 'none' or the user chose clipboard only
  | 'targetExpired'  // the window closed / its process restarted
  | 'targetChanged'  // a different window or tab came to the front, or the title changed and was not confirmed
  | 'focusLost'      // focus moved between the check and Ctrl+V
  | 'notEditable'    // focused element is not an editable field
  | 'passwordField'  // focused element is a password field: never paste
  | 'uiaUnavailable' // the focus check could not run
  | 'pasteUnsupported' // macOS / Linux preview: no window targeting, input check or paste; the content is on the clipboard
  | 'error'

export interface DeliveryStatus {
  /** = session package id (unique since F02). */
  sendId: string
  sessionDir?: string
  target?: SendTargetView
  reached: DeliveryStep[]
  stoppedAt?: { step: DeliveryStep; reason: DeliveryStopReason }
  /** Set when an MCP agent fetched this send. `expected` = it is the agent the send was meant for. */
  fetchedBy?: { agentId: string; name: string; cwd: string; at: string; tool: string; expected: boolean }
  /** No fetch within the wait window (MCP targets only). */
  fetchTimedOut?: boolean
  /** Enter was pressed after a verified paste (auto-Enter setting). Absent: the user still has to submit. */
  enterPressed?: boolean
}

/** What the editor is about to send, checked before sending. */
export interface PreflightReport {
  image: boolean
  annotations: number
  memo: boolean
  voice: 'none' | 'recording' | 'transcribing' | 'ready' | 'failed'
}

declare global {
  interface Window {
    backseat: BackseatApi
  }
}

// ---------- UI/UX tools (renderer <-> main) ----------

/** Everything the panel shows for one project. `folder` is this PC's path (never exported). */
export interface UiuxProjectState {
  profile: ProjectProfile
  overview: ProjectOverview | null
  rules: DesignRules | null
  folder: string | null
}

/** What the user types when no agent provides an overview ("user input basis", spec §5.5). */
export interface UserOverviewInput {
  summary: string
  purpose: string
  audiences: string[]
  goals: string[]
  /** e.g. "dashboard", "landing page", "sign-in form" */
  screenKinds: string[]
}

export interface UiuxApi {
  listProjects(): Promise<ProjectProfile[]>
  createProject(fields: { name: string; repo?: string }): Promise<ProjectProfile>
  saveProject(profile: ProjectProfile): Promise<ProjectProfile>
  projectState(projectId: string): Promise<UiuxProjectState | null>
  saveUserOverview(projectId: string, input: UserOverviewInput): Promise<ProjectOverview>
  saveRules(projectId: string, rules: { tokens: DesignTokens; locks: string[]; skill?: SkillRef }): Promise<DesignRules>
  /** null clears this PC's folder for the project. */
  setPath(projectId: string, folder: string | null): Promise<void>
  /** Folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>

  // ---------- agent jobs (stages B–D) ----------
  /** Creates a job for the project's agent and returns it with the text that tells the agent about it. */
  requestJob(projectId: string, req: JobRequest): Promise<{ job: UiuxJob; requestText: string }>
  /** copy: the request text goes on the clipboard; paste: also into the editor's current send target. */
  deliverJob(jobId: string, how: 'copy' | 'paste'): Promise<{ ok: boolean; message: string }>
  cancelJob(jobId: string): Promise<UiuxJob>
  /** Moves the deadline to now + minutes. */
  extendJob(jobId: string, minutes: number): Promise<UiuxJob>
  listJobs(projectId: string): Promise<UiuxJob[]>
  /** Stored result. A project_overview result is applied once per submission as a new revision (basis 'agent'). */
  jobOutcome(jobId: string): Promise<JobOutcome | null>
  /** Records that the user checked an implementation report on a new capture (kept with the job). */
  confirmReport(jobId: string, ticked: string[]): Promise<ReportConfirmation>
  /** Status changes of jobs while the editor is open. */
  onJobUpdate(cb: (job: UiuxJob) => void): void
  /** A mock-up PNG an agent submitted for a proposal, as a data URL. */
  proposalPreview(jobId: string, proposalId: string): Promise<string | null>
  /** Overview from a JSON file the user picks, validated like an agent result (basis 'imported'). */
  importOverview(projectId: string): Promise<{ ok: boolean; errors?: string[]; overview?: ProjectOverview }>
  /** Save the overview as Markdown or JSON, or a diagram PNG (data URL from the renderer), via a save dialog. */
  exportOverview(projectId: string, format: 'md' | 'json' | 'png', pngDataUrl?: string): Promise<{ ok: boolean; path?: string }>
  /** Hand edits to the overview: edited fields become the user's and an agent's re-analysis never silently replaces them. */
  saveOverviewEdits(projectId: string, edits: UserOverviewInput): Promise<ProjectOverview>
  /** The agent's skills (from its latest capabilities job) and what is known per skill for this project. */
  skills(projectId: string): Promise<{ agent: SkillRef[]; contexts: SkillContext[]; capabilitiesJob?: UiuxJob }>
  /** Proposals per design_proposal job, newest first. */
  proposals(projectId: string): Promise<{ jobId: string; proposals: DesignProposal[]; overviewRevision?: number }[]>
  /** Profile, rules and overview as a portable file (no absolute paths); import asks for this PC's folder. */
  exportProfile(projectId: string): Promise<{ ok: boolean; path?: string }>
  importProfile(): Promise<{
    ok: boolean
    projectId?: string
    name?: string
    /** true when the file's project id was already taken here and the project got a new id. */
    idChanged?: boolean
    /** true when the user picked a folder for this PC. */
    folderLinked?: boolean
    errors?: string[]
  }>
}
