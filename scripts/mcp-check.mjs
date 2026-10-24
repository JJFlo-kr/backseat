// End-to-end check of the built backseat-mcp server with the official MCP client.
// usage: node scripts/mcp-check.mjs <sessionsRoot> [path/to/mcp-server.js]
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = process.argv[2]
if (!root) throw new Error('usage: mcp-check.mjs <sessionsRoot>')

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.argv[3] ?? join(here, '..', 'out', 'main', 'mcp-server.js')],
  env: { ...process.env, BACKSEAT_SESSIONS: root }
})
const client = new Client({ name: 'mcp-check', version: '0.0.1' })
await client.connect(transport)

const tools = await client.listTools()
console.log('TOOLS', tools.tools.map((t) => t.name).join(','))

const reg = await client.callTool({ name: 'backseat_register', arguments: { name: 'mcp-check', cwd: 'D:/backseat', kind: 'test' } })
console.log('REGISTER', reg.content[0].text)

const list = await client.callTool({ name: 'backseat_list', arguments: { limit: 5 } })
console.log('LIST', list.content[0].text.split('\n').length, 'lines')

const latest = await client.callTool({ name: 'backseat_latest', arguments: {} })
const kinds = latest.content.map((c) => c.type).join('+')
const text = latest.content.find((c) => c.type === 'text')?.text ?? ''
console.log('LATEST', kinds, 'brief chars', text.length, 'has🗣', text.includes('🗣'))

const agents = await client.callTool({ name: 'backseat_agents', arguments: {} })
console.log('AGENTS', JSON.parse(agents.content[0].text).length)

// wait with a short timeout: must return the timeout message, not hang
const t0 = Date.now()
const w = await client.callTool({ name: 'backseat_wait', arguments: { timeoutSec: 1 } })
console.log('WAIT', Math.round((Date.now() - t0) / 100) / 10 + 's', w.content[0].text.slice(0, 30))

// ask round trip: the server writes requests/<id>.json; we play the app and answer with a package
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
const askPromise = client.callTool({ name: 'backseat_ask', arguments: { question: '어느 버튼이 문제인지 표시해 주세요', timeoutSec: 15 } })
await new Promise((r) => setTimeout(r, 800))
const reqDir = join(root, 'requests')
const reqFiles = (await readdir(reqDir)).filter((f) => f.endsWith('.json'))
const req = JSON.parse(await readFile(join(reqDir, reqFiles[reqFiles.length - 1]), 'utf8'))
console.log('REQUEST', req.question === '어느 버튼이 문제인지 표시해 주세요' ? 'written' : 'mismatch', req.agent)
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/^(\d{8})(\d{6}).*/, '$1-$2')
const dir = join(root, stamp + '-ask')
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'brief.md'), `# answer\n\n> ${req.question}\n\n① 번호 1 (10,10)\n`, 'utf8')
await writeFile(join(dir, 'meta.json'), JSON.stringify({ id: stamp, requestId: req.requestId, files: ['brief.md', 'meta.json'] }), 'utf8')
const ans = await askPromise
const ansText = ans.content.find((c) => c.type === 'text')?.text ?? ''
console.log('ASK', ansText.includes('# answer') ? 'resolved with the answer package' : 'unexpected: ' + ansText.slice(0, 60))

await client.close()
console.log('MCP_OK')
