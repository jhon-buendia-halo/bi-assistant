// assess_readiness over the real engine (U1) and a real in-memory DuckDB:
// the dataset tool services are the engine test's DuckDB port, so every
// statement the engine writes runs, and the tool's query records and model
// view are checked against what really ran.
import { RequestContext } from '@mastra/core/request-context';
import type { ReadinessAssessment } from '../../modules/readiness-assessor/readiness.types';
import {
  duckPort,
  type DuckPort,
} from '../../modules/readiness-assessor/testing/duckdb-readiness-port.stub';
import type { QueryFacts } from '../../modules/sessions/query-evidence/query-evidence.types';
import { carriedQueryRecords } from '../../modules/sessions/turn-data';
import { setReadinessToolServices } from '../readiness-tool-services';
import {
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
  setDatasetToolServices,
  type DatasetSnapshot,
} from '../tool-services';
import { DATASETS_CONTEXT_KEY } from './dataset-tool-context';
import { assessReadinessTool, readinessModelOutput } from './readiness.tools';

type Execute = (
  input: Record<string, unknown>,
  context: { requestContext: RequestContext },
) => Promise<Record<string, unknown>>;
const execute = assessReadinessTool.execute as unknown as Execute;

const ORDERS = 'shop.sales.orders';

const SHOP: DatasetSnapshot = {
  name: 'Shop',
  datasourceId: 'ds-1',
  datasourceKind: 'postgres',
  tables: [ORDERS],
  schemas: [{ key: 'shop.sales', layer: 'consumption', description: 'Sales' }],
  entities: [
    {
      key: ORDERS,
      columns: [
        { name: 'id', type: 'integer', nullable: false, description: 'Order number' },
        { name: 'customer_id', type: 'integer', nullable: true, description: 'Customer who ordered' },
        { name: 'order_date', type: 'date', nullable: false, description: 'Day of the order' },
      ],
    },
  ],
};

const SETUP = [
  'CREATE SCHEMA sales',
  // A third of the orders have no customer: the seeded defect.
  `CREATE TABLE sales.orders AS SELECT CAST(i AS INTEGER) AS id, CASE WHEN i % 3 = 0 THEN NULL ELSE CAST(i AS INTEGER) END AS customer_id, CURRENT_DATE - CAST(i % 30 AS INTEGER) AS order_date FROM range(1, 601) t(i)`,
];

describe('assess_readiness on the real engine', () => {
  let port: DuckPort;
  const saved: ReadinessAssessment[] = [];

  beforeAll(async () => {
    port = await duckPort(SETUP, [SHOP]);
    setDatasetToolServices({
      getDatasets: (names) => port.datasets(names),
      runReadOnlySql: (datasourceId, sql) => port.runSql(datasourceId, sql),
      sampleRows: (datasourceId, entity, limit) =>
        port.sampleRows(datasourceId, entity, limit),
    });
    setReadinessToolServices({
      previous: (key) =>
        Promise.resolve(
          [...saved].reverse().find((a) => a.useCaseKey === key) ?? null,
        ),
      save: (assessment) => {
        saved.push(assessment);
        return Promise.resolve();
      },
    });
  });
  afterAll(() => port.close());

  it('shows every statement the engine ran in the inspector, cited by its evidence, and keeps rows from the model', async () => {
    const requestContext = new RequestContext();
    const facts = new Map<string, QueryFacts>();
    requestContext.set(DATASETS_CONTEXT_KEY, ['Shop']);
    requestContext.set(QUERY_FACTS_CONTEXT_KEY, facts);
    const result = await execute(
      {
        scope: {
          useCase: 'Weekly orders dashboard',
          useType: 'dashboard',
          risk: 'medium',
          entities: [ORDERS],
          criticalFields: [
            { entity: ORDERS, column: 'customer_id', indispensable: true },
          ],
          requiredFreshnessHours: 48,
          personalDataNeeded: false,
          owners: [{ dataset: 'Shop', owner: 'Sales Ops' }],
          assumptions: [],
        },
        rationale: 'I check the orders for the dashboard.',
      },
      { requestContext },
    );
    expect(result.error).toBeUndefined();
    // The indispensable field is a third null: G5 fails, so not ready.
    expect(result.verdict).toBe('not-ready');
    expect(saved).toHaveLength(1);

    const records = carriedQueryRecords(result);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(port.statements).toContain(record.input);
      expect(record.rationale).toMatch(/^EV-\d{3}: /);
      expect(facts.get(queryFactsKey('run_readonly_sql', record.input))).toMatchObject(
        { datasourceId: 'ds-1' },
      );
    }
    const sqlEvidence = saved[0].evidence.filter((e) => e.source === 'sql');
    expect(sqlEvidence.length).toBeGreaterThan(0);
    for (const evidence of sqlEvidence) {
      expect(records.map((record) => record.input)).toContain(evidence.sql);
    }

    const seen = JSON.stringify(readinessModelOutput(result));
    expect(seen).not.toContain('queryRecords');
    expect(seen).not.toContain('"rows":[');
    expect(seen).not.toContain('ds-1');
  });
});
