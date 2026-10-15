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

// The deterministic checks are wrapped with `createScorer` from
// `@mastra/core/evals`, which Jest cannot require either. This stand-in keeps
// the builder chain and the config (id, name, description) the tab shows;
// `checks/check-scorer.spec.ts` runs the wrapper itself.
jest.mock('@mastra/core/evals', () => ({
  createScorer: (config: Record<string, unknown>) => {
    const scorer: Record<string, unknown> = { ...config };
    for (const step of ['analyze', 'generateScore', 'generateReason']) {
      scorer[step] = () => scorer;
    }
    return scorer;
  },
}));

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { toAssistantEvalSets } from './eval-check-scorers';
import { isDeterministicCheckType } from './checks';
import {
  caseIdsForSet,
  EVAL_CATEGORIES,
  EVAL_SET_FILES,
  EVAL_SPLITS,
  EvalSetError,
  evalSetById,
  loadEvalSets,
  parseEvalSetFile,
} from './eval-set-files';
import type { EvalSetFileSource } from './eval-set-files';

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

  it('keep every question, reference and check the TypeScript defined (a superset since BA-183)', () => {
    type SnapshotSet = ReturnType<typeof snapshotOf>[number];
    const before = BEFORE.sets as SnapshotSet[];
    // The sets the snapshot holds, by id: variants added since (R203) sit
    // between them in the suite order.
    const snapshotIds = before.map((set) => set.id);
    const inSnapshot = sets.filter((set) => snapshotIds.includes(set.id));
    const moved = snapshotOf(inSnapshot);
    expect(moved.map((set) => set.id)).toEqual(before.map((set) => set.id));
    // Field by field, so a failure names the set, case and field that drifted.
    moved.forEach(({ cases, ...set }, index) => {
      const { cases: beforeCases, ...beforeSet } = before[index];
      expect(set).toEqual(beforeSet);
      expect(cases.map((evalCase) => evalCase.id)).toEqual(
        beforeCases.map((evalCase) => evalCase.id),
      );
      cases.forEach(({ scorers, ...evalCase }, caseIndex) => {
        const { scorers: beforeScorers, ...beforeCase } =
          beforeCases[caseIndex];
        // Question, intent, reference, options and rubric are unchanged.
        expect(evalCase).toEqual(beforeCase);
        // Every check of the snapshot is still there, with the same id and
        // the same arguments (the description carries them); BA-183 only
        // added checks (agents-evals R125).
        expect([evalCase.id, scorers]).toEqual([
          evalCase.id,
          expect.arrayContaining(beforeScorers),
        ]);
      });
    });
    expect(
      inSnapshot.flatMap((set) => set.cases).map((evalCase) => evalCase.id),
    ).toEqual(BEFORE.caseIds);
  });

  it('lists the sets in the suite order, the World Cup golden set before the domains', () => {
    expect(sets.map((set) => set.id)).toEqual([
      'world-cup',
      'world-cup-rest',
      'world-cup-databricks',
      'formula-1',
      'world-cup-golden',
      'world-cup-golden-rest',
      'world-cup-golden-databricks',
      'world-cup-rest-connector',
      'world-cup-databricks-only',
      'finance',
      'finance-rest',
      'finance-databricks',
      'health-insurance',
      'genomics',
      'supply-chain',
      'marketing-analytics',
      'marketing-analytics-rest',
      'marketing-analytics-databricks',
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
      // The two checks it moved with, now with their criteria, then the
      // deterministic checks of its category (R108, R125).
      expect(evalCase.checks.slice(0, 2)).toEqual([
        {
          type: 'calledTool',
          args: { tool: 'run_readonly_sql' },
          criterion: 'D1',
        },
        { type: 'noToolErrors', criterion: 'D3' },
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
        expect(EVAL_SPLITS).toContain(evalCase.split);
      }
    }
  });

  it('keeps the World Cup and Formula 1 sets all dev', () => {
    const moved = ['world-cup.json', 'formula-1.json', 'world-cup-golden.json'];
    for (const set of loadEvalSets().filter((s) => moved.includes(s.file))) {
      expect(set.cases.every((evalCase) => evalCase.split === 'dev')).toBe(
        true,
      );
    }
  });

  it('holds out about 30% of every synthetic domain set, each bank on PostgreSQL first (agents-evals R133, R203)', () => {
    const DOMAIN_FILES = [
      'finance.json',
      'health-insurance.json',
      'genomics.json',
      'supply-chain.json',
      'marketing-analytics.json',
    ];
    const domains = loadEvalSets().filter((set) =>
      DOMAIN_FILES.includes(set.file),
    );
    expect(domains.length).toBeGreaterThan(0);
    for (const set of domains) {
      const heldOut = set.cases.filter(
        (evalCase) => evalCase.split === 'held-out',
      ).length;
      const share = heldOut / set.cases.length;
      expect([set.id, share >= 0.25 && share <= 0.4]).toEqual([set.id, true]);
    }
    // A bank's first variant is its PostgreSQL set; a REST or Databricks
    // variant repeats its questions on the same rows (R203).
    for (const file of DOMAIN_FILES) {
      const first = domains.find((set) => set.file === file);
      expect([file, first?.id, first?.dialect]).toEqual([
        file,
        file.replace(/\.json$/, ''),
        'postgres',
      ]);
    }
  });

  it('registers every file in sets/, so none is silently left out', () => {
    const onDisk = readdirSync(join(__dirname, 'sets'))
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(EVAL_SET_FILES.map((source) => source.file).sort()).toEqual(onDisk);
  });
});

