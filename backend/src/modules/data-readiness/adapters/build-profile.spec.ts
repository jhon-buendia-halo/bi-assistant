jest.mock('../engine/infer-joins', () => ({
  ...jest.requireActual<object>('../engine/infer-joins'),
  inferJoinCandidates: jest.fn(),
}));

import type {
  ColumnStatsExtras,
  ProfiledTable,
} from '../../datasources/connectors/profiling';
import { runAssessment } from '../engine/check-engine';
import { inferJoinCandidates } from '../engine/infer-joins';
import { DEFAULT_THRESHOLDS } from '../engine/types';
import type { JoinCandidate } from '../engine/infer-joins';
import type { AssessScope } from '../engine/types';
import {
  buildSourceProfile,
  utcTemporal,
  type BuildProfileOptions,
  type DialectRules,
} from './build-profile';
import type { ReadinessProgress } from '../progress';
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
  scope?: AssessScope,
  options?: BuildProfileOptions,
  rules: DialectRules = dialect,
) => {
  const profiler = fakeProfiler<object>(rules.sourceType, src);
  return {
    profiler,
    result: buildSourceProfile(profiler, {}, 'ds', rules, scope, options),
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
    // Folded into the statistics statement: no per-column probes.
    expect(
      profiler.calls.filter((c) => c.method === 'normalizedDistinctCount'),
    ).toEqual([]);
    // A second folded statement, for the in-window columns only.
    const second = profiler.calls.find(
      (c) =>
        c.method === 'columnStats' &&
        c.args[1] === 'a' &&
        (c.args[5] as ColumnStatsExtras | undefined)?.normalizedDistinct,
    );
    expect(second?.args.slice(2, 5)).toEqual([[], [], []]);
    expect((second?.args[5] as ColumnStatsExtras).normalizedDistinct).toEqual([
      'label',
    ]);
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
      'withSessions',
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
    ).toEqual(['s.a', 's.a']); // statistics, then the normalized counts
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

describe('buildSourceProfile (BA-323 speed and progress)', () => {
  beforeEach(() => infer.mockReset().mockReturnValue([]));

  const emailTable = (table: string): ProfiledTable => ({
    schema: 's',
    table,
    columns: [
      { name: 'id', type: 'integer', nullable: false },
      { name: 'email', type: 'text', nullable: true },
      { name: 'label', type: 'text', nullable: true },
    ],
  });

  it('sets the folded invalid-format and in-window normalized counts', async () => {
    const src: FakeSource = {
      tables: [emailTable('u')],
      stats: {
        's.u': stats(10, {
          id: { distinct: 10 },
          email: { nulls: 0, distinct: 10 },
          label: { nulls: 0, distinct: 1 },
        }),
      },
      privileges: [{ schema: 's', table: 'u', selectable: true }],
      invalid: { 's.u.email': 2 },
      normalized: { 's.u.email': 9, 's.u.label': 1 },
      keys: [{ schema: 's', table: 'u', kind: 'primary', columns: ['id'] }],
      duplicates: { 's.u|id': 0 },
    };
    const { profiler, result } = run(src);
    const [u] = (await result).entities;
    const email = u.fields.find((f) => f.name === 'email');
    expect(email?.invalidFormatCount).toBe(2);
    expect(email?.normalizedDistinctCount).toBe(9);
    // distinct 1 is outside the 2..1000 window even though the count is known.
    expect(u.fields.find((f) => f.name === 'label')).not.toHaveProperty(
      'normalizedDistinctCount',
    );
    expect(u.keys).toEqual([
      { kind: 'primary', fields: ['id'], duplicateCount: 0 },
    ]);
    expect(u.notProfiled).toBeUndefined();
    const stat = profiler.calls.filter((c) => c.method === 'columnStats');
    expect(stat).toHaveLength(2);
    const first = stat[0].args[5] as ColumnStatsExtras;
    expect(first.normalizedDistinct).toBeUndefined();
    expect(first.formats).toEqual([
      { column: 'email', pattern: POSTGRES_FORMAT_PATTERNS.email },
    ]);
    // Only the in-window column (email: 10 distinct) rides the second statement.
    expect(stat[1].args.slice(2, 5)).toEqual([[], [], []]);
    expect(stat[1].args[5]).toEqual({ normalizedDistinct: ['email'] });
    expect(
      profiler.calls.filter((c) =>
        ['invalidFormatCount', 'normalizedDistinctCount'].includes(c.method),
      ),
    ).toEqual([]);
  });

  it('does not profile a table above 100 million rows', async () => {
    const src: FakeSource = {
      tables: [emailTable('big')],
      stats: {},
      rowCounts: { 's.big': 100_000_001 },
      privileges: [{ schema: 's', table: 'big', selectable: true }],
      keys: [{ schema: 's', table: 'big', kind: 'primary', columns: ['id'] }],
    };
    const { profiler, result } = run(src);
    const [big] = (await result).entities;
    expect(big.notProfiled).toBe('too-large');
    // No statistics: rowCount stays 0; the counted rows ride on the side.
    expect(big.rowCount).toBe(0);
    expect(big.profiledRowCount).toBe(100_000_001);
    expect(big.fields[1]).toStrictEqual({
      name: 'email',
      type: 'text',
      semanticType: 'text',
      nullable: true,
      formatRule: 'email',
    });
    expect(big.keys).toStrictEqual([{ kind: 'primary', fields: ['id'] }]);
    expect(
      profiler.calls.map((c) => c.method).filter((m) => m !== 'withSessions'),
    ).toEqual(
      expect.not.arrayContaining([
        'columnStats',
        'duplicateCount',
        'invalidFormatCount',
        'normalizedDistinctCount',
      ]),
    );
  });

  it('profiles a table of exactly 100 million rows', async () => {
    const src: FakeSource = {
      tables: [textTable('s', 'a')],
      stats: { 's.a': stats(100_000_000, { id: { distinct: 5 } }) },
      privileges: [{ schema: 's', table: 'a', selectable: true }],
    };
    const [a] = (await run(src).result).entities;
    expect(a.notProfiled).toBeUndefined();
    expect(a.rowCount).toBe(100_000_000);
  });

  it('gives a too-large or timed-out entity rowCount 0, so the engine runs no completeness check on it', async () => {
    const src: FakeSource = {
      tables: [emailTable('big'), emailTable('slow')],
      stats: {},
      rowCounts: { 's.big': 100_000_001, 's.slow': 50 },
      timeouts: ['s.slow'],
      privileges: [
        { schema: 's', table: 'big', selectable: true },
        { schema: 's', table: 'slow', selectable: true },
      ],
    };
    const profile = await run(src).result;
    expect(profile.entities.map((e) => e.rowCount)).toEqual([0, 0]);
    const result = runAssessment(profile, {
      thresholds: DEFAULT_THRESHOLDS,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    const completeness = result.dimensionScores.find(
      (d) => d.dimension === 'completeness',
    );
    expect(completeness?.totalChecks ?? 0).toBe(0);
    expect(
      result.findings.filter((f) => f.dimension === 'completeness'),
    ).toEqual([]);
  });

  it('marks a table whose statistics statement times out, with rowCount 0', async () => {
    const src: FakeSource = {
      tables: [emailTable('slow'), emailTable('slow2')],
      stats: {
        's.slow': stats(50, {}),
      },
      rowCounts: { 's.slow': 50 },
      timeouts: ['s.slow', 's.slow2'],
      privileges: [
        { schema: 's', table: 'slow', selectable: true },
        { schema: 's', table: 'slow2', selectable: true },
      ],
    };
    const { profiler, result } = run(src);
    const [slow, slow2] = (await result).entities;
    expect(slow.notProfiled).toBe('timed-out');
    expect(slow.rowCount).toBe(0);
    expect(slow.profiledRowCount).toBeUndefined();
    expect(slow2.notProfiled).toBe('timed-out');
    // The count failed for slow2 too: 0.
    expect(slow2.rowCount).toBe(0);
    expect(
      slow.fields.every((f) => f.nullCount === undefined || !f.nullable),
    ).toBe(true);
    // A timeout is not retried with the plain statement.
    expect(
      profiler.calls.filter((c) => c.method === 'columnStats'),
    ).toHaveLength(2);
  });

  it('falls back to the plain statement and per-column probes on a non-timeout failure', async () => {
    const src: FakeSource = {
      tables: [emailTable('u')],
      stats: {
        's.u': stats(10, {
          id: { distinct: 10 },
          email: { nulls: 0, distinct: 10 },
          label: { nulls: 0, distinct: 4 },
        }),
      },
      failingFolded: ['s.u'],
      privileges: [{ schema: 's', table: 'u', selectable: true }],
      invalid: { 's.u.email': 3 },
      normalized: { 's.u.email': 8, 's.u.label': 4 },
    };
    const { profiler, result } = run(src);
    const [u] = (await result).entities;
    expect(u.notProfiled).toBeUndefined();
    expect(u.rowCount).toBe(10);
    const email = u.fields.find((f) => f.name === 'email');
    expect(email?.invalidFormatCount).toBe(3);
    expect(email?.normalizedDistinctCount).toBe(8);
    expect(
      u.fields.find((f) => f.name === 'label')?.normalizedDistinctCount,
    ).toBe(4);
    const stat = profiler.calls.filter((c) => c.method === 'columnStats');
    expect(stat).toHaveLength(2);
    expect(stat[0].args).toHaveLength(6);
    expect(stat[1].args).toHaveLength(5);
  });

  it('falls back to per-column normalized probes when only the second statement fails', async () => {
    const src: FakeSource = {
      tables: [emailTable('u')],
      stats: {
        's.u': stats(10, {
          id: { distinct: 10 },
          email: { nulls: 0, distinct: 10 },
          label: { nulls: 0, distinct: 1 },
        }),
      },
      failingNormalized: ['s.u'],
      privileges: [{ schema: 's', table: 'u', selectable: true }],
      invalid: { 's.u.email': 2 },
      normalized: { 's.u.email': 7 },
    };
    const { profiler, result } = run(src);
    const [u] = (await result).entities;
    const email = u.fields.find((f) => f.name === 'email');
    // The first statement's statistics and format counts survive.
    expect(u.rowCount).toBe(10);
    expect(email?.invalidFormatCount).toBe(2);
    expect(email?.normalizedDistinctCount).toBe(7);
    expect(u.fields.find((f) => f.name === 'label')).not.toHaveProperty(
      'normalizedDistinctCount',
    );
    expect(
      profiler.calls
        .filter((c) => c.method === 'normalizedDistinctCount')
        .map((c) => c.args[2]),
    ).toEqual(['email']);
    expect(
      profiler.calls.filter((c) => c.method === 'invalidFormatCount'),
    ).toEqual([]);
  });

  it('issues no second statement when no text column is in the window', async () => {
    const src: FakeSource = {
      tables: [emailTable('u')],
      stats: {
        's.u': stats(10, {
          id: { distinct: 10 },
          email: { nulls: 0, distinct: 1 },
          label: { nulls: 0, distinct: 5000 },
        }),
      },
      privileges: [{ schema: 's', table: 'u', selectable: true }],
      invalid: { 's.u.email': 0 },
    };
    const { profiler, result } = run(src);
    await result;
    expect(
      profiler.calls.filter((c) => c.method === 'columnStats'),
    ).toHaveLength(1);
  });

  it('uses the dialect concurrency: 8 for Databricks, 4 for PostgreSQL', async () => {
    const sessions = async (rules: DialectRules) => {
      const { profiler, result } = run(source(), undefined, undefined, rules);
      await result;
      return profiler.calls.find((c) => c.method === 'withSessions')?.args;
    };
    expect(await sessions({ ...dialect, sourceType: 'databricks' })).toEqual([
      8,
    ]);
    expect(await sessions(dialect)).toEqual([4]);
  });

  it('reports progress: listing, each finished table, then relationships', async () => {
    const events: ReadinessProgress[] = [];
    const src = source({
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
      orphans: { 's.a.id': 0 },
    });
    await run(src, undefined, { onProgress: (p) => events.push(p) }).result;

    expect(events[0]).toEqual({
      phase: 'inventory',
      message: 'Listing tables…',
    });
    const profiling = events.filter((e) => e.phase === 'profiling');
    expect(profiling.map((e) => e.done)).toEqual([1, 2, 3]);
    expect(profiling.every((e) => e.total === 3)).toBe(true);
    for (const e of profiling) {
      expect(e.message).toBe(`Profiling ${e.entity} (${e.done}/3)…`);
    }
    expect(profiling.map((e) => e.entity).sort()).toEqual([
      's.a',
      's.b',
      't.a',
    ]);
    const rel = events.filter((e) => e.phase === 'relationships');
    expect(rel).toEqual([
      {
        phase: 'relationships',
        message: 'Checking relationships…',
        done: 0,
        total: 1,
      },
    ]);
    expect(events.indexOf(rel[0])).toBeGreaterThan(
      events.indexOf(profiling[2]),
    );
  });

  it('ignores a listener that throws', async () => {
    const onProgress = jest.fn(() => {
      throw new Error('listener broke');
    });
    const profile = await run(source(), undefined, { onProgress }).result;
    expect(profile.entities).toHaveLength(3);
    expect(onProgress).toHaveBeenCalled();
  });

  it('propagates an abort and stops scheduling further tables', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `t${i}`);
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
    };
    const ctrl = new AbortController();
    const profiler = fakeProfiler<object>('postgres', src);
    const original = profiler.columnStats.bind(
      profiler,
    ) as typeof profiler.columnStats;
    profiler.columnStats = (...args) => {
      ctrl.abort();
      return original(...args);
    };
    await expect(
      buildSourceProfile(profiler, {}, 'ds', dialect, undefined, {
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(
      profiler.calls.filter((c) => c.method === 'columnStats').length,
    ).toBeLessThan(12);
    expect(profiler.calls.some((c) => c.method === 'orphanCount')).toBe(false);
  });

  it('rethrows an AbortError raised by a probe instead of leaving it out', async () => {
    const profiler = fakeProfiler<object>('postgres', source());
    profiler.keys = () =>
      Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }));
    await expect(
      buildSourceProfile(profiler, {}, 'ds', dialect),
    ).rejects.toMatchObject({ name: 'AbortError' });
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
