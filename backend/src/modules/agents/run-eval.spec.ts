/**
 * Unit tests for the golden-set CLI (`backend/scripts/run-eval.ts`) and the
 * run-log diff CLI (`backend/scripts/eval-diff.ts`).
 *
 * WHY they live under `src/`: jest's `rootDir` is `src`, so a spec next to the
 * scripts would never be collected. The scripts themselves stay in
 * `scripts/`, which `tsconfig.build.json` excludes from the Nest build.
 *
 * Only the pure parts are covered — argument parsing, case-file loading, the
 * validate decision, the record builders and the output formatting.
 * Importing the modules is deliberately cheap: the Nest graph and the shared
 * harness are loaded with `require` at run time, so nothing here boots the
 * app, opens a database or calls a model.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  EvalSetupError,
  armEngineOverrides,
  attemptDetail,
  buildCliRunRecord,
  buildValidateRecord,
  decideValidateStatus,
  expertCaseResult,
  expertSummaryOf,
  formatHeadline,
  goldenToSuiteEvalCase,
  judgeModelMismatch,
  loadGoldenSet,
  loopCell,
  loopFilename,
  loopMatrixTable,
  mergeSidePassUsage,
  modelRouterId,
  parseArgs,
  partitionCases,
  readCaseFile,
  reportExpert,
  resolveDialect,
  runsText,
  selectCases,
  splitArmList,
  summarizeCategories,
  validateSummaryLine,
  withExpert,
  type CaseOutcomeLike,
  type CaseResult,
  type CliRunRecordInput,
  type GoldenCase,
  type ValidateRow,
} from '../../../scripts/run-eval';
import {
  DiffInputError,
  formatDiffConsole,
  loadRunLog,
  parseDiffArgs,
  parseDraft,
} from '../../../scripts/eval-diff';
import { diffRunLogs } from './eval-diff';
import { buildLogCase } from './eval-run-record';
import {
  summarizeCases,
  tallyCategories,
  type EvalRunLogAttempt,
  type EvalRunLogCaseV2,
  type EvalVerdict,
  type TokenUsage,
} from './eval-telemetry';
import {
  ENGINE_DEFAULTS,
  resolveEngineOptions,
} from '../engine/engine-options';
import type { SuiteEvalCase } from '../../mastra/evals/suite-loader';

const usage = (total: number): TokenUsage => ({
  inputTokens: total - 20,
  outputTokens: 20,
  totalTokens: total,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  calls: 1,
});

const attempt = (
  n: number,
  verdict: EvalVerdict,
  extra: Partial<EvalRunLogAttempt> = {},
): EvalRunLogAttempt => ({
  attempt: n,
  verdict,
  checks: [
    {
      id: 'result-set-match',
      passed: verdict === 'PASS',
      ...(verdict === 'GAP' ? { gap: true, reason: 'reference failed' } : {}),
      ...(verdict === 'FAIL' ? { reason: 'the figures differ' } : {}),
    },
  ],
  finalSql: 'SELECT 1',
  sql: [{ sql: 'SELECT 1', ok: true, rowCount: 1 }],
  answer: 'An answer.',
  steps: 2,
  calledTools: ['run_readonly_sql'],
  repairs: [],
  warnings: [],
  durationMs: 1000,
  usage: usage(120),
  ...extra,
});

const FIXED_ENV = { appVersion: '0.0.0-test', gitCommit: 'abc1234' };

function recordInput(
  overrides: Partial<CliRunRecordInput> = {},
): CliRunRecordInput {
  return {
    runId: '11111111-2222-3333-4444-555555555555',
    label: 'iter0',
    harness: 'golden-set',
    suite: 'health-insurance',
    datasets: ['Health Insurance'],
    datasourceKind: 'postgres',
    dialect: 'postgres',
    model: 'openai/gpt-5',
    reasoningEffort: 'high',
    repeat: 2,
    arm: 'fixer-off',
    engineFallback: resolveEngineOptions({}, { sqlRepair: false }),
    configHashFallback: 'fallbackhash',
    loopId: 'loop-1234-5678',
    startedAt: new Date('2026-09-23T10:00:00.000Z'),
    finishedAt: new Date('2026-09-23T10:05:00.000Z'),
    outcomes: [],
    skipped: [],
    notReached: 0,
    pricing: {},
    status: 'completed',
    environment: FIXED_ENV,
    ...overrides,
  };
}

/** Three graded cases: one flaky FAIL, one PASS, one GAP. */
function sampleOutcomes(): CaseOutcomeLike[] {
  return [
    {
      logCase: buildLogCase({ id: 'a-ratio', category: 'ratio-trap' }, [
        attempt(1, 'PASS'),
        attempt(2, 'FAIL'),
      ]),
      engine: resolveEngineOptions(
        {},
        { sqlRepair: false, descriptiveErrors: true },
      ),
      configHash: 'abc123def456',
      judgeModel: 'openai/gpt-4.1-mini',
      sidePassUsage: { grounding: usage(30) },
    },
    {
      logCase: buildLogCase({ id: 'b-control', category: 'control' }, [
        attempt(1, 'PASS'),
        attempt(2, 'PASS'),
      ]),
      sidePassUsage: { grounding: usage(40), review: usage(50) },
    },
    {
      logCase: buildLogCase({ id: 'c-gap', category: 'ties' }, [
        attempt(1, 'GAP'),
        attempt(2, 'GAP'),
      ]),
    },
  ];
}

