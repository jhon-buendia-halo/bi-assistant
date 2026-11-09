jest.mock('../engine/infer-joins', () => ({
  ...jest.requireActual<object>('../engine/infer-joins'),
  inferJoinCandidates: jest.fn(),
}));

import type { PostgresConfig } from '../../datasources/entities/datasource.entity';
import { inferJoinCandidates } from '../engine/infer-joins';
import type { SourceProfile } from '../engine/types';
import { fakeProfiler, stats } from './fake-profiler.stub';
import { POSTGRES_FORMAT_PATTERNS } from './format-rules';
import { profilePostgres } from './postgres.adapter';

const infer = inferJoinCandidates as jest.MockedFunction<
  typeof inferJoinCandidates
>;
const config = { host: 'h' } as PostgresConfig;

describe('profilePostgres', () => {
  beforeEach(() => infer.mockReset().mockReturnValue([]));

  it('builds the exact SourceProfile', async () => {
    const profiler = fakeProfiler<PostgresConfig>('postgres', {
      tables: [
        {
          schema: 'public',
          table: 'customers',
          columns: [
            { name: 'id', type: 'integer', nullable: false },
            { name: 'email', type: 'character varying(255)', nullable: true },
            { name: 'status', type: 'text', nullable: true },
            { name: 'tags', type: 'text[]', nullable: true },
          ],
        },
        {
          schema: 'public',
          table: 'orders',
          columns: [
            { name: 'id', type: 'integer', nullable: false },
            { name: 'customer_id', type: 'integer', nullable: true },
            {
              name: 'placed_at',
              type: 'timestamp with time zone',
              nullable: true,
            },
            { name: 'paid', type: 'boolean', nullable: false },
          ],
        },
      ],
      stats: {
        'public.customers': stats(10, {
          id: { distinct: 10, min: '1', max: '10' },
          email: { nulls: 1, distinct: 9, min: 'a@x.io', max: 'z@x.io' },
          status: { nulls: 0, distinct: 3, min: 'active', max: 'closed' },
          tags: { nulls: 2, distinct: 4 },
        }),
        'public.orders': stats(20, {
          id: { distinct: 20, min: '1', max: '20' },
          customer_id: { nulls: 2, distinct: 8, min: '1', max: '11' },
          placed_at: {
            nulls: 0,
            distinct: 20,
            min: '2024-01-01',
            max: '2024-12-31',
          },
          paid: { distinct: 2 },
        }),
      },
      keys: [
        {
          schema: 'public',
          table: 'customers',
          kind: 'primary',
          columns: ['id'],
        },
        { schema: 'public', table: 'orders', kind: 'primary', columns: ['id'] },
      ],
      foreignKeys: [
        {
          schema: 'public',
          table: 'orders',
          column: 'customer_id',
          refSchema: 'public',
          refTable: 'customers',
          refColumn: 'id',
        },
      ],
      privileges: [
        { schema: 'public', table: 'customers', selectable: true },
        { schema: 'public', table: 'orders', selectable: true },
      ],
      duplicates: { 'public.customers|id': 0, 'public.orders|id': 1 },
      orphans: { 'public.orders.customer_id': 2 },
      invalid: { 'public.customers.email': 1 },
      normalized: { 'public.customers.status': 2, 'public.customers.email': 9 },
    });

    const profile = await profilePostgres(profiler, config, 'ds-1');

    const expected: SourceProfile = {
      sourceId: 'ds-1',
      sourceType: 'postgres',
      entities: [
        {
          namespace: 'public',
          name: 'customers',
          rowCount: 10,
          readable: true,
          fields: [
            {
              name: 'id',
              type: 'integer',
              semanticType: 'numeric',
              nullable: false,
              nullCount: 0,
              distinctCount: 10,
              min: '1',
              max: '10',
            },
            {
              name: 'email',
              type: 'character varying(255)',
              semanticType: 'text',
              nullable: true,
              nullCount: 1,
              distinctCount: 9,
              min: 'a@x.io',
              max: 'z@x.io',
              formatRule: 'email',
              invalidFormatCount: 1,
              normalizedDistinctCount: 9,
            },
            {
              name: 'status',
              type: 'text',
              semanticType: 'text',
              nullable: true,
              nullCount: 0,
              distinctCount: 3,
              min: 'active',
              max: 'closed',
              normalizedDistinctCount: 2,
            },
            {
              name: 'tags',
              type: 'text[]',
              semanticType: 'other',
              nullable: true,
              nullCount: 2,
              distinctCount: 4,
            },
          ],
          keys: [{ kind: 'primary', fields: ['id'], duplicateCount: 0 }],
        },
        {
          namespace: 'public',
          name: 'orders',
          rowCount: 20,
          readable: true,
          fields: [
            {
              name: 'id',
              type: 'integer',
              semanticType: 'numeric',
              nullable: false,
              nullCount: 0,
              distinctCount: 20,
              min: '1',
              max: '20',
            },
            {
              name: 'customer_id',
              type: 'integer',
              semanticType: 'numeric',
              nullable: true,
              nullCount: 2,
              distinctCount: 8,
              min: '1',
              max: '11',
            },
            {
              name: 'placed_at',
              type: 'timestamp with time zone',
              semanticType: 'temporal',
              nullable: true,
              nullCount: 0,
              distinctCount: 20,
              min: '2024-01-01',
              max: '2024-12-31',
            },
            {
              name: 'paid',
              type: 'boolean',
              semanticType: 'boolean',
              nullable: false,
              nullCount: 0,
              distinctCount: 2,
            },
          ],
          keys: [{ kind: 'primary', fields: ['id'], duplicateCount: 1 }],
        },
      ],
      relationships: [
        {
          fromNamespace: 'public',
          fromEntity: 'orders',
          fromField: 'customer_id',
          toNamespace: 'public',
          toEntity: 'customers',
          toField: 'id',
          orphanCount: 2,
          origin: 'declared',
        },
      ],
    };
    expect(profile).toStrictEqual(expected);

    // MIN/MAX only on comparable columns; nullable list as declared.
    const statsCall = profiler.calls.find(
      (c) => c.method === 'columnStats' && c.args[1] === 'customers',
    );
    expect(statsCall?.args).toEqual([
      'public',
      'customers',
      ['email', 'status', 'tags'],
      ['id', 'email', 'status', 'tags'],
      ['id', 'email', 'status'],
      {
        // POSIX pattern for the email rule, folded into the statement.
        formats: [{ column: 'email', pattern: POSTGRES_FORMAT_PATTERNS.email }],
      },
    ]);
    // Normalized counts ride a second statement, for the window columns only.
    const second = profiler.calls.filter(
      (c) => c.method === 'columnStats' && c.args[1] === 'customers',
    )[1];
    expect(second?.args).toEqual([
      'public',
      'customers',
      [],
      [],
      [],
      { normalizedDistinct: ['email', 'status'] },
    ]);
    // Declared FK columns are passed so inference skips them.
    expect(infer.mock.calls[0][2]).toEqual(
      new Set(['public orders customer_id']),
    );
  });
});
