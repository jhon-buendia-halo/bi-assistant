import { END_NODE_ID, START_NODE_ID, WorkflowNodeKind } from '../models/workflow-node.model';
import {
  WorkflowDetail,
  WorkflowDetailStep,
  WorkflowEdge,
} from '../models/workflow.model';
import { contractFields, passesOnText } from './workflow-contract';
import { mainPath, workflowEdges } from './workflow-graph';

/**
 * The workflow page's n8n-style canvas (ui.md 4.4b): Start, one column per
 * step and End, left to right on one shared centre line. An agent step is a
 * wide node with a Model and a Tools port on its bottom edge, joined by dashed
 * lines to round sub-nodes below it: its model and one Tools sub-node. Sized
 * so Questions to Insights v2 fits beside the open right panel at 1440 px
 * (55%). Everything here is a pure function of the workflow, in canvas pixels
 * at 100%.
 */
export const CANVAS = {
  /** Around the whole graph. */
  padding: 20,
  /** Start, a code step and End are squares of this side. */
  square: 52,
  agentWidth: 120,
  /** An agent step's height; squares share its centre line. */
  nodeHeight: 88,
  /** Between two columns, where the edge and its label run (wider for a wider label). */
  colGap: 44,
  /** The title and subtitle under a square node: their box. */
  labelWidth: 92,
  labelHeight: 86,
  exitRowHeight: 16,
  /** An agent's exit note wraps past this width. */
  exitWidth: 136,
  /** A sub-node's diameter. */
  subSize: 40,
  /** From the agent's bottom edge to the top of its sub-nodes. */
  subTop: 44,
  /** The label and subtitle under a sub-node: their box (the Model's; the Tools' is narrower). */
  subLabelWidth: 88,
  toolsLabelWidth: 52,
  subLabelHeight: 52,
  /** Between the main row's lowest point and the side row. */
  sideGap: 28,
} as const;

/** The zoom levels zoom in / out step through; fit may land between them. */
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5] as const;
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 1.5;

/** Between an agent's exit notes and its top edge (room for the status badge). */
const EXIT_GAP = 12;
/** An exit note's width, estimated: per character at 11 px, plus its icon and padding. */
const EXIT_CHAR = 5.4;
const EXIT_EXTRA = 23;
/** An edge label sits this far above the centre line; a branch label this far below it. */
const EDGE_LABEL_RISE = 12;
const BRANCH_LABEL_DROP = 3;
/** A branch label's line height, and its border top and bottom. */
const BRANCH_LINE = 14;
const BRANCH_BORDER = 2;
/** The room kept right of the last label (a square's), when it runs past the padding. */
const EDGE_MARGIN = 4;
/** How high the loop's curve rises above the row, and the room kept above it. */
const LOOP_RISE = 36;
const LOOP_ROOM = 56;
/** Where the loop comes back in: right of the node, below its status badge. */
const LOOP_ENTRY_X = 18;
const LOOP_ENTRY_Y = 18;
/** A side node's way back up to its source: this far left of its centre, into the source's side this far above its bottom. */
const RETURN_X = 12;
const RETURN_ENTRY_Y = 16;
/** The radius of an edge's rounded corner. */
const CORNER = 8;
/** A side node's edge to End enters it this far below its centre. */
const END_ENTRY_Y = 12;
/** A side edge's label: this far beside its vertical line. */
const SIDE_LABEL_OFFSET = 6;
/** A branch label (11 px medium) per character, and its padding and border. */
const LABEL_CHAR = 5.5;
const LABEL_PAD = 14;
/** A main-path branch label wider than this wraps onto two lines. */
const BRANCH_WRAP = 64;
/** A field count label (11 px) per character, its padding, and the room around it. */
const FIELDS_CHAR = 4.7;
const FIELDS_PAD = 4;
const FIELDS_MARGIN = 2;
/** A port's label (11 px) per character. */
const PORT_CHAR = 5.5;
/** A square's label starts this far under it; a sub-node's this far. */
const SQUARE_LABEL_TOP = 8;
const SUB_LABEL_TOP = 6;
/** Between two agents' sub-node labels. */
const SUB_LABEL_GAP = 4;
/** The ports' places along the agent's bottom edge, as a fraction of its width. */
const PORT_AT = { model: 0.2, tool: 0.85 } as const;

