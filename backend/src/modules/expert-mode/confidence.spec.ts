import {
  BLOCK_SIGNAL_WEIGHTS,
  assumptionLoadMeasurement,
  bandFor,
  blockConfidence,
  coverageMeasurement,
  crossCheckMeasurement,
  executionMeasurement,
  joinGroundingMeasurement,
  makeSignal,
  overallConfidence,
  schemaGroundingMeasurement,
  scoreSignals,
  selfReportMeasurement,
  verifiedMeasurement,
} from './confidence';
import { CONFIDENCE_BANDS } from './entities/reasoning-trace.entity';
import type { Confidence } from './entities/reasoning-trace.entity';

const conf = (score: number): Confidence => ({
  score,
  band: bandFor(score),
  signals: [],
});

describe('bands', () => {
  it('draws the lines from CONFIDENCE_BANDS, inclusive at the threshold', () => {
    expect(bandFor(CONFIDENCE_BANDS.high)).toBe('high');
    expect(bandFor(0.79)).toBe('medium');
    expect(bandFor(CONFIDENCE_BANDS.medium)).toBe('medium');
    expect(bandFor(0.54)).toBe('low');
    expect(bandFor(0)).toBe('low');
    expect(bandFor(1)).toBe('high');
  });
});

describe('scoreSignals / blockConfidence', () => {
  it('is the weighted mean of the present signals, rounded to 2 decimals', () => {
    const result = scoreSignals([
      makeSignal('execution', { value: 1, note: '' }, 0.25),
      makeSignal('schema_grounding', { value: 0.5, note: '' }, 0.25),
      makeSignal('self_report', { value: 0.9, note: '' }, 0.1),
    ]);
    // (0.25 + 0.125 + 0.09) / 0.6 = 0.775
    expect(result.score).toBe(0.78);
    expect(result.band).toBe('medium');
  });

  it('omits unmeasured signals and renormalises instead of counting them as 0', () => {
    const sql = blockConfidence('sql', {
      execution: { value: 1, note: 'ran cleanly' },
      schema_grounding: { value: 1, note: 'all found' },
      // cross_check / verified_match / self_report were not measured.
    });
    expect(sql.score).toBe(1);
    expect(sql.signals.map((s) => s.id)).toEqual([
      'execution',
      'schema_grounding',
    ]);
    expect(sql.signals.map((s) => s.weight)).toEqual([0.25, 0.25]);
  });

  it('ignores signals the block does not weigh', () => {
    const interpretation = blockConfidence('interpretation', {
      execution: { value: 0, note: 'failed' },
      knowledge_coverage: { value: 1, note: '' },
    });
    expect(interpretation.signals.map((s) => s.id)).toEqual([
      'knowledge_coverage',
    ]);
    expect(interpretation.score).toBe(1);
  });

  it('keeps the self-report a minor voice next to measured evidence', () => {
    const block = blockConfidence('data-selection', {
      schema_grounding: { value: 0.5, note: '' },
      join_grounding: { value: 0, note: '' },
      execution: { value: 1, note: '' },
      self_report: { value: 1, note: '' },
    });
    // (0.175 + 0 + 0.15 + 0.1) / 0.85 = 0.5
    expect(block.score).toBe(0.5);
    expect(block.band).toBe('low');
  });

  it('scores a block with nothing measurable as 0 / low', () => {
    expect(blockConfidence('metric', {})).toEqual({
      score: 0,
      band: 'low',
      signals: [],
    });
  });

  it('weights every block with a 0.10 self-report', () => {
    for (const weights of Object.values(BLOCK_SIGNAL_WEIGHTS)) {
      expect(weights.self_report).toBe(0.1);
    }
  });
});

describe('overallConfidence', () => {
  it('is the block-weighted mean, renormalised over present blocks', () => {
    const all = overallConfidence(
      [
        { kind: 'interpretation', confidence: conf(1) },
        { kind: 'data-selection', confidence: conf(0.8) },
        { kind: 'assumptions', confidence: conf(0.6) },
        { kind: 'metric', confidence: conf(0.5) },
        { kind: 'sql', confidence: conf(0.9) },
      ],
      { verified: false, signals: [] },
    );
    // .15*1 + .25*.8 + .2*.6 + .1*.5 + .3*.9 = 0.79
    expect(all.score).toBe(0.79);
    expect(all.band).toBe('medium');

    // No SQL: only interpretation and assumptions exist.
    const noSql = overallConfidence(
      [
        { kind: 'interpretation', confidence: conf(1) },
        { kind: 'assumptions', confidence: conf(0.65) },
      ],
      { verified: false, signals: [] },
    );
    // (.15*1 + .2*.65) / .35 = 0.8
    expect(noSql.score).toBe(0.8);
  });

  it('caps a disagreeing cross-check at 0.5 and floors a verified match at 0.85', () => {
    const blocks = [
      { kind: 'sql' as const, confidence: conf(0.95) },
      { kind: 'assumptions' as const, confidence: conf(0.95) },
    ];
    expect(
      overallConfidence(blocks, {
        crossCheck: 'disagree',
        verified: false,
        signals: [],
      }).score,
    ).toBe(0.5);
    expect(
      overallConfidence([{ kind: 'sql', confidence: conf(0.4) }], {
        verified: true,
        signals: [],
      }),
    ).toEqual(expect.objectContaining({ score: 0.85, band: 'high' }));
    // An agreeing or errored check changes nothing.
    expect(
      overallConfidence(blocks, {
        crossCheck: 'error',
        verified: false,
        signals: [],
      }).score,
    ).toBe(0.95);
  });

  it('carries the block-independent signals it is given', () => {
    const signal = makeSignal('execution', { value: 1, note: 'ran' }, 0.25);
    expect(
      overallConfidence([], { verified: false, signals: [signal] }),
    ).toEqual({ score: 0, band: 'low', signals: [signal] });
  });
});

