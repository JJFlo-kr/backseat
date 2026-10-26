// Contract check of the built backseat-mcp server with the official MCP client.
// usage: node scripts/mcp-check.mjs [sessionsRoot] [path/to/mcp-server.js]
// Seeds its own session packages into sessionsRoot (a fresh temp folder when omitted), asserts every
// answer and exits 1 on the first broken contract. MCP_OK is printed only when everything held.
// The UI/UX job tools run against a throw-away app folder (env BACKSEAT_USER_DATA, which exists for tests like this
// one only): the job files are written the way the app's UiuxStore writes them (jobs/<jobId>.json + .input.json).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises'

const here = dirname(fileURLToPath(import.meta.url))
const root = process.argv[2] ?? (await mkdtemp(join(tmpdir(), 'backseat-mcp-check-')))
const serverPath = process.argv[3] ?? join(here, '..', 'out', 'main', 'mcp-server.js')

const failures = []
function check(cond, what, detail = '') {
  if (cond) return true
  failures.push(detail ? `${what}: ${detail}` : what)
  console.log(`FAIL ${what}${detail ? ` (${detail})` : ''}`)
  return false
}
function finish() {
  if (failures.length > 0) {
    console.log(`MCP_FAILED ${failures.length} contract(s) broken`)
    process.exit(1)
  }
  console.log('MCP_OK')
  process.exit(0)
}
// A hanging server is a failure too.
setTimeout(() => {
  check(false, 'overall timeout (60 s)')
  finish()
}, 60_000).unref()

// ---------- fixtures: packages published the way the app does it (staging folder, then rename) ----------

// 1x1 PNGs that differ, so the check can tell annotated.png from screenshot.png.
const PNG_ANNOTATED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
const PNG_ORIGINAL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

let seq = 0
async function publish(marker, meta = {}, designPreview = null) {
  const now = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  const id = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${p(now.getMilliseconds(), 3)}-c${p(seq++, 3)}`
  const staging = join(root, `.writing-${id}`)
  await mkdir(staging, { recursive: true })
  const files = ['annotated.png', 'screenshot.png', 'brief.md', 'meta.json']
  await writeFile(join(staging, 'annotated.png'), PNG_ANNOTATED)
  await writeFile(join(staging, 'screenshot.png'), PNG_ORIGINAL)
  await writeFile(join(staging, 'brief.md'), `# Backseat brief\n\n${marker}\n\n① 번호 1 (10,10)\n🗣 "여기"\n`, 'utf8')
  if (designPreview) {
    await writeFile(join(staging, 'design-preview.png'), designPreview)
    files.push('design-preview.png')
  }
  await writeFile(join(staging, 'meta.json'), JSON.stringify({ id, memo: marker, files, ...meta }), 'utf8')
  await rename(staging, join(root, id))
  return id
}

const texts = (r) => (r?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
const images = (r) => (r?.content ?? []).filter((c) => c.type === 'image')
const sameBytes = (img, buf) => img?.mimeType === 'image/png' && Buffer.from(img.data ?? '', 'base64').equals(buf)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const userData = await mkdtemp(join(tmpdir(), 'backseat-mcp-userdata-'))
await writeFile(join(userData, 'config.json'), JSON.stringify({ briefLocale: 'en' }), 'utf8')

await mkdir(root, { recursive: true })
const seedId = await publish('SEED-PACKAGE')

// ---------- the server ----------

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, BACKSEAT_SESSIONS: root, BACKSEAT_USER_DATA: userData }
})
const client = new Client({ name: 'mcp-check', version: '0.0.2' })
await client.connect(transport)

const EXPECTED_TOOLS = ['backseat_register', 'backseat_latest', 'backseat_list', 'backseat_get', 'backseat_wait', 'backseat_ask', 'backseat_agents']
const tools = (await client.listTools()).tools.map((t) => t.name)
console.log('TOOLS', tools.join(','))
for (const name of EXPECTED_TOOLS) check(tools.includes(name), `tool ${name} listed`)
const JOB_TOOLS = ['backseat_job_get', 'backseat_job_submit', 'backseat_job_status']
for (const name of JOB_TOOLS) check(tools.includes(name), `tool ${name} listed`)

