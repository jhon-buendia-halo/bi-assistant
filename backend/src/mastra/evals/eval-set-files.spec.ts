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
  EVAL_CATEGORIES,
  EVAL_CRITERIA,
  EVAL_SET_FILES,
  EVAL_SPLITS,
  EvalSetError,
  MEMORY_CATEGORIES,
  QUESTION_CATEGORIES,
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

/**
 * What main changed in the snapshot's sets after it was taken: BA-209
 * dropped the `list_entities` check of the discovery cases (the session
 * context lists the entities), and BA-217 added two World Cup cases with a
 * tool selection, which the REST variant repeats.
 */
const DROPPED_ON_MAIN: Readonly<Record<string, string[]>> = {
  'schema-discovery': ['Checks that "list_entities" was called'],
  'rest-schema-discovery': ['Checks that "list_entities" was called'],
  'f1-schema-discovery': ['Checks that "list_entities" was called'],
};
const ADDED_ON_MAIN = [
  'no-clarification-best-team',
  'no-visuals-chart-request',
  'rest-no-clarification-best-team',
  'rest-no-visuals-chart-request',
];
/**
 * What main reworded since: BA-300 lets a clarification on one dimension
 * pass the ambiguous best-team question, whose rubric the REST variant
 * repeats. Applied to the snapshot's rubric before comparing.
 */
const BA_300_SENTENCE =
  'One clarifying question on either dimension is enough: options that ' +
  'each name a concrete metric (scoped, for example, "across all ' +
  'tournaments") pass even when no year is named, and options that each ' +
  'name a tournament year pass even when no metric is named. ';
const REWORDED_ON_MAIN: Readonly<Record<string, (rubric: string) => string>> =
  Object.fromEntries(
    ['ambiguous-best-team', 'rest-ambiguous-best-team'].map((id) => [
      id,
      (rubric: string) =>
        rubric.replace(
          'the answer. Score pass=false',
          `the answer. ${BA_300_SENTENCE}Score pass=false`,
        ),
    ]),
  );
/**
 * The 40 questions roadmap 1.1.10 (BA-188) appended to the World Cup bank
 * after its twelve: 23 from `feat/engine-eval-loop`, then 17 paraphrases.
 */
const ADDED_TO_WORLD_CUP = [
  'shot-accuracy-by-team-2022',
  'shot-conversion-2022',
  'busiest-stadium',
  'highest-scoring-match',
  'top-scorer-both-tournaments',
  'semi-final-goals-2022',
  'goals-by-defenders',
  'third-place-2022',
  'most-fouls-team',
  'booked-in-2022-final',
  'quickest-goal-scorer',
  'top-assist-provider',
  'mandzukic-goals-2018',
  'extra-time-goals',
  'argentina-draws-2022',
  'south-american-goals',
  'third-placed-team-scorers-2018',
  'player-data-discovery',
  'team-match-stats-discovery',
  'argentina-penalties-2022',
  'best-defence',
  'group-stage-goals-2022',
  'referee-2022-final',
  'shot-accuracy-by-team-2022-reworded',
  'shot-conversion-2022-reworded',
  'busiest-stadium-reworded',
  'highest-scoring-match-reworded',
  'top-scorer-both-tournaments-reworded',
  'semi-final-goals-2022-reworded',
  'goals-by-defenders-reworded',
  'third-place-2022-reworded',
  'most-fouls-team-reworded',
  'booked-in-2022-final-reworded',
  'quickest-goal-scorer-reworded',
  'top-assist-provider-reworded',
  'mandzukic-goals-2018-reworded',
  'extra-time-goals-reworded',
  'argentina-draws-2022-reworded',
  'south-american-goals-reworded',
  'third-placed-team-scorers-2018-reworded',
];
/**
 * The 11 questions of the former World Cup golden set, merged into the end of
 * the World Cup bank on 2026-10-20 (BA-188).
 */
