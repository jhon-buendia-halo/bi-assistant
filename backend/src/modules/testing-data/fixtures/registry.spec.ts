import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { splitSqlStatements } from '../sql-statements';
import {
  SAMPLE_FIXTURES,
  findFixture,
  ownedSchemas,
  requiredEntities,
} from './registry';

function seedSql(seedFile: string): string {
  const raw = readFileSync(join(__dirname, seedFile));
  return seedFile.endsWith('.gz')
    ? gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
}

/**
 * `CREATE TABLE|[MATERIALIZED] VIEW [IF NOT EXISTS] [schema.]name`, unquoted
 * or quoted: the names created in `schema`, and every name qualified as
 * `schema.name` (how a multi-schema sample lists its required tables, R4a).
 */
function createdEntities(sql: string, schema: string): Set<string> {
  const created = new Set<string>();
  const pattern =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|(?:MATERIALIZED\s+)?VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi;
  for (const match of sql.matchAll(pattern)) {
    const [, owner, name] = match;
    if (!owner || owner.toLowerCase() === schema.toLowerCase()) {
      created.add(name.toLowerCase());
    }
    if (owner) created.add(`${owner}.${name}`.toLowerCase());
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
    // World Cup Medallion shares the World Cup database by design (R3), in
    // schemas of its own.
    const targets = seedable.map(
      (fixture) => `${fixture.defaults.database}.${fixture.schema}`,
    );
    expect(new Set(targets).size).toBe(targets.length);
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
    const missing = fixture.requiredTables.filter((entry) => {
      // A multi-schema sample qualifies its tables; the others do not.
      const [schema, table] = fixture.layerSchemas
        ? entry.split('.')
        : [fixture.schema, entry];
      const created = new RegExp(
        String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?(?:TABLE|VIEW)\s+` +
          String.raw`(?:"?${schema}"?\.)?"?${table}"?[\s(]`,
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

  describe('world-cup-medallion', () => {
    const fixture = findFixture('world-cup-medallion')!;
    const sql = seedSql(fixture.seedFile as string);

    it('owns three layer schemas in the world_cup database', () => {
      expect(fixture.defaults.database).toBe('world_cup');
      expect(ownedSchemas(fixture)).toEqual([
        'wc_landing',
        'wc_normalized',
        'wc_consumption',
      ]);
      expect(fixture.layerSchemas?.map((entry) => entry.layer)).toEqual([
        'landing',
        'normalized',
        'consumption',
      ]);
      expect(requiredEntities(fixture)).toContain(
        'wc_consumption.fct_match_results',
      );
      expect(fixture.requiredTables).toHaveLength(11);
    });

    it('splits into statements and has no cards or bookings table', () => {
      expect(splitSqlStatements(sql).length).toBeGreaterThan(20);
      expect(sql).not.toMatch(/card|booking/i);
    });
  });

  it('single-schema fixtures own exactly their one schema', () => {
    const wc = findFixture('world-cup')!;
    expect(wc.layerSchemas).toBeUndefined();
    expect(ownedSchemas(wc)).toEqual(['world_cup']);
    expect(requiredEntities(wc)[0]).toBe('world_cup.tournaments');
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

  describe('us-health', () => {
    const fixture = findFixture('us-health')!;
    const sql = seedSql(fixture.seedFile as string);

    it('owns schema us_health in its own database', () => {
      expect(fixture.schema).toBe('us_health');
      expect(fixture.defaults.database).toBe('us_health');
      expect(fixture.requiredTables).toHaveLength(45);
      expect(sql).toMatch(/^DROP SCHEMA IF EXISTS us_health CASCADE;$/m);
    });

    it('qualifies every statement, so it does not depend on search_path', () => {
      const statements = splitSqlStatements(sql);
      // The us_health seed writes identifiers unquoted, so check that every
      // object a statement names sits in schema us_health.
      const unqualified = statements.filter((statement) => {
        const match =
          /^(?:CREATE (?:OR REPLACE )?(?:TABLE|VIEW)|INSERT INTO|ALTER TABLE|COMMENT ON (?:TABLE|COLUMN|VIEW))\s+("?[\w]+"?)(\.)?/i.exec(
            statement.trim(),
          );
        return (
          match !== null &&
          (match[1].replace(/"/g, '') !== 'us_health' || !match[2])
        );
      });
      expect(unqualified).toEqual([]);
      expect(statements.some((s) => /^SET\s+search_path/im.test(s))).toBe(
        false,
      );
    });

    it('declares foreign keys with unique names', () => {
      const names = sql.match(/ADD CONSTRAINT "fk_[^"]+" FOREIGN KEY/g) ?? [];
      expect(names.length).toBeGreaterThan(40);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('edge-cases', () => {
    const fixture = findFixture('edge-cases')!;
    const sql = seedSql(fixture.seedFile as string);
    const statements = splitSqlStatements(sql);

    it('owns schema edge_cases in its own database, as a plain SQL seed', () => {
      expect(fixture).toMatchObject({
        name: 'Edge Cases',
        schema: 'edge_cases',
        seedFile: '005_edge_cases.sql',
        datasourceName: 'Edge Cases PostgreSQL',
        datasetName: 'Edge Cases',
      });
      expect(fixture.defaults.database).toBe('edge_cases');
      expect(fixture.requiredTables).toHaveLength(19);
      expect(sql).toMatch(/^DROP SCHEMA IF EXISTS edge_cases CASCADE;$/m);
    });

    it('sits after US Health and before the register-only REST sample', () => {
      const ids = SAMPLE_FIXTURES.map((sample) => sample.id);
      expect(ids.indexOf('edge-cases')).toBe(ids.indexOf('us-health') + 1);
      expect(ids.indexOf('world-cup-rest')).toBe(
        ids.indexOf('world-cup-excel') + 1,
      );
    });

    it('generates the data in SQL, identically on every load', () => {
      // No clock and no unseeded randomness: rows come from generate_series
      // and md5-based expressions, so two loads hold the same data.
      expect(sql).not.toMatch(
        /\b(?:random|now|clock_timestamp|statement_timestamp|transaction_timestamp|gen_random_uuid)\s*\(|\b(?:current_date|current_timestamp|localtimestamp)\b/i,
      );
      expect(sql).toMatch(/generate_series\(1, 1000000\)/);
    });

    it('splits cleanly: no dollar quoting and no backslash-escaped quotes', () => {
      expect(sql).not.toMatch(/\$[A-Za-z_]*\$/);
      expect(sql).not.toMatch(/\\'/);
      // Every statement starts with a known keyword, so a quote the splitter
      // misread would show up as a fragment here.
      const bare = statements.map((statement) =>
        statement.replace(/^(?:\s*--[^\n]*\n)+/, '').trim(),
      );
      const odd = bare.filter(
        (statement) =>
          !/^(?:DROP|CREATE|INSERT|ALTER|COMMENT|REFRESH|ANALYZE|UPDATE)\s/i.test(
            statement,
          ),
      );
      expect(odd).toEqual([]);
    });

    it('qualifies every statement, so it does not depend on search_path', () => {
      const unqualified = statements.filter((statement) => {
        const match =
          /^(?:CREATE (?:OR REPLACE )?(?:MATERIALIZED )?(?:TABLE|VIEW|TYPE|INDEX \S+ ON|FUNCTION)|INSERT INTO|ALTER TABLE|REFRESH MATERIALIZED VIEW|COMMENT ON (?:TABLE|COLUMN|VIEW|MATERIALIZED VIEW))\s+("?[\w]+"?)(\.)?/i.exec(
            statement.replace(/^(?:\s*--[^\n]*\n)+/, '').trim(),
          );
        return (
          match !== null &&
          (match[1].replace(/"/g, '') !== 'edge_cases' || !match[2])
        );
      });
      expect(unqualified).toEqual([]);
      expect(statements.some((s) => /^SET\s+search_path/im.test(s))).toBe(
        false,
      );
    });

    it('carries the awkward names the spec documents', () => {
      for (const name of [
        '"Order Notes"',
        '"CustomerTier"',
        '"order"',
        '"group"',
        '"select"',
        '"user"',
        '"año"',
        '"región"',
        '"discount_%"',
        '"ship-to"',
        'matching_rows',
        'edge_cases."LegacyOrders"',
      ]) {
        expect(sql).toContain(name);
      }
      expect(sql).toMatch(/CREATE TYPE edge_cases\.order_status AS ENUM/);
      expect(sql).toMatch(
        /REFRESH MATERIALIZED VIEW edge_cases\.mv_daily_sales/,
      );
      // A declared foreign key that existing rows violate (orphans).
      expect(sql).toMatch(/FOREIGN KEY \(order_id\)[\s\S]*?NOT VALID/);
    });

    it('has a wide table of at least 60 columns', () => {
      const body =
        /CREATE TABLE edge_cases\.customer_profile_wide \(([\s\S]*?)\n\);/.exec(
          sql,
        )?.[1];
      const columns =
        (body ?? '').match(
          /(?:^|,)\s*[a-z][a-z_0-9]* (?:text|integer|bigint|smallint|boolean|date|timestamptz|double precision|numeric\(\d+,\d+\))/g,
        ) ?? [];
      expect(columns.length).toBeGreaterThanOrEqual(60);
    });
  });

  describe('retail-ops', () => {
    const fixture = findFixture('retail-ops')!;
    const sql = seedSql(fixture.seedFile as string);
    const statements = splitSqlStatements(sql);

    it('owns schema retail_ops in its own database, as a plain SQL seed', () => {
      expect(fixture).toMatchObject({
        name: 'Retail Ops',
        schema: 'retail_ops',
        seedFile: '007_retail_ops.sql',
        datasourceName: 'Retail Ops PostgreSQL',
        datasetName: 'Retail Ops',
      });
      expect(fixture.defaults.database).toBe('retail_ops');
      expect(fixture.requiredTables).toHaveLength(19);
      expect(sql).toMatch(/^DROP SCHEMA IF EXISTS retail_ops CASCADE;$/m);
    });

    it('sits after World Cup Medallion and before the register-only samples', () => {
      const ids = SAMPLE_FIXTURES.map((sample) => sample.id);
      expect(ids.indexOf('retail-ops')).toBe(
        ids.indexOf('world-cup-medallion') + 1,
      );
      // Every register-only sample (no bundled seed: Excel, REST,
      // Databricks) comes after it.
      const registerOnly = SAMPLE_FIXTURES.filter((sample) => !sample.seedFile);
      expect(registerOnly.length).toBeGreaterThan(0);
      for (const sample of registerOnly) {
        expect(ids.indexOf(sample.id)).toBeGreaterThan(
          ids.indexOf('retail-ops'),
        );
      }
    });

    it('generates the data in SQL, identically on every load', () => {
      expect(sql).not.toMatch(
        /\b(?:random|now|clock_timestamp|statement_timestamp|transaction_timestamp|gen_random_uuid)\s*\(|\b(?:current_date|current_timestamp|localtimestamp)\b/i,
      );
      expect(sql).toMatch(/generate_series\(1, 12000\)/);
    });

    it('splits cleanly: no dollar quoting and no backslash-escaped quotes', () => {
      expect(sql).not.toMatch(/\$[A-Za-z_]*\$/);
      expect(sql).not.toMatch(/\\'/);
      const bare = statements.map((statement) =>
        statement.replace(/^(?:\s*--[^\n]*\n)+/, '').trim(),
      );
      const odd = bare.filter(
        (statement) =>
          !/^(?:DROP|CREATE|INSERT|ALTER|COMMENT|REFRESH|ANALYZE|UPDATE)\s/i.test(
            statement,
          ),
      );
      expect(odd).toEqual([]);
    });

    it('qualifies every statement, so it does not depend on search_path', () => {
      const unqualified = statements.filter((statement) => {
        const match =
          /^(?:CREATE (?:OR REPLACE )?(?:MATERIALIZED )?(?:TABLE|VIEW|TYPE|INDEX \S+ ON|FUNCTION)|INSERT INTO|ALTER TABLE|REFRESH MATERIALIZED VIEW|COMMENT ON (?:TABLE|COLUMN|VIEW|MATERIALIZED VIEW)|ANALYZE|UPDATE)\s+("?[\w]+"?)(\.)?/i.exec(
            statement.replace(/^(?:\s*--[^\n]*\n)+/, '').trim(),
          );
        return (
          match !== null &&
          (match[1].replace(/"/g, '') !== 'retail_ops' || !match[2])
        );
      });
      expect(unqualified).toEqual([]);
      expect(statements.some((s) => /^SET\s+search_path/im.test(s))).toBe(
        false,
      );
    });

    it('creates one table for each required table', () => {
      for (const table of fixture.requiredTables) {
        expect(sql).toContain(`CREATE TABLE retail_ops.${table} (`);
      }
    });
  });
});