const cwd = join(root, 'project-under-check')
await client.callTool({ name: 'backseat_register', arguments: { name: 'mcp-check', cwd, kind: 'test' } })
const agents = JSON.parse(texts(await client.callTool({ name: 'backseat_agents', arguments: {} })) || '[]')
const me = Array.isArray(agents) ? agents.find((a) => a.name === 'mcp-check' && a.cwd === cwd) : undefined
check(Boolean(me), 'backseat_register is visible in backseat_agents', JSON.stringify(agents).slice(0, 120))
console.log('AGENTS', Array.isArray(agents) ? agents.length : 'invalid')

const latest = await client.callTool({ name: 'backseat_latest', arguments: {} })
check(texts(latest).includes('SEED-PACKAGE'), 'backseat_latest returns the latest brief')
check(images(latest).length === 1 && sameBytes(images(latest)[0], PNG_ANNOTATED), 'backseat_latest attaches annotated.png (image/png, exact bytes)', `${images(latest).length} image(s)`)
const withOrig = await client.callTool({ name: 'backseat_latest', arguments: { includeOriginal: true } })
check(images(withOrig).length === 2 && sameBytes(images(withOrig)[0], PNG_ANNOTATED) && sameBytes(images(withOrig)[1], PNG_ORIGINAL),
  'includeOriginal adds screenshot.png after annotated.png', `${images(withOrig).length} image(s)`)
const textOnly = await client.callTool({ name: 'backseat_latest', arguments: { includeImage: false } })
check(images(textOnly).length === 0 && texts(textOnly).includes('SEED-PACKAGE'), 'includeImage:false returns the brief only')
console.log('LATEST', latest.content?.map((c) => c.type).join('+'))

check(texts(await client.callTool({ name: 'backseat_list', arguments: { limit: 5 } })).includes(seedId), 'backseat_list lists the package id')
const got = await client.callTool({ name: 'backseat_get', arguments: { id: seedId } })
check(texts(got).includes('SEED-PACKAGE') && images(got).length === 1, 'backseat_get returns the package by id')
const missing = await client.callTool({ name: 'backseat_get', arguments: { id: '20000101-000000-none' } })
check(missing.isError === true, 'backseat_get of an unknown id is an error')

// Fetch receipts (phase 4): every package handed out leaves receipts/<id>/<agent>-*.json naming this agent,
// the tool and the exact id; nothing for an unknown id.
async function receipts(id) {
  try {
    const dir = join(root, 'receipts', id)
    const names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
    return Promise.all(names.map(async (n) => JSON.parse(await readFile(join(dir, n), 'utf8'))))
  } catch {
    return []
  }
}
const seedReceipts = await receipts(seedId)
const viaGet = seedReceipts.find((r) => r.tool === 'backseat_get')
check(Boolean(viaGet), 'backseat_get leaves a fetch receipt for that send id', `${seedReceipts.length} receipt(s)`)
check(viaGet?.sendId === seedId && viaGet?.agentId === me?.id && viaGet?.name === 'mcp-check' && viaGet?.cwd === cwd,
  'the receipt names the exact send id and the registered agent', JSON.stringify(viaGet ?? {}).slice(0, 160))
check(seedReceipts.some((r) => r.tool === 'backseat_latest'), 'backseat_latest leaves a receipt too')
check((await receipts('20000101-000000-none')).length === 0, 'no receipt for an unknown id')
console.log('RECEIPTS', seedReceipts.map((r) => r.tool).join(','))

// wait: an existing package is not "new"; a short timeout returns (no hang, no image).
let t0 = Date.now()
const timedOut = await client.callTool({ name: 'backseat_wait', arguments: { timeoutSec: 1 } })
const waited = Date.now() - t0
check(waited >= 900 && waited < 5000, 'backseat_wait honours timeoutSec', `${waited} ms`)
check(images(timedOut).length === 0 && !texts(timedOut).includes('SEED-PACKAGE'), 'backseat_wait does not return an old package')
console.log('WAIT', `${Math.round(waited / 100) / 10}s`)

