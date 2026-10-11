import type { Database } from 'better-sqlite3';
import type { DocStoreTransactions } from './doc-store';

/**
 * `DocStoreTransactions` over the one SQLite connection every collection
 * shares (data-model 2.4). `SqliteDocStore` runs its statements
 * synchronously and only wraps the result in a promise, so between `BEGIN`
 * and `COMMIT` nothing but `work` touches the connection, as long as `work`
 * only calls stores. Runs are queued so two never overlap.
 */
export class SqliteTransactions implements DocStoreTransactions {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: Database) {}

  run<R>(work: () => Promise<R>): Promise<R> {
    const next = this.queue.then(() => this.runNow(work));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runNow<R>(work: () => Promise<R>): Promise<R> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
