import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import type { IntellifyDbConfig } from '../config';

export const INTELLIFY_DB_CONFIG = Symbol('INTELLIFY_DB_CONFIG');

/** Arbitrary but fixed: serialises migrations across API instances. */
const MIGRATION_LOCK_ID = 727001;
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/** PostgreSQL could not be reached; the filter answers 503 (api.md 2.16). */
export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('database unavailable', { cause });
    this.name = 'DatabaseUnavailableError';
  }
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  '3D000', // database does not exist
  '28000',
  '28P01', // bad credentials
  '57P01', // admin shutdown
  '57P02',
  '57P03', // cannot connect now
]);

/** True for "can't reach / lost the server" errors, not for query errors. */
export function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message, errors } = error as {
    code?: unknown;
    message?: unknown;
    errors?: unknown;
  };
  if (
    typeof code === 'string' &&
    // 08P01 (protocol violation) is a bad statement, not a lost connection.
    (CONNECTION_CODES.has(code) || (code.startsWith('08') && code !== '08P01'))
  ) {
    return true;
  }
  if (Array.isArray(errors) && errors.some(isConnectionError)) return true;
  return (
    typeof message === 'string' &&
    /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error|Connection error/i.test(
      message,
    )
  );
}

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

/** `NNN_name.sql` files of `dir`, ordered by version. */
export function readMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .map((name) => ({ name, match: /^(\d+)_.+\.sql$/.exec(name) }))
    .filter((f) => f.match)
    .map((f) => ({
      version: Number(f.match![1]),
      name: f.name,
      sql: readFileSync(join(dir, f.name), 'utf8'),
    }))
    .sort((a, b) => a.version - b.version);
}

/**
 * The API's PostgreSQL access. The pool is created on first use, so a missing
 * database never stops the process: every failure to reach it surfaces as a
 * `DatabaseUnavailableError`.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger('IntellifyApiDb');
  private pool: Pool | null = null;
  /** Why the last `migrate()` failed; null when it succeeded or hasn't run. */
  migrationError: string | null = null;

  constructor(
    @Inject(INTELLIFY_DB_CONFIG) readonly config: IntellifyDbConfig,
  ) {}

  /** Name of the schema holding the Intellify data. */
  get schema(): string {
    return this.config.schema;
  }

  private getPool(): Pool {
    if (!this.pool) {
      const { host, port, database, user, password, ssl } = this.config;
      this.pool = new Pool({
        host,
        port,
        database,
        user,
        password,
        ssl: ssl ? { rejectUnauthorized: false } : undefined,
        max: 5,
        connectionTimeoutMillis: 3000,
      });
      // An idle client dropped by the server must not crash the process.
      this.pool.on('error', (error) =>
        this.logger.warn(`idle connection error: ${error.message}`),
      );
    }
    return this.pool;
  }

  private async connect(): Promise<PoolClient> {
    try {
      return await this.getPool().connect();
    } catch (error) {
      throw isConnectionError(error)
        ? new DatabaseUnavailableError(error)
        : error;
    }
  }

  private async inTransaction<T>(
    begin: string,
    fn: (client: PoolClient) => Promise<T>,
    commit: boolean,
  ): Promise<T> {
    const client = await this.connect();
    let broken = false;
    try {
      await client.query(begin);
      const result = await fn(client);
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (error) {
      broken = isConnectionError(error);
      if (!broken) await client.query('ROLLBACK').catch(() => undefined);
      throw broken ? new DatabaseUnavailableError(error) : error;
    } finally {
      client.release(broken ? true : undefined);
    }
  }

  /** Runs `fn` in a `READ ONLY` transaction that is always rolled back. */
  readOnly<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.inTransaction('BEGIN READ ONLY', fn, false);
  }

  /** Runs `fn` in a transaction, committed when it resolves. */
  write<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.inTransaction('BEGIN', fn, true);
  }

  /**
   * Applies `db/migrations/NNN_*.sql` in order. Each file runs in its own
   * transaction under an advisory lock, and is skipped when its version is
   * already in `rfp.schema_migrations`. Returns the versions applied now.
   */
  async migrate(dir = MIGRATIONS_DIR): Promise<number[]> {
    const applied: number[] = [];
    try {
      for (const migration of readMigrations(dir)) {
        await this.write(async (client) => {
          await client.query('SELECT pg_advisory_xact_lock($1)', [
            MIGRATION_LOCK_ID,
          ]);
          await client.query('CREATE SCHEMA IF NOT EXISTS rfp');
          await client.query(`CREATE TABLE IF NOT EXISTS rfp.schema_migrations (
            version     integer PRIMARY KEY,
            applied_at  timestamptz NOT NULL DEFAULT now()
          )`);
          const done = await client.query(
            'SELECT 1 FROM rfp.schema_migrations WHERE version = $1',
            [migration.version],
          );
          if (done.rowCount) return;
          await client.query(migration.sql);
          applied.push(migration.version);
        });
      }
      this.migrationError = null;
    } catch (error) {
      this.migrationError =
        error instanceof DatabaseUnavailableError
          ? error.message
          : (error as Error).message;
      throw error;
    }
    return applied;
  }

  /** Highest applied `rfp` migration, or null (none yet, or database down). */
  async schemaVersion(): Promise<number | null> {
    try {
      return await this.readOnly(async (client) => {
        const { rows } = await client.query(
          'SELECT max(version)::int AS version FROM rfp.schema_migrations',
        );
        return (
          (rows[0] as { version: number | null } | undefined)?.version ?? null
        );
      });
    } catch {
      return null; // database down, or the table doesn't exist yet
    }
  }

  async health(): Promise<{
    database: 'up' | 'down';
    rfpSchemaVersion: number | null;
  }> {
    try {
      await this.readOnly((client) => client.query('SELECT 1'));
    } catch {
      return { database: 'down', rfpSchemaVersion: null };
    }
    return { database: 'up', rfpSchemaVersion: await this.schemaVersion() };
  }

  async onModuleDestroy(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end().catch(() => undefined);
  }
}