/** A tool is reached through its agent's Tools sub-node, never a node of its own. */
export type CanvasNodeKind = Exclude<WorkflowNodeKind, 'tool'>;

export interface CanvasPort {
  kind: 'model' | 'tool';
  label: 'Model' | 'Tools';
  /** The diamond's centre, on the agent's bottom edge. */
  x: number;
  y: number;
}

export interface CanvasSubNode {
  /** `<stepId>-model` | `<stepId>-tools`. */
  id: string;
  kind: 'model' | 'tools';
  /** The model's last `/` segment or `No model set`; `Tools`. */
  label: string;
  /** `model`; `1 tool` / `<n> tools`. */
  subtitle: string;
  /** The tools its menu lists (Tools only); else empty. */
  tools: string[];
  /** Top-left of the circle. */
  x: number;
  y: number;
  size: number;
}

export interface CanvasExit {
  text: string;
  outcome: 'fails' | 'stops';
  /** The note's horizontal centre (`align: center`) or left edge (`start`), and its top. */
  x: number;
  y: number;
  align: 'center' | 'start';
  /** It wraps past this width. */
  width: number;
  /** Its estimated line count at that width. */
  lines: number;
}

export interface CanvasNode {
  kind: CanvasNodeKind;
  /** `start`, `end` or the step's id. */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The shared centre line, where edges join. */
  centerY: number;
  /** 1-based step number; null for Start and End. */
  number: number | null;
  title: string;
  /** The step id; Start: the input field names; End: the last step's output names. */
  subtitle: string;
  /** An agent step's agent name, then ` · ≤ <n> steps` when it may take more than one; else null. */
  agentLine: string | null;
  step: WorkflowDetailStep | null;
  exits: CanvasExit[];
  ports: CanvasPort[];
  subNodes: CanvasSubNode[];
}

export interface CanvasEdge {
  /** `<from id>-<to id>`. */
  id: string;
  from: string;
  to: string;
  /** `next` in order, `branch` one way out of a branch, `loop` back to an earlier step. */
  kind: WorkflowEdge['kind'];
  path: string;
  /** What runs along the edge: the source step's output (from Start, the first step's input). */
  fields: string[];
  /**
   * Its title and screen-reader text: `Passes on: question (string), …`,
   * typed from the source step's declared output (from Start, the first
   * step's declared input); names only when none is declared.
   */
  passesOn: string;
  /** `1 field` | `<n> fields` | `` when nothing is passed. */
  label: string;
  /** The label's centre. */
  labelX: number;
  labelY: number;
  /** The graph edge's own label (`Needs clarification`, `Clear`, `Retry once`, `Valid or retried`); null when it has none. */
  branchLabel: string | null;
  /** That label as drawn: one line, or two when a main-path label is wide. */
  branchLabelLines: string[];
  /** That label's centre: below the line, beside the drop to a side node, or on the loop's curve. */
  branchLabelX: number;
  branchLabelY: number;
}

export interface CanvasSubEdge {
  id: string;
  /** The agent step's id. */
  nodeId: string;
  subNodeId: string;
  path: string;
}

export interface CanvasLayout {
  width: number;
  height: number;
  /** Start, the main path's steps left to right, End, then the side steps below. */
  nodes: CanvasNode[];
  /** One per graph edge (api.md 117), in its order; without edges, one per pair of consecutive nodes. */
  edges: CanvasEdge[];
  /** One per sub-node, from its port down to it. */
  subEdges: CanvasSubEdge[];
}

/** What a box on the canvas belongs to, for the no-overlap check and the canvas size. */
export interface CanvasBox {
  /** The node, sub-node or edge id. */
  owner: string;
  part:
    | 'node'
    | 'label'
    | 'exit'
    | 'port-label'
    | 'sub-node'
    | 'sub-label'
    | 'edge-label'
    | 'branch-label';
  x: number;
  y: number;
  w: number;
  h: number;
}

