import type { DatasetSnapshot } from '../../mastra/tool-services';
import { assessReadiness } from './assess-readiness';
import type { ReadinessAssessment, ReadinessScope } from './readiness.types';
import {
  duckPort,
  type DuckPortOptions,
} from './testing/duckdb-readiness-port.stub';

// Seeded defects of source 9.1 the app can represent, over a real in-memory
// DuckDB (Postgres quoting), so the engine's SQL runs for real.
const NOW = new Date('2026-11-26T08:00:00Z');
const ORDERS = 'shop.sales.orders';
const CUSTOMERS = 'shop.sales.customers';

const described = (name: string, type: string, description: string) => ({
  name,
  type,
  nullable: true,
  description,
});

function dataset(
  extraOrderColumns: ReturnType<typeof described>[] = [],
): DatasetSnapshot {
  return {
    name: 'Shop',
    datasourceId: 'ds-1',
    datasourceKind: 'postgres',
    tables: [ORDERS, CUSTOMERS],
    schemas: [
      {
        key: 'shop.sales',
        layer: 'consumption',
        description: 'Curated sales marts',
      },
    ],
    entities: [
      {
        key: ORDERS,
        columns: [
          described('id', 'integer', 'Order number, one row per order'),
          {
            ...described(
              'customer_id',
              'integer',
              'Customer who placed the order',
            ),
            references: {
              entity: CUSTOMERS,
              column: 'id',
              source: 'declared' as const,
            },
          },
          described(
            'amount',
            'double precision',
            'Net order amount in USD, without taxes',
          ),
          described('order_date', 'date', 'Day the order was placed (UTC)'),
          ...extraOrderColumns,
        ],
      },
      {
        key: CUSTOMERS,
        columns: [
          described('id', 'integer', 'Customer number, one row per customer'),
          described('segment', 'text', 'Commercial segment of the customer'),
        ],
      },
    ],
  };
}

/** 3,000 orders over the 30 days before NOW, every customer exists. */
function orders(
  opts: {
    customerId?: string;
    id?: string;
    orderDate?: string;
    extra?: string;
  } = {},
) {
  return [
    'CREATE SCHEMA sales',
    `CREATE TABLE sales.customers AS SELECT CAST(i AS INTEGER) AS id, 'Segment ' || CAST(i % 5 AS VARCHAR) AS segment FROM range(1, 201) t(i)`,
    `CREATE TABLE sales.orders AS SELECT ${opts.id ?? 'CAST(i AS INTEGER)'} AS id, ` +
      `${opts.customerId ?? 'CAST(i % 200 + 1 AS INTEGER)'} AS customer_id, i * 1.5 AS amount, ` +
      `${opts.orderDate ?? "DATE '2026-11-25' - CAST(i % 30 AS INTEGER)"} AS order_date` +
      `${opts.extra ? `, ${opts.extra}` : ''} FROM range(1, 3001) t(i)`,
  ];
}

function scope(over: Partial<ReadinessScope> = {}): ReadinessScope {
  return {
    useCase: 'Weekly revenue dashboard by segment',
    useType: 'dashboard',
    risk: 'medium',
    entities: [ORDERS, CUSTOMERS],
    criticalFields: [
      { entity: ORDERS, column: 'customer_id', indispensable: true },
      { entity: ORDERS, column: 'amount', indispensable: true },
    ],
    requiredFreshnessHours: 48,
    personalDataNeeded: false,
    owners: [{ dataset: 'Shop', owner: 'Sales data team' }],
    assumptions: [],
    ...over,
  };
}

async function run(
  setup: string[],
  s: ReadinessScope = scope(),
  snapshot: DatasetSnapshot = dataset(),
  options: DuckPortOptions = {},
): Promise<ReadinessAssessment> {
  const port = await duckPort(setup, [snapshot], options);
  try {
    return await assessReadiness(s, port, {
      datasets: ['Shop'],
      now: NOW,
      sessionId: 's-1',
    });
  } finally {
    port.close();
  }
}

const level = (a: ReadinessAssessment, d: string) =>
  a.dimensions.find((x) => x.dimension === d)!.level;
const gate = (a: ReadinessAssessment, g: string) =>
  a.gates.find((x) => x.gate === g)!.status;

