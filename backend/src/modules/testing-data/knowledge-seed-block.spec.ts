// Same module doubles as `ontology.service.spec.ts`: the real
// `OntologyService` and store run below, but Mastra, the Databricks
// connector behind `DatasourcesService` and the datasets repository are
// never touched by `create` or `contextFor` (a fake hands the ontology the
// dataset the loader saved), and pull in ESM-only deps.
jest.mock('pg', () => ({ Client: jest.fn() }));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/agents/knowledge-bootstrap.agent', () => ({
  knowledgeBootstrapOutputSchema: {},
  MAX_BOOTSTRAP_DRAFTS: 15,
}));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasets/datasets.service', () => ({
  DatasetsService: class {},
}));
jest.mock('../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));
jest.mock('../metrics/metrics.service', () => ({
  MetricsService: class {},
}));

import BetterSqlite3 from 'better-sqlite3';
import { Client } from 'pg';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { CatalogInfo } from '../datasources/entities/datasource.entity';
import type { OntologyItem } from '../ontology/entities/ontology-item.entity';
import { OntologyService } from '../ontology/ontology.service';
import { OntologyRepository } from '../ontology/repositories/ontology.repository';
import { SAMPLE_FIXTURES, type SampleFixture } from './fixtures/registry';
import type { KnowledgeSeed } from './fixtures/knowledge/types';
import { TestingDataService } from './testing-data.service';
import { KNOWLEDGE_BLOCK_CHARS } from '../../mastra/context-blocks';

/** Dataset-ontology R24: the characters of item lines the block may take. */
const BLOCK_BUDGET = KNOWLEDGE_BLOCK_CHARS;

const SEEDED = SAMPLE_FIXTURES.filter((fixture) => fixture.knowledge);

beforeEach(() => {
  // Every connection and statement succeeds: the seed SQL is replayed into
  // nothing, which is all the loader needs to reach its success path.
  (Client as unknown as jest.Mock).mockImplementation(() => ({
    connect: () => Promise.resolve(),
    query: () => Promise.resolve({ rows: [], fields: [] }),
    end: () => Promise.resolve(),
  }));
});

function inventory(fixture: SampleFixture): CatalogInfo[] {
  return [
    {
      name: fixture.defaults.database,
      schemas: [
        {
          name: fixture.schema,
          tables: fixture.requiredTables.map((name) => ({
            name,
            columns: [{ name: 'id', type: 'integer', nullable: false }],
          })),
        },
      ],
    },
  ];
}

/**
 * The loader over the real ontology service and the real SQLite document
 * store (in memory), which stamps `updatedAt` itself and, on a tie, keeps
 * insertion order — oldest first, the opposite of what the seed needs.
 */
function build(fixture: SampleFixture) {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<OntologyItem>(db, 'ontology_items');
  // The dataset the loader saves is the one the ontology checks a concept's
  // mappings against.
  const saved: { name: string; tables: string[] }[] = [];
  const datasets = {
    save: (dataset: { name: string; tables: string[] }) => {
      saved.push(dataset);
      return Promise.resolve(dataset);
    },
  };
  const datasetsRepository = {
    getByNames: (names: string[]) =>
      Promise.resolve(saved.filter((dataset) => names.includes(dataset.name))),
  };
  const metrics = {
    list: () => Promise.resolve([]),
    create: (input: object) => Promise.resolve(input),
  };
  const ontology = new OntologyService(
    new OntologyRepository(store),
    datasetsRepository as never,
    metrics as never,
  );
  const datasources = {
    list: () => Promise.resolve([]),
    save: () => Promise.resolve({ id: 'ds-1' }),
    inventory: () =>
      Promise.resolve({ catalogs: inventory(fixture), cached: false }),
  };
  const service = new TestingDataService(
    datasources as never,
    datasets as never,
    ontology,
    metrics as never,
  );
  return { service, ontology, store, db };
}

describe('the knowledge block of a freshly loaded domain sample (R26, dataset-ontology R22, R24)', () => {
  it.each(SEEDED.map((fixture) => [fixture.name, fixture] as const))(
    '%s: sends its default filters, then its instructions, then its terms, as far as the budget goes',
    async (_name, fixture) => {
      const seed = fixture.knowledge as KnowledgeSeed;
      const ofKind = (kind: string) =>
        seed.knowledge
          .filter((entry) => entry.kind === kind)
          .map((entry) => entry.title);
      const firsts = [...ofKind('default_filter'), ...ofKind('instruction')];
      const sendOrder = [...firsts, ...ofKind('term')];
      const { service, ontology, store, db } = build(fixture);

      const result = await service.load(fixture.id, fixture.defaults);
      const { block, used } = await ontology.contextFor([fixture.datasetName]);
      const stored = await store.find({});
      db.close();

      expect(result.ok).toBe(true);
      expect(stored).toHaveLength(seed.knowledge.length);
      // No two entries share a stamp, so no tie can reorder them.
      expect(new Set(stored.map((entry) => entry.updatedAt)).size).toBe(
        stored.length,
      );
      const titles = used.map((entry) => entry.title);
      expect(titles.slice(0, firsts.length)).toEqual(firsts);
      // The block stops at the first entry that does not fit, so what it
      // sends is exactly the start of the send order.
      expect(titles).toEqual(sendOrder.slice(0, titles.length));
      const lines = block.split('\n').slice(1);
      expect(lines).toHaveLength(used.length);
      expect(lines.join('').length).toBeLessThanOrEqual(BLOCK_BUDGET);
      for (const [at, line] of lines.entries()) {
        expect(
          line.startsWith(`- [${used[at].kind}] ${used[at].title}: `),
        ).toBe(true);
      }
    },
  );
});
