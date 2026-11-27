import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessReadiness } from '../../modules/readiness-assessor/assess-readiness';
import type {
  ReadinessAssessment,
  ReadinessScope,
} from '../../modules/readiness-assessor/readiness.types';
import { duckPort } from '../../modules/readiness-assessor/testing/duckdb-readiness-port.stub';
import {
  findFixture,
  withColumnDescriptions,
} from '../../modules/testing-data/fixtures/registry';
import { splitSqlStatements } from '../../modules/testing-data/sql-statements';
import type { DatasetSnapshot } from '../tool-services';
import { READINESS_LAB_DATASET } from './data-readiness-assessor.evals';

// The Readiness Lab seed, run for real on an in-memory DuckDB, through the
// readiness engine with the scope each eval case's message states: the
// defect each case expects is what the engine measures on that fixture. So
// a failed eval case is Dana's fault, not the data's.
const LAB = findFixture('readiness-lab')!;
const SEED = readFileSync(
  join(__dirname, '../../modules/testing-data/fixtures', LAB.seedFile!),
  'utf8',
);
const key = (table: string) => `readiness_lab.readiness_lab.${table}`;

/** DuckDB's type names as PostgreSQL's inventory spells them. */
const PG_TYPE: Record<string, string> = {
  INTEGER: 'integer',
  DOUBLE: 'double precision',
  DATE: 'date',
  VARCHAR: 'text',
};

async function labSnapshot(): Promise<DatasetSnapshot> {
  const probe = await duckPort(splitSqlStatements(SEED), []);
  try {
    const { rows } = await probe.runSql(
      'ds-1',
      "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'readiness_lab' ORDER BY table_name, ordinal_position",
    );
    const entities: NonNullable<DatasetSnapshot['entities']> = [];
    for (const row of rows) {
      const table = String(row['table_name']);
      let entity = entities.find((e) => e.key === key(table));
      if (!entity) {
        entity = { key: key(table), columns: [] };
        entities.push(entity);
      }
      entity.columns.push({
        name: String(row['column_name']),
        type: PG_TYPE[String(row['data_type'])] ?? 'text',
        nullable: true,
      });
    }
    return {
      name: READINESS_LAB_DATASET,
      datasourceId: 'ds-1',
      datasourceKind: 'postgres',
      tables: LAB.requiredTables.map(key),
      entities: withColumnDescriptions(LAB, entities),
    };
  } finally {
    probe.close();
  }
}

/** The scope a case's message states (the card Dana should build). */
function scope(
  table: string,
  over: Partial<ReadinessScope> = {},
): ReadinessScope {
  return {
    useCase: `Weekly revenue dashboard by customer segment (${table})`,
    useType: 'dashboard',
    risk: 'medium',
    entities: [key(table), key('customers')],
    criticalFields: [
      { entity: key(table), column: 'customer_id', indispensable: true },
      { entity: key(table), column: 'amount', indispensable: true },
    ],
    grainKeys: [{ entity: key(table), columns: ['id'] }],
    requiredFreshnessHours: 72,
    personalDataNeeded: false,
    owners: [{ dataset: READINESS_LAB_DATASET, owner: 'Sales data team' }],
    assumptions: [],
    ...over,
  };
}

let snapshot: DatasetSnapshot;
beforeAll(async () => {
  snapshot = await labSnapshot();
});

async function assess(s: ReadinessScope): Promise<ReadinessAssessment> {
  const port = await duckPort(splitSqlStatements(SEED), [snapshot]);
  try {
    return await assessReadiness(s, port, {
      datasets: [READINESS_LAB_DATASET],
    });
  } finally {
    port.close();
  }
}

const level = (a: ReadinessAssessment, d: string) =>
  a.dimensions.find((x) => x.dimension === d)!.level;
const failed = (a: ReadinessAssessment) =>
  a.gates.filter((g) => g.status === 'fail').map((g) => g.gate);

