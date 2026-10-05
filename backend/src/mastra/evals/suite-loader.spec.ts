import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_SUITE_ID,
  expandVariants,
  isNumericLooking,
  listSuites,
  loadSuite,
  numericCheckFindings,
  parseSuite,
  referenceSqlFor,
  referenceSqlsFor,
  suiteDatasetError,
  suiteDirectory,
  toAssistantEvalCase,
} from './suite-loader';
import { describeChecks } from './eval-checks';

// Loading a suite whose text checks assert bare numbers on a case with
// reference SQL warns. The warning has its own tests below; keep it out of
// every other test's output.
let quietWarn: jest.SpyInstance;
beforeEach(() => {
  quietWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => quietWarn.mockRestore());
import type { EvalCheckSpec, EvalSuite } from './suite-loader';
import type { DatasetSnapshot } from '../tool-services';
import {
  findFixture,
  requiredEntities,
} from '../../modules/testing-data/fixtures/registry';

/** A minimal valid suite; each test invalidates exactly one thing. */
function suiteJson(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'demo',
    name: 'Demo',
    datasets: ['Demo'],
    requiredEntities: ['demo.things'],
    cases: [
      {
        id: 'first',
        category: 'control',
        question: 'How many things?',
        intent: 'A baseline count.',
        checks: [{ type: 'includes', value: '7' }],
      },
    ],
    ...overrides,
  };
}

describe('suite validation', () => {
  it('accepts a well-formed suite', () => {
    const suite = parseSuite(suiteJson(), 'demo.json');
    expect(suite.cases).toHaveLength(1);
    expect(suite.cases[0].category).toBe('control');
  });

  it.each([
    ['id', { id: '' }],
    ['name', { name: '  ' }],
    ['datasets', { datasets: [] }],
    ['requiredEntities', { requiredEntities: undefined }],
    ['cases', { cases: [] }],
  ])('rejects a missing or empty %s', (field, override) => {
    expect(() => parseSuite(suiteJson(override), 'demo.json')).toThrow(
      new RegExp(`demo\\.json.*${field}`, 's'),
    );
  });

  it('names the file and the case when a case field is missing', () => {
    const broken = suiteJson({
      cases: [
        {
          id: 'first',
          question: 'How many things?',
          intent: 'A baseline count.',
        },
      ],
    });
    expect(() => parseSuite(broken, 'demo.json')).toThrow(
      /demo\.json.*case "first"\.category/,
    );
  });

  it('rejects duplicate case ids, which would silently merge two questions', () => {
    const duplicated = suiteJson({
      cases: [
        {
          id: 'first',
          category: 'control',
          question: 'One?',
          intent: 'i',
        },
        {
          id: 'first',
          category: 'ties',
          question: 'Two?',
          intent: 'i',
        },
      ],
    });
    expect(() => parseSuite(duplicated, 'demo.json')).toThrow(
      /duplicate case id "first"/,
    );
  });

  it('rejects an unknown check type and lists the known ones', () => {
    const broken = suiteJson({
      cases: [
        {
          id: 'first',
          category: 'control',
          question: 'q',
          intent: 'i',
          checks: [{ type: 'includesish', value: '7' }],
        },
      ],
    });
    expect(() => parseSuite(broken, 'demo.json')).toThrow(
      /unknown check type "includesish".*noToolErrors/s,
    );
  });

  it.each([
    [{ type: 'includes' }, /check "includes"\.value/],
    [{ type: 'calledTool' }, /check "calledTool"\.tool/],
    [{ type: 'toolOrder' }, /check "toolOrder"\.tools/],
    [{ type: 'maxToolCalls' }, /check "maxToolCalls"\.max/],
  ])('rejects %p when its own field is missing', (check, expected) => {
    const broken = suiteJson({
      cases: [
        {
          id: 'first',
          category: 'control',
          question: 'q',
          intent: 'i',
          checks: [check],
        },
      ],
    });
    expect(() => parseSuite(broken, 'demo.json')).toThrow(expected);
  });

  it('rejects a case that uses one check type twice, which would collide in scoring', () => {
    const twice = suiteJson({
      cases: [
        {
          id: 'first',
          category: 'control',
          question: 'How many things?',
          intent: 'A baseline count.',
          checks: [
            { type: 'matches', pattern: '7' },
            { type: 'matches', pattern: 'things', flags: 'i' },
          ],
        },
      ],
    });
    expect(() => parseSuite(twice, 'demo.json')).toThrow(
      /case "first" uses the "matches" check twice/,
    );
  });

  it('rejects a matches pattern that does not compile, before any run pays for it', () => {
    const broken = suiteJson({
      cases: [
        {
          id: 'first',
          category: 'control',
          question: 'q',
          intent: 'i',
          checks: [{ type: 'matches', pattern: '4\\s*[-' }],
        },
      ],
    });
    expect(() => parseSuite(broken, 'demo.json')).toThrow(
      /not a valid regular expression/,
    );
  });
});