const EXIT_TEXT = { fails: 'fails', stops: 'ends here' } as const;
/** Start's exit note (ui.md 4.4b): the input is checked before anything runs. */
const START_EXIT_TEXT = 'Invalid input → not started';

/** `1 field` / `<n> fields`, or '' for none. */
export function fieldsLabel(count: number): string {
  if (count === 0) return '';
  return count === 1 ? '1 field' : `${count} fields`;
}

/** `1 tool` / `<n> tools`. */
export function toolsLabel(count: number): string {
  return count === 1 ? '1 tool' : `${count} tools`;
}

/** The short model name the canvas shows: the last `/` segment. */
function modelLabel(
  w: Pick<WorkflowDetail, 'agents'>,
  step: WorkflowDetailStep,
): string {
  const key = step.agent?.key;
  const model = key ? w.agents.find((a) => a.key === key)?.model : null;
  if (!model) return 'No model set';
  return model.split('/').pop() || model;
}

/** The agent line inside an agent node: its name, and its step limit when above one. */
function agentLine(step: WorkflowDetailStep): string | null {
  const agent = step.agent;
  if (!agent) return null;
  return agent.maxSteps > 1
    ? `${agent.name} · ≤ ${agent.maxSteps} steps`
    : agent.name;
}

/** How many lines an exit note takes at `width`. */
function exitLines(text: string, width: number): number {
  return Math.max(1, Math.ceil((text.length * EXIT_CHAR + EXIT_EXTRA) / width));
}

function exitBoxWidth(exit: CanvasExit): number {
  return Math.min(exit.width, exit.text.length * EXIT_CHAR + EXIT_EXTRA);
}

function fieldsLabelWidth(label: string): number {
  return label ? label.length * FIELDS_CHAR + FIELDS_PAD : 0;
}

function branchLabelHeight(lines: string[]): number {
  return lines.length * BRANCH_LINE + BRANCH_BORDER;
}

function branchLabelWidth(lines: string[]): number {
  return Math.max(0, ...lines.map((l) => l.length * LABEL_CHAR)) + LABEL_PAD;
}

/** A main-path branch label: one line, or two near-even lines when it is wide. */
function wrapLabel(label: string): string[] {
  if (branchLabelWidth([label]) <= BRANCH_WRAP || !label.includes(' ')) {
    return [label];
  }
  let best: string[] = [label];
  let widest = Infinity;
  for (let i = label.indexOf(' '); i !== -1; i = label.indexOf(' ', i + 1)) {
    const lines = [label.slice(0, i), label.slice(i + 1)];
    const w = Math.max(...lines.map((l) => l.length));
    if (w < widest) {
      widest = w;
      best = lines;
    }
  }
  return best;
}

/** The sub-nodes under an agent at `x` whose bottom edge is `bottom`: each under its port. */
function subNodesOf(
  w: Pick<WorkflowDetail, 'agents'>,
  step: WorkflowDetailStep,
  x: number,
  bottom: number,
): CanvasSubNode[] {
  const agent = step.agent;
  if (step.kind !== 'agent' || !agent) return [];
  const top = bottom + CANVAS.subTop;
  const at = (port: keyof typeof PORT_AT) =>
    x + CANVAS.agentWidth * PORT_AT[port] - CANVAS.subSize / 2;
  const subs: CanvasSubNode[] = [
    {
      id: `${step.id}-model`,
      kind: 'model',
      label: modelLabel(w, step),
      subtitle: 'model',
      tools: [],
      x: at('model'),
      y: top,
      size: CANVAS.subSize,
    },
  ];
  if (agent.tools.length) {
    subs.push({
      id: `${step.id}-tools`,
      kind: 'tools',
      label: 'Tools',
      subtitle: toolsLabel(agent.tools.length),
      tools: [...agent.tools],
      x: at('tool'),
      y: top,
      size: CANVAS.subSize,
    });
  }
  return subs;
}

/** Vertical S-curve from a port down to the top of a sub-node. */
function subPath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

