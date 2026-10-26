// UI/UX guidance in the request package, pure part (spec §10.1): mock-up PNG validation, the brief section,
// and "guidance only is not a plain picture". Strings are checked as message keys (an echo translator), and every
// key the section uses must exist in en.json or in the staging file of keys waiting to be merged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'
import { buildBrief } from '../src/main/brief.ts'
import { isPlainCapture } from '../src/main/agents.ts'
import { checkPreviewPng, designFiles, hasUiuxGuidance, PREVIEW_MAX_BYTES, uiuxBriefLines } from '../src/main/uiux/package.ts'
import type { Annotation, ExportPayload } from '../src/shared/types.ts'
import type { DesignRequest, DesignTokens } from '../src/shared/uiux/types.ts'
import type { Translate } from '../src/shared/i18n.ts'

// ---------- fixtures ----------

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** A structurally real 1-bit grayscale PNG header (IHDR + IEND); the size fields are what the check reads. */
function pngBytes(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 1
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))])
}
const dataUrl = (b: Buffer): string => `data:image/png;base64,${b.toString('base64')}`

const tokens: DesignTokens = {
  colors: {
    background: '#FFFFFF', surface: '#F4F4F5', text: '#111111', textMuted: '#666666', primary: '#2563EB', onPrimary: '#FFFFFF',
    border: '#D4D4D8', success: '#16A34A', warning: '#D97706', danger: '#DC2626', info: '#0284C7'
  },
  ratio: { background: 60, surface: 30, accent: 10 },
  shadows: { button: null, card: { x: 0, y: 2, blur: 6, spread: 0, color: '#000000', opacity: 0.2 }, popover: null },
  type: {
    heading: { family: 'Inter', fallback: 'sans-serif', size: 24, weight: 700, lineHeight: 1.3 },
    body: { family: 'Inter', fallback: 'sans-serif', size: 14, weight: 400, lineHeight: 1.5 },
    numeric: { family: 'Consolas', fallback: 'monospace', size: 14, weight: 500, lineHeight: 1.4 }
  },
  box: { radius: 8, paddingX: 12, paddingY: 8, gap: 8, buttonMinWidth: 96, density: 'comfortable' }
}

const request = (extra: Partial<DesignRequest> = {}): DesignRequest => ({
  schemaVersion: 1,
  projectId: 'p1',
  projectName: 'Shop admin',
  purposeSummary: 'Staff look up and refund orders.',
  overviewRevision: 3,
  overviewBasis: 'user',
  rulesRevision: 2,
  scope: { kind: 'all' },
  resolved: tokens,
  changes: [
    { path: 'colors.primary', from: '#1D4ED8', to: '#2563EB' },
    { path: 'shadows.button', from: { x: 0, y: 1, blur: 2, spread: 0, color: '#000000', opacity: 0.1 }, to: null }
  ],
  preserve: ['Keep the sidebar layout'],
  locks: ['colors.danger'],
  checks: [
    { id: 'c1', kind: 'visual', label: 'Text contrast', status: 'unverified' },
    { id: 'c2', kind: 'visual', label: 'Alignment', status: 'pass' },
    { id: 'c3', kind: 'runtime', label: 'Keyboard focus ring', status: 'unverified', note: 'needs the running app' }
  ],
  skill: { id: 's1', name: 'ui-ux-pro', source: 'builtin', version: '1.2' },
  conflicts: ['Memo asks for red but colors.danger is locked'],
  createdAt: '2026-10-27T10:00:00.000Z',
  ...extra
})

const A = (id: string | undefined, n: number): Annotation => ({ kind: 'badge', x: n * 10, y: 5, n, color: '#E5484D', size: 22, tStart: n, tEnd: n, ...(id ? { id } : {}) })

const basePayload = (extra: Partial<ExportPayload> = {}): ExportPayload => ({
  pngDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  memo: '',
  annotations: [],
  meta: { capturedAt: '2026-10-27T10:00:00.000Z', displayId: 0, scaleFactor: 1, rectDip: { x: 0, y: 0, width: 1, height: 1 }, rectPx: { x: 0, y: 0, width: 1, height: 1 }, mode: 'rect' },
  ...extra
})

/** Renders `key{a=1,b=2}`: the test reads keys and parameters, not wording. */
const echo: Translate = (key, params) => (params && Object.keys(params).length > 0 ? `${key}{${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}}` : key)

// ---------- mock-up validation ----------

test('a real PNG within the limits is accepted with its size', () => {
  const r = checkPreviewPng(dataUrl(pngBytes(320, 200)))
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual([r.width, r.height], [320, 200])
})

