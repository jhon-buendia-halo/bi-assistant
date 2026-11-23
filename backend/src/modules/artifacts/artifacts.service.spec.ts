// The images go to the data dir: a scratch folder of this spec's own.
jest.mock('../../infrastructure/database/database.module', () => {
  const { mkdtempSync } =
    jest.requireActual<typeof import('node:fs')>('node:fs');
  const os = jest.requireActual<typeof import('node:os')>('node:os');
  const path = jest.requireActual<typeof import('node:path')>('node:path');
  return {
    DATA_DIR: mkdtempSync(path.join(os.tmpdir(), 'qti-artifacts-spec-')),
  };
});

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../../infrastructure/database/database.module';
import { SAMPLE_BLUEPRINT_REPLY } from '../../mastra/workflows/recreate-dashboard.sample';
import {
  blueprintOf,
  type DashboardBlueprint,
} from '../../mastra/workflows/recreate-dashboard.steps';
import {
  ARTIFACT_IMAGES_DIR,
  ArtifactsService,
  versionParam,
  type NewDashboardVersion,
} from './artifacts.service';
import type { ArtifactDoc } from './entities/artifact.entity';

const BLUEPRINT = blueprintOf(SAMPLE_BLUEPRINT_REPLY);
const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.from('file'),
]);

/** The service over an in-memory store that stamps the dates. */
function build() {
  const docs: ArtifactDoc[] = [];
  let tick = 0;
  const stamp = () =>
    new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  const repository = {
    list: () =>
      Promise.resolve(
        [...docs].sort((a, b) =>
          (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
        ),
      ),
    get: (id: string) =>
      Promise.resolve(docs.find((doc) => doc.id === id) ?? null),
    insert: (doc: ArtifactDoc) => {
      const stored = { ...doc, createdAt: stamp(), updatedAt: stamp() };
      docs.push(stored);
      return Promise.resolve(stored);
    },
    update: (id: string, patch: Partial<ArtifactDoc>) => {
      const found = docs.find((doc) => doc.id === id);
      if (!found) return Promise.resolve(null);
      Object.assign(found, patch, { updatedAt: stamp() });
      return Promise.resolve(found);
    },
    delete: (id: string) => {
      const at = docs.findIndex((doc) => doc.id === id);
      if (at >= 0) docs.splice(at, 1);
      return Promise.resolve(at >= 0 ? 1 : 0);
    },
  };
  return { service: new ArtifactsService(repository as never), docs };
}

afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }));

