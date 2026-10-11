import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Queue, Step, StepsSource, Task } from '../types'
import { classify, evidenceKey, isWriteCall } from './rules'
import type { ToolArgs } from './rules'

const PANE = 'workflow'
const TITLE = 'Workflow'
const CLAUDE_MD = 'CLAUDE.md'
const PROMOTE_AT = 3
const DROP_AT = 3
const FOLD_AFTER = 12

const EMPTY_QUEUE: Queue = { tasks: [], nextSeq: 1, hasWritten: false, firstActionDone: false, startedAt: 0, usd: 0 }

const steps = atom({ plugin: 'workflow-steps', key: 'steps' } as const, [])
const source = atom({ plugin: 'workflow-steps', key: 'source' } as const, '')
const firstAction = atom({ plugin: 'workflow-steps', key: 'firstAction' } as const, '')
const queue = atom({ plugin: 'workflow-steps', key: 'queue' } as const, EMPTY_QUEUE)

// The workflow as CLAUDE.md spelled it on 2026-10-10, used when the file
// can't be read or its Workflow section can't be parsed.
const FALLBACK: Step[] = [
  { number: 1, title: 'Understand the goal', summary: 'Restate the request in your own words before touching anything.' },
  { number: 2, title: 'Ask clarifying questions until the goal is 100% understood', summary: 'Scope, behaviour, edge cases, acceptance criteria.' },
  { number: 3, title: 'Update roadmap', summary: 'Find or add the feature in roadmap.md with Intent, Scope, Acceptance; set 🚧 In progress.' },
  { number: 4, title: 'Update architecture', summary: 'Record any architectural decision as an ADR before code is written.' },
  { number: 5, title: 'Update specs', summary: 'Update every spec the change affects before any test or code.' },
  { number: 6, title: 'Component impact-based analysis on E2E', summary: 'Per touched component, decide add / update / delete / re-run for each Gherkin scenario.' },
  { number: 7, title: 'Implement / update / delete E2E', summary: 'Apply the step-6 decisions first; confirm they fail for the right reason.' },
  { number: 8, title: 'Implement changes', summary: 'Only now is production code touched, against the Acceptance criteria.' },
  { number: 9, title: 'Run E2E and fix until green', summary: 'npm run test:e2e, check-specs, unit tests, lint and build; fix root causes.' },
  { number: 10, title: 'Update changelog with evidence', summary: 'Dated changelog entry, evidence folder, roadmap entry ✅ Done.' },
  { number: 11, title: 'Retrospective', summary: 'What went well, what went wrong, what to do differently.' },
]
const FALLBACK_FIRST_ACTION = 'Read retrospective.md before doing anything else.'

// Markdown to plain text: links to their text, no emphasis or code marks.
const plain = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

const firstSentence = (text: string): string => {
  const match = /^(.*?[.!?])(\s|$)/.exec(text)
  return match?.[1] ?? text
}

