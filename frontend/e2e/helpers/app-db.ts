import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Direct access to the app's SQLite database, for specs that seed state the
 * suite cannot produce through the app (no model, no external service).
 */

interface SqliteStatement {
  reader: boolean;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  pragma(statement: string): unknown;
  prepare(statement: string): SqliteStatement;
  close(): void;
}

/** `better-sqlite3` is a backend dependency; the tests borrow it. */
const requireFromBackend = createRequire(
  path.resolve(__dirname, '../../../backend/package.json'),
);

/** Runs one SQL statement on `<dataDir>/app.sqlite` (the app may be running). */
export function appSql<T = unknown>(
  dataDir: string,
  statement: string,
  ...params: unknown[]
): T[] {
  const Database = requireFromBackend('better-sqlite3') as new (
    file: string,
  ) => SqliteDatabase;
  const db = new Database(path.join(dataDir, 'app.sqlite'));
  try {
    db.pragma('busy_timeout = 5000');
    const prepared = db.prepare(statement);
    if (prepared.reader) return prepared.all(...params) as T[];
    prepared.run(...params);
    return [];
  } finally {
    db.close();
  }
}
