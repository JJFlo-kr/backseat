// UI/UX tools: data contracts shared by main, preload, renderers and the MCP server.
// Pure types (no Electron, no DOM). Spec: UI/UX tools spec v1 (kept outside this repository) §12, plus design skills
// (plan §1.4). Every stored document carries schemaVersion; every field added later must be optional, and data
// without these fields means "no UI/UX guidance" (old session packages stay valid).

export const UIUX_SCHEMA_VERSION = 1

// ---------- provenance ----------

/**
 * Where a statement comes from. The UI shows it in words, never by colour alone.
 *   verified  — checked in project documents or code (evidence lists where)
 *   user      — entered or confirmed by the user; an agent's re-analysis never silently overwrites it
 *   estimated — the agent's inference
 *   unknown   — not determined; kept visible as an open question
 */
export type Provenance = 'verified' | 'user' | 'estimated' | 'unknown'
export const PROVENANCES: readonly Provenance[] = ['verified', 'user', 'estimated', 'unknown']

/** A file or document a statement rests on: project-relative path, never an absolute PC path. */
export interface Evidence {
  path: string
  note?: string
  /** ISO time the agent looked at it. */
  checkedAt?: string
  /** VCS revision (e.g. a git commit) when known. */
  revision?: string
}

/** One statement and where it comes from. */
export interface Claim<T = string> {
  value: T
  source: Provenance
  evidence?: Evidence[]
}

// ---------- project ----------

/** A project the user registered. Exportable: no absolute paths (those live in ProjectPathMap, per PC). */
export interface ProjectProfile {
  schemaVersion: number
  projectId: string
  name: string
  /** e.g. "github.com/owner/repo"; optional. */
  repo?: string
  /** MCP agent id (or other agent key) the user explicitly linked as this project's AI. */
  agentId?: string
  /** Skills the user chose for this project, in order. */
  skillIds?: string[]
  /** design_proposal requests made so far; the next one is this + 1 (an answer to an older request is told apart). */
  proposalRequests?: number
  createdAt: string
  updatedAt: string
}

/** This PC's folder for each project. Never exported. */
export interface ProjectPathMap {
  schemaVersion: number
  paths: Record<string, string>
}

export type ArchNodeType = 'screen' | 'module' | 'store' | 'external' | 'other'
export const ARCH_NODE_TYPES: readonly ArchNodeType[] = ['screen', 'module', 'store', 'external', 'other']

export interface ArchNode {
  id: string
  type: ArchNodeType
  label: string
  description?: string
  /** Lower level nodes point at their parent; the first view shows nodes without a parent. */
  parent?: string
  source: Provenance
  evidence?: Evidence[]
}

export interface ArchEdge {
  from: string
  to: string
  relation: string
  source: Provenance
  evidence?: Evidence[]
}

export interface Architecture {
  nodes: ArchNode[]
  edges: ArchEdge[]
}

export interface Workflow {
  id: string
  name: string
  steps: string[]
  /** ArchNode ids of the screens the flow passes through. */
  screens?: string[]
  source: Provenance
}

/** What the project is and why: the basis every recommendation must cite. */
export interface ProjectOverview {
  schemaVersion: number
  projectId: string
  /** Increases with every stored version; recommendations record the revision they used. */
  revision: number
  /** How this overview came about. 'user' = typed by the user without an agent ("user input basis"). */
  basis: 'agent' | 'imported' | 'user'
  summary: Claim
  purpose: Claim
  /** Priorities in order: accuracy, speed, readability, trust, brand expression, … */
  goals: Claim[]
  /** Main users, their skill, environment and languages. */
  audiences: Claim[]
  workflows: Workflow[]
  architecture: Architecture
  stack: Claim[]
  /** Brand colours, fonts, tokens, density, themes as found. */
  designState: Claim[]
  designConstraints: Claim[]
  sources: Evidence[]
  unknowns: string[]
  questions?: string[]
  generatedAt: string
  /** The job that produced it, when an agent did. */
  jobId?: string
}

// ---------- design values ----------

export type ColorRole =
  | 'background' | 'surface' | 'text' | 'textMuted' | 'primary' | 'onPrimary' | 'border'
  | 'success' | 'warning' | 'danger' | 'info'
export const COLOR_ROLES: readonly ColorRole[] = [
  'background', 'surface', 'text', 'textMuted', 'primary', 'onPrimary', 'border', 'success', 'warning', 'danger', 'info'
]