const sentence = (text: string): string => {
  const trimmed = text.replace(/[.\s]+$/, '')
  if (trimmed === '') return ''
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`
}

// The "## Workflow" section of CLAUDE.md: its numbered, bold-titled steps.
export const parseWorkflow = (markdown: string): { steps: Step[]; firstAction: string } => {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex(line => /^## Workflow\b/.test(line))
  if (start < 0) return { steps: [], firstAction: '' }
  const section: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break
    section.push(line)
  }
  const found: Step[] = []
  let action = ''
  for (const line of section) {
    const step = /^(\d+)\.\s+\*\*(.+?)\*\*\s*[—–-]+\s*(.*)$/.exec(line)
    if (step) {
      found.push({ number: Number(step[1]), title: plain(step[2] ?? ''), summary: firstSentence(plain(step[3] ?? '')) })
      continue
    }
    const mandatory = /MANDATORY FIRST ACTION\s*[—–-]+\s*(.*?)(\*\*|$)/.exec(line)
    if (mandatory && !action) action = sentence(plain(mandatory[1] ?? ''))
  }
  return { steps: found, firstAction: action }
}

// Reads CLAUDE.md in the working directory into $.state, or the fallback.
async function loadSteps($: EngineInterface): Promise<void> {
  let parsed = { steps: [] as Step[], firstAction: '' }
  try {
    parsed = parseWorkflow(await $.fs.read(CLAUDE_MD))
  } catch {
    parsed = { steps: [], firstAction: '' }
  }
  const ok = parsed.steps.length > 0
  const from: StepsSource = ok ? 'claude-md' : 'fallback'
  await update($, steps, () => (ok ? parsed.steps : FALLBACK))
  await update($, firstAction, () => (ok ? parsed.firstAction : FALLBACK_FIRST_ACTION))
  await update($, source, () => from)
}

// ---- the queue ------------------------------------------------------------

const newTask = (step: number, startedAt: number, status: Task['status'], costStart: number): Task => ({
  seq: null, step, status, startedAt, matched: 0, unmatched: 0, tokens: 0, cached: 0, costStart, cost: 0, agents: [], evidence: {},
})

const cloneQueue = (q: Queue): Queue => ({
  ...q,
  tasks: q.tasks.map(t => ({ ...t, agents: t.agents.map(a => ({ ...a })), evidence: { ...t.evidence } })),
})

async function sessionCost($: EngineInterface): Promise<number> {
  try {
    const usage = await $.session.usage()
    return usage.cost?.usd ?? 0
  } catch {
    return 0
  }
}

// Starts (or restarts) the queue with task #1, step 1, running.
async function startQueue($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const usd = await sessionCost($)
  const first = { ...newTask(1, now, 'running', usd), seq: 1 }
  await update($, queue, () => ({ tasks: [first], nextSeq: 2, hasWritten: false, firstActionDone: false, startedAt: now, usd }))
}

// Applies one tool call's signal to the queue, before the tool runs.
async function applySignal($: EngineInterface, args: ToolArgs): Promise<void> {
  const current = await read($, queue)
  if (current.tasks.length === 0) return
  const q = cloneQueue(current)
  const now = await $.clock.now()
  const signal = classify(args, q.hasWritten)
  const key = evidenceKey(args, signal)
  if (signal.firstAction) q.firstActionDone = true
  if (isWriteCall(args)) q.hasWritten = true

  const running = q.tasks.findLast(t => t.status === 'running')
  const tentativeIndex = q.tasks.findIndex(t => t.status === 'tentative')
  let tentative = tentativeIndex >= 0 ? q.tasks[tentativeIndex] : undefined
  const dropTentative = () => {
    const i = q.tasks.findIndex(t => t.status === 'tentative')
    if (i >= 0) q.tasks.splice(i, 1)
    tentative = undefined
  }
  const count = (task: Task, matched: boolean) => {
    if (matched) task.matched += 1
    else task.unmatched += 1
    task.evidence[key] = (task.evidence[key] ?? 0) + 1
  }

  if (signal.step === null) {
    if (tentative) {
      tentative.unmatched += 1
      if (tentative.unmatched >= DROP_AT) dropTentative()
    } else if (running) {
      count(running, false)
    }
  } else if (running && signal.step === running.step) {
    count(running, true)
    if (tentative) dropTentative()
  } else {
    if (tentative && tentative.step !== signal.step) dropTentative()
    if (!tentative) {
      tentative = newTask(signal.step, now, 'tentative', q.usd)
      q.tasks.push(tentative)
    }
    count(tentative, true)
    if (signal.strong || tentative.matched >= PROMOTE_AT) {
      const usd = await sessionCost($)
      q.usd = usd
      if (running) {
        running.status = 'done'
        running.endedAt = now
        running.cost = Math.max(0, usd - running.costStart)
        for (const agent of running.agents) agent.running = false
      }
      tentative.status = 'running'
      tentative.seq = q.nextSeq
      tentative.costStart = usd
      q.nextSeq += 1
    }
  }
  await update($, queue, () => q)
}

// After a step-9 command ran: the task takes the command's result.
async function applyResult($: EngineInterface, args: ToolArgs, isError: boolean): Promise<void> {
  const signal = classify(args, true)
  if (signal.step !== 9) return
  const current = await read($, queue)
  const q = cloneQueue(current)
  const running = q.tasks.findLast(t => t.status === 'running')
  if (!running || running.step !== 9) return
  running.result = isError ? 'failed' : 'passed'
  await update($, queue, () => q)
}

async function applyUsage($: EngineInterface, input: number, output: number, cached: number): Promise<void> {
  const current = await read($, queue)
  if (current.tasks.length === 0) return
  const q = cloneQueue(current)
  const usd = await sessionCost($)
  q.usd = usd
  const running = q.tasks.findLast(t => t.status === 'running')
  if (running) {
    running.tokens += input + output
    running.cached += cached
    running.cost = Math.max(0, usd - running.costStart)
  }
  for (const task of q.tasks) for (const agent of task.agents) agent.running = false
  await update($, queue, () => q)
}

async function addAgent($: EngineInterface, type: string, model: string, description: string, id?: string): Promise<void> {
  const current = await read($, queue)
  const q = cloneQueue(current)
  const running = q.tasks.findLast(t => t.status === 'running')
  if (!running) return
  running.agents.push({ id, type, model, description, running: true })
  await update($, queue, () => q)
}

// ---- formatting -----------------------------------------------------------

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
const pad = (text: string, width: number): string => clip(text, width).padEnd(width, ' ')
const tokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const dollars = (n: number): string => `$${n.toFixed(2)}`
const duration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const agentLabel = (task: Task): string =>
  task.agents.length === 0 ? 'main' : task.agents.length === 1 ? '1 agent' : `${task.agents.length} agents`
const confidence = (task: Task): number => {
  const calls = task.matched + task.unmatched
  return calls === 0 ? 1 : task.matched / calls
}
const meter = (ratio: number): string => {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * 10)
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`
}
const evidenceLine = (task: Task): string =>
  Object.entries(task.evidence)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ×${n}`)
    .join(' · ')
const titleOf = (list: Step[], step: number): string => list.find(s => s.number === step)?.title ?? `Step ${step}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'workflow',
      description: 'Show the CLAUDE.md workflow as a task queue in a side pane; "reset" starts it over',
    })
    await loadSteps($)
    const current = await read($, queue)
    if (current.tasks.length === 0) await startQueue($)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    if (!opened.isPlaced) {
      await $.ui.toast('Workflow queue: run /workflow to open the pane')
    }
    return next(e)
  })

  on('command.run', { command: 'workflow' }, async ($, e) => {
    await loadSteps($)
    const reset = e.args.trim() === 'reset'
    if (reset) await startQueue($)
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    return reset ? { text: 'Workflow queue reset: task #1 is running again.' } : {}
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as ToolArgs
    await applySignal($, args).catch(() => undefined)
    try {
      const ran = await next(e)
      await applyResult($, args, ran.isError === true || ran.deny !== undefined).catch(() => undefined)
      return ran
    } catch (err) {
      await applyResult($, args, true).catch(() => undefined)
      throw err
    }
  })

  on('turn.complete', async ($, e, next) => {
    const usage = e.usage
    await applyUsage($, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0, usage?.cache_read_input_tokens ?? 0).catch(
      () => undefined,
    )
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny === undefined) {
      await addAgent($, e.subagentType, spawned.model, e.description, spawned.agentId).catch(() => undefined)
    }
    return spawned
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, steps)
    const from = await read($, source)
    const q = await read($, queue)
    const now = await $.clock.now()
    const width = Math.max(40, (e.props.bodyColumns ?? 96) - 2)

    const done = q.tasks.filter(t => t.status === 'done')
    const running = q.tasks.findLast(t => t.status === 'running')
    const tentative = q.tasks.find(t => t.status === 'tentative')
    const highest = Math.max(0, ...q.tasks.filter(t => t.status !== 'tentative').map(t => t.step))
    const started = new Set(q.tasks.filter(t => t.status !== 'tentative').map(t => t.step))
    const queued = list.filter(s => s.number > highest && s.number !== tentative?.step)
    const silent = list.filter(s => s.number < highest && !started.has(s.number))
    const firstQueued = q.nextSeq + (tentative ? 1 : 0)
    const folded = Math.max(0, done.length - FOLD_AFTER)
    const shown = done.slice(folded)
    const foldedTokens = done.slice(0, folded).reduce((n, t) => n + t.tokens, 0)
    const foldedCost = done.slice(0, folded).reduce((n, t) => n + t.cost, 0)
    const totalTokens = q.tasks.reduce((n, t) => n + t.tokens, 0)
    const titleWidth = Math.max(16, Math.min(34, width - 62))

    const row = (task: Task, mark: string, markColor: string) => {
      const label = task.seq === null ? '#?' : task.status === 'tentative' ? `#${task.seq}?` : `#${task.seq}`
      const seqText = task.status === 'tentative' ? `#${q.nextSeq}?` : label
      const ended = task.endedAt ?? now
      const result = task.result === 'failed' ? ' ✗ failed' : task.result === 'passed' ? ' ✓ passed' : ''
      return (
        <Text key={`task-${task.seq ?? 'tentative'}-${task.step}-${task.startedAt}`} wrap="truncate">
          {'  '}
          <Text color={markColor} bold={task.status === 'running'}>{pad(seqText, 5)}</Text>
          <Text bold={task.status === 'running'}>{pad(titleOf(list, task.step), titleWidth)}</Text>
          {' '}
          <Text dimColor>{pad(`step ${task.step}`, 8)}</Text>
          <Text dimColor>{pad(agentLabel(task), 9)}</Text>
          {duration(ended - task.startedAt).padStart(5, ' ')}
          {tokens(task.tokens).padStart(8, ' ')}
          {dollars(task.cost).padStart(7, ' ')}
          {'  '}
          <Text color="cyan">{meter(confidence(task))}</Text>
          {` ${String(Math.round(confidence(task) * 100)).padStart(3, ' ')}%`}
          {result ? <Text color={task.result === 'failed' ? 'red' : 'green'}>{result}</Text> : ''}
          {'  '}
          <Text dimColor>{evidenceLine(task)}</Text>
          {mark ? '' : ''}
        </Text>
      )
    }

    const agentLines = (task: Task) =>
      task.agents.map((agent, i) => (
        <Text key={`agent-${task.seq}-${i}`} wrap="truncate" dimColor={!agent.running}>
          {'       '}
          <Text color="magenta">↳ {agent.type}</Text>
          {` · ${agent.model} · "${clip(agent.description, 40)}"  `}
          {agent.running ? <Text color="yellow">● running</Text> : <Text color="green">✓</Text>}
        </Text>
      ))

    return (
      <Box flexDirection="column">
        <Text wrap="truncate">
          <Text bold>Development workflow</Text>
          <Text dimColor>  inferred from tool calls</Text>
          {'    '}
          <Text color="yellow">▸ {running ? `#${running.seq}` : '—'} running · {queued.length} queued</Text>
          {`   ${tokens(totalTokens)} · ${dollars(q.usd)}`}
        </Text>
        <Text dimColor wrap="truncate">
          {from === 'claude-md' ? 'From CLAUDE.md' : 'CLAUDE.md not readable here: built-in copy'}
          {` · retrospective read ${q.firstActionDone ? '✓' : '–'} · ${duration(now - q.startedAt)}`}
          {silent.length > 0 ? ` · ${silent.length} step${silent.length === 1 ? '' : 's'} without a signal yet` : ''}
        </Text>

        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>DONE</Text>
          {folded > 0 && (
            <Text dimColor wrap="truncate">
              {`  … ${folded} earlier tasks · ${tokens(foldedTokens)} · ${dollars(foldedCost)}`}
            </Text>
          )}
          {shown.length === 0 && folded === 0 && <Text dimColor>  none yet</Text>}
          {shown.map(t => row(t, '✓', 'green'))}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>RUNNING</Text>
          {running ? row(running, '▸', 'yellow') : <Text dimColor>  none</Text>}
          {running ? agentLines(running) : ''}
        </Box>

        {tentative && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>TENTATIVE</Text>
            {row(tentative, '?', 'yellow')}
            {agentLines(tentative)}
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>QUEUED</Text>
          {queued.length === 0 && <Text dimColor>  none</Text>}
          {queued.map((s, i) => (
            <Text key={`queued-${s.number}`} dimColor wrap="truncate">
              {'  '}
              {pad(`#${firstQueued + i}`, 5)}
              {pad(s.title, titleWidth)}
              {` step ${s.number}`}
            </Text>
          ))}
        </Box>

        {silent.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor wrap="truncate">{`no signal yet: ${silent.map(s => `step ${s.number}`).join(' · ')}`}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
