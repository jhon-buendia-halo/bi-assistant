import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import type { EvalSetFileSource } from '../eval-set-files';
import { CommonVocabulary, normalizeText } from './common-words';
import {
  buildLiteralIndex,
  canonicalNumber,
  capitalisedSpans,
  checkChanges,
  formatFinding,
  isLeverFile,
  leakCheckMain,
  parseAllowlist,
  parseUnifiedDiff,
  patternNumbers,
  patternWords,
  significantDigits,
  times100,
} from './leak-check';
import type { FileChange, Finding } from './leak-check';

const LEVER = 'backend/src/mastra/agents/assistant-prompt.ts';

const SETS: EvalSetFileSource[] = [
  {
    file: 'demo.json',
    content: {
      variants: [],
      cases: [
        {
          id: 'dev-q',
          split: 'dev',
          question:
            'Which branch of Harborline Mutual opened 1,062 accounts in 2024?',
          checks: [
            { type: 'includes', args: { text: 'Atlanta Midtown' } },
            {
              type: 'matches',
              args: { pattern: String.raw`\b88[,.]?966\b|Crestview` },
            },
          ],
          expectedSql: {
            postgres:
              "SELECT * FROM t WHERE status = 'OPEN_PENDING' AND x = 'ab'",
          },
        },
        {
          id: 'held-q',
          split: 'held-out',
          question: 'What share of policies did the Northgate channel write?',
          checks: [
            { type: 'includes', args: { text: 'matches' } },
            { type: 'notMatches', args: { pattern: 'Pinecrest' } },
          ],
        },
      ],
    },
  },
];

const FACTS = [
  {
    file: 'backend/scripts/fixtures/demo/facts.json',
    content: {
      biggestClient: 'Barnaby Cole',
      walkAwayRate: 0.3827,
      fiscalYear: 'fiscal year runs July to June',
      emptyMonth: '2025-08',
      count: 56,
    },
  },
];

const BASE =
  'Answer from the rows: report what share of policies, branches and accounts ' +
  'changed, and say which matches the question. Write the channel.';

function check(
  lines: string[],
  options: {
    removed?: string[];
    base?: string;
    allow?: string[];
    path?: string;
  } = {},
): Finding[] {
  const change: FileChange = {
    path: options.path ?? LEVER,
    added: lines.map((text, i) => ({ line: i + 10, text })),
    removed: options.removed ?? [],
  };
  return checkChanges({
    changes: [change],
    index: buildLiteralIndex(SETS, FACTS),
    vocabulary: new CommonVocabulary([BASE], ['policy_sales', 'state_code']),
    baseText: new Map([[change.path, options.base ?? BASE]]),
    allowlist: new Set((options.allow ?? []).map((a) => normalizeText(a))),
  }).findings;
}

const kinds = (findings: Finding[]) =>
  findings.map((f) => `${f.kind}${f.warning ? '?' : ''}:${f.literal}`);

describe('leak check rejections (agents-evals R230)', () => {
  it('1. rejects the whole question, wherever it sits on the line', () => {
    const found = check([
      "  'For example: which branch of Harborline Mutual opened 1,062 accounts in 2024?' +",
    ]);
    expect(kinds(found)).toContain(
      'question:which branch of harborline mutual opened 1 062 accounts in 2024',
    );
  });

  it('1. rejects 4 consecutive question words with 2 distinctive, and 6 of any kind', () => {
    expect(kinds(check(['say which branch of harborline mutual']))).toEqual([
      'question:which branch of harborline mutual',
    ]);
    expect(kinds(check(['of harborline mutual opened them']))).toEqual([
      'question:of harborline mutual opened',
    ]);
    expect(
      kinds(check(['tell me what share of policies did the job'])),
    ).toContain('question:what share of policies did the');
  });

  it('2. rejects an entity name: a capitalised span, an includes value, a pattern word, a facts name', () => {
    expect(
      capitalisedSpans(
        'Which branch of Harborline Mutual opened? Northgate did.',
      ),
    ).toEqual(['Harborline Mutual']);
    expect(kinds(check(['Harborline Mutual is a carrier']))).toEqual([
      'entity:harborline mutual',
    ]);
    expect(kinds(check(['The Atlanta Midtown branch']))).toEqual([
      'entity:atlanta midtown',
    ]);
    expect(kinds(check(['avoid crestview and PINECREST']))).toEqual([
      'entity:crestview',
      'entity:pinecrest',
    ]);
    expect(kinds(check(['Barnaby Cole is a big client']))).toEqual([
      'entity:barnaby cole',
    ]);
  });

  it('3. rejects a number of 3+ significant digits, with or without separators, or 100 times it', () => {
    expect(kinds(check(['there are 88,966 rows']))).toEqual(['number:88966']);
    expect(kinds(check(['there are 1062 accounts']))).toEqual(['number:1062']);
    expect(kinds(check(['about 38.27% walk away']))).toEqual(['number:38.27']);
    expect(kinds(check(['about 0.3827 walk away']))).toEqual(['number:0.3827']);
  });

  it('4. rejects a quoted value: a string of a facts file', () => {
    expect(kinds(check(['Note: the fiscal year runs July to June.']))).toEqual([
      'quoted:fiscal year runs july to june',
    ]);
  });

  it('only warns on a string literal of a reference query', () => {
    const found = check(["use status 'OPEN_PENDING' here"]);
    expect(kinds(found)).toEqual(['sql-literal?:open_pending']);
  });
});