export interface ShadowSpec {
  x: number
  y: number
  blur: number
  spread: number
  /** '#RRGGBB' */
  color: string
  /** 0..1 */
  opacity: number
}

export type ShadowRole = 'button' | 'card' | 'popover'
export const SHADOW_ROLES: readonly ShadowRole[] = ['button', 'card', 'popover']

export type TypeRole = 'heading' | 'body' | 'numeric'
export const TYPE_ROLES: readonly TypeRole[] = ['heading', 'body', 'numeric']

export interface TypeSpec {
  /** CSS font-family the user asked for. */
  family: string
  /** Fallback stack used when it is missing. */
  fallback: string
  /** CSS px */
  size: number
  weight: number
  /** unitless multiplier */
  lineHeight: number
}

export type Density = 'compact' | 'comfortable' | 'spacious'

export interface BoxSpec {
  /** CSS px */
  radius: number
  paddingX: number
  paddingY: number
  gap: number
  /** Minimum width of a button, CSS px; undefined = fit to content. */
  buttonMinWidth?: number
  /** Maximum width of a text column / card, CSS px; undefined = no limit. */
  maxWidth?: number
  density: Density
}

/**
 * Target share of the background, surface and accent layers in a marked area, in percent (sum 100).
 * A heuristic target, not a measurement: photos and text ink are excluded, and a plain screenshot cannot be
 * split reliably, so values for a capture are labelled "target ratio".
 */
export interface ColorRatio {
  background: number
  surface: number
  accent: number
}

export interface DesignTokens {
  colors: Record<ColorRole, string>
  ratio: ColorRatio
  /** null = no shadow for that role (flat / outline instead). */
  shadows: Record<ShadowRole, ShadowSpec | null>
  type: Record<TypeRole, TypeSpec>
  box: BoxSpec
}

/** A dotted path into DesignTokens, e.g. "colors.primary", "shadows.card", "type.body.size". Used for locks and changes. */
export type TokenPath = string

/** The project's design system: base rules plus per-screen exceptions. */
export interface DesignRules {
  schemaVersion: number
  projectId: string
  revision: number
  tokens: DesignTokens
  /** Token paths the user locked: recommendations must keep them. */
  locks: TokenPath[]
  /** Screen name → token values that differ on that screen. */
  pageOverrides: Record<string, Partial<Record<TokenPath, unknown>>>
  componentRules: string[]
  themes: ('light' | 'dark')[]
  /** Skill that produced or last updated the rules. */
  skill?: SkillRef
  updatedAt: string
}

// ---------- proposals and requests ----------

export type PreviewKind = 'sample' | 'mockup' | 'none'

/** Where a change applies. Annotation references use Annotation.id, never the on-screen number. */
export interface DesignScope {
  kind: 'all' | 'component' | 'annotations'
  component?: 'button' | 'card' | 'input' | 'table'
  annotationIds?: string[]
}

export interface Check {
  id: string
  /** visual = can be seen on a mock-up or a capture; runtime = needs the running app (focus, responsive, screen reader). */
  kind: 'visual' | 'runtime'
  label: string
  status: 'unverified' | 'pass' | 'fail'
  note?: string
}

export interface DesignProposal {
  proposalId: string
  projectId: string
  overviewRevision?: number
  rulesRevision?: number
  /** Revision of the request input (capture, scope, locks) it answers. */
  inputRevision: number
  /** A = minimal change, B = balanced, C = another direction; free text for others. */
  direction: string
  name: string
  rationale: string
  tokens: DesignTokens
  changes: string[]
  preserved: string[]
  cautions?: string[]
  previewKind: PreviewKind
  /** Package-relative file name of a validated PNG mock-up. */
  previewRef?: string
  checks: Check[]
  skill?: SkillRef
  /** user = mixed or adjusted by the user from other proposals. */
  origin: 'builtin' | 'agent' | 'user'
}

export interface TokenChange {
  path: TokenPath
  from: unknown
  to: unknown
}

/** What a send carries when UI/UX guidance is applied: a snapshot, independent of later profile edits. */
export interface DesignRequest {
  schemaVersion: number
  projectId: string
  projectName: string
  /** One or two sentences of purpose for the agent; the full overview is not sent. */
  purposeSummary?: string
  overviewRevision?: number
  overviewBasis?: ProjectOverview['basis']
  rulesRevision?: number
  selectedProposalId?: string
  scope: DesignScope
  /** The final token values to aim for (rules + proposal + user changes resolved). */
  resolved: DesignTokens
  changes: TokenChange[]
  preserve: string[]
  locks: TokenPath[]
  checks: Check[]
  /** Package-relative name of the selected mock-up (design-preview.png), when there is one. */
  previewRef?: string
  skill?: SkillRef
  /** Conflicts the app noticed (e.g. memo vs. a locked rule), passed on unresolved. */
  conflicts?: string[]
  createdAt: string
}

