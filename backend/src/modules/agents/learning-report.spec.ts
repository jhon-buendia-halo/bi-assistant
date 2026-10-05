/**
 * Unit tests for the pure report/assert helpers behind
 * `backend/scripts/learning-demo.ts` (the scripted end-to-end check for
 * learning-from-feedback + answer pinning).
 *
 * WHY it lives under `src/`: jest's `rootDir` is `src`
 * (`backend/package.json`), so a spec next to the script would never be
 * collected — same arrangement as `run-eval.spec.ts` next to
 * `scripts/run-eval.ts`.
 */
import {
  bandAtLeast,
  bandRank,
  bytesEqual,
  caseMatches,
  compareBands,
  estimateModelCalls,
  findMatchesCheck,
  formatBand,
  formatReportTable,
  formatSummary,
  patternMatches,
  type ReportRow,
} from '../../../scripts/lib/learning-report';

describe('band comparison', () => {
  it('orders low < medium < high', () => {
    expect(bandRank('low')).toBeLessThan(bandRank('medium'));
    expect(bandRank('medium')).toBeLessThan(bandRank('high'));
  });

  it('ranks an absent band below every real band', () => {
    expect(bandRank(undefined)).toBeLessThan(bandRank('low'));
  });

  it('bandAtLeast is true only at or above the floor', () => {
    expect(bandAtLeast('high', 'medium')).toBe(true);
    expect(bandAtLeast('medium', 'medium')).toBe(true);
    expect(bandAtLeast('low', 'medium')).toBe(false);
    expect(bandAtLeast(undefined, 'medium')).toBe(false);
  });

  it('compareBands sorts ascending', () => {
    const bands: Array<'low' | 'medium' | 'high'> = ['high', 'low', 'medium'];
    expect([...bands].sort(compareBands)).toEqual(['low', 'medium', 'high']);
  });
});

describe('pattern check against a matches check', () => {
  it('finds the one matches check among other check types', () => {
    const checks = [
      { type: 'calledTool', tool: 'run_readonly_sql' },
      { type: 'matches', pattern: '4\\s*[-–:]\\s*2' },
      { type: 'noToolErrors' },
    ];
    expect(findMatchesCheck(checks)).toEqual({
      pattern: '4\\s*[-–:]\\s*2',
      flags: undefined,
    });
  });

  it('returns undefined when no matches check is present', () => {
    expect(findMatchesCheck([{ type: 'noToolErrors' }])).toBeUndefined();
    expect(findMatchesCheck(undefined)).toBeUndefined();
  });

  it('tests the compiled regex verbatim, tolerant of a thousands separator the same way the suite regex is written', () => {
    // Mirrors world-cup.json's own style: the tolerance lives in the pattern
    // the suite author wrote, not in any renormalization this helper does.
    const spec = { pattern: '88[,.]?966' };
    expect(patternMatches(spec, 'Total attendance was 88,966.')).toBe(true);
    expect(patternMatches(spec, 'Total attendance was 88966.')).toBe(true);
    expect(patternMatches(spec, 'Total attendance was 12,000.')).toBe(false);
  });

  it('honors flags (case-insensitive match)', () => {
    const spec = { pattern: 'argentina', flags: 'i' };
    expect(patternMatches(spec, 'Argentina won the final.')).toBe(true);
  });

  it('caseMatches throws loudly when the case carries no matches check', () => {
    expect(() => caseMatches([{ type: 'noToolErrors' }], 'anything')).toThrow(
      /no "matches" check/,
    );
  });

  it('caseMatches finds and tests in one call', () => {
    const checks = [{ type: 'matches', pattern: '\\bhigh\\b', flags: 'i' }];
    expect(caseMatches(checks, 'Confidence: HIGH')).toBe(true);
    expect(caseMatches(checks, 'Confidence: low')).toBe(false);
  });
});