describe('measurements', () => {
  it('grades execution: clean 1, repaired/truncated 0.75, empty/warned 0.5, none 0', () => {
    expect(executionMeasurement({ ran: true, rowCount: 3 })).toEqual({
      value: 1,
      note: 'ran cleanly — 3 rows',
    });
    expect(
      executionMeasurement({ ran: true, rowCount: 3, repaired: true }).value,
    ).toBe(0.75);
    expect(
      executionMeasurement({ ran: true, rowCount: 200, truncated: true }).value,
    ).toBe(0.75);
    expect(executionMeasurement({ ran: true, rowCount: 0 }).value).toBe(0.5);
    expect(
      executionMeasurement({ ran: true, rowCount: 5, warnings: 2 }),
    ).toEqual({
      value: 0.5,
      note: 'ran, but 2 result-guard warnings (5 rows)',
    });
    // Worst outcome wins.
    expect(
      executionMeasurement({ ran: true, rowCount: 0, repaired: true }).value,
    ).toBe(0.5);
    expect(executionMeasurement({ ran: false }).value).toBe(0);
  });

  it('measures schema grounding over tables and columns, omitting when empty', () => {
    expect(
      schemaGroundingMeasurement({
        tables: { found: 3, total: 3 },
        columns: { found: 6, total: 7 },
      }),
    ).toEqual({
      value: 9 / 10,
      note: "3/3 tables and 6/7 columns are in the session's datasets",
    });
    expect(
      schemaGroundingMeasurement({
        tables: { found: 0, total: 0 },
        columns: { found: 0, total: 0 },
      }),
    ).toBeUndefined();
  });

  it('treats no joins as clean and unverifiable-only joins as unmeasured', () => {
    expect(
      joinGroundingMeasurement({ grounded: 0, measured: 0, unverifiable: 0 }),
    ).toEqual({ value: 1, note: 'no joins' });
    expect(
      joinGroundingMeasurement({ grounded: 0, measured: 0, unverifiable: 2 }),
    ).toBeUndefined();
    expect(
      joinGroundingMeasurement({ grounded: 1, measured: 2, unverifiable: 0 })
        ?.value,
    ).toBe(0.5);
  });

  it('counts knowledge, metric, verified, schema and data as grounded coverage', () => {
    expect(
      coverageMeasurement(
        ['knowledge', 'schema', 'convention', 'assumption'],
        'terms',
      ),
    ).toEqual({
      value: 0.5,
      note: '2/4 terms backed by knowledge, metrics, verified queries, schema or data',
    });
    expect(coverageMeasurement([], 'terms')).toBeUndefined();
  });

  it('loads assumptions linearly: 1 with no guesses, 0 at three', () => {
    expect(assumptionLoadMeasurement(['knowledge'], 'assumptions').value).toBe(
      1,
    );
    expect(
      assumptionLoadMeasurement(['assumption', 'schema'], 'assumptions').value,
    ).toBeCloseTo(2 / 3);
    expect(
      assumptionLoadMeasurement(
        ['assumption', 'assumption', 'assumption', 'assumption'],
        'assumptions',
      ).value,
    ).toBe(0);
    expect(assumptionLoadMeasurement([], 'assumptions').value).toBe(1);
  });

  it('reads the cross-check and verified match as evidence only when they exist', () => {
    expect(crossCheckMeasurement({ status: 'agree' })?.value).toBe(1);
    expect(crossCheckMeasurement({ status: 'disagree' })?.value).toBe(0);
    expect(crossCheckMeasurement({ status: 'error' })).toBeUndefined();
    expect(crossCheckMeasurement(undefined)).toBeUndefined();
    expect(verifiedMeasurement(true)?.value).toBe(1);
    expect(verifiedMeasurement(false)).toBeUndefined();
  });

  it('clamps the self-report and omits a missing one', () => {
    expect(selfReportMeasurement(1.4)?.value).toBe(1);
    expect(selfReportMeasurement(0.8)?.note).toContain('80%');
    expect(selfReportMeasurement(undefined)).toBeUndefined();
    expect(selfReportMeasurement(Number.NaN)).toBeUndefined();
  });
});
