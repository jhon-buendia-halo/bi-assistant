import { buildSampledProfile, type ProfileTableInput } from './build-sampled-profile';
import type { SampledColumn, SampledProfile } from '../types';

const NOW = new Date('2026-11-11T10:00:00.000Z');

type Row = Record<string, string | null>;
type Col = { name: string; type: string; nullable?: boolean };

function table(
  name: string,
  columns: Col[],
  rows: Row[],
  over: Partial<ProfileTableInput['sample']> = {},
  schema = 'public',
): ProfileTableInput {
  return {
    key: `db.${schema}.${name}`,
    table: {
      schema,
      table: name,
      columns: columns.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable ?? true })),
    },
    sample: {
      rowCountEstimate: rows.length,
      method: 'full',
      rows,
      durationMs: 5,
      ...over,
    },
  };
}

function build(
  tables: ProfileTableInput[],
  extra: Partial<Parameters<typeof buildSampledProfile>[0]> = {},
): Omit<SampledProfile, 'profileId'> {
  return buildSampledProfile({
    dataset: { name: 'ds' },
    datasource: { id: 'd1', name: 'DS', kind: 'postgres' },
    tables,
    keys: [],
    foreignKeys: [],
    sampleSize: 1000,
    now: NOW,
    ...extra,
  });
}

