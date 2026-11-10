import { OntologyItem, RelationType } from '../../models/ontology.model';

/**
 * The Ontology tab's relations graph (1.21.10): turns concepts and relations
 * into nodes and edges, and lays them out with a small deterministic
 * force-directed simulation — no graph library, no animation loop.
 */

export interface GraphMetric {
  id: string;
  name: string;
  label: string;
  description?: string;
}

export interface OntologyGraphNode {
  /** Concept id, or `metric:<metricId>` for a metric. */
  id: string;
  kind: 'concept' | 'metric';
  label: string;
  /** The label as drawn — truncated with an ellipsis to fit the node. */
  shortLabel: string;
  width: number;
  height: number;
  /** Disabled or pending concept. Metrics are never faded. */
  faded: boolean;
  /** Shared by every dataset ("All datasets"). */
  shared: boolean;
  item?: OntologyItem;
  metric?: GraphMetric;
}

export interface OntologyGraphEdge {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  faded: boolean;
  item: OntologyItem;
}

export interface OntologyGraph {
  nodes: OntologyGraphNode[];
  edges: OntologyGraphEdge[];
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const NODE_HEIGHT = 36;
const CHAR_W = 7;
const MIN_W = 96;
const MAX_W = 184;
/** Room inside a node besides the label: icon, padding, shared marker. */
const NODE_CHROME = 44;

export const LAYOUT_WIDTH = 900;
export const LAYOUT_HEIGHT = 520;
const LAYOUT_ITERATIONS = 320;
const FIT_PADDING = 40;

export function metricNodeId(metricId: string): string {
  return `metric:${metricId}`;
}

/** A node's width from its label, and the label cut to fit it. */
export function sizeLabel(label: string): { width: number; shortLabel: string } {
  const width = Math.max(MIN_W, Math.min(MAX_W, label.length * CHAR_W + NODE_CHROME));
  const maxChars = Math.floor((width - NODE_CHROME) / CHAR_W);
  const shortLabel =
    label.length > maxChars ? `${label.slice(0, Math.max(1, maxChars - 1))}…` : label;
  return { width, shortLabel };
}

/**
 * Nodes: one per concept, one per metric a measured-by relation targets.
 * Edges: one per relation whose endpoints both resolve (dangling ones and
 * self-loops are skipped).
 */
export function buildOntologyGraph(
  items: OntologyItem[],
  metrics: GraphMetric[],
): OntologyGraph {
  const nodes: OntologyGraphNode[] = [];
  const byId = new Map<string, OntologyGraphNode>();

  for (const item of items) {
    if (item.kind !== 'concept' || byId.has(item.id)) continue;
    const { width, shortLabel } = sizeLabel(item.name);
    const node: OntologyGraphNode = {
      id: item.id,
      kind: 'concept',
      label: item.name,
      shortLabel,
      width,
      height: NODE_HEIGHT,
      faded: item.enabled === false,
      shared: item.dataset === null,
      item,
    };
    nodes.push(node);
    byId.set(node.id, node);
  }

  const edges: OntologyGraphEdge[] = [];
  for (const item of items) {
    if (item.kind !== 'relation' || !item.from || !item.type) continue;
    if (!byId.has(item.from) || byId.get(item.from)!.kind !== 'concept') continue;

    let to: string;
    if (item.type === 'measured-by') {
      const metric = metrics.find((m) => m.id === item.metricId);
      if (!metric) continue;
      to = metricNodeId(metric.id);
      if (!byId.has(to)) {
        const label = metric.label || metric.name;
        const { width, shortLabel } = sizeLabel(label);
        const node: OntologyGraphNode = {
          id: to,
          kind: 'metric',
          label,
          shortLabel,
          width,
          height: NODE_HEIGHT,
          faded: false,
          shared: false,
          metric,
        };
        nodes.push(node);
        byId.set(to, node);
      }
    } else {
      if (!item.to || !byId.has(item.to) || item.to === item.from) continue;
      to = item.to;
    }
    edges.push({
      id: item.id,
      from: item.from,
      to,
      type: item.type,
      faded: item.enabled === false,
      item,
    });
  }

  return { nodes, edges };
}

/** mulberry32 — a tiny seeded PRNG so the same input always lays out the same. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Fruchterman–Reingold-style layout: pairwise repulsion, springs along the
 * edges and a pull to the centre, with a cooling step size. Runs a fixed
 * number of iterations synchronously; every node stays inside the area.
 */
export function layoutOntologyGraph(
  graph: OntologyGraph,
  width = LAYOUT_WIDTH,
  height = LAYOUT_HEIGHT,
  iterations = LAYOUT_ITERATIONS,
): Map<string, Point> {
  const { nodes, edges } = graph;
  const positions = new Map<string, Point>();
  if (nodes.length === 0) return positions;

  const cx = width / 2;
  const cy = height / 2;
  const random = seededRandom(hashString(nodes.map((n) => n.id).join('|')));

  // Start on a jittered circle so no two nodes share a point.
  const radius = Math.min(width, height) * 0.35;
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    positions.set(node.id, {
      x: cx + radius * Math.cos(angle) + (random() - 0.5) * 20,
      y: cy + radius * Math.sin(angle) + (random() - 0.5) * 20,
    });
  });
  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: cx, y: cy });
    return positions;
  }

  // Positions run free (no clamping to the area, which piled unconnected
  // nodes into the corners) and are scaled into the area at the end.
  const REPULSION = 105; // reach of node-to-node repulsion, in px
  const SPRING = 0.1; // stiffness pulling an edge to its ideal length
  const GRAVITY = 0.02; // pull to the centre, keeps loose concepts gathered
  const EDGE_LABEL_ROOM = 90; // free length between two linked nodes
  let temperature = width / 10;
  const cooling = temperature / (iterations + 1);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const dx = new Float64Array(nodes.length);
  const dy = new Float64Array(nodes.length);

  for (let step = 0; step < iterations; step++) {
    dx.fill(0);
    dy.fill(0);

    for (let i = 0; i < nodes.length; i++) {
      const a = positions.get(nodes[i].id)!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = positions.get(nodes[j].id)!;
        let ddx = a.x - b.x;
        let ddy = a.y - b.y;
        let dist = Math.hypot(ddx, ddy);
        if (dist < 0.01) {
          ddx = random() - 0.5;
          ddy = random() - 0.5;
          dist = Math.hypot(ddx, ddy);
        }
        let force = (REPULSION * REPULSION) / dist;
        // Extra push while two boxes (plus a margin) overlap, so labels never
        // sit on top of each other.
        const overlapX =
          (nodes[i].width + nodes[j].width) / 2 + 24 - Math.abs(ddx);
        const overlapY =
          (nodes[i].height + nodes[j].height) / 2 + 24 - Math.abs(ddy);
        if (overlapX > 0 && overlapY > 0) force += Math.min(overlapX, overlapY) * 4;
        const fx = (ddx / dist) * force;
        const fy = (ddy / dist) * force;
        dx[i] += fx;
        dy[i] += fy;
        dx[j] -= fx;
        dy[j] -= fy;
      }
    }

    for (const edge of edges) {
      const i = index.get(edge.from)!;
      const j = index.get(edge.to)!;
      const a = positions.get(edge.from)!;
      const b = positions.get(edge.to)!;
      const ddx = a.x - b.x;
      const ddy = a.y - b.y;
      const dist = Math.max(0.01, Math.hypot(ddx, ddy));
      // Room for both boxes plus the relation label between them.
      const ideal =
        (nodes[i].width + nodes[j].width) / 2 + EDGE_LABEL_ROOM;
      const force = (dist - ideal) * SPRING * 10;
      const fx = (ddx / dist) * force;
      const fy = (ddy / dist) * force;
      dx[i] -= fx;
      dy[i] -= fy;
      dx[j] += fx;
      dy[j] += fy;
    }

    for (let i = 0; i < nodes.length; i++) {
      const p = positions.get(nodes[i].id)!;
      dx[i] += (cx - p.x) * GRAVITY * 10;
      dy[i] += (cy - p.y) * GRAVITY * 10;
      const len = Math.hypot(dx[i], dy[i]);
      if (len > 0) {
        const move = Math.min(len, temperature);
        p.x += (dx[i] / len) * move;
        p.y += (dy[i] / len) * move;
      }
    }
    temperature = Math.max(1, temperature - cooling);
  }

  fitIntoArea(nodes, positions, width, height);
  separateBoxes(nodes, edges, positions, width, height);
  return positions;
}