describe('byte equality', () => {
  it('is true for identical strings', () => {
    expect(bytesEqual('Net revenue was $1,234,567.89.', 'Net revenue was $1,234,567.89.')).toBe(
      true,
    );
  });

  it('is false for any difference, including trailing whitespace', () => {
    expect(bytesEqual('Net revenue was $100.', 'Net revenue was $100. ')).toBe(false);
  });

  it('compares multi-byte characters correctly', () => {
    const line = 'café — high confidence'; // "café — high confidence"
    expect(bytesEqual(line, line)).toBe(true);
    // NFC ("é" as one code point) vs NFD ("e" + combining acute) look the
    // same printed but are different UTF-8 bytes — byte equality says so.
    expect(bytesEqual('café', 'café')).toBe(false);
  });
});

describe('model-call estimate', () => {
  it('a fresh expert ask costs the main turn plus cross-check plus explainer', () => {
    expect(estimateModelCalls('ask-fresh')).toBe(3);
  });

  it('a replay costs nothing', () => {
    expect(estimateModelCalls('ask-replay')).toBe(0);
  });

  it('one learning comment costs one feedback-learner call', () => {
    expect(estimateModelCalls('feedback')).toBe(1);
  });
});

describe('report table formatting', () => {
  const rows: ReportRow[] = [
    {
      step: 'S1',
      session: 'learning-demo S1',
      question: 'What was our net revenue in fiscal year 2025?',
      band: 'medium (0.70)',
      correct: 'no',
      consistency: '-',
      crossCheck: 'agree',
      modelCalls: '3',
    },
    {
      step: 'S3',
      session: 'learning-demo S3',
      question: 'What was our net revenue in fiscal year 2025?',
      band: 'high (0.97)',
      correct: 'yes',
      consistency: 'replay',
      crossCheck: '-',
      modelCalls: '0 (replay)',
    },
  ];

  it('includes a header row naming every column', () => {
    const [header] = formatReportTable(rows);
    for (const column of [
      'step',
      'session',
      'question',
      'band',
      'correct',
      'consistency',
      'cross-check',
      'calls',
    ]) {
      expect(header).toContain(column);
    }
  });

  it('pads every row to the same set of column widths', () => {
    const lines = formatReportTable(rows);
    // header + separator + one line per row
    expect(lines).toHaveLength(2 + rows.length);
    const [, separator] = lines;
    expect(separator).toMatch(/^-+(\s\s-+)*$/);
  });

  it('truncates an over-long question rather than breaking alignment', () => {
    const longQuestion: ReportRow = {
      ...rows[0],
      step: 'S2',
      question:
        'What was our net revenue by store in fiscal year 2025, broken out month by month for every region?',
    };
    const lines = formatReportTable([...rows, longQuestion]);
    expect(lines.some((line) => line.includes('…'))).toBe(true);
  });
});

describe('band formatting', () => {
  it('renders band and score together', () => {
    expect(formatBand(0.7, 'medium')).toBe('medium (0.70)');
  });

  it('renders just a dash when the band is absent', () => {
    expect(formatBand(undefined, undefined)).toBe('-');
  });

  it('falls back to the bare band when no score is given', () => {
    expect(formatBand(undefined, 'high')).toBe('high');
  });
});

describe('summary line', () => {
  it('formats the two headline numbers', () => {
    expect(
      formatSummary({
        liftPassed: 2,
        liftTotal: 2,
        bandBefore: 'medium',
        bandAfter: 'high',
        consistencyPassed: 2,
        consistencyTotal: 2,
      }),
    ).toBe('learning lift 2/2 (medium → high) · repeat consistency 2/2');
  });

  it('falls back to a dash for a missing band', () => {
    expect(
      formatSummary({
        liftPassed: 0,
        liftTotal: 2,
        bandBefore: undefined,
        bandAfter: undefined,
        consistencyPassed: 1,
        consistencyTotal: 2,
      }),
    ).toBe('learning lift 0/2 (- → -) · repeat consistency 1/2');
  });
});
