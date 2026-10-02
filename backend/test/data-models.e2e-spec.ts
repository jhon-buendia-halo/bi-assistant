/**
 * E2E spec for the Data model feature (gherkin.md "Feature: Data model",
 * roadmap 1.2.1 / BA-85). Written ahead of the implementation (workflow
 * step 7) — none of the `/datasets/:name/model*` or `/data-models/*`
 * endpoints exist yet, so every scenario here is expected to fail (404s or
 * missing fields) until the feature lands.
 *
 * Bootstrap mirrors `app.e2e-spec.ts` / `answer-guards.e2e-spec.ts`: a
 * throwaway `APP_DATA_DIR` + `APP_SECRET`, a focused module set, supertest
 * over the Nest HTTP server. The World Cup Postgres fixture is NOT available
 * in this run, so datasets are saved through the real `DatasourcesService`
 * (its `.save()` never tests the connection) with `sampleRowsMany` /
 * `foreignKeys` spied out so `DatasetsService.save()`'s enrichment step never
 * needs a live connection.
 *
 * `database.module.ts` / `mastra/storage.ts` read `APP_DATA_DIR` at import
 * time (see `src/cli.ts`), so `AppModule` is loaded with `require()` *after*
 * the env is set, behind `jest.resetModules()` — this Jest config lacks
 * `--experimental-vm-modules`, so a real dynamic `import()` throws; `require`
 * goes through the same Jest module registry and behaves the same way here.
 */
jest.mock('../src/modules/datasources/connectors/databricks.connector', () => ({
  // `@databricks/sql` -> `thrift` ships an ESM-only `uuid` build this Jest
  // config cannot `require()`. Mocked exactly like
  // `datasources.service.spec.ts` does; nothing here exercises databricks.
  DatabricksConnector: class {},
}));

