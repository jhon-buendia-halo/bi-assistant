/**
 * API-level proof of the three org server scenarios of "Feature: Data model"
 * in specs/capabilities/data-model/spec.md (the others run in local mode in
 * `data-models.e2e-spec.ts`):
 *
 * - Metrics of every user are imported into the shared model at startup
 * - A name clash keeps the first metric and reports the rest
 * - A caller without Manage datasources cannot change a model
 * - A legacy metric removed in the YAML stays removed after a restart
 *
 * and of data-model R34-R39, api.md 2.16 (92, 95, 98, 102, 104: the drift
 * response's `metricsImport`), the 1.9 permission rows for data models and
 * data-model.md 3.16 (`author`, `authorName`, `lastMetricsImport`,
 * `deletedMetricNames`).
 *
 * It drives the BUILT backend (`npm run build` first) in org server mode
 * against the OIDC stub, and restarts it on the same data directory. Ada and
 * Grace create their legacy metrics through `POST /metrics` (owner-private,
 * so each carries its `ownerId`); their `createdAt` is then pinned so "the
 * first one" does not depend on the clock. The dataset is written straight
 * into `app.sqlite` the way a save stores it, with its entity snapshot, so
 * the startup bootstrap needs no Postgres: it reads only the snapshot
 * (ADR-0012, specs/system/architecture.md).
 */
import { type OrgServer, startOrgServer } from './org-server';

jest.setTimeout(240_000);

const ADMIN = 'admin@contoso.test';
const ADA = { email: 'ada@contoso.test', name: 'Ada Lovelace' };
const GRACE = { email: 'grace@contoso.test', name: 'Grace Hopper' };
const UNA = { email: 'user@contoso.test', name: 'Una User' };

const DATASET = 'World Cup Core';
const DATASET_PATH = `/datasets/${encodeURIComponent(DATASET)}`;
const MATCHES_KEY = 'world_cup.world_cup.matches';

/** `Metric` of a model version, with the `author` and `authorName`
 * data-model 3.16 adds. */
interface ModelMetric {
  name: string;
  label: string;
  entity: string;
  expressions?: { sql?: string };
  author?: string;
  authorName?: string;
}

interface ModelVersion {
  version: number;
  source: string;
  yaml: string;
  model: { metrics: ModelMetric[] } & Record<string, unknown>;
}

/** `GET /datasets/:name/model` (api.md 92). */
interface ModelResponse {
  dataset: string;
  currentVersion: number;
  version: ModelVersion;
}

/** `MetricsImportReport` (api.md 98, data-model.md 3.16). */
interface MetricsImportReport {
  importedAt: string;
  imported: {
    name: string;
    entity: string;
    author?: string;
    authorName?: string;
    sourceId: string;
  }[];
  skipped: {
    name: string;
    author?: string;
    authorName?: string;
    sourceId: string;
    reason: 'name_clash';
    keptSourceId?: string;
  }[];
}

