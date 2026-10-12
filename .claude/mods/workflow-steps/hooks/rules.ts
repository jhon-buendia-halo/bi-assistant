// The inference rules: which workflow step a tool call is evidence for.
// Pure functions, so they can be tested without the engine.

export type Signal = {
  /** The step the call is evidence for, or null when it matches nothing. */
  step: number | null
  /** A write, a question or a test command; a read is weak. */
  strong: boolean
  /** One readable line for the evidence column. */
  label: string
  /** The call was the mandatory first action: reading retrospective.md. */
  firstAction: boolean
}

export type ToolArgs = { tool: string } & Record<string, unknown>

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const TEST_COMMAND = /\b(test:e2e|check-specs\.py|jest|playwright test)\b|\bnpm (--prefix \S+ )?(run )?(test|build|lint)\b/
// A shell command that changes files: redirects, in-place edits, copies, moves, heredocs into a file.
const WRITE_OP = /(^|\s)(>>?|tee|sed -i|cp|mv|rm|touch|mkdir|python3 -)(\s|$)|<<\s*'?\w+'?/

const str = (args: ToolArgs, key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '')
const base = (path: string): string => path.split('/').pop() ?? path
const clip = (text: string, max = 40): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The step that owns a path, by the CLAUDE.md workflow's file conventions. */
export const stepForPath = (path: string): number | null => {
  // A worktree checkout lives under .claude/worktrees/<name>/: match inside it, not the prefix.
  const p = path.replace(/\\/g, '/').replace(/^.*\/\.claude\/worktrees\/[^/]+(\/|$)/, '')
  if (p === '') return null
  if (/(^|\/)roadmap\.md$/.test(p)) return 3
  if (/(^|\/)specs\/system\/architecture\.md$/.test(p)) return 4
  if (/(^|\/)specs(\/|$)/.test(p)) return 5
  if (/(^|\/)evidence\/[^/]+\/e2e-impact\.md$/.test(p)) return 6
  if (/(^|\/)frontend\/e2e(\/|$)/.test(p) || /(^|\/)backend\/test\/.*\.e2e-spec\.ts$/.test(p)) return 7
  if (/(^|\/)(frontend\/src|backend\/src|\.claude)(\/|$)/.test(p)) return 8
  if (/(^|\/)changelog\.md$/.test(p) || /(^|\/)evidence(\/|$)/.test(p)) return 10
  if (/(^|\/)retrospective\.md$/.test(p)) return 11
  return null
}

/** The path-like tokens of a shell command: anything with a slash or a file extension. */
export const pathsIn = (command: string): string[] =>
  (command.match(/[A-Za-z0-9_@.~][A-Za-z0-9_./-]*/g) ?? []).filter(t => t.includes('/') || /\.\w+$/.test(t))

/** The segment of a shell command that is the test or build command itself. */
const testSegment = (command: string): string => {
  const parts = command.split(/&&|\|\||;|\|/).map(s => s.trim())
  return parts.filter(s => TEST_COMMAND.test(s)).pop() ?? command.trim()
}

/**
 * Classifies one tool call. `hasWritten` says whether any write has happened in
 * the session yet: before that, every call that matches nothing else is step 1.
 */
export const classify = (args: ToolArgs, hasWritten: boolean): Signal => {
  const tool = args.tool
  if (tool === 'AskUserQuestion') return { step: 2, strong: true, label: 'AskUserQuestion', firstAction: false }
  if (WRITE_TOOLS.has(tool)) {
    const path = str(args, 'file_path') || str(args, 'notebook_path')
    return { step: stepForPath(path), strong: true, label: `${tool} ${base(path)}`.trim(), firstAction: false }
  }
  if (READ_TOOLS.has(tool)) {
    const path = str(args, 'file_path') || str(args, 'path') || str(args, 'pattern')
    const firstAction = tool === 'Read' && base(path) === 'retrospective.md'
    let step = stepForPath(path)
    if (step === null && !hasWritten) step = 1
    if (firstAction && !hasWritten) step = 1
    const what = str(args, 'file_path') ? base(path) : str(args, 'pattern') || base(path)
    return { step, strong: false, label: `${tool} ${what}`.trim(), firstAction }
  }
  if (tool === 'Bash') {
    const command = str(args, 'command')
    if (TEST_COMMAND.test(command)) return { step: 9, strong: true, label: clip(testSegment(command)), firstAction: false }
    // Paths named in the command stand for the files it touches.
    const paths = pathsIn(command)
    const writes = WRITE_OP.test(command)
    // The file a redirect writes to names the step best; otherwise the first owned path.
    const target = /(?:>>?|\btee)\s*"?([^\s"']+)/.exec(command)?.[1]
    const owned = [target ?? '', ...paths].find(path => path !== '' && stepForPath(path) !== null)
    const firstAction = !writes && paths.some(path => base(path) === 'retrospective.md')
    if (owned !== undefined) {
      return { step: stepForPath(owned), strong: writes, label: `Bash ${base(owned)}`, firstAction }
    }
    return { step: hasWritten ? null : 1, strong: false, label: clip(command), firstAction }
  }
  // Anything else is exploration while nothing has been written yet.
  return { step: hasWritten ? null : 1, strong: false, label: tool, firstAction: false }
}