describe('leak check false-positive guards (R229, R230)', () => {
  it('passes 4 question words with fewer than 2 distinctive', () => {
    expect(check(['report what share of policies changed'])).toEqual([]);
  });

  it('passes a common word, even when a check includes it', () => {
    expect(check(['the answer matches the question'])).toEqual([]);
  });

  it('skips years and numbers of fewer than 3 significant digits', () => {
    expect(check(['in 2024 there were 56 of them, or 1,000'])).toEqual([]);
  });

  it('skips a number the file already holds at the base', () => {
    expect(check(['there are 88,966 rows'], { base: `${BASE} 88966` })).toEqual(
      [],
    );
  });

  it('ignores a line moved unchanged within the file', () => {
    expect(
      check(['  Harborline Mutual is a carrier'], {
        removed: ['Harborline Mutual is a carrier   '],
      }),
    ).toEqual([]);
  });

  it('ignores a literal of the allowlist', () => {
    expect(
      check(['Harborline Mutual is a carrier'], {
        allow: ['Harborline Mutual'],
      }),
    ).toEqual([]);
  });

  it('checks lever files only, not their unit tests or fixtures', () => {
    expect(isLeverFile('backend/src/mastra/agents/assistant-prompt.ts')).toBe(
      true,
    );
    expect(
      isLeverFile('backend/src/mastra/skills/deep-analysis/SKILL.md'),
    ).toBe(true);
    expect(
      isLeverFile(
        'backend/src/modules/testing-data/fixtures/knowledge/finance.ts',
      ),
    ).toBe(true);
    expect(isLeverFile('backend/src/mastra/tool-section.ts')).toBe(true);
    expect(
      isLeverFile('backend/src/mastra/agents/assistant.agent.spec.ts'),
    ).toBe(false);
    expect(
      isLeverFile(
        'backend/src/mastra/agents/__fixtures__/assistant-prompt.full.txt',
      ),
    ).toBe(false);
    expect(isLeverFile('backend/src/mastra/evals/sets/finance.json')).toBe(
      false,
    );
    expect(
      isLeverFile('backend/src/modules/testing-data/fixtures/registry.ts'),
    ).toBe(false);
    expect(
      check(['Harborline Mutual is a carrier'], {
        path: 'backend/src/mastra/agents/assistant.agent.spec.ts',
      }),
    ).toEqual([]);
  });
});

