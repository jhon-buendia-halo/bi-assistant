import { ScriptRequestError } from './contract';
import { emissionOrder } from './order';
import { targetNames, validateScriptRequest } from './plan';
import {
  fkCol,
  idCol,
  profile,
  rel,
  table,
  worldCupProfile,
} from './world-cup-profile.stub';

const WC = 'world_cup.public.';

const errorOf = (request: unknown, p = worldCupProfile()): string => {
  try {
    validateScriptRequest(p, request);
  } catch (e) {
    expect(e).toBeInstanceOf(ScriptRequestError);
    return (e as Error).message;
  }
  throw new Error('no error');
};

describe('validateScriptRequest: defaults', () => {
  it('fills the defaults: 100 rows, seed 1, schema synthetic, constraints on, sql', () => {
    const plan = validateScriptRequest(worldCupProfile(), {});
    expect(plan).toMatchObject({
      seed: 1,
      targetSchema: 'synthetic',
      includeConstraints: true,
      format: 'sql',
    });
    expect(plan.tables.map((t) => t.rows)).toEqual(new Array(9).fill(100));
    expect(plan.tables.map((t) => t.key)).toEqual(
      worldCupProfile().tables.map((t) => t.key),
    );
    expect(plan.relationships).toHaveLength(15);
    expect(plan.droppedRelationships).toEqual([]);
  });

  it('takes per-table row counts, the default for the rest, and the other settings', () => {
    const plan = validateScriptRequest(worldCupProfile(), {
      rowCounts: { [`${WC}goals`]: 7 },
      defaultRowCount: 20,
      seed: 0,
      targetSchema: 'copy_1',
      includeConstraints: false,
      format: 'csv',
    });
    expect(plan.tables.find((t) => t.key === `${WC}goals`)!.rows).toBe(7);
    expect(plan.tables.find((t) => t.key === `${WC}teams`)!.rows).toBe(20);
    expect(plan).toMatchObject({
      seed: 0,
      targetSchema: 'copy_1',
      includeConstraints: false,
      format: 'csv',
    });
  });
});

describe('validateScriptRequest: every error text (plan 3.2, 10)', () => {
  it.each([
    [{ format: 'json' }, 'format must be sql, csv or xlsx'],
    [{ format: 3 }, 'format must be sql, csv or xlsx'],
    [
      { defaultRowCount: 0 },
      'Row counts must be whole numbers from 1 to 10,000',
    ],
    [
      { defaultRowCount: 10001 },
      'Row counts must be whole numbers from 1 to 10,000',
    ],
    [
      { defaultRowCount: 2.5 },
      'Row counts must be whole numbers from 1 to 10,000',
    ],
    [
      { defaultRowCount: '5' },
      'Row counts must be whole numbers from 1 to 10,000',
    ],
    [{ rowCounts: [] }, 'Row counts must be whole numbers from 1 to 10,000'],
    [
      { rowCounts: { [`${WC}goals`]: -1 } },
      'Row counts must be whole numbers from 1 to 10,000',
    ],
    [{ rowCounts: { 'x.y.z': 5 } }, '"x.y.z" is not a table of this profile'],
    [{ seed: -1 }, 'seed must be a whole number from 0 to 2147483647'],
    [{ seed: 2147483648 }, 'seed must be a whole number from 0 to 2147483647'],
    [{ seed: 1.5 }, 'seed must be a whole number from 0 to 2147483647'],
    [
      { targetSchema: 'a.b' },
      'targetSchema must be a plain identifier (letters, digits, underscores)',
    ],
    [
      { targetSchema: '1abc' },
      'targetSchema must be a plain identifier (letters, digits, underscores)',
    ],
    [
      { targetSchema: 'a-b' },
      'targetSchema must be a plain identifier (letters, digits, underscores)',
    ],
    [
      { targetSchema: '' },
      'targetSchema must be a plain identifier (letters, digits, underscores)',
    ],
  ])('%j → %s', (request, message) => {
    expect(errorOf(request)).toBe(message);
  });

  it('the total limit counts the requested rows: 21 tables x 10,000 is over, 21 x 9,000 is not', () => {
    const big = profile(
      Array.from({ length: 21 }, (_, i) => table(`t${i}`, [idCol()])),
      [],
    );
    expect(errorOf({ defaultRowCount: 10000 }, big)).toBe(
      'A script holds at most 200,000 rows',
    );
    expect(() =>
      validateScriptRequest(big, { defaultRowCount: 9000 }),
    ).not.toThrow();
  });

  it('checks in order: format before rows before seed before schema', () => {
    expect(
      errorOf({ format: 'x', defaultRowCount: 0, seed: -1, targetSchema: '-' }),
    ).toBe('format must be sql, csv or xlsx');
    expect(errorOf({ defaultRowCount: 0, seed: -1, targetSchema: '-' })).toBe(
      'Row counts must be whole numbers from 1 to 10,000',
    );
    expect(errorOf({ seed: -1, targetSchema: '-' })).toBe(
      'seed must be a whole number from 0 to 2147483647',
    );
  });

  it('Databricks accepts schema or catalog.schema, with its own text', () => {
    const p = { ...worldCupProfile(), dialect: 'databricks' as const };
    expect(
      validateScriptRequest(p, { targetSchema: 'main.synthetic' }).targetSchema,
    ).toBe('main.synthetic');
    expect(
      validateScriptRequest(p, { targetSchema: 'synthetic' }).targetSchema,
    ).toBe('synthetic');
    for (const s of ['a.b.c', 'a.', '.b', 'a-b.c']) {
      expect(errorOf({ targetSchema: s }, p)).toBe(
        'targetSchema must be schema or catalog.schema (letters, digits, underscores)',
      );
    }
  });
});

