import {
  PIVOT_RUNTIME_MEMBERS,
  qtiPivotHeading,
  qtiPivotModel,
  qtiPivotStyle,
} from './visual-runtime-pivot';
import {
  VISUAL_RUNTIME_SCRIPT,
  compareValues,
  formatValue,
  toNumber,
  type VisualChartSpec,
} from './visual-runtime';

beforeAll(() => {
  Object.assign(globalThis, { toNumber, formatValue, compareValues });
});

const WIDE_ROWS = [
  { age_band: '20-24', total: 17, hsa: 6, ppo: 7, na: 4 },
  { age_band: '25-29', total: 174, hsa: 50, ppo: 83, na: 41 },
  { age_band: '30-34', total: 355, hsa: 101, ppo: 142, na: 112 },
  { age_band: '35-39', total: 400, hsa: 120, ppo: 150, na: 130 },
  { age_band: '40-44', total: 410, hsa: 125, ppo: 155, na: 130 },
  { age_band: '45-49', total: 420, hsa: 130, ppo: 160, na: 130 },
  { age_band: '50-54', total: 430, hsa: 135, ppo: 165, na: 130 },
  { age_band: '55-59', total: 440, hsa: 140, ppo: 170, na: 130 },
  { age_band: '60-64', total: 300, hsa: 90, ppo: 110, na: 100 },
  { age_band: '65-69', total: 200, hsa: 60, ppo: 70, na: 70 },
  { age_band: '70-74', total: 100, hsa: 30, ppo: 40, na: 30 },
  { age_band: '75+', total: 50, hsa: 15, ppo: 20, na: 15 },
];

const wide: VisualChartSpec = {
  form: 'pivot',
  x: 'age_band',
  y: ['hsa', 'ppo', 'na'],
};

const long: VisualChartSpec = {
  form: 'pivot',
  x: 'age_band',
  series: 'plan_type',
  y: 'n',
};

const LONG_ROWS = [
  { age_band: '30-34', plan_type: 'ppo', n: 5 },
  { age_band: '30-34', plan_type: 'hsa', n: 3 },
  { age_band: '20-24', plan_type: 'ppo', n: 2 },
  { age_band: '20-24', plan_type: 'ppo', n: 4 },
  { age_band: '20-24', plan_type: 'hsa', n: 1 },
];

