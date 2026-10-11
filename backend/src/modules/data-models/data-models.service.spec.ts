import BetterSqlite3 from 'better-sqlite3';
import { BadRequestException } from '@nestjs/common';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { DataModelsService } from './data-models.service';
import { DataModelsRepository } from './repositories/data-models.repository';
import { worldCupFixture } from './dsl/__fixtures__/world-cup.fixture';
import { serializeDataModel } from './dsl/yaml';
import type { DataModelDoc } from './repositories/data-models.repository';
import type { DatasetDoc } from '../datasets/repositories/datasets.repository';
import type { MetricDoc } from '../metrics/entities/metric.entity';

/**
 * Real `SqliteDocStore`s over an in-memory database — same spirit as
 * `knowledge.repository.spec.ts`: the service is exercised against the
 * actual `DocStore` adapter instead of a hand-rolled fake, so its
 * read-modify-write version bookkeeping is checked against real semantics
 * (shallow-merge patches, store-stamped timestamps).
 */
function build() {
  const db = new BetterSqlite3(':memory:');
  const dataModelsStore = new SqliteDocStore<DataModelDoc>(db, 'data_models');
  const datasetsStore = new SqliteDocStore<DatasetDoc>(db, 'datasets');
  const metricsStore = new SqliteDocStore<MetricDoc>(db, 'metrics');
  const repository = new DataModelsRepository(dataModelsStore);
  const service = new DataModelsService(
    repository,
    datasetsStore,
    metricsStore,
  );
  return {
    service,
    repository,
    dataModelsStore,
    datasetsStore,
    metricsStore,
    db,
  };
}