import type { TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import type {
  DatasetColumnSnapshot,
  DatasetEntitySnapshot,
} from '../src/modules/datasets/repositories/datasets.repository';
import type {
  DatasourceView,
  QueryResult,
} from '../src/modules/datasources/entities/datasource.entity';
import type { ForeignKeyEdge } from '../src/modules/datasets/relationships';
import type { ModelIssue } from '../src/modules/data-models/entities/data-model.entity';
import type { DataModelVersion } from '../src/modules/data-models/repositories/data-models.repository';
import type { ResolveResult } from '../src/modules/data-models/data-models.service';
import type { DriftReport } from '../src/modules/data-models/drift';
import type { MetricDoc } from '../src/modules/metrics/entities/metric.entity';

/**
 * Response shapes for the endpoints this spec drives, reused from the
 * modules where the real shape already lives where possible (`DriftReport`,
 * `DataModelVersion`, `ResolveResult`, `MetricDoc`, `ModelIssue`,
 * `DatasourceView`). These are the raw `supertest`/`res.body` shapes, cast
 * at each call site, rather than extending the real service/controller
 * types — several fields (e.g. `version` below) are only ever absent in
 * error paths the controller never actually hits in these scenarios, so
 * keeping them required here matches the assertions, which never
 * optional-chain past the top level.
 */

/** `GET /datasets/:name/model`. */
interface ModelResponse {
  dataset: string;
  currentVersion: number;
  version: DataModelVersion;
}

/** `GET /datasets/:name/model/versions/:version` — the version document,
 * returned by the controller as-is. */
type VersionResponse = DataModelVersion;

/** `GET /datasets/:name/model/drift` — the drift report as-is. */
type DriftResponse = DriftReport;

/** `POST /datasets/:name/model/resolve`. */
interface ResolveResponse {
  results: ResolveResult[];
}

/** `GET /metrics`. */
interface MetricsListResponse {
  metrics: MetricDoc[];
}

/** The `{ ok, message }` shape shared by the write endpoints driven here
 * (`POST /datasets`, `PUT /datasets/:name/model`,
 * `POST /datasets/:name/model/revert`, `POST /metrics`) plus the few
 * success-path fields each one adds. */
interface SaveResponse {
  ok: boolean;
  message?: string;
  version?: number;
  currentVersion?: number;
  metric?: MetricDoc;
}

/** `POST /datasources` — the one write endpoint here whose success body
 * also carries the created record. */
interface DatasourceSaveResponse {
  ok: boolean;
  message?: string;
  datasource?: DatasourceView;
}

/** `GET /data-models/schema.json` — a JSON Schema document; only its
 * top-level shape is asserted here. */
interface SchemaResponse {
  properties?: Record<string, unknown>;
  definitions?: Record<string, unknown>;
  $defs?: Record<string, unknown>;
}

const MATCHES_KEY = 'world_cup.world_cup.matches';
const TEAMS_KEY = 'world_cup.world_cup.teams';

function col(
  name: string,
  type: string,
  nullable = false,
): DatasetColumnSnapshot {
  return { name, type, nullable };
}

const MATCHES_COLUMNS: DatasetColumnSnapshot[] = [
  col('match_id', 'bigint'),
  col('home_team_id', 'bigint'),
  col('away_team_id', 'bigint'),
  col('match_date', 'date'),
  col('attendance', 'integer', true),
];

/** Scenario 7's drifted snapshot: `attendance` gone, `spectators` new. */
const DRIFTED_MATCHES_COLUMNS: DatasetColumnSnapshot[] = [
  ...MATCHES_COLUMNS.filter((c) => c.name !== 'attendance'),
  col('spectators', 'integer', true),
];

const TEAMS_COLUMNS: DatasetColumnSnapshot[] = [
  col('team_id', 'bigint'),
  col('name', 'text'),
];

function entitiesSnapshot(
  matchesColumns: DatasetColumnSnapshot[] = MATCHES_COLUMNS,
): DatasetEntitySnapshot[] {
  return [
    { key: MATCHES_KEY, columns: matchesColumns },
    { key: TEAMS_KEY, columns: TEAMS_COLUMNS },
  ];
}

/** Canned `sampleRowsMany` result — covers both the original and drifted
 * matches columns, so the same stub serves every scenario regardless of
 * which snapshot is being saved. */
function sampleRowsFor(entity: string): QueryResult {
  if (entity === MATCHES_KEY) {
    return {
      columns: [
        'match_id',
        'home_team_id',
        'away_team_id',
        'match_date',
        'attendance',
        'spectators',
      ],
      rows: [
        {
          match_id: 1,
          home_team_id: 10,
          away_team_id: 20,
          match_date: '2022-11-22',
          attendance: 42000,
          spectators: 42000,
        },
        {
          match_id: 2,
          home_team_id: 20,
          away_team_id: 30,
          match_date: '2022-11-23',
          attendance: 38000,
          spectators: 38000,
        },
        {
          match_id: 3,
          home_team_id: 30,
          away_team_id: 10,
          match_date: '2022-11-24',
          attendance: 51000,
          spectators: 51000,
        },
      ],
    };
  }
  if (entity === TEAMS_KEY) {
    return {
      columns: ['team_id', 'name'],
      rows: [
        { team_id: 10, name: 'Argentina' },
        { team_id: 20, name: 'France' },
        { team_id: 30, name: 'Croatia' },
      ],
    };
  }
  return { columns: [], rows: [] };
}

const DECLARED_FOREIGN_KEYS: ForeignKeyEdge[] = [
  {
    from: { entity: MATCHES_KEY, column: 'home_team_id' },
    to: { entity: TEAMS_KEY, column: 'team_id' },
  },
];

/**
 * Loads a freshly-configured, focused module set (database + datasources +
 * datasets + metrics + data models) after `APP_DATA_DIR` / `APP_SECRET` are
 * set. `jest.resetModules()` first so the `require()`s below re-evaluate
 * `database.module.ts` against the new env instead of reusing a previous
 * boot's cached module instances. The full `AppModule` is deliberately not
 * used: `SessionsModule` pulls in Mastra's ESM-only dependencies, which the
 * Jest CommonJS runtime cannot load, and nothing in this feature needs it.
 *
 * `@nestjs/testing` is re-required here too, *after* `resetModules()`,
 * rather than relying on the `Test`/`TestingModule` statically imported at
 * the top of this file. `jest.resetModules()` clears Jest's module
 * registry wholesale, including third-party packages — so a later
 * `require('@nestjs/common')` (reached transitively through the freshly
 * required app modules above) returns a *different* module instance than
 * the one the static import captured before the reset, with its own
 * distinct `HttpException` class. Building the app from the statically
 * imported `Test` would then run it on the *old* `@nestjs/core`, whose
 * built-in exception filter does `instanceof` against the *old*
 * `@nestjs/common`'s `HttpException` — which a `BadRequestException`
 * thrown by the freshly-required service code never matches, so every
 * thrown Nest exception degrades to a generic 500 instead of its real
 * status. Sourcing `Test` from the same fresh `require()` set keeps the
 * app, its modules and every exception class on one consistent instance.
 */
function loadFreshModules() {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const database =
    require('../src/infrastructure/database/database.module') as typeof import('../src/infrastructure/database/database.module');
  const datasources =
    require('../src/modules/datasources/datasources.module') as typeof import('../src/modules/datasources/datasources.module');
  const datasets =
    require('../src/modules/datasets/datasets.module') as typeof import('../src/modules/datasets/datasets.module');
  const metrics =
    require('../src/modules/metrics/metrics.module') as typeof import('../src/modules/metrics/metrics.module');
  const dataModels =
    require('../src/modules/data-models/data-models.module') as typeof import('../src/modules/data-models/data-models.module');
  const datasourcesServiceExports =
    require('../src/modules/datasources/datasources.service') as typeof import('../src/modules/datasources/datasources.service');
  const testingExports =
    require('@nestjs/testing') as typeof import('@nestjs/testing');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    modules: [
      database.DatabaseModule,
      datasources.DatasourcesModule,
      datasets.DatasetsModule,
      metrics.MetricsModule,
      dataModels.DataModelsModule,
    ],
    DatasourcesService: datasourcesServiceExports.DatasourcesService,
    Test: testingExports.Test,
  };
}

