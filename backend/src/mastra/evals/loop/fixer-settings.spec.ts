/**
 * Guard of the improvement loop fixer's locks (delivery.md section 2,
 * *Improvement loop*): the deny rules of `.claude/tools/eval-loop/
 * fixer-settings.json` cover every path the loop must protect, never a lever
 * file, and agree with what `start-fixer.sh` deletes and `collect-fixer.sh`
 * collects. Claude Code's own matching is proved by the headless `claude -p`
 * smoke run of the tool's README; this test holds the lists to each other.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT } from './cli-args';
import { isLeverFile, LEVER_PATHS } from './leak-check';

const TOOL_DIR = join(REPO_ROOT, '.claude', 'tools', 'eval-loop');

interface Settings {
  permissions?: { deny?: string[]; allow?: string[]; ask?: string[] };
  [key: string]: unknown;
}

const settings = JSON.parse(
  readFileSync(join(TOOL_DIR, 'fixer-settings.json'), 'utf8'),
) as Settings;
const deny = settings.permissions?.deny ?? [];
const startScript = readFileSync(join(TOOL_DIR, 'start-fixer.sh'), 'utf8');
const collectScript = readFileSync(join(TOOL_DIR, 'collect-fixer.sh'), 'utf8');

/** The entries of a bash array `NAME=( … )` in a script. */
function bashArray(script: string, name: string): string[] {
  const match = new RegExp(`^${name}=\\(\\n([\\s\\S]*?)\\n\\)`, 'm').exec(
    script,
  );
  if (!match) throw new Error(`no ${name} array`);
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** A gitignore-style pattern (`**`, `*`) as a regular expression. */
function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i += 1;
      if (glob[i + 1] === '/') {
        i += 1;
        source += '(?:.*/)?';
      } else {
        source += '.*';
      }
    } else if (c === '*') {
      source += '[^/]*';
    } else {
      source += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** Whether a rule of `tool` denies `path` (relative to the tree, or absolute). */
function denies(tool: 'Edit' | 'Read', path: string): boolean {
  return deny.some((rule) => {
    const match = /^(\w+)\((.*)\)$/.exec(rule);
    if (!match || match[1] !== tool) return false;
    const pattern = match[2];
    if (pattern.startsWith('//')) {
      return (
        path.startsWith('/') &&
        globToRegExp(pattern.slice(2)).test(path.slice(1))
      );
    }
    if (pattern.startsWith('~/')) return false;
    return !path.startsWith('/') && globToRegExp(pattern).test(path);
  });
}

/** Where the fixer's tree really sits: under `.claude/worktrees/`. */
const TREE =
  '/Users/dev/repo/.claude/worktrees/BA-9-golden-dataset-evals/.eval-loop/fixer/r1/tree';

const LEVER_SAMPLES = [
  'backend/src/mastra/agents/assistant-prompt.ts',
  'backend/src/mastra/skills/curated-knowledge/SKILL.md',
  'backend/src/mastra/tools/dataset.tools.ts',
  'backend/src/mastra/context-blocks.ts',
  'backend/src/mastra/tool-section.ts',
  'backend/src/modules/sessions/sessions.service.ts',
  'backend/src/modules/testing-data/fixtures/knowledge/finance.ts',
];

/** Forbidden to edit (plan B.5(a), decision D4): sets, checks, harness, … */
const EDIT_FORBIDDEN = [
  'backend/src/mastra/evals/sets/finance.json',
  'backend/src/mastra/evals/checks/dialect.ts',
  'backend/src/mastra/evals/assistant.evals.ts',
  'backend/scripts/check-answers.ts',
  'docker/postgres/generate/finance.ts',
  'backend/src/modules/testing-data/fixtures/007_finance.sql',
  'backend/src/modules/testing-data/fixtures/002_formula_1.sql.gz',
  'backend/src/modules/testing-data/fixtures/registry.ts',
  'docs/evals/loop/program.md',
  'specs/system/agents.md',
  '.claude/tools/eval-loop/fixer-settings.json',
  'backend/package.json',
  'backend/package-lock.json',
  '.gitignore',
  'backend/src/mastra/agents/assistant.agent.spec.ts',
  'backend/src/mastra/agents/__fixtures__/assistant-prompt.full.txt',
  'backend/test/app.e2e-spec.ts',
  'frontend/src/app/app.ts',
  'backend/src/mastra/model-resolver.ts',
  'backend/src/mastra/model-compat.ts',
  'backend/src/mastra/effort-levels.ts',
  'backend/src/mastra/agent-constants.ts',
  'backend/src/modules/llm/llm.service.ts',
];

/** The held-out paths of delivery.md (*Improvement loop*), deleted and denied. */
const SPEC_HELD_OUT = [
  'backend/src/mastra/evals',
  'backend/scripts/fixtures',
  'docker/postgres',
  'specs/capabilities/agents-evals',
  'docs/evals/domains',
  'docs/research',
  'docs/plans',
  'evidence',
  'frontend/e2e',
  'roadmap.md',
];

/** A file inside a held-out path. */
const inside = (path: string) =>
  /\.\w+$/.test(path) ? path : `${path}/x.json`;

describe('fixer-settings.json (delivery.md, Improvement loop)', () => {
  it('holds deny rules only, and turns auto-memory off', () => {
    expect(Object.keys(settings).sort()).toEqual([
      'autoMemoryEnabled',
      'permissions',
    ]);
    expect(settings.autoMemoryEnabled).toBe(false);
    expect(Object.keys(settings.permissions ?? {})).toEqual(['deny']);
    for (const rule of deny)
      expect(rule).toMatch(
        /^((Edit|Read)\((\*\*\/|\/\/\*\*\/|~\/).+\)|mcp__ide)$/,
      );
  });

  it("denies every tool of the IDE's MCP server, which --strict-mcp-config does not remove", () => {
    expect(deny).toContain('mcp__ide');
  });

  it('denies editing every forbidden path', () => {
    for (const path of EDIT_FORBIDDEN) {
      expect([path, denies('Edit', path)]).toEqual([path, true]);
    }
  });

  it('never denies editing a lever file, in the tree or by its absolute path', () => {
    for (const path of LEVER_SAMPLES) {
      expect(isLeverFile(path)).toBe(true);
      expect([path, denies('Edit', path)]).toEqual([path, false]);
      expect([path, denies('Read', path)]).toEqual([path, false]);
      expect([path, denies('Read', `${TREE}/${path}`)]).toEqual([path, false]);
    }
  });

  it('denies reading every held-out path, in the tree and anywhere else', () => {
    for (const held of [
      ...SPEC_HELD_OUT,
      'docs/evals/loop/leak-allowlist.txt',
      '.eval-loop/runs',
      '.eval-loop/data',
      'backend/dist',
    ]) {
      const path = inside(held);
      expect([path, denies('Read', path)]).toEqual([path, true]);
      expect([path, denies('Read', `/Users/dev/repo/${path}`)]).toEqual([
        path,
        true,
      ]);
    }
    expect(deny).toContain('Read(~/.questions-to-insights/**)');
    expect(deny).toContain('Read(~/.claude/projects/**)');
  });
});

describe('start-fixer.sh and collect-fixer.sh', () => {
  const heldOut = bashArray(startScript, 'HELD_OUT_PATHS');

  it('deletes every held-out path of the spec, and each one it deletes is Read-denied', () => {
    expect(heldOut).toEqual(expect.arrayContaining(SPEC_HELD_OUT));
    for (const held of heldOut) {
      const path = inside(held);
      expect([held, denies('Read', path)]).toEqual([held, true]);
      expect([held, denies('Read', `/Users/dev/repo/${path}`)]).toEqual([
        held,
        true,
      ]);
    }
  });

  it('knows the same lever files as the leak check', () => {
    const levers = LEVER_PATHS.map((p) => p.replace(/\/$/, ''));
    expect(bashArray(startScript, 'LEVER_PATHS')).toEqual(levers);
    expect(bashArray(collectScript, 'LEVER_PATHS')).toEqual(levers);
  });

  it('starts claude with the locked tools, the settings and no MCP server', () => {
    expect(startScript).toContain('--settings "$settings"');
    expect(startScript).toContain('--tools Read,Edit,Write,Glob,Grep');
    expect(startScript).toContain('--permission-mode acceptEdits');
    expect(startScript).toContain('--strict-mcp-config');
    expect(startScript).toContain('--add-dir "$fixer/export"');
    expect(startScript).toContain(
      'git -C "$root" worktree add --detach "$tree" HEAD',
    );
    expect(startScript).toContain('CLAUDE_CODE_DISABLE_AUTO_MEMORY=1');
    expect(startScript).not.toMatch(/--tools[^\n]*Bash/);
  });

  it('runs headless with the same locked command, no saved session and a budget', () => {
    expect(startScript).toContain('--headless');
    expect(startScript).toContain(
      'cmd+=(-p --output-format stream-json --verbose --no-session-persistence --max-budget-usd "$max_budget")',
    );
    expect(startScript.indexOf('cmd=(claude')).toBeLessThan(
      startScript.indexOf('cmd+=(-p'),
    );
  });
});
