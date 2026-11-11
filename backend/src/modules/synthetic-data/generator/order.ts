// Emission order (plan 2.4): Kahn's topological order of the FK graph (parent before
// child), ties broken by table key; tables left in a cycle follow in key order.
// Self-references are ignored for the order.

import type { SampledRelationship } from '../types';

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function emissionOrder(
  keys: string[],
  relationships: SampledRelationship[],
): string[] {
  const known = new Set(keys);
  const indegree = new Map(keys.map((k) => [k, 0]));
  const children = new Map<string, string[]>(keys.map((k) => [k, []]));
  const seen = new Set<string>();
  for (const r of relationships) {
    if (
      r.fromTable === r.toTable ||
      !known.has(r.fromTable) ||
      !known.has(r.toTable)
    )
      continue;
    const edge = `${r.toTable}\u0000${r.fromTable}`;
    if (seen.has(edge)) continue;
    seen.add(edge);
    children.get(r.toTable)!.push(r.fromTable);
    indegree.set(r.fromTable, indegree.get(r.fromTable)! + 1);
  }
  const ready = keys.filter((k) => indegree.get(k) === 0).sort(byKey);
  const out: string[] = [];
  while (ready.length > 0) {
    const k = ready.shift()!;
    out.push(k);
    for (const c of children.get(k)!) {
      const d = indegree.get(c)! - 1;
      indegree.set(c, d);
      if (d === 0) {
        ready.push(c);
        ready.sort(byKey);
      }
    }
  }
  const placed = new Set(out);
  out.push(...keys.filter((k) => !placed.has(k)).sort(byKey));
  return out;
}
