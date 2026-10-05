import {
  HIGH_BAND_ACCURACY_TARGET,
  assumptionsCoverage,
  auroc,
  expertCaseRecord,
  metricMatched,
  selectiveAccuracy,
  significantWords,
  summarizeExpert,
  tablesCoverage,
  type ExpertAttempt,
  type ScoredOutcome,
} from './expert-metrics';
import type {
  Confidence,
  ConfidenceBand,
  ReasoningBlock,
  ReasoningTrace,
} from './entities/reasoning-trace.entity';

function confidence(score: number, band: ConfidenceBand = 'high'): Confidence {
  return { score, band, signals: [] };
}

/**
 * A trace for "What is the average salary of tech employees in 2025?" — the
 * shape the service produces after post-processing, so the metrics are tested
 * against what they will actually read.
 */
function trace(
  overrides: Partial<ReasoningTrace> = {},
  blocks?: ReasoningBlock[],
): ReasoningTrace {
  return {
    id: 't-1',
    version: 1,
    generatedAt: '2026-09-29T10:00:00.000Z',
    overall: confidence(0.86),
    blocks: blocks ?? [
      {
        kind: 'interpretation',
        restatement:
          'Average 2025 base salary of Technology division employees, in USD.',
        terms: [
          {
            term: 'tech employees',
            mappedTo: 'departments in the Technology division',
            basis: 'knowledge',
            sourceRef: 'Tech employees',
          },
        ],
        ambiguities: ['Job family Data outside Technology'],
        confidence: confidence(0.9),
      },
      {
        kind: 'data-selection',
        tables: [
          {
            entity: 'world_cup.hr.v_salary_by_year',
            role: 'view',
            reason: 'One row per employee per year.',
            columnsUsed: ['annual_base_usd'],
          },
          {
            entity: 'world_cup.hr.departments',
            role: 'dimension',
            reason: 'Carries the division.',
            columnsUsed: ['division'],
          },
        ],
        joins: [],
        rejected: [
          {
            entity: 'world_cup.hr.job_titles',
            reason: 'Job family is not the division.',
          },
        ],
        confidence: confidence(0.8),
      },
      {
        kind: 'assumptions',
        items: [
          {
            id: 'a1',
            statement:
              'Contractors and interns are excluded; only regular employees count.',
            basis: 'knowledge',
          },
          {
            id: 'a2',
            statement:
              'The salary for 2025 is the row effective on 31 December.',
            basis: 'knowledge',
          },
        ],
        confidence: confidence(0.7, 'medium'),
      },
      {
        kind: 'metric',
        name: 'Average base salary (USD)',
        formula: 'AVG(annual_base_amount * rate_to_usd)',
        grain: 'per employee active on 2025-12-31',
        basis: 'metric',
        sourceRef: 'avg_base_salary_usd',
        confidence: confidence(0.95),
      },
      {
        kind: 'sql',
        sql: 'SELECT AVG(annual_base_usd) FROM hr.v_salary_by_year',
        annotations: [],
        rowCount: 1,
        confidence: confidence(0.4, 'low'),
      },
    ],
    ...overrides,
  };
}

/** The textbook definition, O(n·m): the reference the ranked version must equal. */
function pairwiseAuc(scores: ScoredOutcome[]): number {
  const pos = scores.filter((s) => s.correct);
  const neg = scores.filter((s) => !s.correct);
  let wins = 0;
  for (const p of pos) {
    for (const n of neg) {
      wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
    }
  }
  return wins / (pos.length * neg.length);
}