describe('check mapping', () => {
  it('keeps the specs as checks, in declaration order', () => {
    const checks: EvalCheckSpec[] = [
      { type: 'includes', value: 'Argentina' },
      { type: 'matches', pattern: 'argentina', flags: 'i' },
      { type: 'calledTool', tool: 'run_readonly_sql', times: 2 },
      { type: 'didNotCall', tool: 'create_visual' },
      { type: 'toolOrder', tools: ['a', 'b'] },
      { type: 'maxToolCalls', max: 3 },
      { type: 'usedNoTools' },
      { type: 'noToolErrors' },
      { type: 'excludes', value: 'Pelé' },
      { type: 'equals', value: 'exact' },
      { type: 'finalSqlSucceeded' },
    ];
    const evalCase = toAssistantEvalCase({
      id: 'mapped',
      category: 'control',
      question: 'q',
      intent: 'i',
      checks,
    });
    expect(evalCase.checks).toEqual(checks);
  });

  it('exposes `scorers` only as the question-list view of the checks', () => {
    const evalCase = toAssistantEvalCase({
      id: 'described',
      category: 'control',
      question: 'q',
      intent: 'i',
      checks: [
        { type: 'includes', value: 'Argentina' },
        { type: 'finalSqlSucceeded' },
      ],
    });
    // No Mastra scorer objects any more: id, name and description, exactly
    // what `describeChecks` lists — finalSqlSucceeded included.
    expect(evalCase.scorers).toEqual(describeChecks(evalCase.checks));
    expect(evalCase.scorers.map((scorer) => scorer.id)).toEqual([
      'check-includes',
      'check-final-sql-succeeded',
    ]);
  });

  it('carries the reference SQL, rubric, category and options through', () => {
    const evalCase = toAssistantEvalCase({
      id: 'full',
      category: 'ties',
      question: 'q',
      intent: 'i',
      notes: 'documentation only',
      expectedSql: 'SELECT 1',
      resultSetOptions: { distinctRows: true },
      judgeRubric: 'pass when true',
    });
    expect(evalCase).toMatchObject({
      id: 'full',
      category: 'ties',
      expectedSql: 'SELECT 1',
      resultSetOptions: { distinctRows: true },
      judgeRubric: 'pass when true',
      checks: [],
      scorers: [],
    });
    expect(evalCase).not.toHaveProperty('notes');
  });
});

