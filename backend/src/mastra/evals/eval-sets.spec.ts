// `@mastra/evals/checks` pulls in ESM-only packages Jest cannot require. This
// stand-in reproduces the ids, names and descriptions of @mastra/evals 1.10.2
// for the six check types the sets use. The same comparison with the real
// scorers (ts-node, no build) is in evidence/1.1.4/eval-sets-after.json.
jest.mock('@mastra/evals/checks', () => {
  const scorer = (id: string, name: string, description: string) => ({
    id,
    name,
    description,
  });
  return {
    checks: {
      includes: (text: string) =>
        scorer(
          'check-includes',
          'Includes Check',
          `Checks if output includes "${text}"`,
        ),
      matches: (pattern: RegExp) => {
        if (!(pattern instanceof RegExp)) throw new Error('not a RegExp');
        return scorer(
          'check-matches',
          'Matches Check',
          `Checks if output matches pattern ${pattern.toString()}`,
        );
      },
      calledTool: (tool: string) =>
        scorer(
          'check-called-tool',
          'Called Tool Check',
          `Checks that "${tool}" was called`,
        ),
      didNotCall: (tool: string) =>
        scorer(
          'check-did-not-call',
          'Did Not Call Check',
          `Checks that "${tool}" was NOT called`,
        ),
      toolOrder: (tools: string[]) =>
        scorer(
          'check-tool-order',
          'Tool Order Check',
          `Checks tool call order: [${tools.join(' → ')}]`,
        ),
      noToolErrors: () =>
        scorer(
          'check-no-tool-errors',
          'No Tool Errors Check',
          'Checks that no tool calls resulted in errors',
        ),
    },
  };
});

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { toAssistantEvalSets } from './eval-check-scorers';
import {
  caseIdsForSet,
  EVAL_CATEGORIES,
  EVAL_SET_FILES,
  EvalSetError,
  evalSetById,
  loadEvalSets,
  parseEvalSetFile,
} from './eval-sets';
import type { EvalSetFileSource } from './eval-sets';

/**
 * The 30 cases as `assistant.evals.ts` built them in TypeScript, captured from
 * the code before the move (BA-182).
 */
const BEFORE = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../evidence/1.1.4/eval-sets-before.json'),
    'utf8',
  ),
) as { caseIds: string[]; sets: unknown[] };

/** The snapshot's shape: what the Evals tab, the runner and the report read. */
function snapshotOf(sets: ReturnType<typeof toAssistantEvalSets>) {
  return sets.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    fixtureId: set.fixtureId,
    cases: set.cases.map((evalCase) => ({
      id: evalCase.id,
      question: evalCase.question,
      intent: evalCase.intent,
      expectedSql: evalCase.expectedSql ?? null,
      resultSetOptions: evalCase.resultSetOptions ?? null,
      judgeRubric: evalCase.judgeRubric ?? null,
      scorers: evalCase.scorers.map((scorer) => ({
        id: String(scorer.id ?? ''),
        name: String(scorer.name ?? ''),
        description: String(scorer.description ?? ''),
      })),
    })),
  }));
}

describe('eval set files', () => {
  const sets = toAssistantEvalSets(loadEvalSets());

  it('rebuild the three existing sets exactly as the TypeScript defined them', () => {
    const moved = snapshotOf(sets.slice(0, 3));
    // Field by field, so a failure names the case and field that drifted.
    expect(moved.map((set) => set.id)).toEqual(
      (BEFORE.sets as { id: string }[]).map((set) => set.id),
    );
    moved.forEach((set, index) => expect(set).toEqual(BEFORE.sets[index]));
    expect(
      sets
        .slice(0, 3)
        .flatMap((set) => set.cases)
        .map((evalCase) => evalCase.id),
    ).toEqual(BEFORE.caseIds);
  });

  it('lists the sets in the suite order, the golden set last', () => {
    expect(sets.map((set) => set.id)).toEqual([
      'world-cup',
      'world-cup-rest',
      'formula-1',
      'world-cup-golden',
    ]);
  });

  it('holds the golden set: 11 World Cup questions, each scored on SQL, tools and rows', () => {
    const [golden] = loadEvalSets().filter(
      (set) => set.id === 'world-cup-golden',
    );
    expect(golden).toMatchObject({
      name: 'World Cup (golden set)',
      fixtureId: 'world-cup',
      dialect: 'postgres',
    });
    expect(golden.cases).toHaveLength(11);
    for (const evalCase of golden.cases) {
      expect(evalCase.checks).toEqual([
        { type: 'calledTool', args: { tool: 'run_readonly_sql' } },
        { type: 'noToolErrors' },
      ]);
      expect(evalCase.expectedSql).toMatch(/^SELECT /);
      expect(evalCase.notes).toBeTruthy();
      expect(evalCase.judgeRubric).toBeUndefined();
    }
    expect(golden.cases.map((evalCase) => evalCase.question)).toEqual(
      expect.arrayContaining([
        'Which teams scored exactly four goals in total?',
        'What share of their attempted passes did each team complete?',
        'What share of the disciplinary cards shown were yellow?',
      ]),
    );
  });

  it('gives every case a category from the list, and dev unless held out', () => {
    for (const set of loadEvalSets()) {
      for (const evalCase of set.cases) {
        expect(EVAL_CATEGORIES).toContain(evalCase.category);
        expect(evalCase.split).toBe('dev');
      }
    }
  });

  it('registers every file in sets/, so none is silently left out', () => {
    const onDisk = readdirSync(join(__dirname, 'sets'))
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(EVAL_SET_FILES.map((source) => source.file).sort()).toEqual(onDisk);
  });
});

