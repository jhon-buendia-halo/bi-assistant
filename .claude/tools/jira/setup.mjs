#!/usr/bin/env node
// Writes the JIRA_* credentials for the `jira` MCP server (BA-237). Run it in
// your own terminal: the token is read silently and never passes through Claude.
//   node .claude/tools/jira/setup.mjs https://<site>.atlassian.net <email> <PROJECT-KEY>
// Writes the main checkout's .env (mode 0600, only the JIRA_* lines change),
// or JIRA_CONFIG_FILE when set, then verifies with whoami.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { callTool, mainCheckout } from './lib.mjs'

const [baseUrl, email, project] = process.argv.slice(2)
if (!baseUrl || !email || !project) {
  console.error('usage: node .claude/tools/jira/setup.mjs <base-url> <email> <project-key>')
  process.exit(1)
}

async function readToken() {
  if (process.env.JIRA_API_TOKEN) return process.env.JIRA_API_TOKEN
  if (!process.stdin.isTTY) return readFileSync(0, 'utf8').trim()
  process.stderr.write('Jira API token: ')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  let token = ''
  for await (const chunk of process.stdin) {
    for (const ch of chunk.toString('utf8')) {
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stderr.write('\n')
        return token
      }
      if (ch === '\u0003') process.exit(130)
      token = ch === '\u007f' ? token.slice(0, -1) : token + ch
    }
  }
  return token
}

const token = (await readToken()).trim()
if (!token) {
  console.error('no token given')
  process.exit(1)
}

const file = process.env.JIRA_CONFIG_FILE || join(mainCheckout(), '.env')
const keep = existsSync(file)
  ? readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(l => l && !/^(JIRA_BASE_URL|JIRA_EMAIL|JIRA_API_TOKEN|JIRA_PROJECT)=/.test(l))
  : []
const lines = [
  ...keep,
  `JIRA_BASE_URL=${baseUrl.replace(/\/+$/, '')}`,
  `JIRA_EMAIL=${email}`,
  `JIRA_API_TOKEN=${token}`,
  `JIRA_PROJECT=${project}`,
]
writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 })
chmodSync(file, 0o600)
console.log(`wrote ${file}`)

const check = await callTool('whoami', {}, { env: { JIRA_CONFIG_FILE: file } })
console.log(check.content[0].text)
process.exit(check.isError ? 1 : 0)
