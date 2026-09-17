import { DataWarning, DataWarningCode, inspectResult } from './result-guards';

function codes(warnings: DataWarning[]): DataWarningCode[] {
  return warnings.map((warning) => warning.code);
}

function messageFor(warnings: DataWarning[], code: DataWarningCode): string {
  return warnings.find((warning) => warning.code === code)?.message ?? '';
}

/** The query that motivated these guards: two aliases, one expression, a 100% rate. */
const MOTIVATING_SQL = `SELECT line_of_coverage,
  SUM(CAST(total_monthly_contracts AS INT)) AS total_kept,
  SUM(CAST(total_monthly_contracts AS INT)) AS total_policies
FROM health.contracts
GROUP BY line_of_coverage`;

describe('inspectResult / degenerate-ratio', () => {
  it('flags the motivating query', () => {
    const warnings = inspectResult(MOTIVATING_SQL, [
      { line_of_coverage: 'Medical', total_kept: 120, total_policies: 120 },
      { line_of_coverage: 'Dental', total_kept: 45, total_policies: 45 },
    ]);
    expect(codes(warnings)).toContain('degenerate-ratio');
    const message = messageFor(warnings, 'degenerate-ratio');
    expect(message).toContain('total_kept');
    expect(message).toContain('total_policies');
    expect(message).toContain('1 by construction');
  });

  it('reports only the degenerate ratio for the motivating query', () => {
    const warnings = inspectResult(MOTIVATING_SQL, [
      { line_of_coverage: 'Medical', total_kept: 120, total_policies: 120 },
      { line_of_coverage: 'Dental', total_kept: 45, total_policies: 45 },
    ]);
    expect(codes(warnings)).toEqual(['degenerate-ratio']);
  });

  it('does not read CAST(... AS type) as an alias binding', () => {
    // If the cast's AS were treated as a binding, both items would look like
    // `cast(a` under the aliases INT and DECIMAL and this would fire.
    const warnings = inspectResult(
      'SELECT CAST(a AS INT) AS whole, CAST(a AS DECIMAL(10,2)) AS precise FROM t',
      [
        { whole: 1, precise: 1.5 },
        { whole: 2, precise: 2.5 },
      ],
    );
    expect(codes(warnings)).toEqual([]);
  });

  it('still flags identical cast expressions under different aliases', () => {
    const warnings = inspectResult(
      'SELECT CAST(a AS INT) AS kept, CAST(a AS INT) AS total FROM t',
      [
        { kept: 3, total: 3 },
        { kept: 8, total: 8 },
      ],
    );
    expect(codes(warnings)).toEqual(['degenerate-ratio']);
  });

  it('ignores whitespace and case differences between expressions', () => {
    const warnings = inspectResult('SELECT sum( X ) AS a, SUM(x) AS b FROM t', [
      { a: 1, b: 1 },
      { a: 4, b: 4 },
    ]);
    expect(codes(warnings)).toEqual(['degenerate-ratio']);
  });

  it('ignores redundant outer parentheses', () => {
    const warnings = inspectResult('SELECT (a + b) AS x, a + b AS y FROM t', [
      { x: 2, y: 2 },
      { x: 6, y: 6 },
    ]);
    expect(codes(warnings)).toEqual(['degenerate-ratio']);
  });

  it('does not fire when the expressions genuinely differ', () => {
    const warnings = inspectResult(
      'SELECT SUM(kept) AS total_kept, SUM(policies) AS total_policies FROM t',
      [
        { total_kept: 90, total_policies: 120 },
        { total_kept: 30, total_policies: 45 },
      ],
    );
    expect(codes(warnings)).toEqual([]);
  });

  it('does not fire when the same expression keeps the same alias in two CTEs', () => {
    const sql = `WITH kept AS (SELECT SUM(x) AS a FROM t),
  dropped AS (SELECT SUM(x) AS b FROM u)
SELECT a, b FROM kept CROSS JOIN dropped`;
    const warnings = inspectResult(sql, [
      { a: 3, b: 9 },
      { a: 5, b: 11 },
    ]);
    expect(codes(warnings)).toEqual([]);
  });

  it('does not treat table aliases as expression aliases', () => {
    const warnings = inspectResult(
      'SELECT a.x, b.x FROM t AS a JOIN t AS b ON a.id = b.id',
      [{ x: 1 }, { x: 2 }],
    );
    expect(codes(warnings)).toEqual([]);
  });

  it('does not treat window frames or CTE headers as expression aliases', () => {
    const sql = `WITH ranked AS (
  SELECT plan, SUM(x) OVER (PARTITION BY plan) AS running FROM t
)
SELECT plan, running FROM ranked`;
    const warnings = inspectResult(sql, [
      { plan: 'HMO', running: 4 },
      { plan: 'PPO', running: 9 },
    ]);
    expect(codes(warnings)).toEqual([]);
  });

  it('does not fire on repeated constant padding', () => {
    const warnings = inspectResult(
      'SELECT 0 AS floor_value, 0 AS ceiling_value FROM t',
      [
        { floor_value: 0, ceiling_value: 0, seg: 'A' },
        { floor_value: 0, ceiling_value: 0, seg: 'B' },
      ],
    );
    expect(codes(warnings)).toEqual(['constant-metric', 'constant-metric']);
  });
});

