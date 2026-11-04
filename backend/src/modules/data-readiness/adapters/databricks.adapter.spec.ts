jest.mock('../engine/infer-joins', () => ({
  ...jest.requireActual<object>('../engine/infer-joins'),
  inferJoinCandidates: jest.fn(),
}));

import type { DatabricksConfig } from '../../datasources/entities/datasource.entity';
import { inferJoinCandidates } from '../engine/infer-joins';
import type { SourceProfile } from '../engine/types';
import { profileDatabricks } from './databricks.adapter';
import { fakeProfiler, stats } from './fake-profiler.stub';
import { DATABRICKS_FORMAT_PATTERNS } from './format-rules';

const infer = inferJoinCandidates as jest.MockedFunction<
  typeof inferJoinCandidates
>;
const config = { host: 'h' } as DatabricksConfig;

describe('profileDatabricks', () => {
  beforeEach(() => infer.mockReset().mockReturnValue([]));

  it('builds the exact SourceProfile', async () => {
    const profiler = fakeProfiler<DatabricksConfig>('databricks', {
      tables: [
        {
          schema: 'main.sales',
          table: 'events',
          lastModifiedAt: '2025-03-01T10:00:00.000Z',
          columns: [
            { name: 'event_uuid', type: 'string', nullable: false },
            { name: 'amount', type: 'decimal(18,2)', nullable: true },
            { name: 'attrs', type: 'map<string,string>', nullable: true },
            { name: 'event_date', type: 'string', nullable: true },
          ],
        },
      ],
      stats: {
        'main.sales.events': stats(5000, {
          event_uuid: { distinct: 5000, min: '0', max: 'f' },
          amount: { nulls: 7, distinct: 300, min: '0.00', max: '99.10' },
          attrs: { nulls: 0 },
          event_date: {
            nulls: 0,
            distinct: 1001,
            min: '2024-01-01',
            max: '2024-12-31',
          },
        }),
      },
      keys: [
        {
          schema: 'main.sales',
          table: 'events',
          kind: 'unique',
          columns: ['event_uuid'],
        },
      ],
      privileges: [{ schema: 'main.sales', table: 'events', selectable: true }],
      duplicates: { 'main.sales.events|event_uuid': 3 },
      invalid: {
        'main.sales.events.event_uuid': 0,
        'main.sales.events.event_date': 4,
      },
    });

    const profile = await profileDatabricks(profiler, config, 'ds-db');

    const expected: SourceProfile = {
      sourceId: 'ds-db',
      sourceType: 'databricks',
      entities: [
        {
          namespace: 'main.sales',
          name: 'events',
          rowCount: 5000,
          readable: true,
          lastModifiedAt: '2025-03-01T10:00:00.000Z',
          fields: [
            {
              name: 'event_uuid',
              type: 'string',
              semanticType: 'text',
              nullable: false,
              nullCount: 0,
              distinctCount: 5000,
              min: '0',
              max: 'f',
              formatRule: 'uuid',
              invalidFormatCount: 0,
            },
            {
              name: 'amount',
              type: 'decimal(18,2)',
              semanticType: 'numeric',
              nullable: true,
              nullCount: 7,
              distinctCount: 300,
              min: '0.00',
              max: '99.10',
            },
            {
              name: 'attrs',
              type: 'map<string,string>',
              semanticType: 'json',
              nullable: true,
              nullCount: 0,
            },
            {
              name: 'event_date',
              type: 'string',
              semanticType: 'text',
              nullable: true,
              nullCount: 0,
              distinctCount: 1001,
              min: '2024-01-01',
              max: '2024-12-31',
              formatRule: 'date-string',
              invalidFormatCount: 4,
            },
          ],
          keys: [{ kind: 'unique', fields: ['event_uuid'], duplicateCount: 3 }],
        },
      ],
      relationships: [],
    };
    expect(profile).toStrictEqual(expected);

    expect(
      profiler.calls
        .filter((c) => c.method === 'invalidFormatCount')
        .map((c) => c.args[3]),
    ).toEqual([
      DATABRICKS_FORMAT_PATTERNS.uuid,
      DATABRICKS_FORMAT_PATTERNS['date-string'],
    ]);
    // 1,001 distinct values is outside the consistency window.
    expect(
      profiler.calls.some((c) => c.method === 'normalizedDistinctCount'),
    ).toBe(false);
  });
});