// ---------- agent jobs ----------

/**
 * implementation_report: created with every send that carries UI/UX guidance; the agent that carried out the
 * change reports what it changed (spec §10.3 "AI 작업 결과 수신"). A fetch of the package alone is never that.
 */
export type JobType = 'capabilities' | 'project_overview' | 'skill_setup' | 'design_proposal' | 'style_audit' | 'implementation_report'
export const JOB_TYPES: readonly JobType[] = ['capabilities', 'project_overview', 'skill_setup', 'design_proposal', 'style_audit', 'implementation_report']

/**
 * pending   — created, the agent has not fetched it ("waiting for the agent", never "analysing")
 * fetched   — the agent fetched the input
 * submitted — a result arrived and passed validation
 * rejected  — a result arrived but failed validation (reason in error)
 * failed / cancelled / expired
 */
export type JobStatus = 'pending' | 'fetched' | 'submitted' | 'rejected' | 'failed' | 'cancelled' | 'expired'

export interface UiuxJob {
  schemaVersion: number
  jobId: string
  type: JobType
  projectId: string
  agentId?: string
  inputRevision: number
  status: JobStatus
  createdAt: string
  updatedAt: string
  /** Default 5 min; the user can extend it. */
  expiresAt: string
  fetchedAt?: string
  resultRef?: string
  error?: string
  skillId?: string
}

// ---------- skills ----------

export interface SkillRef {
  id: string
  name: string
  /** builtin = Backseat's own rules; agent = installed for the agent (it runs there); imported = folder the user picked (text and data only). */
  source: 'builtin' | 'agent' | 'imported'
  version?: string
  description?: string
}

/** What a skill needs to know about a project, gathered by the agent (skill_setup) or typed by the user. */
export interface SkillContext {
  schemaVersion: number
  projectId: string
  skill: SkillRef
  revision: number
  fields: Record<string, Claim>
  /** Field names the skill needs that are still unknown. */
  missing: string[]
  generatedAt: string
  jobId?: string
}

// ---------- results the panel shows ----------

/** One deviation from the project's rules found by a style audit. */
export interface StyleFinding {
  /** Screen, component or file area the finding is about. */
  area: string
  issue: string
  source: Provenance
  evidence?: Evidence[]
  suggestion: string
}

/** What the agent says it did for a UI/UX request (implementation_report job). Its own account, not proof. */
export interface ImplementationReport {
  summary: string
  changedFiles: Evidence[]
  /** Requested items it did not do, and why. */
  notDone: string[]
  /** Checks the agent says it ran; shown as the agent's claim, the user still confirms. */
  checksRun: string[]
}

/** The user's check of an implementation report: when, and which checklist items they ticked. */
export interface ReportConfirmation {
  at: string
  ticked: string[]
}

/** The outcome of a job as the panel sees it (main reads jobs/<id>.result.json). */
export interface JobOutcome {
  job: UiuxJob
  submission?: number
  completeness?: { complete: boolean; gaps: string[] }
  skills?: SkillRef[]
  proposals?: DesignProposal[]
  findings?: StyleFinding[]
  report?: ImplementationReport
  /** implementation_report: the user looked at the result on a new capture (spec §10.3 "사용자 확인"). */
  confirmation?: ReportConfirmation
  /** implementation_report: the value changes the send asked for (from the job input), to compare a new capture with. */
  requested?: TokenChange[]
  /** The overview revision stored from this result, when it was a project_overview. */
  overviewRevision?: number
}

/** Options when the panel asks for a job. */
export interface JobRequest {
  type: JobType
  skillId?: string
  minutes?: number
  /** design_proposal / style_audit: the capture the agent should look at (PNG data URLs; blur already applied). */
  capturePng?: string
  annotatedPng?: string
  scope?: DesignScope
  preserve?: string[]
  /** design_proposal: what the screen is for, in the user's words. */
  screenPurpose?: string
  /** design_proposal: current values and locks the agent must respect. */
  tokens?: DesignTokens
  locks?: TokenPath[]
  /** implementation_report: the send it belongs to. */
  sessionDir?: string
}