/** The left and right edges of a sub-node's label box. */
export function subLabelWidth(sub: Pick<CanvasSubNode, 'kind'>): number {
  return sub.kind === 'tools' ? CANVAS.toolsLabelWidth : CANVAS.subLabelWidth;
}

function subLabelSpan(sub: CanvasSubNode): [number, number] {
  const cx = sub.x + sub.size / 2;
  const half = subLabelWidth(sub) / 2;
  return [cx - half, cx + half];
}

/** The canvas layout of a workflow. A pure function. */
export function workflowCanvasLayout(
  w: Pick<WorkflowDetail, 'input' | 'steps' | 'agents'> &
    Partial<Pick<WorkflowDetail, 'edges'>>,
): CanvasLayout {
  const graph = workflowEdges(w);
  const path = mainPath(graph);
  const onPath = new Set(path);
  const stepsById = new Map(w.steps.map((step) => [step.id, step]));
  const numbers = new Map(w.steps.map((step, i) => [step.id, i + 1]));
  const mainSteps = path.flatMap((id) => {
    const step = stepsById.get(id);
    return step ? [step] : [];
  });
  const sideSteps = w.steps.filter((step) => !onPath.has(step.id));
  const graphEdge = (from: string, to: string) =>
    graph.find((e) => e.from === from && e.to === to && e.kind !== 'loop');
  const hasLoop = graph.some(
    (e) => e.kind === 'loop' && onPath.has(e.from) && onPath.has(e.to),
  );

  // Room above the main row for the agent steps' exit notes, and the loop.
  const exitRoom = Math.max(
    0,
    ...w.steps
      .filter((s) => s.kind === 'agent' && s.exits.length)
      .map((s) => exitStackHeight(s) + EXIT_GAP),
  );
  const half = mainSteps.some((s) => s.kind === 'agent')
    ? CANVAS.nodeHeight / 2
    : CANVAS.square / 2;
  const centerY =
    CANVAS.padding + Math.max(exitRoom, hasLoop ? LOOP_ROOM : 0) + half;

  const nodes: CanvasNode[] = [];
  /** The next column's x; a labelled edge into it widens the gap to fit. */
  const nextX = (id: string): number => {
    const prev = nodes.at(-1);
    if (!prev) return CANVAS.padding;
    const edge = graphEdge(prev.id, id);
    const fields = prev.step
      ? prev.step.output.length
      : (stepsById.get(id)?.input.length ?? 0);
    return (
      prev.x +
      prev.width +
      columnGap(fieldsLabel(fields), edge?.label ? wrapLabel(edge.label) : [])
    );
  };

  nodes.push(
    squareNode(
      {
        kind: 'trigger',
        id: START_NODE_ID,
        title: 'Start',
        subtitle: w.input.map((f) => f.name).join(', '),
      },
      CANVAS.padding,
      centerY,
      // The input is checked before the run: an invalid one never starts it.
      w.input.length ? START_EXIT_TEXT : null,
    ),
  );

  for (const step of mainSteps) {
    let x = nextX(step.id);
    if (step.kind === 'agent') {
      // Keep its sub-nodes' labels clear of an earlier agent's, which may
      // run past later columns (a safety guard: one Model and one Tools
      // sub-node fit under their agent).
      const taken = Math.max(
        -Infinity,
        ...nodes.flatMap((n) =>
          n.subNodes.map((s) => subLabelSpan(s)[1] + SUB_LABEL_GAP),
        ),
      );
      const firstLeft =
        x + CANVAS.agentWidth * PORT_AT.model - CANVAS.subLabelWidth / 2;
      if (firstLeft < taken) x += taken - firstLeft;
    }
    nodes.push(stepNode(w, step, numbers.get(step.id) ?? null, x, centerY));
  }

  const last = mainSteps[mainSteps.length - 1];
  nodes.push(
    squareNode(
      {
        kind: 'output',
        id: END_NODE_ID,
        title: 'End',
        subtitle: last ? last.output.join(', ') : '',
      },
      nextX(END_NODE_ID),
      centerY,
      null,
    ),
  );

  // Side steps (a branch off the main path): one row below everything on
  // the main row, each under the gap after its source.
  const mainBottom = rowBottom(nodes);
  const sideTop = mainBottom + CANVAS.sideGap;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let sideX = CANVAS.padding;
  for (const step of sideSteps) {
    const source = graph.find(
      (e) => e.to === step.id && e.kind !== 'loop' && byId.has(e.from),
    );
    const from = source ? byId.get(source.from) : undefined;
    const width = step.kind === 'agent' ? CANVAS.agentWidth : CANVAS.square;
    const height = step.kind === 'agent' ? CANVAS.nodeHeight : CANVAS.square;
    const after = from ? byId.get(path[path.indexOf(from.id) + 1]) : undefined;
    const gapX = from
      ? after
        ? (from.x + from.width + after.x) / 2
        : from.x + from.width + CANVAS.colGap / 2
      : sideX + width / 2;
    const nodeX = Math.max(sideX, gapX - width / 2);
    const node = stepNode(
      w,
      step,
      numbers.get(step.id) ?? null,
      nodeX,
      sideTop + height / 2,
    );
    nodes.push(node);
    byId.set(node.id, node);
    sideX = nodeX + width + CANVAS.colGap;
  }

  const end = byId.get(END_NODE_ID)!;
  const edges = graph.flatMap((g): CanvasEdge[] => {
    const from = byId.get(g.from);
    const to = byId.get(g.to);
    if (!from || !to) return [];
    const main = onPath.has(g.from) && onPath.has(g.to) && g.kind !== 'loop';
    const fields =
      g.kind === 'loop'
        ? []
        : from.step
          ? from.step.output
          : (to.step?.input ?? []);
    const schema = from.step ? from.step.outputSchema : to.step?.inputSchema;
    const typed = contractFields(schema, fields);
    const byName = new Map(typed.map((field) => [field.name, field]));
    const lines = g.label ? (main ? wrapLabel(g.label) : [g.label]) : [];
    const shape = edgeShape(g, from, to, end, lines);
    return [
      {
        id: `${from.id}-${to.id}`,
        from: from.id,
        to: to.id,
        kind: g.kind,
        path: shape.path,
        fields: [...fields],
        passesOn: passesOnText(
          fields.map(
            (name) => byName.get(name) ?? contractFields(null, [name])[0],
          ),
        ),
        label: main ? fieldsLabel(fields.length) : '',
        labelX: shape.labelX,
        labelY: shape.labelY,
        branchLabel: g.label ?? null,
        branchLabelLines: lines,
        branchLabelX: shape.branchLabelX,
        branchLabelY: shape.branchLabelY,
      },
    ];
  });

  const subEdges: CanvasSubEdge[] = [];
  for (const node of nodes) {
    for (const sub of node.subNodes) {
      const port = node.ports.find((p) =>
        sub.kind === 'model' ? p.kind === 'model' : p.kind === 'tool',
      );
      if (!port) continue;
      subEdges.push({
        id: `${sub.id}-edge`,
        nodeId: node.id,
        subNodeId: sub.id,
        path: subPath(port.x, port.y, sub.x + sub.size / 2, sub.y),
      });
    }
  }

  // The padding is around the nodes; a square's label may run into it.
  const boxes = canvasBoxes({ nodes, edges });
  return {
    width: Math.max(
      ...nodes.map((n) => n.x + n.width + CANVAS.padding),
      ...boxes.map((b) => b.x + b.w + EDGE_MARGIN),
    ),
    height: Math.max(...boxes.map((b) => b.y + b.h)) + CANVAS.padding,
    nodes,
    edges,
    subEdges,
  };
}

