/**
 * The real `@mastra/evals/checks` is mocked rather than loaded: requiring it
 * pulls in Mastra core, whose ESM-only dependencies Jest cannot require. What
 * this module owns is the mapping — which factory a spec picks and what it
 * passes — and that is exactly what the stub records. The factories
 * themselves are Mastra's to test, and the real wiring is exercised by the
 * app and by `nest build`.
 */
jest.mock('@mastra/evals/checks', () => {
  const record =
    (id: string) =>
    (...args: unknown[]) => ({ id, args });
  return {
    checks: {
      includes: record('check-includes'),
      excludes: record('check-excludes'),
      equals: record('check-equals'),
      matches: record('check-matches'),
      calledTool: record('check-called-tool'),
      didNotCall: record('check-did-not-call'),
      toolOrder: record('check-tool-order'),
      maxToolCalls: record('check-max-tool-calls'),
      usedNoTools: record('check-used-no-tools'),
      noToolErrors: record('check-no-tool-errors'),
    },
  };
});

import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_SUITE_ID,
  listSuites,
  loadSuite,
  parseSuite,
  suiteDatasetError,
  suiteDirectory,
  toAssistantEvalCase,
} from './suite-loader';
import type { EvalSuite } from './suite-loader';
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

describe('expectedReasoning', () => {
  const withReasoning = (expectedReasoning: unknown): unknown =>
    suiteJson({
      cases: [
        {
          id: 'first',
          category: 'domain-semantics',
          question: 'What is the average salary of tech employees in 2025?',
          intent: 'Technology division, salary on 31 December, USD.',
          expectedReasoning,
        },
      ],
    });

  it('is optional, and carried through trimmed when present', () => {
    expect(parseSuite(suiteJson(), 'demo.json').cases[0]).not.toHaveProperty(
      'expectedReasoning',
    );
    const suite = parseSuite(
      withReasoning({
        tables: ['hr.v_salary_by_year', ' hr.departments '],
        assumptions: ['employees only, no contractors'],
        metric: ' avg_base_salary_usd ',
      }),
      'demo.json',
    );
    expect(suite.cases[0].expectedReasoning).toEqual({
      tables: ['hr.v_salary_by_year', 'hr.departments'],
      assumptions: ['employees only, no contractors'],
      metric: 'avg_base_salary_usd',
    });
  });

  it('accepts any one of the three fields on its own', () => {
    for (const reasoning of [
      { tables: ['hr.employees'] },
      { assumptions: ['salary effective on 31 December'] },
      { metric: 'attrition_rate' },
    ]) {
      expect(
        parseSuite(withReasoning(reasoning), 'demo.json').cases[0]
          .expectedReasoning,
      ).toEqual(reasoning);
    }
  });

  it.each([
    [
      'not an object',
      ['hr.employees'],
      /case "first"\.expectedReasoning must be an object/,
    ],
    [
      'empty',
      {},
      /expectedReasoning must carry at least one of tables, assumptions, metric/,
    ],
    [
      'a typo in a key',
      { table: ['hr.employees'] },
      /unknown field\(s\) "table".*known fields: tables/,
    ],
    [
      'empty tables',
      { tables: [] },
      /expectedReasoning\.tables must be a non-empty array/,
    ],
    [
      'a blank table',
      { tables: [' '] },
      /expectedReasoning\.tables\[0\] must be a non-empty string/,
    ],
    [
      'a bare table name',
      { tables: ['employees'] },
      /tables\[0\] "employees" must be schema\.table/,
    ],
    [
      'a catalog-qualified table',
      { tables: ['world_cup.hr.employees'] },
      /must be schema\.table/,
    ],
    [
      'empty assumptions',
      { assumptions: [] },
      /expectedReasoning\.assumptions must be a non-empty array/,
    ],
    [
      'an unscorable phrase',
      { assumptions: ['in USD'] },
      /assumptions\[0\] "in USD" has no word of four or more letters/,
    ],
    [
      'a blank metric',
      { metric: '  ' },
      /expectedReasoning\.metric must be a non-empty string/,
    ],
  ])('rejects %s', (_label, reasoning, expected) => {
    expect(() => parseSuite(withReasoning(reasoning), 'demo.json')).toThrow(
      expected,
    );
  });

  it('leaves the in-app case shape untouched — only the CLI reads it', () => {
    const suite = parseSuite(
      withReasoning({ tables: ['hr.employees'] }),
      'demo.json',
    );
    expect(toAssistantEvalCase(suite.cases[0])).not.toHaveProperty(
      'expectedReasoning',
    );
  });
});

