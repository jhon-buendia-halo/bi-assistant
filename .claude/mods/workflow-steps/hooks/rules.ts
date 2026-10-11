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
  // Stories write fragments (changelog.d/, retrospective.d/); the release workflow collects them.
  if (/(^|\/)changelog\.md$/.test(p) || /(^|\/)changelog\.d(\/|$)/.test(p) || /(^|\/)evidence(\/|$)/.test(p)) return 10
  if (/(^|\/)retrospective\.md$/.test(p) || /(^|\/)retrospective\.d(\/|$)/.test(p)) return 11
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
