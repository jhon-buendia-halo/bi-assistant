import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { SAMPLE_FIXTURES } from './registry';

/**
 * The bundled seed of every seedable sample, checked without a database: the
 * file the registry names exists next to it (where `nest-cli.json` copies it
 * into `dist`), and it creates the sample's schema and every required table
 * and view. A sample whose seed drifted from its required list would otherwise
 * fail only when someone loads it from the Testing Data panel.
 */
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