/** The height of an agent step's exit notes, stacked above it. */
function exitStackHeight(step: WorkflowDetailStep): number {
  return (
    step.exits.reduce(
      (sum, exit) =>
        sum + exitLines(exitText(exit), CANVAS.exitWidth),
      0,
    ) * CANVAS.exitRowHeight
  );
}

function exitText(exit: WorkflowDetailStep['exits'][number]): string {
  return `${exit.label} → ${EXIT_TEXT[exit.outcome]}`;
}

/** Start or End: a square on the centre line, its label (and Start's exit note) under it. */
function squareNode(
  base: Pick<CanvasNode, 'kind' | 'id' | 'title' | 'subtitle'>,
  x: number,
  centerY: number,
  exitNote: string | null,
): CanvasNode {
  const y = centerY - CANVAS.square / 2;
  // As wide as two columns' labels.
  const width = 2 * CANVAS.labelWidth;
  return {
    ...base,
    x,
    y,
    width: CANVAS.square,
    height: CANVAS.square,
    centerY,
    number: null,
    agentLine: null,
    step: null,
    // Start is the first column: its note starts at its left edge.
    exits: exitNote
      ? [
          {
            text: exitNote,
            outcome: 'fails',
            x,
            y: y + CANVAS.square + CANVAS.labelHeight,
            align: 'start',
            width,
            lines: exitLines(exitNote, width),
          },
        ]
      : [],
    ports: [],
    subNodes: [],
  };
}