describe('ArtifactsService', () => {
  it('stores a dashboard with its image and lists it, newest first', async () => {
    const { service } = build();
    const first = await service.create({
      blueprint: BLUEPRINT,
      image: { data: PNG, mediaType: 'image/png' },
      source: { runId: 'r-1', workflowId: 'recreate-dashboard' },
    });
    expect(first).toMatchObject({
      kind: 'dashboard',
      // The dashboard's title when no name is given.
      name: 'Sales Performance 2025',
      description: 'Tracks revenue and returns by month and region.',
      widgetCount: 4,
      filterCount: 2,
      hasImage: true,
      source: { runId: 'r-1', workflowId: 'recreate-dashboard' },
    });
    const second = await service.create({
      name: '  Q4 board  ',
      blueprint: BLUEPRINT,
    });
    expect(second).toMatchObject({ name: 'Q4 board', hasImage: false });
    expect((await service.list()).map((artifact) => artifact.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(await service.image(first.id)).toEqual({
      data: PNG,
      mediaType: 'image/png',
    });
    await expect(service.image(second.id)).rejects.toThrow(
      `Artifact "${second.id}" has no image`,
    );
  });

  it('answers the artifact with its dashboard', async () => {
    const { service } = build();
    const { id } = await service.create({ blueprint: BLUEPRINT });
    const artifact = await service.get(id);
    expect(artifact.blueprint).toEqual(BLUEPRINT);
  });

  it('refuses what is not a dashboard, and a bad name', async () => {
    const { service, docs } = build();
    await expect(service.create({ blueprint: { title: 'x' } })).rejects.toThrow(
      'The dashboard to save is not valid',
    );
    await expect(
      service.create({ blueprint: { ...BLUEPRINT, widgets: [] } }),
    ).rejects.toThrow('The dashboard to save is not valid');
    await expect(
      service.create({ name: 'x'.repeat(81), blueprint: BLUEPRINT }),
    ).rejects.toThrow('Name must be at most 80 characters');
    expect(docs).toHaveLength(0);
  });

  it('renames an artifact', async () => {
    const { service } = build();
    const { id } = await service.create({ blueprint: BLUEPRINT });
    expect(await service.rename(id, { name: ' Sales ' })).toMatchObject({
      id,
      name: 'Sales',
    });
    await expect(service.rename(id, { name: '   ' })).rejects.toThrow(
      'Name is required',
    );
    await expect(service.rename(id, {})).rejects.toThrow('Name is required');
    await expect(service.rename('gone', { name: 'x' })).rejects.toThrow(
      'Artifact "gone" not found',
    );
  });

  it('deletes an artifact with its image', async () => {
    const { service, docs } = build();
    const { id } = await service.create({
      blueprint: BLUEPRINT,
      image: { data: PNG, mediaType: 'image/png' },
    });
    const file = join(DATA_DIR, ARTIFACT_IMAGES_DIR, `${id}.png`);
    expect(existsSync(file)).toBe(true);
    await service.delete(id);
    expect(existsSync(file)).toBe(false);
    expect(docs).toHaveLength(0);
    await expect(service.get(id)).rejects.toThrow(`Artifact "${id}" not found`);
    await expect(service.delete(id)).rejects.toThrow(
      `Artifact "${id}" not found`,
    );
  });
});

const SAMPLE = BLUEPRINT as DashboardBlueprint;

/** A live version of the sample dashboard on three rows. */
function liveVersion(
  patch: Partial<NewDashboardVersion> = {},
): NewDashboardVersion {
  return {
    blueprint: SAMPLE,
    query: {
      sql: 'SELECT month, region, revenue FROM sales',
      datasourceId: 'ds-1',
      rationale: 'Revenue by month and region.',
    },
    columns: ['month', 'region', 'revenue'],
    rows: [
      { month: 'Jan', region: 'Europe', revenue: 10 },
      { month: 'Feb', region: 'Europe', revenue: 12.5 },
      { month: 'Jan', region: 'North America', revenue: null },
    ],
    instruction: 'Create a dashboard of revenue by region',
    source: { runId: 'run-1', workflowId: 'orchestrated-answer' },
    ...patch,
  };
}

describe('ArtifactsService dashboard versions', () => {
  it('creates a live dashboard as version 1, its rows in a file of its own', async () => {
    const { service, docs } = build();
    const ref = await service.createDashboard(liveVersion());
    expect(ref).toEqual({
      artifactId: expect.any(String) as string,
      version: 1,
      title: 'Sales Performance 2025',
      action: 'created',
      widgetCount: 4,
      filterCount: 2,
      rowCount: 3,
    });
    const [doc] = docs;
    expect(doc).toMatchObject({
      name: 'Sales Performance 2025',
      currentVersion: 1,
      blueprint: SAMPLE,
      source: { runId: 'run-1', workflowId: 'orchestrated-answer' },
    });
    expect(doc.versions).toEqual([
      {
        version: 1,
        blueprint: SAMPLE,
        query: liveVersion().query,
        columns: ['month', 'region', 'revenue'],
        rowCount: 3,
        dataFile: `artifacts/${ref.artifactId}/v1/rows.json`,
        instruction: 'Create a dashboard of revenue by region',
        source: { runId: 'run-1', workflowId: 'orchestrated-answer' },
        createdAt: expect.any(String) as string,
      },
    ]);
    // The rows stay out of the doc store.
    expect(JSON.stringify(doc)).not.toContain('12.5');
    expect(JSON.stringify(doc)).not.toContain('"rows"');
    const file = JSON.parse(
      readFileSync(
        join(DATA_DIR, 'artifacts', ref.artifactId, 'v1', 'rows.json'),
        'utf8',
      ),
    ) as unknown;
    expect(file).toEqual({
      columns: ['month', 'region', 'revenue'],
      rows: liveVersion().rows,
    });
    expect((await service.list())[0]).toMatchObject({
      currentVersion: 1,
      versionCount: 1,
      hasData: true,
    });
  });

  it('adds version 2, and reads each version with its rows', async () => {
    const { service, docs } = build();
    const { artifactId } = await service.createDashboard({
      ...liveVersion(),
      name: 'Revenue board',
    });
    const changed = {
      ...SAMPLE,
      title: 'Revenue by region',
      filters: SAMPLE.filters.slice(0, 1),
    };
    const ref = await service.addDashboardVersion(
      artifactId,
      liveVersion({
        blueprint: changed,
        rows: [{ month: 'Jan', region: 'Europe', revenue: 7 }],
        instruction: 'Keep only the region filter',
      }),
    );
    expect(ref).toEqual({
      artifactId,
      version: 2,
      title: 'Revenue by region',
      action: 'updated',
      widgetCount: 4,
      filterCount: 1,
      rowCount: 1,
    });
    // The top-level blueprint is the current version's; the name stays.
    expect(docs[0]).toMatchObject({
      name: 'Revenue board',
      currentVersion: 2,
      blueprint: changed,
    });
    expect((await service.get(artifactId)).blueprint).toEqual(changed);

    const current = await service.dashboardVersion(artifactId);
    expect(current).toMatchObject({
      artifactId,
      version: 2,
      name: 'Revenue board',
      title: 'Revenue by region',
      rowCount: 1,
      widgetCount: 4,
      filterCount: 1,
      columns: ['month', 'region', 'revenue'],
      query: liveVersion().query,
      instruction: 'Keep only the region filter',
      rows: [{ month: 'Jan', region: 'Europe', revenue: 7 }],
    });
    const first = await service.dashboardVersion(artifactId, 1);
    expect(first).toMatchObject({ version: 1, blueprint: SAMPLE });
    expect(first.rows).toHaveLength(3);

    const detail = await service.detail(artifactId, 1);
    expect(detail.rows).toHaveLength(3);
    expect(detail.artifact).toMatchObject({
      version: 1,
      currentVersion: 2,
      versionCount: 2,
      hasData: true,
      filterCount: 2,
      blueprint: SAMPLE,
      query: liveVersion().query,
    });
    expect(detail.artifact.dataMissing).toBeUndefined();
    expect(detail.artifact.versions).toEqual([
      {
        version: 1,
        createdAt: expect.any(String) as string,
        instruction: 'Create a dashboard of revenue by region',
        rowCount: 3,
        widgetCount: 4,
        filterCount: 2,
      },
      {
        version: 2,
        createdAt: expect.any(String) as string,
        instruction: 'Keep only the region filter',
        rowCount: 1,
        widgetCount: 4,
        filterCount: 1,
      },
    ]);
  });

  it('reads a dashboard saved before versions as version 1 without data', async () => {
    const { service, docs } = build();
    const { id } = await service.create({ blueprint: SAMPLE });
    expect(docs[0].versions).toBeUndefined();
    expect((await service.list())[0]).toMatchObject({
      currentVersion: 1,
      versionCount: 1,
      hasData: false,
    });
    const legacy = await service.dashboardVersion(id);
    expect(legacy).toMatchObject({
      version: 1,
      rows: null,
      blueprint: SAMPLE,
      columns: SAMPLE.columns.map((column) => column.name),
      rowCount: 0,
    });
    expect(legacy.query).toBeUndefined();
    const { artifact, rows } = await service.detail(id);
    expect(rows).toBeNull();
    expect(artifact).toMatchObject({ version: 1, hasData: false });
    expect(artifact.dataMissing).toBeUndefined();
    expect(artifact.versions).toHaveLength(1);

    // A change to it keeps the old one as version 1.
    const ref = await service.addDashboardVersion(id, liveVersion());
    expect(ref.version).toBe(2);
    expect(docs[0].versions?.map((version) => version.version)).toEqual([1, 2]);
    expect((await service.dashboardVersion(id, 1)).rows).toBeNull();
  });

  it('says when a version is unknown, and when its rows are gone', async () => {
    const { service } = build();
    const { artifactId } = await service.createDashboard(liveVersion());
    await expect(service.dashboardVersion(artifactId, 3)).rejects.toThrow(
      `Artifact "${artifactId}" has no version 3`,
    );
    await expect(service.detail(artifactId, 2)).rejects.toThrow(
      `Artifact "${artifactId}" has no version 2`,
    );
    await expect(
      service.addDashboardVersion('gone', liveVersion()),
    ).rejects.toThrow('Artifact "gone" not found');
    await expect(
      service.createDashboard(
        liveVersion({ blueprint: { ...SAMPLE, widgets: [] } }),
      ),
    ).rejects.toThrow('The dashboard to save is not valid');
    rmSync(join(DATA_DIR, 'artifacts', artifactId), {
      recursive: true,
      force: true,
    });
    const { artifact, rows } = await service.detail(artifactId);
    expect(rows).toBeNull();
    expect(artifact).toMatchObject({ dataMissing: true, hasData: false });
  });

  it('reads a version number from the query string', () => {
    expect(versionParam(undefined)).toBeUndefined();
    expect(versionParam('')).toBeUndefined();
    expect(versionParam('2')).toBe(2);
    for (const bad of ['0', '-1', '1.5', 'two', '01x', ['1', '2']]) {
      expect(() => versionParam(bad)).toThrow(
        'Version must be a positive whole number',
      );
    }
  });

  it('downloads a version as a zip named after the artifact', async () => {
    const { service } = build();
    const { artifactId } = await service.createDashboard({
      ...liveVersion(),
      name: 'Revenue Board',
    });
    const { filename, archive } = await service.download(artifactId);
    expect(filename).toBe('revenue-board-v1.zip');
    // A zip: a local file header first, the six files by name.
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    const text = archive.toString('latin1');
    for (const name of [
      'index.html',
      'styles.css',
      'app.js',
      'data.js',
      'query.sql',
      'README.txt',
    ]) {
      expect(text).toContain(name);
    }
    expect(text).toContain('"revenue":12.5');
    await expect(service.download(artifactId, 2)).rejects.toThrow(
      `Artifact "${artifactId}" has no version 2`,
    );
  });

  it("deletes an artifact with its versions' rows", async () => {
    const { service } = build();
    const { artifactId } = await service.createDashboard(liveVersion());
    await service.addDashboardVersion(artifactId, liveVersion());
    const folder = join(DATA_DIR, 'artifacts', artifactId);
    expect(existsSync(join(folder, 'v2', 'rows.json'))).toBe(true);
    await service.delete(artifactId);
    expect(existsSync(folder)).toBe(false);
  });
});
