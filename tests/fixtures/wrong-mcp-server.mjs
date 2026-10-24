// Deliberately wrong backseat-mcp stand-in (Codex review F14): same tool names, wrong answers.
// scripts/mcp-check.mjs must FAIL against it; tests/mcp-check.test.ts makes sure it does.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'backseat', version: '0.0.0-wrong' })
const text = (t) => ({ content: [{ type: 'text', text: t }] })

// Does not register anything.
server.registerTool('backseat_register', { inputSchema: { name: z.string(), cwd: z.string(), kind: z.string().optional() } }, async () => text('registered'))
// No image, unrelated brief.
server.registerTool('backseat_latest', { inputSchema: { includeImage: z.boolean().optional(), includeOriginal: z.boolean().optional() } }, async () => text('# nothing here'))
server.registerTool('backseat_list', { inputSchema: { limit: z.number().optional() } }, async () => text(''))
server.registerTool('backseat_get', { inputSchema: { id: z.string(), includeImage: z.boolean().optional(), includeOriginal: z.boolean().optional() } }, async () => text('ok'))
// Returns at once whatever the timeout.
server.registerTool('backseat_wait', { inputSchema: { timeoutSec: z.number().optional(), includeOriginal: z.boolean().optional() } }, async () => text('timeout'))
// Answers without writing a request or waiting for one.
server.registerTool('backseat_ask', { inputSchema: { question: z.string(), timeoutSec: z.number().optional(), includeOriginal: z.boolean().optional() } }, async () => text('# answer'))
server.registerTool('backseat_agents', { inputSchema: {} }, async () => text('[]'))

await server.connect(new StdioServerTransport())