/** The key a call is counted under in a task's evidence column. */
export const evidenceKey = (args: ToolArgs, signal: Signal): string => {
  if (WRITE_TOOLS.has(args.tool)) return signal.label
  if (args.tool === 'Bash' && (signal.step === 9 || signal.label.startsWith('Bash '))) return signal.label
  return args.tool
}

/** A call that changes files: a write tool, or a shell command with a write operator. */
export const isWriteCall = (args: ToolArgs): boolean =>
  WRITE_TOOLS.has(args.tool) || (args.tool === 'Bash' && WRITE_OP.test(str(args, 'command')))

// ---- completion, summary and expected agent (1.11.3) ------------------------

export type Check = { id: string; label: string }

/** Each step's checklist, in the order the detail lists it (delivery.md §9). */
export const CHECKLISTS: Record<number, Check[]> = {
  1: [{ id: 'retro-read', label: 'retrospective.md read' }, { id: 'explored', label: 'files read before the first edit' }],
  2: [{ id: 'asked', label: 'questions asked' }, { id: 'answered', label: 'answers received' }],
  3: [
    { id: 'roadmap-edited', label: 'roadmap.md edited' },
    { id: 'roadmap-acceptance', label: 'Intent, Scope and Acceptance written' },
    { id: 'roadmap-status', label: 'status set' },
  ],
  4: [{ id: 'architecture-edited', label: 'architecture.md edited' }, { id: 'adr-written', label: 'an ADR written' }],
  5: [{ id: 'spec-edited', label: 'a spec edited' }, { id: 'gherkin-written', label: 'a Gherkin scenario written' }],
  6: [{ id: 'impact-written', label: 'e2e-impact.md written' }],
  7: [{ id: 'e2e-written', label: 'an E2E spec written' }],
  8: [{ id: 'source-edited', label: 'source files edited' }, { id: 'agents-finished', label: 'no subagent still running' }],
  9: [{ id: 'tests-run', label: 'tests run' }, { id: 'tests-passed', label: 'last run passed' }],
  10: [{ id: 'changelog-written', label: 'changelog entry written' }, { id: 'evidence-written', label: 'evidence added' }],
  11: [{ id: 'retro-written', label: 'retrospective entry written' }],
}

/** The text a write call puts in the file; a shell write's whole command. */
const writtenText = (args: ToolArgs): string => {
  if (args.tool === 'Edit') return str(args, 'new_string')
  if (args.tool === 'Write') return str(args, 'content')
  if (args.tool === 'NotebookEdit') return str(args, 'new_source')
  if (args.tool === 'MultiEdit') {
    const edits = Array.isArray(args.edits) ? (args.edits as unknown[]) : []
    return edits.map(one => (one && typeof one === 'object' ? String((one as { new_string?: unknown }).new_string ?? '') : '')).join('\n')
  }
  return args.tool === 'Bash' ? str(args, 'command') : ''
}

/** The file a write call changes: the tool's path, or a shell write's redirect target or first owned path. */
const writtenPath = (args: ToolArgs): string => {
  if (WRITE_TOOLS.has(args.tool)) return str(args, 'file_path') || str(args, 'notebook_path')
  const command = str(args, 'command')
  const target = /(?:>>?|\btee)\s*"?([^\s"']+)/.exec(command)?.[1]
  return [target ?? '', ...pathsIn(command)].find(path => path !== '' && stepForPath(path) !== null) ?? ''
}

/**
 * The checklist facts one call establishes for the task it is counted for.
 * `beforeFirstWrite` says whether the session had written nothing yet.
 */