describe('learningScenario', () => {
  const scenario = (overrides: Record<string, unknown> = {}) => ({
    comments: [
      {
        block: 'interpretation',
        vote: 'down',
        comment: 'Our fiscal year runs from 1 February to 31 January.',
      },
      { block: 'metric', comment: 'Net revenue excludes tax and shipping.' },
    ],
    generalisesTo: ['second'],
    before: { band: 'medium' },
    after: { band: 'high' },
    ...overrides,
  });
  /** Two cases: `first` carries the scenario, `second` is its target. */
  const withScenario = (
    learningScenario: unknown,
    second: Record<string, unknown> = {},
  ): unknown =>
    suiteJson({
      cases: [
        {
          id: 'first',
          category: 'domain-semantics',
          question: 'What was our net revenue in fiscal year 2025?',
          intent: 'Fiscal year and net revenue are tribal knowledge.',
          learningScenario,
        },
        {
          id: 'second',
          category: 'domain-semantics',
          question: 'How many orders did we take in fiscal year 2025?',
          intent: 'The fiscal-year lesson must carry over.',
          ...second,
        },
      ],
    });

  it('is optional, and parsed with its comments, targets and bands', () => {
    expect(parseSuite(suiteJson(), 'demo.json').cases[0]).not.toHaveProperty(
      'learningScenario',
    );
    const suite = parseSuite(withScenario(scenario()), 'demo.json');
    expect(suite.cases[0].learningScenario).toEqual({
      comments: [
        {
          block: 'interpretation',
          vote: 'down',
          comment: 'Our fiscal year runs from 1 February to 31 January.',
        },
        { block: 'metric', comment: 'Net revenue excludes tax and shipping.' },
      ],
      generalisesTo: ['second'],
      before: { band: 'medium' },
      after: { band: 'high' },
    });
  });

  it('needs only its comments', () => {
    const minimal = {
      comments: [{ block: 'sql', vote: 'up', comment: 'Right join.' }],
    };
    expect(
      parseSuite(withScenario(minimal), 'demo.json').cases[0].learningScenario,
    ).toEqual(minimal);
  });

  it.each([
    ['not an object', ['a note'], /learningScenario must be an object/],
    [
      'an unknown key',
      scenario({ generalizesTo: ['second'] }),
      /learningScenario has unknown field\(s\) "generalizesTo".*known fields: comments/,
    ],
    [
      'no comments',
      scenario({ comments: undefined }),
      /learningScenario\.comments must be a non-empty array/,
    ],
    [
      'empty comments',
      scenario({ comments: [] }),
      /learningScenario\.comments must be a non-empty array/,
    ],
    [
      'an unknown key on a comment',
      scenario({ comments: [{ block: 'metric', note: 'x', comment: 'y' }] }),
      /comments\[0\] has unknown field\(s\) "note"/,
    ],
    [
      'an unknown block kind',
      scenario({ comments: [{ block: 'answer', comment: 'Wrong.' }] }),
      /comments\[0\]\.block must be one of interpretation, data-selection, assumptions, metric, sql/,
    ],
    [
      'a vote that is not up or down',
      scenario({
        comments: [{ block: 'metric', vote: 'neutral', comment: 'Hmm.' }],
      }),
      /comments\[0\]\.vote must be one of up, down/,
    ],
    [
      'a blank comment',
      scenario({ comments: [{ block: 'metric', comment: '  ' }] }),
      /comments\[0\]\.comment must be a non-empty string/,
    ],
    [
      'an empty generalisesTo',
      scenario({ generalisesTo: [] }),
      /generalisesTo must be a non-empty array/,
    ],
    [
      'a repeated generalisesTo id',
      scenario({ generalisesTo: ['second', 'second'] }),
      /generalisesTo lists "second" twice/,
    ],
    [
      'a band outside high, medium, low',
      scenario({ after: { band: 'certain' } }),
      /learningScenario\.after\.band must be one of high, medium, low/,
    ],
    [
      'an unknown key on a band expectation',
      scenario({ before: { band: 'medium', score: 0.7 } }),
      /learningScenario\.before has unknown field\(s\) "score"/,
    ],
  ])('rejects %s', (_label, value, expected) => {
    expect(() => parseSuite(withScenario(value), 'demo.json')).toThrow(
      expected,
    );
  });

  it('rejects a generalisesTo id that is not a case in the suite', () => {
    expect(() =>
      parseSuite(
        withScenario(scenario({ generalisesTo: ['orders-fy2025'] })),
        'demo.json',
      ),
    ).toThrow(
      /generalisesTo names "orders-fy2025", which is not a case in this suite — known ids: first, second/,
    );
  });

  it('rejects a case that names itself as its own generalisation', () => {
    expect(() =>
      parseSuite(
        withScenario(scenario({ generalisesTo: ['first'] })),
        'demo.json',
      ),
    ).toThrow(/generalisesTo names the case itself/);
  });

  it('rejects a generalisation target that is taught directly', () => {
    expect(() =>
      parseSuite(
        withScenario(scenario(), {
          learningScenario: {
            comments: [{ block: 'metric', comment: 'Count completed only.' }],
          },
        }),
        'demo.json',
      ),
    ).toThrow(/names "second", which carries a learningScenario of its own/);
  });

  it('leaves the in-app case shape untouched — only the learning demo reads it', () => {
    const suite = parseSuite(withScenario(scenario()), 'demo.json');
    expect(toAssistantEvalCase(suite.cases[0])).not.toHaveProperty(
      'learningScenario',
    );
  });
});

