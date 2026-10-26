// The portable project file and the readable Markdown: no absolute PC paths, evidence stays project-relative,
// import validates like an agent result, provenance is always written in words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProfileBundle, findAbsolutePaths, parseProfileBundle, scrubText, PROFILE_KIND } from '../src/main/uiux/profileio.ts'
import { profileToMarkdown } from '../src/main/uiux/overviewmd.ts'
import type { DesignRules, ProjectOverview, ProjectProfile, SkillContext } from '../src/shared/uiux/types.ts'
import { tokens } from './support/uiux-fixtures.ts'

const echo = (key: string, params?: Record<string, unknown>): string => (params ? `${key}${JSON.stringify(params)}` : key)

const profile: ProjectProfile = { schemaVersion: 1, projectId: 'acme-1', name: 'Acme tasks', repo: 'github.com/acme/tasks', agentId: 'agent-7', proposalRequests: 3, createdAt: 'a', updatedAt: 'b' }
const overview = (): ProjectOverview => ({
  schemaVersion: 1, projectId: 'acme-1', revision: 4, basis: 'agent', jobId: 'job-1', generatedAt: '2026-10-27T10:00:00.000Z',
  summary: { value: 'Task tracker for D:\\work\\acme\\src', source: 'verified', evidence: [{ path: 'README.md' }, { path: 'C:\\Users\\boss\\acme\\README.md' }] },
  purpose: { value: 'Keep tasks in one place', source: 'verified', evidence: [{ path: '/Users/boss/acme/docs/why.md' }] },
  goals: [{ value: 'readability', source: 'user' }],
  audiences: [{ value: 'team leads', source: 'estimated' }],
  workflows: [{ id: 'w', name: 'Sign in', steps: ['open', 'sign in'], source: 'verified' }],
  architecture: {
    nodes: [{ id: 'login', type: 'screen', label: 'Login', source: 'verified', evidence: [{ path: 'src/login.ts' }] }, { id: 'db', type: 'store', label: 'DB', source: 'estimated' }],
    edges: [{ from: 'login', to: 'db', relation: 'reads', source: 'estimated' }]
  },
  stack: [], designState: [], designConstraints: [],
  sources: [{ path: 'README.md' }, { path: '\\\\server\\share\\x.md' }, { path: '../outside.md' }],
  unknowns: ['backend at \\\\nas\\team\\acme'], questions: ['Which DB?']
})
const rules = (): DesignRules => ({ schemaVersion: 1, projectId: 'acme-1', revision: 2, tokens: tokens() as DesignRules['tokens'], locks: ['colors.primary'], pageOverrides: {}, componentRules: ['Buttons use the primary colour'], themes: ['light'], updatedAt: 'x' })
const ctx = (): SkillContext => ({
  schemaVersion: 1, projectId: 'acme-1', skill: { id: 'uupm', name: 'UI Pro', source: 'agent' }, revision: 1, jobId: 'job-2', generatedAt: 'g',
  fields: { styling: { value: 'tailwind in /home/boss/acme/tailwind.config.js', source: 'verified', evidence: [{ path: 'tailwind.config.js' }] }, theme: { value: 'dark', source: 'verified', evidence: [{ path: 'D:\\acme\\theme.ts' }] } },
  missing: ['tokens']
})

test('scrubText removes drive, UNC and user-folder paths but not URLs or relative paths', () => {
  assert.equal(scrubText('see C:\\Users\\a\\x.ts and D:/work/y'), 'see [local path removed] and [local path removed]')
  assert.equal(scrubText('at \\\\nas\\team\\f'), 'at [local path removed]')
  assert.equal(scrubText('open /Users/bob/p/a.ts'), 'open [local path removed]')
  assert.equal(scrubText('https://example.com/a/b and src/main/x.ts and /api/users'), 'https://example.com/a/b and src/main/x.ts and /api/users')
})

