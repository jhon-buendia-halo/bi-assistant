import { Client } from 'pg';
import { intellifyApiConfig } from '../config';
import {
  DatabaseUnavailableError,
  DbService,
  readMigrations,
} from './db.service';

const config = intellifyApiConfig({}).db;

/** The shared World Cup Postgres; the DB tests skip visibly when it's down. */
let reachable = false;
beforeAll(async () => {
  const client = new Client({ ...config, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    reachable = true;
  } catch {
    console.warn(
      `SKIPPED DB tests: ${config.host}:${config.port}/${config.database} unreachable`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
});

const dbTest = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) return;
    await fn();
  });

describe('readMigrations', () => {
  it('lists 001_rfp_schema.sql first', () => {
    const [first] = readMigrations();
    expect(first.version).toBe(1);
    expect(first.sql).toContain('CREATE SCHEMA IF NOT EXISTS rfp');
  });
});

describe('DbService without a database', () => {
  it('reports unavailable instead of crashing', async () => {
    const db = new DbService({ ...config, port: 1 });
    await expect(db.readOnly(() => Promise.resolve(1))).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
    await expect(db.health()).resolves.toEqual({
      database: 'down',
      rfpSchemaVersion: null,
    });
    await expect(db.migrate()).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(db.migrationError).toBe('database unavailable');
    await db.onModuleDestroy();
  });
});

describe('DbService against PostgreSQL', () => {
  let db: DbService;
  beforeAll(() => {
    db = new DbService(config);
  });
  afterAll(() => db.onModuleDestroy());

  dbTest('readOnly rejects a write', async () => {
    await expect(
      db.readOnly((c) => c.query('CREATE TEMP TABLE should_fail (x int)')),
    ).rejects.toThrow(/read-only/i);
  });

  dbTest('write rolls back when fn throws', async () => {
    await expect(
      db.write(async (c) => {
        await c.query('CREATE TEMP TABLE t (x int)');
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
  });

  dbTest('migrate is idempotent and health reports the version', async () => {
    await db.migrate();
    await expect(db.migrate()).resolves.toEqual([]);
    const health = await db.health();
    expect(health.database).toBe('up');
    expect(health.rfpSchemaVersion).toBeGreaterThanOrEqual(1);
    await db.readOnly(async (c) => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema = 'rfp'`,
      );
      expect((rows[0] as { n: number }).n).toBe(6);
    });
  });
});
