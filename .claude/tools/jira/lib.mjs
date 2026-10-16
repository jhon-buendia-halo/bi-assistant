// Jira Cloud REST v3 for the `jira` MCP server (BA-237): config, ADF, and the
// tools Claude calls. No dependencies; `http` is injected so tests need no network.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const KEYS = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT']

/** The repo this file sits in (a worktree's own root inside a worktree). */
export const repoRoot = () => resolve(HERE, '../../..')

/** The main checkout, which holds the gitignored `.env`; a worktree has none. */
export function mainCheckout(root = repoRoot()) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return dirname(common)
  } catch {
    return root
  }
}

/** `.env` files to read, in order: JIRA_CONFIG_FILE, this checkout's, the main checkout's. */
export function configFiles(env = process.env, root = repoRoot(), main = mainCheckout(root)) {
  if (env.JIRA_CONFIG_FILE) return [env.JIRA_CONFIG_FILE]
  return [...new Set([join(root, '.env'), join(main, '.env')])]
}

/** Only `JIRA_*` keys; surrounding quotes dropped. */
export function parseEnvFile(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(JIRA_[A-Z_]+)\s*=(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  }
  return out
}

/** The environment wins; then the first file that sets a key. Read on every call, so setup needs no restart. */
export function loadConfig(env = process.env, files = configFiles(env)) {
  const config = {}
  for (const key of KEYS) if (env[key]) config[key] = env[key]
  const read = []
  for (const file of files) {
    if (!existsSync(file)) continue
    read.push(file)
    const values = parseEnvFile(readFileSync(file, 'utf8'))
    for (const key of KEYS) if (!config[key] && values[key]) config[key] = values[key]
  }
  return { config, read, files }
}

/** Plain text to Atlassian Document Format: one paragraph per non-empty line. */
export const adf = text => ({
  type: 'doc',
  version: 1,
  content: String(text)
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
})

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'])

/** ADF to plain text, good enough for reading descriptions and comments. */
export function adfText(node) {
  if (Array.isArray(node)) return node.map(adfText).join('')
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(adfText).join('') + (BLOCKS.has(node.type) ? '\n' : '')
}

export class JiraError extends Error {}

