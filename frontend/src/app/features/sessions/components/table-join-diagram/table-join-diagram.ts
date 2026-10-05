import { Component, computed, input } from '@angular/core';
import {
  EvidenceBasis,
  JoinEdge,
  RejectedEntity,
  TableChoice,
  TableRole,
} from '../../models/expert-trace.model';

/** One table box. Coordinates are in viewBox units (px at natural size). */
export interface DiagramNode {
  entity: string;
  /** Last two segments of the entity, e.g. `hr.employees`, fitted to the box. */
  label: string;
  role: TableRole;
  roleLabel: string;
  reason: string;
  /** Layout column after compaction (0 = leftmost). */
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** `columnsUsed` lines (at most four, then "+N more"), fitted to the box. */
  lines: string[];
  /** Fact / view tables carry the accent stroke — they are what is counted. */
  primary: boolean;
}

export interface DiagramEdge {
  key: string;
  path: string;
  label: string;
  labelX: number;
  labelY: number;
  labelWidth: number;
  /** Anything not read off the schema is drawn dashed. */
  dashed: boolean;
  basis: EvidenceBasis;
  title: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface DiagramRejected {
  entity: string;
  label: string;
  reason: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramLayout {
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  rejected: DiagramRejected[];
  /** Baseline of the "Not used" caption, when there are rejected tables. */
  rejectedCaptionY?: number;
}

const PAD = 12;
const NODE_GAP = 16;
const HEADER_H = 28;
const LINE_H = 15;
const NODE_PAD_B = 8;
const MAX_COLUMNS = 4;
const MIN_NODE_W = 150;
const MAX_NODE_W = 240;
/** Rough glyph widths for the fonts used below (11.5px sans, 10.5px mono, 10px mono). */
const SANS_W = 6.6;
const MONO_W = 6.4;
const LABEL_W = 6.1;
const ROLE_W = 40;
const LABEL_MAX = 34;
const LABEL_H = 16;
const LOOP_OUT = 44;
const REJECTED_H = 24;

/** Fact and view tables on the left, bridges in the middle, dimensions right. */
const ROLE_COLUMN: Record<TableRole, number> = {
  fact: 0,
  view: 0,
  bridge: 1,
  dimension: 2,
  lookup: 2,
};

const ROLE_LABEL: Record<TableRole, string> = {
  fact: 'fact',
  view: 'view',
  bridge: 'bridge',
  dimension: 'dim',
  lookup: 'lookup',
};

/** `catalog.schema.table` → `schema.table`; shorter keys are kept whole. */
export function shortEntityName(entity: string): string {
  const parts = entity.split('.').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('.') : entity;
}

function normalise(entity: string): string {
  return entity.trim().toLowerCase().replace(/["`[\]]/g, '');
}

/** Same table, allowing one side to be less qualified than the other. */
export function sameEntity(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

function fit(text: string, maxChars: number): string {
  const limit = Math.max(4, Math.floor(maxChars));
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

type Point = [number, number];

/** Point on a cubic Bézier whose x is closest to `x` (sampled; x is monotonic here). */
function pointAtX(p0: Point, p1: Point, p2: Point, p3: Point, x: number): Point {
  let best: Point = p0;
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    const point: Point = [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ];
    if (Math.abs(point[0] - x) < Math.abs(best[0] - x)) best = point;
  }
  return best;
}

/**
 * Deterministic layout for the data-selection block: columns by table role,
 * nodes stacked with 16px gaps and centred against the tallest column, joins
 * as cubic curves between node edges (loops on the right for joins inside one
 * column), rejected tables as a wrapped row underneath. The viewBox is the
 * bounding box of everything drawn, so nothing is clipped or wasted.
 */
export function layoutTableJoinDiagram(
  tables: TableChoice[],
  joins: JoinEdge[] = [],
  rejected: RejectedEntity[] = [],
): DiagramLayout {
  // Columns, compacted: a diagram without bridges has two columns, not three.
  const byColumn = new Map<number, TableChoice[]>();
  for (const table of tables) {
    const column = ROLE_COLUMN[table.role] ?? 2;
    byColumn.set(column, [...(byColumn.get(column) ?? []), table]);
  }
  const columns = [...byColumn.keys()]
    .sort((a, b) => a - b)
    .map((key) => byColumn.get(key)!);

  const edgeLabels = joins.map((join) =>
    fit(`${join.fromColumn} = ${join.toColumn}`, LABEL_MAX),
  );
  const longestLabel = edgeLabels.reduce((max, l) => Math.max(max, l.length), 0);
  const columnGap = joins.length
    ? clamp(longestLabel * LABEL_W + 40, 80, 220)
    : 48;

  // Widths per column, from the longest text that has to fit.
  const widths = columns.map((column) =>
    clamp(
      Math.max(
        ...column.map((table) =>
          Math.max(
            shortEntityName(table.entity).length * SANS_W + ROLE_W + 20,
            ...table.columnsUsed
              .slice(0, MAX_COLUMNS)
              .map((name) => name.length * MONO_W + 20),
          ),
        ),
      ),
      MIN_NODE_W,
      MAX_NODE_W,
    ),
  );

  const heightOf = (table: TableChoice): number => {
    const count = table.columnsUsed.length;
    const lines = Math.min(count, MAX_COLUMNS) + (count > MAX_COLUMNS ? 1 : 0);
    return HEADER_H + (lines ? lines * LINE_H + NODE_PAD_B : 0);
  };
  const columnHeights = columns.map(
    (column) =>
      column.reduce((sum, table) => sum + heightOf(table), 0) +
      NODE_GAP * Math.max(0, column.length - 1),
  );
  const tallest = Math.max(0, ...columnHeights);

  const nodes: DiagramNode[] = [];
  let x = PAD;
  columns.forEach((column, index) => {
    const width = widths[index];
    let y = PAD + (tallest - columnHeights[index]) / 2;
    for (const table of column) {
      const height = heightOf(table);
      const lines = table.columnsUsed
        .slice(0, MAX_COLUMNS)
        .map((name) => fit(name, (width - 20) / MONO_W));
      if (table.columnsUsed.length > MAX_COLUMNS) {
        lines.push(`+${table.columnsUsed.length - MAX_COLUMNS} more`);
      }
      nodes.push({
        entity: table.entity,
        label: fit(shortEntityName(table.entity), (width - ROLE_W - 20) / SANS_W),
        role: table.role,
        roleLabel: ROLE_LABEL[table.role] ?? table.role,
        reason: table.reason,
        column: index,
        x,
        y: round(y),
        width,
        height,
        lines,
        primary: table.role === 'fact' || table.role === 'view',
      });
      y += height + NODE_GAP;
    }
    x += width + columnGap;
  });

  const find = (entity: string): number => {
    const exact = nodes.findIndex(
      (node) => normalise(node.entity) === normalise(entity),
    );
    return exact >= 0
      ? exact
      : nodes.findIndex((node) => sameEntity(node.entity, entity));
  };

  // Resolve the joins we can draw, and which side of each node they leave by:
  // towards the other column, or both on the right for a join inside one.
  type Side = 'left' | 'right';
  interface Pending {
    join: JoinEdge;
    label: string;
    ends: [
      { node: number; side: Side; y: number },
      { node: number; side: Side; y: number },
    ];
  }
  const pending: Pending[] = [];
  joins.forEach((join, index) => {
    const from = find(join.from);
    const to = find(join.to);
    if (from < 0 || to < 0) return;
    const a = nodes[from].column;
    const b = nodes[to].column;
    pending.push({
      join,
      label: edgeLabels[index],
      ends: [
        { node: from, side: a > b ? 'left' : 'right', y: 0 },
        { node: to, side: a < b ? 'left' : 'right', y: 0 },
      ],
    });
  });

  // Several edges on one side of a node spread over its middle 60%, ordered
  // by where their other end sits so neighbouring curves do not cross.
  const bySlot = new Map<string, { edge: Pending; end: 0 | 1 }[]>();
  for (const edge of pending) {
    ([0, 1] as const).forEach((end) => {
      const key = `${edge.ends[end].node}|${edge.ends[end].side}`;
      bySlot.set(key, [...(bySlot.get(key) ?? []), { edge, end }]);
    });
  }
  const centreY = (index: number) => nodes[index].y + nodes[index].height / 2;
  for (const list of bySlot.values()) {
    const node = nodes[list[0].edge.ends[list[0].end].node];
    const sorted = [...list].sort(
      (p, q) =>
        centreY(p.edge.ends[1 - p.end].node) -
        centreY(q.edge.ends[1 - q.end].node),
    );
    sorted.forEach(({ edge, end }, k) => {
      edge.ends[end].y = round(
        node.y + node.height * (0.2 + (0.6 * (k + 1)) / (sorted.length + 1)),
      );
    });
  }

  const edges: DiagramEdge[] = [];
  const placed: { x: number; y: number; w: number }[] = [];
  let maxRight = nodes.reduce((max, n) => Math.max(max, n.x + n.width), 0);
  pending.forEach((edge, index) => {
    const [from, to] = edge.ends;
    const edgeX = (end: { node: number; side: Side }) =>
      end.side === 'right'
        ? nodes[end.node].x + nodes[end.node].width
        : nodes[end.node].x;
    const sx = edgeX(from);
    const ex = edgeX(to);
    const sy = from.y;
    const ey = to.y;
    const labelWidth = round(edge.label.length * LABEL_W + 12);
    let c1x: number;
    let c2x: number;
    let labelX: number;
    if (from.side === to.side) {
      // Same column (or a self-join): loop out to the right and back, with
      // the label just past the loop so it never covers a table.
      const out = Math.max(sx, ex) + LOOP_OUT;
      c1x = out;
      c2x = out;
      labelX = round(Math.max(sx, ex) + LOOP_OUT * 0.75 + labelWidth / 2 + 4);
    } else {
      const dir = ex >= sx ? 1 : -1;
      const dx = Math.max(24, Math.abs(ex - sx) / 2);
      c1x = sx + dir * dx;
      c2x = ex - dir * dx;
      // Point at t = 0.5 on the cubic.
      labelX = round((sx + 3 * c1x + 3 * c2x + ex) / 8);
    }
    let labelY = round((sy + ey) / 2);
    const span = Math.abs(nodes[from.node].column - nodes[to.node].column);
    if (from.side !== to.side && span > 1) {
      // The curve crosses a middle column: label it in the first gap, where
      // no table box can cover it.
      const dir = ex >= sx ? 1 : -1;
      const point = pointAtX(
        [sx, sy],
        [c1x, sy],
        [c2x, ey],
        [ex, ey],
        sx + (dir * columnGap) / 2,
      );
      labelX = round(point[0]);
      labelY = round(point[1]);
    }
    for (let tries = 0; tries < 8; tries++) {
      const clash = placed.some(
        (p) =>
          Math.abs(p.x - labelX) < (p.w + labelWidth) / 2 &&
          Math.abs(p.y - labelY) < LABEL_H + 2,
      );
      if (!clash) break;
      labelY += LABEL_H + 2;
    }
    placed.push({ x: labelX, y: labelY, w: labelWidth });
    maxRight = Math.max(maxRight, labelX + labelWidth / 2, c1x);
    const { basis } = edge.join;
    const fromName = shortEntityName(edge.join.from);
    const toName = shortEntityName(edge.join.to);
    edges.push({
      key: `${index}:${edge.join.from}.${edge.join.fromColumn}=${edge.join.to}.${edge.join.toColumn}`,
      path: `M ${round(sx)} ${sy} C ${round(c1x)} ${sy}, ${round(c2x)} ${ey}, ${round(ex)} ${ey}`,
      label: edge.label,
      labelX,
      labelY,
      labelWidth,
      dashed: basis !== 'schema',
      basis,
      title: `${fromName}.${edge.join.fromColumn} = ${toName}.${edge.join.toColumn} (${basis.replace('_', ' ')})`,
      start: { x: round(sx), y: sy },
      end: { x: round(ex), y: ey },
    });
  });

  let bottom = nodes.reduce((max, n) => Math.max(max, n.y + n.height), 0);
  bottom = placed.reduce((max, p) => Math.max(max, p.y + LABEL_H / 2), bottom);

  // Rejected tables: a dashed, dimmed row under the diagram, wrapped to width.
  const rejectedNodes: DiagramRejected[] = [];
  let rejectedCaptionY: number | undefined;
  if (rejected.length) {
    const rowWidth = Math.max(maxRight - PAD, 320);
    rejectedCaptionY = nodes.length ? bottom + 24 : PAD + 10;
    let rx = PAD;
    let ry = rejectedCaptionY + 8;
    for (const item of rejected) {
      const name = shortEntityName(item.entity);
      const width = clamp(name.length * MONO_W + 20, 64, 220);
      if (rx > PAD && rx + width > PAD + rowWidth) {
        rx = PAD;
        ry += REJECTED_H + 8;
      }
      rejectedNodes.push({
        entity: item.entity,
        label: fit(name, (width - 20) / MONO_W),
        reason: item.reason,
        x: rx,
        y: ry,
        width,
        height: REJECTED_H,
      });
      maxRight = Math.max(maxRight, rx + width);
      rx += width + 8;
    }
    bottom = ry + REJECTED_H;
  }

  return {
    width: Math.ceil(Math.max(maxRight, PAD) + PAD),
    height: Math.ceil(Math.max(bottom, PAD) + PAD),
    nodes,
    edges,
    rejected: rejectedNodes,
    rejectedCaptionY,
  };
}

/** Stroke class per join basis — the same colour families as the basis chips. */
const EDGE_STROKE: Record<EvidenceBasis, string> = {
  schema: 'stroke-zinc-500',
  knowledge: 'stroke-emerald-400/80',
  metric: 'stroke-emerald-400/80',
  verified_query: 'stroke-emerald-400/80',
  data_sample: 'stroke-sky-400/80',
  convention: 'stroke-amber-400/80',
  assumption: 'stroke-red-400/80',
};

/**
 * The tables an answer used and how they were joined, as a small inline SVG
 * (no chart library): chosen tables as boxes grouped by role, joins as curves
 * labelled `fromColumn = toColumn` (solid when the schema declares the join,
 * dashed otherwise), tables considered and rejected greyed out underneath.
 */
@Component({
  selector: 'app-table-join-diagram',
  templateUrl: './table-join-diagram.html',
  styleUrl: './table-join-diagram.scss',
})
export class TableJoinDiagram {
  readonly tables = input.required<TableChoice[]>();
  readonly joins = input<JoinEdge[]>([]);
  readonly rejected = input<RejectedEntity[]>([]);

  /** Tall diagrams scale down rather than push the answer off screen. */
  readonly maxHeight = 420;

  readonly layout = computed(() =>
    layoutTableJoinDiagram(this.tables(), this.joins(), this.rejected()),
  );

  readonly viewBox = computed(
    () => `0 0 ${this.layout().width} ${this.layout().height}`,
  );

  /** Text equivalent of the picture for screen readers. */
  readonly ariaLabel = computed(() => {
    const { nodes, edges, rejected } = this.layout();
    const parts = [
      `Tables used: ${nodes.map((n) => `${shortEntityName(n.entity)} (${n.role})`).join(', ') || 'none'}.`,
    ];
    if (edges.length) {
      parts.push(`Joins: ${edges.map((e) => e.title).join('; ')}.`);
    }
    if (rejected.length) {
      parts.push(`Not used: ${rejected.map((r) => shortEntityName(r.entity)).join(', ')}.`);
    }
    return parts.join(' ');
  });

  edgeStroke(basis: EvidenceBasis): string {
    return EDGE_STROKE[basis] ?? 'stroke-zinc-500';
  }
}
