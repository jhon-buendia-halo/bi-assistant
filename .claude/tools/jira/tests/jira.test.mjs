// node --test .claude/tools/jira/tests/   (no network: fetch is faked)
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { adf, adfText, callTool, configFiles, loadConfig, parseEnvFile } from '../lib.mjs'
import { handle } from '../server.mjs'

const ENV = {
  JIRA_BASE_URL: 'https://example.atlassian.net/',
  JIRA_EMAIL: 'dev@example.com',
  JIRA_API_TOKEN: 'secret',
  JIRA_PROJECT: 'BA',
  JIRA_CONFIG_FILE: '/nonexistent/.env',
}

/** A fake Jira: routes are `METHOD path` → body (or a function of the request). Records every call. */
function fakeJira(routes) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const path = url.replace('https://example.atlassian.net', '')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method: init.method, path, body, headers: init.headers })
    const key = `${init.method} ${path.split('?')[0]}`
    if (!(key in routes)) return new Response(JSON.stringify({ errorMessages: [`no route ${key}`] }), { status: 404 })
    const out = typeof routes[key] === 'function' ? routes[key](body) : routes[key]
    const [status, payload] = Array.isArray(out) ? out : [200, out]
    return new Response(payload === undefined ? null : JSON.stringify(payload), { status })
  }
  return { calls, fetchImpl }
}

const issue = (key, type, extra = {}) => ({
  key,
  fields: { summary: `${key} summary`, issuetype: { name: type }, status: { name: 'To Do' }, ...extra },
})
const text = r => r.content[0].text
const json = r => JSON.parse(text(r))

test('ADF round-trips plain text, one paragraph per non-empty line', () => {
  const doc = adf('First\n\nSecond')
  assert.equal(doc.content.length, 2)
  assert.equal(adfText(doc), 'First\nSecond\n')
})

test('config: the environment wins, then the first .env that sets a key; only JIRA_* is read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jira-'))
  const a = join(dir, 'a.env')
  const b = join(dir, 'b.env')
  writeFileSync(a, 'JIRA_EMAIL="a@x"\nOTHER=1\n')
  writeFileSync(b, "JIRA_EMAIL=b@x\nJIRA_BASE_URL='https://b'\n")
  const { config, read } = loadConfig({ JIRA_PROJECT: 'ENV' }, [a, b, join(dir, 'missing.env')])
  assert.deepEqual(config, { JIRA_PROJECT: 'ENV', JIRA_EMAIL: 'a@x', JIRA_BASE_URL: 'https://b' })
  assert.deepEqual(read, [a, b])
  assert.deepEqual(parseEnvFile('OTHER=1\n'), {})
})

test('config: a worktree reads its own .env, then the main checkout\'s; JIRA_CONFIG_FILE replaces both', () => {
  assert.deepEqual(configFiles({}, '/repo/.claude/worktrees/x', '/repo'), ['/repo/.claude/worktrees/x/.env', '/repo/.env'])
  assert.deepEqual(configFiles({}, '/repo', '/repo'), ['/repo/.env'])
  assert.deepEqual(configFiles({ JIRA_CONFIG_FILE: '/c/.env' }, '/repo', '/repo'), ['/c/.env'])
})

test('missing credentials are a tool error that says how to set them up, without calling Jira', async () => {
  const { calls, fetchImpl } = fakeJira({})
  const r = await callTool('whoami', {}, { env: { JIRA_CONFIG_FILE: '/nonexistent/.env' }, fetchImpl })
  assert.equal(r.isError, true)
  assert.match(text(r), /JIRA_BASE_URL is not set .*setup\.mjs/)
  assert.equal(calls.length, 0)
})

test('get_issue reports the parent and its type, for the Epic gate', async () => {
  const { calls, fetchImpl } = fakeJira({
    'GET /rest/api/3/issue/BA-236': issue('BA-236', 'Story', {
      parent: { key: 'BA-119', fields: { summary: 'Harness Adjustments', issuetype: { name: 'Epic' } } },
      description: adf('Line one'),
      comment: { comments: [{ author: { displayName: 'Jhon' }, created: '2026-10-16', body: adf('Hi') }] },
    }),
  })
  const r = json(await callTool('get_issue', { key: 'BA-236' }, { env: ENV, fetchImpl }))
  assert.equal(r.url, 'https://example.atlassian.net/browse/BA-236')
  assert.equal(r.parent, 'BA-119')
  assert.equal(r.parentType, 'Epic')
  assert.equal(r.description, 'Line one')
  assert.deepEqual(r.comments, [{ author: 'Jhon', created: '2026-10-16', body: 'Hi' }])
  assert.match(calls[0].headers.Authorization, /^Basic /)
})

test('create_issue: a Story under an Epic sends the parent and returns the read-back issue', async () => {
  const { calls, fetchImpl } = fakeJira({
    'GET /rest/api/3/issue/BA-119': issue('BA-119', 'Epic'),
    'POST /rest/api/3/issue': [201, { key: 'BA-300' }],
    'GET /rest/api/3/issue/BA-300': issue('BA-300', 'Story', {
      parent: { key: 'BA-119', fields: { issuetype: { name: 'Epic' } } },
    }),
  })
  const r = json(
    await callTool('create_issue', { type: 'Story', summary: 'Do it', description: 'Why\nHow', epic: 'BA-119' }, { env: ENV, fetchImpl }),
  )
  assert.equal(r.key, 'BA-300')
  assert.equal(r.parentType, 'Epic')
  const post = calls.find(c => c.method === 'POST')
  assert.deepEqual(post.body.fields.parent, { key: 'BA-119' })
  assert.deepEqual(post.body.fields.project, { key: 'BA' })
  assert.equal(post.body.fields.issuetype.name, 'Story')
  assert.equal(post.body.fields.description.content.length, 2)
})

