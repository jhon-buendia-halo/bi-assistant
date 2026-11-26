// F1.20.3 — name-matched join candidates for sources that declare no foreign
// keys (Databricks views, constraint-free schemas). A column `X_id`/`XId` in a
// child table joins a sibling table named like `X` (or its conventional
// variants) on `id`/the same column. Candidates are verified with a real
// orphan-count query by the adapter and surfaced as `origin: 'inferred'`
// relationships, which the Integrity check severity-caps and labels.

export interface JoinTableShape {
  namespace: string;
  name: string;
  columns: string[];
}

export interface JoinCandidate {
  schema: string;
  table: string;
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
}

/** Hard cap so a wide source can't turn the probe into a query storm. */
export const MAX_INFERRED_JOIN_CANDIDATES = 20;

/**
 * Pure matcher. `childTables` is the (possibly scope-filtered) set whose
 * columns are inspected; `allTables` is the full inventory the targets are
 * resolved against. `declaredKeys` ("schema table column") suppresses
 * candidates already covered by a declared FK on the same child column.
 */
export function inferJoinCandidates(
  childTables: JoinTableShape[],
  allTables: JoinTableShape[],
  declaredKeys: Set<string>,
): JoinCandidate[] {
  // Target lookup by lowercase table name within a namespace.
  const byName = new Map<string, JoinTableShape>();
  for (const t of allTables) {
    byName.set(`${t.namespace} ${t.name.toLowerCase()}`, t);
  }

  const out: JoinCandidate[] = [];
  for (const child of childTables) {
    for (const column of child.columns) {
      const m = /^(.*?)(?:_id|Id)$/.exec(column);
      if (!m || !m[1]) continue;
      const base = m[1].toLowerCase();
      if (declaredKeys.has(`${child.namespace} ${child.name} ${column}`))
        continue;

      // Conventional target spellings, same namespace only (cross-namespace
      // joins exist but the false-positive rate of guessing them is too high).
      const variants = [
        base,
        `${base}s`,
        `dim_${base}`,
        `${base}_dim`,
        `dim${base}`,
      ];
      let target: JoinTableShape | undefined;
      for (const v of variants) {
        const hit = byName.get(`${child.namespace} ${v}`);
        if (hit && hit.name !== child.name) {
          target = hit;
          break;
        }
      }
      if (!target) continue;

      // Join column on the target: `id` if present, else the same column name.
      const refColumn =
        target.columns.find((c) => c.toLowerCase() === 'id') ??
        target.columns.find((c) => c.toLowerCase() === column.toLowerCase());
      if (!refColumn) continue;

      out.push({
        schema: child.namespace,
        table: child.name,
        column,
        refSchema: target.namespace,
        refTable: target.name,
        refColumn,
      });
      if (out.length >= MAX_INFERRED_JOIN_CANDIDATES) return out;
    }
  }
  return out;
}