/** A step's node at column `x`, centred on `centerY`. */
function stepNode(
  w: Pick<WorkflowDetail, 'agents'>,
  step: WorkflowDetailStep,
  number: number | null,
  x: number,
  centerY: number,
): CanvasNode {
  const isAgent = step.kind === 'agent';
  const width = isAgent ? CANVAS.agentWidth : CANVAS.square;
  const height = isAgent ? CANVAS.nodeHeight : CANVAS.square;
  const top = centerY - height / 2;
  const bottom = top + height;
  const centreX = x + width / 2;
  const exits: CanvasExit[] = [];
  if (isAgent) {
    // Stacked upwards from just above the node, the first exit on top.
    let below = 0;
    for (const exit of [...step.exits].reverse()) {
      const text = exitText(exit);
      const lines = exitLines(text, CANVAS.exitWidth);
      below += lines;
      exits.unshift({
        text,
        outcome: exit.outcome,
        x: centreX,
        y: top - EXIT_GAP - below * CANVAS.exitRowHeight,
        align: 'center',
        width: CANVAS.exitWidth,
        lines,
      });
    }
  } else {
    let above = 0;
    for (const exit of step.exits) {
      const text = exitText(exit);
      const lines = exitLines(text, CANVAS.labelWidth);
      exits.push({
        text,
        outcome: exit.outcome,
        x: centreX,
        y: bottom + CANVAS.labelHeight + above * CANVAS.exitRowHeight,
        align: 'center',
        width: CANVAS.labelWidth,
        lines,
      });
      above += lines;
    }
  }
  const ports: CanvasPort[] =
    isAgent && step.agent
      ? [
          {
            kind: 'model',
            label: 'Model',
            x: x + width * PORT_AT.model,
            y: bottom,
          },
          {
            kind: 'tool',
            label: 'Tools',
            x: x + width * PORT_AT.tool,
            y: bottom,
          },
        ]
      : [];
  return {
    kind: isAgent ? 'agent' : 'code',
    id: step.id,
    x,
    y: top,
    width,
    height,
    centerY,
    number,
    title: step.title,
    subtitle: step.id,
    agentLine: agentLine(step),
    step,
    exits,
    ports,
    subNodes: subNodesOf(w, step, x, bottom),
  };
}

/** The lowest point of these nodes: a square's label and exits, sub-nodes and their labels. */
function rowBottom(nodes: CanvasNode[]): number {
  return Math.max(
    ...nodes.map((n) =>
      n.kind === 'agent'
        ? n.y + n.height
        : n.y +
          n.height +
          CANVAS.labelHeight +
          n.exits.reduce((sum, e) => sum + e.lines, 0) * CANVAS.exitRowHeight,
    ),
    ...nodes.flatMap((n) =>
      n.subNodes.map((s) => s.y + s.size + CANVAS.subLabelHeight),
    ),
  );
}

/** The gap between two columns: wider when the edge's labels need it. */
function columnGap(fields: string, branch: string[]): number {
  return Math.max(
    CANVAS.colGap,
    fieldsLabelWidth(fields) + FIELDS_MARGIN,
    branch.length ? branchLabelWidth(branch) + FIELDS_MARGIN : 0,
  );
}