/** A valid one-variant, one-case file to break one field at a time. */
function file(
  overrides: { variants?: unknown[]; cases?: unknown[] } = {},
  name = 'test-set.json',
): EvalSetFileSource {
  return {
    file: name,
    content: {
      variants: overrides.variants ?? [variant()],
      cases: overrides.cases ?? [evalCase()],
    },
  };
}

function variant(fields: Record<string, unknown> = {}) {
  return {
    id: 'test',
    name: 'Test',
    description: 'A test set.',
    fixtureId: 'world-cup',
    dialect: 'postgres',
    caseIdPrefix: '',
    ...fields,
  };
}

function evalCase(fields: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    category: 'lookup',
    question: 'Who won the 2022 World Cup?',
    intent: 'A lookup.',
    checks: [{ type: 'noToolErrors' }],
    ...fields,
  };
}

function without(value: Record<string, unknown>, key: string) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

describe('the set loader refuses an incomplete or inconsistent file', () => {
  it.each(['id', 'category', 'question', 'intent', 'checks'])(
    'a case without %s, naming the file and the case',
    (field) => {
      const load = () =>
        parseEvalSetFile(file({ cases: [without(evalCase(), field)] }));
      expect(load).toThrow(EvalSetError);
      expect(load).toThrow(/test-set\.json/);
      if (field !== 'id') expect(load).toThrow(/case "c1"/);
      expect(load).toThrow(new RegExp(`"${field}"`));
    },
  );

  it('a category, split or dialect outside its list', () => {
    expect(() =>
      parseEvalSetFile(file({ cases: [evalCase({ category: 'trivia' })] })),
    ).toThrow(/case "c1": category "trivia" is not one of lookup, aggregate/);
    expect(() =>
      parseEvalSetFile(file({ cases: [evalCase({ split: 'test' })] })),
    ).toThrow(/case "c1": split "test" is not one of dev, held-out/);
    expect(() =>
      parseEvalSetFile(file({ variants: [variant({ dialect: 'mysql' })] })),
    ).toThrow(/variant "test": dialect "mysql" is not one of postgres/);
  });

  it('an unknown check type, or one type twice in a case', () => {
    expect(() =>
      parseEvalSetFile(
        file({ cases: [evalCase({ checks: [{ type: 'excludes' }] })] }),
      ),
    ).toThrow(/case "c1", check #1: check type "excludes" is not one of/);
    expect(() =>
      parseEvalSetFile(
        file({
          cases: [
            evalCase({
              checks: [
                { type: 'includes', args: { text: 'Argentina' } },
                { type: 'includes', args: { text: 'Messi' } },
              ],
            }),
          ],
        }),
      ),
    ).toThrow(/case "c1", check #2: check type "includes" is used twice/);
  });

  it('a check with missing, unknown or unusable arguments', () => {
    const withCheck = (check: unknown) => () =>
      parseEvalSetFile(file({ cases: [evalCase({ checks: [check] })] }));
    expect(withCheck({ type: 'includes' })).toThrow(/needs "args"/);
    expect(withCheck({ type: 'includes', args: { value: 'x' } })).toThrow(
      /unknown field\(s\) "value"/,
    );
    expect(withCheck({ type: 'toolOrder', args: { tools: [] } })).toThrow(
      /args."tools" must be a non-empty array/,
    );
    expect(
      withCheck({ type: 'matches', args: { pattern: 'a', flags: 'g' } }),
    ).toThrow(/without "g" or "y"/);
    expect(withCheck({ type: 'matches', args: { pattern: '(' } })).toThrow(
      /not a valid regular expression/,
    );
  });

  it('a reference query missing for a dialect one of the variants uses', () => {
    const twoVariants = [
      variant(),
      variant({
        id: 'test-rest',
        fixtureId: 'world-cup-rest',
        dialect: 'sqlite',
        caseIdPrefix: 'rest-',
      }),
    ];
    expect(() =>
      parseEvalSetFile(
        file({
          variants: twoVariants,
          cases: [evalCase({ expectedSql: { postgres: 'SELECT 1' } })],
        }),
      ),
    ).toThrow(/case "c1": expectedSql has no sqlite query/);
    // No reference at all is allowed: the case is graded on its checks.
    expect(() =>
      parseEvalSetFile(file({ variants: twoVariants })),
    ).not.toThrow();
  });

  it('a set id or case id another set already uses', () => {
    expect(() => loadEvalSets([file(), file({}, 'other-set.json')])).toThrow(
      /other-set\.json, variant "test": the set id is already used by test-set\.json/,
    );
    expect(() =>
      loadEvalSets([
        file(),
        file({ variants: [variant({ id: 'other' })] }, 'other-set.json'),
      ]),
    ).toThrow(/other-set\.json, case "c1": the case id is already used/);
    // The real suite's ids: unique across the 41 expanded cases.
    expect(() => loadEvalSets()).not.toThrow();
  });

  it('a sample fixture the registry does not have, or one of another kind', () => {
    expect(() =>
      parseEvalSetFile(file({ variants: [variant({ fixtureId: 'nba' })] })),
    ).toThrow(/variant "test": fixtureId "nba" is not in the fixture registry/);
    expect(() =>
      parseEvalSetFile(
        file({ variants: [variant({ fixtureId: 'world-cup-rest' })] }),
      ),
    ).toThrow(/does not match fixture "world-cup-rest"/);
  });

  it('an unknown field, or a variant without its case-id prefix', () => {
    expect(() =>
      parseEvalSetFile(file({ cases: [evalCase({ judgeRubrc: 'x' })] })),
    ).toThrow(/case "c1": unknown field\(s\) "judgeRubrc"/);
    expect(() =>
      parseEvalSetFile(
        file({ variants: [without(variant(), 'caseIdPrefix')] }),
      ),
    ).toThrow(/"caseIdPrefix" is required/);
  });
});

describe('the set loader expands variants', () => {
  it('prefixes case ids and picks the reference for each dialect', () => {
    const [postgres, rest] = parseEvalSetFile(
      file({
        variants: [
          variant(),
          variant({
            id: 'test-rest',
            fixtureId: 'world-cup-rest',
            dialect: 'sqlite',
            caseIdPrefix: 'rest-',
          }),
        ],
        cases: [
          evalCase({
            expectedSql: { postgres: 'SELECT pg', sqlite: 'SELECT lite' },
            tags: ['rest:dialect'],
          }),
          evalCase({ id: 'c2' }),
        ],
      }),
    );
    expect(postgres.cases.map((c) => [c.id, c.expectedSql])).toEqual([
      ['c1', 'SELECT pg'],
      ['c2', undefined],
    ]);
    expect(rest.cases.map((c) => [c.id, c.expectedSql])).toEqual([
      ['rest-c1', 'SELECT lite'],
      ['rest-c2', undefined],
    ]);
    expect(rest).toMatchObject({
      id: 'test-rest',
      dialect: 'sqlite',
      file: 'test-set.json',
    });
    expect(rest.cases[0]).toMatchObject({
      category: 'lookup',
      split: 'dev',
      tags: ['rest:dialect'],
    });
  });
});

describe('choosing one set by id (EVAL_SET)', () => {
  const sets = loadEvalSets();

  it('selects every case when no set is named, as before', () => {
    expect(caseIdsForSet(sets, undefined)).toBeUndefined();
    expect(caseIdsForSet(sets, '  ')).toBeUndefined();
  });

  it("selects only the named set's case ids", () => {
    const golden = caseIdsForSet(sets, 'world-cup-golden');
    expect(golden).toHaveLength(11);
    expect(golden).toContain('teams-tied-on-four-goals');
    expect(caseIdsForSet(sets, ' world-cup-rest ')?.[0]).toBe(
      'rest-champion-2022',
    );
  });

  it('refuses an unknown set, naming the known ones', () => {
    const message =
      'Unknown eval set "world-cop". Known sets: world-cup, world-cup-rest, formula-1, world-cup-golden.';
    expect(() => caseIdsForSet(sets, 'world-cop')).toThrow(message);
    expect(() => evalSetById(sets, 'world-cop')).toThrow(message);
  });
});