describe('inspectResult / constant-metric', () => {
  it('flags a rate that is 1 on every row', () => {
    const warnings = inspectResult('SELECT plan, renewal_rate FROM t', [
      { plan: 'HMO', renewal_rate: 1 },
      { plan: 'PPO', renewal_rate: 1 },
      { plan: 'EPO', renewal_rate: 1 },
    ]);
    expect(codes(warnings)).toEqual(['constant-metric']);
    expect(messageFor(warnings, 'constant-metric')).toContain('renewal_rate');
    expect(messageFor(warnings, 'constant-metric')).toContain('1');
  });

  it('flags a count that is 0 on every row', () => {
    const warnings = inspectResult('SELECT plan, lapsed FROM t', [
      { plan: 'HMO', lapsed: 0 },
      { plan: 'PPO', lapsed: 0 },
    ]);
    expect(codes(warnings)).toEqual(['constant-metric']);
    expect(messageFor(warnings, 'constant-metric')).toContain('lapsed is 0');
  });

  it('recognises numerics returned as strings', () => {
    const warnings = inspectResult('SELECT plan, renewal_rate FROM t', [
      { plan: 'HMO', renewal_rate: '1.0' },
      { plan: 'PPO', renewal_rate: '1' },
    ]);
    expect(codes(warnings)).toEqual(['constant-metric']);
  });

  it('does not fire when the metric varies', () => {
    const warnings = inspectResult('SELECT plan, renewal_rate FROM t', [
      { plan: 'HMO', renewal_rate: 1 },
      { plan: 'PPO', renewal_rate: 0.82 },
    ]);
    expect(codes(warnings)).toEqual([]);
  });

  it('does not fire on a constant that is neither 0 nor 1', () => {
    const warnings = inspectResult('SELECT plan, plan_year FROM t', [
      { plan: 'HMO', plan_year: 2025 },
      { plan: 'PPO', plan_year: 2025 },
    ]);
    expect(codes(warnings)).toEqual([]);
  });

  it('does not fire on a single row', () => {
    const warnings = inspectResult('SELECT renewal_rate FROM t', [
      { renewal_rate: 1 },
    ]);
    expect(codes(warnings)).toEqual([]);
  });

  it('does not fire on boolean flags', () => {
    const warnings = inspectResult('SELECT plan, is_active FROM t', [
      { plan: 'HMO', is_active: true },
      { plan: 'PPO', is_active: true },
    ]);
    expect(codes(warnings)).toEqual([]);
  });
});