describe('clamping, dropped relationships and target names', () => {
  it('clamps a table whose key is made only of FK columns to the distinct parent tuples', () => {
    // squad_members PK (tournament_team_id, player_id): 3 x 4 = 12 tuples at most.
    const plan = validateScriptRequest(worldCupProfile(), {
      defaultRowCount: 50,
      rowCounts: {
        [`${WC}tournament_teams`]: 3,
        [`${WC}players`]: 4,
        [`${WC}squad_members`]: 100,
      },
    });
    expect(
      plan.tables.find((t) => t.key === `${WC}squad_members`),
    ).toMatchObject({ rows: 12, clampedFrom: 100 });
    expect(
      plan.tables.find((t) => t.key === `${WC}players`)!.clampedFrom,
    ).toBeUndefined();
  });

  it('clamps along a chain: a single-column unique FK cannot exceed its parent', () => {
    // teams.country_code is UNIQUE and references countries.code.
    const plan = validateScriptRequest(worldCupProfile(), {
      rowCounts: { [`${WC}countries`]: 5 },
    });
    expect(plan.tables.find((t) => t.key === `${WC}teams`)).toMatchObject({
      rows: 5,
      clampedFrom: 100,
    });
  });

  it('lists relationships whose parent is not in the profile as dropped', () => {
    const p = worldCupProfile();
    p.relationships.push(rel('goals', ['assist_player_id'], 'unknown_table'));
    p.tables
      .find((t) => t.name === 'goals')!
      .columns.push(fkCol('assist_player_id', true));
    const plan = validateScriptRequest(p, {});
    expect(plan.droppedRelationships).toEqual([
      rel('goals', ['assist_player_id'], 'unknown_table'),
    ]);
    expect(plan.relationships).toHaveLength(15);
  });

  it('renames tables that share a name across schemas to <schema>_<table>', () => {
    const a = {
      ...table('items', [idCol()]),
      key: 'db.sales.items',
      namespace: 'sales',
    };
    const b = {
      ...table('items', [idCol()]),
      key: 'db.stock.items',
      namespace: 'stock',
    };
    const c = {
      ...table('other', [idCol()]),
      key: 'db.sales.other',
      namespace: 'sales',
    };
    const d = {
      ...table('items', [idCol()]),
      key: 'c.s.items',
      namespace: 'cat.sch',
    };
    expect([...targetNames(profile([a, b, c, d], [])).entries()]).toEqual([
      ['db.sales.items', 'sales_items'],
      ['db.stock.items', 'stock_items'],
      ['db.sales.other', 'other'],
      ['c.s.items', 'cat_sch_items'],
    ]);
    expect(
      validateScriptRequest(profile([a, b], []), {}).tables.map(
        (t) => t.targetName,
      ),
    ).toEqual(['sales_items', 'stock_items']);
  });
});

describe('emissionOrder', () => {
  it('puts parents before children, ties by key', () => {
    const order = emissionOrder(
      worldCupProfile().tables.map((t) => t.key),
      worldCupProfile().relationships,
    ).map((k) => k.slice(WC.length));
    expect(order).toEqual([
      'confederations',
      'countries',
      'teams',
      'players',
      'tournaments',
      'matches',
      'goals',
      'tournament_teams',
      'squad_members',
    ]);
  });

  it('emits a 2-table cycle in key order after the rest; ignores self-references', () => {
    const order = emissionOrder(
      ['z', 'b', 'a', 'root'],
      [
        {
          fromTable: 'a',
          fromColumns: ['b_id'],
          toTable: 'b',
          toColumns: ['id'],
          origin: 'declared',
        },
        {
          fromTable: 'b',
          fromColumns: ['a_id'],
          toTable: 'a',
          toColumns: ['id'],
          origin: 'declared',
        },
        {
          fromTable: 'z',
          fromColumns: ['root_id'],
          toTable: 'root',
          toColumns: ['id'],
          origin: 'declared',
        },
        {
          fromTable: 'root',
          fromColumns: ['parent_id'],
          toTable: 'root',
          toColumns: ['id'],
          origin: 'declared',
        },
      ],
    );
    expect(order).toEqual(['root', 'z', 'a', 'b']);
  });
});