async function bootApp(
  dataDir: string,
  secret: string,
): Promise<{ app: INestApplication<App> }> {
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_SECRET = secret;
  const { modules, DatasourcesService, Test: FreshTest } = loadFreshModules();
  const moduleFixture: TestingModule = await FreshTest.createTestingModule({
    imports: modules,
  }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  await app.init();

  const datasourcesService = app.get(DatasourcesService);
  jest
    .spyOn(datasourcesService, 'sampleRowsMany')
    .mockImplementation((_datasourceId: string, entities: string[]) => {
      const results = new Map<string, QueryResult>();
      for (const entity of entities) results.set(entity, sampleRowsFor(entity));
      return Promise.resolve(results);
    });
  jest
    .spyOn(datasourcesService, 'foreignKeys')
    .mockResolvedValue(DECLARED_FOREIGN_KEYS);

  return { app };
}

async function createDatasource(app: INestApplication<App>): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/datasources')
    .send({
      name: 'World Cup',
      kind: 'postgres',
      config: {
        host: 'localhost',
        port: 5432,
        database: 'world_cup',
        user: 'postgres',
        password: 'postgres',
        ssl: false,
      },
    });
  const body = res.body as DatasourceSaveResponse;
  expect(body.ok).toBe(true);
  return body.datasource!.id;
}

async function saveDataset(
  app: INestApplication<App>,
  name: string,
  datasourceId: string,
  matchesColumns: DatasetColumnSnapshot[] = MATCHES_COLUMNS,
): Promise<SaveResponse> {
  const res = await request(app.getHttpServer())
    .post('/datasets')
    .send({
      name,
      tables: [MATCHES_KEY, TEAMS_KEY],
      entities: entitiesSnapshot(matchesColumns),
      datasourceId,
    });
  const body = res.body as SaveResponse;
  expect(body.ok).toBe(true);
  return body;
}

/** Like `saveDataset`, but with an arbitrary table/entity set — used by the
 * merge scenario, which starts with only one table bound. */
async function saveDatasetWithEntities(
  app: INestApplication<App>,
  name: string,
  datasourceId: string,
  tables: string[],
  entities: DatasetEntitySnapshot[],
): Promise<SaveResponse> {
  const res = await request(app.getHttpServer())
    .post('/datasets')
    .send({ name, tables, entities, datasourceId });
  const body = res.body as SaveResponse;
  expect(body.ok).toBe(true);
  return body;
}

/** A `PUT /datasets/:name/model` body: a new version on success, issues on 400. */
interface PutModelResponse {
  ok: boolean;
  version?: number;
  errors?: ModelIssue[];
}

/**
 * Awaits a supertest call and types its body. `res.body` is `any` in
 * supertest's typings; funnelling every endpoint through one cast keeps the
 * scenarios free of `any` and lets the response interfaces above document
 * the contract in one place.
 */
async function typed<T>(
  req: request.Test,
): Promise<{ status: number; body: T }> {
  const res = await req;
  return { status: res.status, body: res.body as T };
}

const createMetric = (
  app: INestApplication<App>,
  input: { name: string; label: string; entity: string; expression: string },
) =>
  typed<SaveResponse>(
    request(app.getHttpServer()).post('/metrics').send(input),
  );

