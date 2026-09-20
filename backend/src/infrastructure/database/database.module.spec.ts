import BetterSqlite3 from 'better-sqlite3';
import { renameLegacyFields, renameLegacyTables } from './database.module';

/**
 * Guards the two rename migrations. `SqliteDocStore` creates a missing table
 * and every read path looks at the current key, so a miss here is silent:
 * an existing install just comes back empty.
 */
describe('legacy datastore migrations', () => {
  let db: BetterSqlite3.Database;

  const createTable = (table: string) =>
    db
      .prepare(
        `CREATE TABLE "${table}" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`,
      )
      .run();

  const insert = (table: string, doc: object) =>
    db
      .prepare(`INSERT INTO "${table}" (doc) VALUES (?)`)
      .run(JSON.stringify(doc));

  const docs = (table: string) =>
    db
      .prepare(`SELECT doc FROM "${table}"`)
      .all()
      .map(
        (r) =>
          JSON.parse((r as { doc: string }).doc) as Record<string, unknown>,
      );

  const tables = () =>
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((r) => (r as { name: string }).name);

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
  });

  afterEach(() => db.close());

  it('renames the sandbox_selections table to datasets', () => {
    createTable('sandbox_selections');
    insert('sandbox_selections', { name: 'World Cup', tables: ['a.b.c'] });

    renameLegacyTables(db);

    expect(tables()).toContain('datasets');
    expect(tables()).not.toContain('sandbox_selections');
    expect(docs('datasets')).toEqual([
      { name: 'World Cup', tables: ['a.b.c'] },
    ]);
  });

  it('leaves the legacy table alone when the new one already exists', () => {
    createTable('sandbox_selections');
    createTable('datasets');
    insert('datasets', { name: 'current' });

    renameLegacyTables(db);

    expect(tables()).toContain('sandbox_selections');
    expect(docs('datasets')).toEqual([{ name: 'current' }]);
  });

  it('rewrites the session `sandboxes` key to `datasets` as an array', () => {
    createTable('sessions');
    insert('sessions', {
      id: 's1',
      name: 'World Cup analysis',
      sandboxes: ['World Cup', 'Players'],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renameLegacyFields(db);

    expect(docs('sessions')).toEqual([
      {
        id: 's1',
        name: 'World Cup analysis',
        // Still an array, not the stringified `["World Cup","Players"]` that
        // `json_set` would write without the `json()` wrapper.
        datasets: ['World Cup', 'Players'],
        // Rewritten in raw SQL, so recency ordering survives the migration.
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('leaves already-migrated and unrelated sessions untouched', () => {
    createTable('sessions');
    insert('sessions', { id: 's1', datasets: ['current'] });
    insert('sessions', { id: 's2', datasets: ['new'], sandboxes: ['old'] });

    renameLegacyFields(db);

    expect(docs('sessions')).toEqual([
      { id: 's1', datasets: ['current'] },
      { id: 's2', datasets: ['new'], sandboxes: ['old'] },
    ]);
  });

  it('is a no-op when the table does not exist yet', () => {
    expect(() => renameLegacyFields(db)).not.toThrow();
    expect(() => renameLegacyTables(db)).not.toThrow();
  });
});