const MERGED_GOLDEN = [
  'pass-accuracy-by-team',
  'shot-accuracy-by-team',
  'top-scoring-team',
  'teams-tied-on-four-goals',
  'card-types-recorded',
  'goals-with-recorded-assist',
  'goals-by-type',
  'attendance-by-tournament',
  'matches-by-stage',
  'pass-completion-by-team',
  'yellow-card-share',
];
/** Every case added to the snapshot's sets since, in suite order. */
const ADDED_SINCE = [
  ...ADDED_ON_MAIN.slice(0, 2),
  ...ADDED_TO_WORLD_CUP,
  ...MERGED_GOLDEN,
  ...ADDED_ON_MAIN.slice(2),
  ...ADDED_TO_WORLD_CUP.map((id) => `rest-${id}`),
  ...MERGED_GOLDEN.map((id) => `rest-${id}`),
];

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
    // The sets the snapshot holds, by id: variants added since (R204) sit
    // between them in the suite order.
    const snapshotIds = before.map((set) => set.id);
    const current = sets.filter((set) => snapshotIds.includes(set.id));
    // The cases added since sit after the moved ones: main's two (BA-217),
    // then the 40 of roadmap 1.1.10 (BA-188).
    expect(
      current
        .flatMap((set) => set.cases)
        .map((evalCase) => evalCase.id)
        .filter((id) => !BEFORE.caseIds.includes(id)),
    ).toEqual(ADDED_SINCE);
    const inSnapshot = current.map((set) => ({
      ...set,
      cases: set.cases.filter((evalCase) => !ADDED_SINCE.includes(evalCase.id)),
    }));
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
        // Question, intent, reference, options and rubric are unchanged,
        // apart from the rubrics main reworded since.
        const reword = REWORDED_ON_MAIN[evalCase.id];
        expect(evalCase).toEqual(
          reword && beforeCase.judgeRubric
            ? { ...beforeCase, judgeRubric: reword(beforeCase.judgeRubric) }
            : beforeCase,
        );
        // Every check of the snapshot is still there, with the same id and
        // the same arguments (the description carries them); BA-183 only
        // added checks (agents-evals R126). The ones main dropped are gone.
        const dropped = DROPPED_ON_MAIN[evalCase.id] ?? [];
        expect([evalCase.id, scorers]).toEqual([
          evalCase.id,
          expect.arrayContaining(
            beforeScorers.filter(
              (scorer) => !dropped.includes(scorer.description),
            ),
          ),
        ]);
        expect(
          scorers.filter((scorer) => dropped.includes(scorer.description)),
        ).toEqual([]);
      });
    });
    expect(
      inSnapshot.flatMap((set) => set.cases).map((evalCase) => evalCase.id),
    ).toEqual(BEFORE.caseIds);
  });

  it('lists the sets in the suite order, the domains after the World Cup banks', () => {
    expect(sets.map((set) => set.id)).toEqual([
      'world-cup',
      'world-cup-rest',
      'world-cup-databricks',
      'formula-1',
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
      'memory-world-cup',
      'memory-finance',
      'memory-marketing-analytics',
    ]);
  });

  it('holds the former golden set as the last 11 World Cup questions, each scored on SQL, tools and rows', () => {
    const [worldCup] = loadEvalSets().filter((set) => set.id === 'world-cup');
    expect(worldCup).toMatchObject({
      fixtureId: 'world-cup',
      dialect: 'postgres',
    });
    expect(worldCup.cases).toHaveLength(63);
    const golden = { cases: worldCup.cases.slice(-11) };
    expect(golden.cases.map((evalCase) => evalCase.id)).toEqual(MERGED_GOLDEN);

    expect(golden.cases.map((evalCase) => evalCase.question)).toEqual([
      'Which three teams completed the highest share of their attempted passes across all matches?',
      'Which three teams put the highest share of their shots on target?',
      'Which team scored the most goals in total?',
      'Which teams scored exactly four goals in total?',
      'What types of disciplinary cards were recorded, and how many of each?',
      'How many goals have a recorded assisting player?',
      'How many goals were scored of each goal type?',
      'What was the total match attendance for each tournament year?',
      'How many matches were played at each stage, counting both tournaments together?',
      'What share of their attempted passes did each team complete?',
      'What share of the disciplinary cards shown were yellow?',
    ]);
    for (const evalCase of golden.cases) {
      expect(evalCase.notes).toMatch(
        /^From the former World Cup golden set \(world-cup-golden, merged into this bank on 2026-10-20\)\. /,
      );
      // The two checks it moved with, now with their criteria, then the
      // deterministic checks of its category (R109, R126).
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

  it('keeps the Formula 1 set, the first twelve World Cup questions and the last eleven (the former golden set) all dev (agents-evals R134)', () => {
    const moved = ['world-cup.json', 'formula-1.json'];
    for (const set of loadEvalSets().filter((s) => moved.includes(s.file))) {
      const first = set.file === 'world-cup.json' ? 12 : set.cases.length;
      expect(
        set.cases.slice(0, first).every((evalCase) => evalCase.split === 'dev'),
      ).toBe(true);
      if (set.file === 'world-cup.json') {
        // The former golden set, merged in as the last 11 questions.
        expect(
          set.cases.slice(-11).every((evalCase) => evalCase.split === 'dev'),
        ).toBe(true);
      }
    }
  });

  it('holds out 15 of the 40 World Cup questions added in 1.1.10, each paraphrase with its question (agents-evals R134)', () => {
    const prefixes: Record<string, string> = {
      'world-cup': '',
      'world-cup-rest': 'rest-',
      'world-cup-databricks': 'dbx-',
    };
    const banks = loadEvalSets().filter((s) => s.file === 'world-cup.json');
    expect(banks.map((set) => set.id)).toEqual(Object.keys(prefixes));
    for (const set of banks) {
      // The 40 questions, then the former golden set at the end.
      const added = set.cases.slice(12, 12 + ADDED_TO_WORLD_CUP.length);
      expect(added.map((evalCase) => evalCase.id)).toEqual(
        ADDED_TO_WORLD_CUP.map((id) => `${prefixes[set.id]}${id}`),
      );
      expect(set.cases.slice(12 + ADDED_TO_WORLD_CUP.length)).toHaveLength(
        MERGED_GOLDEN.length,
      );
      expect(
        added.filter((evalCase) => evalCase.split === 'held-out'),
      ).toHaveLength(15);
      for (const evalCase of added.filter((c) => c.category === 'paraphrase')) {
        const rephrased = added.find((c) => `${c.id}-reworded` === evalCase.id);
        expect([evalCase.id, evalCase.split]).toEqual([
          evalCase.id,
          rephrased?.split,
        ]);
      }
    }
  });

  it('holds out about 30% of every synthetic domain set, each bank on PostgreSQL first (agents-evals R134, R204)', () => {
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
    // variant repeats its questions on the same rows (R204).
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

describe('the deterministic checks on the moved sets (agents-evals R126)', () => {
  const MOVED = ['world-cup.json', 'formula-1.json'];
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
    ]);
    for (const set of moved) {
      const deterministicOf = (evalCase: (typeof set.cases)[number]) =>
        evalCase.checks
          .map((check) => check.type)
          .filter(isDeterministicCheckType);
      for (const evalCase of set.cases) {
        // A paraphrase carries the checks of the question it rephrases
        // (agents-evals R134), so those of that question's category.
        const rephrased =
          evalCase.category === 'paraphrase'
            ? set.cases.find((c) => `${c.id}-reworded` === evalCase.id)
            : undefined;
        if (evalCase.category === 'paraphrase') expect(rephrased).toBeDefined();
        // A case with a tool selection came from main (BA-217) after the
        // checks were attached, and keeps the checks it came with.
        expect([evalCase.id, deterministicOf(evalCase)]).toEqual([
          evalCase.id,
          evalCase.agentTools
            ? []
            : rephrased
              ? deterministicOf(rephrased)
              : (BY_CATEGORY[evalCase.category] ?? ANSWER),
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
      'group-stage-goals-2022',
      'referee-2022-final',
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

  it('a tool selection that is not a list of distinct optional tools', () => {
    const withTools = (agentTools: unknown) => () =>
      parseEvalSetFile(file({ cases: [evalCase({ agentTools })] }));
    expect(withTools('visuals')).toThrow(
      'Eval set file test-set.json, case "c1": "agentTools" must be an array of tool ids (sample_rows, ask_clarification, visuals); leave it out for every tool',
    );
    expect(withTools(['visuals', 'run_readonly_sql'])).toThrow(
      'Eval set file test-set.json, case "c1": agentTools has an unknown tool "run_readonly_sql"; known: sample_rows, ask_clarification, visuals',
    );
    expect(withTools(['visuals', 'visuals'])).toThrow(
      'Eval set file test-set.json, case "c1": agentTools lists "visuals" twice',
    );
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

describe('a case tool selection (agents.md 4.2, 8.1)', () => {
  it('keeps it on every variant, in the order written, and adds none when absent', () => {
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
          evalCase({ agentTools: ['visuals', 'sample_rows'] }),
          evalCase({ id: 'c2', agentTools: [] }),
          evalCase({ id: 'c3' }),
        ],
      }),
    );
    for (const set of [postgres, rest]) {
      expect(set.cases.map((c) => c.agentTools)).toEqual([
        ['visuals', 'sample_rows'],
        [],
        undefined,
      ]);
      expect(set.cases[2]).not.toHaveProperty('agentTools');
    }
  });

  it("reaches the suite's cases: the World Cup file's two selections, on each variant", () => {
    const prefixes: Record<string, string> = {
      'world-cup': '',
      'world-cup-rest': 'rest-',
      'world-cup-databricks': 'dbx-',
    };
    const sets = toAssistantEvalSets(loadEvalSets());
    for (const [setId, prefix] of Object.entries(prefixes)) {
      const cases = sets.find((set) => set.id === setId)?.cases ?? [];
      expect(
        cases
          .filter((evalCase) => evalCase.agentTools)
          .map(({ id, agentTools }) => [id, agentTools]),
      ).toEqual([
        [`${prefix}no-clarification-best-team`, ['sample_rows', 'visuals']],
        [
          `${prefix}no-visuals-chart-request`,
          ['sample_rows', 'ask_clarification'],
        ],
      ]);
    }
    // Every other set file runs its cases with every tool.
    expect(
      sets
        .filter((set) => !(set.id in prefixes))
        .flatMap((set) => set.cases)
        .some((evalCase) => evalCase.agentTools),
    ).toBe(false);
  });
});

describe('the deterministic checks in a set file (R112, R125)', () => {
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

describe('choosing one set by id (EVAL_SET of eval:validate)', () => {
  const sets = loadEvalSets();

  it('finds the named set, its id trimmed', () => {
    const worldCup = evalSetById(sets, 'world-cup');
    expect(worldCup.cases).toHaveLength(63);
    expect(worldCup.cases.map((evalCase) => evalCase.id)).toContain(
      'teams-tied-on-four-goals',
    );
    expect(evalSetById(sets, ' world-cup-rest ').cases[0].id).toBe(
      'rest-champion-2022',
    );
  });

  it('refuses an unknown set, naming the known ones', () => {
    const message = `Unknown eval set "world-cop". Known sets: ${sets.map((set) => set.id).join(', ')}.`;
    expect(message).toContain(
      'Known sets: world-cup, world-cup-rest, world-cup-databricks, formula-1, world-cup-rest-connector, ',
    );
    expect(() => evalSetById(sets, 'world-cop')).toThrow(message);
  });
});

describe('the REST-only set (agents-evals R164 to R168, BA-187)', () => {
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
        // R167: it could never run on the variant it needs.
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

describe('the memory bank (agents-evals R233 to R236, BA-190)', () => {
  const raw = (
    EVAL_SET_FILES.find((source) => source.file === 'memory.json')!.content as {
      cases: {
        id: string;
        fixture: string;
        category: string;
        split?: string;
        tags: string[];
        intent: string;
        notes: string;
        teach: unknown[];
        probe: {
          question: string;
          expectedSql: { postgres: string };
          trapSql: { postgres: string };
        };
      }[];
    }
  ).cases;
  const memorySets = loadEvalSets().filter((set) => set.file === 'memory.json');

  it('lists the six memory categories after the eighteen, and M1 to M3 after C4', () => {
    expect(QUESTION_CATEGORIES).toHaveLength(18);
    expect(EVAL_CATEGORIES).toEqual([
      ...QUESTION_CATEGORIES,
      'memory-reuse',
      'memory-correction',
      'memory-update',
      'memory-rejected',
      'memory-abstain',
      'memory-vs-curated',
    ]);
    expect(EVAL_CRITERIA.slice(-4)).toEqual(['C4', 'M1', 'M2', 'M3']);
  });

  it('has one PostgreSQL set per sample, with no prefix, each holding its sample’s cases in file order', () => {
    expect(
      memorySets.map(({ id, name, fixtureId, dialect }) => ({
        id,
        name,
        fixtureId,
        dialect,
      })),
    ).toEqual([
      {
        id: 'memory-world-cup',
        name: 'Memory (World Cup)',
        fixtureId: 'world-cup',
        dialect: 'postgres',
      },
      {
        id: 'memory-finance',
        name: 'Memory (Finance)',
        fixtureId: 'finance',
        dialect: 'postgres',
      },
      {
        id: 'memory-marketing-analytics',
        name: 'Memory (Marketing Analytics)',
        fixtureId: 'marketing-analytics',
        dialect: 'postgres',
      },
    ]);
    for (const set of memorySets) {
      expect([set.id, set.cases.map((c) => c.id)]).toEqual([
        set.id,
        raw.filter((c) => c.fixture === set.fixtureId).map((c) => c.id),
      ]);
    }
    expect(memorySets.map((set) => set.cases.length)).toEqual([30, 3, 3]);
  });

  it('holds 6 questions per category, 4 dev and 2 held out', () => {
    const cases = memorySets.flatMap((set) => set.cases);
    expect(cases).toHaveLength(36);
    for (const category of MEMORY_CATEGORIES) {
      const of = cases.filter((c) => c.category === category);
      expect([
        category,
        of.filter((c) => c.split === 'dev').length,
        of.filter((c) => c.split === 'held-out').length,
      ]).toEqual([category, 4, 2]);
    }
  });

  it('loads each memory case as a case whose question, reference and checks are its probe’s, plus its teach, trap and memory checks', () => {
    const cases = memorySets.flatMap((set) => set.cases);
    for (const evalCase of cases) {
      const file = raw.find((c) => c.id === evalCase.id)!;
      expect(evalCase).toMatchObject({
        category: file.category,
        split: file.split ?? 'dev',
        tags: file.tags,
        intent: file.intent,
        notes: file.notes,
        question: file.probe.question,
        expectedSql: file.probe.expectedSql.postgres,
        trapSql: file.probe.trapSql.postgres,
        teach: file.teach,
      });
      // Every probe carries D1 and D3 (R234) and keeps no memory check among
      // the checks a scorer is built for (A3).
      expect(evalCase.checks.slice(0, 2)).toEqual([
        {
          type: 'calledTool',
          args: { tool: 'run_readonly_sql' },
          criterion: 'D1',
        },
        { type: 'noToolErrors', criterion: 'D3' },
      ]);
      expect(evalCase.checks.map((c) => c.type)).not.toEqual(
        expect.arrayContaining(['noRowValuesRetained']),
      );
      expect([evalCase.id, evalCase.memoryChecks]).toEqual([
        evalCase.id,
        [
          { type: 'noRowValuesRetained', criterion: 'M1' },
          ...(evalCase.category === 'memory-rejected'
            ? [{ type: 'notRejectedSql', criterion: 'M2' }]
            : []),
          ...(evalCase.category === 'memory-abstain'
            ? [{ type: 'teachNotRecalled', criterion: 'M3' }]
            : []),
        ],
      ]);
      expect(evalCase).not.toHaveProperty('judgeRubric');
      expect(evalCase).not.toHaveProperty('agentTools');
      expect(evalCase).not.toHaveProperty('fixture');
    }
  });

  it('reaches the suite with no scorer for a memory check, and with its teach, trap and memory checks', () => {
    const [worldCup] = toAssistantEvalSets(memorySets);
    const evalCase = worldCup.cases.find(
      (c) => c.id === 'extra-time-goals-rejected-matches-filter',
    )!;
    expect(evalCase.scorers.map((scorer) => String(scorer.id))).toEqual([
      'check-called-tool',
      'check-no-tool-errors',
    ]);
    expect(evalCase.checkCriteria).toEqual(['D1', 'D3']);
    expect(evalCase.memoryChecks).toEqual([
      { type: 'noRowValuesRetained', criterion: 'M1' },
      { type: 'notRejectedSql', criterion: 'M2' },
    ]);
    expect(evalCase.teach?.[0]).toMatchObject({ kind: 'rejection' });
    expect(evalCase.trapSql).toMatch(/^SELECT /);
    expect(evalCase.category).toBe('memory-rejected');
  });
});

describe('the memory bank loader refuses (agents-evals R235)', () => {
  function memoryVariant(fields: Record<string, unknown> = {}) {
    return {
      id: 'memory-test',
      name: 'Memory (Test)',
      description: 'A memory test set.',
      fixtureId: 'world-cup',
      dialect: 'postgres',
      caseIdPrefix: '',
      ...fields,
    };
  }
  function teachSignal(fields: Record<string, unknown> = {}) {
    return {
      kind: 'verified_query',
      at: '2026-11-02T15:00:00Z',
      question: 'Who scored most in 2018?',
      sql: 'SELECT 1 FROM world_cup.goals',
      ...fields,
    };
  }
  function probe(fields: Record<string, unknown> = {}) {
    return {
      question: '¿Quién fue el máximo goleador del Mundial 2018?',
      expectedSql: { postgres: 'SELECT 1 FROM world_cup.goals' },
      trapSql: { postgres: 'SELECT 2 FROM world_cup.goals' },
      checks: [
        { type: 'calledTool', args: { tool: 'run_readonly_sql' } },
        { type: 'noToolErrors' },
        { type: 'noRowValuesRetained' },
      ],
      ...fields,
    };
  }
  function memoryCase(fields: Record<string, unknown> = {}) {
    return {
      id: 'm1',
      fixture: 'world-cup',
      category: 'memory-reuse',
      tags: ['lang:es', 'difficulty:easy', 'trap:own-goals'],
      intent: 'An approval is reused.',
      notes: 'Why.',
      teach: [teachSignal()],
      probe: probe(),
      ...fields,
    };
  }
  const load = (
    cases: unknown[] = [memoryCase()],
    variants: unknown[] = [memoryVariant()],
  ) => parseEvalSetFile({ file: 'memory.json', content: { variants, cases } });
  const refused = (cases: unknown[], variants?: unknown[]) => {
    try {
      load(cases, variants);
    } catch (err) {
      expect(err).toBeInstanceOf(EvalSetError);
      return (err as Error).message;
    }
    return 'not refused';
  };

  it('loads a well-formed case, its criteria as named or by default', () => {
    const [set] = load([
      memoryCase({
        split: 'held-out',
        probe: probe({
          checks: [
            { type: 'noToolErrors' },
            { type: 'noRowValuesRetained', criterion: 'D4' },
          ],
          resultSetOptions: { distinctRows: true },
        }),
      }),
    ]);
    expect(set.cases).toEqual([
      {
        id: 'm1',
        category: 'memory-reuse',
        split: 'held-out',
        tags: ['lang:es', 'difficulty:easy', 'trap:own-goals'],
        question: '¿Quién fue el máximo goleador del Mundial 2018?',
        intent: 'An approval is reused.',
        notes: 'Why.',
        checks: [{ type: 'noToolErrors' }],
        expectedSql: 'SELECT 1 FROM world_cup.goals',
        trapSql: 'SELECT 2 FROM world_cup.goals',
        resultSetOptions: { distinctRows: true },
        teach: [teachSignal()],
        memoryChecks: [{ type: 'noRowValuesRetained', criterion: 'D4' }],
      },
    ]);
  });

  it('puts a case only in the variant of its sample', () => {
    const sets = load(
      [
        memoryCase(),
        memoryCase({ id: 'm2', fixture: 'finance' }),
        memoryCase({ id: 'm3' }),
      ],
      [
        memoryVariant(),
        memoryVariant({ id: 'memory-test-finance', fixtureId: 'finance' }),
      ],
    );
    expect(sets.map((set) => set.cases.map((c) => c.id))).toEqual([
      ['m1', 'm3'],
      ['m2'],
    ]);
  });

  it.each(['fixture', 'category', 'tags', 'intent', 'notes', 'teach', 'probe'])(
    'a case without %s, naming the file and the case',
    (field) => {
      expect(refused([without(memoryCase(), field)])).toMatch(
        new RegExp(`^Eval set file memory\\.json, case "m1": "${field}"`),
      );
    },
  );

  it.each([
    ['a question of its own', { question: 'Q?' }, '"question"'],
    [
      'a reference of its own',
      { expectedSql: { postgres: 'SELECT 1' } },
      '"expectedSql"',
    ],
    ['a judge rubric', { judgeRubric: 'R' }, '"judgeRubric"'],
  ])('a case with %s', (_what, fields, key) => {
    expect(refused([memoryCase(fields)])).toBe(
      `Eval set file memory.json, case "m1": unknown field(s) ${key}; known fields: id, fixture, category, split, tags, intent, notes, teach, probe`,
    );
  });

  it('a probe or a teach signal with a field it does not list', () => {
    expect(
      refused([memoryCase({ probe: probe({ agentTools: ['visuals'] }) })]),
    ).toBe(
      'Eval set file memory.json, case "m1", probe: unknown field(s) "agentTools"; known fields: question, expectedSql, trapSql, checks, resultSetOptions',
    );
    expect(
      refused([memoryCase({ teach: [teachSignal({ answer: 'Kane' })] })]),
    ).toBe(
      'Eval set file memory.json, case "m1", teach signal #1: unknown field(s) "answer"; known fields: kind, at, question, sql, note',
    );
  });

  it('a fixture no variant of the file has, a category outside the six, a bad id', () => {
    expect(refused([memoryCase({ fixture: 'finance' })])).toBe(
      'Eval set file memory.json, case "m1": fixture "finance" is the sample of no variant of this file; known: world-cup',
    );
    expect(refused([memoryCase({ category: 'lookup' })])).toBe(
      'Eval set file memory.json, case "m1": category "lookup" is not one of memory-reuse, memory-correction, memory-update, memory-rejected, memory-abstain, memory-vs-curated',
    );
    expect(refused([memoryCase({ id: 'Memory 1' })])).toBe(
      'Eval set file memory.json, case "Memory 1": the id must be lowercase words joined by hyphens',
    );
  });

  it('tags without the probe’s language or a difficulty', () => {
    expect(refused([memoryCase({ tags: ['difficulty:easy'] })])).toBe(
      'Eval set file memory.json, case "m1": "tags" must name the language with one of lang:en, lang:es',
    );
    expect(refused([memoryCase({ tags: ['lang:en'] })])).toBe(
      'Eval set file memory.json, case "m1": "tags" must name the difficulty with one of difficulty:easy, difficulty:medium, difficulty:hard',
    );
  });

  it('no teach signal or more than 3', () => {
    const message =
      'Eval set file memory.json, case "m1": "teach" is required and must hold 1 to 3 signals';
    expect(refused([memoryCase({ teach: [] })])).toBe(message);
    const four = ['10', '11', '12', '13'].map((hour) =>
      teachSignal({ at: `2026-11-02T${hour}:00:00Z` }),
    );
    expect(refused([memoryCase({ teach: four })])).toBe(message);
  });

  it('a signal of another kind, a time that is not ISO 8601 UTC or not later than the one before', () => {
    expect(
      refused([memoryCase({ teach: [teachSignal({ kind: 'approval' })] })]),
    ).toBe(
      'Eval set file memory.json, case "m1", teach signal #1: kind "approval" is not one of verified_query, correction, rejection',
    );
    for (const at of [
      '2026-11-02 15:00',
      '2026-11-02T15:00:00+01:00',
      '2026-13-45T99:00:00Z',
    ]) {
      expect(refused([memoryCase({ teach: [teachSignal({ at })] })])).toBe(
        `Eval set file memory.json, case "m1", teach signal #1: "at" "${at}" is not an ISO 8601 UTC time such as 2026-11-02T15:00:00Z`,
      );
    }
    expect(
      refused([
        memoryCase({
          teach: [
            teachSignal({ at: '2026-11-02T15:00:00Z' }),
            teachSignal({
              kind: 'correction',
              at: '2026-11-02T15:00:00Z',
              note: 'Leave own goals out.',
            }),
          ],
        }),
      ]),
    ).toBe(
      'Eval set file memory.json, case "m1", teach signal #2: "at" 2026-11-02T15:00:00Z is not later than the signal before it (2026-11-02T15:00:00Z)',
    );
  });

  it('a correction without a note, or an approval with one; a rejection may have one or not', () => {
    expect(
      refused([memoryCase({ teach: [teachSignal({ kind: 'correction' })] })]),
    ).toBe(
      'Eval set file memory.json, case "m1", teach signal #1: a correction needs a "note"',
    );
    expect(
      refused([memoryCase({ teach: [teachSignal({ note: 'Good.' })] })]),
    ).toBe(
      'Eval set file memory.json, case "m1", teach signal #1: an approval (verified_query) takes no "note"',
    );
    const rejected = (note?: string) =>
      memoryCase({
        category: 'memory-rejected',
        teach: [teachSignal({ kind: 'rejection', ...(note ? { note } : {}) })],
        probe: probe({
          checks: [{ type: 'noRowValuesRetained' }, { type: 'notRejectedSql' }],
        }),
      });
    expect(() => load([rejected()])).not.toThrow();
    expect(() =>
      load([rejected('Shoot-out kicks are not goals.')]),
    ).not.toThrow();
  });

  it('a memory-rejected case with no rejection signal', () => {
    expect(
      refused([
        memoryCase({
          category: 'memory-rejected',
          probe: probe({
            checks: [
              { type: 'noRowValuesRetained' },
              { type: 'notRejectedSql' },
            ],
          }),
        }),
      ]),
    ).toBe(
      'Eval set file memory.json, case "m1": a memory-rejected case needs a "rejection" teach signal',
    );
  });

  it('a probe without expectedSql.postgres or trapSql.postgres, or with another dialect', () => {
    for (const key of ['expectedSql', 'trapSql']) {
      expect(refused([memoryCase({ probe: without(probe(), key) })])).toBe(
        `Eval set file memory.json, case "m1", probe: "${key}.postgres" is required and must be a non-empty string`,
      );
      expect(
        refused([
          memoryCase({ probe: probe({ [key]: { sqlite: 'SELECT 1' } }) }),
        ]),
      ).toBe(
        `Eval set file memory.json, case "m1", probe: "${key}.postgres" is required and must be a non-empty string`,
      );
    }
    expect(
      refused([
        memoryCase({
          probe: probe({
            expectedSql: { postgres: 'SELECT 1', sqlite: 'SELECT 1' },
          }),
        }),
      ]),
    ).toBe(
      'Eval set file memory.json, case "m1", probe expectedSql: unknown field(s) "sqlite"; known fields: postgres',
    );
  });

  it('a probe without the memory checks its category needs', () => {
    expect(
      refused([
        memoryCase({ probe: probe({ checks: [{ type: 'noToolErrors' }] }) }),
      ]),
    ).toBe(
      'Eval set file memory.json, case "m1", probe: the check "noRowValuesRetained" is required on every memory case',
    );
    expect(
      refused([
        memoryCase({
          category: 'memory-rejected',
          teach: [teachSignal({ kind: 'rejection' })],
        }),
      ]),
    ).toBe(
      'Eval set file memory.json, case "m1", probe: the check "notRejectedSql" is required on a memory-rejected case',
    );
    expect(refused([memoryCase({ category: 'memory-abstain' })])).toBe(
      'Eval set file memory.json, case "m1", probe: the check "teachNotRecalled" is required on a memory-abstain case',
    );
  });

  it('a memory check with arguments, twice, or with a criterion outside the list', () => {
    const withChecks = (checks: unknown[]) =>
      refused([memoryCase({ probe: probe({ checks }) })]);
    expect(
      withChecks([{ type: 'noRowValuesRetained', args: { strict: true } }]),
    ).toBe(
      'Eval set file memory.json, case "m1", probe, check #1: "noRowValuesRetained" takes no "args"',
    );
    expect(
      withChecks([
        { type: 'noRowValuesRetained' },
        { type: 'noRowValuesRetained' },
      ]),
    ).toMatch(
      /probe, check #2: check type "noRowValuesRetained" is used twice/,
    );
    expect(
      withChecks([{ type: 'noRowValuesRetained', criterion: 'M4' }]),
    ).toMatch(
      /probe, check #1: criterion "M4" is not one of D1, .+, M1, M2, M3$/,
    );
    expect(withChecks([{ type: 'remembers' }])).toMatch(
      /probe, check #1: check type "remembers" is not one of includes, .+, noRowValuesRetained, notRejectedSql, teachNotRecalled$/,
    );
  });

  it('a memory set on another dialect', () => {
    expect(
      refused(
        [memoryCase({ fixture: 'world-cup-rest' })],
        [
          memoryVariant({
            fixtureId: 'world-cup-rest',
            dialect: 'sqlite',
          }),
        ],
      ),
    ).toBe(
      'Eval set file memory.json, variant "memory-test": a memory set runs on PostgreSQL only; dialect "sqlite" is not postgres',
    );
  });

  it('a memory check or a memory category in any other question bank file', () => {
    for (const type of [
      'noRowValuesRetained',
      'notRejectedSql',
      'teachNotRecalled',
    ]) {
      expect(() =>
        parseEvalSetFile(
          file({
            cases: [evalCase({ checks: [{ type: 'noToolErrors' }, { type }] })],
          }),
        ),
      ).toThrow(
        `Eval set file test-set.json, case "c1", check #2: check type "${type}" needs a teach step, so only memory.json may use it`,
      );
    }
    expect(() =>
      parseEvalSetFile(
        file({ cases: [evalCase({ category: 'memory-reuse' })] }),
      ),
    ).toThrow(
      `Eval set file test-set.json, case "c1": category "memory-reuse" is not one of ${QUESTION_CATEGORIES.join(', ')}`,
    );
  });

  it('lets a check of any bank name a memory criterion (R125)', () => {
    const [set] = parseEvalSetFile(
      file({
        cases: [
          evalCase({ checks: [{ type: 'noToolErrors', criterion: 'M2' }] }),
        ],
      }),
    );
    expect(set.cases[0].checks).toEqual([
      { type: 'noToolErrors', criterion: 'M2' },
    ]);
  });
});