test('bad prefix, encoding, signature, header and size are all rejected', () => {
  const good = pngBytes(10, 10)
  const reason = (v: unknown): string | undefined => {
    const r = checkPreviewPng(v)
    return r.ok ? undefined : r.reason
  }
  assert.equal(reason(`data:image/jpeg;base64,${good.toString('base64')}`), 'prefix')
  assert.equal(reason(`DATA:image/png;base64,${good.toString('base64')}`), 'prefix')
  assert.equal(reason(`data:image/png;base64 ,${good.toString('base64')}`), 'prefix')
  assert.equal(reason(good.toString('base64')), 'prefix')
  assert.equal(reason(undefined), 'prefix')
  assert.equal(reason('data:image/png;base64,@@@@'), 'encoding')
  assert.equal(reason(dataUrl(Buffer.from('this is not a png at all, just text bytes'))), 'signature')
  const flipped = Buffer.from(good)
  flipped[1] = 0x51
  assert.equal(reason(dataUrl(flipped)), 'signature', 'one wrong signature byte')
  assert.equal(reason(dataUrl(good.subarray(0, 8))), 'header', 'signature only, no IHDR')
  const notIhdr = Buffer.from(good)
  notIhdr.write('IDAT', 12, 'latin1')
  assert.equal(reason(dataUrl(notIhdr)), 'header')
  const bigText = `data:image/png;base64,${'A'.repeat(Math.ceil(((PREVIEW_MAX_BYTES + 100) * 4) / 3 / 4) * 4)}`
  assert.equal(reason(bigText), 'tooLarge')
  const big = Buffer.concat([good, Buffer.alloc(PREVIEW_MAX_BYTES)])
  assert.equal(reason(dataUrl(big)), 'tooLarge')
  assert.equal(checkPreviewPng(dataUrl(Buffer.concat([good, Buffer.alloc(1000)]))).ok, true, 'a small trailer is fine')
})

test('IHDR width and height must be 1..10000', () => {
  for (const [w, h] of [[0, 10], [10, 0], [10001, 10], [10, 10001], [0xffffffff, 1]] as const) {
    const r = checkPreviewPng(dataUrl(pngBytes(w, h)))
    assert.equal(r.ok, false, `${w}x${h}`)
    if (!r.ok) assert.equal(r.reason, 'dimensions')
  }
  assert.equal(checkPreviewPng(dataUrl(pngBytes(1, 1))).ok, true)
  assert.equal(checkPreviewPng(dataUrl(pngBytes(10000, 10000))).ok, true)
})

test('designFiles: previewRef is set only for a written mock-up, never for a given one', () => {
  assert.equal(designFiles(basePayload()), null)
  const given = request({ previewRef: 'design-preview.png' })
  // no mock-up sent: a ref the request carries is dropped
  const none = designFiles(basePayload({ uiux: { request: given } }))
  assert.equal(none?.request.previewRef, undefined)
  assert.equal(none?.preview, undefined)
  // valid mock-up
  const ok = designFiles(basePayload({ uiux: { request: request(), previewPngDataUrl: dataUrl(pngBytes(30, 20)) } }))
  assert.equal(ok?.request.previewRef, 'design-preview.png')
  assert.ok(ok?.preview && ok.preview.length > 0)
  // every kind of bad mock-up drops the ref and says why
  for (const bad of ['data:image/gif;base64,AAAA', dataUrl(Buffer.from('nope nope nope nope nope nope')), dataUrl(pngBytes(0, 5)), dataUrl(Buffer.concat([pngBytes(1, 1), Buffer.alloc(PREVIEW_MAX_BYTES)]))]) {
    const r = designFiles(basePayload({ uiux: { request: given, previewPngDataUrl: bad } }))
    assert.equal(r?.request.previewRef, undefined, 'never reference a file that is not written')
    assert.equal(r?.preview, undefined)
    assert.ok(r?.previewRejected)
  }
  // the rest of the request is untouched
  assert.deepEqual({ ...ok?.request, previewRef: undefined }, { ...request(), previewRef: undefined })
})

// ---------- brief section ----------

test('guidance only (no marks, memo, voice) is a request, not a plain picture', () => {
  const guidanceOnly = basePayload({ uiux: { request: request() } })
  assert.equal(isPlainCapture(guidanceOnly), true, 'isPlainCapture itself looks at marks/memo/voice only')
  assert.equal(hasUiuxGuidance(guidanceOnly), true)
  assert.equal(hasUiuxGuidance(basePayload()), false)
  // this is exactly the condition send.ts uses
  assert.equal(isPlainCapture(guidanceOnly) && !hasUiuxGuidance(guidanceOnly), false)
  assert.equal(isPlainCapture(basePayload()) && !hasUiuxGuidance(basePayload()), true, 'without guidance it is still plain')
})