describe('Org server API: the shared data model and its imported metrics', () => {
  let org: OrgServer;
  const cookies = { admin: '', ada: '', grace: '', una: '' };
  const ids = { ada: '', grace: '' };
  /** Legacy metric ids (`sourceId` in the import report). */
  const metricIds = { adaAvg: '', graceAvg: '', graceMax: '' };

  const call = async (
    cookie: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const res = await org.api(path, { method, cookie, body });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (the YAML export): keep the text.
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };

  const meId = async (cookie: string) =>
    ((await call(cookie, 'GET', '/me')).body as { user: { id: string } }).user
      .id;

  /** The display name `/me` answers: the `users` document's `displayName`. */
  const meName = async (cookie: string) =>
    (
      (await call(cookie, 'GET', '/me')).body as {
        user: { displayName: string };
      }
    ).user.displayName;

  /** Every person signs in again: a restart is a new process. */
  const signInAll = async () => {
    cookies.admin = await org.signIn(ADMIN);
    cookies.ada = await org.signIn(ADA);
    cookies.grace = await org.signIn(GRACE);
    cookies.una = await org.signIn(UNA);
  };

  const getModel = async (cookie: string) => {
    const res = await call(cookie, 'GET', `${DATASET_PATH}/model`);
    return { status: res.status, body: res.body as ModelResponse };
  };

  const createLegacyMetric = async (
    cookie: string,
    metric: { name: string; label: string; expression: string },
    createdAt: string,
  ) => {
    const res = await call(cookie, 'POST', '/metrics', {
      ...metric,
      entity: MATCHES_KEY,
    });
    const body = res.body as { ok: boolean; metric: { id: string } };
    expect(body.ok).toBe(true);
    const id = body.metric.id;
    // Pin the creation time: the first by createdAt (then id) wins (R34).
    expect(org.patchDoc('metrics', { id }, { createdAt })).toBe(1);
    return id;
  };

  beforeAll(async () => {
    org = await startOrgServer({ bootstrapAdmins: [ADMIN] });
    await signInAll();
    ids.ada = await meId(cookies.ada);
    ids.grace = await meId(cookies.grace);
    // Ada and Grace hold Maker; Una keeps the implicit User role only.
    for (const userId of [ids.ada, ids.grace]) {
      const res = await call(cookies.admin, 'POST', '/admin/role-assignments', {
        userId,
        role: 'maker',
      });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await org?.close();
  });

  it('Given Ada and later Grace created legacy metrics on the same table, and a dataset over it has no data model yet', async () => {
    metricIds.adaAvg = await createLegacyMetric(
      cookies.ada,
      {
        name: 'avg_attendance',
        label: 'Average attendance',
        expression: 'avg(attendance)',
      },
      '2025-01-01T00:00:00.000Z',
    );
    metricIds.graceAvg = await createLegacyMetric(
      cookies.grace,
      {
        name: 'avg_attendance',
        label: 'Mean attendance',
        expression: 'sum(attendance) / count(*)',
      },
      '2025-02-01T00:00:00.000Z',
    );
    metricIds.graceMax = await createLegacyMetric(
      cookies.grace,
      {
        name: 'max_attendance',
        label: 'Highest attendance',
        expression: 'max(attendance)',
      },
      '2025-02-02T00:00:00.000Z',
    );

    // Written as an admin's save stores them (data-model 3.1, 3.3), with the
    // entity snapshot the bootstrap reads instead of the database.
    org.insertDoc('connections', {
      id: 'ds-world-cup',
      name: 'World Cup',
      kind: 'postgres',
      config: {
        host: '127.0.0.1',
        port: 5432,
        database: 'world_cup',
        user: 'world_cup',
        password: 'secret',
      },
    });
    org.insertDoc('datasets', {
      name: DATASET,
      datasourceId: 'ds-world-cup',
      datasourceKind: 'postgres',
      tables: [MATCHES_KEY],
      entities: [
        {
          key: MATCHES_KEY,
          columns: [
            { name: 'match_id', type: 'bigint', nullable: false },
            { name: 'home_team_id', type: 'bigint', nullable: false },
            { name: 'match_date', type: 'date', nullable: false },
            { name: 'attendance', type: 'integer', nullable: true },
          ],
        },
      ],
    });

    expect((await getModel(cookies.admin)).status).toBe(404);
  });

  describe('When the backend restarts on the same data directory', () => {
    beforeAll(async () => {
      await org.restart();
      await signInAll();
    });

    it('Scenario: Metrics of every user are imported into the shared model at startup', async () => {
      const { status, body } = await getModel(cookies.una);
      expect(status).toBe(200);
      expect(body.currentVersion).toBe(1);
      expect(body.version.source).toBe('bootstrap');
      const byName = new Map(
        body.version.model.metrics.map((m) => [m.name, m]),
      );
      // The author name is the user's display name in the directory.
      expect(await meName(cookies.ada)).toBe(ADA.name);
      expect(await meName(cookies.grace)).toBe(GRACE.name);
      expect(byName.get('avg_attendance')).toMatchObject({
        entity: 'matches',
        author: ids.ada,
        authorName: ADA.name,
      });
      expect(byName.get('max_attendance')).toMatchObject({
        entity: 'matches',
        author: ids.grace,
        authorName: GRACE.name,
        expressions: { sql: 'max(attendance)' },
      });
      expect(body.version.yaml).toContain(
        `author: ${ids.ada}\n    authorName: ${ADA.name}`,
      );
    });

    it('Scenario: A name clash keeps the first metric and reports the rest', async () => {
      const { body } = await getModel(cookies.una);
      const avg = body.version.model.metrics.filter(
        (m) => m.name.toLowerCase() === 'avg_attendance',
      );
      expect(avg).toHaveLength(1);
      expect(avg[0]).toMatchObject({
        author: ids.ada,
        authorName: ADA.name,
        label: 'Average attendance',
        expressions: { sql: 'avg(attendance)' },
      });

      const drift = await call(
        cookies.una,
        'GET',
        `${DATASET_PATH}/model/drift`,
      );
      expect(drift.status).toBe(200);
      const report = (drift.body as { metricsImport?: MetricsImportReport })
        .metricsImport;
      expect(report).toBeDefined();
      expect(Number.isNaN(Date.parse(report!.importedAt))).toBe(false);
      expect(
        [...report!.imported].sort((a, b) => a.name.localeCompare(b.name)),
      ).toEqual([
        {
          name: 'avg_attendance',
          entity: 'matches',
          author: ids.ada,
          authorName: ADA.name,
          sourceId: metricIds.adaAvg,
        },
        {
          name: 'max_attendance',
          entity: 'matches',
          author: ids.grace,
          authorName: GRACE.name,
          sourceId: metricIds.graceMax,
        },
      ]);
      expect(report!.skipped).toEqual([
        {
          name: 'avg_attendance',
          author: ids.grace,
          authorName: GRACE.name,
          sourceId: metricIds.graceAvg,
          reason: 'name_clash',
          keptSourceId: metricIds.adaAvg,
        },
      ]);
    });

    it('a User reads the rest of the model too: the export answers 200 (R38)', async () => {
      const res = await call(
        cookies.una,
        'GET',
        `${DATASET_PATH}/model/export`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/yaml/);
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="world-cup-core.model.v1.yaml"',
      );
      expect(res.body).toEqual(expect.stringContaining('avg_attendance'));
    });

    it('When the backend restarts again, the model has no new version (R34)', async () => {
      await org.restart();
      await signInAll();
      const { status, body } = await getModel(cookies.una);
      expect(status).toBe(200);
      expect(body.currentVersion).toBe(1);
      const versions = await call(
        cookies.una,
        'GET',
        `${DATASET_PATH}/model/versions`,
      );
      expect(versions.status).toBe(200);
      expect(
        (versions.body as { versions: ModelVersion[] }).versions.map(
          (v) => v.version,
        ),
      ).toEqual([1]);
      const drift = await call(
        cookies.una,
        'GET',
        `${DATASET_PATH}/model/drift`,
      );
      expect(
        (drift.body as { metricsImport?: MetricsImportReport }).metricsImport
          ?.skipped,
      ).toEqual([
        expect.objectContaining({
          sourceId: metricIds.graceAvg,
          keptSourceId: metricIds.adaAvg,
        }),
      ]);
    });

    it('Scenario: A caller without Manage datasources cannot change a model', async () => {
      // Valid YAML: version 1 with an edited label, written by the one YAML
      // writer, which a User may call (it changes nothing, R38).
      const before = await getModel(cookies.una);
      const edited = {
        ...before.body.version.model,
        metrics: before.body.version.model.metrics.map((m) =>
          m.name === 'avg_attendance'
            ? { ...m, label: 'Average attendance per match' }
            : m,
        ),
      };
      const serialized = await call(
        cookies.una,
        'POST',
        `${DATASET_PATH}/model/serialize`,
        { model: edited },
      );
      expect(serialized.status).toBe(200);
      const yaml = (serialized.body as { yaml: string }).yaml;
      expect(yaml).toContain('Average attendance per match');

      const refused = await call(cookies.una, 'PUT', `${DATASET_PATH}/model`, {
        yaml,
      });
      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({
        statusCode: 403,
        message: 'Missing permission: manage-datasources',
        error: 'Forbidden',
      });
      const unchanged = await getModel(cookies.una);
      expect(unchanged.status).toBe(200);
      expect(unchanged.body.currentVersion).toBe(1);
      expect(unchanged.body.version.yaml).toBe(before.body.version.yaml);

      // Platform admin holds Manage datasources and datasets.
      const saved = await call(cookies.admin, 'PUT', `${DATASET_PATH}/model`, {
        yaml,
      });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({ ok: true, version: 2 });
      const after = await getModel(cookies.una);
      expect(after.body.currentVersion).toBe(2);
      expect(after.body.version.source).toBe('user');
      expect(
        after.body.version.model.metrics.find(
          (m) => m.name === 'avg_attendance',
        )?.label,
      ).toBe('Average attendance per match');
    });

    it('Scenario: A legacy metric removed in the YAML stays removed after a restart', async () => {
      const before = await getModel(cookies.admin);
      expect(
        before.body.version.model.metrics.map((m) => m.name).sort(),
      ).toEqual(['avg_attendance', 'max_attendance']);
      const serialized = await call(
        cookies.admin,
        'POST',
        `${DATASET_PATH}/model/serialize`,
        {
          model: {
            ...before.body.version.model,
            metrics: before.body.version.model.metrics.filter(
              (m) => m.name !== 'max_attendance',
            ),
          },
        },
      );
      expect(serialized.status).toBe(200);

      const saved = await call(cookies.admin, 'PUT', `${DATASET_PATH}/model`, {
        yaml: (serialized.body as { yaml: string }).yaml,
      });
      expect(saved.status).toBe(200);
      const savedVersion = (saved.body as { version: number }).version;
      expect(savedVersion).toBe(before.body.currentVersion + 1);
      const after = await getModel(cookies.una);
      expect(after.body.version.source).toBe('user');
      expect(after.body.version.model.metrics.map((m) => m.name)).toEqual([
        'avg_attendance',
      ]);
      // Tombstoned like a delete in the Metrics tab (data-model.md 3.16).
      const stored = org
        .docs<{ dataset: string; deletedMetricNames?: string[] }>('data_models')
        .find((d) => d.dataset === DATASET);
      expect(stored?.deletedMetricNames).toEqual(['max_attendance']);

      // Grace's legacy metric is still in the legacy store; the startup
      // metrics import must not bring it back.
      await org.restart();
      await signInAll();
      const restarted = await getModel(cookies.una);
      expect(restarted.status).toBe(200);
      expect(restarted.body.currentVersion).toBe(savedVersion);
      expect(restarted.body.version.model.metrics.map((m) => m.name)).toEqual([
        'avg_attendance',
      ]);
    });
  });
});