describe('run-eval CLI', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'run-eval-spec-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeJson = (name: string, value: unknown): string => {
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify(value), 'utf8');
    return file;
  };

  describe('parseArgs', () => {
    it('defaults to the shipped golden set, one run per case, logging on', () => {
      const options = parseArgs([]);
      expect(options.file).toMatch(/eval[/\\]golden-set\.json$/);
      expect(options.fileExplicit).toBe(false);
      expect(options.suite).toBeUndefined();
      expect(options.suites).toBeUndefined();
      expect(options.repeat).toBe(1);
      expect(options.validate).toBe(false);
      expect(options.log).toBe(true);
      expect(options.includePlaceholders).toBe(false);
      expect(options.keepSessions).toBe(false);
      expect(options.verbose).toBe(false);
      expect(options.arm).toBeUndefined();
      expect(options.arms).toBeUndefined();
      expect(options.engine).toBeUndefined();
      expect(options.judgeModel).toBeUndefined();
      expect(options.dialect).toBe('auto');
      expect(options.includeVariants).toBe(false);
      expect(options.stopOnError).toBe(false);
      expect(options.expert).toBe(false);
    });

    it('parses --expert, and refuses it with --validate (which makes no model calls)', () => {
      expect(parseArgs(['--suite', 'hr', '--expert']).expert).toBe(true);
      expect(() => parseArgs(['--expert', '--validate'])).toThrow(
        /--expert .* --validate/,
      );
      expect(() => parseArgs(['--validate', '--expert'])).toThrow(
        EvalSetupError,
      );
    });

    it('keeps the original flags working', () => {
      const options = parseArgs([
        '--only',
        'denial',
        '--include-placeholders',
        '--keep-sessions',
        '--verbose',
      ]);
      expect(options.only).toBe('denial');
      expect(options.includePlaceholders).toBe(true);
      expect(options.keepSessions).toBe(true);
      expect(options.verbose).toBe(true);
    });

    it('resolves --file against the working directory', () => {
      const options = parseArgs(['-f', 'cases/my-set.json']);
      expect(options.fileExplicit).toBe(true);
      expect(options.file).toBe(join(process.cwd(), 'cases/my-set.json'));
    });

    it('parses the suite, filter, label, repeat, validate and log flags', () => {
      const options = parseArgs([
        '--suite',
        'health-insurance',
        '--category',
        'ratio',
        '--label',
        'iter-2-prompt-ratio',
        '--repeat',
        '3',
        '--validate',
        '--no-log',
      ]);
      expect(options.suite).toBe('health-insurance');
      expect(options.category).toBe('ratio');
      expect(options.label).toBe('iter-2-prompt-ratio');
      expect(options.repeat).toBe(3);
      expect(options.validate).toBe(true);
      expect(options.log).toBe(false);
    });

    it('rejects --suite together with --file, in either order', () => {
      expect(() =>
        parseArgs(['--file', 'a.json', '--suite', 'genomics']),
      ).toThrow(/mutually exclusive/);
      expect(() =>
        parseArgs(['--suite', 'genomics', '--file', 'a.json']),
      ).toThrow(/mutually exclusive/);
    });

    it('parses --suites as a deduplicated list, or all', () => {
      expect(
        parseArgs(['--suites', 'world-cup, genomics ,world-cup']).suites,
      ).toEqual(['world-cup', 'genomics']);
      expect(parseArgs(['--suites', 'all']).suites).toEqual(['all']);
    });

    it('rejects --suites combined with --suite, --file or an id next to all', () => {
      expect(() => parseArgs(['--suite', 'a', '--suites', 'b'])).toThrow(
        /--suite and --suites are mutually exclusive/,
      );
      expect(() => parseArgs(['--suites', 'b', '--suite', 'a'])).toThrow(
        /--suite and --suites are mutually exclusive/,
      );
      expect(() => parseArgs(['--suites', 'a', '--file', 'x.json'])).toThrow(
        /mutually exclusive/,
      );
      expect(() => parseArgs(['--file', 'x.json', '--suites', 'a'])).toThrow(
        /mutually exclusive/,
      );
      expect(() => parseArgs(['--suites', 'all,genomics'])).toThrow(
        /do not combine it/,
      );
      expect(() => parseArgs(['--suites', ' , '])).toThrow(
        /at least one suite/,
      );
    });

    it('accepts a preset --arm and a custom:{json} arm', () => {
      expect(parseArgs(['--arm', 'fixer-off']).arm).toBe('fixer-off');
      expect(parseArgs(['--arm', 'custom:{"sqlRepair":false}']).arm).toBe(
        'custom:{"sqlRepair":false}',
      );
    });

    it('rejects an unknown arm or broken custom JSON before any token', () => {
      expect(() => parseArgs(['--arm', 'fixer-of'])).toThrow(
        /Unknown arm "fixer-of"/,
      );
      expect(() => parseArgs(['--arms', 'baseline,nope'])).toThrow(
        /Unknown arm "nope"/,
      );
      expect(() => parseArgs(['--arm', 'custom:{bad'])).toThrow(
        /not valid JSON/,
      );
    });

    it('parses --arms, keeping commas inside custom JSON', () => {
      expect(
        parseArgs([
          '--arms',
          'baseline,custom:{"sqlRepair":false,"careful":"auto"},fixer-off,baseline',
        ]).arms,
      ).toEqual([
        'baseline',
        'custom:{"sqlRepair":false,"careful":"auto"}',
        'fixer-off',
      ]);
    });

    it('rejects --arm together with --arms, in either order', () => {
      expect(() => parseArgs(['--arm', 'bare', '--arms', 'baseline'])).toThrow(
        /--arm and --arms are mutually exclusive/,
      );
      expect(() => parseArgs(['--arms', 'baseline', '--arm', 'bare'])).toThrow(
        /--arm and --arms are mutually exclusive/,
      );
    });

    it('parses --engine overrides and merges repeated flags, later wins', () => {
      const options = parseArgs([
        '--engine',
        'sqlRepair=false,careful=auto',
        '--engine',
        'careful=on,promptAblation=visuals+ratio,maxSteps=12',
      ]);
      expect(options.engine).toEqual({
        sqlRepair: false,
        careful: 'on',
        promptAblation: ['visuals', 'ratio'],
        maxSteps: 12,
      });
    });

    it('rejects an --engine key or value the engine cannot take', () => {
      expect(() => parseArgs(['--engine', 'sqlRepiar=false'])).toThrow(
        /--engine: Unknown engine option "sqlRepiar"/,
      );
      expect(() => parseArgs(['--engine', 'careful=sometimes'])).toThrow(
        /cannot be "sometimes"/,
      );
      expect(() => parseArgs(['--engine', 'sqlRepair'])).toThrow(
        /not key=value/,
      );
    });

    it('parses --judge-model, --dialect, --include-variants, --stop-on-error', () => {
      const options = parseArgs([
        '--judge-model',
        'openai/gpt-4.1-mini',
        '--dialect',
        'databricks',
        '--include-variants',
        '--stop-on-error',
      ]);
      expect(options.judgeModel).toBe('openai/gpt-4.1-mini');
      expect(options.dialect).toBe('databricks');
      expect(options.includeVariants).toBe(true);
      expect(options.stopOnError).toBe(true);
    });

    it('rejects a judge model that is not a router id and an unknown dialect', () => {
      expect(() => parseArgs(['--judge-model', 'gpt-4.1-mini'])).toThrow(
        /<provider>\/<model> router id/,
      );
      expect(() => parseArgs(['--dialect', 'mysql'])).toThrow(
        /--dialect must be one of auto, postgres, databricks/,
      );
    });

    it('rejects lever flags on --validate, which makes no model call', () => {
      expect(() => parseArgs(['--validate', '--arm', 'bare'])).toThrow(
        /--validate runs reference SQL only.*--arm/,
      );
      expect(() =>
        parseArgs([
          '--validate',
          '--arms',
          'baseline',
          '--engine',
          'sqlRepair=false',
        ]),
      ).toThrow(/--arms, --engine/);
      expect(() =>
        parseArgs(['--judge-model', 'openai/x', '--validate']),
      ).toThrow(/--judge-model/);
      // --dialect is what validate is for.
      expect(parseArgs(['--validate', '--dialect', 'databricks']).dialect).toBe(
        'databricks',
      );
    });

    it('rejects a --repeat that is not a whole number of runs', () => {
      expect(() => parseArgs(['--repeat', '0'])).toThrow(EvalSetupError);
      expect(() => parseArgs(['--repeat', '2.5'])).toThrow(/whole number/);
      expect(() => parseArgs(['--repeat'])).toThrow(/whole number/);
    });

    it('rejects a flag that needs a value but was given none', () => {
      expect(() => parseArgs(['--suite'])).toThrow(/--suite needs/);
      expect(() => parseArgs(['--suites'])).toThrow(/--suites needs/);
      expect(() => parseArgs(['--category'])).toThrow(/--category needs/);
      expect(() => parseArgs(['--label'])).toThrow(/--label needs/);
      expect(() => parseArgs(['--arm'])).toThrow(/--arm needs/);
      expect(() => parseArgs(['--arms'])).toThrow(/--arms needs/);
      expect(() => parseArgs(['--engine'])).toThrow(/--engine needs/);
      expect(() => parseArgs(['--judge-model'])).toThrow(/--judge-model needs/);
      expect(() => parseArgs(['--dialect'])).toThrow(/--dialect needs/);
    });

    it('rejects an unknown argument', () => {
      expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
    });
  });

  describe('splitArmList', () => {
    it('splits on top-level commas only', () => {
      expect(splitArmList('a, b,,c')).toEqual(['a', 'b', 'c']);
      expect(
        splitArmList(
          'custom:{"promptAblation":["visuals","ratio"],"note":"x,y"},bare',
        ),
      ).toEqual([
        'custom:{"promptAblation":["visuals","ratio"],"note":"x,y"}',
        'bare',
      ]);
    });
  });

  describe('engine overrides per arm', () => {
    it('merges --engine over the arm preset', () => {
      expect(
        armEngineOverrides('fixer-off', { descriptiveErrors: false }),
      ).toEqual({
        sqlRepair: false,
        descriptiveErrors: false,
      });
      expect(armEngineOverrides('baseline', undefined)).toEqual({});
      expect(armEngineOverrides(undefined, { careful: 'auto' })).toEqual({
        careful: 'auto',
      });
    });

    it('lets legacy pin every lever regardless of Settings', () => {
      const settings = { answerReview: true, lookupTools: true };
      expect(
        resolveEngineOptions(settings, armEngineOverrides('legacy', undefined)),
      ).toEqual(resolveEngineOptions());
      expect(
        resolveEngineOptions(
          settings,
          armEngineOverrides('baseline', undefined),
        ).answerReview,
      ).toBe(true);
    });

    it('throws on an unknown arm', () => {
      expect(() => armEngineOverrides('nope', undefined)).toThrow(
        /Unknown arm/,
      );
    });
  });

  describe('resolveDialect', () => {
    it('follows the datasource kind on auto; an explicit dialect wins', () => {
      expect(resolveDialect('auto', 'postgres')).toBe('postgres');
      expect(resolveDialect('auto', 'databricks')).toBe('databricks');
      expect(resolveDialect('auto', undefined)).toBeUndefined();
      expect(resolveDialect('databricks', 'postgres')).toBe('databricks');
    });
  });

  describe('modelRouterId', () => {
    it('is <provider>/<model> for every provider, else the env fallback', () => {
      const view = (provider: 'openai' | 'lenai' | 'databricks') => ({
        provider,
        model: 'm-1',
        configured: true,
      });
      expect(modelRouterId(view('openai'))).toBe('openai/m-1');
      expect(modelRouterId(view('lenai'))).toBe('lenai/m-1');
      expect(modelRouterId(view('databricks'))).toBe('databricks/m-1');
      expect(
        modelRouterId({ provider: null, model: null, configured: false }),
      ).toBe('openai/gpt-4o-mini');
    });
  });

  describe('judgeModelMismatch', () => {
    it('passes when the flag is absent or matches the effective judge', () => {
      expect(
        judgeModelMismatch(undefined, 'openai/x', 'openai/y'),
      ).toBeUndefined();
      expect(
        judgeModelMismatch(
          'OpenAI/gpt-4.1-mini',
          'openai/gpt-4.1-mini',
          'openai/gpt-5',
        ),
      ).toBeUndefined();
      // Nothing pinned: the judge runs on the assistant's model.
      expect(
        judgeModelMismatch('openai/gpt-5', undefined, 'openai/gpt-5'),
      ).toBeUndefined();
    });

    it('says how to pin the judge instead of silently ignoring the flag', () => {
      const text = judgeModelMismatch(
        'openai/gpt-4.1-mini',
        undefined,
        'openai/gpt-5',
      );
      expect(text).toMatch(
        /differs from the judge this run would use: openai\/gpt-5/,
      );
      expect(text).toMatch(
        /Settings → Engine levers → Judge model = openai\/gpt-4\.1-mini/,
      );
      expect(text).toMatch(
        /curl -X PUT http:\/\/localhost:\d+\/engine\/settings/,
      );
      expect(text).toContain('{"judgeModel":"openai/gpt-4.1-mini"}');
    });
  });

  describe('loadGoldenSet', () => {
    it('reads the shipped flat array of cases', () => {
      const file = writeJson('flat.json', [
        {
          name: 'top-scoring-team',
          dataset: 'World Cup',
          question: 'Which team scored the most goals?',
          expectedSql: 'SELECT 1',
        },
      ]);
      expect(loadGoldenSet(file)).toEqual([
        {
          name: 'top-scoring-team',
          dataset: 'World Cup',
          question: 'Which team scored the most goals?',
          expectedSql: 'SELECT 1',
        },
      ]);
    });

    it('carries an optional category through', () => {
      const file = writeJson('categorised.json', [
        {
          name: 'denied-claims-2024',
          category: 'value-vocabulary',
          dataset: 'Health Insurance',
          question: 'How many claims were approved in 2024?',
          expectedSql: 'SELECT 1',
        },
      ]);
      expect(loadGoldenSet(file)[0].category).toBe('value-vocabulary');
    });

    it('accepts a suite-shaped file and inherits datasets[0]', () => {
      const file = writeJson('suite.json', {
        id: 'health-insurance',
        name: 'Health insurance',
        datasets: ['Health Insurance'],
        requiredEntities: ['health_insurance.claims'],
        cases: [
          {
            id: 'paid-share-by-specialty',
            category: 'ratio-trap',
            question: 'Which specialties are paid the highest share?',
            intent: 'ratio over two different measures',
            expectedSql: 'SELECT 2',
          },
          {
            id: 'denial-discovery',
            category: 'discovery',
            question: 'What data do we have about denials?',
            intent: 'schema question, no SQL',
          },
        ],
      });
      const source = readCaseFile(file);
      expect(source.suite).toBe('health-insurance');
      expect(source.cases).toEqual([
        {
          name: 'paid-share-by-specialty',
          category: 'ratio-trap',
          dataset: 'Health Insurance',
          question: 'Which specialties are paid the highest share?',
          expectedSql: 'SELECT 2',
        },
        {
          name: 'denial-discovery',
          category: 'discovery',
          dataset: 'Health Insurance',
          question: 'What data do we have about denials?',
        },
      ]);
    });

    it('carries expectedSqlAlternatives from a suite-shaped file', () => {
      const file = writeJson('alternatives.json', {
        id: 'health-insurance',
        datasets: ['Health Insurance'],
        cases: [
          {
            id: 'paid-by-country',
            question: 'What have we paid out in each country?',
            expectedSql: 'SELECT cents',
            expectedSqlAlternatives: ['SELECT dollars'],
          },
        ],
      });
      const [testCase] = loadGoldenSet(file);
      expect(testCase.expectedSqlAlternatives).toEqual(['SELECT dollars']);
      expect(goldenToSuiteEvalCase(testCase).expectedSqlAlternatives).toEqual([
        'SELECT dollars',
      ]);
    });

    it.each([
      [
        { expectedSql: 'SELECT 1', expectedSqlAlternatives: [] },
        /not a non-empty array/,
      ],
      [
        { expectedSql: 'SELECT 1', expectedSqlAlternatives: [''] },
        /not a non-empty array/,
      ],
      [{ expectedSqlAlternatives: ['SELECT 2'] }, /no "expectedSql"/],
    ])('rejects malformed alternatives: %p', (fields, expected) => {
      const file = writeJson('bad-alternatives.json', {
        id: 'bad',
        datasets: ['Health Insurance'],
        cases: [{ id: 'a', question: 'q', ...fields }],
      });
      expect(() => loadGoldenSet(file)).toThrow(expected);
    });

    it('carries expectedReasoning through, validated like a registered suite', () => {
      const file = writeJson('reasoning.json', {
        id: 'hr',
        datasets: ['HR'],
        cases: [
          {
            id: 'avg-salary-tech-2025',
            question: 'What is the average salary of tech employees in 2025?',
            expectedSql: 'SELECT 1',
            expectedReasoning: {
              tables: ['hr.v_salary_by_year'],
              metric: 'avg_base_salary_usd',
            },
          },
        ],
      });
      expect(loadGoldenSet(file)[0].expectedReasoning).toEqual({
        tables: ['hr.v_salary_by_year'],
        metric: 'avg_base_salary_usd',
      });

      const broken = writeJson('reasoning-broken.json', {
        id: 'hr',
        datasets: ['HR'],
        cases: [
          {
            id: 'bad',
            question: 'q',
            expectedSql: 'SELECT 1',
            expectedReasoning: { tables: ['employees'] },
          },
        ],
      });
      expect(() => loadGoldenSet(broken)).toThrow(EvalSetupError);
      expect(() => loadGoldenSet(broken)).toThrow(
        /case "bad"\.expectedReasoning\.tables\[0\] "employees" must be schema\.table/,
      );
    });

    it("lets a suite case override the suite's dataset", () => {
      const file = writeJson('override.json', {
        id: 'mixed',
        datasets: ['Health Insurance'],
        cases: [
          {
            id: 'elsewhere',
            question: 'q',
            dataset: 'Genomics',
            expectedSql: 'SELECT 3',
          },
        ],
      });
      expect(loadGoldenSet(file)[0].dataset).toBe('Genomics');
    });

    it('falls back to the filename when a suite-shaped file has no id', () => {
      const file = writeJson('unnamed-set.json', {
        datasets: ['Health Insurance'],
        cases: [{ id: 'a', question: 'q', expectedSql: 'SELECT 1' }],
      });
      expect(readCaseFile(file).suite).toBe('unnamed-set');
    });

    it('requires expectedSql in a flat file — a missing one is a typo', () => {
      const file = writeJson('missing-sql.json', [
        { name: 'a', dataset: 'World Cup', question: 'q' },
      ]);
      expect(() => loadGoldenSet(file)).toThrow(/"expectedSql"/);
    });

    it('reports a suite case that has no dataset to inherit', () => {
      const file = writeJson('no-datasets.json', {
        id: 'orphan',
        cases: [{ id: 'a', question: 'q', expectedSql: 'SELECT 1' }],
      });
      expect(() => loadGoldenSet(file)).toThrow(/"dataset"/);
    });

    it('rejects an empty set, a non-set and invalid JSON', () => {
      expect(() => loadGoldenSet(writeJson('empty.json', []))).toThrow(
        /no cases/,
      );
      expect(() => loadGoldenSet(writeJson('object.json', { a: 1 }))).toThrow(
        /array of cases/,
      );
      const broken = join(dir, 'broken.json');
      writeFileSync(broken, '{not json', 'utf8');
      expect(() => loadGoldenSet(broken)).toThrow(/not valid JSON/);
      expect(() => loadGoldenSet(join(dir, 'nope.json'))).toThrow(
        /not found at/,
      );
    });
  });

  describe('goldenToSuiteEvalCase', () => {
    it('grades a golden-set case by its reference SQL alone', () => {
      expect(
        goldenToSuiteEvalCase({
          name: 'top-scoring-team',
          category: 'ties',
          dataset: 'World Cup',
          question: 'Which team scored the most goals?',
          expectedSql: 'SELECT 1',
          notes: 'not carried',
        }),
      ).toEqual({
        id: 'top-scoring-team',
        category: 'ties',
        question: 'Which team scored the most goals?',
        intent: '',
        checks: [],
        expectedSql: 'SELECT 1',
      });
    });

    it('omits a category the case does not have', () => {
      expect(
        goldenToSuiteEvalCase({
          name: 'a',
          dataset: 'D',
          question: 'q',
          expectedSql: 'SELECT 1',
        }),
      ).not.toHaveProperty('category');
    });
  });

  describe('selectCases', () => {
    const source = {
      suite: 'demo',
      origin: 'demo',
      cases: [
        {
          name: 'a-ratio',
          category: 'ratio-trap',
          dataset: 'D',
          question: 'q',
        },
        { name: 'b-ties', category: 'ties', dataset: 'D', question: 'q' },
        { name: 'c-plain', dataset: 'D', question: 'q' },
      ],
    };
    const base = parseArgs([]);

    it('filters by case name and by category substring', () => {
      expect(
        selectCases(source, { ...base, only: 'ties' }).map((c) => c.name),
      ).toEqual(['b-ties']);
      expect(
        selectCases(source, { ...base, category: 'ratio' }).map((c) => c.name),
      ).toEqual(['a-ratio']);
    });

    it('lists the categories present when none matches', () => {
      expect(() => selectCases(source, { ...base, category: 'nope' })).toThrow(
        /Categories present: ratio-trap, ties/,
      );
    });
  });

  describe('partitionCases', () => {
    const suiteCase = (id: string): SuiteEvalCase => ({
      id,
      question: 'q',
      intent: 'i',
      checks: [],
    });
    const cases: GoldenCase[] = [
      {
        name: 'file-with-sql',
        dataset: 'D',
        question: 'q',
        expectedSql: 'SELECT 1',
      },
      { name: 'file-without-sql', dataset: 'D', question: 'q' },
      {
        name: 'suite-judged',
        dataset: 'D',
        question: 'q',
        evalCase: suiteCase('suite-judged'),
      },
      {
        name: 'placeholder',
        dataset: 'D',
        question: 'q',
        expectedSql: 'SELECT 1',
        placeholder: true,
      },
    ];
    const names = (list: { name: string }[]) => list.map((c) => c.name);

    it('grades a suite case without reference SQL by its checks; skips a file case with nothing to compare', () => {
      const { runnable, skipped } = partitionCases(
        cases,
        { includePlaceholders: false },
        'graded',
      );
      expect(names(runnable)).toEqual(['file-with-sql', 'suite-judged']);
      expect(skipped.map((s) => [s.testCase.name, s.reason])).toEqual([
        ['file-without-sql', 'no-expected-sql'],
        ['placeholder', 'placeholder'],
      ]);
    });

    it('validates only cases that carry a reference', () => {
      const { runnable, skipped } = partitionCases(
        cases,
        { includePlaceholders: true },
        'validate',
      );
      expect(names(runnable)).toEqual(['file-with-sql', 'placeholder']);
      expect(skipped.map((s) => s.testCase.name)).toEqual([
        'file-without-sql',
        'suite-judged',
      ]);
    });

    it('counts a dialect-only reference as a reference', () => {
      const only: GoldenCase = {
        name: 'dbx',
        dataset: 'D',
        question: 'q',
        evalCase: {
          ...suiteCase('dbx'),
          expectedSqlByDialect: { databricks: 'SELECT 1' },
        },
      };
      expect(
        names(
          partitionCases([only], { includePlaceholders: false }, 'validate')
            .runnable,
        ),
      ).toEqual(['dbx']);
    });
  });

  describe('per-category pass^k', () => {
    const results = [
      { name: 'a', category: 'ratio-trap', verdict: 'PASS' as const },
      { name: 'b', category: 'ratio-trap', verdict: 'FAIL' as const },
      { name: 'c', category: 'ties', verdict: 'PASS' as const },
      { name: 'd', category: 'control', verdict: 'FAIL' as const },
      { name: 'e', category: 'control', verdict: 'ERROR' as const },
      { name: 'f', verdict: 'PASS' as const },
      { name: 'g', category: 'ties', verdict: 'SKIP' as const },
    ];

    it('counts passes per category and ignores skipped cases', () => {
      expect(tallyCategories(results)).toEqual({
        'ratio-trap': { total: 2, passed: 1 },
        ties: { total: 1, passed: 1 },
        control: { total: 2, passed: 0 },
        uncategorised: { total: 1, passed: 1 },
      });
    });

    it('prints the worst pass^k rate first, so the eye lands on it', () => {
      const cases: EvalRunLogCaseV2[] = results.map((result) =>
        buildLogCase(
          {
            id: result.name,
            ...(result.category ? { category: result.category } : {}),
          },
          result.verdict === 'SKIP' ? [] : [attempt(1, result.verdict)],
        ),
      );
      const lines: string[] = [];
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        });
      try {
        summarizeCategories(summarizeCases(cases).byCategory, 3);
      } finally {
        log.mockRestore();
      }
      const order = lines
        .map((line) => line.trim().split(/\s{2,}/)[0])
        .filter((name) =>
          ['control', 'ratio-trap', 'ties', 'uncategorised'].includes(name),
        );
      expect(order).toEqual(['control', 'ratio-trap', 'ties', 'uncategorised']);
      expect(lines.some((line) => /PASS\^3\/TOTAL/.test(line))).toBe(true);
      expect(lines.some((line) => /control\s+0\/2\s+0%\s+0%/.test(line))).toBe(
        true,
      );
      expect(
        lines.some((line) => /ratio-trap\s+1\/2\s+50%\s+50%/.test(line)),
      ).toBe(true);
    });
  });

  describe('decideValidateStatus', () => {
    const rows = (n: number, value = 1) =>
      Array.from({ length: n }, (_, i) => ({
        team: `t${i}`,
        goals: value + i,
      }));

    it('OK with a row count; ERROR when the reference fails', () => {
      expect(
        decideValidateStatus({ reference: { rows: rows(3) }, rowLimit: 500 }),
      ).toEqual({
        status: 'OK',
        verdict: 'PASS',
        reason: '',
        detail: '3 rows',
      });
      expect(
        decideValidateStatus({
          reference: { error: 'relation "x" does not exist' },
          rowLimit: 500,
        }),
      ).toMatchObject({
        status: 'ERROR',
        verdict: 'ERROR',
        detail: 'relation "x" does not exist',
      });
    });

    it('an empty reference is a WARN that passes the exit code', () => {
      expect(
        decideValidateStatus({ reference: { rows: [] }, rowLimit: 500 }),
      ).toMatchObject({
        status: 'WARN',
        verdict: 'PASS',
        reason: 'empty',
      });
    });

    it('TOO-MANY at the row cap fails', () => {
      expect(
        decideValidateStatus({ reference: { rows: rows(5) }, rowLimit: 5 }),
      ).toMatchObject({
        status: 'TOO-MANY',
        verdict: 'FAIL',
      });
    });

    it('a trap whose result equals the reference is TRAP-VACUOUS, whatever its column names', () => {
      const decision = decideValidateStatus({
        reference: { rows: [{ specialty: 'Cardiology', share: 0.5 }] },
        trap: { rows: [{ share_wrong: 0.5, name: 'cardiology ' }] },
        rowLimit: 500,
      });
      expect(decision.status).toBe('TRAP-VACUOUS');
      expect(decision.verdict).toBe('FAIL');
      expect(decision.detail).toMatch(
        /tempting wrong query returns the right answer/,
      );
    });

    it('a trap that errors is TRAP-ERROR, a failure', () => {
      const decision = decideValidateStatus({
        reference: { rows: rows(2) },
        trap: { error: 'syntax error' },
        rowLimit: 500,
      });
      expect(decision).toMatchObject({ status: 'TRAP-ERROR', verdict: 'FAIL' });
      expect(decision.detail).toMatch(/syntax error/);
    });

    it('a trap that differs keeps the case OK, and a narrower trap is not vacuous', () => {
      expect(
        decideValidateStatus({
          reference: { rows: rows(2) },
          trap: { rows: rows(2, 7) },
          rowLimit: 500,
        }),
      ).toMatchObject({
        status: 'OK',
        detail: '2 rows; trap differs (2 rows)',
      });
      expect(
        decideValidateStatus({
          reference: { rows: [{ team: 'France', goals: 14 }] },
          trap: { rows: [{ team: 'France' }] },
          rowLimit: 500,
        }).status,
      ).toBe('OK');
    });

    it('checks the reference before the trap, and an empty reference with an empty trap is vacuous', () => {
      expect(
        decideValidateStatus({
          reference: { error: 'boom' },
          trap: { rows: [] },
          rowLimit: 500,
        }).status,
      ).toBe('ERROR');
      expect(
        decideValidateStatus({
          reference: { rows: [] },
          trap: { rows: [] },
          rowLimit: 500,
        }).status,
      ).toBe('TRAP-VACUOUS');
      const warned = decideValidateStatus({
        reference: { rows: [] },
        trap: { rows: rows(1) },
        rowLimit: 500,
      });
      expect(warned.status).toBe('WARN');
      expect(warned.detail).toMatch(/trap differs \(1 row\)/);
    });

    describe('expectedSqlAlternatives', () => {
      const cents = [{ country: 'United States', paid_cents: '58862147' }];
      const dollars = [
        { country: 'United States', paid_dollars: '588621.470000000000' },
      ];
      const trap = [{ state: 'Texas', paid_cents: '21616213' }];

      it('reports every alternative in an OK detail', () => {
        expect(
          decideValidateStatus({
            reference: { rows: cents },
            alternatives: [{ rows: dollars }, { rows: rows(3) }],
            trap: { rows: trap },
            rowLimit: 500,
          }),
        ).toEqual({
          status: 'OK',
          verdict: 'PASS',
          reason: '',
          detail: '1 row; 2 alternatives (1 row, 3 rows); trap differs (1 row)',
        });
      });

      it('holds each alternative to the ERROR, TOO-MANY and WARN rules, naming it', () => {
        expect(
          decideValidateStatus({
            reference: { rows: cents },
            alternatives: [{ rows: dollars }, { error: 'division by zero' }],
            rowLimit: 500,
          }),
        ).toEqual({
          status: 'ERROR',
          verdict: 'ERROR',
          reason: 'sql-error',
          detail: 'expectedSqlAlternatives[1]: division by zero',
          alternativeIndex: 1,
        });
        const capped = decideValidateStatus({
          reference: { rows: cents },
          alternatives: [{ rows: rows(5) }],
          rowLimit: 5,
        });
        expect(capped).toMatchObject({
          status: 'TOO-MANY',
          verdict: 'FAIL',
          alternativeIndex: 0,
        });
        expect(capped.detail).toMatch(/^expectedSqlAlternatives\[0\]: 5 rows/);
        const empty = decideValidateStatus({
          reference: { rows: cents },
          alternatives: [{ rows: [] }],
          rowLimit: 500,
        });
        expect(empty).toMatchObject({
          status: 'WARN',
          verdict: 'PASS',
          alternativeIndex: 0,
        });
        expect(empty.detail).toMatch(
          /^expectedSqlAlternatives\[0\] returns no rows/,
        );
      });

      it('reports a broken primary before any alternative', () => {
        const decision = decideValidateStatus({
          reference: { error: 'boom' },
          alternatives: [{ error: 'bang' }],
          rowLimit: 500,
        });
        expect(decision).toMatchObject({ status: 'ERROR', detail: 'boom' });
        expect(decision).not.toHaveProperty('alternativeIndex');
      });

      it('a trap must differ from every reference, not just the primary', () => {
        const decision = decideValidateStatus({
          reference: { rows: cents },
          alternatives: [{ rows: dollars }],
          trap: { rows: [{ country: 'United States', paid: 588621.47 }] },
          rowLimit: 500,
        });
        expect(decision).toMatchObject({
          status: 'TRAP-VACUOUS',
          verdict: 'FAIL',
          alternativeIndex: 0,
        });
        expect(decision.detail).toMatch(
          /returns the answer of expectedSqlAlternatives\[0\]/,
        );
      });

      it("judges the trap with the grader's rounding tolerance", () => {
        // A trap equal to the reference within rounding would be accepted
        // by the grader, so it tests nothing either.
        expect(
          decideValidateStatus({
            reference: { rows: [{ share: '0.4847' }] },
            trap: { rows: [{ share: 0.48466 }] },
            rowLimit: 500,
          }).status,
        ).toBe('TRAP-VACUOUS');
      });
    });
  });

  describe('validate summary and log', () => {
    const row = (
      name: string,
      status: ValidateRow['status'],
      verdict: EvalVerdict,
      extra: Partial<ValidateRow> = {},
    ): ValidateRow => ({
      name,
      question: `q ${name}`,
      status,
      verdict,
      reason: '',
      detail: `${status} detail`,
      durationMs: 5,
      ...extra,
    });
    const rows: ValidateRow[] = [
      row('ok', 'OK', 'PASS', {
        category: 'control',
        referenceSql: 'SELECT 1',
        referenceRows: 3,
        trapSql: 'SELECT 2',
        trapRows: 4,
      }),
      row('empty', 'WARN', 'PASS', {
        referenceSql: 'SELECT 0',
        referenceRows: 0,
      }),
      row('many', 'TOO-MANY', 'FAIL', {
        referenceSql: 'SELECT *',
        referenceRows: 500,
      }),
      row('err', 'ERROR', 'ERROR', {
        referenceSql: 'SELECT x',
        referenceError: 'boom',
      }),
      row('vacuous', 'TRAP-VACUOUS', 'FAIL', {
        referenceSql: 'SELECT 1',
        referenceRows: 1,
        trapSql: 'SELECT 1',
        trapRows: 1,
      }),
      row('trap-err', 'TRAP-ERROR', 'FAIL', {
        referenceSql: 'SELECT 1',
        referenceRows: 1,
        trapSql: 'SELECT nope',
        trapError: 'bad',
      }),
      row('skipped', 'SKIP', 'SKIP', { reason: 'no-expected-sql' }),
    ];

    it('counts every status, trap errors with the errors', () => {
      expect(validateSummaryLine(rows)).toBe(
        '7 references — 1 ok, 1 warn(empty), 1 too many rows, 2 errored, 1 trap-vacuous, 1 skipped',
      );
    });

    it('counts alternatives beside the references', () => {
      expect(
        validateSummaryLine([
          row('a', 'OK', 'PASS', { alternatives: [{ sql: 'SELECT 2' }] }),
          row('b', 'OK', 'PASS'),
        ]),
      ).toBe(
        '2 references (+1 alternative) — 2 ok, 0 warn(empty), 0 too many rows, 0 errored, 0 trap-vacuous, 0 skipped',
      );
    });

    it('logs each alternative as a check and a statement, and blames the one that broke', () => {
      const record = buildValidateRecord({
        runId: 'aaaaaaaa-0000-0000-0000-000000000001',
        suite: 'health-insurance',
        datasets: ['Health Insurance'],
        startedAt: new Date('2026-09-23T10:00:00Z'),
        finishedAt: new Date('2026-09-23T10:00:01Z'),
        rows: [
          row('dollars', 'OK', 'PASS', {
            referenceSql: 'SELECT cents',
            referenceRows: 2,
            alternatives: [{ sql: 'SELECT dollars', rows: 2 }],
            trapSql: 'SELECT trap',
            trapRows: 6,
          }),
          row('broken-alt', 'ERROR', 'ERROR', {
            referenceSql: 'SELECT cents',
            referenceRows: 2,
            alternatives: [{ sql: 'SELECT nope', error: 'syntax error' }],
            alternativeIndex: 0,
            trapSql: 'SELECT trap',
          }),
        ],
        environment: FIXED_ENV,
      });
      const byId = Object.fromEntries(
        record.cases.map((item) => [item.id, item]),
      );
      expect(byId.dollars.attempts[0].checks).toEqual([
        { id: 'reference-sql', passed: true },
        { id: 'alternative-sql', passed: true },
        { id: 'trap-sql', passed: true },
      ]);
      expect(byId.dollars.attempts[0].sql).toEqual([
        { sql: 'SELECT cents', ok: true, rowCount: 2 },
        { sql: 'SELECT dollars', ok: true, rowCount: 2 },
        { sql: 'SELECT trap', ok: true, rowCount: 6 },
      ]);
      expect(byId['broken-alt'].attempts[0].checks).toEqual([
        { id: 'reference-sql', passed: true },
        { id: 'alternative-sql', passed: false, reason: 'ERROR detail' },
      ]);
      expect(byId['broken-alt'].attempts[0].sql).toEqual([
        { sql: 'SELECT cents', ok: true, rowCount: 2 },
        { sql: 'SELECT nope', ok: false, error: 'syntax error' },
      ]);
    });

    it('writes a v2 validate record: no usage, one attempt per case, SQL without rows', () => {
      const record = buildValidateRecord({
        runId: 'aaaaaaaa-0000-0000-0000-000000000000',
        suite: 'health-insurance',
        datasets: ['Health Insurance'],
        datasourceKind: 'postgres',
        dialect: 'postgres',
        startedAt: new Date('2026-09-23T10:00:00Z'),
        finishedAt: new Date('2026-09-23T10:00:02Z'),
        rows,
        environment: FIXED_ENV,
      });
      expect(record).toMatchObject({
        schemaVersion: 2,
        harness: 'validate',
        suite: 'health-insurance',
        repeat: 1,
        configHash: 'validate',
        engine: resolveEngineOptions(),
        status: 'completed',
        datasourceKind: 'postgres',
        dialect: 'postgres',
        durationMs: 2000,
        totals: {
          cases: 7,
          passed: 2,
          failed: 3,
          errored: 1,
          gaps: 0,
          skipped: 1,
        },
      });
      expect(record.usage.calls).toBe(0);
      expect(record.estimatedCostUsd).toBeUndefined();
      expect(record.costIncomplete).toBeUndefined();

      const byId = Object.fromEntries(
        record.cases.map((item) => [item.id, item]),
      );
      expect(byId.ok.attempts[0].checks.map((check) => check.id)).toEqual([
        'reference-sql',
        'trap-sql',
      ]);
      expect(byId.ok.attempts[0].sql).toEqual([
        { sql: 'SELECT 1', ok: true, rowCount: 3 },
        { sql: 'SELECT 2', ok: true, rowCount: 4 },
      ]);
      expect(byId.empty.attempts[0].warnings).toEqual(['WARN detail']);
      expect(byId.vacuous.verdict).toBe('FAIL');
      expect(byId.vacuous.reason).toBe('trap-sql');
      expect(byId['trap-err'].attempts[0].sql[1]).toEqual({
        sql: 'SELECT nope',
        ok: false,
        error: 'bad',
      });
      expect(byId.err.attempts[0].checks).toEqual([
        { id: 'reference-sql', passed: false, reason: 'ERROR detail' },
      ]);
      expect(byId.skipped).toMatchObject({
        verdict: 'SKIP',
        runs: 0,
        reason: 'no-expected-sql',
      });
      expect(JSON.stringify(record)).not.toMatch(/"rows"/);
    });
  });

  describe('buildCliRunRecord', () => {
    it('writes a v2 record from the harness outcomes', () => {
      const skipped = {
        ...buildLogCase({ id: 'd-placeholder' }, []),
        reason: 'placeholder',
      };
      const record = buildCliRunRecord(
        recordInput({
          outcomes: sampleOutcomes(),
          skipped: [skipped],
          notReached: 1,
          status: 'aborted',
          error: 'interrupted (SIGINT)',
          pricing: {
            'gpt-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 10 },
          },
        }),
      );
      expect(record).toMatchObject({
        schemaVersion: 2,
        runId: '11111111-2222-3333-4444-555555555555',
        label: 'iter0',
        harness: 'golden-set',
        suite: 'health-insurance',
        datasets: ['Health Insurance'],
        datasourceKind: 'postgres',
        dialect: 'postgres',
        model: 'openai/gpt-5',
        reasoningEffort: 'high',
        judgeModel: 'openai/gpt-4.1-mini',
        repeat: 2,
        arm: 'fixer-off',
        configHash: 'abc123def456',
        loopId: 'loop-1234-5678',
        startedAt: '2026-09-23T10:00:00.000Z',
        finishedAt: '2026-09-23T10:05:00.000Z',
        durationMs: 300_000,
        appVersion: '0.0.0-test',
        gitCommit: 'abc1234',
        status: 'aborted',
        error: 'interrupted (SIGINT)',
        totals: {
          cases: 5,
          passed: 1,
          failed: 1,
          errored: 0,
          gaps: 1,
          skipped: 2,
        },
      });
      // The engine the turns reported, not the fallback.
      expect(record.engine).toEqual(
        resolveEngineOptions({}, { sqlRepair: false, descriptiveErrors: true }),
      );
      expect(
        record.cases.map((item) => [
          item.id,
          item.verdict,
          `${item.passes}/${item.runs}`,
        ]),
      ).toEqual([
        ['a-ratio', 'FAIL', '1/2'],
        ['b-control', 'PASS', '2/2'],
        // GAP attempts are no evidence, so they do not count as runs.
        ['c-gap', 'GAP', '0/0'],
        ['d-placeholder', 'SKIP', '0/0'],
      ]);
      expect(record.summary).toMatchObject({
        passK: 1,
        scored: 2,
        passKRate: 0.5,
        meanPassRate: 0.75,
        flaky: 1,
        gaps: 1,
        answeredEveryTime: 3,
        answeredObserved: 3,
      });
      expect(record.usage).toMatchObject({ calls: 6, totalTokens: 720 });
      expect(record.estimatedCostUsd).toBeGreaterThan(0);
      expect(record.summary.costPerCorrectUsd).toBe(record.estimatedCostUsd);
      expect(record.sidePassUsage).toEqual({
        grounding: {
          ...usage(30),
          inputTokens: 10 + 20,
          outputTokens: 40,
          totalTokens: 70,
          calls: 2,
        },
        review: usage(50),
      });
      expect(record.cases[0].attempts).toHaveLength(2);
    });

    it('falls back to the resolved arm engine when no case reached a turn', () => {
      const record = buildCliRunRecord(
        recordInput({ status: 'failed', error: 'boom', notReached: 3 }),
      );
      expect(record.engine).toEqual(
        resolveEngineOptions({}, { sqlRepair: false }),
      );
      expect(record.configHash).toBe('fallbackhash');
      expect(record.judgeModel).toBeUndefined();
      expect(record.sidePassUsage).toBeUndefined();
      expect(record.totals).toEqual({
        cases: 3,
        passed: 0,
        failed: 0,
        errored: 0,
        gaps: 0,
        skipped: 3,
      });
      expect(record.status).toBe('failed');
      expect(record.error).toBe('boom');
    });

    it('uses the pinned judge when no outcome ran one', () => {
      const [, control] = sampleOutcomes();
      expect(
        buildCliRunRecord(
          recordInput({ outcomes: [control], judgeModel: 'openai/pinned' }),
        ).judgeModel,
      ).toBe('openai/pinned');
    });
  });

  describe('mergeSidePassUsage', () => {
    it('sums per pass and is undefined when nothing was measured', () => {
      expect(mergeSidePassUsage([undefined, {}])).toBeUndefined();
      expect(
        mergeSidePassUsage([
          { fixer: usage(100) },
          { fixer: usage(50), synthesis: usage(25) },
        ]),
      ).toEqual({
        fixer: {
          ...usage(100),
          inputTokens: 80 + 30,
          outputTokens: 40,
          totalTokens: 150,
          calls: 2,
        },
        synthesis: usage(25),
      });
    });
  });

  describe('formatHeadline', () => {
    it('reads pass^k, mean, flaky, gaps, answered and $/correct in one line', () => {
      const record = buildCliRunRecord(
        recordInput({
          outcomes: sampleOutcomes(),
          pricing: {
            'gpt-5': { inputPerMillionUsd: 1000, outputPerMillionUsd: 1000 },
          },
        }),
      );
      expect(formatHeadline(record)).toBe(
        'pass^2 1/2 (50%) · mean 75% · 1 flaky · 1 gap · answered 3/3 · $0.72/correct',
      );
    });

    it('says "not priced" for an unpriced model and "tokens not reported" when nothing was observed', () => {
      expect(
        formatHeadline(
          buildCliRunRecord(recordInput({ outcomes: sampleOutcomes() })),
        ),
      ).toMatch(/ · not priced$/);
      const unobserved = buildCliRunRecord(
        recordInput({
          outcomes: [
            {
              logCase: buildLogCase({ id: 'x' }, [
                attempt(1, 'PASS', { usage: undefined }),
              ]),
            },
          ],
        }),
      );
      expect(formatHeadline(unobserved)).toBe(
        'pass^2 1/1 (100%) · mean 100% · 0 flaky · 0 gaps · answered 1/1 · tokens not reported',
      );
    });
  });

  describe('attemptDetail', () => {
    it('explains an attempt in one line', () => {
      expect(
        attemptDetail(attempt(1, 'ERROR', { error: 'timeout after 300s' })),
      ).toBe('timeout after 300s');
      expect(attemptDetail(attempt(1, 'GAP'))).toBe(
        'result-set-match: reference failed',
      );
      expect(attemptDetail(attempt(1, 'FAIL'))).toBe(
        'result-set-match: the figures differ',
      );
      expect(
        attemptDetail(attempt(1, 'PASS', { viaSupportingQuery: true })),
      ).toBe('1 check passed (result matched an earlier query)');
      expect(attemptDetail(undefined)).toBe('');
    });
  });

  describe('runsText', () => {
    it('shows passes/runs, plus the attempts the harness could not measure', () => {
      const [ratio, control, gap] = sampleOutcomes();
      expect(runsText(ratio.logCase)).toBe('1/2');
      expect(runsText(control.logCase)).toBe('2/2');
      expect(runsText(gap.logCase)).toBe('0/0 +2 gap');
      expect(
        runsText(
          buildLogCase({ id: 'x' }, [attempt(1, 'PASS'), attempt(2, 'GAP')]),
        ),
      ).toBe('1/1 +1 gap');
    });
  });

  describe('loop matrix', () => {
    it('summarises each cell and renders the suite × arm table', () => {
      const baseline = buildCliRunRecord(
        recordInput({ arm: 'baseline', outcomes: sampleOutcomes() }),
      );
      const fixerOff = buildCliRunRecord(
        recordInput({
          arm: 'fixer-off',
          outcomes: sampleOutcomes().slice(1, 2),
          pricing: {
            'gpt-5': { inputPerMillionUsd: 1000, outputPerMillionUsd: 1000 },
          },
        }),
      );
      const cells = [
        loopCell(
          baseline,
          '/repo/logs/evals/2026-09-23-health-insurance-iter0-baseline-11111111.json',
        ),
        loopCell(fixerOff),
      ];
      expect(cells[0]).toMatchObject({
        suite: 'health-insurance',
        arm: 'baseline',
        model: 'openai/gpt-5',
        status: 'completed',
        passK: 1,
        scored: 2,
        flaky: 1,
        gaps: 1,
        tokens: 720,
        configHash: 'abc123def456',
        file: '2026-09-23-health-insurance-iter0-baseline-11111111.json',
      });
      expect(cells[0].costPerCorrectUsd).toBeUndefined();
      const { header, rows } = loopMatrixTable(cells, 2);
      expect(header).toEqual([
        'SUITE',
        'ARM',
        'PASS^2',
        'MEAN',
        'FLAKY',
        'GAPS',
        'TOKENS',
        '$/CORRECT',
        'STATUS',
        'LOG',
      ]);
      expect(rows[0]).toEqual([
        'health-insurance',
        'baseline',
        '1/2 (50%)',
        '75%',
        '1',
        '1',
        '720',
        'not priced',
        'completed',
        '2026-09-23-health-insurance-iter0-baseline-11111111.json',
      ]);
      expect(rows[1].slice(0, 8)).toEqual([
        'health-insurance',
        'fixer-off',
        '1/1 (100%)',
        '100%',
        '0',
        '0',
        '240',
        '$0.24',
      ]);
      expect(rows[1][9]).toBe('-');
    });

    it('names the loop file by date and loop id prefix', () => {
      expect(
        loopFilename(
          '0123abcd-ffff-4444-8888-000000000000',
          new Date('2026-09-23T23:00:00Z'),
        ),
      ).toBe('2026-09-23-0123abcd.json');
    });
  });

  it("keeps today's engine as the fallback for an empty arm", () => {
    expect(
      resolveEngineOptions(undefined, armEngineOverrides(undefined, undefined)),
    ).toEqual({ ...ENGINE_DEFAULTS, promptAblation: [] });
  });
});