/**
 * Every box drawn on the canvas, estimated from the layout: nodes, a
 * square's label, exit notes, port labels, sub-nodes and their labels, and
 * edge labels. The canvas size covers them; none may overlap another.
 */
export function canvasBoxes(
  layout: Pick<CanvasLayout, 'nodes' | 'edges'>,
): CanvasBox[] {
  const boxes: CanvasBox[] = [];
  for (const n of layout.nodes) {
    boxes.push({ owner: n.id, part: 'node', x: n.x, y: n.y, w: n.width, h: n.height });
    if (n.kind !== 'agent') {
      boxes.push({
        owner: n.id,
        part: 'label',
        x: n.x + n.width / 2 - CANVAS.labelWidth / 2,
        y: n.y + n.height + SQUARE_LABEL_TOP,
        w: CANVAS.labelWidth,
        h: CANVAS.labelHeight - SQUARE_LABEL_TOP,
      });
    }
    for (const exit of n.exits) {
      const w = exitBoxWidth(exit);
      boxes.push({
        owner: n.id,
        part: 'exit',
        x: exit.align === 'center' ? exit.x - w / 2 : exit.x,
        y: exit.y,
        w,
        h: exit.lines * CANVAS.exitRowHeight,
      });
    }
    for (const port of n.ports) {
      const w = (port.label.length + (port.kind === 'model' ? 1 : 0)) * PORT_CHAR;
      boxes.push({ owner: n.id, part: 'port-label', x: port.x - w / 2, y: port.y + 10, w, h: 14 });
    }
    for (const sub of n.subNodes) {
      boxes.push({ owner: sub.id, part: 'sub-node', x: sub.x, y: sub.y, w: sub.size, h: sub.size });
      const [left] = subLabelSpan(sub);
      boxes.push({
        owner: sub.id,
        part: 'sub-label',
        x: left,
        y: sub.y + sub.size + SUB_LABEL_TOP,
        w: subLabelWidth(sub),
        h: CANVAS.subLabelHeight - SUB_LABEL_TOP,
      });
    }
  }
  for (const e of layout.edges) {
    if (e.label) {
      const w = fieldsLabelWidth(e.label);
      boxes.push({ owner: e.id, part: 'edge-label', x: e.labelX - w / 2, y: e.labelY - 8, w, h: 16 });
    }
    if (e.branchLabelLines.length) {
      const w = branchLabelWidth(e.branchLabelLines);
      const h = branchLabelHeight(e.branchLabelLines);
      boxes.push({
        owner: e.id,
        part: 'branch-label',
        x: e.branchLabelX - w / 2,
        y: e.branchLabelY - h / 2,
        w,
        h,
      });
    }
  }
  return boxes;
}

interface EdgeShape {
  path: string;
  labelX: number;
  labelY: number;
  branchLabelX: number;
  branchLabelY: number;
}

/**
 * How an edge runs: straight along the centre line between two main
 * columns; down from the source's right handle to a side node below; from
 * a side node along its row and up into End; for a loop, a curve above
 * the row from the later node's top back into the earlier node's right
 * side; or, for a side node's loop back to its source, straight up beside
 * the drop into the source's right side.
 */