describe('check mapping', () => {
  it('builds one scorer per spec, in declaration order', () => {
    const evalCase = toAssistantEvalCase({
      id: 'mapped',
      category: 'control',
      question: 'q',
      intent: 'i',
      checks: [
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
      ],
    });
    const built = evalCase.scorers as unknown as {
      id: string;
      args: unknown[];
    }[];
    expect(built.map((scorer) => scorer.id)).toEqual([
      'check-includes',
      'check-matches',
      'check-called-tool',
      'check-did-not-call',
      'check-tool-order',
      'check-max-tool-calls',
      'check-used-no-tools',
      'check-no-tool-errors',
      'check-excludes',
      'check-equals',
    ]);
    expect(built[0].args).toEqual(['Argentina']);
    // Pattern + flags become one RegExp: the flags are the reason `matches`
    // takes them separately in JSON at all.
    expect(built[1].args).toEqual([/argentina/i]);
    expect(built[2].args).toEqual(['run_readonly_sql', { times: 2 }]);
    expect(built[4].args).toEqual([['a', 'b']]);
    expect(built[5].args).toEqual([3]);
  });

  it('omits the options object when calledTool has no times', () => {
    const evalCase = toAssistantEvalCase({
      id: 'once',
      category: 'control',
      question: 'q',
      intent: 'i',
      checks: [{ type: 'calledTool', tool: 'list_entities' }],
    });
    expect(
      (evalCase.scorers[0] as unknown as { args: unknown[] }).args,
    ).toEqual(['list_entities', undefined]);
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
      scorers: [],
    });
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
  it('loads the shipped World Cup suite with all ten cases', () => {
    const suite = loadSuite(DEFAULT_SUITE_ID);
    expect(suite.name).toBe('World Cup');
    expect(suite.cases).toHaveLength(10);
    expect(suite.requiredEntities).toContain('world_cup.v_player_goal_totals');
    // Every case is categorised: an uncategorised one would silently land in
    // the "uncategorised" bucket and steer nothing.
    expect(suite.cases.every((evalCase) => evalCase.category)).toBe(true);
  });

  it('loads the shipped retail suite with its learning scenario', () => {
    const suite = loadSuite('retail');
    expect(suite.datasets).toEqual(['Retail']);
    const trap = suite.cases.find((c) => c.id === 'net-revenue-fy2025');
    expect(trap?.learningScenario).toMatchObject({
      comments: [
        { block: 'interpretation', vote: 'down' },
        { block: 'metric', vote: 'down' },
      ],
      generalisesTo: ['orders-fy2025'],
      before: { band: 'medium' },
      after: { band: 'high' },
    });
    // Exactly one taught case: every other case must pass on what it teaches.
    expect(suite.cases.filter((c) => c.learningScenario)).toHaveLength(1);
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