/**
 * Fitting can scale centres closer than the boxes allow. This pass pushes
 * apart any two boxes closer than a margin (linked boxes keep room for the
 * relation label between them), staying inside the area.
 */
function separateBoxes(
  nodes: OntologyGraphNode[],
  edges: OntologyGraph['edges'],
  positions: Map<string, Point>,
  width: number,
  height: number,
): void {
  const linked = new Set(
    edges.flatMap((e) => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]),
  );
  const MARGIN = 18;
  const LABEL_GAP = 56;
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i].id)!;
        const b = positions.get(nodes[j].id)!;
        const gap = linked.has(`${nodes[i].id}|${nodes[j].id}`)
          ? LABEL_GAP
          : MARGIN;
        const needX = (nodes[i].width + nodes[j].width) / 2 + gap;
        const needY = (nodes[i].height + nodes[j].height) / 2 + gap;
        const ddx = b.x - a.x;
        const ddy = b.y - a.y;
        const overX = needX - Math.abs(ddx);
        const overY = needY - Math.abs(ddy);
        if (overX <= 0 || overY <= 0) continue;
        moved = true;
        // Separate along the axis that needs the smaller move.
        if (overX / needX < overY / needY) {
          const s = (ddx >= 0 ? 1 : -1) * (overX / 2 + 0.5);
          a.x -= s;
          b.x += s;
        } else {
          const s = (ddy >= 0 ? 1 : -1) * (overY / 2 + 0.5);
          a.y -= s;
          b.y += s;
        }
      }
    }
    for (const node of nodes) {
      const p = positions.get(node.id)!;
      const halfW = node.width / 2 + 6;
      const halfH = node.height / 2 + 6;
      p.x = Math.min(width - halfW, Math.max(halfW, p.x));
      p.y = Math.min(height - halfH, Math.max(halfH, p.y));
    }
    if (!moved) break;
  }
}