describe('auroc', () => {
  const row = (score: number, correct: boolean): ScoredOutcome => ({
    score,
    correct,
  });

  it('is 1 when every correct answer outscores every wrong one', () => {
    expect(
      auroc([row(0.9, true), row(0.8, true), row(0.3, false), row(0.2, false)]),
    ).toBe(1);
  });

  it('is 0 when the ranking is exactly backwards', () => {
    expect(auroc([row(0.1, true), row(0.9, false)])).toBe(0);
  });

  it('scores a constant confidence as a coin toss, not by sort order', () => {
    expect(
      auroc([row(0.7, true), row(0.7, false), row(0.7, true), row(0.7, false)]),
    ).toBe(0.5);
  });

  it('counts a tie between classes as one half (Mann–Whitney)', () => {
    // pairs: (0.8 vs 0.8) = ½, (0.8 vs 0.2) = 1, (0.5 vs 0.8) = 0, (0.5 vs 0.2) = 1 → 2.5/4
    expect(
      auroc([row(0.8, true), row(0.5, true), row(0.8, false), row(0.2, false)]),
    ).toBe(0.625);
  });

  it('matches the pairwise definition on a mixed set with ties', () => {
    const scores = [
      row(0.91, true),
      row(0.86, true),
      row(0.86, false),
      row(0.72, true),
      row(0.72, true),
      row(0.72, false),
      row(0.6, false),
      row(0.55, true),
      row(0.4, false),
      row(0.86, true),
    ];
    expect(auroc(scores)).toBeCloseTo(pairwiseAuc(scores), 10);
  });

  it('is undefined when a class is empty — there is nothing to rank against', () => {
    expect(auroc([])).toBeUndefined();
    expect(auroc([row(0.9, true), row(0.4, true)])).toBeUndefined();
    expect(auroc([row(0.9, false)])).toBeUndefined();
  });

  it('ignores scores that were not measured', () => {
    expect(
      auroc([row(Number.NaN, true), row(0.9, true), row(0.1, false)]),
    ).toBe(1);
    expect(auroc([row(Number.NaN, true), row(0.1, false)])).toBeUndefined();
  });
});

describe('selectiveAccuracy', () => {
  const rows = [
    { band: 'high' as const, correct: true },
    { band: 'high' as const, correct: true },
    { band: 'high' as const, correct: false },
    { band: 'medium' as const, correct: false },
  ];

  it('is the accuracy of the answers inside exactly that band, with its coverage', () => {
    expect(selectiveAccuracy(rows, 'high')).toEqual({
      band: 'high',
      n: 3,
      correct: 2,
      accuracy: 0.6667,
      coverage: 0.75,
    });
    expect(selectiveAccuracy(rows, 'medium')).toMatchObject({
      n: 1,
      correct: 0,
      accuracy: 0,
    });
  });

  it('reports no accuracy for an empty band instead of 0% or 100%', () => {
    expect(selectiveAccuracy(rows, 'low')).toEqual({
      band: 'low',
      n: 0,
      correct: 0,
      coverage: 0,
    });
    expect(selectiveAccuracy([], 'high')).toEqual({
      band: 'high',
      n: 0,
      correct: 0,
    });
  });
});

describe('significantWords', () => {
  it('keeps lower-cased letter runs of four or more, once each', () => {
    expect(
      significantWords(
        'Only EMPLOYEES, not contractors — employees in USD (2025)',
      ),
    ).toEqual(['only', 'employees', 'contractors']);
    expect(significantWords('avg_base_salary_usd')).toEqual(['base', 'salary']);
    expect(significantWords('in USD')).toEqual([]);
  });
});

describe('tablesCoverage', () => {
  it('matches schema.table as a dot-bounded suffix of the chosen entities', () => {
    expect(
      tablesCoverage(['hr.v_salary_by_year', 'HR.Departments'], trace()),
    ).toBe(1);
    expect(
      tablesCoverage(['hr.v_salary_by_year', 'hr.exchange_rates'], trace()),
    ).toBe(0.5);
  });

  it('does not credit a rejected table, or the same name in another schema', () => {
    expect(tablesCoverage(['hr.job_titles'], trace())).toBe(0);
    expect(tablesCoverage(['r.departments'], trace())).toBe(0);
  });

  it('tolerates quoted identifiers', () => {
    const quoted = trace({}, [
      {
        kind: 'data-selection',
        tables: [
          {
            entity: '"world_cup"."hr"."employees"',
            role: 'fact',
            reason: 'r',
            columnsUsed: [],
          },
        ],
        joins: [],
        rejected: [],
        confidence: confidence(0.9),
      },
    ]);
    expect(tablesCoverage(['hr.employees'], quoted)).toBe(1);
  });

  it('covers nothing when the trace has no data-selection block', () => {
    expect(tablesCoverage(['hr.employees'], trace({}, []))).toBe(0);
  });

  it('is undefined when nothing is expected or there is no trace', () => {
    expect(tablesCoverage(undefined, trace())).toBeUndefined();
    expect(tablesCoverage([], trace())).toBeUndefined();
    expect(tablesCoverage(['hr.employees'], undefined)).toBeUndefined();
  });
});

