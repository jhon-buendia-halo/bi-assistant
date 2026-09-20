import {
  VISUAL_RUNTIME_FILENAME,
  VISUAL_RUNTIME_SCRIPT,
  aggregate,
  chartMeasures,
  chartSelect,
  coerceRows,
  compactNumber,
  compareValues,
  formatValue,
  groupRows,
  scaleTicks,
  selectRecord,
  spreadOverlaps,
  ticks,
  toNumber,
  topNCut,
} from './visual-runtime';
import type { VisualDataRecord } from './visual-runtime';

/** A result set in the shape the frame bridge hands to the runtime. */
function record(
  rows: Record<string, unknown>[],
  columns?: string[],
): VisualDataRecord {
  return {
    tool: 'run_readonly_sql',
    columns: columns ?? Object.keys(rows[0] ?? {}),
    rows,
    rowCount: rows.length,
  };
}

describe('toNumber', () => {
  it('accepts the strings a SQL driver returns', () => {
    expect(toNumber('4')).toBe(4);
    expect(toNumber('1,204')).toBe(1204);
    expect(toNumber('$38.20')).toBe(38.2);
    expect(toNumber('12%')).toBe(12);
    expect(toNumber(7)).toBe(7);
  });

  it('refuses the values Number() would silently turn into a number', () => {
    expect(toNumber(null)).toBeNaN();
    expect(toNumber(undefined)).toBeNaN();
    expect(toNumber('')).toBeNaN();
    expect(toNumber('   ')).toBeNaN();
    expect(toNumber(true)).toBeNaN();
    expect(toNumber('n/a')).toBeNaN();
  });
});

describe('selectRecord', () => {
  const data = [
    record([{ stage: 'Group', wins: '3' }]),
    record([{ player: 'Lionel Messi', goals: '4', assists: '1' }]),
  ];

  it('returns the first record whose declared columns contain every name', () => {
    expect(selectRecord(data, ['player', 'goals'])).toBe(data[1]);
  });

  it('falls back to the keys of the first row when columns are absent', () => {
    const undeclared: VisualDataRecord = {
      tool: 'run_readonly_sql',
      rows: [{ team: 'Argentina', titles: 3 }],
    };

    expect(selectRecord([undeclared], ['team', 'titles'])).toBe(undeclared);
    expect(selectRecord([undeclared], ['team', 'missing'])).toBeNull();
  });

  it('returns null when nothing carries the columns', () => {
    expect(selectRecord(data, ['nope'])).toBeNull();
    expect(selectRecord(undefined, ['nope'])).toBeNull();
  });

  it('matches the first record for an empty or missing selector', () => {
    expect(selectRecord(data, [])).toBe(data[0]);
    expect(selectRecord(data, undefined)).toBe(data[0]);
  });

  it('still returns a matching record that has no rows, so the caller can say so', () => {
    const empty = record([], ['stage', 'goals']);

    expect(selectRecord([empty], ['stage'])).toBe(empty);
    expect(empty.rows).toHaveLength(0);
  });
});

describe('aggregate', () => {
  const rows = [
    { stage: 'Group', goals: '4' },
    { stage: 'Round of 16', goals: '2' },
    { stage: 'Final', goals: 'n/a' },
    { stage: 'Semi', goals: null },
    { stage: 'Quarter', goals: 6 },
  ];

  it('sums the numeric rows and skips the rest', () => {
    expect(aggregate(rows, 'goals', 'sum')).toBe(12);
  });

  it('averages over the numeric rows only', () => {
    expect(aggregate(rows, 'goals', 'avg')).toBe(4);
  });

  it('takes min and max across string numerics', () => {
    expect(aggregate(rows, 'goals', 'min')).toBe(2);
    expect(aggregate(rows, 'goals', 'max')).toBe(6);
  });

  it('counts rows with a value in the column, not numeric rows', () => {
    expect(aggregate(rows, 'goals', 'count')).toBe(4);
    expect(aggregate(rows, undefined, 'count')).toBe(5);
  });

  it('reads the single row for the value aggregation', () => {
    expect(aggregate([{ total: '1204' }], 'total', 'value')).toBe(1204);
  });

  it('defaults to sum and returns null when nothing is numeric', () => {
    expect(
      aggregate([{ goals: '2' }, { goals: '3' }], 'goals', undefined),
    ).toBe(5);
    expect(aggregate([{ goals: 'n/a' }], 'goals', 'sum')).toBeNull();
    expect(aggregate([], 'goals', 'avg')).toBeNull();
    expect(aggregate(undefined, 'goals', 'sum')).toBeNull();
  });
});