describe('leak check report (R230)', () => {
  it('names the file, line, kind, literal and source', () => {
    const [finding] = check(['Harborline Mutual is a carrier']);
    expect(formatFinding(finding)).toBe(
      `${LEVER}:10 [entity] "harborline mutual" ← demo.json case dev-q (dev) question`,
    );
    const [warning] = check(["status 'OPEN_PENDING'"]);
    expect(formatFinding(warning)).toBe(
      `${LEVER}:10 [sql-literal, warning] "open_pending" ← demo.json case dev-q (dev) expectedSql.postgres`,
    );
  });

  it('with --fixer, names no held-out case and no facts file', () => {
    const [held] = check(['the Northgate channel']);
    expect(formatFinding(held)).toBe(
      `${LEVER}:10 [entity] "northgate" ← demo.json case held-q (held-out) question`,
    );
    expect(formatFinding(held, true)).toBe(
      `${LEVER}:10 [entity] "northgate" ← a held-out case`,
    );
    const [facts] = check(['Barnaby Cole is a big client']);
    expect(formatFinding(facts)).toBe(
      `${LEVER}:10 [entity] "barnaby cole" ← backend/scripts/fixtures/demo/facts.json biggestClient`,
    );
    expect(formatFinding(facts, true)).toBe(
      `${LEVER}:10 [entity] "barnaby cole" ← a planted-facts file`,
    );
  });
});