// wait: a package addressed to another agent is skipped; the next one for anyone is returned.
const waitNew = client.callTool({ name: 'backseat_wait', arguments: { timeoutSec: 20 } })
await sleep(600)
await publish('FOR-ANOTHER-AGENT', { recipient: { agentId: '999999999', name: 'other', cwd: 'D:/elsewhere' } })
await sleep(1500)
await publish('NEW-PACKAGE')
const newPkg = await waitNew
check(texts(newPkg).includes('NEW-PACKAGE'), 'backseat_wait returns the next package (and skips one addressed to another agent)', texts(newPkg).slice(0, 80))
check(images(newPkg).length === 1, 'backseat_wait attaches annotated.png')
const otherId = (await readdir(root)).find((n) => n.endsWith('-c001'))
check(Boolean(otherId) && (await receipts(otherId)).length === 0, 'a package skipped for another agent gets no receipt')

// ask: writes requests/<id>.json, ignores unrelated packages, resolves with the answer carrying requestId.
const question = '어느 버튼이 문제인지 표시해 주세요'
const askPromise = client.callTool({ name: 'backseat_ask', arguments: { question, timeoutSec: 20 } })
let req = null
for (let i = 0; i < 40 && !req; i++) {
  await sleep(100)
  try {
    const names = (await readdir(join(root, 'requests'))).filter((f) => f.endsWith('.json'))
    if (names.length) req = JSON.parse(await readFile(join(root, 'requests', names.sort().at(-1)), 'utf8'))
  } catch {
    /* not written yet */
  }
}
check(Boolean(req), 'backseat_ask writes requests/<id>.json')
if (req) {
  check(req.question === question, 'request carries the question')
  check(req.agent === 'mcp-check', 'request names the registered agent', String(req.agent))
  check(typeof req.requestId === 'string' && req.requestId.length > 0, 'request has a requestId')
  await publish('UNRELATED-PACKAGE')
  await sleep(1500)
  await publish('ASK-ANSWER', { requestId: req.requestId })
  const ans = await askPromise
  check(texts(ans).includes('ASK-ANSWER') && !texts(ans).includes('UNRELATED-PACKAGE'), 'backseat_ask resolves with the package that answers its requestId', texts(ans).slice(0, 80))
  console.log('ASK', texts(ans).includes('ASK-ANSWER') ? 'answered' : 'wrong answer')
}

// ---------- design-preview.png on backseat_get / backseat_latest (optional, default off) ----------

const PNG_PREVIEW = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const previewId = await publish('PREVIEW-PACKAGE', {}, PNG_PREVIEW)
const noPreview = await client.callTool({ name: 'backseat_get', arguments: { id: previewId } })
check(images(noPreview).length === 1 && sameBytes(images(noPreview)[0], PNG_ANNOTATED), 'backseat_get without includeDesignPreview attaches annotated.png only', `${images(noPreview).length} image(s)`)
const withPreview = await client.callTool({ name: 'backseat_get', arguments: { id: previewId, includeDesignPreview: true } })
check(images(withPreview).length === 2 && sameBytes(images(withPreview)[0], PNG_ANNOTATED) && sameBytes(images(withPreview)[1], PNG_PREVIEW),
  'includeDesignPreview adds design-preview.png after annotated.png', `${images(withPreview).length} image(s)`)
check(texts(withPreview).includes('PREVIEW-PACKAGE'), 'the brief text is still returned with the preview')
const latestPreview = await client.callTool({ name: 'backseat_latest', arguments: { includeDesignPreview: true } })
check(images(latestPreview).length === 2 && sameBytes(images(latestPreview)[1], PNG_PREVIEW), 'backseat_latest accepts includeDesignPreview too')

// ---------- UI/UX jobs: a real round trip with the official client ----------

const jobsDir = join(userData, 'uiux', 'jobs')
async function createJob(type, fields = {}, input = { ask: type }) {
  const jobId = `job-check-${seq++}-${Date.now().toString(36)}`
  const t = Date.now()
  const job = {
    schemaVersion: 1, jobId, type, projectId: 'check-1', inputRevision: 3, status: 'pending',
    createdAt: new Date(t).toISOString(), updatedAt: new Date(t).toISOString(), expiresAt: new Date(t + 5 * 60_000).toISOString(), ...fields
  }
  await mkdir(jobsDir, { recursive: true })
  await writeFile(join(jobsDir, `${jobId}.input.json`), JSON.stringify(input), 'utf8')
  await writeFile(join(jobsDir, `${jobId}.json`), JSON.stringify(job), 'utf8')
  return job
}
const readJob = async (jobId) => JSON.parse(await readFile(join(jobsDir, `${jobId}.json`), 'utf8'))
const parts = (r) => (r?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text)
const tail = (r) => {
  const t = parts(r)
  const last = t[0] ?? ''
  try {
    return JSON.parse(last.slice(last.lastIndexOf('\n\n{') + 2))
  } catch {
    return {}
  }
}