describe('suiteDirectory', () => {
  it('finds the suites shipped in the source tree', () => {
    expect(suiteDirectory()).toMatch(/evals[\\/]suites$/);
    expect(listSuites().map((suite) => suite.id)).toContain(DEFAULT_SUITE_ID);
  });

  it('falls back to src when the dist copy was not built', () => {
    const root = mkdtempSync(join(tmpdir(), 'suite-loader-'));
    const src = join(root, 'src', 'mastra', 'evals', 'suites');
    mkdirSync(src, { recursive: true });
    expect(suiteDirectory(join(root, 'dist', 'mastra', 'evals'))).toBe(src);
  });

  it('prefers the dist copy when it exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'suite-loader-'));
    const dist = join(root, 'dist', 'mastra', 'evals', 'suites');
    mkdirSync(dist, { recursive: true });
    mkdirSync(join(root, 'src', 'mastra', 'evals', 'suites'), {
      recursive: true,
    });
    expect(suiteDirectory(join(root, 'dist', 'mastra', 'evals'))).toBe(dist);
  });

  it('rewrites the build folder, not a checkout that lives under one', () => {
    const root = mkdtempSync(join(tmpdir(), 'dist-'));
    const nested = join(root, 'dist', 'app', 'dist', 'mastra', 'evals');
    mkdirSync(join(root, 'dist', 'app', 'src', 'mastra', 'evals', 'suites'), {
      recursive: true,
    });
    expect(suiteDirectory(nested)).toBe(
      join(root, 'dist', 'app', 'src', 'mastra', 'evals', 'suites'),
    );
  });
});