describe('qtiPivotModel', () => {
  it('builds the wide shape from a real fixture', () => {
    const model = qtiPivotModel(WIDE_ROWS, wide);
    expect(model.rowLabels).toHaveLength(12);
    expect(model.columnLabels).toEqual(['hsa', 'ppo', 'na']);
    expect(model.cells[0]).toEqual([6, 7, 4]);
    expect(model.cells[1]).toEqual([50, 83, 41]);
    expect(model.columnTotals[0]).toBe(
      WIDE_ROWS.reduce((sum, row) => sum + row.hsa, 0),
    );
    expect(model.rowTotalColumn).toBe(false);
    expect(model.totalRow).toBe(true);
  });

  it('builds the long shape, summing repeated pairs, in first-appearance order', () => {
    const model = qtiPivotModel(LONG_ROWS, long);
    expect(model.rowLabels).toEqual(['30-34', '20-24']);
    expect(model.columnLabels).toEqual(['ppo', 'hsa']);
    expect(model.cells).toEqual([
      [5, 3],
      [6, 1],
    ]);
    expect(model.rowTotals).toEqual([8, 7]);
    expect(model.columnTotals).toEqual([11, 4]);
    expect(model.grandTotal).toBe(15);
    expect(model.rowTotalColumn).toBe(true);
  });

  it('leaves a missing pair empty and out of the totals', () => {
    const model = qtiPivotModel(
      [
        { age_band: 'a', plan_type: 'x', n: 1 },
        { age_band: 'b', plan_type: 'y', n: 2 },
      ],
      long,
    );
    expect(model.cells).toEqual([
      [1, null],
      [null, 2],
    ]);
    expect(model.rowTotals).toEqual([1, 2]);
    expect(model.columnTotals).toEqual([1, 2]);
    expect(model.grandTotal).toBe(3);
  });

  it('reads numbers that arrive as strings and skips non-numeric cells', () => {
    const model = qtiPivotModel(
      [
        { age_band: 'a', plan_type: 'x', n: '1,204' },
        { age_band: 'a', plan_type: 'y', n: 'n/a' },
        { age_band: 'b', plan_type: 'x', n: null },
      ],
      long,
    );
    expect(model.cells).toEqual([
      [1204, null],
      [null, null],
    ]);
    expect(model.grandTotal).toBe(1204);
  });

  it('sorts rows by label and by row total, either way', () => {
    const rows = [
      { k: 'b', v: 5 },
      { k: 'a', v: 9 },
      { k: 'c', v: 1 },
    ];
    const base: VisualChartSpec = { form: 'pivot', x: 'k', y: ['v'] };
    const labels = (sort: VisualChartSpec['sort']) =>
      qtiPivotModel(rows, { ...base, sort }).rowLabels;
    expect(labels(undefined)).toEqual(['b', 'a', 'c']);
    expect(labels({ by: 'x', dir: 'asc' })).toEqual(['a', 'b', 'c']);
    expect(labels({ by: 'x', dir: 'desc' })).toEqual(['c', 'b', 'a']);
    expect(labels({ by: 'y', dir: 'desc' })).toEqual(['a', 'b', 'c']);
    expect(labels({ by: 'y', dir: 'asc' })).toEqual(['c', 'b', 'a']);
  });

  it('keeps the top N rows in their order and folds the rest into Other', () => {
    const rows = [
      { k: 'a', v: 1 },
      { k: 'b', v: 10 },
      { k: 'c', v: 2 },
      { k: 'd', v: 8 },
    ];
    const model = qtiPivotModel(rows, {
      form: 'pivot',
      x: 'k',
      y: ['v'],
      topN: 2,
    });
    expect(model.rowLabels).toEqual(['b', 'd', 'Other']);
    expect(model.cells).toEqual([[10], [8], [3]]);
    expect(model.grandTotal).toBe(21);
    expect(model.otherRow).toBe(true);
  });

  it('keeps the 12 largest series values and folds the rest into Other', () => {
    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i <= 14; i++) {
      rows.push({ age_band: 'a', plan_type: 's' + i, n: i });
    }
    const model = qtiPivotModel(rows, long);
    expect(model.columnLabels).toHaveLength(13);
    expect(model.columnLabels[12]).toBe('Other');
    expect(model.columnLabels).not.toContain('s1');
    expect(model.columnLabels).not.toContain('s2');
    expect(model.columnLabels.slice(0, 3)).toEqual(['s3', 's4', 's5']);
    expect(model.cells[0][12]).toBe(3);
    expect(model.grandTotal).toBe(105);
  });

  it('drops both totals when totals is false and keeps them for null', () => {
    const off = qtiPivotModel(LONG_ROWS, { ...long, totals: false });
    expect(off.totalRow).toBe(false);
    expect(off.rowTotalColumn).toBe(false);
    const absent = qtiPivotModel(LONG_ROWS, {
      ...long,
      totals: null as unknown as undefined,
    });
    expect(absent.totalRow).toBe(true);
    expect(absent.rowTotalColumn).toBe(true);
  });

  it('returns an empty model for an empty record', () => {
    const model = qtiPivotModel([], wide);
    expect(model.rowLabels).toEqual([]);
    expect(model.columnLabels).toEqual([]);
    expect(model.grandTotal).toBe(0);
  });
});

describe('qtiPivotHeading', () => {
  it('reads a column name as a heading', () => {
    expect(qtiPivotHeading('age_band')).toBe('Age band');
    expect(qtiPivotHeading('avg__income_usd')).toBe('Avg income usd');
    expect(qtiPivotHeading('Employees')).toBe('Employees');
    expect(qtiPivotHeading('hsa')).toBe('Hsa');
    expect(qtiPivotHeading('_')).toBe('');
  });
});

describe('the assembled runtime script', () => {
  it('parses', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- parse check only, never called
    expect(() => new Function(VISUAL_RUNTIME_SCRIPT)).not.toThrow();
  });

  it('embeds every pivot function', () => {
    expect(PIVOT_RUNTIME_MEMBERS).toContain(qtiPivotStyle);
    for (const member of PIVOT_RUNTIME_MEMBERS) {
      const name = /function\s+(\w+)\s*\(/.exec(member.toString());
      expect(name).not.toBeNull();
      expect(VISUAL_RUNTIME_SCRIPT).toContain(`function ${name![1]}(`);
    }
  });
});
