// The other kinds' drivers are not needed here and pull in heavy packages.
jest.mock('../datasources/connectors/databricks.connector', () => ({
  DatabricksConnector: class {},
}));
jest.mock('../datasources/connectors/postgres.connector', () => ({
  PostgresConnector: class {},
}));
jest.mock('../datasources/connectors/rest.connector', () => ({
  RestConnector: class {},
}));
// The eval sets are built at import; their scorers and agents never run here.
jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(),
  // The set files' deterministic checks are wrapped with it at import.
  createScorer: (config: Record<string, unknown>) => {
    const scorer: Record<string, unknown> = { ...config };
    for (const step of ['analyze', 'generateScore', 'generateReason']) {
      scorer[step] = () => scorer;
    }
    return scorer;
  },
}));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../datasets/datasets.service', () => ({
  DatasetsService: class {},
}));
jest.mock('../../mastra/agents/assistant.agent', () => ({
  assistantAgent: {},
}));
jest.mock('../../mastra/agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../../mastra/model-resolver', () => ({
  resolveAgentModel: jest.fn(),
}));
jest.mock('../../mastra/tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets: () => Promise.resolve([]) }),
}));
jest.mock('../sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ASSISTANT_EVAL_SETS } from '../../mastra/evals/assistant.evals';
import { assistantEvalDatasetError } from '../../mastra/evals/assistant-eval-datasets';
import { FileConnector } from '../datasources/connectors/file.connector';
import { FILE_UPLOAD_MAX_BYTES } from '../datasources/connectors/file-storage';
import { DatasourcesService } from '../datasources/datasources.service';
import type {
  Datasource,
  FileDatasourceConfig,
} from '../datasources/entities/datasource.entity';
import type { DatasetDoc } from '../datasets/repositories/datasets.repository';
import { DatasourcesRepository } from '../datasources/repositories/datasources.repository';
import { InventoryCacheRepository } from '../datasources/repositories/inventory-cache.repository';
import { DatabricksConnector } from '../datasources/connectors/databricks.connector';
import { PostgresConnector } from '../datasources/connectors/postgres.connector';
import { DatasetsService } from '../datasets/datasets.service';
import { RestConnector } from '../datasources/connectors/rest.connector';
import { Test } from '@nestjs/testing';
import { TestingDataService } from './testing-data.service';
import { OntologyService } from '../ontology/ontology.service';
import { MetricsService } from '../metrics/metrics.service';
import { findFixture } from './fixtures/registry';

let dataDir: string;
const previousDataDir = process.env.APP_DATA_DIR;
let docs: Map<string, Datasource>;
let datasets: Map<string, Partial<DatasetDoc>>;
let datasources: DatasourcesService;
let testingData: TestingDataService;

beforeAll(async () => {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await connection.run('INSTALL excel');
  connection.closeSync();
  instance.closeSync();
  dataDir = mkdtempSync(join(tmpdir(), 'world-cup-excel-spec-'));
  process.env.APP_DATA_DIR = dataDir;
}, 60_000);

beforeEach(async () => {
  docs = new Map();
  datasets = new Map();
  const snapshots = new Map<string, unknown>();
  const repository = {
    list: () => Promise.resolve([...docs.values()]),
    get: (id: string) => Promise.resolve(docs.get(id) ?? null),
    save: (doc: Datasource) => {
      const saved = { ...doc, id: doc.id ?? 'generated' };
      docs.set(saved.id, saved);
      return Promise.resolve(saved);
    },
    delete: (id: string) => Promise.resolve(docs.delete(id) ? 1 : 0),
  };
  const inventoryCache = {
    get: (id: string) => Promise.resolve(snapshots.get(id) ?? null),
    save: (id: string, catalogs: unknown, fetchedAt: string) => {
      snapshots.set(id, { id, catalogs, fetchedAt });
      return Promise.resolve(snapshots.get(id));
    },
    delete: (id: string) => Promise.resolve(snapshots.delete(id) ? 1 : 0),
  };
  const fakeDatasets = {
    list: () => Promise.resolve([...datasets.values()]),
    save: (doc: Partial<DatasetDoc> & { name: string }) => {
      datasets.set(doc.name, doc);
      return Promise.resolve(doc);
    },
    delete: (name: string) => Promise.resolve(datasets.delete(name)),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      DatasourcesService,
      TestingDataService,
      FileConnector,
      { provide: DatasourcesRepository, useValue: repository },
      { provide: InventoryCacheRepository, useValue: inventoryCache },
      { provide: DatabricksConnector, useValue: {} },
      { provide: PostgresConnector, useValue: {} },
      { provide: RestConnector, useValue: {} },
      { provide: FILE_UPLOAD_MAX_BYTES, useValue: 200 * 1024 * 1024 },
      { provide: DatasetsService, useValue: fakeDatasets },
      // The Excel sample carries no knowledge seed, so neither is called.
      { provide: OntologyService, useValue: {} },
      { provide: MetricsService, useValue: {} },
    ],
  }).compile();
  datasources = moduleRef.get(DatasourcesService);
  testingData = moduleRef.get(TestingDataService);
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
  else process.env.APP_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function uploads(): string[] {
  const dir = join(dataDir, 'files', 'uploads');
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe('the world-cup-excel sample (roadmap 1.31.7)', () => {
  it('loads through the upload and save path and saves a dataset with every sheet', async () => {
    const result = await testingData.load('world-cup-excel', {});

    expect(result).toMatchObject({
      ok: true,
      datasetName: 'World Cup Excel',
      entityCount: 4,
    });
    const [datasource] = [...docs.values()];
    expect(datasource).toMatchObject({
      name: 'World Cup Excel',
      kind: 'file',
    });
    const files = (datasource.config as FileDatasourceConfig).files;
    expect(files.map((f) => [f.name, f.schema])).toEqual([
      ['world_cup.xlsx', 'world_cup'],
      ['players.csv', 'players'],
    ]);
    expect(files.every((f) => !f.uploadId)).toBe(true);
    expect(datasets.get('World Cup Excel')?.tables).toEqual([
      'file.world_cup.matches',
      'file.world_cup.teams',
      'file.world_cup.goals',
      'file.players.players',
    ]);
    expect(uploads()).toEqual([]);
  }, 60_000);

  it('handles the title row on Matches and the Total row on Goals as for a user', async () => {
    await testingData.load('world-cup-excel', {});
    const [datasource] = [...docs.values()];
    const sheets = (datasource.config as FileDatasourceConfig).files[0].sheets;
    const matches = sheets.find((s) => s.sheet === 'Matches');
    const goals = sheets.find((s) => s.sheet === 'Goals');
    expect(matches).toMatchObject({ headerRow: 3, rowCount: 16 });
    expect(matches?.columns?.[0]).toEqual({ name: 'match_id', type: 'DOUBLE' });
    expect(goals).toMatchObject({ excludeLastRow: true, rowCount: 47 });

    const total = await datasources.runReadOnlySql(
      datasource.id,
      'SELECT COUNT(*) AS n, COUNT(DISTINCT goal_id) AS d FROM file.world_cup.goals',
      10,
    );
    expect(total.rows).toEqual([{ n: 47, d: 47 }]);
  }, 60_000);

  it('reports loaded in the status, and reloading and removing leave one clean state', async () => {
    await testingData.load('world-cup-excel', {});
    const again = await testingData.load('world-cup-excel', {});
    expect(again.ok).toBe(true);
    expect(docs.size).toBe(1);

    const status = await testingData.status();
    const view = status.fixtures.find((f) => f.id === 'world-cup-excel');
    expect(view).toMatchObject({
      selfRegistering: true,
      datasourceKind: 'file',
      status: { loaded: true, entityCount: 4, requiredCount: 4 },
    });

    const removed = await testingData.clear('world-cup-excel');
    expect(removed.ok).toBe(true);
    expect(docs.size).toBe(0);
    expect(datasets.size).toBe(0);
  }, 60_000);

  it('answers the reference SQL of every eval case', async () => {
    await testingData.load('world-cup-excel', {});
    const [datasource] = [...docs.values()];
    const set = ASSISTANT_EVAL_SETS.find((s) => s.id === 'world-cup-excel');
    expect(set?.fixtureId).toBe('world-cup-excel');
    expect(set?.cases.length).toBeGreaterThanOrEqual(6);
    expect(set?.cases.length).toBeLessThanOrEqual(8);

    const answers: Record<string, unknown[]> = {};
    for (const evalCase of set?.cases ?? []) {
      if (!evalCase.expectedSql) continue;
      const result = await datasources.runReadOnlySql(
        datasource.id,
        evalCase.expectedSql,
        50,
      );
      expect(result.rows.length).toBeGreaterThan(0);
      answers[evalCase.id] = result.rows.map((row) => Object.values(row));
    }
    expect(answers['excel-champion-2022']).toEqual([['Argentina']]);
    expect(answers['excel-final-score-2018']).toEqual([
      ['France', 'Croatia', 4, 2],
    ]);
    expect(answers['excel-top-scorer-2022']).toEqual([['Lionel Messi', 4]]);
    expect(answers['excel-goals-2022']).toEqual([[24]]);
    expect(answers['excel-shootouts']).toHaveLength(4);
    expect(answers['excel-biggest-venue']).toEqual([['Lusail Stadium', 88966]]);
    expect(answers['excel-goalkeepers']).toEqual([[13]]);
  }, 60_000);

  it('passes the eval data scope check once loaded', () => {
    const fixture = findFixture('world-cup-excel')!;
    const snapshot = {
      name: 'World Cup Excel',
      datasourceId: 'ds',
      datasourceKind: 'file',
      tables: [
        'file.world_cup.matches',
        'file.world_cup.teams',
        'file.world_cup.goals',
        'file.players.players',
      ],
    };
    expect(
      assistantEvalDatasetError(
        ['World Cup Excel'],
        [snapshot] as never,
        fixture,
      ),
    ).toBeUndefined();
    expect(
      assistantEvalDatasetError(['World Cup Excel'], [], fixture),
    ).toContain('Excel / CSV');
  });
});
