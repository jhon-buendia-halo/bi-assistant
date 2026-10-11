import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from './sqlite-doc-store';
import { SqliteTransactions } from './sqlite-transactions';

/**
 * The "all or nothing" writes of the admin API (api.md 85, 86; data-model
 * 2.4) run through one SQLite transaction across collections.
 */
describe('SqliteTransactions', () => {
  let db: BetterSqlite3.Database;
  let a: SqliteDocStore<{ id: string; n?: number }>;
  let b: SqliteDocStore<{ id: string }>;
  let tx: SqliteTransactions;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    a = new SqliteDocStore(db, 'a');
    b = new SqliteDocStore(db, 'b');
    tx = new SqliteTransactions(db);
  });

  afterEach(() => db.close());

  it('commits every write of a run that succeeds and returns its result', async () => {
    const result = await tx.run(async () => {
      await a.insert({ id: 'a1' });
      await b.insert({ id: 'b1' });
      return 'done';
    });
    expect(result).toBe('done');
    expect(await a.find()).toHaveLength(1);
    expect(await b.find()).toHaveLength(1);
    expect(db.inTransaction).toBe(false);
  });

  it('rolls back the writes to every collection when the run throws', async () => {
    await a.insert({ id: 'kept', n: 1 });
    await expect(
      tx.run(async () => {
        await a.update({ id: 'kept' }, { n: 2 });
        await a.deleteOne({ id: 'kept' });
        await b.insert({ id: 'b1' });
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
    expect(await a.find()).toEqual([expect.objectContaining({ n: 1 })]);
    expect(await b.find()).toEqual([]);
    expect(db.inTransaction).toBe(false);
  });

  it('serialises concurrent runs, so one never sees the other half-done', async () => {
    const order: string[] = [];
    const first = tx.run(async () => {
      order.push('first:start');
      await a.insert({ id: 'x' });
      await Promise.resolve();
      order.push('first:end');
    });
    const second = tx.run(async () => {
      order.push('second:start');
      await b.insert({ id: 'y' });
      throw new Error('second fails');
    });
    await first;
    await expect(second).rejects.toThrow('second fails');
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    expect(await a.find()).toHaveLength(1);
    expect(await b.find()).toHaveLength(0);
    // A failed run does not block the next one.
    await tx.run(async () => {
      await b.insert({ id: 'z' });
    });
    expect(await b.find()).toHaveLength(1);
  });
});