test('create_issue refuses a Story without an epic, and a parent that is not an Epic, before creating anything', async () => {
  const { calls, fetchImpl } = fakeJira({ 'GET /rest/api/3/issue/BA-236': issue('BA-236', 'Story') })
  const none = await callTool('create_issue', { type: 'Bug', summary: 'x' }, { env: ENV, fetchImpl })
  assert.equal(none.isError, true)
  assert.match(text(none), /must name its epic/)
  const wrong = await callTool('create_issue', { type: 'Story', summary: 'x', epic: 'BA-236' }, { env: ENV, fetchImpl })
  assert.equal(wrong.isError, true)
  assert.match(text(wrong), /BA-236 is a Story, not an Epic/)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})

test('create_epic creates an Epic in the given project', async () => {
  const { calls, fetchImpl } = fakeJira({
    'POST /rest/api/3/issue': [201, { key: 'QTI-1' }],
    'GET /rest/api/3/issue/QTI-1': issue('QTI-1', 'Epic'),
  })
  const r = json(await callTool('create_epic', { summary: 'New epic', project: 'QTI' }, { env: ENV, fetchImpl }))
  assert.equal(r.type, 'Epic')
  const post = calls.find(c => c.method === 'POST')
  assert.deepEqual(post.body.fields, { project: { key: 'QTI' }, issuetype: { name: 'Epic' }, summary: 'New epic' })
})

test('transition_issue matches a name case-insensitively and reports the new status; unknown names list the options', async () => {
  let status = 'To Do'
  const { fetchImpl } = fakeJira({
    'GET /rest/api/3/issue/BA-1/transitions': { transitions: [{ id: '21', name: 'In Progress', to: { name: 'In Progress' } }] },
    'POST /rest/api/3/issue/BA-1/transitions': body => {
      if (body.transition.id === '21') status = 'In Progress'
      return [204, undefined]
    },
    'GET /rest/api/3/issue/BA-1': () => issue('BA-1', 'Story', { status: { name: status } }),
  })
  const ok = json(await callTool('transition_issue', { key: 'BA-1', transition: 'in progress' }, { env: ENV, fetchImpl }))
  assert.deepEqual([ok.transition, ok.status], ['In Progress', 'In Progress'])
  const bad = await callTool('transition_issue', { key: 'BA-1', transition: 'Done' }, { env: ENV, fetchImpl })
  assert.equal(bad.isError, true)
  assert.match(text(bad), /available: In Progress/)
})

test('update_issue sends only the given fields and checks a new epic first', async () => {
  const { calls, fetchImpl } = fakeJira({
    'GET /rest/api/3/issue/BA-5': issue('BA-5', 'Story'),
    'GET /rest/api/3/issue/BA-119': issue('BA-119', 'Epic'),
    'PUT /rest/api/3/issue/BA-5': [204, undefined],
  })
  const r = json(await callTool('update_issue', { key: 'BA-5', description: 'New text', epic: 'BA-119' }, { env: ENV, fetchImpl }))
  assert.equal(r.key, 'BA-5')
  const put = calls.find(c => c.method === 'PUT')
  assert.deepEqual(Object.keys(put.body.fields).sort(), ['description', 'parent'])
  const wrong = await callTool('update_issue', { key: 'BA-5', epic: 'BA-5' }, { env: ENV, fetchImpl })
  assert.match(text(wrong), /BA-5 is a Story, not an Epic/)
  const empty = await callTool('update_issue', { key: 'BA-5' }, { env: ENV, fetchImpl })
  assert.match(text(empty), /nothing to change/)
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1)
})

test('Jira error messages reach the tool result', async () => {
  const { fetchImpl } = fakeJira({
    'POST /rest/api/3/issue': [400, { errors: { summary: 'You must specify a summary of the issue.' } }],
  })
  const r = await callTool('create_epic', { summary: ' ' }, { env: ENV, fetchImpl })
  assert.equal(r.isError, true)
  assert.match(text(r), /HTTP 400 on POST \/rest\/api\/3\/issue: summary: You must specify/)
})

test('search_issues defaults to the open issues of JIRA_PROJECT', async () => {
  const { calls, fetchImpl } = fakeJira({
    'POST /rest/api/3/search/jql': { issues: [issue('BA-2', 'Epic', { updated: '2026-10-02T10:00:00.000+0000' })] },
  })
  const r = json(await callTool('search_issues', {}, { env: ENV, fetchImpl }))
  assert.equal(calls[0].body.jql, 'project = BA AND statusCategory != Done ORDER BY updated DESC')
  assert.deepEqual(r[0], { key: 'BA-2', type: 'Epic', status: 'To Do', priority: null, assignee: 'unassigned', updated: '2026-10-02', parent: null, summary: 'BA-2 summary' })
})

test('MCP: initialize, tools/list, notifications and unknown methods', async () => {
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } })
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.deepEqual(
    list.result.tools.map(t => t.name),
    ['whoami', 'get_project', 'search_issues', 'get_issue', 'list_statuses', 'list_transitions', 'create_epic', 'create_issue', 'update_issue', 'add_comment', 'transition_issue'],
  )
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object')
  const writes = list.result.tools.filter(t => !t.annotations.readOnlyHint).map(t => t.name)
  assert.deepEqual(writes, ['create_epic', 'create_issue', 'update_issue', 'add_comment', 'transition_issue'])
  const missing = await handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' })
  assert.equal(missing.error.code, -32601)
  const unknown = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })
  assert.equal(unknown.result.isError, true)
})