const listMetrics = (app: INestApplication<App>, entities: string) =>
  typed<MetricsListResponse>(
    request(app.getHttpServer()).get(
      `/metrics?entities=${encodeURIComponent(entities)}`,
    ),
  );

const getSchema = (app: INestApplication<App>) =>
  typed<SchemaResponse>(
    request(app.getHttpServer()).get('/data-models/schema.json'),
  );

const modelPath = (name: string) =>
  `/datasets/${encodeURIComponent(name)}/model`;

const getModel = (app: INestApplication<App>, name: string) =>
  typed<ModelResponse>(request(app.getHttpServer()).get(modelPath(name)));

const getModelVersion = (
  app: INestApplication<App>,
  name: string,
  version: number,
) =>
  typed<VersionResponse>(
    request(app.getHttpServer()).get(`${modelPath(name)}/versions/${version}`),
  );

const putModel = (app: INestApplication<App>, name: string, yaml: string) =>
  typed<PutModelResponse>(
    request(app.getHttpServer()).put(modelPath(name)).send({ yaml }),
  );

const revertModel = (
  app: INestApplication<App>,
  name: string,
  version: number,
) =>
  typed<SaveResponse>(
    request(app.getHttpServer())
      .post(`${modelPath(name)}/revert`)
      .send({ version }),
  );

const getDrift = (app: INestApplication<App>, name: string) =>
  typed<DriftResponse>(
    request(app.getHttpServer()).get(`${modelPath(name)}/drift`),
  );

const resolveRefs = (
  app: INestApplication<App>,
  name: string,
  refs: string[],
  version?: number,
) =>
  typed<ResolveResponse>(
    request(app.getHttpServer())
      .post(`${modelPath(name)}/resolve`)
      .send({ refs, ...(version !== undefined ? { version } : {}) }),
  );

/**
 * Finds the line holding an entity's `name: <entity>` key under `entities:`.
 * `serializeDataModel` (the `yaml` package's default block-sequence style)
 * renders each entity as `  - name: <entity>` — the dash and the first key
 * share a line — rather than the dash on its own line, so the match has to
 * tolerate an optional leading `- `. Returns both the line index and the
 * indent new sibling keys (`description:`, `key:`, …) need, which is the
 * dash's own indent plus the two columns `- ` occupies, not the line's bare
 * leading whitespace.
 */
function findEntityNameLine(
  lines: string[],
  entityName: string,
): { index: number; indent: string } {
  const index = lines.findIndex((line) => {
    const trimmed = line.trim();
    return (
      trimmed === `name: ${entityName}` || trimmed === `- name: ${entityName}`
    );
  });
  if (index === -1) {
    throw new Error(
      `Could not find entity "${entityName}" in YAML:\n${lines.join('\n')}`,
    );
  }
  const dash = /^(\s*)-\s/.exec(lines[index]);
  const indent = dash
    ? `${dash[1]}  `
    : (/^(\s*)/.exec(lines[index])?.[1] ?? '');
  return { index, indent };
}

/** Insert `description: <text>` right after an entity's `name: <entity>` line. */
function addEntityDescription(
  yaml: string,
  entityName: string,
  description: string,
): string {
  const lines = yaml.split('\n');
  const { index, indent } = findEntityNameLine(lines, entityName);
  lines.splice(index + 1, 0, `${indent}description: ${description}`);
  return lines.join('\n');
}

/**
 * Points an entity's sql binding `columns.<attribute>` at a column that is
 * not in the dataset snapshot — either by rewriting an existing mapping, or,
 * if none exists yet, injecting a minimal `columns:` map under its binding.
 */
function breakColumnBinding(
  yaml: string,
  entityName: string,
  attribute: string,
  missingColumn: string,
): string {
  const lines = yaml.split('\n');
  const { index: entityIdx } = findEntityNameLine(lines, entityName);
  const tableIdx = lines.findIndex(
    (line, i) => i > entityIdx && line.trim().startsWith('table:'),
  );
  if (tableIdx === -1) {
    throw new Error(
      `Could not find a binding table for "${entityName}" in YAML:\n${yaml}`,
    );
  }
  const existingAttrIdx = lines.findIndex(
    (line, i) => i > tableIdx && line.trim().startsWith(`${attribute}:`),
  );
  if (existingAttrIdx !== -1) {
    const indent = /^(\s*)/.exec(lines[existingAttrIdx])?.[1] ?? '';
    lines[existingAttrIdx] = `${indent}${attribute}: ${missingColumn}`;
    return lines.join('\n');
  }
  const indent = /^(\s*)/.exec(lines[tableIdx])?.[1] ?? '';
  lines.splice(
    tableIdx + 1,
    0,
    `${indent}columns:`,
    `${indent}  ${attribute}: ${missingColumn}`,
  );
  return lines.join('\n');
}