function edgeShape(
  g: WorkflowEdge,
  from: CanvasNode,
  to: CanvasNode,
  end: CanvasNode,
  lines: string[],
): EdgeShape {
  const x1 = from.x + from.width;
  const labelW = lines.length ? branchLabelWidth(lines) : 0;
  const labelH = lines.length ? branchLabelHeight(lines) : 0;
  if (g.kind === 'loop' && from.centerY > to.centerY) {
    // Back up from a side node: beside the drop that came down to it.
    const ux = from.x + from.width / 2 - RETURN_X;
    const yIn = to.y + to.height - RETURN_ENTRY_Y;
    const xIn = to.x + to.width;
    const r = Math.min(CORNER, Math.max(0, ux - xIn));
    return {
      path: `M ${ux} ${from.y} L ${ux} ${yIn + r} Q ${ux} ${yIn} ${ux - r} ${yIn} L ${xIn} ${yIn}`,
      labelX: ux,
      labelY: (from.y + yIn) / 2,
      // Left of the line, in the gap above the side row.
      branchLabelX: ux - SIDE_LABEL_OFFSET - labelW / 2,
      branchLabelY: from.y - CANVAS.sideGap / 2,
    };
  }
  if (g.kind === 'loop') {
    const vx = from.x + from.width / 2;
    const ar = to.x + to.width;
    const ax = ar + LOOP_ENTRY_X;
    const apex = from.y - LOOP_RISE;
    const entry = to.y + LOOP_ENTRY_Y;
    return {
      path: `M ${vx} ${from.y} C ${vx} ${apex}, ${ax} ${apex}, ${ax} ${entry} L ${ar} ${entry}`,
      labelX: (vx + ax) / 2,
      labelY: apex,
      branchLabelX: (vx + ax) / 2,
      // The curve peaks at three quarters of the rise; the label sits on it.
      branchLabelY: from.y - (LOOP_RISE * 3) / 4 - EDGE_LABEL_RISE,
    };
  }
  if (to.centerY > from.centerY) {
    // Down to a side node: along the centre line, then down the gap.
    const gx = to.x + to.width / 2;
    const r = Math.min(CORNER, Math.max(0, gx - x1));
    return {
      path: `M ${x1} ${from.centerY} L ${gx - r} ${from.centerY} Q ${gx} ${from.centerY} ${gx} ${from.centerY + r} L ${gx} ${to.y}`,
      labelX: gx,
      labelY: (from.centerY + to.y) / 2,
      // Right of the drop, in the gap above the side row.
      branchLabelX: gx + SIDE_LABEL_OFFSET + labelW / 2,
      branchLabelY: to.y - CANVAS.sideGap / 2,
    };
  }
  if (from.centerY > to.centerY && to.id === end.id) {
    // From a side node along its row, then up into End's left side.
    const gx = end.x - CANVAS.colGap / 2;
    const yIn = end.centerY + END_ENTRY_Y;
    return {
      path: `M ${x1} ${from.centerY} L ${gx - CORNER} ${from.centerY} Q ${gx} ${from.centerY} ${gx} ${from.centerY - CORNER} L ${gx} ${yIn + CORNER} Q ${gx} ${yIn} ${gx + CORNER} ${yIn} L ${end.x} ${yIn}`,
      labelX: (x1 + gx) / 2,
      labelY: from.centerY - EDGE_LABEL_RISE,
      branchLabelX: (x1 + gx) / 2,
      branchLabelY: from.centerY + BRANCH_LABEL_DROP + labelH / 2,
    };
  }
  const x2 = to.x;
  return {
    path: `M ${x1} ${from.centerY} L ${x2} ${to.centerY}`,
    labelX: (x1 + x2) / 2,
    labelY: from.centerY - EDGE_LABEL_RISE,
    branchLabelX: (x1 + x2) / 2,
    branchLabelY: from.centerY + BRANCH_LABEL_DROP + labelH / 2,
  };
}

/**
 * Fit to screen: the largest zoom, in steps of 5%, at which the whole canvas
 * shows in the viewport; never above 100% and never below MIN_ZOOM (the
 * canvas scrolls and pans below that).
 */
export function fitZoom(
  layout: Pick<CanvasLayout, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const ratio = Math.min(
    viewportWidth / layout.width,
    viewportHeight / layout.height,
  );
  const fives = Math.floor(ratio * 20 + 1e-6) / 20;
  return Math.min(1, Math.max(MIN_ZOOM, fives));
}

/** The next zoom level above `zoom`, or MAX_ZOOM. */
export function zoomIn(zoom: number): number {
  return ZOOM_LEVELS.find((level) => level > zoom + 1e-6) ?? MAX_ZOOM;
}

/** The next zoom level below `zoom`, or MIN_ZOOM. */
export function zoomOut(zoom: number): number {
  return (
    [...ZOOM_LEVELS].reverse().find((level) => level < zoom - 1e-6) ?? MIN_ZOOM
  );
}