describe('loadSuite', () => {
  it('loads the shipped World Cup suite, original ten cases included', () => {
    const suite = loadSuite(DEFAULT_SUITE_ID);
    expect(suite.name).toBe('World Cup');
    // Suites grow (≥ 3 cases per category is the target), so pin the cases
    // that must never disappear rather than a count that must never change.
    const ids = suite.cases.map((evalCase) => evalCase.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'champion-2022',
        'final-score-2018',
        'top-scorer-2022',
        'shootouts',
        'biggest-venue',
        'schema-discovery',
        'ambiguous-best-team',
        'possession-vs-result',
        'out-of-scope',
        'visual-request',
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(suite.requiredEntities).toContain('world_cup.v_player_goal_totals');
    // Every case is categorised: an uncategorised one would silently land in
    // the "uncategorised" bucket and steer nothing.
    expect(suite.cases.every((evalCase) => evalCase.category)).toBe(true);
  });

  // The id here must stay one that will never ship. Naming a real domain (this
  // used to say "health-insurance") makes the test fail the day that suite is
  // added — which is exactly the thing this loader exists to make easy. For the
  // same reason the assertion names one suite it must list, not the whole list.
  it('names the directory and what is available for an unknown id', () => {
    expect(() => loadSuite('no-such-suite')).toThrow(
      /Unknown eval suite "no-such-suite".*Looked in .*suites.*Available suites:.*world-cup/s,
    );
  });

  it('refuses an id that would reach outside the suites folder', () => {
    expect(() => loadSuite('../../secrets')).toThrow(/letters, digits/);
  });
});

/* ------------------------------------------------------------- preflight */

const worldCup = (): EvalSuite => loadSuite(DEFAULT_SUITE_ID);

function snapshot(overrides: Partial<DatasetSnapshot> = {}): DatasetSnapshot {
  return {
    name: 'Sample',
    datasourceId: 'wc',
    datasourceKind: 'postgres',
    tables: worldCup().requiredEntities.map((entity) => `db.${entity}`),
    ...overrides,
  };
}

describe('suiteDatasetError', () => {
  it('passes a scope that carries every required entity', () => {
    expect(
      suiteDatasetError(worldCup(), ['Sample'], [snapshot()]),
    ).toBeUndefined();
  });

  it('uses the suite own required entities, not a hard-coded fixture', () => {
    const suite: EvalSuite = {
      ...worldCup(),
      id: 'demo',
      name: 'Demo',
      description: undefined,
      fixtureId: undefined,
      requiredEntities: ['health_insurance.claims'],
    };
    const error = suiteDatasetError(suite, ['Sample'], [snapshot()]);
    expect(error).toContain('Missing entities: health_insurance.claims');
    // Without a description, the generated setup sentence names the suite.
    expect(error).toContain('Demo');
    expect(error).toContain('"demo"');
  });

  it('uses the suite description as the setup instruction when it has one', () => {
    const healthInsurance = loadSuite('health-insurance');
    expect(healthInsurance.fixtureId).toBeUndefined();
    expect(
      suiteDatasetError(
        healthInsurance,
        ['Sample'],
        [snapshot({ tables: ['formula1.formula1.race'] })],
      ),
    ).toContain(healthInsurance.description);
  });

  it('defers a bundled sample to the registry preflight and its message', () => {
    const error = suiteDatasetError(
      worldCup(),
      ['Sample'],
      [snapshot({ tables: ['formula1.formula1.race'] })],
    );
    expect(error).toContain('These evals require the bundled World Cup sample:');
    expect(error).toContain('Missing entities: world_cup.tournaments');
  });

  it('requires a datasource of the suite kind', () => {
    const rest: EvalSuite = {
      ...worldCup(),
      fixtureId: undefined,
      description: undefined,
      datasourceKind: 'rest',
    };
    expect(suiteDatasetError(rest, ['Sample'], [snapshot()])).toContain(
      'must belong to one REST API datasource',
    );
  });

  it('matches entities case-insensitively', () => {
    const suite: EvalSuite = {
      ...worldCup(),
      fixtureId: undefined,
      requiredEntities: ['demo.things'],
    };
    expect(
      suiteDatasetError(suite, ['Sample'], [snapshot({ tables: ['db.DEMO.Things'] })]),
    ).toBeUndefined();
  });
});

/* ------------------------------------------------------- bundled samples */

describe('fixture-backed suites', () => {
  const backed = (overrides: Record<string, unknown> = {}): unknown =>
    suiteJson({
      fixtureId: 'world-cup',
      datasets: undefined,
      requiredEntities: undefined,
      ...overrides,
    });

  it('takes entities, kind and default dataset from the registry', () => {
    const fixture = findFixture('world-cup')!;
    const suite = parseSuite(backed(), 'demo.json');
    expect(suite.requiredEntities).toEqual(requiredEntities(fixture));
    expect(suite.datasourceKind).toBe('postgres');
    expect(suite.datasets).toEqual([fixture.datasetName]);
  });

  it('reads a REST sample as a REST suite', () => {
    const suite = parseSuite(backed({ fixtureId: 'world-cup-rest' }), 'demo.json');
    expect(suite.datasourceKind).toBe('rest');
  });

  it('rejects a fixture the registry does not have', () => {
    expect(() =>
      parseSuite(backed({ fixtureId: 'no-such-sample' }), 'demo.json'),
    ).toThrow(/demo\.json.*no-such-sample.*registry/);
  });

  it.each([
    ['requiredEntities', { requiredEntities: ['world_cup.teams'] }],
    ['datasourceKind', { datasourceKind: 'postgres' }],
  ])('refuses a %s that would repeat the registry', (field, override) => {
    expect(() => parseSuite(backed(override), 'demo.json')).toThrow(
      new RegExp(`${field} comes from fixture`),
    );
  });

  it('rejects an unknown datasourceKind', () => {
    expect(() =>
      parseSuite(suiteJson({ datasourceKind: 'mysql' }), 'demo.json'),
    ).toThrow(/datasourceKind must be one of/);
  });
});

describe('variant suites', () => {
  const base = parseSuite(
    suiteJson({
      cases: [
        {
          id: 'first',
          category: 'control',
          question: 'How many things?',
          intent: 'A baseline count.',
          expectedSql: 'SELECT count(*) FROM demo.things',
        },
        {
          id: 'second',
          category: 'clarification',
          question: 'Which thing is best?',
          intent: 'Must ask.',
        },
      ],
    }),
    'demo.json',
  );
  const variant = (expectedSql: Record<string, string>): unknown => ({
    id: 'demo-rest',
    name: 'Demo (REST)',
    datasets: ['Demo (REST)'],
    requiredEntities: ['demo.things'],
    datasourceKind: 'rest',
    variantOf: { suite: 'demo', idPrefix: 'rest-', expectedSql },
  });

  it('copies the base cases, prefixing ids and swapping the reference SQL', () => {
    const suite = parseSuite(
      variant({ first: 'SELECT count(*) FROM api.demo.things' }),
      'demo-rest.json',
      () => base,
    );
    expect(suite.cases.map((c) => c.id)).toEqual(['rest-first', 'rest-second']);
    expect(suite.cases[0].expectedSql).toBe('SELECT count(*) FROM api.demo.things');
    expect(suite.cases[1].expectedSql).toBeUndefined();
    expect(suite.cases[1].question).toBe(base.cases[1].question);
  });

  it('fails when a base reference has no port', () => {
    expect(() => parseSuite(variant({}), 'demo-rest.json', () => base)).toThrow(
      /case "first".*no port/,
    );
  });

  it('fails on a port for a case the base does not have', () => {
    expect(() =>
      parseSuite(
        variant({ first: 'SELECT 1', ghost: 'SELECT 2' }),
        'demo-rest.json',
        () => base,
      ),
    ).toThrow(/ghost/);
  });

  it('refuses inline cases next to variantOf', () => {
    const raw = { ...(variant({ first: 'SELECT 1' }) as object), cases: [] };
    expect(() => parseSuite(raw, 'demo-rest.json', () => base)).toThrow(
      /remove cases/,
    );
  });
});

/* -------------------------------------------------------- shipped suites */

describe('shipped suites', () => {
  it('keeps case ids unique across every suite, so ids alone name a suite', () => {
    const seen = new Map<string, string>();
    for (const suite of listSuites()) {
      for (const evalCase of suite.cases) {
        expect(seen.get(evalCase.id) ?? suite.id).toBe(suite.id);
        seen.set(evalCase.id, suite.id);
      }
    }
  });

  it('serves the World Cup questions over REST with the same checks', () => {
    const postgres = loadSuite('world-cup');
    const rest = loadSuite('world-cup-rest');
    expect(rest.datasourceKind).toBe('rest');
    expect(rest.cases.map((c) => c.id)).toEqual(
      postgres.cases.map((c) => `rest-${c.id}`),
    );
    expect(rest.cases.map((c) => c.checks)).toEqual(
      postgres.cases.map((c) => c.checks),
    );
  });

  it('binds the bundled samples to their registry fixtures', () => {
    expect(loadSuite('world-cup').fixtureId).toBe('world-cup');
    expect(loadSuite('formula-1').fixtureId).toBe('formula-1');
    expect(loadSuite('formula-1').cases).toHaveLength(10);
  });
});

/* ------------------------------------------------- schema v2 additions */

/** One case with overrides, inside an otherwise valid suite. */
function withCase(overrides: Record<string, unknown>): unknown {
  return suiteJson({
    cases: [
      {
        id: 'first',
        category: 'control',
        question: 'How many things?',
        intent: 'A baseline count.',
        ...overrides,
      },
    ],
  });
}

describe('case schema additions', () => {
  it('accepts difficulty, variants, trapSql, per-dialect SQL and provenance', () => {
    const suite = parseSuite(
      withCase({
        difficulty: 'hard',
        variants: ['What is the thing count?', 'Count the things.'],
        expectedSql: 'SELECT COUNT(*) FROM demo.things',
        trapSql: 'SELECT COUNT(*) FROM demo.things_with_tests',
        expectedSqlByDialect: {
          databricks: 'SELECT COUNT(*) FROM `demo`.`things`',
        },
        provenance: 'model-drafted-verified',
        checks: [{ type: 'finalSqlSucceeded' }],
      }),
      'demo.json',
    );
    expect(suite.cases[0]).toMatchObject({
      difficulty: 'hard',
      variants: ['What is the thing count?', 'Count the things.'],
      trapSql: 'SELECT COUNT(*) FROM demo.things_with_tests',
      expectedSqlByDialect: {
        databricks: 'SELECT COUNT(*) FROM `demo`.`things`',
      },
      provenance: 'model-drafted-verified',
      checks: [{ type: 'finalSqlSucceeded' }],
    });
  });

  it.each([
    [
      { difficulty: 'trivial' },
      /case "first"\.difficulty must be one of easy, medium, hard — got "trivial"/,
    ],
    [{ variants: [] }, /case "first"\.variants must be a non-empty array/],
    [
      { variants: ['  '] },
      /case "first"\.variants\[0\] must be a non-empty string/,
    ],
    [{ trapSql: '' }, /case "first"\.trapSql must be a non-empty string/],
    [
      { expectedSqlByDialect: { snowflake: 'SELECT 1' } },
      /unknown dialect "snowflake"/,
    ],
    [
      { expectedSqlByDialect: 'SELECT 1' },
      /expectedSqlByDialect must be an object/,
    ],
    [
      { provenance: 'vibes' },
      /case "first"\.provenance must be one of hand, model-drafted-verified/,
    ],
    [
      { checks: [{ type: 'matches', pattern: 'x', flags: 7 }] },
      /\.flags must be a string/,
    ],
  ])('rejects %p', (override, expected) => {
    expect(() => parseSuite(withCase(override), 'demo.json')).toThrow(expected);
  });

  it('rejects a repeated check type, naming the file, the case and the type', () => {
    const broken = withCase({
      checks: [
        { type: 'matches', pattern: 'a' },
        { type: 'calledTool', tool: 'run_readonly_sql' },
        { type: 'matches', pattern: 'b' },
      ],
    });
    expect(() => parseSuite(broken, 'demo.json')).toThrow(
      /demo\.json: case "first" uses the "matches" check twice/,
    );
  });

  it('compiles matches patterns with the default i flag when flags are absent', () => {
    // An inline flag group is only valid source under some flag sets; the
    // point is that validation compiles what the run will compile.
    expect(() =>
      parseSuite(
        withCase({ checks: [{ type: 'matches', pattern: '[a-z]+' }] }),
        'demo.json',
      ),
    ).not.toThrow();
  });
});

describe('numeric text checks', () => {
  it.each([
    ['57', true],
    ['561.62', true],
    ['\\b42\\b', true],
    ['6[,.]?318[,.]?595|63[,.]?185', true],
    ['4\\s*[-–:]\\s*2', true],
    ['0\\.48[45]|48\\.[45]', true],
    ['Argentina', false],
    ['\\b(possession|%)\\b', false],
    ['likely[_ ]pathogenic', false],
    ['GRCh38', false],
  ])('%p numeric-looking → %p', (value, expected) => {
    expect(isNumericLooking(value)).toBe(expected);
  });

  it('warns — once — when a case with expectedSql asserts a bare number', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const raw = withCase({
        expectedSql: 'SELECT COUNT(*) FROM demo.things',
        checks: [
          { type: 'includes', value: '1,234' },
          { type: 'matches', pattern: 'things', flags: 'i' },
        ],
      });
      parseSuite(raw, 'numeric-warning.json');
      parseSuite(raw, 'numeric-warning.json');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(
        /numeric-warning\.json: 1 check\(s\) assert a bare number.*first \(includes "1,234"\)/,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn when there is no reference SQL to compare the figure', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      parseSuite(
        withCase({ checks: [{ type: 'includes', value: '7' }] }),
        'numeric-no-sql.json',
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('lists the findings for tooling', () => {
    const suite = parseSuite(
      withCase({
        expectedSql: 'SELECT 1',
        checks: [{ type: 'matches', pattern: '\\b22\\b' }],
      }),
      'numeric-findings.json',
    );
    expect(numericCheckFindings(suite.cases)).toEqual([
      { caseId: 'first', type: 'matches', value: '\\b22\\b' },
    ]);
  });
});

describe('referenceSqlFor', () => {
  const evalCase = {
    expectedSql: 'SELECT x::numeric FROM t',
    expectedSqlByDialect: { databricks: 'SELECT CAST(x AS DECIMAL) FROM t' },
  };

  it('picks the dialect override when there is one', () => {
    expect(referenceSqlFor(evalCase, 'databricks')).toBe(
      'SELECT CAST(x AS DECIMAL) FROM t',
    );
  });

  it('falls back to expectedSql for other or missing dialects', () => {
    expect(referenceSqlFor(evalCase, 'postgres')).toBe(
      'SELECT x::numeric FROM t',
    );
    expect(referenceSqlFor(evalCase, undefined)).toBe(
      'SELECT x::numeric FROM t',
    );
    expect(referenceSqlFor(evalCase, 'snowflake')).toBe(
      'SELECT x::numeric FROM t',
    );
    expect(referenceSqlFor({ expectedSql: 'SELECT 1' }, 'databricks')).toBe(
      'SELECT 1',
    );
    expect(referenceSqlFor({}, 'postgres')).toBeUndefined();
  });
});

describe('expectedSqlAlternatives', () => {
  const paid = {
    expectedSql: 'SELECT SUM(paid_cents) FROM t',
    expectedSqlAlternatives: ['SELECT SUM(paid_cents) / 100.0 FROM t'],
    checks: [{ type: 'finalSqlSucceeded' }],
  };

  it('loads and carries them through to the run case', () => {
    const suite = parseSuite(withCase(paid), 'demo.json');
    expect(suite.cases[0].expectedSqlAlternatives).toEqual([
      'SELECT SUM(paid_cents) / 100.0 FROM t',
    ]);
    expect(toAssistantEvalCase(suite.cases[0])).toMatchObject({
      expectedSql: 'SELECT SUM(paid_cents) FROM t',
      expectedSqlAlternatives: ['SELECT SUM(paid_cents) / 100.0 FROM t'],
    });
    expect(expandVariants(suite, false)[0]).toHaveProperty(
      'expectedSqlAlternatives',
    );
  });

  it('leaves the field off a case without alternatives', () => {
    const suite = parseSuite(
      withCase({ expectedSql: 'SELECT 1', checks: [] }),
      'demo.json',
    );
    expect(toAssistantEvalCase(suite.cases[0])).not.toHaveProperty(
      'expectedSqlAlternatives',
    );
  });

  it.each([
    [
      { expectedSqlAlternatives: ['SELECT 2'] },
      /case "first"\.expectedSqlAlternatives needs an expectedSql/,
    ],
    [
      { ...paid, expectedSqlAlternatives: [] },
      /case "first"\.expectedSqlAlternatives must be a non-empty array/,
    ],
    [
      { ...paid, expectedSqlAlternatives: 'SELECT 2' },
      /case "first"\.expectedSqlAlternatives must be a non-empty array/,
    ],
    [
      { ...paid, expectedSqlAlternatives: ['SELECT 2', '  '] },
      /case "first"\.expectedSqlAlternatives\[1\] must be a non-empty string/,
    ],
    [
      { ...paid, expectedSqlAlternatives: [7] },
      /case "first"\.expectedSqlAlternatives\[0\] must be a non-empty string/,
    ],
  ])('rejects %p', (override, expected) => {
    expect(() => parseSuite(withCase(override), 'demo.json')).toThrow(expected);
  });
});

describe('referenceSqlsFor', () => {
  const evalCase = {
    expectedSql: 'SELECT cents FROM t',
    expectedSqlByDialect: { databricks: 'SELECT CAST(cents AS BIGINT) FROM t' },
    expectedSqlAlternatives: ['SELECT cents / 100.0 FROM t', 'SELECT 3'],
  };

  it('lists the primary for the dialect first, then the alternatives in order', () => {
    expect(referenceSqlsFor(evalCase, 'postgres')).toEqual([
      'SELECT cents FROM t',
      'SELECT cents / 100.0 FROM t',
      'SELECT 3',
    ]);
    expect(referenceSqlsFor(evalCase, 'databricks')).toEqual([
      'SELECT CAST(cents AS BIGINT) FROM t',
      'SELECT cents / 100.0 FROM t',
      'SELECT 3',
    ]);
  });

  it('is the primary alone without alternatives, and empty without a reference', () => {
    expect(referenceSqlsFor({ expectedSql: 'SELECT 1' }, undefined)).toEqual([
      'SELECT 1',
    ]);
    expect(
      referenceSqlsFor({ expectedSqlAlternatives: ['SELECT 2'] }, 'postgres'),
    ).toEqual([]);
  });

  it('keeps referenceSqlFor the primary only', () => {
    expect(referenceSqlFor(evalCase, 'postgres')).toBe('SELECT cents FROM t');
  });
});

describe('toAssistantEvalCase (checks + new fields)', () => {
  it('carries the specs as checks, plus the new fields', () => {
    const evalCase = toAssistantEvalCase({
      id: 'full',
      category: 'ties',
      question: 'q',
      intent: 'i',
      difficulty: 'easy',
      trapSql: 'SELECT 2',
      expectedSql: 'SELECT 1',
      expectedSqlByDialect: { databricks: 'SELECT 1' },
      provenance: 'hand',
      checks: [{ type: 'includes', value: 'x' }, { type: 'finalSqlSucceeded' }],
    });
    expect(evalCase).toMatchObject({
      checks: [{ type: 'includes', value: 'x' }, { type: 'finalSqlSucceeded' }],
      difficulty: 'easy',
      trapSql: 'SELECT 2',
      expectedSqlByDialect: { databricks: 'SELECT 1' },
      provenance: 'hand',
    });
  });
});

describe('expandVariants', () => {
  const suite = parseSuite(
    suiteJson({
      cases: [
        {
          id: 'count',
          category: 'control',
          question: 'How many things?',
          intent: 'i',
          expectedSql: 'SELECT COUNT(*) FROM demo.things',
          variants: ['What is the number of things?', 'Count the things.'],
          checks: [{ type: 'finalSqlSucceeded' }],
        },
        { id: 'plain', category: 'ties', question: 'q', intent: 'i' },
      ],
    }),
    'demo.json',
  );

  it('returns the originals only unless variants are asked for', () => {
    expect(expandVariants(suite, false).map((c) => c.id)).toEqual([
      'count',
      'plain',
    ]);
  });

  it('adds each paraphrase after its original as <id>~v<n>, same checks and SQL', () => {
    const cases = expandVariants(suite, true);
    expect(cases.map((c) => [c.id, c.variantOf, c.question])).toEqual([
      ['count', undefined, 'How many things?'],
      ['count~v1', 'count', 'What is the number of things?'],
      ['count~v2', 'count', 'Count the things.'],
      ['plain', undefined, 'q'],
    ]);
    expect(cases[2]).toMatchObject({
      category: 'control',
      expectedSql: 'SELECT COUNT(*) FROM demo.things',
      checks: [{ type: 'finalSqlSucceeded' }],
    });
  });
});

describe('shipped suites', () => {
  // Every suite must load: a suite that throws takes the Evals tab down.
  it.each(['world-cup', 'health-insurance', 'genomics', 'supply-chain', 'banking'])('%s loads', (id) => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const suite = loadSuite(id);
      expect(suite.cases.length).toBeGreaterThan(0);
      for (const evalCase of suite.cases) {
        const types = (evalCase.checks ?? []).map((check) => check.type);
        expect(new Set(types).size).toBe(types.length);
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe('suiteDatasetError — datasource kinds', () => {
  it('accepts a Databricks datasource carrying the entities', () => {
    expect(
      suiteDatasetError(
        worldCup(),
        ['Sample'],
        [snapshot({ datasourceKind: 'databricks' })],
      ),
    ).toBeUndefined();
  });

  it('still rejects datasets spread over two datasources', () => {
    expect(
      suiteDatasetError(
        worldCup(),
        ['Sample', 'Other'],
        [snapshot(), snapshot({ name: 'Other', datasourceId: 'other' })],
      ),
    ).toContain(
      'must belong to one PostgreSQL datasource or one Databricks datasource',
    );
  });

  it('rejects a kind it cannot run reference SQL on', () => {
    expect(
      suiteDatasetError(
        worldCup(),
        ['Sample'],
        [snapshot({ datasourceKind: 'sqlite' as never })],
      ),
    ).toContain(
      'must belong to one PostgreSQL datasource or one Databricks datasource',
    );
  });
});