describe('leak check parts', () => {
  it('reads a unified diff with context, a new file and a removed "--" line', () => {
    const patch = [
      'diff --git a/backend/src/mastra/tool-section.ts b/backend/src/mastra/tool-section.ts',
      'index 1..2 100644',
      '--- a/backend/src/mastra/tool-section.ts',
      '+++ b/backend/src/mastra/tool-section.ts',
      '@@ -1,4 +1,4 @@',
      ' line one',
      '--- old dashes',
      '+++ new pluses',
      ' line three',
      ' line four',
      '@@ -8,0 +9,2 @@',
      '+added nine',
      '+added ten',
      'diff --git a/backend/src/mastra/skills/x/SKILL.md b/backend/src/mastra/skills/x/SKILL.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/backend/src/mastra/skills/x/SKILL.md',
      '@@ -0,0 +1 @@',
      '+hello',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    expect(parseUnifiedDiff(patch)).toEqual([
      {
        path: 'backend/src/mastra/tool-section.ts',
        added: [
          { line: 2, text: '++ new pluses' },
          { line: 9, text: 'added nine' },
          { line: 10, text: 'added ten' },
        ],
        removed: ['-- old dashes'],
      },
      {
        path: 'backend/src/mastra/skills/x/SKILL.md',
        added: [{ line: 1, text: 'hello' }],
        removed: [],
      },
    ]);
  });

  it('canonicalises numbers', () => {
    expect(canonicalNumber('88,966')).toBe('88966');
    expect(canonicalNumber('0.3800')).toBe('0.38');
    expect(canonicalNumber('007')).toBe('7');
    expect(times100('0.3827')).toBe('38.27');
    expect(times100('5136060747.5')).toBe('513606074750');
    expect(significantDigits('0.3827')).toBe(4);
    expect(significantDigits('12000')).toBe(2);
  });

  it('reads the numbers and words a pattern spells', () => {
    expect(patternNumbers(String.raw`\b12[,.\s]?415\b`)).toEqual([
      '12415',
      '12.415',
    ]);
    expect(patternNumbers(String.raw`\b13[,.]38|\b0\.38`)).toEqual([
      '1338',
      '13.38',
      '38',
      '0.38',
    ]);
    expect(
      patternWords(String.raw`Bagnaia|M[aá]rquez|\bF1\b|(?:er|re)`),
    ).toEqual(['Bagnaia', 'Marquez']);
  });

  it('reads the allowlist and refuses a line without a reason', () => {
    expect([
      ...parseAllowlist(
        '# comment\n\nAtlanta Midtown | a branch name the seed documents\n',
      ),
    ]).toEqual(['atlanta midtown']);
    expect(() => parseAllowlist('Atlanta Midtown\n')).toThrow(
      'docs/evals/loop/leak-allowlist.txt:1: write "<literal> | <reason>"',
    );
  });
});

describe('leakCheckMain against a git repository', () => {
  let root: string;
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
  };
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
      {
        stdio: 'pipe',
      },
    );
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'leak-check-'));
    git('init', '-q');
    write(LEVER, 'export const PROMPT = `Answer from the data.`;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  beforeEach(() => {
    out.length = 0;
    err.length = 0;
  });

  // A dev question of the bundled World Cup bank, quoted whole.
  const LEAK = 'export const EXAMPLE = `Who won the 2022 World Cup?`;\n';

  it('rejects a working-tree change that quotes a question bank, exit 1', async () => {
    write(LEVER, `export const PROMPT = \`Answer from the data.\`;\n${LEAK}`);
    await expect(leakCheckMain([], {}, io, root)).resolves.toBe(1);
    expect(out.join('\n')).toContain(
      `${LEVER}:2 [question] "who won the 2022 world cup" ← world-cup.json case champion-2022 (dev) question`,
    );
    expect(out[out.length - 1]).toMatch(
      /: 1 rejected, .*1 added line in 1 lever file\.$/,
    );
    // The span World Cup and the shorter runs fold into the whole question.
    expect(out.filter((l) => l.startsWith(LEVER))).toHaveLength(1);
  });

  it('reads an untracked lever file, the staged change and a patch file', async () => {
    write(
      'backend/src/mastra/skills/new/SKILL.md',
      'Who won the 2022 World Cup?\n',
    );
    await expect(leakCheckMain([], {}, io, root)).resolves.toBe(1);
    expect(out.join('\n')).toContain(
      'backend/src/mastra/skills/new/SKILL.md:1 [question]',
    );
    await expect(leakCheckMain(['--staged'], {}, io, root)).resolves.toBe(0);
    const patch = join(root, 'change.patch');
    writeFileSync(patch, execFileSync('git', ['-C', root, 'diff']).toString());
    await expect(
      leakCheckMain(
        ['--diff-file', 'change.patch', '--json'],
        { INIT_CWD: root },
        io,
        root,
      ),
    ).resolves.toBe(1);
    const report = JSON.parse(out[out.length - 1]) as { rejected: number };
    expect(report.rejected).toBe(1);
  });

  it('passes a change with no quote, exit 0, and refuses bad flags, exit 2', async () => {
    write(
      LEVER,
      'export const PROMPT = `Answer from the data, with its unit.`;\n',
    );
    rmSync(join(root, 'backend/src/mastra/skills/new'), {
      recursive: true,
      force: true,
    });
    await expect(leakCheckMain([], {}, io, root)).resolves.toBe(0);
    await expect(leakCheckMain(['--base', 'nope'], {}, io, root)).resolves.toBe(
      2,
    );
    await expect(
      leakCheckMain(['--staged', '--diff-file', 'x'], {}, io, root),
    ).resolves.toBe(2);
    expect(err.join('\n')).toContain('Unknown --base "nope"');
  });

  it('rejects a held-out question, and with --fixer names no held-out case', async () => {
    // A held-out question of the bundled World Cup bank, quoted whole.
    write(
      LEVER,
      'export const PROMPT = `Answer from the data.`;\n' +
        'export const EXAMPLE = `Which team turned the highest share of its shots into goals at the 2022 World Cup?`;\n',
    );
    type Report = {
      rejected: number;
      findings: { line: number; kind: string; sources: object[] }[];
    };
    // Its words are in dev questions too, so the text report names a dev
    // source first; the JSON report lists every source.
    await expect(leakCheckMain(['--json'], {}, io, root)).resolves.toBe(1);
    const report = JSON.parse(out[out.length - 1]) as Report;
    expect(report.rejected).toBe(1);
    expect(report.findings[0]).toMatchObject({ line: 2, kind: 'question' });
    expect(report.findings[0].sources).toContainEqual(
      expect.objectContaining({
        file: 'world-cup.json',
        caseId: 'shot-conversion-2022',
        split: 'held-out',
        field: 'question',
      }),
    );

    out.length = 0;
    await expect(
      leakCheckMain(['--fixer', '--json'], {}, io, root),
    ).resolves.toBe(1);
    const redacted = JSON.parse(out[out.length - 1]) as Report;
    expect(redacted.rejected).toBe(1);
    expect(redacted.findings[0].sources).toContainEqual({
      redacted: 'a held-out case',
    });
    expect(out.join('\n')).not.toContain('shot-conversion-2022');

    out.length = 0;
    await expect(leakCheckMain(['--fixer'], {}, io, root)).resolves.toBe(1);
    expect(out.join('\n')).toContain(`${LEVER}:2 [question]`);
    expect(out.join('\n')).not.toContain('shot-conversion-2022');
  });
});