describe('Data model API (e2e)', () => {
  let app: INestApplication<App>;
  let dataDir: string;
  let datasourceId: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'qti-data-models-'));
    ({ app } = await bootApp(dataDir, 'data-models-e2e-secret'));
    datasourceId = await createDatasource(app);
  }, 30000);

  afterAll(async () => {
    await app?.close();
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.APP_DATA_DIR;
    delete process.env.APP_SECRET;
  });

  describe('Scenario: A saved dataset gets a bootstrapped data model', () => {
    it('bootstraps version 1 with bound entities, typed+sampled attributes and the declared join', async () => {
      const name = 'World Cup Core - bootstrap';
      await saveDataset(app, name, datasourceId);

      const res = await getModel(app, name);
      expect(res.status).toBe(200);
      expect(res.body.dataset).toBe(name);
      expect(res.body.currentVersion).toBe(1);
      expect(res.body.version?.version).toBe(1);
      expect(res.body.version?.source).toBe('bootstrap');

      const model = res.body.version.model;
      const matches = model.entities.find((e) => e.name === 'matches');
      const teams = model.entities.find((e) => e.name === 'teams');
      if (!matches || !teams) throw new Error('matches/teams not bootstrapped');
      expect(matches.bindings?.[0]).toMatchObject({
        kind: 'sql',
        table: MATCHES_KEY,
      });
      expect(teams.bindings?.[0]).toMatchObject({
        kind: 'sql',
        table: TEAMS_KEY,
      });

      const attendance = matches.attributes.find(
        (a) => a.name === 'attendance',
      );
      expect(attendance?.type).toBe('integer');
      expect(attendance?.samples?.length ?? 0).toBeGreaterThan(0);
      const matchDate = matches.attributes.find((a) => a.name === 'match_date');
      expect(matchDate?.type).toBe('date');
      const teamName = teams.attributes.find((a) => a.name === 'name');
      expect(teamName?.type).toBe('string');

      const rel = model.relationships.find(
        (r) => r.from === 'matches.home_team_id' && r.to === 'teams.team_id',
      );
      expect(rel?.cardinality).toBe('many_to_one');
      expect(['inferred', 'declared']).toContain(rel?.source);
    });
  });

  describe('Scenario: Re-saving with a new table merges it into a new version', () => {
    it("adds the new entity while drift still reports the existing table's removed/added attributes", async () => {
      const name = 'World Cup Core - merge';
      await saveDatasetWithEntities(
        app,
        name,
        datasourceId,
        [MATCHES_KEY],
        [{ key: MATCHES_KEY, columns: MATCHES_COLUMNS }],
      );

      const before = await getModel(app, name);
      expect(before.status).toBe(200);
      expect(before.body.currentVersion).toBe(1);
      expect(before.body.version.model.entities.map((e) => e.name)).toEqual([
        'matches',
      ]);

      await saveDatasetWithEntities(
        app,
        name,
        datasourceId,
        [MATCHES_KEY, TEAMS_KEY],
        entitiesSnapshot(DRIFTED_MATCHES_COLUMNS),
      );

      const after = await getModel(app, name);
      expect(after.status).toBe(200);
      expect(after.body.currentVersion).toBe(2);
      const names = after.body.version.model.entities.map((e) => e.name);
      expect(names).toEqual(expect.arrayContaining(['matches', 'teams']));
      const matches = after.body.version.model.entities.find(
        (e) => e.name === 'matches',
      );
      // Existing entity/attributes left untouched by the merge.
      expect(matches?.attributes.some((a) => a.name === 'attendance')).toBe(
        true,
      );

      const drift = await getDrift(app, name);
      expect(drift.status).toBe(200);
      expect(drift.body.removed).toContain('matches.attendance');
      expect(drift.body.added).toContain('matches.spectators');
    });
  });

  describe('Scenario: Saving a new model version through YAML', () => {
    it('creates version 2 with source user and leaves version 1 unchanged', async () => {
      const name = 'World Cup Core - yaml version';
      await saveDataset(app, name, datasourceId);

      const before = await getModel(app, name);
      expect(before.status).toBe(200);
      expect(typeof before.body.version?.yaml).toBe('string');

      const yaml = addEntityDescription(
        before.body.version.yaml,
        'matches',
        'One played match',
      );
      const putRes = await putModel(app, name, yaml);
      expect(putRes.status).toBe(200);
      expect(putRes.body.ok).toBe(true);
      expect(putRes.body.version).toBe(2);

      const v1 = await getModelVersion(app, name, 1);
      expect(v1.status).toBe(200);
      expect(v1.body.version).toBe(1);
      expect(v1.body.yaml).not.toContain('One played match');
    });
  });

  describe('Scenario: An invalid model is rejected with a line and column', () => {
    it('rejects a binding that maps an attribute to a missing column', async () => {
      const name = 'World Cup Core - invalid yaml';
      await saveDataset(app, name, datasourceId);

      const before = await getModel(app, name);
      expect(before.status).toBe(200);

      const yaml = breakColumnBinding(
        before.body.version.yaml,
        'matches',
        'attendance',
        'spectators',
      );
      const putRes = await putModel(app, name, yaml);
      expect(putRes.status).toBe(400);
      expect(putRes.body.ok).toBe(false);

      const error = putRes.body.errors?.[0];
      expect(error?.path).toBe('entities[0].bindings[0].columns.attendance');
      expect(typeof error?.line).toBe('number');
      expect(typeof error?.col).toBe('number');

      const current = await getModel(app, name);
      expect(current.body.currentVersion).toBe(1);
    });
  });

  describe('Scenario: Reverting moves the current pointer', () => {
    it('moves currentVersion back without deleting the newer version', async () => {
      const name = 'World Cup Core - revert';
      await saveDataset(app, name, datasourceId);

      const before = await getModel(app, name);
      expect(before.status).toBe(200);
      const yaml = addEntityDescription(
        before.body.version.yaml,
        'matches',
        'One played match',
      );
      const putRes = await putModel(app, name, yaml);
      expect(putRes.status).toBe(200);
      expect(putRes.body.version).toBe(2);

      const revertRes = await revertModel(app, name, 1);
      expect(revertRes.status).toBe(200);
      expect(revertRes.body.ok).toBe(true);
      expect(revertRes.body.currentVersion).toBe(1);

      const after = await getModel(app, name);
      expect(after.body.currentVersion).toBe(1);

      const v2 = await getModelVersion(app, name, 2);
      expect(v2.status).toBe(200);
      expect(v2.body.version).toBe(2);
    });
  });

  describe('Scenario: A changed snapshot yields a drift report, not a new version', () => {
    it('reports removed/added attributes without bumping the current version', async () => {
      const name = 'World Cup Core - drift';
      await saveDataset(app, name, datasourceId, MATCHES_COLUMNS);

      const before = await getModel(app, name);
      expect(before.status).toBe(200);
      expect(before.body.currentVersion).toBe(1);

      await saveDataset(app, name, datasourceId, DRIFTED_MATCHES_COLUMNS);

      const drift = await getDrift(app, name);
      expect(drift.status).toBe(200);
      expect(drift.body.removed).toContain('matches.attendance');
      expect(drift.body.added).toContain('matches.spectators');

      const after = await getModel(app, name);
      expect(after.body.currentVersion).toBe(1);
    });
  });

  describe('Scenario: Logical references resolve against a model version', () => {
    it('resolves entity, attribute, metric and relationship refs, and flags an unknown one', async () => {
      const name = 'World Cup Core - resolve';
      const createMetricRes = await createMetric(app, {
        name: 'match_attendance_avg',
        label: 'Average attendance',
        entity: MATCHES_KEY,
        expression: 'avg(attendance)',
      });
      expect(createMetricRes.body.ok).toBe(true);
      await saveDataset(app, name, datasourceId);

      const res = await resolveRefs(app, name, [
        'matches',
        'matches.attendance',
        'metric:match_attendance_avg',
        'rel:matches.home_team_id->teams.team_id',
        'matches.nope',
      ]);
      expect(res.status).toBe(200);
      const byRef = Object.fromEntries(res.body.results.map((r) => [r.ref, r]));

      expect(byRef['matches']).toMatchObject({
        resolved: true,
        kind: 'entity',
      });
      expect(byRef['matches.attendance']).toMatchObject({
        resolved: true,
        kind: 'attribute',
      });
      expect(byRef['metric:match_attendance_avg']).toMatchObject({
        resolved: true,
        kind: 'metric',
      });
      expect(byRef['rel:matches.home_team_id->teams.team_id']).toMatchObject({
        resolved: true,
        kind: 'relationship',
      });
      expect(byRef['matches.nope']).toMatchObject({ resolved: false });
    });
  });

  describe('Scenario: Compiling a logical query returns dialect SQL without touching the database', () => {
    it('compiles a plain select to valid SQL for the requested dialect', async () => {
      const name = 'World Cup Core - compile';
      await saveDataset(app, name, datasourceId);

      const res = await typed<{
        sql: string;
        entities: string[];
        notes: string[];
      }>(
        request(app.getHttpServer())
          .post(`${modelPath(name)}/compile`)
          .send({
            query: {
              from: 'matches',
              select: [{ attr: 'match_date' }, { attr: 'attendance' }],
              limit: 10,
            },
            dialect: 'postgres',
          }),
      );
      expect(res.status).toBe(200);
      expect(res.body.sql).toContain('SELECT');
      expect(res.body.sql).toContain('LIMIT 10');
      // The *compiled SQL* legitimately names the physical table (the
      // compiler's whole job) — what ADR-0007 forbids is the assistant ever
      // writing or seeing that name itself, proven by `entities` reporting
      // only the logical name back.
      expect(res.body.entities).toEqual(['matches']);

      const databricksRes = await typed<{ sql: string }>(
        request(app.getHttpServer())
          .post(`${modelPath(name)}/compile`)
          .send({
            query: {
              from: 'matches',
              select: [{ attr: 'match_date' }],
              limit: 5,
            },
            dialect: 'databricks',
          }),
      );
      expect(databricksRes.status).toBe(200);
      expect(databricksRes.body.sql).toContain('`');
    });
  });

  describe('Scenario: A logical query naming an unknown attribute or an undeclared relationship is rejected before any database call', () => {
    it('rejects an unknown attribute with a structured issue', async () => {
      const name = 'World Cup Core - reject unknown attribute';
      await saveDataset(app, name, datasourceId);

      const res = await typed<{
        ok: boolean;
        errors: { code: string; path: string }[];
      }>(
        request(app.getHttpServer())
          .post(`${modelPath(name)}/compile`)
          .send({
            query: { from: 'matches', select: [{ attr: 'nope' }], limit: 10 },
          }),
      );
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.errors[0].code).toBe('unknown_attribute');
    });

    it('rejects a reference to an entity with no declared relationship path', async () => {
      const name = 'World Cup Core - reject no path';
      await saveDataset(app, name, datasourceId);

      const res = await typed<{ ok: boolean; errors: { code: string }[] }>(
        request(app.getHttpServer())
          .post(`${modelPath(name)}/compile`)
          .send({
            query: {
              from: 'teams',
              select: [{ attr: 'nonexistent_entity.x' }],
              limit: 10,
            },
          }),
      );
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.errors[0].code).toBe('unknown_attribute');
    });
  });

  describe('Scenario: The JSON Schema of the DSL is published', () => {
    it('publishes a JSON Schema with entities, relationships, metrics and a binding definition', async () => {
      const res = await getSchema(app);
      expect(res.status).toBe(200);
      expect(res.body.properties?.entities).toBeDefined();
      expect(res.body.properties?.relationships).toBeDefined();
      expect(res.body.properties?.metrics).toBeDefined();
      const definitions = res.body.definitions ?? res.body.$defs ?? {};
      expect(definitions.binding ?? definitions.Binding).toBeDefined();
    });
  });
});