/**
 * Translates and (only when too big) scales the free layout so every node box
 * sits inside the area with a margin; a small layout is centred, not enlarged.
 */
function fitIntoArea(
  nodes: OntologyGraphNode[],
  positions: Map<string, Point>,
  width: number,
  height: number,
): void {
  const margin = 12;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const p = positions.get(node.id)!;
    minX = Math.min(minX, p.x - node.width / 2);
    maxX = Math.max(maxX, p.x + node.width / 2);
    minY = Math.min(minY, p.y - node.height / 2);
    maxY = Math.max(maxY, p.y + node.height / 2);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min(
    1,
    (width - 2 * margin) / spanX,
    (height - 2 * margin) / spanY,
  );
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  for (const node of nodes) {
    const p = positions.get(node.id)!;
    // Scale distances between centres; boxes keep their size, so clamp the
    // centre to keep each whole box inside.
    const x = offX + (p.x - minX) * scale;
    const y = offY + (p.y - minY) * scale;
    const halfW = node.width / 2 + margin / 2;
    const halfH = node.height / 2 + margin / 2;
    p.x = Math.min(width - halfW, Math.max(halfW, x));
    p.y = Math.min(height - halfH, Math.max(halfH, y));
  }
}

/** The smallest padded viewBox that shows every node. */
export function fitViewBox(
  nodes: OntologyGraphNode[],
  positions: Map<string, Point>,
): ViewBox {
  if (nodes.length === 0) return { x: 0, y: 0, w: LAYOUT_WIDTH, h: LAYOUT_HEIGHT };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const p = positions.get(node.id);
    if (!p) continue;
    minX = Math.min(minX, p.x - node.width / 2);
    maxX = Math.max(maxX, p.x + node.width / 2);
    minY = Math.min(minY, p.y - node.height / 2);
    maxY = Math.max(maxY, p.y + node.height / 2);
  }
  // Never zoom in past 1:1 on a tiny graph — keep a sensible minimum area.
  const w = Math.max(maxX - minX + FIT_PADDING * 2, 480);
  const h = Math.max(maxY - minY + FIT_PADDING * 2, 280);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return { x: midX - w / 2, y: midY - h / 2, w, h };
}

/** The point where the segment from a node's centre toward `toward` leaves its box. */
export function boxExit(
  center: Point,
  toward: Point,
  width: number,
  height: number,
): Point {
  const ddx = toward.x - center.x;
  const ddy = toward.y - center.y;
  if (ddx === 0 && ddy === 0) return center;
  const hw = width / 2 + 3;
  const hh = height / 2 + 3;
  const scale = Math.min(
    ddx === 0 ? Infinity : hw / Math.abs(ddx),
    ddy === 0 ? Infinity : hh / Math.abs(ddy),
  );
  return { x: center.x + ddx * scale, y: center.y + ddy * scale };
}

export interface EdgeGeometry {
  path: string;
  label: Point;
}

/**
 * Edge paths: straight when a pair has one edge, fanned quadratic curves when
 * several relations connect the same two nodes.
 */
export function edgeGeometries(
  graph: OntologyGraph,
  positions: Map<string, Point>,
): Map<string, EdgeGeometry> {
  const result = new Map<string, EdgeGeometry>();
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const groups = new Map<string, OntologyGraphEdge[]>();
  for (const edge of graph.edges) {
    const key = [edge.from, edge.to].sort().join('\u0000');
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }

  for (const group of groups.values()) {
    group.forEach((edge, i) => {
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      const na = nodeById.get(edge.from);
      const nb = nodeById.get(edge.to);
      if (!a || !b || !na || !nb) return;
      // The offset is measured against one canonical direction per pair so
      // A→B and B→A edges fan to opposite sides.
      const [first] = [edge.from, edge.to].sort();
      const sign = first === edge.from ? 1 : -1;
      const offset = (i - (group.length - 1) / 2) * 34 * sign;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const len = Math.max(0.01, Math.hypot(b.x - a.x, b.y - a.y));
      const control = {
        x: mx + (-(b.y - a.y) / len) * offset,
        y: my + ((b.x - a.x) / len) * offset,
      };
      const start = boxExit(a, offset ? control : b, na.width, na.height);
      const end = boxExit(b, offset ? control : a, nb.width, nb.height);
      const path = offset
        ? `M ${r(start.x)} ${r(start.y)} Q ${r(control.x)} ${r(control.y)} ${r(end.x)} ${r(end.y)}`
        : `M ${r(start.x)} ${r(start.y)} L ${r(end.x)} ${r(end.y)}`;
      const label = offset
        ? {
            x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
            y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
          }
        : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      result.set(edge.id, { path, label });
    });
  }
  return result;
}

function r(value: number): string {
  return value.toFixed(1);
}
