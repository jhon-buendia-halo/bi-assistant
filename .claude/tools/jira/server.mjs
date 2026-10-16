#!/usr/bin/env node
// The `jira` MCP server (BA-237): newline-delimited JSON-RPC 2.0 over stdio,
// as the MCP stdio transport defines it. Registered in the repo's .mcp.json.
import { realpathSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { TOOLS, callTool } from './lib.mjs'

const SERVER = { name: 'jira', version: '1.0.0' }
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']

/** Answer one JSON-RPC message; `null` for a notification. */
export async function handle(msg, opts = {}) {
  const { id, method, params } = msg ?? {}
  const reply = result => ({ jsonrpc: '2.0', id, result })
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
  if (msg?.jsonrpc !== '2.0' || typeof method !== 'string') return id === undefined ? null : fail(-32600, 'Invalid Request')
  if (id === undefined) return null // notifications/initialized, notifications/cancelled, …
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return reply({
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions:
          'Jira Cloud for this repo: epics, stories, bugs. Load the `jira` skill before using these tools. Never create, comment or transition without the user\'s yes.',
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({
        tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
      })
    case 'tools/call':
      return reply(await callTool(params?.name, params?.arguments, opts))
    default:
      return fail(-32601, `Method not found: ${method}`)
  }
}

const isMain = () => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (isMain()) {
  const send = obj => process.stdout.write(`${JSON.stringify(obj)}\n`)
  createInterface({ input: process.stdin }).on('line', async line => {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    const out = await handle(msg)
    if (out) send(out)
  })
}
