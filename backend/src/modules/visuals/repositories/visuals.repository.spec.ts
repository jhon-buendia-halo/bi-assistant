import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import { VisualsRepository } from './visuals.repository';
import type { VisualChart } from '../entities/visual-chart.entity';

const chart = (overrides: Partial<VisualChart> = {}): VisualChart => ({
  id: 'v1',
  name: 'Bar chart',
  category: 'Comparison',
  previewKey: 'bar',
  rendererForm: 'bar',
  description: '',
  whenToUse: '',
  whenToAvoid: '',
  dataShape: '',
  enabled: true,
  builtIn: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('VisualsRepository', () => {
  let db: BetterSqlite3.Database;
  let repository: VisualsRepository;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    repository = new VisualsRepository(
      new SqliteDocStore<VisualChart>(db, 'visual_charts'),
      new SqliteDocStore(db, 'settings'),
    );
  });

  afterEach(() => db.close());

  it('inserts, gets, lists, updates and deletes', async () => {
    await repository.insert(chart());
    await expect(repository.get('v1')).resolves.toMatchObject({
      name: 'Bar chart',
    });
    await expect(repository.list()).resolves.toHaveLength(1);

    const updated = await repository.update('v1', { enabled: false });
    expect(updated).toMatchObject({ name: 'Bar chart', enabled: false });

    await expect(repository.delete('v1')).resolves.toBe(1);
    await expect(repository.get('v1')).resolves.toBeNull();
  });

  it('records the seed marker in settings', async () => {
    await expect(repository.isSeeded()).resolves.toBe(false);
    await repository.markSeeded();
    await expect(repository.isSeeded()).resolves.toBe(true);
    await repository.markSeeded();
    await expect(repository.isSeeded()).resolves.toBe(true);
  });
});