describe('assumptionsCoverage', () => {
  it('covers a phrase when every significant word appears in assumptions, terms or metric', () => {
    expect(
      assumptionsCoverage(
        [
          'exclude contractors and interns', // "excluded" contains "exclude"
          'salary effective on 31 December',
          'Technology division', // from the term mapping
          'annual base amount', // from the metric formula
        ],
        trace(),
      ),
    ).toBe(1);
  });

  it('needs every significant word, not just one — four-letter stopwords included', () => {
    expect(
      assumptionsCoverage(
        ['exclude terminated employees', 'Technology division'],
        trace(),
      ),
    ).toBe(0.5);
    // "with" is a significant word by the definition, so it must appear too.
    expect(
      assumptionsCoverage(['annual base amount with bonus'], trace()),
    ).toBe(0);
  });

  it('does not read the restatement, the ambiguities or the SQL', () => {
    // "family" only appears in an ambiguity; "annual_base_usd" only in the SQL.
    expect(assumptionsCoverage(['job family'], trace())).toBe(0);
  });

  it('counts a phrase with no significant word as not covered', () => {
    expect(assumptionsCoverage(['in USD'], trace())).toBe(0);
  });

  it('is undefined when nothing is expected or there is no trace', () => {
    expect(assumptionsCoverage(undefined, trace())).toBeUndefined();
    expect(
      assumptionsCoverage(['exclude contractors'], undefined),
    ).toBeUndefined();
  });
});

describe('metricMatched', () => {
  it('matches the governed metric name through sourceRef, ignoring case and punctuation', () => {
    expect(metricMatched('avg_base_salary_usd', trace())).toBe(true);
    expect(metricMatched('AVG BASE SALARY USD', trace())).toBe(true);
  });

  it('ignores the "(unverified)" marker on a downgraded reference', () => {
    const [interp, data, assumptions, metric, sql] = trace().blocks;
    const downgraded = trace({}, [
      interp,
      data,
      assumptions,
      {
        ...(metric as Extract<ReasoningBlock, { kind: 'metric' }>),
        basis: 'assumption',
        sourceRef: 'attrition_rate (unverified)',
      },
      sql,
    ]);
    expect(metricMatched('attrition_rate', downgraded)).toBe(true);
  });

  it('falls back to every significant word appearing in name, formula, grain', () => {
    expect(metricMatched('average base salary', trace())).toBe(true);
    expect(metricMatched('median base salary', trace())).toBe(false);
  });

  it('is false without a metric block and undefined without an expectation or trace', () => {
    expect(metricMatched('avg_base_salary_usd', trace({}, []))).toBe(false);
    expect(metricMatched(undefined, trace())).toBeUndefined();
    expect(metricMatched('  ', trace())).toBeUndefined();
    expect(metricMatched('avg_base_salary_usd', undefined)).toBeUndefined();
  });
});