describe('Data model API (e2e) — startup bootstrap', () => {
  it('Scenario: Existing datasets are bootstrapped on startup', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'qti-data-models-startup-'));
    try {
      // Seed a dataset doc directly into the sqlite `datasets` table, as if
      // it had been saved before data models existed — the same row shape
      // `SqliteDocStore` itself would create (see sqlite-doc-store.ts /
      // database.module.spec.ts).
      mkdirSync(dataDir, { recursive: true });
      const db = new BetterSqlite3(join(dataDir, 'app.sqlite'));
      db.prepare(
        `CREATE TABLE IF NOT EXISTS "datasets" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`,
      ).run();
      const legacyDataset = {
        name: 'Legacy World Cup',
        tables: [MATCHES_KEY, TEAMS_KEY],
        entities: entitiesSnapshot(),
        datasourceId: 'legacy-datasource',
        datasourceKind: 'postgres',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      db.prepare(`INSERT INTO "datasets" (doc) VALUES (?)`).run(
        JSON.stringify(legacyDataset),
      );
      db.close();

      const { app } = await bootApp(dataDir, 'data-models-e2e-startup-secret');
      try {
        const res = await getModel(app, 'Legacy World Cup');
        expect(res.status).toBe(200);
        expect(res.body.currentVersion).toBe(1);
        expect(res.body.version?.version).toBe(1);
        expect(res.body.version?.source).toBe('bootstrap');
        // Not just "version 1" — the bootstrapped model actually has the
        // entities the legacy snapshot described.
        const entityNames = res.body.version.model.entities.map((e) => e.name);
        expect(entityNames).toEqual(
          expect.arrayContaining(['matches', 'teams']),
        );
      } finally {
        await app.close();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
      delete process.env.APP_DATA_DIR;
      delete process.env.APP_SECRET;
    }
  }, 30000);
});

