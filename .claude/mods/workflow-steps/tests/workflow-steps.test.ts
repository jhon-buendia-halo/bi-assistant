import { expect, mock, test } from 'claude-code/testing'

const CLAUDE_MD = [
  '## Workflow — order of operations',
  '',
  '> **MANDATORY FIRST ACTION — read [retrospective.md](retrospective.md) before doing anything else.**',
  '',
  '1. **Understand the goal** — restate the request.',
  '2. **Ask clarifying questions until the goal is 100% understood** — scope.',
  '3. **Update roadmap** — find or add the feature.',
  '4. **Update architecture** — record an ADR.',
  '5. **Update specs** — update every spec.',
  '6. **Component impact-based analysis on E2E** — enumerate.',
  '7. **Implement / update / delete E2E** — apply.',
  '8. **Implement changes** — only now.',
  '9. **Run E2E and fix until green** — run.',
  '10. **Update changelog with evidence** — add.',
  '11. **Retrospective** — add a dated entry.',
  '',
  '## Next',
].join('\n')

const PANE = {
  plugin: 'workflow-steps',
  component: 'Pane',
  requestId: 'workflow',
  viewport: { columns: 160, rows: 60 },
  props: { title: 'Workflow', isFocused: false, bodyColumns: 130, placement: 'dock', scroll: { offset: 0, bodyRows: 56 }, view: {} },
} as const
const NARROW = { ...PANE, props: { ...PANE.props, bodyColumns: 96 } } as const

type On = Parameters<Parameters<typeof test>[1]>[1]

// Stubs for everything the mod calls, with a session cost the test can raise.
const world = (on: On, opts: { claudeMd?: string; failCommands?: RegExp } = {}) => {
  const state = { usd: 0 }
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.read', ($, e) =>
    e.path.endsWith('CLAUDE.md') && opts.claudeMd !== null ? { value: opts.claudeMd ?? CLAUDE_MD } : { deny: 'no such file' },
  )
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd: state.usd } } }))
  on('tool.call', ($, e) => {
    const cmd = typeof (e as { command?: unknown }).command === 'string' ? ((e as { command: string }).command) : ''
    if (opts.failCommands && cmd && opts.failCommands.test(cmd)) return { isError: true, result: 'exit 1' }
    return { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'agent-1' }))
  return { state, clock }
}

const start = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

const edit = ($: Parameters<Parameters<typeof test>[1]>[0], file_path: string, tool = 'Edit') =>
  $.tool.call({ tool, file_path, old_string: '', new_string: '' })
const read = ($: Parameters<Parameters<typeof test>[1]>[0], file_path: string) => $.tool.call({ tool: 'Read', file_path })
const bash = ($: Parameters<Parameters<typeof test>[1]>[0], command: string) => $.tool.call({ tool: 'Bash', command })

const turn = ($: Parameters<Parameters<typeof test>[1]>[0], input: number, output: number, cached = 0) =>
  $.turn.complete({
    turnId: 't', answer: 'done', durationMs: 1000, isAborted: false,
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, model: 'claude-test' },
  })

const text = async (ui: { find: (q: { type: 'Text'; text: RegExp }) => Promise<{ text?: string } | undefined> }, re: RegExp) =>
  (await ui.find({ type: 'Text', text: re }))?.text

