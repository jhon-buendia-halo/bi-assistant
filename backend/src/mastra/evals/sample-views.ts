import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  databricksSource,
  findFixture,
  SAMPLE_FIXTURES,
} from '../../modules/testing-data/fixtures/registry';
import type { SampleFixture } from '../../modules/testing-data/fixtures/registry';
import type { ViewTables } from './checks/check';
import { tableName, tableReferences } from './checks/sql-text';

/**
 * The views of a sample and what each one reads, for `usesEntities`
 * (agents-evals R124): read from the `CREATE VIEW` statements of the
 * sample's seed SQL, the file the Testing Data loader runs.
 *
 * The seed, not the datasource, because it is the one source that holds on
 * every datasource kind: the REST server and the Databricks loader serve a
 * view as a plain endpoint or table holding its rows, dumped from the
 * PostgreSQL sample (ADR-0015), so no catalog there knows it is a view. And
 * reading a file keeps the checks free of any connection or query.
 */

/** The seeds, as `nest build` copies them next to the compiled tree. */
const FIXTURES_DIR = join(__dirname, '../../modules/testing-data/fixtures');

/**
 * A view's DDL up to its name, `CREATE [OR REPLACE] [MATERIALIZED] VIEW`, at
 * the start of a line, so the words in a comment or a string are not one.
 */
const CREATE_VIEW =
  /^[ \t]*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:TEMP|TEMPORARY|MATERIALIZED|RECURSIVE)\s+)*VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]*"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]*"|[A-Za-z_][\w$]*))*)/gim;

/** The last part of a dotted name, unquoted and lowercased. */
function lastPart(name: string): string {
  const match = /(?:"([^"]*)"|([A-Za-z_][\w$]*))\s*$/.exec(name);
  return (match?.[1] ?? match?.[2] ?? name).toLowerCase();
}

/**
 * Where the statement that goes on at `from` ends: its first `;` outside
 * string literals, quoted names and comments, or the end of the text.
 */
function statementEnd(sql: string, from: number): number {
  let i = from;
  while (i < sql.length) {
    const ch = sql[i];
    let close: number;
    if (ch === ';') return i;
    if (ch === "'" || ch === '"') {
      // A doubled quote (`'it''s'`) closes and reopens: the same string.
      close = sql.indexOf(ch, i + 1);
      i = close < 0 ? sql.length : close + 1;
    } else if (ch === '-' && sql[i + 1] === '-') {
      close = sql.indexOf('\n', i + 2);
      i = close < 0 ? sql.length : close + 1;
    } else if (ch === '/' && sql[i + 1] === '*') {
      close = sql.indexOf('*/', i + 2);
      i = close < 0 ? sql.length : close + 2;
    } else {
      i += 1;
    }
  }
  return sql.length;
}

/**
 * Every view a SQL script creates, by name, with the names its definition
 * reads: its table references (R112), each a last name part, lowercased,
 * once. A view that reads another view lists it; `usesEntities` opens it in
 * turn.
 */
export function viewTablesFromSql(sql: string): Map<string, string[]> {
  const views = new Map<string, string[]>();
  for (const match of sql.matchAll(CREATE_VIEW)) {
    const name = lastPart(match[1]);
    const start = match.index + match[0].length;
    const definition = sql.slice(start, statementEnd(sql, start));
    const read = new Set(tableReferences(definition).map(tableName));
    read.delete(name);
    views.set(name, Array.from(read));
  }
  return views;
}

/**
 * The seeded sample whose seed SQL created a sample's views: the sample
 * itself when it has a seed; for a Databricks sample, the PostgreSQL sample
 * it is loaded from; for a REST sample, the seeded PostgreSQL sample with the
 * same schema whose required tables it all requires (`world-cup` for
 * `world-cup-rest`). Undefined when there is none (`intellify-api`).
 */
export function seedSampleOf(
  fixture: SampleFixture,
): SampleFixture | undefined {
  if (fixture.seedFile) return fixture;
  if (fixture.datasourceKind === 'databricks') {
    const source = databricksSource(fixture);
    return source?.seedFile ? source : undefined;
  }
  if (fixture.datasourceKind !== 'rest') return undefined;
  return SAMPLE_FIXTURES.find(
    (source) =>
      source.seedFile !== undefined &&
      (source.datasourceKind ?? 'postgres') === 'postgres' &&
      source.schema === fixture.schema &&
      source.requiredTables.every((table) =>
        fixture.requiredTables.includes(table),
      ),
  );
}

const NO_VIEWS: ViewTables = new Map();

/** Views by seed file: each seed is read once per process. */
const viewsBySeed = new Map<string, ViewTables>();

/**
 * The views of the sample a set runs on, by its fixture id (R124). Read on
 * first use and kept: the Formula 1 seed is about 90 MB once unzipped, so no
 * seed is read before a check asks for it. A sample with no seed, or whose
 * seed cannot be read, has no views, and the check then compares table
 * references alone, never more loosely.
 */
export function sampleViews(
  fixtureId: string,
  fixturesDir: string = FIXTURES_DIR,
): ViewTables {
  const fixture = findFixture(fixtureId);
  const seedFile = fixture ? seedSampleOf(fixture)?.seedFile : undefined;
  if (!seedFile) return NO_VIEWS;
  const path = join(fixturesDir, seedFile);
  let views = viewsBySeed.get(path);
  if (!views) {
    try {
      const raw = readFileSync(path);
      const sql = seedFile.endsWith('.gz')
        ? gunzipSync(raw).toString('utf8')
        : raw.toString('utf8');
      views = viewTablesFromSql(sql);
    } catch {
      views = NO_VIEWS;
    }
    viewsBySeed.set(path, views);
  }
  return views;
}