describe('inspectResult / unordered-limit', () => {
  it('flags LIMIT without ORDER BY', () => {
    const warnings = inspectResult('SELECT plan, spend FROM t LIMIT 5', [
      { plan: 'HMO', spend: 40 },
      { plan: 'PPO', spend: 12 },
    ]);
    expect(codes(warnings)).toEqual(['unordered-limit']);
    expect(messageFor(warnings, 'unordered-limit')).toContain('arbitrary');
  });

  it('does not fire when the query ranks its rows', () => {
    const warnings = inspectResult(
      'SELECT plan, spend FROM t ORDER BY spend DESC LIMIT 5',
      [
        { plan: 'HMO', spend: 40 },
        { plan: 'PPO', spend: 12 },
      ],
    );
    expect(codes(warnings)).toEqual([]);
  });

  it('does not fire without a LIMIT', () => {
    const warnings = inspectResult('SELECT plan, spend FROM t', [
      { plan: 'HMO', spend: 40 },
      { plan: 'PPO', spend: 12 },
    ]);
    expect(codes(warnings)).toEqual([]);
  });

  it('ignores LIMIT inside a string literal', () => {
    const warnings = inspectResult(
      "SELECT label FROM t WHERE label = 'top 10 limit 5'",
      [{ label: 'a' }, { label: 'b' }],
    );
    expect(codes(warnings)).toEqual([]);
  });

  it('ignores LIMIT inside a comment', () => {
    const warnings = inspectResult('SELECT plan FROM t -- limit 5 later\n', [
      { plan: 'HMO' },
      { plan: 'PPO' },
    ]);
    expect(codes(warnings)).toEqual([]);
  });
});

describe('inspectResult / blank-group-key', () => {
  it('flags a column that is blank on some rows', () => {
    const warnings = inspectResult('SELECT segment FROM t', [
      { segment: 'Large' },
      { segment: null },
      { segment: '   ' },
    ]);
    expect(codes(warnings)).toEqual(['blank-group-key']);
    expect(messageFor(warnings, 'blank-group-key')).toContain('segment');
    expect(messageFor(warnings, 'blank-group-key')).toContain('2 of 3');
  });

  it('counts undefined as blank', () => {
    const warnings = inspectResult('SELECT segment FROM t', [
      { segment: 'Large' },
      { segment: undefined },
    ]);
    expect(codes(warnings)).toEqual(['blank-group-key']);
  });

  it('does not fire when every row is blank', () => {
    const warnings = inspectResult('SELECT segment FROM t', [
      { segment: null },
      { segment: '' },
    ]);
    expect(codes(warnings)).toEqual([]);
  });

  it('does not fire when no row is blank', () => {
    const warnings = inspectResult('SELECT segment FROM t', [
      { segment: 'Large' },
      { segment: 'Small' },
    ]);
    expect(codes(warnings)).toEqual([]);
  });
});

describe('inspectResult / row-cap-reached', () => {
  it('flags results that reach the requested cap', () => {
    const warnings = inspectResult(
      'SELECT plan, spend FROM t',
      [
        { plan: 'HMO', spend: 4 },
        { plan: 'PPO', spend: 9 },
      ],
      2,
    );
    expect(codes(warnings)).toEqual(['row-cap-reached']);
    expect(messageFor(warnings, 'row-cap-reached')).toContain('2 rows');
  });

  it('flags results that exactly fill the declared LIMIT', () => {
    const warnings = inspectResult(
      'SELECT plan FROM t ORDER BY spend DESC LIMIT 3',
      [{ plan: 'HMO' }, { plan: 'PPO' }, { plan: 'EPO' }],
    );
    expect(codes(warnings)).toEqual(['row-cap-reached']);
    expect(messageFor(warnings, 'row-cap-reached')).toContain('3 rows');
  });

  it('does not fire below the cap', () => {
    const warnings = inspectResult(
      'SELECT plan, spend FROM t ORDER BY spend DESC LIMIT 10',
      [
        { plan: 'HMO', spend: 4 },
        { plan: 'PPO', spend: 9 },
      ],
      50,
    );
    expect(codes(warnings)).toEqual([]);
  });

  it('does not fire on an empty result', () => {
    expect(
      inspectResult('SELECT plan FROM t ORDER BY plan LIMIT 10', [], 10),
    ).toEqual([]);
  });
});