test('task #1 runs from the start and every other step is queued with its future number', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /▸ #1 running · 10 queued .*overall 0%/)).toBeDefined()
  expect(await text(ui, /^RUNNING$/)).toBeDefined()
  expect(await text(ui, /#1 .*Understand the goal/)).toBeDefined()
  expect(await text(ui, /#2 +Ask clarifying questions.*step 2 +~main .*0%/)).toBeDefined()
  expect(await text(ui, /#8 +Implement changes.*step 8 +~main\+sub/)).toBeDefined()
  expect(await text(ui, /#11 +Retrospective.*step 11/)).toBeDefined()
  expect(await text(ui, /retrospective read –/)).toBeDefined()
  await ui.unmount()
})

test('reads stay in #1, a question and a roadmap edit are strong signals that start #2 and #3 at once', async ($, on) => {
  world(on)
  await start($)
  await read($, '/work/retrospective.md')
  await read($, '/work/README.md')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await edit($, '/work/roadmap.md')
  await edit($, '/work/roadmap.md')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /retrospective read ✓/)).toBeDefined()
  expect(await text(ui, /#1 +Understand the goal.*100%.*2 reads/)).toBeDefined()
  expect(await text(ui, /#2 +Ask clarifying questions.*100%.*1 question/)).toBeDefined()
  expect(await text(ui, /#3 +Update roadmap.*Edited roadmap\.md ×2/)).toBeDefined()
  expect(await text(ui, /▸ #3 running · 8 queued/)).toBeDefined()
  // Steps 4 to 11 are queued from #4.
  expect(await text(ui, /#4 +Update architecture.*step 4/)).toBeDefined()
  await ui.unmount()
})

test('a weak signal opens a tentative task that earns its number after three matched calls', async ($, on) => {
  world(on)
  await start($)
  await edit($, '/work/roadmap.md')
  await read($, '/work/specs/system/ui.md')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /^TENTATIVE$/)).toBeDefined()
  expect(await text(ui, /#3\? +Update specs.*step 5/)).toBeDefined()
  expect(await text(ui, /▸ #2 running/)).toBeDefined()
  // While tentative, the queued numbers start one later.
  expect(await text(ui, /#4 +Update architecture.*step 4/)).toBeDefined()
  expect(await text(ui, /#5 +Component impact-based analysis.*step 6/)).toBeDefined()
  await ui.unmount()
  await read($, '/work/specs/system/api.md')
  await read($, '/work/specs/system/data-model.md')
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /^TENTATIVE$/)).toBeUndefined()
  expect(await text(ui, /▸ #3 running/)).toBeDefined()
  expect(await text(ui, /#3 +Update specs.*3 reads/)).toBeDefined()
  expect(await text(ui, /#2 +Update roadmap.*step 3/)).toBeDefined()
  await ui.unmount()
})

test('three unmatched calls drop a tentative task, and a call for the running step drops it too', async ($, on) => {
  world(on)
  await start($)
  await edit($, '/work/roadmap.md')
  await read($, '/work/frontend/src/app/app.ts')
  await bash($, 'ls')
  await bash($, 'git status')
  await bash($, 'pwd')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /^TENTATIVE$/)).toBeUndefined()
  expect(await text(ui, /▸ #2 running/)).toBeDefined()
  await ui.unmount()
  await read($, '/work/frontend/src/app/app.ts')
  await edit($, '/work/roadmap.md')
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /^TENTATIVE$/)).toBeUndefined()
  expect(await text(ui, /#2 +Update roadmap.*Edited roadmap\.md ×2/)).toBeDefined()
  await ui.unmount()
})

test('a step that runs again gets a new number, and a test run is marked failed or passed', async ($, on) => {
  world(on, { failCommands: /test:e2e --first/ })
  await start($)
  await edit($, '/work/frontend/src/a.ts')
  await bash($, 'npm run test:e2e --first')
  await edit($, '/work/frontend/src/a.ts')
  await bash($, 'npm run test:e2e')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /#2 +Implement changes.*step 8/)).toBeDefined()
  expect(await text(ui, /#3 +Run E2E and fix until green.*✗ failed/)).toBeDefined()
  expect(await text(ui, /#4 +Implement changes.*step 8/)).toBeDefined()
  expect(await text(ui, /#5 +Run E2E and fix until green.*✓ passed/)).toBeDefined()
  expect(await text(ui, /▸ #5 running · 2 queued/)).toBeDefined()
  expect(await text(ui, /#6 +Update changelog with evidence.*step 10/)).toBeDefined()
  expect(await text(ui, /no signal yet: .*step 3.*step 7/)).toBeDefined()
  await ui.unmount()
})

test('turn usage goes to the running task and cost is the session delta', async ($, on) => {
  const { state, clock } = world(on)
  await start($)
  state.usd = 0.08
  await clock.advance(65_000)
  await turn($, 4000, 1000, 20000)
  await edit($, '/work/roadmap.md')
  state.usd = 0.3
  await clock.advance(161_000)
  await turn($, 10000, 2300)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /#1 +Understand the goal.*1:05.*5\.0k.*\$0\.08/)).toBeDefined()
  expect(await text(ui, /#2 +Update roadmap.*2:41.*12\.3k.*\$0\.22/)).toBeDefined()
  expect(await text(ui, /17\.3k · \$0\.30/)).toBeDefined()
  await ui.unmount()
})

test('a subagent spawned during a task is listed under it, and done rows count agents', async ($, on) => {
  world(on)
  await start($)
  await edit($, '/work/frontend/src/a.ts')
  await $.agent.spawn({
    tool_use_id: 'u1', prompt: 'find fixtures', description: 'app fixture helpers', subagentType: 'Explore',
    provider: { plugin: 'engine' }, parentModel: 'claude-fable-5-1', background: false, fork: false,
  })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /↳ Explore · claude-haiku-4-5 · "app fixture helpers".*●/)).toBeDefined()
  await ui.unmount()
  await turn($, 100, 10)
  await edit($, '/work/changelog.md')
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /#2 +Implement changes.*main \+1.*1 subagent/)).toBeDefined()
  await ui.unmount()
})

test('done tasks beyond the last twelve fold into one line', async ($, on) => {
  world(on)
  await start($)
  for (let i = 0; i < 15; i++) {
    await edit($, '/work/roadmap.md')
    await edit($, '/work/changelog.md')
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /… 18 earlier tasks/)).toBeDefined()
  expect(await text(ui, /#20 +Update roadmap/)).toBeDefined()
  expect(await text(ui, /#19 +Update changelog with evidence/)).toBeDefined()
  expect(await text(ui, /#1 +Understand the goal/)).toBeUndefined()
  await ui.unmount()
})

test('/workflow reset clears the queue, starts #1 again and closes open rows', async ($, on) => {
  world(on)
  await start($)
  await edit($, '/work/roadmap.md')
  await edit($, '/work/specs/system/ui.md')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'row-1' })
  await ui.unmount()
  const answer = await $.command.run({ command: 'workflow', args: 'reset' })
  expect(answer.text).toMatch(/reset/)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /▸ #1 running · 10 queued/)).toBeDefined()
  expect(await text(ui, /Update specs.*step 5/)).toBeDefined()
  expect(await text(ui, /Summary/)).toBeUndefined()
  await ui.unmount()
})

// ---- task details (1.11.3) ---------------------------------------------------

const ask = ($: Parameters<Parameters<typeof test>[1]>[0]) => $.tool.call({ tool: 'AskUserQuestion', questions: [] })
const write = ($: Parameters<Parameters<typeof test>[1]>[0], file_path: string, new_string: string) =>
  $.tool.call({ tool: 'Edit', file_path, old_string: '', new_string })

test('a narrow pane keeps whole titles and the figures, and leaves the summary to the detail', async ($, on) => {
  world(on)
  await start($)
  await write($, '/work/roadmap.md', 'Intent only')
  let ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  expect(await text(ui, /#5 +Component impact-based analysis.*step 6/)).toBeDefined()
  expect(await text(ui, /#2 +Update roadmap.*33% ▸$/)).toBeDefined()
  await ui.press({ key: 'row-2' })
  await ui.unmount()
  ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  expect(await text(ui, /Summary +Edited roadmap\.md$/)).toBeDefined()
  await ui.unmount()
})

test('in a sidebar 74 columns wide every row fits on one line, keeping the title, the figures that fit and the %', async ($, on) => {
  world(on, { failCommands: /test:e2e/ })
  await start($)
  await edit($, '/work/frontend/src/a.ts')
  await bash($, 'npm run test:e2e')
  const SIDEBAR = { ...PANE, props: { ...PANE.props, bodyColumns: 74 } } as const
  const ui = await $.ui.mount({ ...SIDEBAR, surface: 'terminal' })
  // #1, #2 (step 8) and #3 (step 9, failed) ran; steps 10 and 11 are queued.
  const rows = (await ui.findAll({ type: 'Text', text: /^  #\d+.* [▸▾]/ })).map(r => r.text ?? '')
  expect(rows.length).toBe(5)
  for (const row of rows) expect(row.length).toBeLessThanOrEqual(72)
  // No room for "✗ failed" here: the % carries the result instead, drawn red.
  expect(rows.find(r => /#3 +Run E2E and fix/.test(r))).toMatch(/ 50% ▸$/)
  expect((await ui.find({ type: 'Text', text: /^ 50%$/ }))?.props).toMatchObject({ color: 'red' })
  expect(rows.find(r => /#4 +Update changelog/.test(r))).toMatch(/ 0% ▸$/)
  await ui.unmount()
})

test("step 1's checks are the session's: the first action and reads before the first write, whichever task the calls landed in", async ($, on) => {
  world(on)
  await start($)
  // Found in a live session: a shell read of retrospective.md is a step-11 signal and a read of
  // roadmap.md a step-3 one, so neither call is counted for #1.
  await bash($, 'head -120 retrospective.md')
  await read($, '/work/roadmap.md')
  await edit($, '/work/frontend/src/a.ts')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /retrospective read ✓/)).toBeDefined()
  expect(await text(ui, /#1 +Understand the goal.*100%/)).toBeDefined()
  await ui.unmount()
})

test("a row's completion is the share of its step checklist met", async ($, on) => {
  world(on)
  await start($)
  await write($, '/work/roadmap.md', 'Intent only')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /#2 +Update roadmap.*33%/)).toBeDefined()
  await ui.unmount()
  await write($, '/work/roadmap.md', '`🚧 In progress`\n- **Acceptance:** done')
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /#2 +Update roadmap.*100%/)).toBeDefined()
  // #1 read nothing before the first write: only the first action can count, and it did not happen.
  expect(await text(ui, /#1 +Understand the goal.*0%/)).toBeDefined()
  await ui.unmount()
})

test('a press opens a detail under the row, a second press closes it, and two rows can stay open', async ($, on) => {
  world(on)
  await start($)
  await read($, '/work/retrospective.md')
  await write($, '/work/roadmap.md', 'Intent only')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /Summary/)).toBeUndefined()
  await ui.press({ key: 'row-2' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /#2 +Update roadmap.*▾/)).toBeDefined()
  expect(await text(ui, /Summary +Edited roadmap\.md$/)).toBeDefined()
  expect(await text(ui, /Progress +1 of 3 checks · 33%/)).toBeDefined()
  expect(await text(ui, /✓ roadmap\.md edited/)).toBeDefined()
  expect(await text(ui, /○ Intent, Scope and Acceptance written/)).toBeDefined()
  expect(await text(ui, /○ status set/)).toBeDefined()
  expect(await text(ui, /Cost +\$0\.00 while the task ran · confidence 100% \(1 of 1 calls matched\)/)).toBeDefined()
  await ui.press({ key: 'row-1' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /✓ retrospective\.md read/)).toBeDefined()
  expect(await text(ui, /✓ roadmap\.md edited/)).toBeDefined()
  await ui.press({ key: 'row-2' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /roadmap\.md edited/)).toBeUndefined()
  expect(await text(ui, /✓ retrospective\.md read/)).toBeDefined()
  await ui.unmount()
})

test("a queued step's detail shows what is expected of it", async ($, on) => {
  world(on)
  await start($)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'queued-9' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /Summary +Expected: run\./)).toBeDefined()
  expect(await text(ui, /Progress +0 of 2 checks · 0%/)).toBeDefined()
  expect(await text(ui, /○ tests run/)).toBeDefined()
  expect(await text(ui, /○ last run passed/)).toBeDefined()
  expect(await text(ui, /Agents +main \(expected\)/)).toBeDefined()
  expect(await text(ui, /^ *Cost /)).toBeUndefined()
  await ui.unmount()
})

test('the header shows the overall completion: the mean of the done, running and queued rows', async ($, on) => {
  world(on)
  await start($)
  await read($, '/work/retrospective.md')
  await ask($)
  // #1 100% (both checks), #2 100% (asked, answered), nine queued at 0%: 200 / 11 rows.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /#2 +Ask clarifying questions.*100%/)).toBeDefined()
  expect(await text(ui, /overall 18%/)).toBeDefined()
  await ui.unmount()
})

test("a subagent's own turn credits its tokens to it and to the task it was spawned under, and marks it finished", async ($, on) => {
  world(on)
  await start($)
  await edit($, '/work/frontend/src/a.ts')
  await $.agent.spawn({
    tool_use_id: 'u1', prompt: 'write tests', description: 'rules tests', subagentType: 'general-purpose',
    provider: { plugin: 'engine' }, parentModel: 'claude-fable-5-1', background: false, fork: false,
  })
  await $.turn.complete({
    turnId: 's', answer: 'done', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'agent-1',
    usage: { input_tokens: 3000, output_tokens: 1100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' },
  })
  await turn($, 2000, 500)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /#2 +Implement changes.*main \+1.*6\.6k/)).toBeDefined()
  await ui.press({ key: 'row-2' })
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /Agents +main +2\.5k/)).toBeDefined()
  expect(await text(ui, /↳ general-purpose · claude-haiku-4-5 · "rules tests" +4\.1k +✓/)).toBeDefined()
  expect(await text(ui, /✓ no subagent still running/)).toBeDefined()
  await ui.unmount()
})

test('without a readable CLAUDE.md the built-in step titles are used', async ($, on) => {
  world(on, { claudeMd: null as unknown as string })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await text(ui, /built-in copy/)).toBeDefined()
  expect(await text(ui, /#8 +Implement changes.*step 8/)).toBeDefined()
  await ui.unmount()
})