describe('formatValue', () => {
  it('formats plain numbers with grouping and at most two decimals', () => {
    expect(formatValue(1204, 'number')).toBe('1,204');
    expect(formatValue(3.14159, 'number')).toBe('3.14');
    expect(formatValue(-1204)).toBe('-1,204');
  });

  it('formats compact magnitudes', () => {
    expect(formatValue(1200, 'compact')).toBe('1.2K');
    expect(formatValue(3_400_000, 'compact')).toBe('3.4M');
    expect(formatValue(2_000_000_000, 'compact')).toBe('2B');
    expect(formatValue(940, 'compact')).toBe('940');
    expect(compactNumber(-1500)).toBe('-1.5K');
  });

  it('treats percent values as already in percent units', () => {
    expect(formatValue(37.5, 'percent')).toBe('37.5%');
  });

  it('prefixes currency after the sign', () => {
    expect(formatValue(1204.5, 'currency')).toBe('$1,204.5');
    expect(formatValue(-20, 'currency')).toBe('-$20');
  });

  it('appends the unit', () => {
    expect(formatValue(12, 'number', 'goals')).toBe('12 goals');
    expect(formatValue(1200, 'compact', 'claims')).toBe('1.2K claims');
  });

  it('never renders NaN', () => {
    expect(formatValue(NaN)).toBe('—');
    expect(formatValue(NaN, 'currency', 'USD')).toBe('—');
    expect(formatValue(null)).toBe('—');
    expect(formatValue(undefined, 'compact')).toBe('—');
    expect(formatValue(Infinity)).toBe('—');
    expect(compactNumber(NaN)).toBe('—');
  });
});

describe('coerceRows', () => {
  it('coerces the measures and drops the rows that are not finite', () => {
    const rows = coerceRows(
      [
        { player: 'Messi', goals: '4' },
        { player: 'Mbappé', goals: '8' },
        { player: 'Unknown', goals: '' },
        { player: 'Missing', goals: null },
        { player: 'Text', goals: 'n/a' },
      ],
      ['goals'],
    );

    expect(rows).toEqual([
      { player: 'Messi', goals: 4 },
      { player: 'Mbappé', goals: 8 },
    ]);
  });

  it('requires every listed measure and leaves the source untouched', () => {
    const source = [
      { x: '1', y: 'n/a' },
      { x: '2', y: '3' },
    ];
    const rows = coerceRows(source, ['x', 'y']);

    expect(rows).toEqual([{ x: 2, y: 3 }]);
    expect(source[1].x).toBe('2');
  });

  it('returns every row when no measure is listed', () => {
    expect(coerceRows([{ a: 'x' }], [])).toEqual([{ a: 'x' }]);
    expect(coerceRows(undefined, ['a'])).toEqual([]);
  });
});

describe('topNCut', () => {
  const rows = [
    { stage: 'A', count: 10 },
    { stage: 'B', count: 9 },
    { stage: 'C', count: 8 },
    { stage: 'D', count: 7 },
    { stage: 'E', count: '6' },
  ];

  it('keeps the top N and folds the remainder into Other', () => {
    expect(topNCut(rows, 'stage', 'count', 3)).toEqual([
      { stage: 'A', count: 10 },
      { stage: 'B', count: 9 },
      { stage: 'C', count: 8 },
      { stage: 'Other', count: 13 },
    ]);
  });

  it('leaves the rows alone when they fit under the cut', () => {
    expect(topNCut(rows, 'stage', 'count', 5)).toHaveLength(5);
    expect(topNCut(rows, 'stage', 'count', undefined)).toHaveLength(5);
    expect(topNCut(rows, 'stage', 'count', 0)).toHaveLength(5);
  });

  it('treats non-numeric remainders as zero rather than NaN', () => {
    const cut = topNCut(
      [
        { stage: 'A', count: 10 },
        { stage: 'B', count: 'n/a' },
        { stage: 'C', count: 'n/a' },
      ],
      'stage',
      'count',
      1,
    );

    expect(cut[cut.length - 1]).toEqual({ stage: 'Other', count: 0 });
  });
});

