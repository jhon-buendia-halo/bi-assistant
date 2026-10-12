import { expect, test } from 'claude-code/testing'

import { classify, completion, expectedAgent, factsFor, summarize } from '../hooks/rules'

const edit = (file_path: string, tool = 'Edit') => ({ tool, file_path })
const facts = (args: { tool: string } & Record<string, unknown>, beforeFirstWrite = false) =>
  factsFor(args, classify(args, !beforeFirstWrite), beforeFirstWrite)
const bash = (command: string) => ({ tool: 'Bash', command })

test('writes map to the step that owns the file', async () => {
  expect(classify(edit('/work/roadmap.md'), true)).toMatchObject({ step: 3, strong: true, label: 'Edit roadmap.md' })
  expect(classify(edit('/work/specs/system/architecture.md'), true)).toMatchObject({ step: 4, strong: true })
  expect(classify(edit('/work/specs/capabilities/app-shell/spec.md'), true)).toMatchObject({ step: 5, strong: true })
  expect(classify(edit('/work/evidence/1.11.2/e2e-impact.md', 'Write'), true)).toMatchObject({ step: 6, strong: true })
  expect(classify(edit('/work/frontend/e2e/navigation.spec.ts'), true)).toMatchObject({ step: 7, strong: true })
  expect(classify(edit('/work/backend/test/user-agents.e2e-spec.ts'), true)).toMatchObject({ step: 7, strong: true })
  expect(classify(edit('/work/frontend/src/app/app.ts'), true)).toMatchObject({ step: 8, strong: true })
  expect(classify(edit('/work/backend/src/main.ts', 'MultiEdit'), true)).toMatchObject({ step: 8, strong: true })
  expect(classify(edit('/work/.claude/mods/workflow-steps/hooks/register.tsx'), true)).toMatchObject({ step: 8, strong: true })
  expect(classify(edit('/work/changelog.md'), true)).toMatchObject({ step: 10, strong: true })
  expect(classify(edit('/work/evidence/1.11.2/README.md', 'Write'), true)).toMatchObject({ step: 10, strong: true })
  expect(classify(edit('/work/retrospective.md'), true)).toMatchObject({ step: 11, strong: true })
})

test('reads of owned files are weak signals for the same step', async () => {
  expect(classify({ tool: 'Read', file_path: '/work/specs/system/ui.md' }, true)).toMatchObject({ step: 5, strong: false, label: 'Read ui.md' })
  expect(classify({ tool: 'Grep', pattern: 'x', path: '/work/frontend/src' }, true)).toMatchObject({ step: 8, strong: false })
  expect(classify({ tool: 'Glob', pattern: 'frontend/e2e/*.spec.ts' }, true)).toMatchObject({ step: 7, strong: false })
})

test('before the first write every read is step 1, and retrospective.md is the first action', async () => {
  expect(classify({ tool: 'Read', file_path: '/work/README.md' }, false)).toMatchObject({ step: 1, strong: false })
  expect(classify({ tool: 'Grep', pattern: 'x', path: '/work' }, false)).toMatchObject({ step: 1, strong: false })
  expect(classify({ tool: 'Read', file_path: '/work/retrospective.md' }, false)).toMatchObject({ step: 1, firstAction: true })
  // After the first write, an unowned read matches nothing.
  expect(classify({ tool: 'Read', file_path: '/work/README.md' }, true)).toMatchObject({ step: null })
})

test('questions and test commands are strong signals', async () => {
  expect(classify({ tool: 'AskUserQuestion', questions: [] }, true)).toMatchObject({ step: 2, strong: true, label: 'AskUserQuestion' })
  expect(classify(bash('cd frontend && npm run test:e2e'), true)).toMatchObject({ step: 9, strong: true, label: 'npm run test:e2e' })
  expect(classify(bash('python3 scripts/check-specs.py'), true)).toMatchObject({ step: 9, strong: true })
  expect(classify(bash('npm --prefix backend run build'), true)).toMatchObject({ step: 9, strong: true })
  expect(classify(bash('npx jest src/x.spec.ts'), true)).toMatchObject({ step: 9, strong: true })
  expect(classify(bash('ls -la'), true)).toMatchObject({ step: null, label: 'ls -la' })
})