export const factsFor = (args: ToolArgs, signal: Signal, beforeFirstWrite: boolean): string[] => {
  const facts: string[] = []
  const writes = isWriteCall(args)
  if (signal.firstAction) facts.push('retro-read')
  if (beforeFirstWrite && !writes) facts.push('explored')
  if (args.tool === 'AskUserQuestion') facts.push('asked')
  if (signal.step === 9 && args.tool === 'Bash') facts.push('tests-run')
  if (!writes) return facts
  const p = writtenPath(args).replace(/\\/g, '/').replace(/^.*\/\.claude\/worktrees\/[^/]+(\/|$)/, '')
  const text = writtenText(args)
  if (/(^|\/)roadmap\.md$/.test(p)) {
    facts.push('roadmap-edited')
    if (/Acceptance/.test(text)) facts.push('roadmap-acceptance')
    if (/🚧|✅/.test(text)) facts.push('roadmap-status')
  } else if (/(^|\/)specs\/system\/architecture\.md$/.test(p)) {
    facts.push('architecture-edited')
    if (/ADR-\d+/.test(text)) facts.push('adr-written')
  } else if (/(^|\/)specs(\/|$)/.test(p)) {
    facts.push('spec-edited')
    if (/Scenario:/.test(text)) facts.push('gherkin-written')
  } else if (/(^|\/)evidence\/[^/]+\/e2e-impact\.md$/.test(p)) {
    facts.push('impact-written')
  } else if (/(^|\/)frontend\/e2e(\/|$)/.test(p) || /(^|\/)backend\/test\/.*\.e2e-spec\.ts$/.test(p)) {
    facts.push('e2e-written')
  } else if (/(^|\/)(frontend\/src|backend\/src|\.claude)(\/|$)/.test(p)) {
    facts.push('source-edited')
  } else if (/(^|\/)changelog\.md$/.test(p) || /(^|\/)changelog\.d\//.test(p)) {
    facts.push('changelog-written')
  } else if (/(^|\/)evidence\//.test(p)) {
    facts.push('evidence-written')
  } else if (/(^|\/)retrospective\.md$/.test(p) || /(^|\/)retrospective\.d\//.test(p)) {
    facts.push('retro-written')
  }
  return facts
}

export type Completion = { checks: { label: string; met: boolean }[]; met: number; total: number; ratio: number }

/**
 * A task's completion: the share of its step's checks met. Two checks read
 * the live task instead of a fact; a step not started yet meets none.
 */
export const completion = (
  step: number,
  facts: readonly string[],
  live: { started: boolean; agentsRunning: boolean; result?: 'passed' | 'failed' },
): Completion => {
  const checks = (CHECKLISTS[step] ?? []).map(check => {
    let met = facts.includes(check.id)
    if (check.id === 'agents-finished') met = !live.agentsRunning
    if (check.id === 'tests-passed') met = live.result === 'passed'
    return { label: check.label, met: live.started && met }
  })
  const met = checks.filter(c => c.met).length
  return { checks, met, total: checks.length, ratio: checks.length === 0 ? 0 : met / checks.length }
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const tally = (entries: [string, number][]): string =>
  entries
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(', ')

/** One line of what a task did, from its evidence counts (delivery.md §9, Summary). */
export const summarize = (
  evidence: Record<string, number>,
  extra: { subagents: number; result?: 'passed' | 'failed' },
): string => {
  const edits: [string, number][] = []
  const shell: [string, number][] = []
  const commands: [string, number][] = []
  let questions = 0
  let reads = 0
  let other = 0
  for (const [key, n] of Object.entries(evidence)) {
    const write = /^(Edit|Write|MultiEdit|NotebookEdit) (.+)$/.exec(key)
    const bash = /^Bash (.+)$/.exec(key)
    if (write) edits.push([write[2] ?? key, n])
    else if (bash) shell.push([bash[1] ?? key, n])
    else if (key === 'AskUserQuestion') questions += n
    else if (READ_TOOLS.has(key)) reads += n
    else if (/^[a-z]/.test(key)) commands.push([key, n])
    else other += n
  }
  const parts: string[] = []
  if (edits.length > 0) parts.push(`Edited ${tally(edits)}`)
  if (shell.length > 0) parts.push(`Shell ${tally(shell)}`)
  if (commands.length > 0) parts.push(`Ran ${tally(commands)}`)
  if (questions > 0) parts.push(plural(questions, 'question'))
  if (reads > 0) parts.push(plural(reads, 'read'))
  if (other > 0) parts.push(plural(other, 'other call'))
  if (extra.result) parts.push(`last run ${extra.result}`)
  if (extra.subagents > 0) parts.push(plural(extra.subagents, 'subagent'))
  return parts.length > 0 ? parts.join(' · ') : 'no calls counted for this step'
}

/** The agent a queued step is expected to use; CLAUDE.md fans steps 7 and 8 out to subagents. */
export const expectedAgent = (step: number): string => (step === 7 || step === 8 ? '~main+sub' : '~main')
