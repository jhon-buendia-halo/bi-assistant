import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type {
  QueryEvidence,
  QueryStep,
} from '../../modules/sessions/query-evidence/query-evidence.types';
import {
  checkStageCounts,
  explainRequest,
  explanationOf,
  fallbackExplanation,
  foreignTable,
  sampleExplanation,
  showStep,
  type StageCountInput,
} from './query-explainer.prompts';

const SQL =
  'SELECT product, COUNT(*) AS n FROM shop.public.returns GROUP BY product ORDER BY n DESC LIMIT 100';
const record: ToolDataRecord = {
  tool: 'run_readonly_sql',
  input: SQL,
  columns: ['product', 'n'],
  rows: [{ product: 'SECRET-ROW-VALUE', n: 9 }],
  rowCount: 100,
  rationale: 'Which products come back most',
};
const evidence: QueryEvidence = {
  index: 0,
  coverage: 'top-n',
  outerLimit: 100,
  totalRows: 100,
  datasourceKind: 'postgres',
  tables: [{ entity: 'shop.public.returns', rows: 48912 }],
};

const step = (verb: QueryStep['verb'], extra: Partial<QueryStep> = {}) => ({
  verb,
  text: verb,
  ...extra,
});

function input(
  counts: (number | undefined)[],
  patch: Partial<StageCountInput> = {},
): StageCountInput {
  return {
    steps: [
      step('start', { table: 'shop.public.returns', countSql: 'select 1' }),
      step('keep', { countSql: 'select 1' }),
      step('sort', { countSql: 'select 1' }),
      step('group', { countSql: 'select 1' }),
    ],
    counts,
    tables: evidence.tables!,
    outerLimit: 100,
    totalRows: 100,
    rowCount: 100,
    ...patch,
  };
}

describe('checkStageCounts (plan 3f)', () => {
  it('verifies 48,912 -> 11,306 -> 11,306 -> 1,870 with a limit of 100', () => {
    expect(checkStageCounts(input([48912, 11306, 11306, 1870]))).toEqual({
      status: 'verified',
    });
  });

  it('rejects a wrong start count', () => {
    const r = checkStageCounts(input([48911, 11306, 11306, 1870]));
    expect(r.status).toBe('unverified');
  });

  it('rejects a wrong final count', () => {
    const r = checkStageCounts(input([48912, 11306, 11306, 50]));
    expect(r).toMatchObject({ status: 'unverified' });
  });

  it('rejects a keep step with no countSql', () => {
    const base = input([48912, undefined, 11306, 1870]);
    base.steps = base.steps.map((s) =>
      s.verb === 'keep' ? { ...s, countSql: undefined } : s,
    );
    expect(checkStageCounts(base)).toMatchObject({ status: 'unverified' });
  });

  it('rejects a count that is not a whole number of 0 or more', () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity]) {
      expect(checkStageCounts(input([48912, bad, bad, 1870])).status).toBe(
        'unverified',
      );
    }
  });

  it('rejects a sort or compute that changes the count', () => {
    expect(checkStageCounts(input([48912, 11306, 11000, 1870])).status).toBe(
      'unverified',
    );
  });

  it('rejects a keep or group that raises the count', () => {
    expect(checkStageCounts(input([48912, 50000, 50000, 1870])).status).toBe(
      'unverified',
    );
    expect(checkStageCounts(input([48912, 11306, 11306, 20000])).status).toBe(
      'unverified',
    );
  });

  it('lets add and combine raise the count', () => {
    const r = checkStageCounts({
      steps: [
        step('start', { table: 'shop.public.returns', countSql: 's' }),
        step('combine', { countSql: 's' }),
        step('add', { countSql: 's' }),
      ],
      counts: [48912, 60000, 70000],
      tables: evidence.tables!,
      totalRows: 70000,
      rowCount: 100,
    });
    expect(r.status).toBe('verified');
  });

  it('falls back to the rows kept when the total is unknown, and refuses when cut', () => {
    const base = { totalRows: undefined, outerLimit: undefined };
    const counts = [48912, 11306, 11306, 37];
    expect(
      checkStageCounts(input(counts, { ...base, rowCount: 37 })).status,
    ).toBe('verified');
    expect(
      checkStageCounts(
        input(counts, { ...base, rowCount: 37, truncated: true }),
      ).status,
    ).toBe('unverified');
  });

  it('refuses a start whose table size is unknown', () => {
    expect(
      checkStageCounts(
        input([48912, 11306, 11306, 1870], {
          tables: [{ entity: 'shop.public.returns', rows: null }],
        }),
      ).status,
    ).toBe('unverified');
  });
});

