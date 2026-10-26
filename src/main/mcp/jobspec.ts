// JSON Schemas (draft 2020-12) of what an agent submits for each job type (backseat_job_get returns them).
// They mirror the checks in src/shared/uiux/validate.ts and src/main/mcp/styleaudit.ts, which stay the authority:
// a result that fits the schema can still be rejected (e.g. a node id used twice). Identifiers only, no prose;
// the readable description of each type is a translated message (mcp.job.what.<type>).
import { ARCH_NODE_TYPES, COLOR_ROLES, JOB_TYPES, PROVENANCES, SHADOW_ROLES, TYPE_ROLES, type JobType } from '../../shared/uiux/types'
import { MAX_FINDINGS } from './styleaudit'
import { MAX_PREVIEW_BYTES } from './jobimage'

type Schema = Record<string, unknown>

const str = (maxLength: number): Schema => ({ type: 'string', minLength: 1, maxLength })
const strList = (maxLength: number, maxItems: number, minItems = 0): Schema => ({ type: 'array', minItems, maxItems, items: str(maxLength) })
const list = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: 'array', minItems, maxItems, items })
const obj = (properties: Schema, required: string[]): Schema => ({ type: 'object', properties, required })
const num = (minimum: number, maximum: number): Schema => ({ type: 'number', minimum, maximum })
const ID = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' }
const PROVENANCE = { enum: [...PROVENANCES] }
const HEX = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }

/** A project-relative file path: no drive letter, no leading slash, no "..". */
const RELATIVE_PATH = { type: 'string', minLength: 1, maxLength: 400, not: { pattern: '^([A-Za-z]:[\\\\/]|[\\\\/~])|(^|[\\\\/])\\.\\.([\\\\/]|$)' } }
const EVIDENCE = obj({ path: RELATIVE_PATH, note: str(200), checkedAt: str(40), revision: str(80) }, ['path'])
/** "verified" is only allowed together with at least one evidence entry. */
const VERIFIED_NEEDS_EVIDENCE = { if: { properties: { source: { const: 'verified' } }, required: ['source'] }, then: { required: ['evidence'], properties: { evidence: { minItems: 1 } } } }
const withEvidence = (props: Schema, required: string[]): Schema => ({
  ...obj({ ...props, source: PROVENANCE, evidence: list(EVIDENCE, 20) }, [...required, 'source']),
  allOf: [VERIFIED_NEEDS_EVIDENCE]
})
const claim = (maxLength: number): Schema => withEvidence({ value: str(maxLength) }, ['value'])

const SKILL_REF = obj({ id: ID, name: str(80), source: { enum: ['builtin', 'agent', 'imported'] }, version: str(40), description: str(600) }, ['id', 'name'])

const SHADOW = obj({ x: num(-50, 50), y: num(-50, 50), blur: num(0, 100), spread: num(-50, 50), color: HEX, opacity: num(0, 1) }, ['x', 'y', 'blur', 'spread', 'color', 'opacity'])
const TYPE_SPEC = obj({ family: str(80), fallback: str(160), size: num(8, 96), weight: { type: 'integer', minimum: 100, maximum: 900 }, lineHeight: num(0.8, 3) }, ['family', 'fallback', 'size', 'weight', 'lineHeight'])
const TOKENS = obj({
  colors: obj(Object.fromEntries(COLOR_ROLES.map((r) => [r, HEX])), [...COLOR_ROLES]),
  ratio: obj({ background: num(0, 100), surface: num(0, 100), accent: num(0, 100) }, ['background', 'surface', 'accent']),
  shadows: obj(Object.fromEntries(SHADOW_ROLES.map((r) => [r, { anyOf: [SHADOW, { type: 'null' }] }])), [...SHADOW_ROLES]),
  type: obj(Object.fromEntries(TYPE_ROLES.map((r) => [r, TYPE_SPEC])), [...TYPE_ROLES]),
  box: obj({
    radius: num(0, 48), paddingX: num(0, 64), paddingY: num(0, 64), gap: num(0, 64), buttonMinWidth: num(0, 600), maxWidth: num(120, 4000),
    density: { enum: ['compact', 'comfortable', 'spacious'] }
  }, ['radius', 'paddingX', 'paddingY', 'gap', 'density'])
}, ['colors', 'ratio', 'shadows', 'type', 'box'])