/** `fetch`-based client; throws JiraError with Jira's own messages on 4xx/5xx. */
export function client({ config, read, files }, fetchImpl = globalThis.fetch) {
  const need = key => {
    if (!config[key]) {
      throw new JiraError(
        `${key} is not set (environment or ${files.join(', ')}). Ask the user to run, in their own terminal: ` +
          'node .claude/tools/jira/setup.mjs https://<site>.atlassian.net <email> <PROJECT-KEY>',
      )
    }
  }
  const base = () => config.JIRA_BASE_URL.replace(/\/+$/, '')
  return {
    config,
    read,
    browse: key => `${base()}/browse/${key}`,
    project(given) {
      const key = given || config.JIRA_PROJECT
      if (!key) throw new JiraError('no project: pass project or set JIRA_PROJECT')
      return key
    },
    async api(method, path, body) {
      need('JIRA_BASE_URL')
      need('JIRA_EMAIL')
      need('JIRA_API_TOKEN')
      const auth = Buffer.from(`${config.JIRA_EMAIL}:${config.JIRA_API_TOKEN}`).toString('base64')
      const res = await fetchImpl(`${base()}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
      if (res.status >= 400) {
        const messages = [
          ...(data?.errorMessages ?? []),
          ...Object.entries(data?.errors ?? {}).map(([k, v]) => `${k}: ${v}`),
        ]
        throw new JiraError(`HTTP ${res.status} on ${method} ${path}${messages.length ? `: ${messages.join('; ')}` : ''}`)
      }
      return data
    },
  }
}

const ISSUE_FIELDS =
  'summary,status,assignee,reporter,issuetype,priority,labels,components,parent,created,updated,description,comment'

/** The issue as `jira.sh issue` printed it, plus the parent's type (for the Epic gate). */
async function getIssue(jira, key) {
  const i = await jira.api('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}`)
  const f = i.fields ?? {}
  return {
    key: i.key,
    url: jira.browse(i.key),
    type: f.issuetype?.name ?? null,
    status: f.status?.name ?? null,
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    parent: f.parent?.key ?? null,
    parentType: f.parent?.fields?.issuetype?.name ?? null,
    parentSummary: f.parent?.fields?.summary ?? null,
    labels: f.labels ?? [],
    components: (f.components ?? []).map(c => c.name),
    created: f.created ?? null,
    updated: f.updated ?? null,
    summary: f.summary ?? null,
    description: adfText(f.description).trim(),
    comments: (f.comment?.comments ?? []).map(c => ({
      author: c.author?.displayName ?? null,
      created: c.created,
      body: adfText(c.body).trim(),
    })),
  }
}

async function create(jira, { project, type, summary, description, parent }) {
  const fields = {
    project: { key: jira.project(project) },
    issuetype: { name: type },
    summary,
    ...(description ? { description: adf(description) } : {}),
    ...(parent ? { parent: { key: parent } } : {}),
  }
  const made = await jira.api('POST', '/rest/api/3/issue', { fields })
  return getIssue(jira, made.key)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const READ = { readOnlyHint: true, openWorldHint: true }
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
const PROJECT = str('Project key, e.g. BA. Defaults to JIRA_PROJECT.')

/** Every tool: name, description, JSON schema, annotations, handler(jira, args). */
export const TOOLS = [
  {
    name: 'whoami',
    description: 'Verify the Jira credentials: the account they belong to and which config files were read.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ,
    async run(jira) {
      const me = await jira.api('GET', '/rest/api/3/myself')
      return {
        accountId: me.accountId,
        displayName: me.displayName,
        emailAddress: me.emailAddress,
        timeZone: me.timeZone,
        configFiles: jira.read,
      }
    },
  },
  {
    name: 'get_project',
    description: 'A project: name, lead, issue types and components. A 404 means a wrong key or no browse permission.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    annotations: READ,
    async run(jira, { project }) {
      const p = await jira.api('GET', `/rest/api/3/project/${encodeURIComponent(jira.project(project))}?expand=description,lead,issueTypes`)
      return {
        key: p.key,
        name: p.name,
        id: p.id,
        projectTypeKey: p.projectTypeKey,
        lead: p.lead?.displayName ?? null,
        description: p.description ?? '',
        issueTypes: (p.issueTypes ?? []).map(t => ({ name: t.name, subtask: t.subtask })),
        components: (p.components ?? []).map(c => c.name),
      }
    },
  },
  {
    name: 'search_issues',
    description:
      'Search with JQL. Without jql: the open issues of the project, newest update first. Example jql: project = BA AND issuetype = Epic AND statusCategory != Done ORDER BY updated DESC; parent = BA-119 lists an epic\'s stories.',
    inputSchema: {
      type: 'object',
      properties: {
        jql: str('JQL query.'),
        project: PROJECT,
        max_results: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
      },
    },
    annotations: READ,
    async run(jira, { jql, project, max_results }) {
      const query = jql || `project = ${jira.project(project)} AND statusCategory != Done ORDER BY updated DESC`
      const r = await jira.api('POST', '/rest/api/3/search/jql', {
        jql: query,
        maxResults: max_results ?? 25,
        fields: ['summary', 'status', 'assignee', 'issuetype', 'priority', 'updated', 'parent'],
      })
      return (r.issues ?? []).map(i => ({
        key: i.key,
        type: i.fields?.issuetype?.name ?? null,
        status: i.fields?.status?.name ?? null,
        priority: i.fields?.priority?.name ?? null,
        assignee: i.fields?.assignee?.displayName ?? 'unassigned',
        updated: (i.fields?.updated ?? '').slice(0, 10),
        parent: i.fields?.parent?.key ?? null,
        summary: i.fields?.summary ?? null,
      }))
    },
  },
  {
    name: 'get_issue',
    description:
      'An issue with its description and comments, its parent and the parent\'s type. For the Epic gate: a Story or Bug passes when parentType is "Epic", or when the issue is itself an Epic.',
    inputSchema: { type: 'object', properties: { key: str('Issue key, e.g. BA-236.') }, required: ['key'] },
    annotations: READ,
    run: (jira, { key }) => getIssue(jira, key),
  },
  {
    name: 'list_statuses',
    description: 'The statuses of each issue type in a project.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    annotations: READ,
    async run(jira, { project }) {
      const r = await jira.api('GET', `/rest/api/3/project/${encodeURIComponent(jira.project(project))}/statuses`)
      return Object.fromEntries((r ?? []).map(t => [t.name, (t.statuses ?? []).map(s => s.name)]))
    },
  },
  {
    name: 'list_transitions',
    description: 'The transitions an issue can take now: id, name and the status each leads to.',
    inputSchema: { type: 'object', properties: { key: str('Issue key.') }, required: ['key'] },
    annotations: READ,
    async run(jira, { key }) {
      const r = await jira.api('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`)
      return (r.transitions ?? []).map(t => ({ id: t.id, name: t.name, to: t.to?.name ?? null }))
    },
  },
  {
    name: 'create_epic',
    description:
      'Create an Epic. Visible to the whole team: show the user the exact summary and description and get a yes first.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: str('Epic name.', { minLength: 1 }),
        description: str('Plain text; one paragraph per line.'),
        project: PROJECT,
      },
      required: ['summary'],
    },
    annotations: WRITE,
    run: (jira, args) => create(jira, { ...args, type: 'Epic' }),
  },
  {
    name: 'create_issue',
    description:
      'Create a Story, Bug or Task. A Story or Bug must name its epic, which is checked to be an Epic before anything is created (the Epic gate). Visible to the whole team: show the user the exact text and get a yes first.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['Story', 'Bug', 'Task'] },
        summary: str('Issue summary.', { minLength: 1 }),
        description: str('Plain text; one paragraph per line.'),
        epic: str('Key of the parent Epic, e.g. BA-119. Required for a Story or Bug.'),
        project: PROJECT,
      },
      required: ['type', 'summary'],
    },
    annotations: WRITE,
    async run(jira, { type, summary, description, epic, project }) {
      if ((type === 'Story' || type === 'Bug') && !epic) {
        throw new JiraError(`a ${type} must name its epic (Epic gate); ask the user which epic it belongs to`)
      }
      if (epic) {
        const parent = await getIssue(jira, epic)
        if (parent.type !== 'Epic') throw new JiraError(`${epic} is a ${parent.type}, not an Epic`)
      }
      return create(jira, { project, type, summary, description, parent: epic })
    },
  },
  {
    name: 'update_issue',
    description:
      'Change an issue\'s summary, description (replaced, not appended) or epic (checked to be an Epic first). Only the fields given change. Visible to the whole team: show the user the change and get a yes first.',
    inputSchema: {
      type: 'object',
      properties: {
        key: str('Issue key.'),
        summary: str('New summary.', { minLength: 1 }),
        description: str('New description, plain text; one paragraph per line. Replaces the old one.'),
        epic: str('Key of the new parent Epic.'),
      },
      required: ['key'],
    },
    annotations: { ...WRITE, idempotentHint: true },
    async run(jira, { key, summary, description, epic }) {
      const fields = {
        ...(summary ? { summary } : {}),
        ...(description !== undefined ? { description: adf(description) } : {}),
        ...(epic ? { parent: { key: epic } } : {}),
      }
      if (Object.keys(fields).length === 0) throw new JiraError('nothing to change: give summary, description or epic')
      if (epic) {
        const parent = await getIssue(jira, epic)
        if (parent.type !== 'Epic') throw new JiraError(`${epic} is a ${parent.type}, not an Epic`)
      }
      await jira.api('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields })
      return getIssue(jira, key)
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to an issue. Visible to the whole team: confirm the text with the user first.',
    inputSchema: {
      type: 'object',
      properties: { key: str('Issue key.'), text: str('Plain text; one paragraph per line.', { minLength: 1 }) },
      required: ['key', 'text'],
    },
    annotations: WRITE,
    async run(jira, { key, text }) {
      const c = await jira.api('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: adf(text) })
      return { key, commentId: c.id, url: jira.browse(key) }
    },
  },
  {
    name: 'transition_issue',
    description:
      'Move an issue through a transition, by name (case-insensitive) or id; list_transitions shows them. Confirm the target status with the user first.',
    inputSchema: {
      type: 'object',
      properties: { key: str('Issue key.'), transition: str('Transition name or id, e.g. "In Progress".') },
      required: ['key', 'transition'],
    },
    annotations: { ...WRITE, idempotentHint: true },
    async run(jira, { key, transition }) {
      const path = `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`
      const all = (await jira.api('GET', path)).transitions ?? []
      const want = String(transition).toLowerCase()
      const t = all.find(x => x.id === String(transition) || x.name.toLowerCase() === want)
      if (!t) {
        throw new JiraError(`no transition "${transition}" on ${key}; available: ${all.map(x => x.name).join(', ') || 'none'}`)
      }
      await jira.api('POST', path, { transition: { id: t.id } })
      const now = await getIssue(jira, key)
      return { key, transition: t.name, status: now.status, url: now.url }
    },
  },
]

/** Run one tool by name; JiraError and bad arguments become MCP tool errors, not protocol errors. */
export async function callTool(name, args, { fetchImpl, env } = {}) {
  const tool = TOOLS.find(t => t.name === name)
  if (!tool) return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true }
  try {
    const jira = client(loadConfig(env ?? process.env), fetchImpl)
    const result = await tool.run(jira, args ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `jira: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
  }
}
