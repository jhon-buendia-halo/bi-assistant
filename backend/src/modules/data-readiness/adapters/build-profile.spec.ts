jest.mock('../engine/infer-joins', () => ({
  ...jest.requireActual<object>('../engine/infer-joins'),
  inferJoinCandidates: jest.fn(),
}));

import type { ProfiledTable } from '../../datasources/connectors/profiling';
import { inferJoinCandidates } from '../engine/infer-joins';
import type { JoinCandidate } from '../engine/infer-joins';
import type { AssessScope } from '../engine/types';
import {
  buildSourceProfile,
  utcTemporal,
  type DialectRules,
} from './build-profile';
import { classifyType } from './classify';
import { fakeProfiler, stats, type FakeSource } from './fake-profiler.stub';
import { POSTGRES_FORMAT_PATTERNS } from './format-rules';

const infer = inferJoinCandidates as jest.MockedFunction<
  typeof inferJoinCandidates
>;
const dialect: DialectRules = {
  sourceType: 'postgres',
  classify: classifyType,
  formatPatterns: POSTGRES_FORMAT_PATTERNS,
};

const textTable = (schema: string, table: string): ProfiledTable => ({
  schema,
  table,
  columns: [
    { name: 'id', type: 'integer', nullable: false },
    { name: 'label', type: 'text', nullable: true },
  ],
});

function source(overrides: Partial<FakeSource> = {}): FakeSource {
  return {
    tables: [textTable('s', 'a'), textTable('s', 'b'), textTable('t', 'a')],
    stats: {
      's.a': stats(3, { id: { distinct: 3 }, label: { distinct: 2 } }),
      's.b': stats(4, { id: { distinct: 4 }, label: { distinct: 1 } }),
      't.a': stats(5, { id: { distinct: 5 }, label: { distinct: 1000 } }),
    },
    privileges: [
      { schema: 's', table: 'a', selectable: true },
      { schema: 's', table: 'b', selectable: true },
      { schema: 't', table: 'a', selectable: true },
    ],
    normalized: { 's.a.label': 1, 't.a.label': 999 },
    ...overrides,
  };
}

const run = (src: FakeSource, scope?: AssessScope) => {
  const profiler = fakeProfiler<object>('postgres', src);
  return {
    profiler,
    result: buildSourceProfile(profiler, {}, 'ds', dialect, scope),
  };
};

