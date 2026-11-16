// Key analysis shared by the plan (clamping) and the generator (plan 2.4).
// A table's foreign-key columns are drawn from their parents' generated keys, one
// relationship (a "unit", whole tuples for a composite FK) at a time. A PK or unique key
// made only of such drawn columns needs distinct parent tuples: those keys form "groups".

import type {
  SampledRelationship,
  SampledTable,
  SynthesisStrategy,
} from '../types';

/** Strategies whose values are distinct within the table by construction. */
export const SELF_UNIQUE: ReadonlySet<SynthesisStrategy> =
  new Set<SynthesisStrategy>([
    'sequence',
    'unique-range',
    'uuid',
    'unique-pattern',
  ]);

export interface FkUnit {
  rel: SampledRelationship;
}

export interface TupleGroup {
  /** Indices into `units`, ascending. */
  units: number[];
  /** The key constraints (column lists) the group's rows must keep distinct. */
  constraints: string[][];
}

export interface TableKeyPlan {
  units: FkUnit[];
  /** Column name → index of the unit that draws it. */
  fkColumn: Map<string, number>;
  groups: TupleGroup[];
  /** Columns of the PK or any unique key: never NULL. */
  keyColumns: Set<string>;
}

export function analyseTable(
  table: SampledTable,
  relationships: SampledRelationship[],
): TableKeyPlan {
  const names = new Set(table.columns.map((c) => c.name));
  const units: FkUnit[] = [];
  const fkColumn = new Map<string, number>();
  for (const rel of relationships) {
    if (rel.fromTable !== table.key) continue;
    if (
      rel.fromColumns.length === 0 ||
      rel.fromColumns.length !== rel.toColumns.length
    )
      continue;
    if (rel.fromColumns.some((c) => !names.has(c) || fkColumn.has(c))) continue;
    const i = units.length;
    units.push({ rel });
    for (const c of rel.fromColumns) fkColumn.set(c, i);
  }

  const strategyOf = new Map(table.columns.map((c) => [c.name, c.strategy]));
  const constraints = [
    ...(table.primaryKey.length > 0 ? [table.primaryKey] : []),
    ...table.uniqueKeys.filter((k) => k.length > 0),
  ];
  const keyColumns = new Set(constraints.flat());

  // Union-find over units joined by a constraint that needs distinct tuples.
  const parent = units.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const needing: { cols: string[]; units: number[] }[] = [];
  for (const cols of constraints) {
    const selfUnique = cols.some((c) => {
      const s = strategyOf.get(c);
      return !fkColumn.has(c) && s !== undefined && SELF_UNIQUE.has(s);
    });
    if (selfUnique) continue;
    const us = [
      ...new Set(
        cols.filter((c) => fkColumn.has(c)).map((c) => fkColumn.get(c)!),
      ),
    ];
    if (us.length === 0) continue;
    needing.push({ cols, units: us });
    for (const u of us.slice(1)) parent[find(u)] = find(us[0]);
  }
  const byRoot = new Map<number, TupleGroup>();
  for (const n of needing) {
    const root = find(n.units[0]);
    let g = byRoot.get(root);
    if (!g) byRoot.set(root, (g = { units: [], constraints: [] }));
    g.constraints.push(n.cols);
    for (const u of n.units) if (!g.units.includes(u)) g.units.push(u);
  }
  const groups = [...byRoot.values()].map((g) => ({
    ...g,
    units: g.units.sort((a, b) => a - b),
  }));
  return { units, fkColumn, groups, keyColumns };
}
