/**
 * Unit tests for the golden-set CLI harness (`backend/scripts/run-eval.ts`).
 *
 * WHY it lives under `src/`: jest's `rootDir` is `src`, so a spec next to the
 * script would never be collected. The harness itself stays in `scripts/`,
 * which `tsconfig.build.json` excludes from the Nest build.
 *
 * Only the pure parts are covered — argument parsing, case-file loading and
 * the per-category tally. Importing the module is deliberately cheap: the Nest
 * graph is loaded with `require` at run time, so nothing here boots the app,
 * opens a database or calls a model.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  EvalSetupError,
  expertSummaryOf,
  loadGoldenSet,
  parseArgs,
  readCaseFile,
  reportExpert,
  selectCases,
  summarizeCategories,
  type CaseResult,
} from '../../../scripts/run-eval';
import { tallyCategories } from './eval-telemetry';

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
      expect(options.repeat).toBe(1);
      expect(options.validate).toBe(false);
      expect(options.log).toBe(true);
      expect(options.includePlaceholders).toBe(false);
      expect(options.keepSessions).toBe(false);
      expect(options.verbose).toBe(false);
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

    it('parses the new flags', () => {
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

    it('rejects a --repeat that is not a whole number of runs', () => {
      expect(() => parseArgs(['--repeat', '0'])).toThrow(EvalSetupError);
      expect(() => parseArgs(['--repeat', '2.5'])).toThrow(/whole number/);
      expect(() => parseArgs(['--repeat'])).toThrow(/whole number/);
    });

    it('rejects a flag that needs a value but was given none', () => {
      expect(() => parseArgs(['--suite'])).toThrow(/--suite needs/);
      expect(() => parseArgs(['--category'])).toThrow(/--category needs/);
      expect(() => parseArgs(['--label'])).toThrow(/--label needs/);
    });

    it('rejects an unknown argument', () => {
      expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
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

  describe('per-category tally', () => {
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

    it('prints the worst rate first, so the eye lands on it', () => {
      const lines: string[] = [];
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        });
      try {
        summarizeCategories(
          results.map((result) => ({
            ...result,
            reason: '',
            detail: '',
            durationMs: 0,
          })),
        );
      } finally {
        log.mockRestore();
      }
      const order = lines
        .map((line) => line.trim().split(/\s{2,}/)[0])
        .filter((name) =>
          ['control', 'ratio-trap', 'ties', 'uncategorised'].includes(name),
        );
      expect(order).toEqual(['control', 'ratio-trap', 'ties', 'uncategorised']);
      expect(lines.some((line) => /control\s+0\/2\s+0%/.test(line))).toBe(true);
      expect(lines.some((line) => /ratio-trap\s+1\/2\s+50%/.test(line))).toBe(
        true,
      );
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
  });
});