describe('the deterministic checks on the moved sets (agents-evals R125)', () => {
  const MOVED = ['world-cup.json', 'formula-1.json', 'world-cup-golden.json'];
  const moved = loadEvalSets().filter((set) => MOVED.includes(set.file));
  const ANSWER = [
    'noRepairs',
    'rationaleOk',
    'noHtml',
    'dialect',
    'qualifiedNames',
    'namesNotIds',
    'numbersGrounded',
  ];
  const BY_CATEGORY: Record<string, string[]> = {
    discovery: ['noHtml', 'rationaleOk'],
    ambiguous: ['optionCount', 'noHtml'],
    join: [...ANSWER, 'usesEntities'],
    encoding: [...ANSWER, 'sqlMatches'],
    null: [...ANSWER, 'sqlMatches'],
    visual: [...ANSWER, 'visualKeywords'],
    'out-of-scope': [...ANSWER, 'notMatches'],
  };

  it('attaches the checks of each category to every set of the moved banks', () => {
    expect(moved.map((set) => set.id)).toEqual([
      'world-cup',
      'world-cup-rest',
      'world-cup-databricks',
      'formula-1',
      'world-cup-golden',
      'world-cup-golden-rest',
      'world-cup-golden-databricks',
    ]);
    for (const set of moved) {
      for (const evalCase of set.cases) {
        const deterministic = evalCase.checks
          .map((check) => check.type)
          .filter(isDeterministicCheckType);
        expect([evalCase.id, deterministic]).toEqual([
          evalCase.id,
          BY_CATEGORY[evalCase.category] ?? ANSWER,
        ]);
      }
    }
  });

  it('names a criterion on every check, the moved ones included', () => {
    for (const set of moved) {
      for (const evalCase of set.cases) {
        for (const check of evalCase.checks) {
          expect([evalCase.id, check.type, check.criterion]).toEqual([
            evalCase.id,
            check.type,
            expect.stringMatching(/^[DGIC]\d$/),
          ]);
        }
      }
    }
  });

  it('guards the out-of-scope questions without the judge (G2)', () => {
    const outOfScope = moved
      .filter((set) => set.dialect === 'postgres')
      .flatMap((set) => set.cases)
      .filter((evalCase) => evalCase.category === 'out-of-scope');
    expect(outOfScope.map((evalCase) => evalCase.id)).toEqual([
      'out-of-scope',
      'f1-out-of-scope-motogp',
    ]);
    for (const evalCase of outOfScope) {
      expect(
        evalCase.checks
          .filter((check) => check.criterion === 'G2')
          .map((check) => check.type),
      ).toEqual(['didNotCall', 'matches', 'notMatches']);
    }
  });

  it('binds the dialect checks to each set, so the REST sets are held to SQLite and the Databricks sets to Databricks SQL', () => {
    const scorers = toAssistantEvalSets(moved).map((set) => ({
      id: set.id,
      dialect: set.cases[0].scorers.find(
        (scorer) => scorer.id === 'check-dialect',
      )?.description,
    }));
    expect(scorers).toEqual([
      {
        id: 'world-cup',
        dialect: 'Checks that the SQL fits the PostgreSQL dialect',
      },
      {
        id: 'world-cup-rest',
        dialect:
          'Checks that the SQL fits the SQLite (the REST connector) dialect',
      },
      {
        id: 'world-cup-databricks',
        dialect: 'Checks that the SQL fits the Databricks SQL dialect',
      },
      {
        id: 'formula-1',
        dialect: 'Checks that the SQL fits the PostgreSQL dialect',
      },
      {
        id: 'world-cup-golden',
        dialect: 'Checks that the SQL fits the PostgreSQL dialect',
      },
      {
        id: 'world-cup-golden-rest',
        dialect:
          'Checks that the SQL fits the SQLite (the REST connector) dialect',
      },
      {
        id: 'world-cup-golden-databricks',
        dialect: 'Checks that the SQL fits the Databricks SQL dialect',
      },
    ]);
    const finalScore = toAssistantEvalSets(moved)[0].cases.find(
      (evalCase) => evalCase.id === 'final-score-2018',
    );
    expect(
      finalScore?.scorers.find((scorer) => scorer.id === 'check-uses-entities')
        ?.description,
    ).toBe(
      'Checks that one successful SQL query reads matches, tournaments, teams',
    );
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

describe('the deterministic checks in a set file (R111, R124)', () => {
  const withCheck = (check: unknown, fields: Record<string, unknown> = {}) =>
    parseEvalSetFile(
      file({ cases: [evalCase({ checks: [check], ...fields })] }),
    )[0].cases[0].checks[0];

  it('accepts each new type, with its default criterion unless the file names one', () => {
    expect(withCheck({ type: 'noHtml' })).toEqual({
      type: 'noHtml',
      criterion: 'I4',
    });
    expect(withCheck({ type: 'noHtml', criterion: 'G2' })).toEqual({
      type: 'noHtml',
      criterion: 'G2',
    });
    expect(
      withCheck({
        type: 'visualKeywords',
        args: { keywords: ['goal', '2022'] },
      }),
    ).toEqual({
      type: 'visualKeywords',
      args: { keywords: ['goal', '2022'] },
      criterion: 'G4',
    });
    // The Mastra helpers, `sqlMatches` and `notMatches` have no default.
    expect(withCheck({ type: 'noToolErrors' })).toEqual({
      type: 'noToolErrors',
    });
    expect(
      withCheck({
        type: 'sqlMatches',
        args: { pattern: 'penalt', flags: 'i' },
      }),
    ).toEqual({ type: 'sqlMatches', args: { pattern: 'penalt', flags: 'i' } });
  });

  it('refuses a criterion outside the research 2.5 list, on any check', () => {
    expect(() => withCheck({ type: 'noToolErrors', criterion: 'J1' })).toThrow(
      /case "c1", check #1: criterion "J1" is not one of D1, D2, D3/,
    );
    expect(() => withCheck({ type: 'noHtml', criterion: 'i4' })).toThrow(
      /criterion "i4" is not one of/,
    );
  });

  it('refuses missing, unknown or unusable arguments', () => {
    expect(() => withCheck({ type: 'visualKeywords' })).toThrow(
      /"visualKeywords" needs "args" with "keywords"/,
    );
    expect(() =>
      withCheck({ type: 'visualKeywords', args: { keywords: [] } }),
    ).toThrow(/args."keywords" must be a non-empty array/);
    expect(() => withCheck({ type: 'noHtml', args: { strict: true } })).toThrow(
      /unknown field\(s\) "strict"/,
    );
    expect(() =>
      withCheck({ type: 'notMatches', args: { pattern: 'x', in: 'both' } }),
    ).toThrow(/args."in" must be "answer" or "sql"/);
    expect(() =>
      withCheck({ type: 'sqlMatches', args: { pattern: 'a', flags: 'g' } }),
    ).toThrow(/without "g" or "y"/);
    expect(() =>
      withCheck({ type: 'numbersGrounded', args: { ignore: [''] } }),
    ).toThrow(/args."ignore" must be a non-empty array of non-empty strings/);
  });

  it('refuses usesEntities with nothing to compare', () => {
    expect(() => withCheck({ type: 'usesEntities' })).toThrow(
      /case "c1", check #1: "usesEntities" needs args."entities" or a reference query/,
    );
    expect(() =>
      withCheck(
        { type: 'usesEntities' },
        { expectedSql: { postgres: 'SELECT 1' } },
      ),
    ).toThrow(/the reference query names no table/);
    expect(
      withCheck(
        { type: 'usesEntities' },
        { expectedSql: { postgres: 'SELECT 1 FROM world_cup.goals' } },
      ),
    ).toEqual({ type: 'usesEntities', criterion: 'D2' });
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
    const message = `Unknown eval set "world-cop". Known sets: ${sets.map((set) => set.id).join(', ')}.`;
    expect(message).toContain(
      'Known sets: world-cup, world-cup-rest, world-cup-databricks, formula-1, world-cup-golden, ',
    );
    expect(() => caseIdsForSet(sets, 'world-cop')).toThrow(message);
    expect(() => evalSetById(sets, 'world-cop')).toThrow(message);
  });
});

describe('the REST-only set (agents-evals R163 to R167, BA-187)', () => {
  const set = evalSetById(loadEvalSets(), 'world-cup-rest-connector');

  it('holds twelve dev questions on the World Cup REST sample, in SQLite', () => {
    expect(set).toMatchObject({
      name: 'World Cup (REST connector)',
      fixtureId: 'world-cup-rest-connector',
      dialect: 'sqlite',
      file: 'world-cup-rest-connector.json',
    });
    expect(set.cases).toHaveLength(12);
    for (const evalCase of set.cases) {
      expect(evalCase.id).toMatch(/^rest-connector-/);
      expect(evalCase.split).toBe('dev');
      expect(evalCase.notes).toBeTruthy();
    }
  });

  it('tags every question with one REST tag, four of them paging', () => {
    const tags = set.cases.map((evalCase) => evalCase.tags);
    for (const caseTags of tags) {
      expect(caseTags).toHaveLength(1);
      expect(caseTags[0]).toMatch(
        /^rest:(paging|nested|rows-pointer|cap|down|auth|dialect)$/,
      );
    }
    expect(tags.flat().filter((tag) => tag === 'rest:paging')).toHaveLength(4);
  });

  it('gives every question but the refused one a SQLite reference over api.world_cup, and names a criterion on every check', () => {
    for (const evalCase of set.cases) {
      if (evalCase.tags.includes('rest:down')) {
        // R166: it could never run on the variant it needs.
        expect(evalCase.expectedSql).toBeUndefined();
        expect(evalCase.checks.map((check) => check.type)).not.toContain(
          'noToolErrors',
        );
        expect(
          evalCase.checks
            .filter((check) => check.criterion === 'G2')
            .map((check) => check.type),
        ).toEqual(['matches', 'notMatches']);
      } else {
        expect(evalCase.expectedSql).toMatch(/\bapi\.world_cup\.\w+/);
        expect(evalCase.expectedSql).not.toMatch(/::|\bILIKE\b|FILTER\s*\(/i);
      }
      for (const check of evalCase.checks) {
        expect([evalCase.id, check.criterion]).toEqual([
          evalCase.id,
          expect.stringMatching(/^[DGIC]\d$/),
        ]);
      }
    }
  });
});