/**
 * Scenario: Metrics created before the change appear in the model and keep
 * working (gherkin.md "Feature: Data model") — a real upgrade test, not
 * just a same-process create-then-read: a legacy `metrics` row (UUID id,
 * physical entity, expression) and a dataset doc are seeded directly into
 * SQLite *before* the app boots, mirroring a database that predates
 * ADR-0006, then the backend starts and bootstraps a model from them. Its
 * own `describe`/`dataDir` (rather than reusing the shared `app` above) so
 * the seeding happens before `onModuleInit`'s backfill runs.
 */
describe('Data model API (e2e) — legacy metrics upgrade', () => {
  it('Scenario: Metrics created before the change appear in the model and keep working', async () => {
    const dataDir = mkdtempSync(
      join(tmpdir(), 'qti-data-models-legacy-metrics-'),
    );
    try {
      mkdirSync(dataDir, { recursive: true });
      const db = new BetterSqlite3(join(dataDir, 'app.sqlite'));
      db.prepare(
        `CREATE TABLE IF NOT EXISTS "datasets" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`,
      ).run();
      db.prepare(
        `CREATE TABLE IF NOT EXISTS "metrics" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`,
      ).run();

      const name = 'Legacy Metrics World Cup';
      const legacyDataset = {
        name,
        tables: [MATCHES_KEY, TEAMS_KEY],
        entities: entitiesSnapshot(),
        datasourceId: 'legacy-datasource',
        datasourceKind: 'postgres',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      db.prepare(`INSERT INTO "datasets" (doc) VALUES (?)`).run(
        JSON.stringify(legacyDataset),
      );
      const legacyMetricId = 'legacy-metric-uuid-1234';
      const legacyMetric = {
        id: legacyMetricId,
        name: 'avg_attendance',
        label: 'Average attendance',
        entity: MATCHES_KEY,
        expression: 'avg(attendance)',
      };
      db.prepare(`INSERT INTO "metrics" (doc) VALUES (?)`).run(
        JSON.stringify(legacyMetric),
      );
      db.close();

      const { app } = await bootApp(
        dataDir,
        'data-models-e2e-legacy-metrics-secret',
      );
      try {
        const model = await getModel(app, name);
        expect(model.status).toBe(200);
        expect(model.body.currentVersion).toBe(1);
        const entityNames = model.body.version.model.entities.map(
          (e) => e.name,
        );
        expect(entityNames).toEqual(
          expect.arrayContaining(['matches', 'teams']),
        );

        const avgMetric = model.body.version.model.metrics.find(
          (m) => m.name === 'avg_attendance',
        );
        expect(avgMetric?.entity).toBe('matches');
        expect(avgMetric?.expressions?.sql).toBe('avg(attendance)');

        // The legacy `metrics` store is still the panel's editor of record
        // — the UUID id seeded above survives untouched.
        const legacyList = await listMetrics(app, MATCHES_KEY);
        const found = legacyList.body.metrics.find(
          (m) => m.name === 'avg_attendance',
        );
        expect(found?.id).toBe(legacyMetricId);

        const createGoals = await createMetric(app, {
          name: 'goals_per_match',
          label: 'Goals per match',
          entity: MATCHES_KEY,
          expression: 'count(*)',
        });
        expect(createGoals.body.ok).toBe(true);

        const current = await getModel(app, name);
        expect(current.body.currentVersion).toBe(2);
        expect(
          current.body.version.model.metrics.some(
            (m) => m.name === 'goals_per_match',
          ),
        ).toBe(true);
      } finally {
        await app.close();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
      delete process.env.APP_DATA_DIR;
      delete process.env.APP_SECRET;
    }
  }, 30000);
});
