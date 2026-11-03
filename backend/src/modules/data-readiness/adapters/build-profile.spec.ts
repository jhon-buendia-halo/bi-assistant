jest.mock('../engine/infer-joins', () => ({
  ...jest.requireActual<object>('../engine/infer-joins'),
  inferJoinCandidates: jest.fn(),
}));

import type { ProfiledTable } from '../../datasources/connectors/profiling';
import { inferJoinCandidates } from '../engine/infer-joins';
import type { JoinCandidate } from '../engine/infer-joins';
import { buildSourceProfile, type DialectRules } from './build-profile';
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

const run = (
  src: FakeSource,
  scope?: { namespace?: string; entity?: string },
) => {
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
});