const PROJECT_ID = str(64)

const OVERVIEW = obj({
  projectId: PROJECT_ID,
  summary: claim(300),
  purpose: claim(2000),
  goals: list(claim(300), 12),
  audiences: list(claim(400), 12),
  workflows: list(withEvidence({ id: ID, name: str(120), steps: strList(200, 20, 1), screens: strList(64, 20) }, ['id', 'name', 'steps']), 12),
  architecture: obj({
    nodes: list(withEvidence({ id: ID, type: { enum: [...ARCH_NODE_TYPES] }, label: str(80), description: str(600), parent: str(64) }, ['id', 'type', 'label']), 80, 1),
    edges: list(withEvidence({ from: str(64), to: str(64), relation: str(80) }, ['from', 'to', 'relation']), 200)
  }, ['nodes', 'edges']),
  stack: list(claim(300), 30),
  designState: list(claim(400), 30),
  designConstraints: list(claim(400), 30),
  sources: list(EVIDENCE, 60),
  unknowns: strList(300, 30),
  questions: strList(300, 20)
}, ['projectId', 'summary', 'purpose', 'goals', 'audiences', 'workflows', 'architecture', 'stack', 'designState', 'designConstraints', 'sources', 'unknowns'])

const SKILL_CONTEXT = obj({
  projectId: PROJECT_ID,
  skillId: ID,
  fields: { type: 'object', maxProperties: 40, propertyNames: ID, additionalProperties: claim(600) },
  missing: strList(64, 40)
}, ['projectId', 'skillId', 'fields'])

const CAPABILITIES = obj({ skills: list(SKILL_REF, 100) }, ['skills'])

const PROPOSAL = obj({
  proposalId: ID,
  projectId: PROJECT_ID,
  direction: str(40),
  name: str(80),
  rationale: str(1500),
  tokens: TOKENS,
  changes: strList(300, 40),
  preserved: strList(300, 40),
  cautions: strList(300, 20),
  checks: list(obj({ id: ID, kind: { enum: ['visual', 'runtime'] }, label: str(200), note: str(300) }, ['id', 'kind', 'label']), 30),
  skill: SKILL_REF,
  previewPngBase64: {
    type: 'string',
    contentEncoding: 'base64',
    contentMediaType: 'image/png',
    maxLength: Math.ceil(MAX_PREVIEW_BYTES / 3) * 4
  }
}, ['proposalId', 'projectId', 'direction', 'name', 'rationale', 'tokens', 'changes', 'preserved', 'checks'])

const DESIGN_PROPOSAL = obj({ projectId: PROJECT_ID, proposals: list(PROPOSAL, 4, 1) }, ['proposals'])

const STYLE_AUDIT = obj({
  projectId: PROJECT_ID,
  findings: list(withEvidence({ area: str(120), issue: str(600), suggestion: str(600) }, ['area', 'issue', 'suggestion']), MAX_FINDINGS)
}, ['findings'])

const SCHEMAS: Record<JobType, Schema> = {
  project_overview: OVERVIEW,
  skill_setup: SKILL_CONTEXT,
  capabilities: CAPABILITIES,
  design_proposal: DESIGN_PROPOSAL,
  style_audit: STYLE_AUDIT
}

export function isJobType(v: unknown): v is JobType {
  return typeof v === 'string' && (JOB_TYPES as readonly string[]).includes(v)
}

/** The JSON Schema of the `result` argument of backseat_job_submit for a job type. */
export function resultSchema(type: JobType): Schema {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...SCHEMAS[type] }
}
