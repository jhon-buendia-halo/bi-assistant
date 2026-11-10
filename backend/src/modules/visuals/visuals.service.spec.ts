import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { VisualsRepository } from './repositories/visuals.repository';
import { VisualsService } from './visuals.service';
import { DEFAULT_VISUALS } from './default-visuals';
import {
  VISUAL_CATEGORIES,
  VISUAL_PREVIEW_KEYS,
} from './entities/visual-chart.entity';
import type { VisualChart } from './entities/visual-chart.entity';
import { SPEC_CHART_FORMS } from '../sessions/visual-spec';

describe('VisualsService', () => {
  let db: BetterSqlite3.Database;
  let service: VisualsService;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    service = new VisualsService(
      new VisualsRepository(
        new SqliteDocStore<VisualChart>(db, 'visual_charts'),
        new SqliteDocStore(db, 'settings'),
      ),
    );
  });

  afterEach(() => db.close());

  describe('default catalog', () => {
    it('has 30 unique names in the 9 categories', () => {
      expect(DEFAULT_VISUALS).toHaveLength(30);
      const names = DEFAULT_VISUALS.map((d) => d.name.toLowerCase());
      expect(new Set(names).size).toBe(30);
      const categories = new Set(DEFAULT_VISUALS.map((d) => d.category));
      expect([...categories].sort()).toEqual([...VISUAL_CATEGORIES].sort());
    });

    it('uses valid preview keys and renderer forms, with real content', () => {
      for (const d of DEFAULT_VISUALS) {
        expect(VISUAL_PREVIEW_KEYS).toContain(d.previewKey);
        if (d.rendererForm !== null) {
          expect(SPEC_CHART_FORMS).toContain(d.rendererForm);
        }
        for (const f of [
          'description',
          'whenToUse',
          'whenToAvoid',
          'dataShape',
        ] as const) {
          expect(d[f].trim()).not.toBe('');
        }
        expect(d.dataShape.length).toBeLessThanOrEqual(200);
      }
      const preview = DEFAULT_VISUALS.map((d) => d.previewKey);
      expect(new Set(preview).size).toBe(30);
    });

    it('seeds every default as built-in and enabled on first start', async () => {
      await service.onModuleInit();
      const all = await service.list();
      expect(all).toHaveLength(30);
      expect(all.every((c) => c.builtIn && c.enabled)).toBe(true);
    });

    it('seeds only once, so a deleted default stays deleted', async () => {
      await service.onModuleInit();
      const [first] = await service.list();
      await service.delete(first.id);
      await service.onModuleInit();
      const all = await service.list();
      expect(all).toHaveLength(29);
      expect(all.find((c) => c.id === first.id)).toBeUndefined();
    });

    it('does not duplicate a chart already named like a default', async () => {
      await service.create({ name: 'bar CHART', category: 'Mine' });
      await service.onModuleInit();
      const all = await service.list();
      expect(all).toHaveLength(30);
      expect(all.find((c) => c.name === 'bar CHART')?.builtIn).toBe(false);
    });
  });

  it('creates with defaults, trims and is not built-in', async () => {
    const created = await service.create({
      name: '  Pareto  ',
      category: ' Ranking ',
    });
    expect(created).toMatchObject({
      name: 'Pareto',
      category: 'Ranking',
      previewKey: 'none',
      rendererForm: null,
      description: '',
      whenToUse: '',
      whenToAvoid: '',
      dataShape: '',
      enabled: true,
      builtIn: false,
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();
  });

  it('ignores a builtIn flag sent by the client', async () => {
    const created = await service.create({
      name: 'X',
      category: 'C',
      builtIn: true,
    } as never);
    expect(created.builtIn).toBe(false);
  });

  it('accepts a known preview and renderer form', async () => {
    const created = await service.create({
      name: 'X',
      category: 'C',
      previewKey: 'radar',
      rendererForm: 'line',
      enabled: false,
    });
    expect(created).toMatchObject({
      previewKey: 'radar',
      rendererForm: 'line',
      enabled: false,
    });
  });

  describe('validation', () => {
    const ok = { name: 'X', category: 'C' };
    const bad = (dto: object, message: string) =>
      expect(service.create({ ...ok, ...dto })).rejects.toThrow(
        new BadRequestException(message),
      );

    it('requires a name', async () => {
      await bad({ name: '   ' }, 'Name is required');
      await expect(service.create({} as never)).rejects.toThrow(
        'Name is required',
      );
    });
    it('limits the name to 80', () =>
      bad({ name: 'a'.repeat(81) }, 'Name is at most 80 characters'));
    it('requires a category', () =>
      bad({ category: ' ' }, 'Category is required'));
    it('limits the category to 60', () =>
      bad({ category: 'a'.repeat(61) }, 'Category is at most 60 characters'));
    it('limits the description', () =>
      bad(
        { description: 'a'.repeat(1001) },
        'Description is at most 1,000 characters',
      ));
    it('limits when to use', () =>
      bad(
        { whenToUse: 'a'.repeat(1001) },
        'When to use is at most 1,000 characters',
      ));
    it('limits when to avoid', () =>
      bad(
        { whenToAvoid: 'a'.repeat(1001) },
        'When to avoid is at most 1,000 characters',
      ));
    it('limits data needed to 200', () =>
      bad(
        { dataShape: 'a'.repeat(201) },
        'Data needed is at most 200 characters',
      ));
    it('rejects an unknown preview', () =>
      bad({ previewKey: 'cube' }, 'Unknown preview'));
    it('rejects an unknown renderer form', () =>
      bad({ rendererForm: 'radar' }, 'Unknown renderer form'));
    it('rejects a non-boolean enabled', () =>
      bad({ enabled: 'yes' }, 'Enabled must be true or false'));
    it('accepts the maximum lengths', async () => {
      await expect(
        service.create({
          name: 'a'.repeat(80),
          category: 'b'.repeat(60),
          description: 'c'.repeat(1000),
          dataShape: 'd'.repeat(200),
        }),
      ).resolves.toBeTruthy();
    });
  });

  describe('uniqueness', () => {
    it('rejects a duplicate name ignoring case', async () => {
      await service.create({ name: 'Pareto', category: 'C' });
      await expect(
        service.create({ name: ' pareto ', category: 'D' }),
      ).rejects.toThrow(
        new ConflictException('A chart named "pareto" already exists'),
      );
    });

    it('rejects renaming onto another chart but allows keeping its own name', async () => {
      const a = await service.create({ name: 'A', category: 'C' });
      await service.create({ name: 'B', category: 'C' });
      await expect(service.update(a.id, { name: 'b' })).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.update(a.id, { name: 'a', description: 'x' }),
      ).resolves.toMatchObject({ description: 'x' });
    });
  });

  describe('update and delete', () => {
    it('merges only the present fields and restamps updatedAt', async () => {
      const a = await service.create({
        name: 'A',
        category: 'C',
        description: 'keep',
      });
      const saved = await service.update(a.id, { enabled: false });
      expect(saved).toMatchObject({
        name: 'A',
        description: 'keep',
        enabled: false,
      });
      expect(saved.updatedAt >= a.updatedAt).toBe(true);
    });

    it('validates a partial update', async () => {
      const a = await service.create({ name: 'A', category: 'C' });
      await expect(service.update(a.id, { name: '' })).rejects.toThrow(
        'Name is required',
      );
      await expect(
        service.update(a.id, { rendererForm: 'pie' }),
      ).rejects.toThrow('Unknown renderer form');
      await expect(
        service.update(a.id, { rendererForm: null }),
      ).resolves.toMatchObject({ rendererForm: null });
    });

    it('404s on an unknown id', async () => {
      await expect(service.update('nope', {})).rejects.toThrow(
        new NotFoundException('Chart not found'),
      );
      await expect(service.delete('nope')).rejects.toThrow(
        new NotFoundException('Chart not found'),
      );
    });

    it('deletes a chart', async () => {
      const a = await service.create({ name: 'A', category: 'C' });
      await service.delete(a.id);
      await expect(service.list()).resolves.toEqual([]);
    });
  });

  describe('sorting', () => {
    it('lists shipped categories in order, others alphabetically, names ignoring case', async () => {
      await service.create({ name: 'zeta', category: 'Flow' });
      await service.create({ name: 'Alpha', category: 'Flow' });
      await service.create({ name: 'm', category: 'zebra' });
      await service.create({ name: 'n', category: 'Apple' });
      await service.create({ name: 'b', category: 'Comparison' });
      await service.create({ name: 'o', category: 'Spatial' });
      const all = await service.list();
      expect(all.map((c) => `${c.category}/${c.name}`)).toEqual([
        'Comparison/b',
        'Flow/Alpha',
        'Flow/zeta',
        'Spatial/o',
        'Apple/n',
        'zebra/m',
      ]);
    });
  });
});