try {
  const overview = {
    projectId: 'check-1',
    summary: { value: 'A task tracker', source: 'user' },
    purpose: { value: 'Keep tasks in one place', source: 'user' },
    goals: [], audiences: [{ value: 'team leads', source: 'user' }],
    workflows: [{ id: 'w1', name: 'Add a task', steps: ['open', 'type'], source: 'user' }],
    architecture: { nodes: [{ id: 'home', type: 'screen', label: 'Home', source: 'verified', evidence: [{ path: 'index.html' }] }], edges: [] },
    stack: [], designState: [], designConstraints: [], sources: [], unknowns: []
  }
  const job = await createJob('project_overview', {}, { project: { name: 'Check' } })
  const got = await client.callTool({ name: 'backseat_job_get', arguments: { jobId: job.jobId } })
  const gotMeta = tail(got)
  check(gotMeta.jobId === job.jobId && gotMeta.type === 'project_overview' && gotMeta.status === 'fetched' && gotMeta.inputRevision === 3 && gotMeta.expiresAt === job.expiresAt,
    'backseat_job_get returns the job (type, project, status, deadline)', JSON.stringify(gotMeta).slice(0, 160))
  check(parts(got).length === 3 && parts(got)[1].includes('"project"') && parts(got)[2].includes('"required"'), 'backseat_job_get returns the input and the result schema')
  const afterGet = await readJob(job.jobId)
  check(afterGet.status === 'fetched' && Boolean(afterGet.fetchedAt), 'job_get marks the job fetched (status and fetchedAt on disk)', afterGet.status)

  const progress = await client.callTool({ name: 'backseat_job_status', arguments: { jobId: job.jobId, status: 'in_progress', message: 'reading' } })
  check(tail(progress).status === 'fetched', 'backseat_job_status in_progress answers with the current status', JSON.stringify(tail(progress)).slice(0, 120))

  const bad = await client.callTool({ name: 'backseat_job_submit', arguments: { jobId: job.jobId, inputRevision: 3, result: { ...overview, projectId: 'other-9' } } })
  check(bad.isError === true && tail(bad).status === 'rejected' && JSON.stringify(tail(bad).errors).includes('other-9'), 'a result for another project is rejected with the error list')
  check((await readJob(job.jobId)).status === 'rejected', 'a rejected result sets the job to rejected on disk')
  const stale = await client.callTool({ name: 'backseat_job_submit', arguments: { jobId: job.jobId, inputRevision: 2, result: overview } })
  check(stale.isError === true && tail(stale).status === 'stale', 'a wrong inputRevision is refused as stale')
  const ok = await client.callTool({ name: 'backseat_job_submit', arguments: { jobId: job.jobId, inputRevision: 3, result: overview } })
  check(ok.isError !== true && tail(ok).status === 'submitted' && tail(ok).completeness?.complete === true, 'the corrected result is accepted (complete)', parts(ok)[0]?.slice(0, 200))
  const done = await readJob(job.jobId)
  check(done.status === 'submitted' && done.resultRef === `${job.jobId}.result.json`, 'the job is submitted with a resultRef on disk', done.status)
  const stored = JSON.parse(await readFile(join(jobsDir, `${job.jobId}.result.json`), 'utf8'))
  check(stored.type === 'project_overview' && stored.projectId === 'check-1' && stored.overview?.summary?.value === 'A task tracker', 'the result file holds the validated overview')
  const dup = await client.callTool({ name: 'backseat_job_submit', arguments: { jobId: job.jobId, inputRevision: 3, result: overview } })
  check(dup.isError !== true && tail(dup).duplicate === true, 'the same result again is a duplicate with the same outcome')
  check(parts(await client.callTool({ name: 'backseat_job_get', arguments: { jobId: job.jobId } })).length === 1, 'a finished job is reported, not reopened')

  // incomplete overview: stored, the reply names the gaps
  const weakJob = await createJob('project_overview')
  const weak = await client.callTool({ name: 'backseat_job_submit', arguments: { jobId: weakJob.jobId, inputRevision: 3, result: { ...overview, workflows: [] } } })
  check(weak.isError !== true && tail(weak).completeness?.complete === false && tail(weak).completeness?.gaps?.includes('workflows'), 'an incomplete overview is stored and the reply lists the gaps')

  // cancelled: the agent is told to stop, nothing is stored
  const cancelled = await createJob('capabilities', { status: 'cancelled' })
  const cs = await client.callTool({ name: 'backseat_job_status', arguments: { jobId: cancelled.jobId, status: 'in_progress' } })
  check(tail(cs).status === 'cancelled', 'job_status reports cancelled so the agent stops')
  const cu = await client.callTool({ name: 'backseat_job_submit', arguments: { jobId: cancelled.jobId, inputRevision: 3, result: { skills: [] } } })
  check(cu.isError === true && tail(cu).status === 'cancelled', 'a cancelled job takes no result')
  const none = await client.callTool({ name: 'backseat_job_get', arguments: { jobId: 'job-does-not-exist' } })
  check(none.isError === true && tail(none).status === 'not_found', 'an unknown job id is an error')

  // failure report
  const failing = await createJob('style_audit')
  const fr = await client.callTool({ name: 'backseat_job_status', arguments: { jobId: failing.jobId, status: 'failed', message: 'no access' } })
  const failed = await readJob(failing.jobId)
  check(tail(fr).status === 'failed' && failed.status === 'failed' && failed.error === 'no access', 'job_status failed stores the message')

  // design proposals with a mock-up
  const tokens = {
    colors: { background: '#FFFFFF', surface: '#F5F5F7', text: '#1B1B1F', textMuted: '#5E5E6A', primary: '#2F5BEA', onPrimary: '#FFFFFF', border: '#DADAE0', success: '#1E8A55', warning: '#A86A00', danger: '#C9353A', info: '#2F80ED' },
    ratio: { background: 60, surface: 30, accent: 10 },
    shadows: { button: null, card: null, popover: null },
    type: Object.fromEntries(['heading', 'body', 'numeric'].map((r) => [r, { family: 'Pretendard', fallback: 'sans-serif', size: 16, weight: 400, lineHeight: 1.5 }])),
    box: { radius: 8, paddingX: 16, paddingY: 10, gap: 12, density: 'comfortable' }
  }
  const proposalJob = await createJob('design_proposal')
  const proposal = (id, extra = {}) => ({ proposalId: id, projectId: 'check-1', direction: 'A', name: `Variant ${id}`, rationale: 'r', tokens, changes: [], preserved: [], checks: [], ...extra })
  const badImage = await client.callTool({ name: 'backseat_job_submit', arguments: { jobId: proposalJob.jobId, inputRevision: 3, result: { proposals: [proposal('A', { previewPngBase64: Buffer.from('not a png at all, just text, long enough to pass the length check').toString('base64') })] } } })
  check(badImage.isError === true && JSON.stringify(tail(badImage).errors).includes('previewPngBase64'), 'a mock-up that is not a PNG is rejected')
  const goodProposals = await client.callTool({ name: 'backseat_job_submit', arguments: { jobId: proposalJob.jobId, inputRevision: 3, result: { proposals: [proposal('A', { previewPngBase64: PNG_PREVIEW.toString('base64') }), proposal('B'), proposal('A')] } } })
  check(goodProposals.isError !== true && JSON.stringify(tail(goodProposals).proposalIds) === '["A","B"]' && JSON.stringify(tail(goodProposals).dedupedProposalIds) === '["A"]', 'proposals are accepted, duplicates by proposalId dropped', parts(goodProposals)[0]?.slice(0, 200))
  const mock = await readFile(join(jobsDir, `${proposalJob.jobId}.A.png`)).catch(() => null)
  check(Boolean(mock) && mock.equals(PNG_PREVIEW), 'the mock-up is stored next to the job result, by file name')
} catch (err) {
  check(false, 'UI/UX job round trip', String(err?.stack ?? err).slice(0, 300))
}

await client.close()
finish()
