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

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../../infrastructure/database/database.module';
import { SAMPLE_BLUEPRINT_REPLY } from '../../mastra/workflows/recreate-dashboard.sample';
import { blueprintOf } from '../../mastra/workflows/recreate-dashboard.steps';
import { ARTIFACT_IMAGES_DIR, ArtifactsService } from './artifacts.service';
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