/**
 * Text-edit helpers mirrored from `test/data-models.e2e-spec.ts` (see that
 * file's `findEntityNameLine` for why the match tolerates an optional
 * leading `- `: `serializeDataModel`'s block-sequence style puts the dash
 * and an entity's first key, `name:`, on the same line).
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
  if (index === -1) throw new Error(`entity "${entityName}" not found in yaml`);
  const dash = /^(\s*)-\s/.exec(lines[index]);
  const indent = dash
    ? `${dash[1]}  `
    : (/^(\s*)/.exec(lines[index])?.[1] ?? '');
  return { index, indent };
}

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
  if (tableIdx === -1)
    throw new Error(`no binding table found for "${entityName}"`);
  const indent = /^(\s*)/.exec(lines[tableIdx])?.[1] ?? '';
  lines.splice(
    tableIdx + 1,
    0,
    `${indent}columns:`,
    `${indent}  ${attribute}: ${missingColumn}`,
  );
  return lines.join('\n');
}

const MATCHES_KEY = 'world_cup.world_cup.matches';
const TEAMS_KEY = 'world_cup.world_cup.teams';

function worldCupDataset(overrides: Partial<DatasetDoc> = {}): DatasetDoc {
  return {
    name: 'World Cup Core',
    datasourceId: 'ds-1',
    datasourceKind: 'postgres',
    tables: [MATCHES_KEY, TEAMS_KEY],
    entities: [
      {
        key: MATCHES_KEY,
        columns: [
          { name: 'match_id', type: 'bigint', nullable: false },
          { name: 'attendance', type: 'integer', nullable: true },
        ],
      },
      {
        key: TEAMS_KEY,
        columns: [{ name: 'team_id', type: 'bigint', nullable: false }],
      },
    ],
    ...overrides,
  };
}

describe('DataModelsService.ensureBootstrapped', () => {
  it('creates v1 from the snapshot, and is a no-op once a model exists', async () => {
    const { service } = build();
    const dataset = worldCupDataset();

    const first = await service.ensureBootstrapped(dataset);
    expect(first.currentVersion).toBe(1);
    expect(first.versions[0].source).toBe('bootstrap');

    const second = await service.ensureBootstrapped(dataset);
    expect(second.versions).toHaveLength(1);
  });

  it('imports a legacy metric bound to one of the dataset tables', async () => {
    const { service, metricsStore } = build();
    await metricsStore.insert({
      id: 'm1',
      name: 'avg_attendance',
      label: 'Average attendance',
      entity: MATCHES_KEY,
      expression: 'avg(attendance)',
    });

    const doc = await service.ensureBootstrapped(worldCupDataset());

    expect(doc.versions[0].model.metrics).toEqual([
      expect.objectContaining({ name: 'avg_attendance', entity: 'matches' }),
    ]);
  });
});

describe('DataModelsService.onModuleInit', () => {
  it('bootstraps every dataset that has no model yet', async () => {
    const { service, datasetsStore } = build();
    await datasetsStore.insert(worldCupDataset());
    await datasetsStore.insert(worldCupDataset({ name: 'Second dataset' }));

    await service.onModuleInit();

    expect((await service.get('World Cup Core'))?.currentVersion).toBe(1);
    expect((await service.get('Second dataset'))?.currentVersion).toBe(1);
  });

  it('does not re-bootstrap a dataset that already has a model', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    await service.saveYaml(
      'World Cup Core',
      (await service.get('World Cup Core'))!.versions[0].yaml,
    );

    await service.onModuleInit();

    expect((await service.get('World Cup Core'))?.currentVersion).toBe(2);
  });
});

describe('DataModelsService.recordDrift / drift', () => {
  it('stores a drift report without creating a version', async () => {
    const dataset = worldCupDataset();
    const { service } = build();
    await service.ensureBootstrapped(dataset);

    const drifted = worldCupDataset({
      entities: [
        {
          key: MATCHES_KEY,
          columns: [
            { name: 'match_id', type: 'bigint', nullable: false },
            { name: 'spectators', type: 'integer', nullable: true },
          ],
        },
        dataset.entities![1],
      ],
    });
    const report = await service.recordDrift(drifted);

    expect(report.removed).toContain('matches.attendance');
    expect(report.added).toContain('matches.spectators');
    expect(await service.drift('World Cup Core')).toEqual(report);
    expect((await service.get('World Cup Core'))?.currentVersion).toBe(1);
  });

  it('computes an empty report on demand before any re-save', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);

    const report = await service.drift('World Cup Core');

    expect(report.snapshotOf).toBe(1);
    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(report.changed).toEqual([]);
  });

  it('rejects a drift request for an unbootstrapped dataset', async () => {
    const { service } = build();

    await expect(service.drift('Missing')).rejects.toThrow(/No data model/);
  });
});

describe('DataModelsService.saveYaml', () => {
  it('appends a user version and leaves the previous one unchanged', async () => {
    const dataset = worldCupDataset();
    const { service, datasetsStore } = build();
    // `saveYaml` re-validates against the *live* dataset snapshot in
    // `DATASETS_STORE` (every binding's table must be part of it — review
    // finding 5), so the dataset needs to actually be in the store.
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    const v1 = (await service.get('World Cup Core'))!.versions[0];

    const edited = addEntityDescription(v1.yaml, 'matches', 'One played match');
    const result = await service.saveYaml('World Cup Core', edited);

    expect(result.version).toBe(2);
    const doc = await service.get('World Cup Core');
    expect(doc?.currentVersion).toBe(2);
    expect(doc?.versions[0].yaml).toBe(v1.yaml);
    expect(doc?.versions[1].source).toBe('user');
    expect(doc?.versions[1].model.entities[0].description).toBe(
      'One played match',
    );
  });

  it('rejects yaml whose binding maps an attribute to a missing column, with a location', async () => {
    // `saveYaml` re-validates against the *live* dataset snapshot in
    // `DATASETS_STORE`, so (unlike the bootstrap tests above, which hand the
    // snapshot straight to `bootstrapFromSnapshot`) the dataset needs to
    // actually be in the store for this check to run at all.
    const dataset = worldCupDataset();
    const { service, datasetsStore } = build();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    const v1 = (await service.get('World Cup Core'))!.versions[0];

    const broken = breakColumnBinding(
      v1.yaml,
      'matches',
      'attendance',
      'spectators',
    );

    const thrown = await service
      .saveYaml('World Cup Core', broken)
      .catch((err: unknown) => err);

    expect(thrown).toBeInstanceOf(BadRequestException);
    const response = (thrown as BadRequestException).getResponse() as {
      ok: boolean;
      errors: { path: string; line?: number; col?: number }[];
    };
    expect(response.ok).toBe(false);
    expect(response.errors[0]).toMatchObject({
      path: 'entities[0].bindings[0].columns.attendance',
    });
    expect(typeof response.errors[0].line).toBe('number');
    expect(typeof response.errors[0].col).toBe('number');
    expect((await service.get('World Cup Core'))?.currentVersion).toBe(1);
  });
});

describe('DataModelsService.revert', () => {
  it('moves currentVersion without deleting the newer version', async () => {
    const dataset = worldCupDataset();
    const { service, datasetsStore } = build();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    const v1Yaml = (await service.get('World Cup Core'))!.versions[0].yaml;
    await service.saveYaml(
      'World Cup Core',
      addEntityDescription(v1Yaml, 'matches', 'v2'),
    );

    const reverted = await service.revert('World Cup Core', 1);

    expect(reverted.currentVersion).toBe(1);
    const doc = await service.get('World Cup Core');
    expect(doc?.currentVersion).toBe(1);
    expect(doc?.versions).toHaveLength(2);
  });

  it('rejects reverting to a version that does not exist', async () => {
    const { service } = build();
    await service.ensureBootstrapped(worldCupDataset());

    await expect(service.revert('World Cup Core', 9)).rejects.toThrow(
      /not found/,
    );
  });
});

describe('DataModelsService.resolve', () => {
  it('resolves entity/attribute/metric/relationship refs and flags an unknown one', async () => {
    const { service, dataModelsStore } = build();
    const model = worldCupFixture();
    const now = new Date().toISOString();
    await dataModelsStore.insert({
      dataset: model.model,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          createdAt: now,
          source: 'bootstrap',
          yaml: serializeDataModel(model),
          model,
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const results = await service.resolve(model.model, [
      'teams',
      'teams.name',
      'metric:avg_attendance',
      'rel:matches_home_team',
      'teams.nope',
    ]);

    expect(results.find((r) => r.ref === 'teams')).toMatchObject({
      resolved: true,
      kind: 'entity',
    });
    expect(results.find((r) => r.ref === 'teams.name')).toMatchObject({
      resolved: true,
      kind: 'attribute',
    });
    expect(
      results.find((r) => r.ref === 'metric:avg_attendance'),
    ).toMatchObject({
      resolved: true,
      kind: 'metric',
    });
    expect(
      results.find((r) => r.ref === 'rel:matches_home_team'),
    ).toMatchObject({
      resolved: true,
      kind: 'relationship',
    });
    expect(results.find((r) => r.ref === 'teams.nope')).toMatchObject({
      resolved: false,
    });
  });
});

describe('DataModelsService.rebootstrap', () => {
  it('bumps the version and keeps the current version metrics over a fresh bootstrap', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    await service.syncMetric({
      id: 'm-hand',
      name: 'hand_added',
      label: 'Hand added',
      entity: MATCHES_KEY,
      expression: 'count(*)',
    });

    const doc = await service.rebootstrap('World Cup Core');

    expect(doc.currentVersion).toBe(3); // bootstrap (1) + sync (2) + rebootstrap (3)
    const metricNames = doc.versions[doc.currentVersion - 1].model.metrics.map(
      (m) => m.name,
    );
    expect(metricNames).toContain('hand_added');
  });
});

describe('DataModelsService.syncMetric / removeMetric (metrics-panel sync, review finding A)', () => {
  it("is a no-op when no current model binds the metric's entity", async () => {
    const { service } = build();

    const touched = await service.syncMetric({
      id: 'm-x',
      name: 'x',
      label: 'X',
      entity: 'nowhere.nowhere.nowhere',
      expression: 'count(*)',
    });

    expect(touched).toEqual([]);
  });

  it('writes the metric to every model binding the entity, in one new version each', async () => {
    const { service } = build();
    await service.ensureBootstrapped(worldCupDataset());
    await service.ensureBootstrapped(
      worldCupDataset({ name: 'Second dataset' }),
    );

    const touched = await service.syncMetric({
      id: 'm-goals',
      name: 'goals_per_match',
      label: 'Goals per match',
      entity: MATCHES_KEY,
      expression: 'count(*)',
      dimensions: ['match_id'],
    });

    expect(touched.sort()).toEqual(['Second dataset', 'World Cup Core']);
    const doc = await service.get('World Cup Core');
    const current = doc!.versions[doc!.currentVersion - 1];
    expect(current.source).toBe('bootstrap');
    expect(current.note).toContain('goals_per_match');
    const metric = current.model.metrics.find(
      (m) => m.name === 'goals_per_match',
    );
    expect(metric?.entity).toBe('matches');
    expect(metric?.dimensions).toEqual(['match_id']);
  });

  it('removes a stale copy from every model when the physical entity changes (no duplicate version)', async () => {
    const { service } = build();
    await service.ensureBootstrapped(worldCupDataset());
    await service.syncMetric({
      id: 'm-rel',
      name: 'relocatable',
      label: 'Relocatable',
      entity: MATCHES_KEY,
      expression: 'count(*)',
    });
    const afterFirstSync = (await service.get('World Cup Core'))!
      .currentVersion;

    // Same metric name, now bound to "teams" instead of "matches" — the
    // stale copy on "matches" must be gone, and there is exactly one new
    // version for this one sync, not two.
    await service.syncMetric({
      id: 'm-rel',
      name: 'relocatable',
      label: 'Relocatable',
      entity: TEAMS_KEY,
      expression: 'count(*)',
    });

    const doc = await service.get('World Cup Core');
    expect(doc!.currentVersion).toBe(afterFirstSync + 1);
    const current = doc!.versions[doc!.currentVersion - 1];
    const metric = current.model.metrics.find((m) => m.name === 'relocatable');
    expect(metric?.entity).toBe('teams');
  });

  it('removeMetric removes it from every model that has it', async () => {
    const { service } = build();
    await service.ensureBootstrapped(worldCupDataset());
    await service.syncMetric({
      id: 'm-temp',
      name: 'temp_metric',
      label: 'Temp',
      entity: MATCHES_KEY,
      expression: 'count(*)',
    });

    const touched = await service.removeMetric('temp_metric');

    expect(touched).toEqual(['World Cup Core']);
    const doc = await service.get('World Cup Core');
    const current = doc!.versions[doc!.currentVersion - 1];
    expect(current.model.metrics.some((m) => m.name === 'temp_metric')).toBe(
      false,
    );
  });

  it('removeMetric is a no-op when nothing has that metric', async () => {
    const { service } = build();
    await service.ensureBootstrapped(worldCupDataset());

    expect(await service.removeMetric('nope')).toEqual([]);
  });
});

describe('DataModelsService.mergeSnapshot (review finding B)', () => {
  it('does nothing beyond recording drift when every table is already bound', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);

    const doc = await service.mergeSnapshot(dataset);

    expect(doc.currentVersion).toBe(1);
    expect(doc.versions).toHaveLength(1);
  });

  it('adds a newly-included table as one new version, leaving existing entities untouched', async () => {
    const { service, datasetsStore } = build();
    const matchesOnly = worldCupDataset({
      tables: [MATCHES_KEY],
      entities: [
        {
          key: MATCHES_KEY,
          columns: [
            { name: 'match_id', type: 'bigint', nullable: false },
            { name: 'attendance', type: 'integer', nullable: true },
          ],
        },
      ],
    });
    await datasetsStore.insert(matchesOnly);
    await service.ensureBootstrapped(matchesOnly);

    const withTeams = worldCupDataset();
    const doc = await service.mergeSnapshot(withTeams);

    expect(doc.currentVersion).toBe(2);
    const current = doc.versions[1];
    expect(current.source).toBe('bootstrap');
    expect(current.note).toContain('merged 1 new entities');
    const names = current.model.entities.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['matches', 'teams']));
    // The pre-existing "matches" entity's attributes are untouched.
    const matches = current.model.entities.find((e) => e.name === 'matches');
    expect(matches!.attributes.some((a) => a.name === 'attendance')).toBe(true);

    // The drift report was recorded *before* the merge added "teams" (it
    // compares against the version current at the time), so it still shows
    // "teams" as an unbound table at that moment — the merge and the drift
    // report are two different concerns computed from the same snapshot.
    const drift = await service.drift('World Cup Core');
    expect(drift.entitiesAdded).toEqual(['teams']);
  });
});

describe('DataModelsService.delete', () => {
  it('removes the data model document', async () => {
    const { service } = build();
    await service.ensureBootstrapped(worldCupDataset());

    expect(await service.delete('World Cup Core')).toBe(1);
    expect(await service.get('World Cup Core')).toBeNull();
  });
});

describe('DataModelsService.exportYaml / importYaml (roadmap 1.2.3)', () => {
  it('exports the current version verbatim, and any other version on request', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    const v1 = await service.get('World Cup Core');
    const yamlV2 = addEntityDescription(
      v1!.versions[0].yaml,
      'matches',
      'One played match',
    );
    await service.saveYaml('World Cup Core', yamlV2);

    const current = await service.exportYaml('World Cup Core');
    expect(current.version).toBe(2);
    expect(current.yaml).toContain('One played match');

    const original = await service.exportYaml('World Cup Core', 1);
    expect(original.version).toBe(1);
    expect(original.yaml).not.toContain('One played match');
  });

  it('rejects exporting a version that does not exist', async () => {
    const { service } = build();
    await service.ensureBootstrapped(worldCupDataset());
    await expect(service.exportYaml('World Cup Core', 99)).rejects.toThrow();
  });

  it('imports a valid yaml as a new "import" version', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    const v1 = await service.get('World Cup Core');
    const yaml = addEntityDescription(
      v1!.versions[0].yaml,
      'matches',
      'Imported description',
    );

    const result = await service.importYaml('World Cup Core', yaml);

    expect(result.version).toBe(2);
    const doc = await service.get('World Cup Core');
    const imported = doc!.versions[1];
    expect(imported.source).toBe('import');
    expect(
      imported.model.entities.find((e) => e.name === 'matches')?.description,
    ).toBe('Imported description');
    // v1 is untouched.
    expect(doc!.versions[0].yaml).not.toContain('Imported description');
  });

  it('rejects an invalid import without changing the current version', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    const v1 = await service.get('World Cup Core');
    const yaml = breakColumnBinding(
      v1!.versions[0].yaml,
      'matches',
      'attendance',
      'nope',
    );

    await expect(
      service.importYaml('World Cup Core', yaml),
    ).rejects.toBeInstanceOf(BadRequestException);

    const doc = await service.get('World Cup Core');
    expect(doc!.currentVersion).toBe(1);
  });
});

describe('DataModelsService.serializeModel (roadmap 1.2.3)', () => {
  it('serializes a well-formed model the same way saveYaml would', () => {
    const { service } = build();
    const yaml = service.serializeModel(worldCupFixture());
    expect(yaml).toContain('model: world_cup');
    expect(yaml).toContain('entities:');
  });

  it('rejects a malformed/partial draft with located-less issues instead of silently coercing it (review finding 12)', () => {
    const { service } = build();
    expect(() =>
      service.serializeModel({ model: 'partial', version: 1 }),
    ).toThrow(BadRequestException);
  });

  it('rejects a non-object body', () => {
    const { service } = build();
    expect(() => service.serializeModel(undefined)).toThrow(
      BadRequestException,
    );
  });
});

describe('DataModelsService model-scoped metrics (roadmap 1.2.3)', () => {
  it('creates a model-local metric as a new user version, listed by listModelMetrics', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);

    const result = await service.createModelMetric('World Cup Core', {
      name: 'goals_per_match',
      label: 'Goals per match',
      entity: 'matches',
      agg: 'count',
    });

    expect(result.version).toBe(2);
    const doc = await service.get('World Cup Core');
    expect(doc!.versions[1].source).toBe('user');
    expect(doc!.localMetricNames).toEqual(['goals_per_match']);
    const metrics = await service.listModelMetrics('World Cup Core');
    expect(metrics.some((m) => m.name === 'goals_per_match')).toBe(true);
  });

  it('rejects a metric referencing an unknown entity, leaving the current version untouched', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);

    await expect(
      service.createModelMetric('World Cup Core', {
        name: 'bad_metric',
        label: 'Bad metric',
        entity: 'nope',
        agg: 'count',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const doc = await service.get('World Cup Core');
    expect(doc!.currentVersion).toBe(1);
  });

  it('updates a metric by name, renaming it and re-registering the new local name', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    await service.createModelMetric('World Cup Core', {
      name: 'goals_per_match',
      label: 'Goals per match',
      entity: 'matches',
      agg: 'count',
    });

    const result = await service.updateModelMetric(
      'World Cup Core',
      'goals_per_match',
      {
        name: 'total_goals',
        label: 'Total goals',
        entity: 'matches',
        agg: 'count',
      },
    );

    expect(result.version).toBe(3);
    const doc = await service.get('World Cup Core');
    expect(doc!.localMetricNames).toEqual(['total_goals']);
    const metrics = await service.listModelMetrics('World Cup Core');
    expect(metrics.some((m) => m.name === 'goals_per_match')).toBe(false);
    expect(metrics.some((m) => m.name === 'total_goals')).toBe(true);
  });

  it('rejects updating a metric name that does not exist', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);

    await expect(
      service.updateModelMetric('World Cup Core', 'nope', {
        name: 'nope',
        label: 'Nope',
        entity: 'matches',
        agg: 'count',
      }),
    ).rejects.toThrow();
  });

  it('deletes a metric by name and drops it from localMetricNames', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    await service.createModelMetric('World Cup Core', {
      name: 'goals_per_match',
      label: 'Goals per match',
      entity: 'matches',
      agg: 'count',
    });

    const result = await service.deleteModelMetric(
      'World Cup Core',
      'goals_per_match',
    );

    expect(result.version).toBe(3);
    const doc = await service.get('World Cup Core');
    expect(doc!.localMetricNames).toEqual([]);
    const metrics = await service.listModelMetrics('World Cup Core');
    expect(metrics.some((m) => m.name === 'goals_per_match')).toBe(false);
  });

  it('rejects deleting a metric name that does not exist', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);

    await expect(
      service.deleteModelMetric('World Cup Core', 'nope'),
    ).rejects.toThrow();
  });
});

describe('DataModelsService merge-rule flip (roadmap 1.2.3): the model wins for names it manages itself', () => {
  it('syncMetric skips a model whose localMetricNames already has this name', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    await service.createModelMetric('World Cup Core', {
      name: 'goals_per_match',
      label: 'Goals per match (model-authored)',
      entity: 'matches',
      agg: 'count',
    });
    const versionBeforeSync = (await service.get('World Cup Core'))!
      .currentVersion;

    // A legacy metrics-panel write of the SAME name, bound to a different
    // physical table, must not touch the model's own definition.
    const touched = await service.syncMetric({
      id: 'legacy-1',
      name: 'goals_per_match',
      label: 'Goals per match (legacy)',
      entity: TEAMS_KEY,
      expression: 'count(*)',
    });

    expect(touched).toEqual([]);
    const doc = await service.get('World Cup Core');
    expect(doc!.currentVersion).toBe(versionBeforeSync);
    const metric = doc!.versions[doc!.currentVersion - 1].model.metrics.find(
      (m) => m.name === 'goals_per_match',
    );
    expect(metric?.label).toBe('Goals per match (model-authored)');
  });

  it('removeMetric skips a model whose localMetricNames already has this name', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    await service.createModelMetric('World Cup Core', {
      name: 'goals_per_match',
      label: 'Goals per match',
      entity: 'matches',
      agg: 'count',
    });
    const versionBeforeRemove = (await service.get('World Cup Core'))!
      .currentVersion;

    const touched = await service.removeMetric('goals_per_match');

    expect(touched).toEqual([]);
    const doc = await service.get('World Cup Core');
    expect(doc!.currentVersion).toBe(versionBeforeRemove);
    const metrics = await service.listModelMetrics('World Cup Core');
    expect(metrics.some((m) => m.name === 'goals_per_match')).toBe(true);
  });

  it('syncMetric still mirrors a legacy write for a name the model does not manage itself', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);

    const touched = await service.syncMetric({
      id: 'legacy-2',
      name: 'legacy_only',
      label: 'Legacy only',
      entity: MATCHES_KEY,
      expression: 'count(*)',
    });

    expect(touched).toEqual(['World Cup Core']);
    const metrics = await service.listModelMetrics('World Cup Core');
    expect(metrics.some((m) => m.name === 'legacy_only')).toBe(true);
  });
});

describe('DataModelsService delete tombstone (review finding 6): a deleted metric does not come back', () => {
  it('deleteModelMetric records a tombstone that rebootstrap honours', async () => {
    const { service, datasetsStore, metricsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await metricsStore.insert({
      id: 'legacy-1',
      name: 'avg_attendance',
      label: 'Average attendance',
      entity: MATCHES_KEY,
      expression: 'avg(attendance)',
    });
    await service.ensureBootstrapped(dataset);
    const beforeDelete = await service.get('World Cup Core');
    expect(
      beforeDelete!.versions[0].model.metrics.some(
        (m) => m.name === 'avg_attendance',
      ),
    ).toBe(true);

    await service.deleteModelMetric('World Cup Core', 'avg_attendance');
    const afterDelete = await service.get('World Cup Core');
    expect(afterDelete!.deletedMetricNames).toEqual(['avg_attendance']);
    expect(
      (await service.listModelMetrics('World Cup Core')).some(
        (m) => m.name === 'avg_attendance',
      ),
    ).toBe(false);

    // Rebootstrap re-derives from the (still-present) legacy metric — the
    // tombstone must stop it from reappearing.
    await service.rebootstrap('World Cup Core');

    expect(
      (await service.listModelMetrics('World Cup Core')).some(
        (m) => m.name === 'avg_attendance',
      ),
    ).toBe(false);
  });

  it('mergeSnapshot does not resurrect a deleted metric for a newly-merged entity', async () => {
    const { service, repository, datasetsStore, metricsStore } = build();
    const matchesOnly = worldCupDataset({
      tables: [MATCHES_KEY],
      entities: [
        {
          key: MATCHES_KEY,
          columns: [
            { name: 'match_id', type: 'bigint', nullable: false },
            { name: 'attendance', type: 'integer', nullable: true },
          ],
        },
      ],
    });
    await datasetsStore.insert(matchesOnly);
    // A legacy metric on "teams" — not yet part of the model, since "teams"
    // is not bound yet; bootstrap would otherwise map it in once it is.
    await metricsStore.insert({
      id: 'legacy-teams-1',
      name: 'team_count',
      label: 'Team count',
      entity: TEAMS_KEY,
      expression: 'count(*)',
    });
    await service.ensureBootstrapped(matchesOnly);
    // Tombstone "team_count" directly (simulating "the model used to have
    // this and the user deleted it" without needing the full create/bind/
    // delete lifecycle, which the other tests in this block already cover).
    const doc = await service.get('World Cup Core');
    await repository.save({ ...doc!, deletedMetricNames: ['team_count'] });

    // Merging in "teams" would, without the tombstone, pick up the legacy
    // "team_count" metric for the newly-bound entity.
    const withTeams = worldCupDataset();
    const merged = await service.mergeSnapshot(withTeams);

    const current = merged.versions[merged.versions.length - 1];
    expect(current.model.entities.map((e) => e.name)).toContain('teams');
    expect(current.model.metrics.some((m) => m.name === 'team_count')).toBe(
      false,
    );
  });

  it('syncMetric skips a model that has tombstoned this name', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    await service.createModelMetric('World Cup Core', {
      name: 'goals_per_match',
      label: 'Goals per match',
      entity: 'matches',
      agg: 'count',
    });
    await service.deleteModelMetric('World Cup Core', 'goals_per_match');
    const versionBeforeSync = (await service.get('World Cup Core'))!
      .currentVersion;

    const touched = await service.syncMetric({
      id: 'legacy-1',
      name: 'goals_per_match',
      label: 'Goals per match (legacy)',
      entity: MATCHES_KEY,
      expression: 'count(*)',
    });

    expect(touched).toEqual([]);
    const doc = await service.get('World Cup Core');
    expect(doc!.currentVersion).toBe(versionBeforeSync);
    expect(
      (await service.listModelMetrics('World Cup Core')).some(
        (m) => m.name === 'goals_per_match',
      ),
    ).toBe(false);
  });

  it('recreating a deleted metric clears its tombstone', async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    await service.createModelMetric('World Cup Core', {
      name: 'goals_per_match',
      label: 'Goals per match',
      entity: 'matches',
      agg: 'count',
    });
    await service.deleteModelMetric('World Cup Core', 'goals_per_match');
    expect((await service.get('World Cup Core'))!.deletedMetricNames).toEqual([
      'goals_per_match',
    ]);

    await service.createModelMetric('World Cup Core', {
      name: 'goals_per_match',
      label: 'Goals per match (recreated)',
      entity: 'matches',
      agg: 'count',
    });

    const doc = await service.get('World Cup Core');
    expect(doc!.deletedMetricNames).toEqual([]);
    expect(
      (await service.listModelMetrics('World Cup Core')).some(
        (m) => m.name === 'goals_per_match',
      ),
    ).toBe(true);
  });

  it("deleteModelMetric rejects deleting a metric another metric's ratio still references (review finding 5)", async () => {
    const { service, datasetsStore } = build();
    const dataset = worldCupDataset();
    await datasetsStore.insert(dataset);
    await service.ensureBootstrapped(dataset);
    await service.createModelMetric('World Cup Core', {
      name: 'wins',
      label: 'Wins',
      entity: 'matches',
      agg: 'count',
    });
    await service.createModelMetric('World Cup Core', {
      name: 'losses',
      label: 'Losses',
      entity: 'matches',
      agg: 'count',
    });
    await service.createModelMetric('World Cup Core', {
      name: 'win_rate',
      label: 'Win rate',
      entity: 'matches',
      agg: 'ratio',
      numerator: 'wins',
      denominator: 'losses',
    });
    const versionBeforeDelete = (await service.get('World Cup Core'))!
      .currentVersion;

    await expect(
      service.deleteModelMetric('World Cup Core', 'wins'),
    ).rejects.toBeInstanceOf(BadRequestException);

    const doc = await service.get('World Cup Core');
    expect(doc!.currentVersion).toBe(versionBeforeDelete);
    expect(
      (await service.listModelMetrics('World Cup Core')).some(
        (m) => m.name === 'wins',
      ),
    ).toBe(true);
  });
});
