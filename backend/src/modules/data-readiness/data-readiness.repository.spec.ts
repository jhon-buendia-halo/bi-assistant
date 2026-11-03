import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { DataReadinessRepository } from './data-readiness.repository';
import type { ReadinessReport } from './engine/types';

const report = (overrides: Partial<ReadinessReport> = {}): ReadinessReport => ({
  id: 'r-1',
  datasourceId: 'ds-1',
  datasourceName: 'Warehouse',
  datasourceKind: 'postgres',
  generatedAt: '2026-01-01T00:00:00.000Z',
  findings: [],
  dimensionScores: [],
  overallScore: 80,
  maturity: 'Managed',
  entityCount: 3,
  ...overrides,
});

/** Real `SqliteDocStore` over an in-memory database. */
function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<ReadinessReport>(db, 'readiness_reports');
  return { repository: new DataReadinessRepository(store), db };
}

describe('DataReadinessRepository', () => {
  let db: BetterSqlite3.Database;
  let repository: DataReadinessRepository;

  beforeEach(() => {
    ({ repository, db } = build());
  });

  afterEach(() => db.close());

  it('inserts and reads a report by id', async () => {
    await repository.insert(report({ sessionId: 's-1' }));

    const found = await repository.get('r-1');
    expect(found).toMatchObject(report({ sessionId: 's-1' }));
  });

  it('returns null for an unknown id', async () => {
    await expect(repository.get('missing')).resolves.toBeNull();
  });

  it("lists one datasource's reports, newest generatedAt first", async () => {
    await repository.insert(
      report({ id: 'old', generatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    await repository.insert(
      report({ id: 'new', generatedAt: '2026-03-01T00:00:00.000Z' }),
    );
    await repository.insert(
      report({ id: 'mid', generatedAt: '2026-02-01T00:00:00.000Z' }),
    );
    await repository.insert(report({ id: 'other', datasourceId: 'ds-2' }));

    const ids = (await repository.listByDatasource('ds-1')).map((r) => r.id);
    expect(ids).toEqual(['new', 'mid', 'old']);
  });

  it('lists nothing for an unknown datasource', async () => {
    await repository.insert(report());
    await expect(repository.listByDatasource('nope')).resolves.toEqual([]);
  });
});