test('shell commands that name an owned file count for its step, strongly when they write', async () => {
  expect(classify(bash("cat > /work/roadmap.md <<'EOF'\n# x\nEOF"), true)).toMatchObject({ step: 3, strong: true, label: 'Bash roadmap.md' })
  expect(classify(bash("printf 'hello' > evidence/1.11.2/scratch.md && cat evidence/1.11.2/scratch.md"), true)).toMatchObject({ step: 10, strong: true })
  expect(classify(bash('sed -i "" "s/a/b/" specs/system/ui.md'), true)).toMatchObject({ step: 5, strong: true })
  expect(classify(bash('sed -n 1,40p specs/system/delivery.md'), true)).toMatchObject({ step: 5, strong: false, label: 'Bash delivery.md' })
  expect(classify(bash('grep -n Workflow CLAUDE.md roadmap.md'), true)).toMatchObject({ step: 3, strong: false })
  expect(classify(bash('head -120 retrospective.md'), false)).toMatchObject({ step: 11, strong: false, firstAction: true })
  expect(classify(bash('cd frontend && npm run test:e2e'), true)).toMatchObject({ step: 9 })
  // The redirect target wins over an earlier path in the same command.
  expect(classify(bash('cd /Users/me/repo && printf hello > evidence/1.11.2/scratch.md && cat specs/system/ui.md'), true)).toMatchObject({ step: 10, strong: true, label: 'Bash scratch.md' })
})

test('paths inside a worktree checkout are matched past the .claude/worktrees prefix', async () => {
  expect(classify(edit('/Users/me/repo/.claude/worktrees/BA-169-x/roadmap.md'), true)).toMatchObject({ step: 3 })
  expect(classify(edit('/Users/me/repo/.claude/worktrees/BA-169-x/.claude/mods/m/hooks/register.tsx'), true)).toMatchObject({ step: 8 })
  expect(classify(bash('cd /Users/me/repo/.claude/worktrees/BA-169-x && printf hello > evidence/1.11.2/scratch.md'), true)).toMatchObject({ step: 10, strong: true, label: 'Bash scratch.md' })
  expect(classify(bash('cd /Users/me/repo/.claude/worktrees/BA-169-x && git status'), true)).toMatchObject({ step: null })
  expect(classify(bash('cd /Users/me/repo/.claude/worktrees/BA-169-x && git status'), false)).toMatchObject({ step: 1 })
})

test('anything else matches nothing once something has been written, and is step 1 before', async () => {
  expect(classify({ tool: 'WebSearch', query: 'x' }, true)).toMatchObject({ step: null })
  expect(classify({ tool: 'mcp__x__y', foo: 1 }, true)).toMatchObject({ step: null })
  expect(classify(bash('ls -la'), true)).toMatchObject({ step: null })
  expect(classify({ tool: 'WebSearch', query: 'x' }, false)).toMatchObject({ step: 1, strong: false })
  expect(classify(bash('rg milestone README.md'), false)).toMatchObject({ step: 1, strong: false, label: 'rg milestone README.md' })
  // A search that names an owned file is a weak signal for that step even before any write.
  expect(classify(bash('rg milestone roadmap.md'), false)).toMatchObject({ step: 3, strong: false, label: 'Bash roadmap.md' })
})

