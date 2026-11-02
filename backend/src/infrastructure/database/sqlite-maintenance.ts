import type { Database } from 'better-sqlite3';
import type { DocStoreMaintenance } from './doc-store';

/** How long `compact` waits for a running transaction to end. */
const TRANSACTION_WAIT_MS = 5_000;
const TRANSACTION_POLL_MS = 50;

/**
 * `DocStoreMaintenance` over the one SQLite connection every collection
 * shares. The file is in rollback-journal mode, so a `VACUUM` alone leaves
 * no deleted text in its free pages.
 */
export class SqliteMaintenance implements DocStoreMaintenance {
  constructor(private readonly db: Database) {}

  async compact(): Promise<void> {
    // VACUUM cannot run inside a transaction, and a `DocStoreTransactions`
    // run holds one open across its awaits.
    const deadline = Date.now() + TRANSACTION_WAIT_MS;
    while (this.db.inTransaction) {
      if (Date.now() >= deadline) {
        throw new Error('app.sqlite stayed in a transaction; not compacted');
      }
      await new Promise((resolve) => setTimeout(resolve, TRANSACTION_POLL_MS));
    }
    this.db.exec('VACUUM');
  }
}