describe('buildSourceProfile', () => {
  beforeEach(() => infer.mockReset().mockReturnValue([]));

  it('probes consistency only for text columns with 2 to 1,000 distinct values', async () => {
    const { profiler, result } = run(source());
    const profile = await result;
    const label = (ns: string, name: string) =>
      profile.entities
        .find((e) => e.namespace === ns && e.name === name)
        ?.fields.find((f) => f.name === 'label');
    expect(label('s', 'a')?.normalizedDistinctCount).toBe(1);
    expect(label('s', 'b')).not.toHaveProperty('normalizedDistinctCount');
    expect(label('t', 'a')?.normalizedDistinctCount).toBe(999);
    expect(
      profiler.calls
        .filter((c) => c.method === 'normalizedDistinctCount')
        .map((c) => c.args.slice(0, 2).join('.')),
    ).toEqual(['s.a', 't.a']);
  });

  it('gives an unreadable table no statistics probes', async () => {
    const src = source({
      tables: [
        {
          schema: 's',
          table: 'secret',
          columns: [
            { name: 'email', type: 'text', nullable: true },
            { name: 'id', type: 'integer', nullable: false },
          ],
        },
      ],
      keys: [
        { schema: 's', table: 'secret', kind: 'primary', columns: ['id'] },
      ],
      privileges: [{ schema: 's', table: 'secret', selectable: false }],
    });
    const { profiler, result } = run(src);
    expect(await result).toStrictEqual({
      sourceId: 'ds',
      sourceType: 'postgres',
      entities: [
        {
          namespace: 's',
          name: 'secret',
          rowCount: 0,
          readable: false,
          fields: [
            {
              name: 'email',
              type: 'text',
              semanticType: 'text',
              nullable: true,
            },
            {
              name: 'id',
              type: 'integer',
              semanticType: 'numeric',
              nullable: false,
            },
          ],
          keys: [{ kind: 'primary', fields: ['id'] }],
        },
      ],
      relationships: [],
    });
    expect(profiler.calls.map((c) => c.method).sort()).toEqual([
      'foreignKeys',
      'keys',
      'tablePrivileges',
      'tables',
    ]);
    // An unreadable table is not an inference child.
    expect(infer.mock.calls[0][0]).toEqual([]);
  });

  it('leaves a failing probe statistic out and carries on', async () => {
    const src = source({
      tables: [
        {
          schema: 's',
          table: 'a',
          columns: [
            { name: 'id', type: 'integer', nullable: false },
            { name: 'email', type: 'text', nullable: true },
            { name: 'kind', type: 'text', nullable: true },
          ],
        },
        textTable('s', 'b'),
      ],
      stats: {
        's.a': stats(3, {
          id: { distinct: 3 },
          email: { nulls: 0, distinct: 3 },
          kind: { nulls: 1, distinct: 2 },
        }),
      },
      keys: [{ schema: 's', table: 'a', kind: 'primary', columns: ['id'] }],
      foreignKeys: [
        {
          schema: 's',
          table: 'a',
          column: 'id',
          refSchema: 's',
          refTable: 'b',
          refColumn: 'id',
        },
      ],
      normalized: { 's.a.kind': 2 },
      failing: [
        'columnStats:s.b',
        'invalidFormatCount:s.a.email',
        'normalizedDistinctCount:s.a.email',
        'duplicateCount:s.a|id',
        'orphanCount:s.a.id',
        'tablePrivileges',
      ],
    });
    const profile = await run(src).result;

    const [a, b] = profile.entities;
    // Privileges unknown: `readable` absent, the table is still profiled.
    expect(a).not.toHaveProperty('readable');
    expect(a.rowCount).toBe(3);
    expect(a.fields[1]).toStrictEqual({
      name: 'email',
      type: 'text',
      semanticType: 'text',
      nullable: true,
      nullCount: 0,
      distinctCount: 3,
      formatRule: 'email',
    });
    expect(a.fields[2].normalizedDistinctCount).toBe(2);
    expect(a.keys).toStrictEqual([{ kind: 'primary', fields: ['id'] }]);
    // Column stats failed: no null/distinct counts, row count 0.
    expect(b.rowCount).toBe(0);
    expect(b.fields.every((f) => f.nullCount === undefined)).toBe(true);
    // A declared FK whose orphan probe fails keeps the edge, without the count.
    expect(profile.relationships).toStrictEqual([
      {
        fromNamespace: 's',
        fromEntity: 'a',
        fromField: 'id',
        toNamespace: 's',
        toEntity: 'b',
        toField: 'id',
        origin: 'declared',
      },
    ]);
  });

  it('leaves a nullable column the aggregate left out unmeasured', async () => {
    const profile = await run(
      source({
        tables: [textTable('s', 'a')],
        stats: { 's.a': stats(3, { id: { distinct: 3 } }) },
      }),
    ).result;
    const [id, label] = profile.entities[0].fields;
    expect(id.nullCount).toBe(0);
    expect(label).not.toHaveProperty('nullCount');
  });

  it('carries on when keys and foreign keys cannot be read', async () => {
    const profile = await run(source({ failing: ['keys', 'foreignKeys'] }))
      .result;
    expect(profile.entities).toHaveLength(3);
    expect(profile.relationships).toEqual([]);
  });

  it('throws only when the datasource is unreachable', async () => {
    await expect(run(source({ failing: ['tables'] })).result).rejects.toThrow(
      'tables failed',
    );
  });

  it('narrows the child tables to the scope, keeping all tables as join targets', async () => {
    const src = source({
      foreignKeys: [
        {
          schema: 's',
          table: 'a',
          column: 'id',
          refSchema: 't',
          refTable: 'a',
          refColumn: 'id',
        },
        {
          schema: 's',
          table: 'b',
          column: 'id',
          refSchema: 's',
          refTable: 'a',
          refColumn: 'id',
        },
      ],
      orphans: { 's.a.id': 0, 's.b.id': 0 },
    });

    const byNamespace = await run(src, { namespace: 's' }).result;
    expect(byNamespace.entities.map((e) => `${e.namespace}.${e.name}`)).toEqual(
      ['s.a', 's.b'],
    );
    expect(byNamespace.relationships).toHaveLength(2);

    infer.mockClear();
    const { profiler, result } = run(src, { namespace: 's', entity: 'a' });
    const byEntity = await result;
    expect(byEntity.entities.map((e) => `${e.namespace}.${e.name}`)).toEqual([
      's.a',
    ]);
    expect(byEntity.relationships.map((r) => r.fromEntity)).toEqual(['a']);
    expect(
      profiler.calls
        .filter((c) => c.method === 'columnStats')
        .map((c) => c.args.slice(0, 2).join('.')),
    ).toEqual(['s.a']);
    const [children, targets] = infer.mock.calls[0];
    expect(children.map((t) => `${t.namespace}.${t.name}`)).toEqual(['s.a']);
    expect(targets.map((t) => `${t.namespace}.${t.name}`)).toEqual([
      's.a',
      's.b',
      't.a',
    ]);

    // Entity-only scope matches that entity name in every namespace.
    const byName = await run(src, { entity: 'a' }).result;
    expect(byName.entities.map((e) => `${e.namespace}.${e.name}`)).toEqual([
      's.a',
      't.a',
    ]);
  });

  it('keeps inferred joins verified by an orphan probe, at most 20', async () => {
    const candidate = (i: number): JoinCandidate => ({
      schema: 's',
      table: 'a',
      column: `c${i}_id`,
      refSchema: 's',
      refTable: 'b',
      refColumn: 'id',
    });
    infer.mockReturnValue(Array.from({ length: 22 }, (_, i) => candidate(i)));
    const orphans: Record<string, number> = {};
    for (let i = 0; i < 22; i++) orphans[`s.a.c${i}_id`] = i;
    const src = source({ orphans, failing: ['orphanCount:s.a.c1_id'] });
    const { profiler, result } = run(src);
    const profile = await result;

    expect(
      profiler.calls.filter((c) => c.method === 'orphanCount'),
    ).toHaveLength(20);
    // 20 probed, c1 failed: 19 kept, in candidate order.
    expect(profile.relationships).toHaveLength(19);
    expect(profile.relationships[0]).toStrictEqual({
      fromNamespace: 's',
      fromEntity: 'a',
      fromField: 'c0_id',
      toNamespace: 's',
      toEntity: 'b',
      toField: 'id',
      orphanCount: 0,
      origin: 'inferred',
    });
    expect(profile.relationships.map((r) => r.fromField)).not.toContain(
      'c1_id',
    );
    expect(profile.relationships[18].fromField).toBe('c19_id');
  });

  it('profiles only the requested entity set, keeping every table as a join target', async () => {
    const names = ['a', 'b', 'c', 'd', 'e'];
    const src: FakeSource = {
      tables: names.map((n) => textTable('s', n)),
      stats: Object.fromEntries(
        names.map((n) => [`s.${n}`, stats(1, { id: { distinct: 1 } })]),
      ),
      privileges: names.map((n) => ({
        schema: 's',
        table: n,
        selectable: true,
      })),
      foreignKeys: [
        {
          schema: 's',
          table: 'b',
          column: 'id',
          refSchema: 's',
          refTable: 'e',
          refColumn: 'id',
        },
        {
          schema: 's',
          table: 'c',
          column: 'id',
          refSchema: 's',
          refTable: 'a',
          refColumn: 'id',
        },
      ],
      orphans: { 's.b.id': 0, 's.c.id': 0 },
    };

    const { profiler, result } = run(src, {
      entities: [
        { namespace: 's', name: 'b' },
        { namespace: 's', name: 'd' },
        { namespace: 'x', name: 'gone' },
      ],
    });
    const profile = await result;

    expect(profile.entities.map((e) => e.name)).toEqual(['b', 'd']);
    expect(
      profiler.calls
        .filter((c) => c.method === 'columnStats')
        .map((c) => c.args.slice(0, 2).join('.')),
    ).toEqual(['s.b', 's.d']);
    // b -> e stays (its parent is out of scope); c -> a is not in scope.
    expect(profile.relationships.map((r) => r.fromEntity)).toEqual(['b']);
    const [children, targets] = infer.mock.calls[0];
    expect(children.map((t) => t.name)).toEqual(['b', 'd']);
    expect(targets.map((t) => t.name)).toEqual(names);
  });

  it('applies the 20 inferred-join cap once, to the requested entities only', async () => {
    infer.mockImplementation(
      jest.requireActual<{
        inferJoinCandidates: typeof inferJoinCandidates;
      }>('../engine/infer-joins').inferJoinCandidates,
    );
    const refs = (n: number) => Array.from({ length: n }, (_, i) => `r${i}_id`);
    const child = (table: string, cols: string[]): ProfiledTable => ({
      schema: 's',
      table,
      columns: cols.map((name) => ({ name, type: 'integer', nullable: true })),
    });
    const targets = Array.from({ length: 15 }, (_, i) =>
      child(`r${i}`, ['id']),
    );
    // `out` sorts first and has 15 candidates of its own; it is not requested.
    const tables = [
      child('aa_out', refs(15)),
      child('in1', refs(15)),
      child('in2', refs(10)),
      ...targets,
    ];
    const orphans: Record<string, number> = {};
    for (const t of tables)
      for (const c of t.columns) orphans[`s.${t.table}.${c.name}`] = 0;
    const src: FakeSource = {
      tables,
      stats: Object.fromEntries(
        tables.map((t) => [`s.${t.table}`, stats(1, {})]),
      ),
      orphans,
      failing: ['tablePrivileges'],
    };

    const { profiler, result } = run(src, {
      entities: [
        { namespace: 's', name: 'in1' },
        { namespace: 's', name: 'in2' },
      ],
    });
    const profile = await result;

    const probed = profiler.calls
      .filter((c) => c.method === 'orphanCount')
      .map((c) => (c.args[0] as JoinCandidate).table);
    expect(probed).toHaveLength(20);
    expect(probed).not.toContain('aa_out');
    expect(profile.relationships).toHaveLength(20);
    expect(profile.relationships.every((r) => r.origin === 'inferred')).toBe(
      true,
    );
    expect(
      profile.relationships.filter((r) => r.fromEntity === 'in1'),
    ).toHaveLength(15);
    expect(
      profile.relationships.filter((r) => r.fromEntity === 'in2'),
    ).toHaveLength(5);
  });

  it('reads a zone-less temporal min/max as UTC', async () => {
    const src: FakeSource = {
      tables: [
        {
          schema: 's',
          table: 'ev',
          columns: [
            { name: 'at', type: 'timestamp without time zone', nullable: true },
            { name: 'on', type: 'date', nullable: true },
            { name: 'code', type: 'text', nullable: true },
          ],
        },
      ],
      stats: {
        's.ev': stats(2, {
          at: { min: '2024-01-05 10:00:00', max: '2024-03-01 23:59:59.5' },
          on: { min: '2024-01-05', max: '2024-01-06' },
          code: { min: '2024-01-05 10:00:00', max: 'z' },
        }),
      },
      privileges: [{ schema: 's', table: 'ev', selectable: true }],
    };

    const profile = await run(src).result;
    const field = (n: string) =>
      profile.entities[0].fields.find((f) => f.name === n);

    expect(field('at')).toMatchObject({
      min: '2024-01-05T10:00:00Z',
      max: '2024-03-01T23:59:59.5Z',
    });
    expect(Date.parse(field('at')!.min!)).toBe(Date.UTC(2024, 0, 5, 10));
    expect(field('on')).toMatchObject({ min: '2024-01-05', max: '2024-01-06' });
    // Only temporal columns are rewritten.
    expect(field('code')?.min).toBe('2024-01-05 10:00:00');
  });
});

