// End-to-end check of the built backseat-mcp server with the official MCP client.
// usage: node scripts/mcp-check.mjs <sessionsRoot>
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = process.argv[2]
if (!root) throw new Error('usage: mcp-check.mjs <sessionsRoot>')

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, '..', 'out', 'main', 'mcp-server.js')],
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

await client.close()
console.log('MCP_OK')
