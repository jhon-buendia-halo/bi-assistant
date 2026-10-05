import { classifyRepair, SEMANTIC_REPAIR_WARNING } from './sql-repair-guard';

const BASE =
  "SELECT c.status, SUM(c.paid_amount) AS paid FROM health_insurance.claims c WHERE c.is_test = false AND c.service_date >= DATE '2024-01-01' GROUP BY c.status";

describe('classifyRepair', () => {
  it('calls a column rename an identifier repair', () => {
    const result = classifyRepair(
      BASE,
      BASE.replace('paid_amount', 'paid_amount_cents'),
    );
    expect(result).toEqual({
      kind: 'identifier',
      changed: ['identifier: paid_amount → paid_amount_cents'],
    });
    expect(result.warning).toBeUndefined();
  });

  it('calls a table rename or a new qualifier an identifier repair', () => {
    expect(
      classifyRepair(
        BASE,
        BASE.replace('health_insurance.claims', 'health_insurance.claim_lines'),
      ).kind,
    ).toBe('identifier');
    expect(
      classifyRepair(
        'SELECT status, COUNT(*) FROM claims c GROUP BY status',
        'SELECT c.status, COUNT(*) FROM claims c GROUP BY c.status',
      ).kind,
    ).toBe('identifier');
  });

  it('calls casts, re-quoting, re-casing and whitespace syntax', () => {
    expect(
      classifyRepair(
        BASE,
        BASE.replace('SUM(c.paid_amount)', 'SUM(c.paid_amount::numeric)'),
      ).kind,
    ).toBe('syntax');
    expect(
      classifyRepair(BASE, BASE.toLowerCase().replace(/\s+/g, '  ')).kind,
    ).toBe('syntax');
    expect(
      classifyRepair('SELECT "Status" FROM t', 'SELECT `Status` FROM t').kind,
    ).toBe('syntax');
    expect(
      classifyRepair(
        'SELECT EXTRACT(YEAR FROM d) FROM t',
        "SELECT date_part('year', d) FROM t",
      ).kind,
    ).toBe('syntax');
    // Databricks string in double quotes → single quotes.
    expect(
      classifyRepair(
        'SELECT 1 FROM t WHERE s = "PAID"',
        "SELECT 1 FROM t WHERE s = 'PAID'",
      ).kind,
    ).toBe('syntax');
  });

  it('flags a changed literal as semantic', () => {
    const result = classifyRepair(
      BASE,
      BASE.replace("'2024-01-01'", "'2023-01-01'"),
    );
    expect(result.kind).toBe('semantic');
    expect(result.warning).toBe(SEMANTIC_REPAIR_WARNING);
    expect(result.changed).toEqual([
      "filter value: '2024-01-01' → '2023-01-01'",
    ]);
  });

  it('treats a re-cased string literal as a different value', () => {
    expect(
      classifyRepair(
        "SELECT 1 FROM t WHERE s = 'paid'",
        "SELECT 1 FROM t WHERE s = 'PAID'",
      ).kind,
    ).toBe('semantic');
  });

  it('flags a dropped filter as semantic', () => {
    const repaired = BASE.replace(
      " AND c.service_date >= DATE '2024-01-01'",
      '',
    );
    const result = classifyRepair(BASE, repaired);
    expect(result.kind).toBe('semantic');
    expect(result.changed.join(' | ')).toMatch(
      /filter value: removed '2024-01-01'/,
    );
    expect(result.changed.join(' | ')).toMatch(
      /comparison operator: removed >=/,
    );
    expect(result.changed.join(' | ')).toMatch(/query structure: removed AND/);
  });

  it('flags a changed aggregate, comparison or arithmetic operator as semantic', () => {
    expect(
      classifyRepair(BASE, BASE.replace('SUM(', 'AVG(')).changed,
    ).toContain('aggregate function: SUM → AVG');
    expect(classifyRepair(BASE, BASE.replace('>=', '>')).changed).toContain(
      'comparison operator: >= → >',
    );
    expect(
      classifyRepair('SELECT a - b FROM t', 'SELECT a + b FROM t').changed,
    ).toContain('arithmetic operator: - → +');
  });

  it('flags an added join or grouping as semantic', () => {
    const joined = classifyRepair(
      'SELECT m.full_name FROM claims c',
      'SELECT m.full_name FROM claims c JOIN members m ON m.id = c.member_id',
    );
    expect(joined.kind).toBe('semantic');
    expect(joined.changed.join(' | ')).toMatch(
      /query structure: added JOIN, ON/,
    );
    expect(
      classifyRepair(
        'SELECT a, COUNT(*) FROM t',
        'SELECT a, COUNT(*) FROM t GROUP BY a',
      ).kind,
    ).toBe('semantic');
  });

  it('does not read COUNT(*) or SELECT * as multiplication', () => {
    expect(
      classifyRepair(
        'SELECT COUNT(*) FROM claim',
        'SELECT COUNT(*) FROM claims',
      ).kind,
    ).toBe('identifier');
  });

  it('returns unknown for identical or unusable input', () => {
    expect(classifyRepair(BASE, BASE)).toEqual({
      kind: 'unknown',
      changed: [],
    });
    expect(classifyRepair('', BASE).kind).toBe('unknown');
    expect(classifyRepair(BASE, undefined as unknown as string).kind).toBe(
      'unknown',
    );
  });
});