describe('expertCaseRecord', () => {
  it('records the overall and per-block confidence plus every coverage', () => {
    expect(
      expertCaseRecord(trace(), {
        tables: ['hr.v_salary_by_year', 'hr.exchange_rates'],
        assumptions: ['exclude contractors'],
        metric: 'avg_base_salary_usd',
      }),
    ).toEqual({
      traced: true,
      confidence: 0.86,
      band: 'high',
      tablesCoverage: 0.5,
      assumptionsCoverage: 1,
      metricMatched: true,
      blocks: {
        interpretation: { score: 0.9, band: 'high' },
        'data-selection': { score: 0.8, band: 'high' },
        assumptions: { score: 0.7, band: 'medium' },
        metric: { score: 0.95, band: 'high' },
        sql: { score: 0.4, band: 'low' },
      },
    });
  });

  it('leaves out what the case does not expect, and says so when there is no trace', () => {
    const record = expertCaseRecord(trace(), { tables: ['hr.departments'] });
    expect(record.tablesCoverage).toBe(1);
    expect(record).not.toHaveProperty('assumptionsCoverage');
    expect(record).not.toHaveProperty('metricMatched');
    expect(expertCaseRecord(undefined, { tables: ['hr.departments'] })).toEqual(
      { traced: false },
    );
  });
});

describe('summarizeExpert', () => {
  const attempt = (
    score: number | undefined,
    band: ConfidenceBand | undefined,
    correct: boolean,
    extra: Partial<ExpertAttempt['record']> = {},
  ): ExpertAttempt => ({
    correct,
    record:
      score === undefined
        ? { traced: false }
        : { traced: true, confidence: score, band, ...extra },
  });

  it('computes the headline, the band constraint and the coverage means over traced answers', () => {
    const summary = summarizeExpert(
      [
        attempt(0.92, 'high', true, {
          tablesCoverage: 1,
          assumptionsCoverage: 0.5,
          metricMatched: true,
        }),
        attempt(0.85, 'high', true, {
          tablesCoverage: 0.5,
          metricMatched: false,
        }),
        attempt(0.6, 'medium', false, { tablesCoverage: 1 }),
        attempt(0.3, 'low', false),
        attempt(undefined, undefined, true), // no trace: counted, never scored
      ],
      [
        { clarified: true, record: { traced: false } },
        {
          clarified: true,
          record: { traced: true, confidence: 0.5, band: 'low' },
        },
      ],
    );
    expect(summary).toEqual({
      graded: 5,
      traced: 4,
      tracedPassed: 2,
      tracedFailed: 2,
      auroc: 1,
      bands: {
        high: { band: 'high', n: 2, correct: 2, accuracy: 1, coverage: 0.5 },
        medium: {
          band: 'medium',
          n: 1,
          correct: 0,
          accuracy: 0,
          coverage: 0.25,
        },
        low: { band: 'low', n: 1, correct: 0, accuracy: 0, coverage: 0.25 },
      },
      highBandTarget: HIGH_BAND_ACCURACY_TARGET,
      meetsHighBandTarget: true,
      coverage: {
        tables: { mean: 0.8333, n: 3 },
        assumptions: { mean: 0.5, n: 1 },
        metric: { matched: 1, n: 2, rate: 0.5 },
      },
      probes: { run: 2, traced: 1, clarified: 2, tracedClarifications: 1 },
    });
  });

  it('fails the constraint when a wrong answer is shown as high', () => {
    const summary = summarizeExpert([
      attempt(0.9, 'high', true),
      attempt(0.88, 'high', false),
      attempt(0.5, 'low', false),
    ]);
    expect(summary.bands.high.accuracy).toBe(0.5);
    expect(summary.meetsHighBandTarget).toBe(false);
  });

  it('leaves the headline and the constraint out when they cannot be measured', () => {
    const summary = summarizeExpert([
      attempt(0.7, 'medium', true),
      attempt(undefined, undefined, false),
    ]);
    expect(summary).not.toHaveProperty('auroc');
    expect(summary).not.toHaveProperty('meetsHighBandTarget');
    expect(summary).not.toHaveProperty('probes');
    expect(summary.coverage).toEqual({});
    expect(summary).toMatchObject({
      graded: 2,
      traced: 1,
      tracedPassed: 1,
      tracedFailed: 0,
    });
  });
});