describe('assessReadiness (seeded defects, source 9.1)', () => {
  it('clean case: ready, every gate passes, no false alarm', async () => {
    const a = await run(orders());
    expect(a.gates.map((g) => g.status)).toEqual(Array(6).fill('pass'));
    expect(a.verdict).toBe('ready');
    expect(a.findings.filter((f) => f.severity !== 'low')).toEqual([]);
    expect(a.escalations).toEqual([]);
    expect(a.weightedScore).toBe(3);
    expect(a.notEvaluated.length).toBeGreaterThan(0);
    expect(a.rubricVersion).toBe('1.0');
    expect(a.useCaseKey).toBe('weekly revenue dashboard by segment|Shop');
  });

  it('every level and gate cites evidence that exists', async () => {
    const a = await run(orders());
    const ids = new Set(a.evidence.map((e) => e.id));
    for (const d of a.dimensions.filter((x) => x.level !== 'N/E')) {
      expect(d.evidenceIds.length).toBeGreaterThan(0);
      d.evidenceIds.forEach((id) => expect(ids.has(id)).toBe(true));
    }
    for (const g of a.gates) {
      expect(g.evidenceIds.length).toBeGreaterThan(0);
      g.evidenceIds.forEach((id) => expect(ids.has(id)).toBe(true));
    }
  });

  it('30% null in an indispensable field: G5 fails, D2 <= 1, not ready', async () => {
    const a = await run(
      orders({
        customerId:
          'CASE WHEN i % 10 < 3 THEN NULL ELSE CAST(i % 200 + 1 AS INTEGER) END',
      }),
    );
    expect(gate(a, 'G5')).toBe('fail');
    expect(level(a, 'D2')).toBeLessThanOrEqual(1);
    expect(a.verdict).toBe('not-ready');
    const f = a.findings.find((x) => x.gate === 'G5')!;
    expect(f).toMatchObject({
      column: 'customer_id',
      severity: 'blocking',
      measured: '30% null or blank',
    });
    expect(f.threshold).toBe('<= 5% null or blank');
  });

  it('5% duplicate grain keys: detected, quantified, D2 <= 2', async () => {
    const a = await run(
      orders({
        id: 'CAST(CASE WHEN i % 20 = 0 THEN i - 1 ELSE i END AS INTEGER)',
      }),
    );
    expect(level(a, 'D2')).toBeLessThanOrEqual(2);
    const f = a.findings.find(
      (x) => x.dimension === 'D2' && x.measured.includes('duplicate'),
    )!;
    expect(f.measured).toContain('5%');
    expect(f.measured).toContain('150 rows');
    expect(a.verdict).toBe('ready-with-conditions');
    expect(a.conditions.some((c) => c.startsWith('D2:'))).toBe(true);
  });

  it('daily use with weekly data: G6 fails', async () => {
    const a = await run(
      orders({ orderDate: "DATE '2026-11-23' - CAST(7 * (i % 5) AS INTEGER)" }),
      scope({ requiredFreshnessHours: 24 }),
    );
    expect(gate(a, 'G6')).toBe('fail');
    expect(level(a, 'D3')).toBeLessThanOrEqual(1);
    expect(a.verdict).toBe('not-ready');
    expect(a.findings.find((x) => x.gate === 'G6')!.measured).toContain(
      'every 7 days',
    );
  });

  it('emails in an unclassified notes column: G4 fails and no email is in the assessment', async () => {
    const a = await run(
      orders({
        extra: `CASE WHEN i % 10 = 0 THEN 'Wrote from jane.doe' || CAST(i AS VARCHAR) || '@example.com about delivery' ELSE 'Delivered on time' END AS notes`,
      }),
      scope(),
      dataset([described('notes', 'text', 'Free text left by the courier')]),
    );
    expect(gate(a, 'G4')).toBe('fail');
    expect(a.verdict).toBe('not-ready');
    const f = a.findings.find((x) => x.gate === 'G4')!;
    expect(f).toMatchObject({ column: 'notes', severity: 'blocking' });
    expect(f.measured).toMatch(/^email pattern in 10% of \d+ sampled values$/);
    const json = JSON.stringify(a);
    expect(json).not.toMatch(/example\.com/);
    expect(json).not.toMatch(/jane/);
    expect(a.escalations.join(' ')).toContain('Legal / Privacy');
  });

  it('an inaccessible source: G1 fails, D1 = 0, the rest is N/E (no level invented)', async () => {
    const a = await run(
      orders(),
      scope({
        entities: [ORDERS],
        criticalFields: [
          { entity: ORDERS, column: 'customer_id', indispensable: true },
        ],
      }),
      dataset(),
      { denied: [ORDERS] },
    );
    expect(gate(a, 'G1')).toBe('fail');
    expect(level(a, 'D1')).toBe(0);
    for (const d of ['D2', 'D3', 'D5']) expect(level(a, d)).toBe('N/E');
    expect(a.verdict).toBe('not-ready');
    expect(a.weightedScore).toBeNull();
    expect(a.notEvaluated.map((n) => n.item)).toContain(
      `D2, D3, D5 and D6 of ${ORDERS}`,
    );
    expect(a.evidence.filter((e) => e.dimension === 'D2')).toEqual([]);
  });

  it('a critical source without an owner: G2 fails and escalates', async () => {
    const a = await run(orders(), scope({ owners: [] }));
    expect(gate(a, 'G2')).toBe('fail');
    expect(level(a, 'D1')).toBe(1);
    expect(a.escalations.join(' ')).toContain(
      'No identifiable owner for the critical source Shop',
    );
  });

  it('is deterministic: the same input twice gives the same levels, gates and verdict', async () => {
    const strip = (a: ReadinessAssessment) => ({ ...a, id: '' });
    const first = await run(
      orders({
        id: 'CAST(CASE WHEN i % 20 = 0 THEN i - 1 ELSE i END AS INTEGER)',
      }),
    );
    const second = await run(
      orders({
        id: 'CAST(CASE WHEN i % 20 = 0 THEN i - 1 ELSE i END AS INTEGER)',
      }),
    );
    expect(strip(second)).toEqual(strip(first));
  });

  it('compares with the previous assessment of the same use case and datasets', async () => {
    const store: ReadinessAssessment[] = [];
    const before = await run(
      orders({
        customerId:
          'CASE WHEN i % 10 < 3 THEN NULL ELSE CAST(i % 200 + 1 AS INTEGER) END',
      }),
      scope(),
      dataset(),
      { store },
    );
    expect(before.previous).toBeUndefined();
    const after = await run(
      orders(),
      scope({ useCase: '  WEEKLY revenue dashboard, by segment ' }),
      dataset(),
      { store },
    );
    expect(store).toHaveLength(2);
    expect(after.previous).toMatchObject({
      previousId: before.id,
      previousVerdict: 'not-ready',
      previousRubricVersion: '1.0',
    });
    expect(
      after.previous!.dimensions.find((d) => d.dimension === 'D2'),
    ).toEqual({ dimension: 'D2', from: 1, to: 3 });
    expect(after.previous!.gates).toEqual([
      { gate: 'G5', from: 'fail', to: 'pass' },
    ]);
  });

  it('a failing measurement becomes N/E with its reason, never a throw', async () => {
    const snapshot = dataset();
    snapshot.entities![0].columns.push(
      described('missing_col', 'date', 'A column the table does not have'),
    );
    const a = await run(orders(), scope(), snapshot);
    // MAX over a column that is not there fails the freshness query of orders.
    expect(a.notEvaluated.some((n) => n.item === `D3 of ${ORDERS}`)).toBe(true);
    expect(['ready', 'ready-with-conditions', 'not-ready']).toContain(
      a.verdict,
    );
  });

  it('stops on abort', async () => {
    const port = await duckPort(orders(), [dataset()]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      assessReadiness(scope(), port, {
        datasets: ['Shop'],
        now: NOW,
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
    expect(port.saved).toHaveLength(0);
    port.close();
  });

  it('runs only portable aggregates, never a row-level select of the table', async () => {
    const port = await duckPort(orders(), [dataset()]);
    await assessReadiness(scope(), port, { datasets: ['Shop'], now: NOW });
    port.close();
    const sql = port.statements.filter((s) => !s.includes('LIMIT'));
    expect(sql.length).toBeGreaterThan(0);
    for (const s of sql) expect(s).toMatch(/COUNT\(|MAX\(/);
  });
});