describe('ticks', () => {
  it('steps by a nice 1/2/5 multiple and covers the maximum', () => {
    expect(ticks(100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks(95, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks(7, 5)).toEqual([0, 2, 4, 6, 8]);
    expect(ticks(1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('gives a degenerate domain a drawable axis', () => {
    expect(ticks(0)).toEqual([0, 1]);
    expect(ticks(-5)).toEqual([0, 1]);
    expect(ticks(NaN)).toEqual([0, 1]);
  });

  it('extends below zero with the same step when the data goes negative', () => {
    expect(scaleTicks(-30, 100, 5)).toEqual([-40, -20, 0, 20, 40, 60, 80, 100]);
    expect(scaleTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });
});

describe('spec readers', () => {
  it('reads one or many measures off the chart', () => {
    expect(chartMeasures({ form: 'bar', y: 'goals' })).toEqual(['goals']);
    expect(chartMeasures({ form: 'line', y: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(chartMeasures({ form: 'table' })).toEqual([]);
  });

  it('falls back to the named columns when the chart has no select', () => {
    expect(
      chartSelect({ form: 'bar', x: 'stage', y: 'count', series: 'type' }),
    ).toEqual(['stage', 'count', 'type']);
    expect(chartSelect({ form: 'bar', select: ['a'], x: 'b' })).toEqual(['a']);
  });

  it('compares categories naturally', () => {
    expect(compareValues('2', '10')).toBeLessThan(0);
    expect(compareValues('b', 'a')).toBeGreaterThan(0);
  });
});

describe('groupRows', () => {
  it('cross-tabulates category by series, preserving first-seen order', () => {
    const grouped = groupRows(
      [
        { stage: 'Group', type: 'open', count: 3 },
        { stage: 'Group', type: 'penalty', count: 1 },
        { stage: 'Final', type: 'open', count: 2 },
        { stage: 'Final', type: 'open', count: 1 },
      ],
      'stage',
      'type',
      'count',
    );

    expect(grouped.categories).toEqual(['Group', 'Final']);
    expect(grouped.series).toEqual(['open', 'penalty']);
    expect(grouped.values).toEqual({
      Group: { open: 3, penalty: 1 },
      Final: { open: 3 },
    });
  });

  it('skips rows whose measure is not finite', () => {
    const grouped = groupRows(
      [
        { stage: 'A', count: '2' },
        { stage: 'B', count: 'n/a' },
      ],
      'stage',
      undefined,
      'count',
    );

    expect(grouped.categories).toEqual(['A']);
    expect(grouped.values).toEqual({ A: { '': 2 } });
  });
});

describe('spreadOverlaps', () => {
  it('leaves points with unique coordinates untouched', () => {
    const points = [
      { cx: 10, cy: 10 },
      { cx: 20, cy: 20 },
    ];

    expect(spreadOverlaps(points, 7)).toEqual(points);
  });

  it('fans points sharing a coordinate onto a ring so ties stay visible', () => {
    const spread = spreadOverlaps(
      [
        { cx: 100, cy: 100 },
        { cx: 100, cy: 100 },
        { cx: 100, cy: 100 },
        { cx: 40, cy: 40 },
      ],
      7,
    );

    const keys = spread.map(
      (point) => `${point.cx.toFixed(2)}:${point.cy.toFixed(2)}`,
    );
    expect(new Set(keys).size).toBe(4);
    // Every fanned point stays on the ring around the shared centre.
    for (const point of spread.slice(0, 3)) {
      const distance = Math.hypot(point.cx - 100, point.cy - 100);
      expect(distance).toBeCloseTo(7, 6);
    }
    expect(spread[3]).toEqual({ cx: 40, cy: 40 });
  });

  it('is deterministic for the same input', () => {
    const points = [
      { cx: 5, cy: 5 },
      { cx: 5, cy: 5 },
    ];

    expect(spreadOverlaps(points, 7)).toEqual(spreadOverlaps(points, 7));
  });
});

describe('VISUAL_RUNTIME_SCRIPT', () => {
  it('is served under a stable filename', () => {
    expect(VISUAL_RUNTIME_FILENAME).toBe('qti-chart.js');
  });

  it('parses as browser JavaScript', () => {
    // Compile-only: the script is never executed here, it is parse-checked the
    // same way the visualization service parse-checks generated JavaScript.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    expect(() => new Function(VISUAL_RUNTIME_SCRIPT)).not.toThrow();
  });

  it('exposes the mount entry point without auto-mounting', () => {
    expect(VISUAL_RUNTIME_SCRIPT).toContain(
      'window.qtiChart = { mount: qtiMount };',
    );
    expect(VISUAL_RUNTIME_SCRIPT).not.toContain('qtiChart.mount()');
  });

  it('reads the spec block, the root and the frame bridge', () => {
    expect(VISUAL_RUNTIME_SCRIPT).toContain("getElementById('qti-spec')");
    expect(VISUAL_RUNTIME_SCRIPT).toContain("getElementById('qti-chart-root')");
    expect(VISUAL_RUNTIME_SCRIPT).toContain('onRefresh');
    expect(VISUAL_RUNTIME_SCRIPT).toContain('window.qti');
  });

  it('marks its data marks for the frame click bridge without handling clicks', () => {
    expect(VISUAL_RUNTIME_SCRIPT).toContain('data-qti-value');
    expect(VISUAL_RUNTIME_SCRIPT).toContain('data-qti-column');
    expect(VISUAL_RUNTIME_SCRIPT).toContain('data-qti-label');
    expect(VISUAL_RUNTIME_SCRIPT).not.toContain(
      "addEventListener('click', fire",
    );
    expect(VISUAL_RUNTIME_SCRIPT).toContain('qti-tooltip');
  });

  it('carries the same helper logic the tests above cover', () => {
    for (const name of [
      'function toNumber(',
      'function selectRecord(',
      'function aggregate(',
      'function formatValue(',
      'function coerceRows(',
      'function topNCut(',
      'function ticks(',
    ]) {
      expect(VISUAL_RUNTIME_SCRIPT).toContain(name);
    }
  });

  it('defines every runtime function it calls', () => {
    const used = VISUAL_RUNTIME_SCRIPT.match(/\bqti[A-Z]\w*/g) ?? [];
    const missing = Array.from(new Set(used))
      .filter((name) => name !== 'qtiState' && name !== 'qtiChart')
      .filter(
        (name) => !VISUAL_RUNTIME_SCRIPT.includes('function ' + name + '('),
      );

    expect(missing).toEqual([]);
  });

  it('uses no timers, storage, network or dynamic code', () => {
    for (const forbidden of [
      'setTimeout',
      'setInterval',
      'requestAnimationFrame',
      'localStorage',
      'fetch(',
      'XMLHttpRequest',
      'eval(',
      'innerHTML',
    ]) {
      expect(VISUAL_RUNTIME_SCRIPT).not.toContain(forbidden);
    }
  });

  it('colours data marks from the frame tokens, never a hex literal', () => {
    expect(VISUAL_RUNTIME_SCRIPT).toContain("'var(--qti-cat-'");
    expect(VISUAL_RUNTIME_SCRIPT).toContain('var(--qti-grid)');
    expect(VISUAL_RUNTIME_SCRIPT).toContain('var(--qti-axis)');
  });

  it('is safe to inline in a script block', () => {
    expect(VISUAL_RUNTIME_SCRIPT).not.toMatch(/<\/script/i);
  });
});
