import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Step, StepsSource } from '../types'

const PANE = 'workflow'
const TITLE = 'Workflow'
const CLAUDE_MD = 'CLAUDE.md'

const steps = atom({ plugin: 'workflow-steps', key: 'steps' } as const, [])
const source = atom({ plugin: 'workflow-steps', key: 'source' } as const, '')
const firstAction = atom({ plugin: 'workflow-steps', key: 'firstAction' } as const, '')

// The workflow as CLAUDE.md spelled it on 2026-10-10, shown when the file
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

// The first sentence of a step's description, for a one-line summary.
const firstSentence = (text: string): string => {
  const match = /^(.*?[.!?])(\s|$)/.exec(text)
  return match?.[1] ?? text
}

// Capitalised and ending in one full stop.
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
      found.push({
        number: Number(step[1]),
        title: plain(step[2] ?? ''),
        summary: firstSentence(plain(step[3] ?? '')),
      })
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

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'workflow',
      description: 'Show the CLAUDE.md development workflow steps in a side pane',
    })
    await loadSteps($)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    if (!opened.isPlaced) {
      await $.ui.toast('Workflow steps: run /workflow to open the pane')
    }
    return next(e)
  })

  on('command.run', { command: 'workflow' }, async $ => {
    await loadSteps($)
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, steps)
    const from = await read($, source)
    const first = await read($, firstAction)
    const width = Math.max(24, (e.props.bodyColumns ?? 60) - 2)

    return (
      <Box flexDirection="column">
        <Text bold>Development workflow ({list.length} steps)</Text>
        <Text dimColor wrap="truncate">
          {from === 'claude-md' ? 'From CLAUDE.md in this project.' : 'CLAUDE.md not readable here: built-in copy.'}
        </Text>
        {first !== '' && (
          <Box marginTop={1}>
            <Text color="yellow" wrap="truncate">
              First: {clip(first, width - 7)}
            </Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {list.map(step => (
            <Box key={`step-${step.number}`} flexDirection="column">
              <Text wrap="wrap">
                <Text color="cyan">{String(step.number).padStart(2, ' ')}.</Text>{' '}
                <Text bold>{step.title}</Text>
              </Text>
              <Text dimColor wrap="truncate">
                {'    '}{clip(step.summary, width - 4)}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