describe('eval-diff CLI', () => {
  describe('parseDiffArgs', () => {
    it('takes two run logs and the output flags', () => {
      expect(parseDiffArgs(['a.json', 'b.json'])).toEqual({
        a: 'a.json',
        b: 'b.json',
        markdown: false,
      });
      expect(
        parseDiffArgs([
          'a.json',
          '--markdown',
          'b.json',
          '--draft',
          'fixer-off|fixer off|rewrote filters',
        ]),
      ).toEqual({
        a: 'a.json',
        b: 'b.json',
        markdown: true,
        draft: {
          lever: 'fixer-off',
          change: 'fixer off',
          why: 'rewrote filters',
        },
      });
    });

    it('rejects the wrong number of files, an unknown flag and an empty draft', () => {
      expect(() => parseDiffArgs(['a.json'])).toThrow(/exactly two run logs/);
      expect(() => parseDiffArgs(['a.json', 'b.json', 'c.json'])).toThrow(
        DiffInputError,
      );
      expect(() => parseDiffArgs(['a.json', 'b.json', '--nope'])).toThrow(
        /Unknown argument/,
      );
      expect(() => parseDiffArgs(['a.json', 'b.json', '--draft'])).toThrow(
        /--draft needs/,
      );
    });

    it("fills a draft's missing change and why with placeholders, keeping | in why", () => {
      expect(parseDraft('context')).toEqual({
        lever: 'context',
        change: '<what was edited>',
        why: '<the failure the report showed, and why this lever>',
      });
      expect(parseDraft('a|b|c|d').why).toBe('c|d');
      expect(() => parseDraft('|change')).toThrow(/needs a lever/);
    });
  });

  describe('loadRunLog', () => {
    let logs: string;
    const v1 = {
      schemaVersion: 1,
      runId: '9a8d7567-0000-0000-0000-000000000000',
      harness: 'in-app',
      suite: 'health-insurance',
      datasets: ['Health Insurance'],
      model: 'openai/gpt-4o-mini',
      startedAt: '2026-09-22T21:47:12.315Z',
      finishedAt: '2026-09-22T21:49:58.579Z',
      durationMs: 166264,
      totals: { cases: 2, passed: 1, failed: 1, errored: 0, skipped: 0 },
      categories: {},
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        calls: 0,
      },
      cases: [
        { id: 'a', category: 'control', verdict: 'PASS', durationMs: 1 },
        { id: 'b', category: 'ties', verdict: 'FAIL', durationMs: 1 },
      ],
    };

    beforeAll(() => {
      logs = mkdtempSync(join(tmpdir(), 'eval-diff-spec-'));
      mkdirSync(join(logs, 'evals'), { recursive: true });
      writeFileSync(join(logs, 'evals', 'v1.json'), JSON.stringify(v1), 'utf8');
      writeFileSync(join(logs, 'not-a-log.json'), '{"a":1}', 'utf8');
    });

    afterAll(() => rmSync(logs, { recursive: true, force: true }));

    it('finds a bare filename in the candidate log dirs and normalises v1 to v2', () => {
      const { record, name } = loadRunLog('v1.json', [logs]);
      expect(name).toBe('v1.json');
      expect(record.schemaVersion).toBe(2);
      expect(record.configHash).toBe('legacy');
      expect(record.summary.passK).toBe(1);
    });

    it('reads a path, and refuses what is not a run log or does not exist', () => {
      expect(loadRunLog(join(logs, 'evals', 'v1.json'), []).record.runId).toBe(
        v1.runId,
      );
      expect(() => loadRunLog(join(logs, 'not-a-log.json'), [])).toThrow(
        /not a readable eval run log/,
      );
      expect(() => loadRunLog('missing.json', [logs])).toThrow(
        /Could not find run log "missing.json"/,
      );
    });
  });

  describe('formatDiffConsole', () => {
    it('prints the headline, category deltas, flips and a like-for-like warning', () => {
      const [ratio, control, gap] = sampleOutcomes();
      const before = buildCliRunRecord(
        recordInput({
          runId: 'before00-0000',
          arm: 'baseline',
          outcomes: [ratio, control, gap],
        }),
      );
      const regressed: CaseOutcomeLike = {
        logCase: buildLogCase({ id: 'b-control', category: 'control' }, [
          attempt(1, 'FAIL'),
          attempt(2, 'FAIL'),
        ]),
      };
      const improved: CaseOutcomeLike = {
        logCase: buildLogCase({ id: 'a-ratio', category: 'ratio-trap' }, [
          attempt(1, 'PASS'),
          attempt(2, 'PASS'),
        ]),
        configHash: 'otherhash000',
      };
      const after = buildCliRunRecord(
        recordInput({
          runId: 'after000-0000',
          arm: 'fixer-off',
          model: 'openai/gpt-4.1-mini',
          outcomes: [improved, regressed, gap],
        }),
      );
      const lines = formatDiffConsole(diffRunLogs(before, after), {
        a: 'before.json',
        b: 'after.json',
      });
      const text = lines.join('\n');
      expect(lines[0]).toBe(
        'health-insurance: iter0 · arm baseline · openai/gpt-5 → iter0 · arm fixer-off · openai/gpt-4.1-mini',
      );
      expect(text).toContain(
        '  before: before.json (2026-09-23T10:00:00.000Z)',
      );
      expect(text).toMatch(
        /⚠ Not like-for-like: different models \(openai\/gpt-5 vs openai\/gpt-4\.1-mini\); different engine configs/,
      );
      expect(text).toMatch(/pass\^2 +1\/2 \(50%\) → 1\/2 \(50%\)/);
      expect(text).toMatch(
        /▼ regression {2}b-control \(control\): PASS 2\/2 → FAIL 0\/2/,
      );
      expect(text).toMatch(
        /▲ improvement a-ratio \(ratio-trap\): FAIL 1\/2 → PASS 2\/2/,
      );
      expect(text).toContain('Regressions: b-control');
      expect(text).toContain('Improvements: a-ratio');
      expect(text).toContain('Flaky changes: a-ratio');
      // Worst after-rate first.
      const categoryRows = lines.filter((line) =>
        /^ {2}(control|ratio-trap)\s/.test(line),
      );
      expect(categoryRows.map((line) => line.trim().split(/\s+/)[0])).toEqual([
        'control',
        'ratio-trap',
      ]);
    });
  });

  describe('expert mode report', () => {
    const base = { reason: '', detail: '', durationMs: 0 };
    const graded = (
      name: string,
      verdict: 'PASS' | 'FAIL' | 'ERROR',
      record: NonNullable<CaseResult['expert']>,
      reason = '',
    ): CaseResult => ({
      ...base,
      name,
      verdict,
      reason,
      expert: record,
      expertAttempts: [{ verdict, record }],
    });
    const results: CaseResult[] = [
      graded('avg-salary', 'PASS', {
        traced: true,
        confidence: 0.91,
        band: 'high',
        tablesCoverage: 1,
        assumptionsCoverage: 0.5,
        metricMatched: true,
      }),
      graded('headcount', 'PASS', {
        traced: true,
        confidence: 0.84,
        band: 'high',
      }),
      graded(
        'attrition',
        'FAIL',
        {
          traced: true,
          confidence: 0.62,
          band: 'medium',
          metricMatched: false,
        },
        'result-mismatch',
      ),
      graded('no-trace', 'FAIL', { traced: false }, 'no-sql'),
      // An ERROR says nothing about the answer: never ranked.
      graded(
        'timeout',
        'ERROR',
        { traced: true, confidence: 0.99, band: 'high' },
        'timeout',
      ),
      {
        ...base,
        name: 'reports-to',
        verdict: 'SKIP',
        reason: 'no-expected-sql',
        probe: true,
        clarified: true,
        expert: { traced: false },
      },
      { ...base, name: 'placeholder', verdict: 'SKIP', reason: 'placeholder' },
    ];

    it('ranks graded attempts only and counts probes separately', () => {
      const summary = expertSummaryOf(results);
      expect(summary).toMatchObject({
        graded: 4,
        traced: 3,
        tracedPassed: 2,
        tracedFailed: 1,
        auroc: 1,
        meetsHighBandTarget: true,
        coverage: {
          tables: { mean: 1, n: 1 },
          assumptions: { mean: 0.5, n: 1 },
          metric: { matched: 1, n: 2, rate: 0.5 },
        },
        probes: { run: 1, traced: 0, clarified: 1, tracedClarifications: 0 },
      });
      expect(summary.bands.high).toMatchObject({
        n: 2,
        correct: 2,
        accuracy: 1,
      });
    });

    it('prints one row per case that ran, then the headline and the constraint', () => {
      const lines: string[] = [];
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        });
      try {
        reportExpert(results, expertSummaryOf(results));
      } finally {
        log.mockRestore();
      }
      const text = lines.join('\n');
      expect(lines).toContainEqual(
        expect.stringMatching(
          /^CASE\s+VERDICT\s+CONF\s+BAND\s+TABLES\s+ASSUMPTIONS\s+METRIC$/,
        ),
      );
      expect(text).toMatch(
        /avg-salary\s+PASS\s+0\.91\s+high\s+100%\s+50%\s+yes/,
      );
      expect(text).toMatch(
        /attrition\s+FAIL\(result-mismatch\)\s+0\.62\s+medium\s+-\s+-\s+no/,
      );
      expect(text).toMatch(/no-trace\s+FAIL\(no-sql\)\s+-\s+no trace/);
      expect(text).toMatch(
        /reports-to\s+SKIP\(no-expected-sql\)\s+-\s+no trace/,
      );
      expect(text).not.toMatch(/placeholder/);
      expect(text).toContain(
        'Expert mode: 3/4 graded answer(s) carried a reasoning trace',
      );
      expect(text).toContain(
        'AUROC (overall confidence vs PASS): 1.00 over 3 traced answer(s) (2 pass / 1 fail)',
      );
      expect(text).toMatch(
        /high-band accuracy: 2\/2 = 100% \(target ≥ 90%: met\)/,
      );
      expect(text).toContain(
        'Probes     1 ungraded case(s) run, 1 clarified, 0 carried a trace',
      );
    });

    it('says the headline is not measurable rather than printing 1.0 or 0.0', () => {
      const lines: string[] = [];
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        });
      const onlyPasses = results.slice(0, 2);
      try {
        reportExpert(onlyPasses, expertSummaryOf(onlyPasses));
      } finally {
        log.mockRestore();
      }
      expect(lines.join('\n')).toMatch(
        /AUROC: not measurable — needs at least one PASS and one FAIL/,
      );
    });

    it('parses --expert alongside the engine flags of a graded run', () => {
      const options = parseArgs([
        '--suites',
        'hr,retail',
        '--arms',
        'baseline,fixer-off',
        '--repeat',
        '3',
        '--expert',
      ]);
      expect(options).toMatchObject({
        expert: true,
        suites: ['hr', 'retail'],
        arms: ['baseline', 'fixer-off'],
        repeat: 3,
      });
    });
  });

  describe('expert mode on the shared harness', () => {
    const traced = (confidence: number, band: 'high' | 'medium' | 'low') => ({
      traced: true,
      confidence,
      band,
    });

    it('scores every observed attempt and reports the representative one', () => {
      const logCase = buildLogCase({ id: 'avg-salary', category: 'unit' }, [
        attempt(1, 'PASS'),
        attempt(2, 'FAIL'),
        attempt(3, 'PASS'),
      ]);
      const result = expertCaseResult(
        {
          name: 'avg-salary',
          category: 'unit',
          dataset: 'HR',
          question: 'q',
          expectedSql: 'SELECT 1',
        },
        logCase,
        [
          { record: traced(0.9, 'high'), clarified: false },
          { record: traced(0.4, 'low'), clarified: false },
          // The third turn never completed: nothing to rank.
          { clarified: false },
        ],
      );
      expect(result).toMatchObject({
        name: 'avg-salary',
        verdict: 'FAIL',
        expert: traced(0.4, 'low'),
        expertAttempts: [
          { verdict: 'PASS', record: traced(0.9, 'high') },
          { verdict: 'FAIL', record: traced(0.4, 'low') },
        ],
      });
      expect(result.probe).toBeUndefined();
    });

    it('treats a case with no reference SQL as a probe and surfaces a traced clarification', () => {
      const logCase = buildLogCase({ id: 'reports-to' }, [
        attempt(1, 'PASS'),
        attempt(2, 'PASS'),
      ]);
      const result = expertCaseResult(
        {
          name: 'reports-to',
          dataset: 'HR',
          question: 'Who reports to whom?',
          evalCase: {
            id: 'reports-to',
            question: 'Who reports to whom?',
            intent: 'clarify',
            checks: [],
          },
        },
        logCase,
        [
          { record: { traced: false }, clarified: true },
          { record: traced(0.7, 'medium'), clarified: true },
        ],
      );
      expect(result).toMatchObject({
        probe: true,
        clarified: true,
        expert: traced(0.7, 'medium'),
      });
      // A probe is never ranked, whatever its verdict.
      expect(expertSummaryOf([result])).toMatchObject({
        graded: 0,
        probes: { run: 1, clarified: 1, tracedClarifications: 1 },
      });
    });

    it('attaches the per-case records and the summary to the v2 run record', () => {
      const record = buildCliRunRecord(
        recordInput({ outcomes: sampleOutcomes() }),
      );
      const results: CaseResult[] = [
        {
          name: 'a-ratio',
          verdict: 'FAIL',
          reason: '',
          detail: '',
          durationMs: 0,
          expert: traced(0.3, 'low'),
          expertAttempts: [
            { verdict: 'PASS', record: traced(0.8, 'high') },
            { verdict: 'FAIL', record: traced(0.3, 'low') },
          ],
        },
        {
          name: 'b-control',
          verdict: 'PASS',
          reason: '',
          detail: '',
          durationMs: 0,
          expert: traced(0.95, 'high'),
          expertAttempts: [{ verdict: 'PASS', record: traced(0.95, 'high') }],
        },
      ];
      const withTrace = withExpert(record, results);
      expect(withTrace.expert).toMatchObject({
        graded: 3,
        traced: 3,
        auroc: 1,
      });
      const byId = new Map(withTrace.cases.map((item) => [item.id, item]));
      expect(byId.get('a-ratio')?.expert).toMatchObject({
        confidence: 0.3,
        attempts: [
          { verdict: 'PASS', traced: true, confidence: 0.8, band: 'high' },
          { verdict: 'FAIL', traced: true, confidence: 0.3, band: 'low' },
        ],
      });
      // One attempt: no per-attempt list to repeat.
      expect(byId.get('b-control')?.expert).not.toHaveProperty('attempts');
      expect(byId.get('c-gap')).not.toHaveProperty('expert');
      // Everything the plain record said is still there.
      expect(withTrace.summary).toEqual(record.summary);
    });
  });
});
