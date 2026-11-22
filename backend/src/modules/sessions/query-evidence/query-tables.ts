/**
 * The tables a query reads, and the statement that sizes one (plan
 * docs/plans/m1-25-query-inspector.md 3d). Pure, no framework imports.
 */

/** Blank single-quoted literals and comments; keep identifiers and their quotes. */
function withoutLiterals(sql: string): string {
  return sql
    .replace(/'(?:[^'\\]|\\.|'')*'/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * The catalog entities whose name the SQL contains, in catalog order, each
 * once (as the workflow's `queriedTables` reads them). Quoted parts are
 * accepted, and on PostgreSQL also `schema.table` without the database.
 */
export function tablesOfQuery(
  sql: string,
  entities: readonly string[],
  kind?: string,
): string[] {
  const plain = withoutLiterals(sql).replace(/["`]/g, '').toLowerCase();
  const named = new Set<string>();
  for (const m of plain.matchAll(
    /(?<![\w.])[a-z0-9_]+(?:\.[a-z0-9_]+){1,2}(?![\w.])/g,
  )) {
    named.add(m[0]);
  }
  const found: string[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    const key = entity.toLowerCase();
    if (seen.has(key)) continue;
    const parts = key.split('.');
    const short =
      kind === 'postgres' && parts.length === 3
        ? parts.slice(1).join('.')
        : undefined;
    if (named.has(key) || (short !== undefined && named.has(short))) {
      seen.add(key);
      found.push(entity);
    }
  }
  return found;
}

/**
 * `SELECT COUNT(*) AS n FROM <entity>` in the datasource's dialect: on
 * PostgreSQL `"schema"."table"` (the database is the connection's), on
 * Databricks every part in backticks, on a REST datasource the dotted key
 * its SQLite layer resolves.
 */
export function countStatement(entity: string, kind?: string): string {
  return `SELECT COUNT(*) AS n FROM ${quotedEntity(entity, kind)}`;
}

/** The start step's preview statement: every row of its table (the cap is the runner's). */
export function previewStatement(entity: string, kind?: string): string {
  return `SELECT * FROM ${quotedEntity(entity, kind)}`;
}

/** An entity as the datasource's dialect quotes it in a FROM. */
function quotedEntity(entity: string, kind?: string): string {
  const parts = entity.split('.');
  if (kind === 'postgres') {
    return parts
      .slice(-2)
      .map((p) => `"${p.replace(/"/g, '""')}"`)
      .join('.');
  }
  if (kind === 'databricks') {
    return parts.map((p) => `\`${p.replace(/`/g, '``')}\``).join('.');
  }
  return entity;
}
