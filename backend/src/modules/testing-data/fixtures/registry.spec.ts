import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { splitSqlStatements } from '../sql-statements';
import { SAMPLE_FIXTURES, findFixture } from './registry';

function seedSql(seedFile: string): string {
  const raw = readFileSync(join(__dirname, seedFile));
  return seedFile.endsWith('.gz')
    ? gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
}

/** `CREATE TABLE|VIEW [IF NOT EXISTS] [schema.]name`, unquoted or quoted. */
function createdEntities(sql: string, schema: string): Set<string> {
  const created = new Set<string>();
  const pattern =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi;
  for (const match of sql.matchAll(pattern)) {
    const [, owner, name] = match;
    if (!owner || owner.toLowerCase() === schema.toLowerCase()) {
      created.add(name.toLowerCase());
    }
  }
  return created;
}

/**
 * The bundled seed of every seedable sample, checked without a database: the
 * file the registry names exists next to it (where `nest-cli.json` copies it
 * into `dist`), and it creates the sample's schema and every required table
 * and view. A sample whose seed drifted from its required list would otherwise
 * fail only when someone loads it from the Testing Data panel.
 */
describe('bundled sample seeds', () => {
  const seedable = SAMPLE_FIXTURES.filter((fixture) => fixture.seedFile);

  it.each(seedable.map((fixture) => [fixture.id, fixture] as const))(
    '%s: the seed file exists and creates its schema and every required entity',
    (_id, fixture) => {
      const file = fixture.seedFile as string;
      expect(existsSync(join(__dirname, file))).toBe(true);
      const sql = seedSql(file);
      expect(sql).toMatch(
        new RegExp(
          `CREATE\\s+SCHEMA\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${fixture.schema}"?`,
          'i',
        ),
      );
      const created = createdEntities(sql, fixture.schema);
      const missing = fixture.requiredTables.filter(
        (table) => !created.has(table.toLowerCase()),
      );
      expect(missing).toEqual([]);
    },
  );

  it('gives every sample its own id, and every seedable one its own database and schema', () => {
    const ids = SAMPLE_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    const databases = seedable.map((fixture) => fixture.defaults.database);
    expect(new Set(databases).size).toBe(databases.length);
    const schemas = seedable.map((fixture) => fixture.schema);
    expect(new Set(schemas).size).toBe(schemas.length);
  });
});

describe('sample fixture catalogue', () => {
  // The catalogue is the single source of what a sample must expose, so a
  // seed that forgets one of its required tables would only show up as
  // "Missing entities after seeding" on a real load. Check it here instead.
  it.each(
    SAMPLE_FIXTURES.filter((fixture) => fixture.seedFile).map((fixture) => [
      fixture.id,
      fixture,
    ]),
  )('the %s seed creates every required table', (_id, fixture) => {
    const sql = seedSql(fixture.seedFile as string);
    const missing = fixture.requiredTables.filter((table) => {
      const created = new RegExp(
        String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?(?:TABLE|VIEW)\s+` +
          String.raw`(?:"?${fixture.schema}"?\.)?"?${table}"?[\s(]`,
        'i',
      );
      return !created.test(sql);
    });
    expect(missing).toEqual([]);
  });

  it('ids, datasource names and dataset names are unique', () => {
    for (const key of ['id', 'datasourceName', 'datasetName'] as const) {
      const values = SAMPLE_FIXTURES.map((fixture) => fixture[key]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  describe('intellify', () => {
    const fixture = findFixture('intellify')!;
    const sql = seedSql(fixture.seedFile as string);

    it('owns schema intellify in its own database', () => {
      expect(fixture.schema).toBe('intellify');
      expect(fixture.defaults.database).toBe('intellify');
      expect(fixture.requiredTables).toHaveLength(49);
      expect(sql).toMatch(/^DROP SCHEMA IF EXISTS intellify CASCADE;$/m);
    });

    it('declares the 52 foreign keys of the data model', () => {
      expect(sql.match(/ADD CONSTRAINT "fk_[^"]+" FOREIGN KEY/g)).toHaveLength(
        52,
      );
    });

    it('qualifies every statement, so it does not depend on search_path', () => {
      const statements = splitSqlStatements(sql);
      const unqualified = statements.filter((statement) =>
        /^(?:CREATE TABLE|INSERT INTO|ALTER TABLE|COMMENT ON (?:TABLE|COLUMN))\s+"/i.test(
          statement.trim(),
        ),
      );
      expect(unqualified).toEqual([]);
      expect(statements.some((s) => /^SET\s+search_path/im.test(s))).toBe(
        false,
      );
    });
  });
});