test('export: no absolute path anywhere, evidence relative, agent link and job ids dropped', () => {
  const { bundle, report } = buildProfileBundle({ profile, rules: rules(), overview: overview(), skillContexts: [ctx()], now: '2026-10-27T11:00:00.000Z' })
  assert.deepEqual(findAbsolutePaths(bundle), [])
  assert.equal(bundle.kind, PROFILE_KIND)
  assert.equal(bundle.profile.agentId, undefined)
  assert.equal(bundle.overview?.jobId, undefined)
  assert.equal(bundle.skillContexts[0]?.jobId, undefined)
  const o = bundle.overview!
  assert.deepEqual(o.summary.evidence, [{ path: 'README.md' }])
  assert.equal(o.purpose.source, 'estimated', 'verified lost all its evidence')
  assert.equal(o.purpose.evidence, undefined)
  assert.deepEqual(o.sources, [{ path: 'README.md' }])
  assert.equal(o.unknowns[0], 'backend at [local path removed]')
  assert.equal(bundle.skillContexts[0]?.fields.theme?.source, 'estimated')
  assert.equal(report.evidenceDropped, 3)
  assert.equal(report.downgraded, 2)
  assert.doesNotMatch(JSON.stringify(bundle), /boss|\\\\nas|D:\\\\/)
})

test('a bundle round-trips through the import validator (project id, rules, overview, skill contexts)', () => {
  const { bundle } = buildProfileBundle({ profile, rules: rules(), overview: overview(), skillContexts: [ctx()] })
  const r = parseProfileBundle(JSON.parse(JSON.stringify(bundle)))
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'))
  if (!r.ok) return
  const d = r.value.data
  assert.equal(d.profile.projectId, 'acme-1')
  assert.equal(d.profile.name, 'Acme tasks')
  assert.deepEqual(d.rules?.locks, ['colors.primary'])
  assert.equal(d.overview?.projectId, 'acme-1')
  assert.equal(d.skillContexts[0]?.skill.id, 'uupm')
  assert.deepEqual(d.skillContexts[0]?.missing, ['tokens'])
})

test('import rejects what is not a valid project file', () => {
  const { bundle } = buildProfileBundle({ profile, rules: rules(), overview: overview(), skillContexts: [] })
  const json = (): Record<string, unknown> => JSON.parse(JSON.stringify(bundle)) as Record<string, unknown>
  const errs = (v: unknown): string[] => {
    const r = parseProfileBundle(v)
    return r.ok ? [] : r.errors
  }
  assert.match(errs({ hello: 1 })[0] ?? '', /kind/)
  assert.match(errs({ ...json(), schemaVersion: 99 })[0] ?? '', /newer/)
  assert.match(errs({ ...json(), profile: { projectId: '../evil', name: 'x' } }).join(' '), /projectId/)
  const badTokens = json()
  ;(badTokens.rules as { tokens: { colors: { primary: string } } }).tokens.colors.primary = 'red'
  assert.match(errs(badTokens).join(' '), /rules\.tokens\.colors\.primary/)
  const absolute = json()
  ;(absolute.overview as { sources: { path: string }[] }).sources = [{ path: 'C:\\x\\y.md' }]
  assert.match(errs(absolute).join(' '), /project-relative/)
  const unverified = json()
  ;(unverified.overview as { summary: { source: string; evidence?: unknown } }).summary = { source: 'verified', value: 'x' } as never
  assert.match(errs(unverified).join(' '), /needs evidence/)
})

test('profile Markdown: no folder path, rules and skill contexts included', () => {
  const { bundle } = buildProfileBundle({ profile, rules: rules(), overview: overview(), skillContexts: [ctx()] })
  const md = profileToMarkdown({ profile: bundle.profile, rules: bundle.rules, overview: bundle.overview, skillContexts: bundle.skillContexts, exportedAt: bundle.exportedAt }, echo)
  assert.deepEqual(findAbsolutePaths(md), [])
  assert.match(md, /uiux\.export\.profile\.noPaths/)
  assert.match(md, /colors\.primary: #/)
  assert.match(md, /- styling: .* — uiux\.overview\.prov\.verified/)
  // The overview follows as a section of the file, one heading level down.
  assert.match(md, /^## uiux\.overview\.title/m)
})