describe('inspectResult / contract', () => {
  it('returns warnings in declaration order', () => {
    const sql = `SELECT segment AS seg, SUM(x) AS kept, SUM(x) AS total FROM t LIMIT 2`;
    const warnings = inspectResult(
      sql,
      [
        { seg: 'Large', rate: 1, kept: 5, total: 5 },
        { seg: null, rate: 1, kept: 7, total: 7 },
      ],
      2,
    );
    expect(codes(warnings)).toEqual([
      'degenerate-ratio',
      'constant-metric',
      'unordered-limit',
      'blank-group-key',
      'row-cap-reached',
    ]);
  });

  it('returns nothing for a healthy result', () => {
    const sql = `SELECT line_of_coverage,
  SUM(CAST(kept AS INT)) AS total_kept,
  SUM(CAST(policies AS INT)) AS total_policies,
  SUM(CAST(kept AS INT)) / SUM(CAST(policies AS INT)) AS retention_rate
FROM health.contracts
GROUP BY line_of_coverage
ORDER BY retention_rate DESC`;
    const warnings = inspectResult(
      sql,
      [
        {
          line_of_coverage: 'Medical',
          total_kept: 90,
          total_policies: 120,
          retention_rate: 0.75,
        },
        {
          line_of_coverage: 'Dental',
          total_kept: 30,
          total_policies: 45,
          retention_rate: 0.67,
        },
      ],
      500,
    );
    expect(warnings).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(inspectResult('', [])).toEqual([]);
  });

  it('survives null-ish arguments', () => {
    expect(
      inspectResult(
        null as unknown as string,
        null as unknown as Record<string, unknown>[],
      ),
    ).toEqual([]);
    expect(
      inspectResult(
        undefined as unknown as string,
        undefined as unknown as Record<string, unknown>[],
        undefined,
      ),
    ).toEqual([]);
  });

  it('skips non-object rows', () => {
    const rows = [null, undefined, 42, 'row'] as unknown as Record<
      string,
      unknown
    >[];
    expect(inspectResult('SELECT a FROM t', rows)).toEqual([]);
  });

  it('survives exotic cell values', () => {
    const rows: Record<string, unknown>[] = [
      { a: { nested: true }, b: new Date(0), c: 9007199254740993n },
      { a: [1, 2], b: new Date(1), c: 1n },
    ];
    expect(() => inspectResult('SELECT a, b, c FROM t', rows)).not.toThrow();
  });

  it('survives malformed SQL', () => {
    expect(() =>
      inspectResult('SELECT ((( AS x FROM', [{ x: 1 }]),
    ).not.toThrow();
    expect(() =>
      inspectResult(")))) AS AS AS 'unterminated", [{ x: 1 }]),
    ).not.toThrow();
    expect(() =>
      inspectResult('/* unterminated comment SELECT a AS b', [{ x: 1 }]),
    ).not.toThrow();
  });

  it('never returns a message containing SQL syntax', () => {
    const warnings = inspectResult(MOTIVATING_SQL, [
      { line_of_coverage: 'Medical', total_kept: 120, total_policies: 120 },
      { line_of_coverage: 'Dental', total_kept: 45, total_policies: 45 },
    ]);
    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) {
      expect(warning.message).not.toMatch(/SELECT|CAST|SUM\(|GROUP BY/i);
      expect(warning.message.endsWith('.')).toBe(true);
    }
  });
});
