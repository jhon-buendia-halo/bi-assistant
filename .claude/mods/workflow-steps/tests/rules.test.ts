import { expect, test } from 'claude-code/testing'

import { classify } from '../hooks/rules'

const edit = (file_path: string, tool = 'Edit') => ({ tool, file_path })
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
  expect(classify(edit('/work/changelog.d/BA-173.md'), true)).toMatchObject({ step: 10, strong: true })
  expect(classify(edit('/work/retrospective.d/BA-173.md'), true)).toMatchObject({ step: 11, strong: true })
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
