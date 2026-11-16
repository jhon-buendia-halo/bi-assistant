// Generator properties (plan 6, U-GEN): determinism, stream isolation, distributions,
// FK integrity (composite, cycle, self-reference), clamping, unique-range, privacy.

import type { SyntheticValue } from '../dialects/writer';
import { buildSampledProfile } from '../profile/build-sampled-profile';
import type { SampledProfile } from '../types';
import type { GeneratedTable } from './contract';
import { generateTables, valueKey } from './generate';
import { validateScriptRequest } from './plan';
import {
  column,
  fkCol,
  idCol,
  profile,
  rel,
  table,
  worldCupProfile,
} from './world-cup-profile.stub';

const WC = 'world_cup.public.';

function run(
  request: Record<string, unknown>,
  p: SampledProfile = worldCupProfile(),
): Map<string, GeneratedTable> {
  const plan = validateScriptRequest(p, request);
  return new Map([...generateTables(p, plan)].map((t) => [t.key, t]));
}

const col = (t: GeneratedTable, name: string): SyntheticValue[] => {
  const j = t.columns.findIndex((c) => c.name === name);
  if (j < 0) throw new Error(`no column ${name}`);
  return t.rows.map((r) => r[j]);
};

const text = (v: SyntheticValue): string => {
  if (v === null || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v;
  return 'text' in v ? v.text : v.kind;
};

const tuples = (t: GeneratedTable, names: string[]): string[] =>
  t.rows.map((r) =>
    names
      .map((n) => valueKey(r[t.columns.findIndex((c) => c.name === n)]))
      .join('|'),
  );

const fraction = (
  values: SyntheticValue[],
  pred: (v: SyntheticValue) => boolean,
): number => values.filter(pred).length / values.length;

describe('determinism', () => {
  it('the same profile and request give the same rows; another seed gives other rows', () => {
    const dump = (seed: number): string =>
      JSON.stringify(
        [...run({ defaultRowCount: 40, seed }).values()].map((t) => [
          t.key,
          t.rows,
        ]),
      );
    expect(dump(1)).toBe(dump(1));
    expect(dump(2)).not.toBe(dump(1));
  });
});

describe('stream isolation', () => {
  it('adding a table and a column leaves every other column identical', () => {
    const base = run({ defaultRowCount: 60 });
    const p = worldCupProfile();
    p.tables.push(
      table('extra', [
        idCol(),
        column('label', 'text', { patterns: [{ shape: 'Aaaa', fraction: 1 }] }),
      ]),
    );
    p.relationships.push(rel('extra', ['id'], 'teams'));
    p.tables
      .find((t) => t.name === 'goals')!
      .columns.splice(
        2,
        0,
        column('added', 'text', { patterns: [{ shape: '999', fraction: 1 }] }),
      );
    const more = run({ defaultRowCount: 60 }, p);
    for (const [key, t] of base) {
      for (const c of t.columns) {
        expect(col(more.get(key)!, c.name)).toEqual(col(t, c.name));
      }
    }
  });
});

describe('keys on the World Cup-like profile', () => {
  const tables = run({ defaultRowCount: 50 });

  it('keeps every primary key and unique key distinct, and never NULL', () => {
    for (const t of tables.values()) {
      for (const k of [t.primaryKey, ...t.uniqueKeys].filter(
        (x) => x.length > 0,
      )) {
        const ts = tuples(t, k);
        expect(new Set(ts).size).toBe(ts.length);
        for (const c of k) expect(col(t, c)).not.toContain(null);
      }
    }
  });

  it('fits text keys into a declared char(3)', () => {
    for (const v of col(tables.get(`${WC}countries`)!, 'code'))
      expect(text(v)).toHaveLength(3);
    for (const v of col(tables.get(`${WC}teams`)!, 'fifa_code'))
      expect(text(v).length).toBeLessThanOrEqual(3);
  });

  it('draws every FK value (and composite FK tuple) from the parent keys', () => {
    const p = worldCupProfile();
    for (const r of p.relationships) {
      const parent = new Set(tuples(tables.get(r.toTable)!, r.toColumns));
      const child = tables.get(r.fromTable)!;
      const j = r.fromColumns.map((c) =>
        child.columns.findIndex((x) => x.name === c),
      );
      for (const row of child.rows) {
        if (j.some((i) => row[i] === null)) continue;
        expect(parent.has(j.map((i) => valueKey(row[i])).join('|'))).toBe(true);
      }
    }
  });

  it('applies the null rate of a nullable FK and never NULLs a NOT NULL one', () => {
    const big = run({ defaultRowCount: 2000 });
    const winner = col(big.get(`${WC}matches`)!, 'winner_team_id');
    expect(Math.abs(fraction(winner, (v) => v === null) - 0.25)).toBeLessThan(
      0.03,
    );
    expect(col(big.get(`${WC}matches`)!, 'home_team_id')).not.toContain(null);
  });
});

describe('composite keys, cycles and self-references', () => {
  it('a composite FK draws whole parent tuples', () => {
    const parent = table(
      'pairs',
      [
        column('a', 'integer', {
          semanticType: 'numeric',
          nullable: false,
          kind: 'identifier',
          strategy: 'unique-range',
          numeric: {
            min: 10,
            max: 200,
            mean: 0,
            quantiles: [],
            integer: true,
            scale: 0,
          },
        }),
        column('b', 'text', {
          nullable: false,
          kind: 'identifier',
          strategy: 'unique-pattern',
          patterns: [{ shape: 'AA', fraction: 1 }],
        }),
      ],
      ['a', 'b'],
    );
    const child = table('refs', [
      idCol(),
      fkCol('pa', true, 0.2),
      column('pb', 'text', {
        kind: 'identifier',
        strategy: 'foreign-key',
        nullable: true,
        nullFraction: 0.2,
      }),
    ]);
    const p = profile(
      [parent, child],
      [rel('refs', ['pa', 'pb'], 'pairs', ['a', 'b'])],
    );
    const out = run({ defaultRowCount: 300 }, p);
    const keys = new Set(tuples(out.get(`${WC}pairs`)!, ['a', 'b']));
    const refs = out.get(`${WC}refs`)!;
    let nulls = 0;
    for (const r of refs.rows) {
      if (r[1] === null || r[2] === null) {
        expect(r[1]).toBeNull();
        expect(r[2]).toBeNull();
        nulls++;
        continue;
      }
      expect(keys.has(`${valueKey(r[1])}|${valueKey(r[2])}`)).toBe(true);
    }
    expect(nulls).toBeGreaterThan(0);
  });

  it('a 2-table cycle and a self-reference draw from existing keys', () => {
    const a = table('a', [idCol(), fkCol('b_id', true, 0.1)]);
    const b = table('b', [idCol(), fkCol('a_id', false)]);
    const emp = table('emp', [idCol(), fkCol('manager_id', true, 0.3)]);
    const p = profile(
      [a, b, emp],
      [
        rel('a', ['b_id'], 'b'),
        rel('b', ['a_id'], 'a'),
        rel('emp', ['manager_id'], 'emp'),
      ],
    );
    const out = run(
      { rowCounts: { [`${WC}a`]: 30, [`${WC}b`]: 7, [`${WC}emp`]: 25 } },
      p,
    );
    const ids = (k: string): Set<string> =>
      new Set(col(out.get(WC + k)!, 'id').map(valueKey));
    const within = (k: string, c: string, parent: string): void => {
      const keys = ids(parent);
      for (const v of col(out.get(WC + k)!, c))
        if (v !== null) expect(keys.has(valueKey(v))).toBe(true);
    };
    within('a', 'b_id', 'b');
    within('b', 'a_id', 'a');
    within('emp', 'manager_id', 'emp');
    expect([...out.keys()]).toEqual([`${WC}emp`, `${WC}a`, `${WC}b`]);
  });

  it('a composite PK of FK columns draws distinct tuples and clamps to the possible ones', () => {
    const out = run({
      defaultRowCount: 50,
      rowCounts: {
        [`${WC}tournament_teams`]: 3,
        [`${WC}players`]: 4,
        [`${WC}squad_members`]: 100,
      },
    });
    const sm = out.get(`${WC}squad_members`)!;
    expect(sm.rows).toHaveLength(12);
    expect(sm.clampedFrom).toBe(100);
    expect(new Set(tuples(sm, ['tournament_team_id', 'player_id'])).size).toBe(
      12,
    );
  });
});

describe('unique-range (plan 10)', () => {
  const years = (rows: number): number[] =>
    col(
      run({
        defaultRowCount: 10,
        rowCounts: { [`${WC}tournaments`]: rows },
      }).get(`${WC}tournaments`)!,
      'tournament_year',
    ).map((v) => Number(text(v)));

  it('draws distinct integers inside the observed range', () => {
    const ys = years(3);
    expect(new Set(ys).size).toBe(3);
    for (const y of ys) expect(y >= 2018 && y <= 2022).toBe(true);
    expect(years(5).sort()).toEqual([2018, 2019, 2020, 2021, 2022]);
  });

  it('falls back to a sequence from the observed minimum when the range is too small', () => {
    expect(years(8)).toEqual([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  });
});

describe('distributions on 10,000 rows', () => {
  const t = table('dist', [
    idCol(),
    column('stage', 'text', {
      kind: 'categorical',
      strategy: 'categorical',
      nullFraction: 0.1,
      topValues: [
        { value: 'group', fraction: 0.6 },
        { value: 'final', fraction: 0.3 },
      ],
      otherFraction: 0.1,
      patterns: [{ shape: 'Aa{3,5}', fraction: 1 }],
    }),
    column('amount', 'numeric(8,2)', {
      semanticType: 'numeric',
      kind: 'numeric',
      strategy: 'numeric-range',
      nullFraction: 0.25,
      numeric: {
        min: 5,
        max: 900,
        mean: 100,
        quantiles: [5, 10, 20, 30, 40, 50, 60, 80, 120, 300, 900],
        integer: false,
        scale: 2,
      },
    }),
    column('at', 'timestamp', {
      semanticType: 'temporal',
      kind: 'temporal',
      strategy: 'temporal-range',
      temporal: {
        min: '2020-01-01T00:00:00.000Z',
        max: '2021-01-01T00:00:00.000Z',
        quantiles: Array.from({ length: 11 }, (_, i) =>
          new Date(Date.UTC(2020, 0, 1) + i * 3_162_240_000).toISOString(),
        ),
        granularity: 'second',
      },
    }),
    column('flag', 'boolean', {
      semanticType: 'boolean',
      kind: 'boolean',
      strategy: 'boolean-rate',
      boolean: { trueFraction: 0.35 },
      nullFraction: 0.05,
    }),
    column('strict', 'integer', {
      semanticType: 'numeric',
      kind: 'numeric',
      strategy: 'numeric-range',
      nullable: false,
      nullFraction: 0.5,
      numeric: {
        min: 1,
        max: 3,
        mean: 2,
        quantiles: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
        integer: true,
        scale: 0,
      },
    }),
    column('email', 'varchar(40)', {
      kind: 'formatted',
      strategy: 'format-template',
      formatRule: 'email',
    }),
    column('phone', 'text', {
      kind: 'formatted',
      strategy: 'format-template',
      formatRule: 'phone',
    }),
    column('site', 'text', {
      kind: 'formatted',
      strategy: 'format-template',
      formatRule: 'url',
    }),
    column('when_text', 'text', {
      kind: 'formatted',
      strategy: 'format-template',
      formatRule: 'date-string',
    }),
    column('blob', 'jsonb', {
      semanticType: 'json',
      kind: 'unsupported',
      strategy: 'null-only',
    }),
    column('arr', 'jsonb', {
      semanticType: 'json',
      kind: 'unsupported',
      strategy: 'constant',
      nullable: false,
    }),
  ]);
  const out = run({ defaultRowCount: 10000 }, profile([t], [])).get(
    `${WC}dist`,
  )!;

  it('null rates within 2 pp', () => {
    expect(
      Math.abs(fraction(col(out, 'stage'), (v) => v === null) - 0.1),
    ).toBeLessThan(0.02);
    expect(
      Math.abs(fraction(col(out, 'amount'), (v) => v === null) - 0.25),
    ).toBeLessThan(0.02);
    expect(
      Math.abs(fraction(col(out, 'flag'), (v) => v === null) - 0.05),
    ).toBeLessThan(0.02);
    expect(col(out, 'strict')).not.toContain(null);
  });

  it('categorical fractions within 3 pp of the non-null values; the rest from the pattern', () => {
    const nonNull = col(out, 'stage').filter((v) => v !== null);
    expect(
      Math.abs(fraction(nonNull, (v) => v === 'group') - 0.6),
    ).toBeLessThan(0.03);
    expect(
      Math.abs(fraction(nonNull, (v) => v === 'final') - 0.3),
    ).toBeLessThan(0.03);
    const other = nonNull.filter((v) => v !== 'group' && v !== 'final');
    expect(Math.abs(other.length / nonNull.length - 0.1)).toBeLessThan(0.03);
    for (const v of other) expect(text(v)).toMatch(/^[A-Z][a-z]{3,5}$/);
  });

  it('numeric values within [p0, p100] at the observed scale, following the deciles', () => {
    const xs = col(out, 'amount')
      .filter((v) => v !== null)
      .map(text);
    for (const x of xs) {
      expect(x).toMatch(/^\d+\.\d{2}$/);
      expect(Number(x) >= 5 && Number(x) <= 900).toBe(true);
    }
    const below60 = xs.filter((x) => Number(x) <= 60).length / xs.length;
    expect(Math.abs(below60 - 0.6)).toBeLessThan(0.03);
    for (const v of col(out, 'strict'))
      expect(['1', '2', '3']).toContain(text(v));
  });

  it('temporal values within the range, at second granularity', () => {
    for (const v of col(out, 'at')) {
      if (v === null) continue;
      expect(v).toMatchObject({ kind: 'timestamp', zoned: false });
      const s = text(v);
      expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(s >= '2020-01-01 00:00:00' && s <= '2021-01-01 00:00:00').toBe(
        true,
      );
    }
  });

  it('booleans at the true fraction within 2 pp', () => {
    const bs = col(out, 'flag').filter((v) => v !== null);
    expect(Math.abs(fraction(bs, (v) => v === true) - 0.35)).toBeLessThan(0.02);
  });

  it('format templates use reserved example domains and numbers', () => {
    expect(col(out, 'email').filter((v) => v !== null)[0]).toMatch(
      /^user\d+@example\.com$/,
    );
    for (const v of col(out, 'phone'))
      if (v !== null) expect(v).toMatch(/^\+1-555-01\d{2}-\d{4}$/);
    for (const v of col(out, 'site'))
      if (v !== null) expect(v).toMatch(/^https:\/\/example\.com\/[a-z]{8}$/);
    for (const v of col(out, 'when_text'))
      if (v !== null) expect(v).toMatch(/^20[0-3]\d-\d{2}-\d{2}$/);
  });

  it('null-only gives NULL and constant the neutral literal', () => {
    expect(new Set(col(out, 'blob'))).toEqual(new Set([null]));
    for (const v of col(out, 'arr')) expect(v).toEqual({ kind: 'neutral' });
  });
});

describe('privacy: generated text never reuses a non-categorical sampled value', () => {
  // Caveat (plan 7): a pattern-filled value can match a sampled value by chance when the
  // shape is very short (e.g. 2-letter codes that were not categorical). This fixture's
  // free-text values are long enough that a chance match is negligible.
  const first = [
    'Lionel',
    'Cristiano',
    'Kylian',
    'Neymar',
    'Harry',
    'Luka',
    'Kevin',
    'Robert',
    'Mohamed',
    'Virgil',
  ];
  const last = [
    'Messi',
    'Ronaldo',
    'Mbappe',
    'Santos',
    'Kane',
    'Modric',
    'Bruyne',
    'Lewandowski',
    'Salah',
    'Dijk',
  ];
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: String(i + 1),
    full_name: `${first[i % 10]} ${last[Math.floor(i / 10) % 10]} ${i}`,
    venue: `Estadio ${last[i % 10]} ${first[(i * 7) % 10]} Arena ${i}`,
    bio: `${first[i % 10]} played for many seasons and scored in the final against ${last[(i + 3) % 10]} at minute ${i % 90}`,
    position: ['GK', 'DF', 'MF', 'FW'][i % 4],
    email: `${first[i % 10].toLowerCase()}.${i}@club.example.org`,
  }));
  const built = buildSampledProfile({
    dataset: { name: 'World Cup' },
    datasource: { id: 'd', name: 'D', kind: 'postgres' },
    tables: [
      {
        key: `${WC}players`,
        table: {
          schema: 'public',
          table: 'players',
          columns: [
            { name: 'id', type: 'bigint', nullable: false },
            { name: 'full_name', type: 'text', nullable: false },
            { name: 'venue', type: 'text', nullable: true },
            { name: 'bio', type: 'text', nullable: true },
            { name: 'position', type: 'text', nullable: true },
            { name: 'email', type: 'text', nullable: true },
          ],
        },
        sample: { rowCountEstimate: 1000, method: 'full', rows, durationMs: 1 },
      },
    ],
    keys: [
      { schema: 'public', table: 'players', kind: 'primary', columns: ['id'] },
    ],
    foreignKeys: [],
    sampleSize: 1000,
    now: new Date('2026-11-11T10:00:00.000Z'),
  });
  const p: SampledProfile = { ...built, profileId: 'p' };
  const out = run({ defaultRowCount: 1000 }, p).get(`${WC}players`)!;

  it('classifies the fixture as expected', () => {
    const s = Object.fromEntries(
      p.tables[0].columns.map((c) => [c.name, c.strategy]),
    );
    expect(s).toMatchObject({
      id: 'sequence',
      full_name: 'unique-pattern',
      venue: 'unique-pattern',
      bio: 'words',
      position: 'categorical',
      email: 'format-template',
    });
  });

  it('no generated value of a non-categorical text column equals a sampled value', () => {
    for (const name of ['full_name', 'venue', 'bio', 'email']) {
      const sampled = new Set(
        rows.map((r) => r[name as keyof (typeof rows)[0]]),
      );
      for (const v of col(out, name))
        if (v !== null) expect(sampled.has(text(v))).toBe(false);
    }
  });

  it('no sampled name appears inside any generated value', () => {
    const all = out.rows.flat().map(text).join('\n');
    for (const n of [...first, ...last]) expect(all.includes(n)).toBe(false);
  });

  it('categorical columns reuse only their topValues', () => {
    for (const v of col(out, 'position'))
      if (v !== null) expect(['GK', 'DF', 'MF', 'FW']).toContain(v);
  });
});
