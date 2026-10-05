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
    const rows = Array.from({ length: 50 }, (_, i) => ({ plan: `P${i}` }));
    const warnings = inspectResult('SELECT plan FROM t', rows, 50);
    expect(codes(warnings)).toEqual(['row-cap-reached']);
    expect(messageFor(warnings, 'row-cap-reached')).toContain('50 rows');
  });

  // The assistant passes limit: 1 next to its own LIMIT 1 for a top-one
  // question; treating that as a ceiling produced a truncation caveat on a
  // correct answer in every measured trial.
  it('stays silent when the caller deliberately asked for a few rows', () => {
    expect(
      codes(
        inspectResult(
          'SELECT team FROM t ORDER BY goals DESC LIMIT 1',
          [{ team: 'France' }],
          1,
        ),
      ),
    ).toEqual([]);
  });

  it('flags results that exactly fill a large declared LIMIT', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ plan: `P${i}` }));
    const warnings = inspectResult(
      'SELECT plan FROM t ORDER BY spend DESC LIMIT 100',
      rows,
    );
    expect(codes(warnings)).toContain('row-cap-reached');
    expect(messageFor(warnings, 'row-cap-reached')).toContain('100 rows');
  });

  // A deliberate top-N is the query working, not a ceiling. Warning here made
  // the assistant hedge a correct "France scored the most goals" with a
  // truncation caveat, observed across 20 of 20 measured trials.
  it('stays silent on a deliberate small top-N', () => {
    expect(
      codes(
        inspectResult('SELECT team FROM t ORDER BY goals DESC LIMIT 1', [
          { team: 'France' },
        ]),
      ),
    ).toEqual([]);
    expect(
      codes(
        inspectResult('SELECT plan FROM t ORDER BY spend DESC LIMIT 3', [
          { plan: 'HMO' },
          { plan: 'PPO' },
          { plan: 'EPO' },
        ]),
      ),
    ).toEqual([]);
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
    const sql = `SELECT segment AS seg, SUM(x) AS kept, SUM(x) AS total FROM t LIMIT 12`;
    // Twelve rows against a cap of twelve: above the deliberate top-N size, so
    // the cap genuinely looks like a ceiling the result ran into.
    const rows = Array.from({ length: 12 }, (_, i) => ({
      seg: i === 0 ? null : `Segment ${i}`,
      rate: 1,
      kept: 5,
      total: 5,
    }));
    const warnings = inspectResult(sql, rows, 12);
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

describe('inspectResult / extended guards (L3 extendedGuards)', () => {
  const FILTERS = [
    {
      entity: 'questions_to_insights.health_insurance.claims',
      title: 'Exclude test claims',
      predicate:
        'Unless the question explicitly asks about test data, exclude claims where is_test = true from every claims aggregate.',
    },
  ];

  it('leaves every legacy result unchanged without the option', () => {
    const sql = 'SELECT member_id, total FROM health_insurance.claims';
    const rows = [
      { member_id: 1, total: 7 },
      { member_id: 2, total: 7 },
    ];
    expect(inspectResult(sql, rows, 100)).toEqual([]);
    expect(
      inspectResult(sql, rows, 100, {
        extended: false,
        defaultFilters: FILTERS,
      }),
    ).toEqual([]);
  });

  it('flags a constant metric of any value only when extended', () => {
    const rows = [
      { plan: 'Gold', claims: 48 },
      { plan: 'Silver', claims: 48 },
    ];
    expect(codes(inspectResult('SELECT plan, claims FROM t', rows))).toEqual(
      [],
    );
    const extended = inspectResult(
      'SELECT plan, claims FROM t',
      rows,
      undefined,
      { extended: true },
    );
    expect(codes(extended)).toEqual(['constant-metric']);
    expect(messageFor(extended, 'constant-metric')).toBe(
      'claims is 48 on every row, so it cannot explain any difference between them.',
    );
  });

  it('does not call a filtered id or period column a constant metric', () => {
    const rows = [
      { region_id: 3, claim_year: 2024, specialty: 'Oncology', claims: 10 },
      { region_id: 3, claim_year: 2024, specialty: 'Cardiology', claims: 12 },
    ];
    expect(
      codes(
        inspectResult('SELECT * FROM t', rows, undefined, { extended: true }),
      ),
    ).toEqual([]);
  });

  it('flags a result keyed only by ids', () => {
    const warnings = inspectResult(
      'SELECT member_id, COUNT(*) AS claims FROM health_insurance.claims WHERE is_test = false GROUP BY member_id ORDER BY claims DESC LIMIT 1',
      [{ member_id: 4711, claims: 31 }],
      1,
      { extended: true },
    );
    expect(codes(warnings)).toEqual(['id-only-projection']);
    expect(messageFor(warnings, 'id-only-projection')).toBe(
      'The result names its rows only by member_id, so join to the table that holds their names and report those instead.',
    );
  });

  it('stays quiet when a name rides along with the id', () => {
    expect(
      codes(
        inspectResult(
          'SELECT m.id, m.full_name, COUNT(*) AS claims FROM t',
          [{ id: 4711, full_name: 'Ada Lovelace', claims: 31 }],
          1,
          { extended: true },
        ),
      ),
    ).toEqual([]);
  });

  it('flags a default filter the query skipped, and accepts it in any spelling', () => {
    const rows = [{ claims: 1200 }];
    const warnings = inspectResult(
      "SELECT COUNT(*) AS claims FROM health_insurance.claims c WHERE c.status = 'PAID'",
      rows,
      100,
      { extended: true, defaultFilters: FILTERS },
    );
    expect(codes(warnings)).toEqual(['default-filter-missing']);
    expect(messageFor(warnings, 'default-filter-missing')).toBe(
      'The query reads claims without its default filter "Exclude test claims" (is_test), so rows that filter excludes are counted.',
    );
    for (const predicate of [
      'c.is_test = false',
      'NOT c.is_test',
      'c.is_test IS FALSE',
    ]) {
      expect(
        inspectResult(
          `SELECT COUNT(*) AS claims FROM health_insurance.claims c WHERE ${predicate}`,
          rows,
          100,
          { extended: true, defaultFilters: FILTERS },
        ),
      ).toEqual([]);
    }
  });

  it('ignores default filters for entities the query does not read, and CTE names', () => {
    const rows = [{ n: 5 }];
    expect(
      inspectResult(
        'SELECT COUNT(*) AS n FROM health_insurance.members',
        rows,
        100,
        {
          extended: true,
          defaultFilters: FILTERS,
        },
      ),
    ).toEqual([]);
    expect(
      inspectResult(
        'WITH claims AS (SELECT 1 AS n) SELECT n FROM claims',
        rows,
        100,
        {
          extended: true,
          defaultFilters: FILTERS,
        },
      ),
    ).toEqual([]);
  });

  it('never returns SQL syntax in an extended message', () => {
    const warnings = inspectResult(
      'SELECT member_id, 7 AS total FROM health_insurance.claims',
      [
        { member_id: 1, total: 7 },
        { member_id: 2, total: 7 },
      ],
      100,
      { extended: true, defaultFilters: FILTERS },
    );
    expect(warnings.length).toBe(3);
    for (const warning of warnings) {
      expect(warning.message).not.toMatch(/SELECT|WHERE|GROUP BY|= ?false/i);
      expect(warning.message.endsWith('.')).toBe(true);
    }
  });
});