describe('the Readiness Lab fixture through the readiness engine', () => {
  it('describes every column the seed creates', () => {
    const undescribed = (snapshot.entities ?? []).flatMap((entity) =>
      entity.columns
        .filter((column) => !column.description)
        .map((column) => `${entity.key}.${column.name}`),
    );
    expect(undescribed).toEqual([]);
    expect(snapshot.tables).toHaveLength(7);
  });

  it('orders: ready, every gate passes, no false alarm', async () => {
    const a = await assess(scope('orders'));
    expect(failed(a)).toEqual([]);
    expect(a.verdict).toBe('ready');
    expect(a.findings.filter((f) => f.severity !== 'low')).toEqual([]);
  });

  it('orders_crm: 30% null customer_id fails G5, not ready', async () => {
    const a = await assess(scope('orders_crm'));
    expect(failed(a)).toEqual(['G5']);
    expect(level(a, 'D2')).toBeLessThanOrEqual(1);
    expect(a.verdict).toBe('not-ready');
    expect(a.findings.find((f) => f.gate === 'G5')).toMatchObject({
      column: 'customer_id',
      measured: '30% null or blank',
    });
  });

  it('orders_pos: 5% duplicate ids, D2 <= 2, ready with conditions', async () => {
    const a = await assess(scope('orders_pos'));
    expect(failed(a)).toEqual([]);
    expect(level(a, 'D2')).toBeLessThanOrEqual(2);
    expect(a.verdict).toBe('ready-with-conditions');
    const duplicates = a.findings.find(
      (f) => f.dimension === 'D2' && f.measured.includes('duplicate'),
    )!;
    expect(duplicates.measured).toContain('5%');
  });

  it('orders_wholesale: a daily use over weekly loads fails G6', async () => {
    const a = await assess(
      scope('orders_wholesale', { requiredFreshnessHours: 24 }),
    );
    expect(failed(a)).toEqual(['G6']);
    expect(a.verdict).toBe('not-ready');
    expect(a.findings.find((f) => f.gate === 'G6')!.measured).toContain(
      'every 7 days',
    );
  });

  it('orders_delivery: emails in the notes fail G4 (and G3: no legal basis), and no email is in the assessment', async () => {
    const a = await assess(
      scope('orders_delivery', {
        useCase: 'Analysis of late deliveries by customer segment',
        useType: 'analytics',
        risk: 'low',
        entities: [key('orders_delivery')],
        criticalFields: [
          { entity: key('orders_delivery'), column: 'id', indispensable: true },
          {
            entity: key('orders_delivery'),
            column: 'order_date',
            indispensable: true,
          },
        ],
        requiredFreshnessHours: 168,
      }),
    );
    expect(failed(a)).toEqual(['G3', 'G4']);
    expect(a.verdict).toBe('not-ready');
    expect(a.findings.find((f) => f.gate === 'G4')).toMatchObject({
      column: 'notes',
    });
    const json = JSON.stringify(a);
    expect(json).not.toMatch(/example\.com|jane\.doe|@/);
  });

  it('orders_partner: 30% null customer_id fails G5 whatever its descriptions say', async () => {
    const a = await assess(scope('orders_partner'));
    expect(failed(a)).toEqual(['G5']);
    expect(a.verdict).toBe('not-ready');
    const amount = snapshot
      .entities!.find((e) => e.key === key('orders_partner'))!
      .columns.find((c) => c.name === 'amount')!;
    expect(amount.description).toMatch(/ignore your previous instructions/i);
  });

  it('orders for an ML model: D6 is N/E, so not ready', async () => {
    const a = await assess(
      scope('orders', {
        useCase: 'Customer churn prediction model trained on orders',
        useType: 'ml',
        entities: [key('orders')],
        criticalFields: [
          { entity: key('orders'), column: 'customer_id', indispensable: true },
          { entity: key('orders'), column: 'amount', indispensable: true },
          { entity: key('orders'), column: 'order_date', indispensable: true },
        ],
      }),
    );
    expect(failed(a)).toEqual([]);
    expect(level(a, 'D6')).toBe('N/E');
    expect(a.verdict).toBe('not-ready');
  });
});