describe('explanationOf', () => {
  const reply = (steps: unknown[]) => ({ steps });

  it('drops a show step the model wrote and adds the code-built one', () => {
    const e = explanationOf(
      reply([
        { verb: 'start', text: 'Begin', table: 'returns' },
        { verb: 'show', text: 'Show 3 rows' },
        { verb: 'limit', text: 'Limit' },
      ]),
      record,
      evidence,
    );
    expect(e.steps.map((s) => s.verb)).toEqual(['start', 'show']);
    expect(e.steps[1].text).toBe('Show the first 100');
    expect(e.fallback).toBeUndefined();
  });

  it('turns an unknown verb into compute and puts a missing start first', () => {
    const e = explanationOf(
      reply([{ verb: 'frobnicate', text: 'Do a thing' }]),
      record,
      evidence,
    );
    expect(e.steps.map((s) => s.verb)).toEqual(['start', 'compute', 'show']);
    expect(e.steps[0]).toMatchObject({
      table: 'shop.public.returns',
      rows: 48912,
    });
  });

  it('moves a start that is not first to the front', () => {
    const e = explanationOf(
      reply([
        { verb: 'keep', text: 'Keep some' },
        { verb: 'start', text: 'Begin', table: 'shop.public.returns' },
      ]),
      record,
      evidence,
    );
    expect(e.steps.map((s) => s.verb)).toEqual(['start', 'keep', 'show']);
  });

  it('drops a countSql that is not a select, has a semicolon or is too long', () => {
    const e = explanationOf(
      reply([
        { verb: 'start', text: 'a', table: 'shop.public.returns' },
        { verb: 'keep', text: 'b', countSql: 'DELETE FROM x' },
        { verb: 'keep', text: 'c', countSql: 'select 1; select 2' },
        { verb: 'keep', text: 'd', countSql: `select ${'1'.repeat(4000)}` },
        { verb: 'keep', text: 'e', countSql: 'WITH t AS (select 1) select 1' },
      ]),
      record,
      evidence,
    );
    const sqls = e.steps.map((s) => s.countSql);
    expect(sqls[1]).toBeUndefined();
    expect(sqls[2]).toBeUndefined();
    expect(sqls[3]).toBeUndefined();
    expect(sqls[4]).toBe('WITH t AS (select 1) select 1');
  });

  it('keeps at most 8 steps before Show, with text of at most 160 characters', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      verb: i === 0 ? 'start' : 'keep',
      text: 'x'.repeat(300),
    }));
    const e = explanationOf(reply(many), record, evidence);
    expect(e.steps).toHaveLength(9);
    expect(e.steps[0].text).toHaveLength(160);
  });

  it('stores the code-built steps with fallback when the reply is no JSON object', () => {
    for (const bad of ['Sorry, I cannot', undefined, '[1,2]', '{"steps":[]}']) {
      const e = explanationOf(bad, record, evidence);
      expect(e.fallback).toBe(true);
      expect(e.steps.map((s) => s.verb)).toEqual(['start', 'show']);
    }
  });

  it('reads a JSON object inside text', () => {
    const e = explanationOf(
      `Here: ${JSON.stringify(reply([{ verb: 'start', text: 'a', table: 'returns' }]))}`,
      record,
      evidence,
    );
    expect(e.fallback).toBeUndefined();
    expect(e.steps[0].table).toBe('shop.public.returns');
  });
});

describe('showStep and the code-built explanations', () => {
  it.each([
    [
      { coverage: 'top-n', outerLimit: 100 },
      100,
      'Show the first 100',
      '(LIMIT 100: only the list is shortened)',
    ],
    [
      { coverage: 'sample', outerLimit: 100 },
      100,
      'Show 100 rows in no set order',
      '(LIMIT 100 without a sort: a sample, not the top 100)',
    ],
    [
      { coverage: 'partial', rowLimit: 500 },
      500,
      'Show the first 500',
      '(the query tool stops at 500 rows: the rest of the result was not read)',
    ],
    [{ coverage: 'whole-table' }, 37, 'Show all 37 rows', undefined],
    [{ coverage: 'whole-table' }, 1, 'Show the 1 row', undefined],
  ] as const)('%j', (patch, rows, text, note) => {
    const s = showStep(
      { index: 0, ...patch },
      {
        tool: 'run_readonly_sql',
        rowCount: rows,
      },
    );
    expect(s).toMatchObject({ verb: 'show', text, rows });
    expect(s.note).toBe(note);
  });

  it('explains a sample_rows record by code, with no fallback flag', () => {
    const e = sampleExplanation(
      { tool: 'sample_rows', input: 'shop.public.returns', rowCount: 10 },
      { index: 1, coverage: 'sample', tables: evidence.tables },
    );
    expect(e.fallback).toBeUndefined();
    expect(e.steps[0]).toMatchObject({ verb: 'start', rows: 48912 });
    expect(e.steps[1]).toMatchObject({
      verb: 'show',
      text: 'Show 10 sample rows',
    });
  });

  it('builds the fallback from the first table', () => {
    const e = fallbackExplanation(record, evidence);
    expect(e.fallback).toBe(true);
    expect(e.steps[0].table).toBe('shop.public.returns');
  });
});

describe('explainRequest', () => {
  it('holds the dialect, rationale, tables, columns and SQL, never a row', () => {
    const text = explainRequest(record, evidence);
    expect(text).toContain('PostgreSQL');
    expect(text).toContain('Which products come back most');
    expect(text).toContain('shop.public.returns: 48912 rows');
    expect(text).toContain('product, n');
    expect(text).toContain(SQL);
    expect(text).not.toContain('SECRET-ROW-VALUE');
  });
});

describe('foreignTable', () => {
  const entities = ['shop.public.returns', 'shop.public.products'];
  it('accepts the tables the query reads, by any of their names', () => {
    expect(
      foreignTable(
        'SELECT COUNT(*) FROM "public"."returns" r JOIN products p ON p.id = r.p',
        entities,
      ),
    ).toBeUndefined();
    expect(
      foreignTable('SELECT COUNT(*) AS n FROM shop.public.returns', entities),
    ).toBeUndefined();
  });
  it('accepts a CTE and EXTRACT(... FROM column)', () => {
    expect(
      foreignTable(
        'WITH t AS (SELECT * FROM returns) SELECT COUNT(*) FROM t WHERE extract(year from d) = 2025',
        entities,
      ),
    ).toBeUndefined();
  });
  it('names a table the query does not read', () => {
    expect(
      foreignTable('SELECT COUNT(*) FROM shop.public.users', entities),
    ).toBe('shop.public.users');
    expect(
      foreignTable(
        'SELECT COUNT(*) FROM returns r JOIN secrets s ON s.id = r.id',
        entities,
      ),
    ).toBe('secrets');
  });
});
