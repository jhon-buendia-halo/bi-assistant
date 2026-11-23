import { IAR_CASES } from './insights-analyst-retail-reference';

const entries = Object.entries(IAR_CASES);

describe('IAR_CASES (insights-analyst-retail reference data)', () => {
  it('holds the 36 cases, all prefixed iar-', () => {
    expect(entries).toHaveLength(36);
    for (const [id] of entries) expect(id.startsWith('iar-')).toBe(true);
  });

  it('counts 29 answers, 4 clarifications and 3 not-covered', () => {
    const count = (expected: string) =>
      entries.filter(([, c]) => c.expected === expected).length;
    expect(count('answer')).toBe(29);
    expect(count('clarification')).toBe(4);
    expect(count('not-covered')).toBe(3);
  });

  it('counts 10 easy, 15 medium and 11 hard', () => {
    const count = (difficulty: string) =>
      entries.filter(([, c]) => c.difficulty === difficulty).length;
    expect(count('easy')).toBe(10);
    expect(count('medium')).toBe(15);
    expect(count('hard')).toBe(11);
  });

  it('gives every answer case a reference SQL, the empty-table one aside from the rule', () => {
    for (const [id, c] of entries) {
      if (c.expected === 'answer' && c.group !== 'null-empty') {
        expect({ id, sql: Boolean(c.referenceSql) }).toEqual({ id, sql: true });
      }
    }
  });

  it('keeps every SQL on retail_ops.retail_ops objects, read-only', () => {
    for (const [id, c] of entries) {
      for (const sql of [c.referenceSql, c.naiveSql]) {
        if (!sql) continue;
        expect({ id, ok: /^(SELECT|WITH)\b/.test(sql) }).toEqual({
          id,
          ok: true,
        });
        // Every table reference is database.schema.table.
        const tables = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.]+)/gi)]
          .map((m) => m[1])
          .filter(
            (name) =>
              name.includes('.') || !['top', 'r', 'f', 't'].includes(name),
          );
        for (const table of tables) {
          expect({
            id,
            table: table.startsWith('retail_ops.retail_ops.'),
          }).toEqual({
            id,
            table: true,
          });
        }
        expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
      }
    }
  });

  it('names an existing clarify case as the twin of each clear one', () => {
    for (const [, c] of entries) {
      if (c.twinOf) {
        expect(IAR_CASES[c.twinOf]?.group).toBe('clarify');
      }
    }
    expect(entries.filter(([, c]) => c.twinOf)).toHaveLength(4);
  });

  it('gives clarification cases no SQL, and groups match their outcome', () => {
    for (const [, c] of entries) {
      if (c.expected === 'clarification') {
        expect(c.referenceSql).toBeUndefined();
        expect(c.group).toBe('clarify');
      }
      if (c.expected === 'not-covered') expect(c.group).toBe('coverage');
    }
  });
});
