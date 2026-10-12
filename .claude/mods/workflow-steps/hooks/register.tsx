import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Queue, Step, StepsSource, Task } from '../types'
import { classify, completion, evidenceKey, expectedAgent, factsFor, isWriteCall, summarize } from './rules'
import type { Completion, ToolArgs } from './rules'

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
const open = atom({ plugin: 'workflow-steps', key: 'open' } as const, [])

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
  seq: null, step, status, startedAt, matched: 0, unmatched: 0, tokens: 0, cached: 0, costStart, cost: 0, agents: [], evidence: {}, facts: [],
})

const cloneQueue = (q: Queue): Queue => ({
  ...q,
  tasks: q.tasks.map(t => ({ ...t, agents: t.agents.map(a => ({ ...a })), evidence: { ...t.evidence }, facts: [...(t.facts ?? [])] })),
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
  await update($, open, () => [])
}

// Applies one tool call's signal to the queue, before the tool runs.
async function applySignal($: EngineInterface, args: ToolArgs): Promise<void> {
  const current = await read($, queue)
  if (current.tasks.length === 0) return
  const q = cloneQueue(current)
  const now = await $.clock.now()
  const signal = classify(args, q.hasWritten)
  const key = evidenceKey(args, signal)
  const facts = factsFor(args, signal, !q.hasWritten)
  if (signal.firstAction) q.firstActionDone = true
  if (!q.hasWritten && !isWriteCall(args)) q.exploredBeforeWrite = true
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
    if (matched) for (const fact of facts) if (!task.facts.includes(fact)) task.facts.push(fact)
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

// After a call ran: a step-9 task takes its command's result, and an answered
// question meets step 2's second check.
async function applyResult($: EngineInterface, args: ToolArgs, isError: boolean): Promise<void> {
  const signal = classify(args, true)
  if (signal.step !== 9 && args.tool !== 'AskUserQuestion') return
  const current = await read($, queue)
  const q = cloneQueue(current)
  const running = q.tasks.findLast(t => t.status === 'running')
  if (!running) return
  if (signal.step === 9 && running.step === 9) running.result = isError ? 'failed' : 'passed'
  else if (args.tool === 'AskUserQuestion' && running.step === 2 && !isError && !running.facts.includes('answered')) {
    running.facts.push('answered')
  } else return
  await update($, queue, () => q)
}

async function applyUsage($: EngineInterface, input: number, output: number, cached: number, agentId?: string): Promise<void> {
  const current = await read($, queue)
  if (current.tasks.length === 0) return
  const q = cloneQueue(current)
  // A subagent's run ends in its own turn: its usage is the subagent's, in the task it was spawned under.
  if (agentId !== undefined) {
    const owner = q.tasks.find(t => t.agents.some(a => a.id === agentId))
    const agent = owner?.agents.find(a => a.id === agentId)
    if (owner && agent) {
      agent.tokens += input + output
      agent.running = false
      owner.tokens += input + output
      owner.cached += cached
      await update($, queue, () => q)
      return
    }
  }
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
  running.agents.push({ id, type, model, description, running: true, tokens: 0 })
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
const agentLabel = (task: Task): string => (task.agents.length === 0 ? 'main' : `main +${task.agents.length}`)
const confidence = (task: Task): number => {
  const calls = task.matched + task.unmatched
  return calls === 0 ? 1 : task.matched / calls
}
const percent = (ratio: number): string => `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`
const BAR = 8
const meterParts = (ratio: number): [string, string] => {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * BAR)
  return ['█'.repeat(filled), '░'.repeat(BAR - filled)]
}
// The row's summary is left out below this many columns; the detail always has it.
const MIN_SUMMARY = 12

/**
 * Which columns a row draws in `width` columns, so that a row never wraps (a
 * Button's children are not truncated). Always: margin, #n, a title of 16, the
 * % and the caret. Then, while they fit: tokens, cost, agent, bar; the title up
 * to 28; step, duration; the title up to 34; the summary with what is left.
 */
export type RowLayout = {
  title: number; step: boolean; agent: boolean; duration: boolean; tokens: boolean; cost: boolean; bar: boolean; summary: number
}
export const layoutFor = (width: number): RowLayout => {
  const layout: RowLayout = { title: 16, step: false, agent: false, duration: false, tokens: false, cost: false, bar: false, summary: 0 }
  let used = 2 + 5 + 16 + 5 + 2
  const take = (n: number): boolean => {
    if (used + n > width) return false
    used += n
    return true
  }
  const grow = (to: number) => {
    const add = Math.max(0, Math.min(to - layout.title, width - used))
    layout.title += add
    used += add
  }
  layout.tokens = take(8)
  layout.cost = take(7)
  layout.agent = take(10)
  layout.bar = take(2 + BAR)
  grow(28)
  layout.step = take(8)
  layout.duration = take(5)
  grow(34)
  // What is left: a step-9 result first, then the summary when at least MIN_SUMMARY remains.
  layout.summary = Math.max(0, width - used - 1)
  return layout
}
const titleOf = (list: Step[], step: number): string => list.find(s => s.number === step)?.title ?? `Step ${step}`
const summaryOf = (task: Task): string => summarize(task.evidence, { subagents: task.agents.length, result: task.result })
// Step 1's two checks are the session's: the first action, and any read before the first write,
// whichever task the calls were counted for (a shell read of retrospective.md is a step-11 signal).
const progressOf = (task: Task, q: Queue): Completion => {
  const facts = [...(task.facts ?? [])]
  if (task.step === 1 && q.firstActionDone) facts.push('retro-read')
  if (task.step === 1 && q.exploredBeforeWrite) facts.push('explored')
  return completion(task.step, facts, { started: true, agentsRunning: task.agents.some(a => a.running), result: task.result })
}
const queuedProgress = (step: number): Completion => completion(step, [], { started: false, agentsRunning: false })
const rowKey = (task: Task): string => (task.status === 'tentative' ? 'row-tentative' : `row-${task.seq}`)
const INDENT = '       '
const LABEL = 10

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
    await applyUsage(
      $,
      usage?.input_tokens ?? 0,
      usage?.output_tokens ?? 0,
      usage?.cache_read_input_tokens ?? 0,
      e.agentId,
    ).catch(() => undefined)
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, steps)
    const from = await read($, source)
    const q = await read($, queue)
    const opened = new Set(await read($, open))
    const now = await $.clock.now()
    const width = Math.max(40, (e.props.bodyColumns ?? 96) - 2)
    const toggle = (key: string) => () =>
      update($, open, keys => (keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]))

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
    const layout = layoutFor(width)
    const titleWidth = layout.title
    // The summary takes what is left of the row, or is left out when that is too little.
    const summaryText = (text: string, extra: number) => {
      const room = layout.summary - extra
      return room < MIN_SUMMARY ? '' : ` ${clip(text, room)}`
    }

    // Overall completion: the mean of the done, running and queued rows.
    const ratios = [
      ...done.map(t => progressOf(t, q).ratio),
      ...(running ? [progressOf(running, q).ratio] : []),
      ...queued.map(s => queuedProgress(s.number).ratio),
    ]
    const overall = ratios.length === 0 ? 0 : ratios.reduce((a, b) => a + b, 0) / ratios.length

    const bar = (ratio: number, color: string | undefined) => {
      const [filled, empty] = meterParts(ratio)
      return [
        <Text key="filled" color={color}>{filled}</Text>,
        <Text key="empty" dimColor>{empty}</Text>,
      ]
    }

    const row = (task: Task, color: string) => {
      const key = rowKey(task)
      const isOpen = opened.has(key)
      const seqText = task.status === 'tentative' ? `#${q.nextSeq}?` : `#${task.seq}`
      const ended = task.endedAt ?? now
      const progress = progressOf(task, q)
      const fullResult = task.result === 'failed' ? ' ✗ failed' : task.result === 'passed' ? ' ✓ passed' : ''
      // The result word when the row has room for it; otherwise the % carries it in red or green.
      const result = fullResult.length <= layout.summary + 1 ? fullResult : ''
      const percentColor = result === '' && task.result ? (task.result === 'failed' ? 'red' : 'green') : undefined
      return (
        <Button key={key} plain onPress={toggle(key)}>
          <Text wrap="truncate">
            {'  '}
            <Text color={color} bold={task.status === 'running'}>{pad(seqText, 5)}</Text>
            <Text bold={task.status === 'running'}>{pad(titleOf(list, task.step), titleWidth)}</Text>
            {layout.step ? <Text dimColor>{` ${pad(`step ${task.step}`, 7)}`}</Text> : ''}
            {layout.agent ? <Text dimColor>{` ${pad(agentLabel(task), 9)}`}</Text> : ''}
            {layout.duration ? duration(ended - task.startedAt).padStart(5, ' ') : ''}
            {layout.tokens ? tokens(task.tokens).padStart(8, ' ') : ''}
            {layout.cost ? dollars(task.cost).padStart(7, ' ') : ''}
            {layout.bar ? '  ' : ''}
            {layout.bar ? bar(progress.ratio, color) : ''}
            {' '}
            <Text color={percentColor}>{percent(progress.ratio).padStart(4, ' ')}</Text>
            {result ? <Text color={task.result === 'failed' ? 'red' : 'green'}>{result}</Text> : ''}
            {` ${isOpen ? '▾' : '▸'}`}
            <Text dimColor>{summaryText(summaryOf(task), result.length)}</Text>
          </Text>
        </Button>
      )
    }

    const agentLines = (task: Task) =>
      task.agents.map((agent, i) => (
        <Text key={`agent-${task.seq}-${i}`} wrap="truncate" dimColor={!agent.running}>
          {INDENT}
          <Text color="magenta">↳ {agent.type}</Text>
          {` · ${agent.model} · "${clip(agent.description, 40)}"  `}
          {agent.running ? <Text color="yellow">● running</Text> : <Text color="green">✓</Text>}
        </Text>
      ))

    // The detail under an open row (delivery.md §9, Details).
    const detailLine = (key: string, label: string, body: string) => (
      <Text key={key} wrap="truncate">
        {INDENT}
        <Text dimColor>{label.padEnd(LABEL, ' ')}</Text>
        {body}
      </Text>
    )
    const checkLines = (progress: Completion, key: string) =>
      progress.checks.map((check, i) => (
        <Text key={`${key}-check-${i}`} wrap="truncate">
          {INDENT}
          {' '.repeat(LABEL)}
          <Text color={check.met ? 'green' : undefined} dimColor={!check.met}>{check.met ? '✓' : '○'}</Text>
          {` ${check.label}`}
        </Text>
      ))
    const progressLine = (key: string, progress: Completion) =>
      detailLine(`${key}-progress`, 'Progress', `${progress.met} of ${progress.total} checks · ${percent(progress.ratio)}`)

    const detail = (task: Task) => {
      const key = rowKey(task)
      const progress = progressOf(task, q)
      const subagentTokens = task.agents.reduce((n, a) => n + (a.tokens ?? 0), 0)
      const calls = task.matched + task.unmatched
      return (
        <Box key={`${key}-detail`} flexDirection="column">
          {detailLine(`${key}-summary`, 'Summary', summaryOf(task))}
          {progressLine(key, progress)}
          {checkLines(progress, key)}
          {detailLine(`${key}-agents`, 'Agents', `main  ${tokens(Math.max(0, task.tokens - subagentTokens))}`)}
          {task.agents.map((agent, i) => (
            <Text key={`${key}-agent-${i}`} wrap="truncate">
              {INDENT}
              {' '.repeat(LABEL)}
              <Text color="magenta">↳ {agent.type}</Text>
              {` · ${agent.model} · "${clip(agent.description, 40)}"  ${tokens(agent.tokens ?? 0)}  `}
              {agent.running ? <Text color="yellow">● running</Text> : <Text color="green">✓</Text>}
            </Text>
          ))}
          {detailLine(
            `${key}-cost`,
            'Cost',
            `${dollars(task.cost)} while the task ran · confidence ${percent(confidence(task))} (${task.matched} of ${calls} calls matched)`,
          )}
        </Box>
      )
    }

    const queuedRow = (s: Step, seq: number) => {
      const key = `queued-${s.number}`
      const isOpen = opened.has(key)
      return (
        <Button key={key} plain onPress={toggle(key)}>
          <Text dimColor wrap="truncate">
            {'  '}
            {pad(`#${seq}`, 5)}
            {pad(s.title, titleWidth)}
            {layout.step ? ` ${pad(`step ${s.number}`, 7)}` : ''}
            {layout.agent ? ` ${pad(expectedAgent(s.number), 9)}` : ''}
            {' '.repeat((layout.duration ? 5 : 0) + (layout.tokens ? 8 : 0) + (layout.cost ? 7 : 0))}
            {layout.bar ? `  ${'░'.repeat(BAR)}` : ''}
            {` ${'0%'.padStart(4, ' ')}`}
            {` ${isOpen ? '▾' : '▸'}`}
            {summaryText(`Expected: ${s.summary}`, 0)}
          </Text>
        </Button>
      )
    }

    const queuedDetail = (s: Step) => {
      const key = `queued-${s.number}`
      const progress = queuedProgress(s.number)
      return (
        <Box key={`${key}-detail`} flexDirection="column">
          {detailLine(`${key}-summary`, 'Summary', `Expected: ${s.summary}`)}
          {progressLine(key, progress)}
          {checkLines(progress, key)}
          {detailLine(
            `${key}-agents`,
            'Agents',
            expectedAgent(s.number) === '~main' ? 'main (expected)' : 'main with subagents (expected)',
          )}
        </Box>
      )
    }

    // An open row shows its detail; a closed running or tentative row keeps its subagent lines.
    const agentLinesIfRunning = (task: Task) => (task.status === 'done' ? [] : agentLines(task))
    const taskWithDetail = (task: Task, color: string) => [
      row(task, color),
      ...(opened.has(rowKey(task)) ? [detail(task)] : agentLinesIfRunning(task)),
    ]

    return (
      <Box flexDirection="column">
        <Text wrap="truncate">
          <Text bold>Development workflow</Text>
          {'    '}
          <Text color="yellow">▸ {running ? `#${running.seq}` : '—'} running · {queued.length} queued</Text>
          {`   overall ${percent(overall)}   ${tokens(totalTokens)} · ${dollars(q.usd)}`}
        </Text>
        <Text dimColor wrap="truncate">
          {from === 'claude-md' ? 'From CLAUDE.md' : 'CLAUDE.md not readable here: built-in copy'}
          {` · retrospective read ${q.firstActionDone ? '✓' : '–'} · ${duration(now - q.startedAt)}`}
          {silent.length > 0 ? ` · ${silent.length} step${silent.length === 1 ? '' : 's'} without a signal yet` : ''}
          {' · inferred from tool calls'}
        </Text>

        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>DONE</Text>
          {folded > 0 && (
            <Text dimColor wrap="truncate">
              {`  … ${folded} earlier tasks · ${tokens(foldedTokens)} · ${dollars(foldedCost)}`}
            </Text>
          )}
          {shown.length === 0 && folded === 0 && <Text dimColor>  none yet</Text>}
          {shown.flatMap(t => taskWithDetail(t, 'green'))}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>RUNNING</Text>
          {running ? taskWithDetail(running, 'yellow') : <Text dimColor>  none</Text>}
        </Box>

        {tentative && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>TENTATIVE</Text>
            {taskWithDetail(tentative, 'yellow')}
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>QUEUED</Text>
          {queued.length === 0 && <Text dimColor>  none</Text>}
          {queued.flatMap((s, i) => [
            queuedRow(s, firstQueued + i),
            ...(opened.has(`queued-${s.number}`) ? [queuedDetail(s)] : []),
          ])}
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
