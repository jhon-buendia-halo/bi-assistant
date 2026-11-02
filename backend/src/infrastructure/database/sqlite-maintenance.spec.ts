import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SqliteDocStore } from './sqlite-doc-store';
import { SqliteMaintenance } from './sqlite-maintenance';
import { SqliteTransactions } from './sqlite-transactions';

describe('SqliteMaintenance', () => {
  let dir: string;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qti-maintenance-'));
    db = new BetterSqlite3(join(dir, 'app.sqlite'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const fileHolds = (text: string) =>
    readFileSync(join(dir, 'app.sqlite')).includes(Buffer.from(text));

  it('leaves no text of a deleted document in the file', async () => {
    const store = new SqliteDocStore<{ id: string; note: string }>(
      db,
      'memory_signals',
    );
    await store.insert({ id: 'a', note: 'decided on penalties is a draw' });
    await store.insert({ id: 'b', note: 'x'.repeat(5_000) });
    await store.deleteOne({ id: 'a' });
    expect(fileHolds('decided on penalties is a draw')).toBe(true);

    await new SqliteMaintenance(db).compact();

    expect(fileHolds('decided on penalties is a draw')).toBe(false);
    expect(await store.find({})).toHaveLength(1);
  });

  it('waits for a running transaction before it compacts', async () => {
    const store = new SqliteDocStore<{ id: string }>(db, 'things');
    const transactions = new SqliteTransactions(db);
    let release!: () => void;
    const held = transactions.run(async () => {
      await store.insert({ id: 'a' });
      await new Promise<void>((resolve) => (release = resolve));
    });

    const compacted = new SqliteMaintenance(db).compact();
    setTimeout(() => release(), 120);

    await expect(compacted).resolves.toBeUndefined();
    await held;
    expect(await store.find({})).toHaveLength(1);
  });
});