function col(p: Omit<SampledProfile, 'profileId'>, name: string, t = 0): SampledColumn {
  const c = p.tables[t].columns.find((x) => x.name === name);
  if (!c) throw new Error(`no column ${name}`);
  return c;
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('buildSampledProfile: envelope', () => {
  it('stamps version, dialect, ids and the 60 minute expiry from `now`', () => {
    const p = build([table('t', [{ name: 'a', type: 'text' }], [{ a: 'x' }])]);
    expect(p.version).toBe(1);
    expect(p.dialect).toBe('postgres');
    expect(p.datasetName).toBe('ds');
    expect(p.datasourceId).toBe('d1');
    expect(p.generatedAt).toBe('2026-11-11T10:00:00.000Z');
    expect(p.expiresAt).toBe('2026-11-11T11:00:00.000Z');
    expect(p.sampleSize).toBe(1000);
    expect(p.tables[0]).toMatchObject({ namespace: 'public', name: 't', sampledRows: 1, method: 'full' });
  });

  it('is deterministic', () => {
    const t = table('t', [{ name: 'a', type: 'text' }], range(40).map((i) => ({ a: `v${i % 7}` })));
    expect(JSON.stringify(build([t]))).toBe(JSON.stringify(build([t])));
  });
});

describe('classification rules (first match wins)', () => {
  it('1. unsupported: json/other/interval, null-only when nullable else constant', () => {
    const p = build([
      table(
        't',
        [
          { name: 'j', type: 'jsonb' },
          { name: 'arr', type: 'integer[]', nullable: false },
          { name: 'iv', type: 'interval' },
        ],
        [{ j: '{}', arr: '{1}', iv: '1 day' }],
      ),
    ]);
    expect(col(p, 'j')).toMatchObject({ kind: 'unsupported', strategy: 'null-only' });
    expect(col(p, 'j').note).toBe('Type not synthesized: generated as NULL');
    expect(col(p, 'arr')).toMatchObject({ kind: 'unsupported', strategy: 'constant' });
    expect(col(p, 'iv')).toMatchObject({ kind: 'unsupported', strategy: 'null-only' });
  });

  it('1. unsupported on Databricks: struct, map, binary', () => {
    const p = build(
      [table('t', [{ name: 's', type: 'struct<a:int>' }, { name: 'b', type: 'binary' }], [{ s: 'x', b: 'y' }])],
      { datasource: { id: 'd', name: 'D', kind: 'databricks' } },
    );
    expect(col(p, 's').kind).toBe('unsupported');
    expect(col(p, 'b').kind).toBe('unsupported');
  });

  it('2. identifier by primary key, unique key, name pattern and uuid type; never categorical', () => {
    const rows = range(30).map((i) => ({
      pk: String(i % 2), // 2 distinct values, would be categorical if it were not a key
      u: `u${i % 3}`,
      user_id: String(i % 4),
      guid_x: `g${i % 2}`,
      anyid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      other: `o${i % 3}`,
    }));
    const p = build(
      [
        table(
          't',
          [
            { name: 'pk', type: 'integer', nullable: false },
            { name: 'u', type: 'text' },
            { name: 'user_id', type: 'bigint' },
            { name: 'guid_x', type: 'text' },
            { name: 'anyid', type: 'uuid' },
            { name: 'other', type: 'text' },
          ],
          rows,
        ),
      ],
      {
        keys: [
          { schema: 'public', table: 't', kind: 'primary', columns: ['pk'] },
          { schema: 'public', table: 't', kind: 'unique', columns: ['u'] },
        ],
      },
    );
    expect(col(p, 'pk')).toMatchObject({ kind: 'identifier', strategy: 'sequence' });
    expect(col(p, 'u')).toMatchObject({ kind: 'identifier', strategy: 'unique-pattern' });
    expect(col(p, 'user_id')).toMatchObject({ kind: 'identifier', strategy: 'sequence' });
    expect(col(p, 'guid_x')).toMatchObject({ kind: 'identifier' });
    expect(col(p, 'anyid')).toMatchObject({ kind: 'identifier', strategy: 'uuid' });
    expect(col(p, 'other')).toMatchObject({ kind: 'categorical' });
    expect(col(p, 'u').topValues).toBeUndefined();
    expect(col(p, 'pk').topValues).toBeUndefined();
    expect(p.tables[0].primaryKey).toEqual(['pk']);
    expect(p.tables[0].uniqueKeys).toEqual([['u']]);
  });

  it('2. identifier by distinct ratio >= 0.95 with >= 50 non-null values, not below', () => {
    const many = range(60).map((i) => ({ code: `c${i}` }));
    const few = range(49).map((i) => ({ code: `c${i}` }));
    expect(col(build([table('t', [{ name: 'code', type: 'text' }], many)]), 'code').kind).toBe('identifier');
    expect(col(build([table('t', [{ name: 'code', type: 'text' }], few)]), 'code').kind).toBe('text');
  });

  it('2. a unique decimal measure or timestamp is not made an identifier by the ratio rule', () => {
    const rows = range(80).map((i) => ({
      price: `${i}.25`,
      at: `2020-01-01 00:${String(i % 60).padStart(2, '0')}:${String(i % 59).padStart(2, '0')}`,
    }));
    const p = build([table('t', [{ name: 'price', type: 'numeric' }, { name: 'at', type: 'timestamp' }], rows)]);
    expect(col(p, 'price').kind).toBe('numeric');
    expect(col(p, 'at').kind).toBe('temporal');
  });

  it('2. foreign-key when the parent is in the profile, else sequence', () => {
    const parent = table('team', [{ name: 'id', type: 'integer', nullable: false }], range(5).map((i) => ({ id: String(i) })));
    const child = table(
      'player',
      [{ name: 'id', type: 'integer', nullable: false }, { name: 'team_id', type: 'integer' }],
      range(10).map((i) => ({ id: String(i), team_id: String(i % 5) })),
    );
    const keys = [
      { schema: 'public', table: 'team', kind: 'primary' as const, columns: ['id'] },
      { schema: 'public', table: 'player', kind: 'primary' as const, columns: ['id'] },
    ];
    const fk = [{ schema: 'public', table: 'player', column: 'team_id', refSchema: 'public', refTable: 'team', refColumn: 'id' }];
    const withParent = build([parent, child], { keys, foreignKeys: fk });
    expect(col(withParent, 'team_id', 1)).toMatchObject({ kind: 'identifier', strategy: 'foreign-key' });
    expect(withParent.relationships).toEqual([
      { fromTable: 'db.public.player', fromColumns: ['team_id'], toTable: 'db.public.team', toColumns: ['id'], origin: 'declared' },
    ]);
    const without = build([child], { keys, foreignKeys: fk });
    expect(col(without, 'team_id')).toMatchObject({ kind: 'identifier', strategy: 'sequence' });
    expect(without.relationships).toEqual([]);
  });

  it('2. infers a relationship by name only when the parent column is a key', () => {
    const parent = table('team', [{ name: 'id', type: 'integer', nullable: false }], [{ id: '1' }]);
    const child = table('player', [{ name: 'team_id', type: 'integer' }], [{ team_id: '1' }]);
    const keyed = build([parent, child], {
      keys: [{ schema: 'public', table: 'team', kind: 'primary', columns: ['id'] }],
    });
    expect(keyed.relationships).toEqual([
      { fromTable: 'db.public.player', fromColumns: ['team_id'], toTable: 'db.public.team', toColumns: ['id'], origin: 'inferred' },
    ]);
    expect(build([parent, child]).relationships).toEqual([]);
  });

  it('2. uuid for a uuid-formatted text identifier; unique-pattern for other text ids', () => {
    const rows = range(5).map((i) => ({
      row_uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      code_id: `K${i}`,
    }));
    const p = build([table('t', [{ name: 'row_uuid', type: 'text' }, { name: 'code_id', type: 'text' }], rows)]);
    expect(col(p, 'row_uuid')).toMatchObject({ kind: 'identifier', strategy: 'uuid', formatRule: 'uuid' });
    expect(col(p, 'code_id')).toMatchObject({ kind: 'identifier', strategy: 'unique-pattern' });
  });

  it('3. boolean with its true fraction', () => {
    const p = build([table('t', [{ name: 'on', type: 'boolean' }], [{ on: 't' }, { on: 't' }, { on: 'f' }, { on: null }])]);
    expect(col(p, 'on')).toMatchObject({ kind: 'boolean', strategy: 'boolean-rate', nullFraction: 0.25 });
    expect(col(p, 'on').boolean).toEqual({ trueFraction: 0.6667 });
  });

  it('4. numeric: range, mean, 11 quantiles, integer flag and scale', () => {
    const rows = range(11).map((i) => ({ n: String(i * 10), d: `${i}.50` }));
    const p = build([table('t', [{ name: 'n', type: 'integer' }, { name: 'd', type: 'numeric(10,2)' }], rows)]);
    expect(col(p, 'n')).toMatchObject({ kind: 'numeric', strategy: 'numeric-range' });
    expect(col(p, 'n').numeric).toEqual({
      min: 0, max: 100, mean: 50, quantiles: range(11).map((i) => i * 10), integer: true, scale: 0,
    });
    expect(col(p, 'd').numeric).toMatchObject({ integer: false, scale: 2, min: 0.5, max: 10.5 });
  });

  it('5. temporal: ISO UTC range, 11 quantiles, granularity date / second / fraction', () => {
    const p = build([
      table(
        't',
        [{ name: 'd', type: 'date' }, { name: 's', type: 'timestamp' }, { name: 'f', type: 'timestamptz' }],
        [
          { d: '2020-01-01', s: '2020-01-01 10:00:00', f: '2020-01-01 10:00:00.123456+00' },
          { d: '2020-12-31', s: '2020-01-02 11:30:00', f: '2020-01-02 11:30:00.5+00' },
        ],
      ),
    ]);
    expect(col(p, 'd')).toMatchObject({ kind: 'temporal', strategy: 'temporal-range' });
    expect(col(p, 'd').temporal).toMatchObject({
      min: '2020-01-01T00:00:00.000Z', max: '2020-12-31T00:00:00.000Z', granularity: 'date',
    });
    expect(col(p, 'd').temporal!.quantiles).toHaveLength(11);
    expect(col(p, 's').temporal!.granularity).toBe('second');
    expect(col(p, 'f').temporal!.granularity).toBe('fraction');
  });

  it('6. formatted: a text column whose name gives a rule that the sample confirms', () => {
    const rows = range(30).map((i) => ({ contact_email: `p${i % 25}@x.org`, notes_url: 'plain words', ok: 'a' }));
    const p = build([table('t', [{ name: 'contact_email', type: 'text' }, { name: 'notes_url', type: 'text' }, { name: 'ok', type: 'text' }], rows)]);
    expect(col(p, 'contact_email')).toMatchObject({ kind: 'formatted', strategy: 'format-template', formatRule: 'email' });
    // the name says url, the data does not: no format rule
    expect(col(p, 'notes_url').kind).not.toBe('formatted');
  });

  it('7. categorical: <= 20 distinct, values seen >= 3 times in topValues, the rest in otherFraction', () => {
    const rows: Row[] = [
      ...Array(6).fill({ s: 'open' }),
      ...Array(3).fill({ s: 'closed' }),
      { s: 'rare-1' },
      { s: 'rare-2' },
      { s: null },
    ];
    const c = col(build([table('t', [{ name: 's', type: 'text' }], rows)]), 's');
    expect(c).toMatchObject({ kind: 'categorical', strategy: 'categorical', distinctCount: 4 });
    expect(c.topValues).toEqual([
      { value: 'open', fraction: 0.5455 },
      { value: 'closed', fraction: 0.2727 },
    ]);
    expect(c.otherFraction).toBe(0.1818);
    expect(c.patterns).toEqual([{ shape: 'aaaa-9', fraction: 1 }]);
  });

  it('7. ties in topValues are ordered by value', () => {
    const rows: Row[] = [...Array(3).fill({ s: 'b' }), ...Array(3).fill({ s: 'a' })];
    expect(col(build([table('t', [{ name: 's', type: 'text' }], rows)]), 's').topValues!.map((v) => v.value)).toEqual(['a', 'b']);
  });

  it('7. a column whose values are all seen fewer than 3 times is not categorical', () => {
    const rows: Row[] = [{ s: 'a' }, { s: 'a' }, { s: 'b' }, { s: 'c' }];
    const c = col(build([table('t', [{ name: 's', type: 'text' }], rows)]), 's');
    expect(c.kind).toBe('text');
    expect(c.topValues).toBeUndefined();
  });

  it('7. more than 20 distinct values is not categorical, even when each is seen 3 times', () => {
    const rows: Row[] = range(63).map((i) => ({ s: `v${i % 21}` }));
    expect(col(build([table('t', [{ name: 's', type: 'text' }], rows)]), 's').kind).toBe('text');
  });

  it('7. distinct above 10% of the sample but within 20 is categorical (max(20, 10%))', () => {
    const rows: Row[] = range(60).map((i) => ({ s: `v${i % 20}` }));
    expect(col(build([table('t', [{ name: 's', type: 'text' }], rows)]), 's').kind).toBe('categorical');
  });

  it('8. text: words when the mean length is above 40, else pattern', () => {
    const long = range(30).map((i) => ({ t: `this is a rather long free text number ${i} with many words in it` }));
    const short = range(30).map((i) => ({ t: `short ${i}` }));
    const lp = col(build([table('t', [{ name: 't', type: 'text' }], long)]), 't');
    const sp = col(build([table('t', [{ name: 't', type: 'text' }], short)]), 't');
    expect(lp).toMatchObject({ kind: 'text', strategy: 'words' });
    expect(sp).toMatchObject({ kind: 'text', strategy: 'pattern' });
    expect(sp.length).toMatchObject({ min: 7, max: 8 });
    expect(sp.length!.quantiles).toHaveLength(11);
  });
});

describe('empty and failed samples', () => {
  const cols: Col[] = [
    { name: 'a', type: 'integer', nullable: false },
    { name: 'b', type: 'text' },
    { name: 'c', type: 'timestamp' },
    { name: 'j', type: 'jsonb' },
  ];

  it('an empty sample gives zero fractions and a null-only or constant strategy', () => {
    const p = build([table('t', cols, [])]);
    expect(p.tables[0].sampledRows).toBe(0);
    for (const c of p.tables[0].columns) {
      expect(c.nullFraction).toBe(0);
      expect(c.distinctCount).toBe(0);
      expect(c.distinctRatio).toBe(0);
      expect(c.numeric ?? c.temporal ?? c.topValues ?? c.length ?? c.patterns).toBeUndefined();
    }
    expect(col(p, 'a')).toMatchObject({ kind: 'numeric', strategy: 'constant' });
    expect(col(p, 'b')).toMatchObject({ kind: 'text', strategy: 'null-only' });
    expect(col(p, 'c')).toMatchObject({ kind: 'temporal', strategy: 'null-only' });
    expect(col(p, 'b').note).toBe('No sampled values: generated as NULL');
    expect(col(p, 'a').note).toBe('No sampled values: generated as a neutral value');
  });

  it('a failed sample keeps the catalog columns and the connector error', () => {
    const p = build([table('t', cols, [], { error: 'timeout', rowCountEstimate: null })]);
    expect(p.tables[0]).toMatchObject({ error: 'timeout', rowCountEstimate: null, sampledRows: 0 });
    expect(p.tables[0].columns.map((c) => c.name)).toEqual(['a', 'b', 'c', 'j']);
  });

  it('an all-NULL column is null-only with nullFraction 1', () => {
    const p = build([table('t', [{ name: 'x', type: 'numeric' }], [{ x: null }, { x: null }])]);
    expect(col(p, 'x')).toMatchObject({ nullFraction: 1, strategy: 'null-only', kind: 'numeric' });
  });

  it('values that do not parse as their type are not synthesized', () => {
    const p = build([table('t', [{ name: 'x', type: 'double precision' }], [{ x: 'NaN' }, { x: 'Infinity' }])]);
    expect(col(p, 'x')).toMatchObject({ kind: 'unsupported', strategy: 'null-only' });
  });
});

describe('privacy: no sampled data values leave the builder, except categorical topValues', () => {
  const FIRST = ['Alice', 'Bruno', 'Chandra', 'Dmitri', 'Esperanza', 'Farouk', 'Greta', 'Hideo', 'Ingrid', 'Jamal'];
  const LAST = ['Okonkwo', 'Lindqvist', 'Marchetti', 'Nakamura', 'Petrovic', 'Quispe', 'Rasmussen', 'Soto', 'Tanaka', 'Uzun'];
  const WORDS = ['zebra', 'quartz', 'lantern', 'harbor', 'violet', 'meadow', 'copper', 'saffron', 'glacier', 'tundra'];
  const STATUS = ['active', 'pending', 'closed'];

  const rows: Row[] = range(1000).map((i) => ({
    id: String(i + 1),
    full_name: `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 10]}${i}`,
    email: `${FIRST[i % 10].toLowerCase()}.${LAST[Math.floor(i / 10) % 10].toLowerCase()}${i}@example-${i}.org`,
    notes: `${WORDS[i % 10]} ${WORDS[(i * 3) % 10]} ${WORDS[(i * 7) % 10]} sentence number ${i} written by ${FIRST[(i * 3) % 10]} about ${LAST[(i * 7) % 10]}`,
    ssn: `${100 + (i % 800)}-${10 + (i % 80)}-${1000 + i}`,
    status: STATUS[i % 3],
  }));
  const profile = build([
    table(
      'people',
      [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'full_name', type: 'text' },
        { name: 'email', type: 'text' },
        { name: 'notes', type: 'text' },
        { name: 'ssn', type: 'text' },
        { name: 'status', type: 'text' },
      ],
      rows,
    ),
  ]);
  const json = JSON.stringify(profile);

  it('classifies the fixture as expected', () => {
    expect(col(profile, 'id').kind).toBe('identifier');
    expect(col(profile, 'full_name').kind).toBe('identifier'); // distinct ratio 1.0, 1000 values
    expect(col(profile, 'email')).toMatchObject({ kind: 'formatted', formatRule: 'email' });
    expect(col(profile, 'notes').kind).toBe('identifier');
    expect(col(profile, 'status')).toMatchObject({ kind: 'categorical' });
  });

  it('contains none of the non-categorical sampled values', () => {
    for (const r of rows) {
      for (const k of ['full_name', 'email', 'notes', 'ssn'] as const) {
        expect(json.includes(r[k] as string)).toBe(false);
      }
    }
    for (const w of [...FIRST, ...LAST, ...WORDS]) expect(json).not.toContain(w);
    expect(json).not.toContain('example-');
    expect(json).not.toContain('sentence');
  });

  it('contains the categorical values and only them as data strings', () => {
    for (const s of STATUS) expect(json).toContain(`"value":"${s}"`);
    expect(col(profile, 'status').topValues).toHaveLength(3);
  });

  it('shapes hold only class tokens, lengths and the fixed punctuation', () => {
    for (const c of profile.tables[0].columns) {
      for (const p of c.patterns ?? []) expect(p.shape).toMatch(/^[Aa9_?{},\d\-./:@#+()'&]*$/);
    }
    expect(col(profile, 'ssn').patterns![0].shape).toMatch(/^9{1,3}/);
  });

  it('also holds when the text columns are low-cardinality text that is not categorical (each value seen once or twice)', () => {
    const r2: Row[] = range(40).map((i) => ({ w: `Name${Math.floor(i / 2)}Secret` }));
    const p = build([table('t', [{ name: 'w', type: 'text' }], r2)]);
    expect(JSON.stringify(p)).not.toContain('Secret');
    expect(col(p, 'w').kind).toBe('text');
  });
});
