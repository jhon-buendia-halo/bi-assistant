import { END_NODE_ID, START_NODE_ID } from '../models/workflow-node.model';
import { WorkflowDetail, WorkflowEdge } from '../models/workflow.model';

/**
 * Pure helpers over a workflow's graph (api.md 117 `edges`): the edges the
 * page draws (from the API, or the linear chain of an older backend), the
 * main path left to right, and the steps on every path before a step.
 */

/**
 * The workflow's edges: `edges` when the backend sends them, else Start →
 * each step in list order → End, all `next`.
 */
export function workflowEdges(
  w: Pick<WorkflowDetail, 'steps' | 'edges'>,
): WorkflowEdge[] {
  if (w.edges?.length) return w.edges;
  const ids = [START_NODE_ID, ...w.steps.map((s) => s.id), END_NODE_ID];
  return ids.slice(1).map((to, i) => ({ from: ids[i], to, kind: 'next' }));
}

/** The forward edges (no `loop`) out of each node, in edge order. */
function forward(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const out = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (edge.kind === 'loop') continue;
    const list = out.get(edge.from) ?? [];
    list.push(edge);
    out.set(edge.from, list);
  }
  return out;
}

/**
 * The main path, Start to End: at each node the way out that leads to the
 * most steps (a branch that ends the run at once is a side way). Loop edges
 * are ignored. Nodes left out are side nodes, drawn below their source.
 */
export function mainPath(edges: WorkflowEdge[]): string[] {
  const out = forward(edges);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const next = out.get(id) ?? [];
    const d = next.length ? 1 + Math.max(...next.map((e) => depth(e.to))) : 0;
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };
  const path = [START_NODE_ID];
  const seen = new Set(path);
  let at = START_NODE_ID;
  for (;;) {
    const next = (out.get(at) ?? []).filter((e) => !seen.has(e.to));
    if (!next.length) break;
    // The deepest way out; on a tie, `next` before `branch`, then edge order.
    const best = next.reduce((a, b) => {
      const da = depth(a.to);
      const db = depth(b.to);
      if (db !== da) return db > da ? b : a;
      return a.kind !== 'next' && b.kind === 'next' ? b : a;
    });
    path.push(best.to);
    seen.add(best.to);
    at = best.to;
  }
  return path;
}

/** The nodes on some forward path into `id` (Start included), without `id`. */
export function ancestorIds(edges: WorkflowEdge[], id: string): Set<string> {
  const into = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind === 'loop') continue;
    const list = into.get(edge.to) ?? [];
    list.push(edge.from);
    into.set(edge.to, list);
  }
  const found = new Set<string>();
  const queue = [...(into.get(id) ?? [])];
  while (queue.length) {
    const next = queue.pop()!;
    if (next === id || found.has(next)) continue;
    found.add(next);
    queue.push(...(into.get(next) ?? []));
  }
  return found;
}