test('the brief gets a UI/UX section with the request in text', () => {
  const brief = buildBrief(
    basePayload({ annotations: [A('a1', 1), A('a2', 2), A('a3', 3)], uiux: { request: request({ scope: { kind: 'annotations', annotationIds: ['a3', 'gone', 'a1'] }, previewRef: 'design-preview.png' }) } }),
    'annotated.png',
    null,
    { t: echo, uiuxPreviewFileName: 'design-preview.png' }
  )
  const section = brief.slice(brief.indexOf('## brief.uiux.heading'), brief.indexOf('## brief.interp.heading'))
  assert.ok(section.length > 0, 'section sits before the interpretation notes')
  assert.match(section, /brief\.uiux\.project\{name=Shop admin\}/)
  assert.match(section, /brief\.uiux\.purpose\{summary=Staff look up and refund orders\.\}/)
  assert.match(section, /brief\.uiux\.overview\{basis=brief\.uiux\.basis\.user,revision=3\}/, 'user input basis is named')
  assert.match(section, /brief\.uiux\.skill\{name=ui-ux-pro 1\.2,source=brief\.uiux\.skill\.source\.builtin\}/)
  // ids become the annotation list's numbers; a missing id becomes "no area to link to"
  assert.match(section, /brief\.uiux\.scope\.annotations\{refs=③, brief\.uiux\.scope\.unlinked, ①\}/)
  assert.match(section, /- colors\.primary: #1D4ED8 → #2563EB/)
  // A shadow change reads like the target values (x y blur spread colour @opacity), not as JSON.
  assert.match(section, /- shadows\.button: 0 1 2 0 #000000 @10% → brief\.uiux\.value\.none/)
  assert.match(section, /brief\.uiux\.aim\.colors\{list=background #FFFFFF, surface #F4F4F5/)
  assert.match(section, /brief\.uiux\.aim\.ratio\{background=60,surface=30,accent=10\}/, 'the ratio goes out under the "target" key')
  assert.match(section, /brief\.uiux\.aim\.shadows\{list=button brief\.uiux\.value\.none; card 0 2 6 0 #000000 @20%; popover brief\.uiux\.value\.none\}/)
  assert.match(section, /brief\.uiux\.aim\.type\{list=heading Inter, sans-serif, 24px \/ 1\.3, 700; body /)
  assert.match(section, /brief\.uiux\.aim\.box\{radius=8,px=12,py=8,gap=8,density=comfortable,minWidth=96,maxWidth=brief\.uiux\.unset\}/)
  assert.match(section, /### brief\.uiux\.preserve\n- Keep the sidebar layout/)
  assert.match(section, /### brief\.uiux\.locks\n- colors\.danger/)
  // visual and runtime checks are separate groups; unverified stays unverified
  const visual = section.indexOf('brief.uiux.checks.visual')
  const runtime = section.indexOf('brief.uiux.checks.runtime')
  assert.ok(visual > 0 && runtime > visual)
  assert.match(section.slice(visual, runtime), /Text contrast — brief\.uiux\.status\.unverified/)
  assert.match(section.slice(visual, runtime), /Alignment — brief\.uiux\.status\.pass/)
  assert.match(section.slice(runtime), /Keyboard focus ring — brief\.uiux\.status\.unverified: needs the running app/)
  assert.match(section, /### brief\.uiux\.conflicts\n- Memo asks for red/)
  assert.match(section, /brief\.uiux\.preview\{file=design-preview\.png\}\nbrief\.uiux\.done/)
  assert.doesNotMatch(section, /<[a-z/]/i, 'no HTML')
})

test('scope variants: all, component, and annotations with nothing to link', () => {
  const lines = (scope: DesignRequest['scope'], annotations: Annotation[] = []): string => uiuxBriefLines(request({ scope }), annotations, echo).join('\n')
  assert.match(lines({ kind: 'all' }), /- brief\.uiux\.scope\.all\n/)
  assert.match(lines({ kind: 'component', component: 'card' }), /brief\.uiux\.scope\.component\{component=brief\.uiux\.component\.card\}/)
  assert.match(lines({ kind: 'annotations', annotationIds: ['x'] }, [A('a', 1)]), /refs=brief\.uiux\.scope\.unlinked\}/)
  assert.match(lines({ kind: 'annotations' }), /refs=brief\.uiux\.scope\.unlinked\}/)
  assert.match(lines({ kind: 'annotations', annotationIds: ['a'] }, [A(undefined, 1), A('a', 2)]), /refs=②\}/, 'an annotation without id never matches by position')
})

test('without a mock-up the section says so only when one was sent and rejected', () => {
  const text = (o: Parameters<typeof uiuxBriefLines>[3]): string => uiuxBriefLines(request(), [], echo, o).join('\n')
  assert.doesNotMatch(text({}), /brief\.uiux\.preview/)
  assert.match(text({ previewMissing: true }), /brief\.uiux\.previewMissing/)
  assert.match(text({}), /brief\.uiux\.done/, 'the "re-capture before done" line is always there')
})

test('a brief without guidance is byte-for-byte the old brief', () => {
  const p = basePayload({ memo: '버튼 키워 줘', annotations: [A('a1', 1)] })
  const plain = buildBrief(p, 'annotated.png', null, { t: echo })
  assert.equal(buildBrief({ ...p, uiux: undefined }, 'annotated.png', null, { t: echo }), plain)
  assert.doesNotMatch(plain, /uiux/)
  // the old output ends right after the interpretation block, as before
  assert.ok(plain.endsWith('- brief.interp.coords\n'))
  // and with guidance the old text is a strict subsequence: only the section is inserted
  const withG = buildBrief({ ...p, uiux: { request: request() } }, 'annotated.png', null, { t: echo })
  const at = withG.indexOf('## brief.uiux.heading')
  const after = withG.indexOf('## brief.interp.heading')
  assert.equal(withG.slice(0, at) + withG.slice(after), plain)
})

test('odd values in the request stay on one line and cannot add markup', () => {
  const r = request({ projectName: 'A\n## injected <b>x</b>', preserve: ['line1\nline2'], changes: [{ path: 'type.body.family', from: 'a\nb', to: undefined }] })
  const text = uiuxBriefLines(r, [], echo).join('\n')
  assert.doesNotMatch(text, /\n## injected/)
  assert.doesNotMatch(text, /<b>/)
  assert.match(text, /- line1 \/ line2/)
  assert.match(text, /- type\.body\.family: a \/ b → brief\.uiux\.unset/)
})

test('every message key of the section exists in en.json or in the staging file', () => {
  const used = new Set<string>()
  const params = new Map<string, string[]>()
  const spy: Translate = (key, p) => {
    used.add(key)
    params.set(key, Object.keys(p ?? {}).sort())
    return echo(key, p)
  }
  const full = request({ scope: { kind: 'component', component: 'button' }, previewRef: 'design-preview.png' })
  for (const o of [{ previewFileName: 'design-preview.png' }, { previewMissing: true }]) uiuxBriefLines(full, [], spy, o)
  uiuxBriefLines(request({ scope: { kind: 'annotations', annotationIds: ['q'] }, overviewBasis: 'imported', overviewRevision: undefined }), [], spy)
  uiuxBriefLines(request({ overviewBasis: 'agent', skill: { id: 'x', name: 'n', source: 'agent' } }), [], spy)
  uiuxBriefLines(request({ skill: { id: 'x', name: 'n', source: 'imported' } }), [], spy)
  for (const c of ['card', 'input', 'table'] as const) uiuxBriefLines(request({ scope: { kind: 'component', component: c } }), [], spy)
  uiuxBriefLines(request({ checks: [{ id: 'f', kind: 'visual', label: 'l', status: 'fail' }] }), [], spy)

  const en = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const stagingFile = 'D:/backseat-demo-run/uiux-locales/package.json'
  const staged = existsSync(stagingFile) ? (JSON.parse(readFileSync(stagingFile, 'utf8')) as Record<string, { en: string }>) : {}
  const known: Record<string, string> = { ...Object.fromEntries(Object.entries(staged).map(([k, v]) => [k, v.en])), ...en }
  const missing = [...used].filter((k) => !(k in known))
  // keys can only be missing if neither en.json nor the staging file (merged later) has them; skip when neither is readable
  if (Object.keys(staged).length > 0 || [...used].some((k) => k in en)) assert.deepEqual(missing, [])
  for (const key of used) {
    const template = known[key]
    if (template === undefined) continue
    const inTemplate = [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
    assert.deepEqual(inTemplate, params.get(key), `${key}: placeholders match the call`)
  }
})

test('without project rules the brief lists only what changes or is locked, and says to keep the rest', () => {
  const r = request({ rulesRevision: undefined, changes: [{ path: 'colors.primary', from: '#2F5BEA', to: '#0F766E' }], locks: [] })
  const text = uiuxBriefLines(r, [], echo).join('\n')
  assert.match(text, /brief\.uiux\.aim\.touched/)
  assert.match(text, /brief\.uiux\.aim\.colors\{list=primary #[0-9A-F]{6}\}/, 'only the changed colour role')
  assert.doesNotMatch(text, /brief\.uiux\.aim\.(type|box|shadows)\{/, 'untouched areas are not targets')
  assert.match(text, /brief\.uiux\.keepRest/)
  const withRules = uiuxBriefLines({ ...r, rulesRevision: 2 }, [], echo).join('\n')
  assert.match(withRules, /brief\.uiux\.aim\.rules\{revision=2\}/, 'saved rules are named as the target')
  assert.match(withRules, /brief\.uiux\.aim\.type\{/)
  assert.doesNotMatch(withRules, /brief\.uiux\.keepRest/)
})
