import { expect, test } from 'claude-code/testing'

const CLAUDE_MD = [
  '# Project',
  '',
  '## Workflow — order of operations',
  '',
  '> **MANDATORY FIRST ACTION — read [retrospective.md](retrospective.md) before doing anything else.** More words.',
  '',
  '1. **Understand the goal** — restate the request in your own words before touching anything. What outcome?',
  '2. **Ask clarifying questions until the goal is 100% understood** — scope, behaviour, edge cases.',
  '3. **Update roadmap** — find or add the feature in [roadmap.md](roadmap.md) with `Intent`. See **Planning convention**.',
  '4. **Update architecture** — record it as an ADR.',
  '5. **Update specs** — before any test or code, update every spec.',
  '6. **Component impact-based analysis on E2E** — enumerate the scenarios.',
  '7. **Implement / update / delete E2E** — apply the step-6 decisions first.',
  '8. **Implement changes** — only now is production code touched.',
  '9. **Run E2E and fix until green** — `npm run test:e2e` in [frontend/](frontend/).',
  '10. **Update changelog with evidence** — only after step 9 is green.',
  '11. **Retrospective** — add a dated entry.',
  '',
  '## Planning convention',
  '',
  '1. **Not a step** — this list belongs to another section.',
].join('\n')

const PANE = {
  plugin: 'workflow-steps',
  component: 'Pane',
  requestId: 'workflow',
  viewport: { columns: 160, rows: 40 },
  props: {
    title: 'Workflow',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 36 },
    view: {},
  },
} as const

const stubs = (on: Parameters<Parameters<typeof test>[1]>[1], claudeMd: string | undefined) => {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.read', ($, e) => {
    if (claudeMd !== undefined && e.path.endsWith('CLAUDE.md')) return { value: claudeMd }
    return { deny: 'no such file' }
  })
}

test('the pane lists the eleven steps parsed from CLAUDE.md on every surface', async ($, on) => {
  stubs(on, CLAUDE_MD)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Development workflow \(11 steps\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /From CLAUDE\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^First: Read retrospective\.md before doing anything else\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Understand the goal$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Retrospective$/ })).toBeDefined()
    // Markdown is stripped from summaries and only the first sentence is kept.
    expect(await ui.find({ type: 'Text', text: /find or add the feature in roadmap\.md with Intent\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /What outcome\?/ })).toBeUndefined()
    // The numbered list of the next section is not a step.
    expect(await ui.find({ type: 'Text', text: /Not a step/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('/workflow re-reads CLAUDE.md and opens the pane', async ($, on) => {
  let opens = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => {
    opens += 1
    return { value: { isPlaced: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('fs.read', () => ({ value: CLAUDE_MD }))

  const answer = await $.command.run({ command: 'workflow', args: '' })
  expect(answer.text).toBeUndefined()
  expect(opens).toBe(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\(11 steps\)/ })).toBeDefined()
  await ui.unmount()
})

test('without a readable CLAUDE.md the built-in copy of the steps is shown', async ($, on) => {
  stubs(on, undefined)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/elsewhere' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\(11 steps\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /built-in copy/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Implement changes$/ })).toBeDefined()
  await ui.unmount()
})

test('a CLAUDE.md without a Workflow section falls back too', async ($, on) => {
  stubs(on, '# Nothing here\n\n## Other\n\n1. **Thing** — not the workflow.\n')
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /built-in copy/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Thing$/ })).toBeUndefined()
  await ui.unmount()
})