test('each step checklist reads its facts off the call: the path written and the written text', async () => {
  expect(facts({ tool: 'Read', file_path: '/work/retrospective.md' }, true)).toEqual(['retro-read', 'explored'])
  expect(facts({ tool: 'Grep', pattern: 'x', path: '/work' }, true)).toEqual(['explored'])
  expect(facts({ tool: 'Read', file_path: '/work/README.md' })).toEqual([])
  expect(facts({ tool: 'AskUserQuestion', questions: [] })).toEqual(['asked'])
  expect(facts({ tool: 'Edit', file_path: '/work/roadmap.md', new_string: 'x' })).toEqual(['roadmap-edited'])
  expect(facts({ tool: 'Edit', file_path: '/work/roadmap.md', new_string: '`🚧 In progress`\n- **Acceptance:** y' })).toEqual([
    'roadmap-edited', 'roadmap-acceptance', 'roadmap-status',
  ])
  expect(facts({ tool: 'Write', file_path: '/work/specs/system/architecture.md', content: '#### ADR-0015 — x' })).toEqual([
    'architecture-edited', 'adr-written',
  ])
  expect(facts({ tool: 'MultiEdit', file_path: '/work/specs/capabilities/x/spec.md', edits: [{ new_string: 'a' }, { new_string: '  Scenario: b' }] })).toEqual([
    'spec-edited', 'gherkin-written',
  ])
  expect(facts({ tool: 'Write', file_path: '/work/evidence/1.11.3/e2e-impact.md', content: 'x' })).toEqual(['impact-written'])
  expect(facts({ tool: 'Edit', file_path: '/work/frontend/e2e/nav.spec.ts', new_string: 'x' })).toEqual(['e2e-written'])
  expect(facts({ tool: 'Edit', file_path: '/work/backend/src/main.ts', new_string: 'x' })).toEqual(['source-edited'])
  expect(facts(bash('cd frontend && npm run test:e2e'))).toEqual(['tests-run'])
  expect(facts({ tool: 'Edit', file_path: '/work/changelog.md', new_string: 'x' })).toEqual(['changelog-written'])
  expect(facts({ tool: 'Write', file_path: '/work/changelog.d/BA-174.md', content: 'x' })).toEqual(['changelog-written'])
  expect(facts({ tool: 'Write', file_path: '/work/evidence/1.11.3/README.md', content: 'x' })).toEqual(['evidence-written'])
  expect(facts({ tool: 'Edit', file_path: '/work/retrospective.md', new_string: 'x' })).toEqual(['retro-written'])
  expect(facts({ tool: 'Write', file_path: '/work/retrospective.d/BA-174.md', content: 'x' })).toEqual(['retro-written'])
  // A shell write counts its redirect target and its command as the written text; a shell read writes nothing.
  expect(facts(bash("cat > roadmap.md <<'EOF'\n- **Acceptance:** y\nEOF"))).toEqual(['roadmap-edited', 'roadmap-acceptance'])
  expect(facts(bash('grep -n Acceptance roadmap.md'))).toEqual([])
})

test('completion is the share of the step checklist met, with two checks read from the live task', async () => {
  expect(completion(3, ['roadmap-edited'], { started: true, agentsRunning: false })).toMatchObject({ met: 1, total: 3 })
  expect(completion(3, ['roadmap-edited', 'roadmap-acceptance', 'roadmap-status'], { started: true, agentsRunning: false }).ratio).toBe(1)
  expect(completion(8, ['source-edited'], { started: true, agentsRunning: true })).toMatchObject({ met: 1, total: 2 })
  expect(completion(8, ['source-edited'], { started: true, agentsRunning: false })).toMatchObject({ met: 2, total: 2 })
  expect(completion(9, ['tests-run'], { started: true, agentsRunning: false, result: 'failed' })).toMatchObject({ met: 1, total: 2 })
  expect(completion(9, ['tests-run'], { started: true, agentsRunning: false, result: 'passed' })).toMatchObject({ met: 2, total: 2 })
  // A step not started yet meets nothing, live checks included.
  expect(completion(8, [], { started: false, agentsRunning: false })).toMatchObject({ met: 0, total: 2, ratio: 0 })
  expect(completion(2, ['asked'], { started: true, agentsRunning: false }).checks).toEqual([
    { label: 'questions asked', met: true },
    { label: 'answers received', met: false },
  ])
})

test('the summary lists edits, shell paths, commands, questions, reads, other calls, the result and subagents', async () => {
  expect(summarize({}, { subagents: 0 })).toBe('no calls counted for this step')
  expect(summarize({ Read: 4, Grep: 1, Glob: 2 }, { subagents: 0 })).toBe('7 reads')
  expect(summarize({ 'Edit roadmap.md': 2, 'Write ui.md': 1, Read: 1 }, { subagents: 0 })).toBe('Edited roadmap.md ×2, ui.md · 1 read')
  expect(summarize({ 'Bash scratch.md': 1, AskUserQuestion: 2, WebSearch: 1 }, { subagents: 0 })).toBe('Shell scratch.md · 2 questions · 1 other call')
  expect(summarize({ 'npm run test:e2e': 2, 'python3 scripts/check-specs.py': 1 }, { subagents: 0, result: 'passed' })).toBe(
    'Ran npm run test:e2e ×2, python3 scripts/check-specs.py · last run passed',
  )
  expect(summarize({ 'Edit a.ts': 1 }, { subagents: 2 })).toBe('Edited a.ts · 2 subagents')
})

test('a queued step names the agent it is expected to use', async () => {
  expect(expectedAgent(3)).toBe('~main')
  expect(expectedAgent(7)).toBe('~main+sub')
  expect(expectedAgent(8)).toBe('~main+sub')
  expect(expectedAgent(11)).toBe('~main')
})
