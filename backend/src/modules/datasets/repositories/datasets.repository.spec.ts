import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import { DatasetsRepository } from './datasets.repository';
import type { DatasetDoc } from './datasets.repository';

describe('DatasetsRepository schema notes', () => {
  let db: BetterSqlite3.Database;
  let repository: DatasetsRepository;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    repository = new DatasetsRepository(
      new SqliteDocStore<DatasetDoc>(db, 'datasets'),
    );
  });

  afterEach(() => db.close());

  const notes = [{ key: 'c.s1', layer: 'consumption' as const }];

  it('stores schema notes', async () => {
    const saved = await repository.save('d', ['c.s1.t'], [], undefined, notes);
    expect(saved?.schemas).toEqual(notes);
  });

  it('removes stored schema notes when an empty list is saved', async () => {
    await repository.save('d', ['c.s1.t'], [], undefined, notes);
    const saved = await repository.save('d', ['c.s1.t'], [], undefined, []);
    expect(saved?.schemas).toBeUndefined();
    const raw = db.prepare('SELECT doc FROM "datasets"').get() as {
      doc: string;
    };
    expect(JSON.parse(raw.doc)).not.toHaveProperty('schemas');
  });
});