describe('utcTemporal', () => {
  it.each([
    ['2024-01-05 10:00:00', '2024-01-05T10:00:00Z'],
    ['2024-01-05T10:00', '2024-01-05T10:00Z'],
    ['2024-01-05 10:00:00.123456', '2024-01-05T10:00:00.123456Z'],
    ['2024-01-05 10:00:00+00', '2024-01-05T10:00:00+00:00'],
    ['2024-01-05 10:00:00-0530', '2024-01-05T10:00:00-05:30'],
    ['2024-01-05 10:00:00+05:30', '2024-01-05T10:00:00+05:30'],
    ['2024-01-05T10:00:00.000Z', '2024-01-05T10:00:00.000Z'],
    ['2024-01-05', '2024-01-05'],
    ['10:00:00', '10:00:00'],
    ['1 day 02:00:00', '1 day 02:00:00'],
  ])('%s -> %s', (input, expected) => {
    expect(utcTemporal(input)).toBe(expected);
  });

  it('parses the same instant whatever the host time zone', () => {
    expect(Date.parse(utcTemporal('2024-01-05 10:00:00'))).toBe(
      Date.UTC(2024, 0, 5, 10),
    );
    expect(Date.parse(utcTemporal('2024-01-05 10:00:00+00'))).toBe(
      Date.UTC(2024, 0, 5, 10),
    );
  });
});
