import { fail, PASS, quotedList, stringListProblem } from './check';
import type { DeterministicCheck, ViewTables } from './check';
import { tableName, tableReferences } from './sql-text';
import { executedStatements } from './turn';

export interface UsesEntitiesArgs {
  /** Entities one query must read; absent: those the reference reads. */
  entities?: string[];
}

/** The table names a check compares on: last name part, lowercased. */
function entityNames(entities: readonly string[]): string[] {
  return Array.from(
    new Set(entities.map((entity) => tableName(entity.split('.')))),
  );
}

/** The entities a `usesEntities` check expects, given its context. */
export function expectedEntities(
  args: UsesEntitiesArgs,
  expectedSql: string | undefined,
): string[] {
  if (args.entities) return entityNames(args.entities);
  return expectedSql
    ? Array.from(new Set(tableReferences(expectedSql).map(tableName)))
    : [];
}

/**
 * The names a statement reads (R124): its table references, and for each
 * one that is a view, the tables and views the view reads, and theirs in
 * turn. A name already read is not opened again, so a cycle ends.
 */
export function readEntities(
  sql: string,
  views: ViewTables | undefined,
): Set<string> {
  const read = new Set(tableReferences(sql).map(tableName));
  if (!views?.size) return read;
  const pending = Array.from(read);
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    for (const table of views.get(name) ?? []) {
      if (read.has(table)) continue;
      read.add(table);
      pending.push(table);
    }
  }
  return read;
}

/**
 * `usesEntities` (agents-evals R124, criterion D2, schema linking): one query
 * that ran reads every entity the answer needs, by default those the
 * reference reads. Compared on the table name alone, because the dialects
 * qualify it differently (`world_cup.goals`, `api.world_cup.goals`). A view
 * of the sample counts as reading what its definition reads, so a query on
 * `v_match_results` reads `matches`, `tournaments`, `venues` and `teams`.
 */
export const usesEntities: DeterministicCheck<UsesEntitiesArgs> = {
  type: 'usesEntities',
  id: 'check-uses-entities',
  name: 'Uses Entities Check',
  criterion: 'D2',
  args: { required: [], optional: ['entities'] },
  validateArgs: (args) => stringListProblem(args, 'entities'),
  validateCase: (args, expectedSql) => {
    if (args.entities !== undefined) return undefined;
    const references = Object.values(expectedSql ?? {});
    if (references.length === 0) {
      return '"usesEntities" needs args."entities" or a reference query to take them from';
    }
    for (const sql of references) {
      if (sql && tableReferences(sql).length === 0) {
        return '"usesEntities" needs args."entities": the reference query names no table';
      }
    }
    return undefined;
  },
  describe: (args, context) => {
    const entities = expectedEntities(args, context.expectedSql);
    return `Checks that one successful SQL query reads ${entities.join(', ') || 'the reference tables'}`;
  },
  evaluate: (turn, args, context) => {
    const wanted = expectedEntities(args, context.expectedSql);
    const statements = executedStatements(turn);
    if (statements.length === 0) {
      return fail('no successful run_readonly_sql to inspect');
    }
    const views = context.views?.();
    let fewestMissing: string[] = wanted;
    for (const sql of statements) {
      const read = readEntities(sql, views);
      const missing = wanted.filter((entity) => !read.has(entity));
      if (missing.length === 0) return PASS;
      if (missing.length < fewestMissing.length) fewestMissing = missing;
    }
    return fail(
      `no single successful SQL reads every entity; the closest misses ${quotedList(fewestMissing)}`,
    );
  },
};
