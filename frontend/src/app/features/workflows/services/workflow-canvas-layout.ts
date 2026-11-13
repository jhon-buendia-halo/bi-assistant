import {
  END_NODE_ID,
  START_NODE_ID,
  WorkflowNodeKind,
  toolNodeId,
} from '../models/workflow-node.model';
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
 * lines to round sub-nodes below it. Everything here is a pure function of the
 * workflow, in canvas pixels at 100%.
 */
export const CANVAS = {
  /** Around the whole graph. */
  padding: 40,
  /** Start, a code step and End are squares of this side. */
  square: 88,
  agentWidth: 220,
  /** Every main node's height, so they share one centre line. */
  nodeHeight: 88,
  /** Between two columns, where the edge and its label run. */
  colGap: 80,
  /** The title and subtitle under a square node. */
  labelHeight: 52,
  exitRowHeight: 16,
  /** A sub-node's diameter. */
  subSize: 56,
  /** Centre to centre of two sub-nodes: room for their labels. */
  subSpacing: 120,
  /** From the agent's bottom edge to the top of its sub-nodes. */
  subTop: 96,
  /** The label and subtitle under a sub-node. */
  subLabelHeight: 40,
  /** More tools than this collapse into one `+<n> tools` sub-node. */
  maxToolSubNodes: 4,
} as const;

/** The zoom levels zoom in / out step through; fit may land between them. */
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5] as const;
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 1.5;

/** Between an agent's exit notes and its top edge (room for the status badge). */
const EXIT_GAP = 12;
/** An edge label sits this far above the centre line. */
const EDGE_LABEL_RISE = 12;
/** How high the loop's curve rises above the row, and the room kept above it. */
const LOOP_RISE = 36;
const LOOP_ROOM = 56;
/** Where the loop comes back in: right of the node, below its status badge. */
const LOOP_ENTRY_X = 18;
const LOOP_ENTRY_Y = 18;
/** Between the main row's lowest point and the side row. */
const SIDE_GAP = 24;
/** The radius of an edge's rounded corner. */
const CORNER = 8;
/** A side node's edge to End rises this far left of End and enters it this far below its centre. */
const END_RISE_X = 24;
const END_ENTRY_Y = 20;
/** A branch label down to a side node: this far below the source's bottom edge. */
const BRANCH_LABEL_DROP = 50;
/** An edge label's width, estimated: per character at 11 px, plus padding each side. */
const LABEL_CHAR = 6;
const LABEL_PAD = 12;
/** The ports' places along the agent's bottom edge, as a fraction of its width. */
const PORT_AT = { model: 0.25, tool: 0.75 } as const;

/** A tool is a sub-node on the canvas, never a node of its own. */
export type CanvasNodeKind = Exclude<WorkflowNodeKind, 'tool'>;

export interface CanvasPort {
  kind: 'model' | 'tool';
  label: 'Model' | 'Tools';
  /** The diamond's centre, on the agent's bottom edge. */
  x: number;
  y: number;
}

export interface CanvasSubNode {
  /** `<stepId>-model` | `<stepId>-tool-<name>` | `<stepId>-more`. */
  id: string;
  kind: 'model' | 'tool' | 'more';
  /** The model's last `/` segment or `No model set`; the tool's name; `+<n> tools`. */
  label: string;
  subtitle: 'model' | 'tool' | '';
  /** Top-left of the circle. */
  x: number;
  y: number;
  size: number;
}

export interface CanvasExit {
  text: string;
  outcome: 'fails' | 'stops';
  /** The note's horizontal centre (the node's) and its top, in canvas pixels. */
  x: number;
  y: number;
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
  /** `<agent name> · ≤ <n> steps` for an agent step; else null. */
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
  /** The graph edge's own label (`Needs clarification`, `Retry once`); null when it has none. */
  branchLabel: string | null;
  /** That label's centre: below the line, on the drop to a side node, or on the loop's curve. */
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

const EXIT_TEXT = { fails: 'fails', stops: 'ends here' } as const;
/** Start's exit note (ui.md 4.4b): the input is checked before anything runs. */
const START_EXIT_TEXT = 'Invalid input → not started';

/** `1 field` / `<n> fields`, or '' for none. */
export function fieldsLabel(count: number): string {
  if (count === 0) return '';
  return count === 1 ? '1 field' : `${count} fields`;
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

function subNodesOf(
  w: Pick<WorkflowDetail, 'agents'>,
  step: WorkflowDetailStep,
  x: number,
  y: number,
): CanvasSubNode[] {
  const agent = step.agent;
  if (step.kind !== 'agent' || !agent) return [];
  const specs: Omit<CanvasSubNode, 'x' | 'y' | 'size'>[] = [
    {
      id: `${step.id}-model`,
      kind: 'model',
      label: modelLabel(w, step),
      subtitle: 'model',
    },
  ];
  const shown = agent.tools.slice(0, CANVAS.maxToolSubNodes);
  for (const tool of shown) {
    specs.push({
      id: toolNodeId(step.id, tool),
      kind: 'tool',
      label: tool,
      subtitle: 'tool',
    });
  }
  const more = agent.tools.length - shown.length;
  if (more > 0) {
    specs.push({
      id: `${step.id}-more`,
      kind: 'more',
      label: `+${more} tools`,
      subtitle: '',
    });
  }
  // One slot of subSpacing each, starting at the agent's left edge, so the
  // model sits under the Model port and the tools run right from Tools.
  const top = y + CANVAS.nodeHeight + CANVAS.subTop;
  return specs.map((spec, i) => ({
    ...spec,
    x: x + CANVAS.subSpacing / 2 + i * CANVAS.subSpacing - CANVAS.subSize / 2,
    y: top,
    size: CANVAS.subSize,
  }));
}

/** Vertical S-curve from a port down to the top of a sub-node. */
function subPath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
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
  const agentExits = Math.max(
    0,
    ...w.steps.filter((s) => s.kind === 'agent').map((s) => s.exits.length),
  );
  const exitRoom =
    agentExits > 0 ? agentExits * CANVAS.exitRowHeight + EXIT_GAP : 0;
  const top = CANVAS.padding + Math.max(exitRoom, hasLoop ? LOOP_ROOM : 0);
  const centerY = top + CANVAS.nodeHeight / 2;

  const nodes: CanvasNode[] = [];
  /** The next column's x; a labelled edge into it widens the gap to fit. */
  const nextX = (id: string): number => {
    const prev = nodes.at(-1);
    if (!prev) return CANVAS.padding;
    return prev.x + prev.width + columnGap(graphEdge(prev.id, id)?.label);
  };
  const place = (
    node: Omit<CanvasNode, 'x' | 'y' | 'height' | 'centerY'>,
    x: number,
  ): void => {
    nodes.push({ ...node, x, y: top, height: CANVAS.nodeHeight, centerY });
  };

  place(
    {
      kind: 'trigger',
      id: START_NODE_ID,
      width: CANVAS.square,
      number: null,
      title: 'Start',
      subtitle: w.input.map((f) => f.name).join(', '),
      agentLine: null,
      step: null,
      // The input is checked before the run: an invalid one never starts it.
      exits: w.input.length
        ? [
            {
              text: START_EXIT_TEXT,
              outcome: 'fails',
              x: CANVAS.padding + CANVAS.square / 2,
              y: top + CANVAS.nodeHeight + CANVAS.labelHeight,
            },
          ]
        : [],
      ports: [],
      subNodes: [],
    },
    CANVAS.padding,
  );

  for (const step of mainSteps) {
    const x = nextX(step.id);
    place(stepNode(w, step, numbers.get(step.id) ?? null, x, top), x);
  }

  const last = mainSteps[mainSteps.length - 1];
  place(
    {
      kind: 'output',
      id: END_NODE_ID,
      width: CANVAS.square,
      number: null,
      title: 'End',
      subtitle: last ? last.output.join(', ') : '',
      agentLine: null,
      step: null,
      exits: [],
      ports: [],
      subNodes: [],
    },
    nextX(END_NODE_ID),
  );

  // Side steps (a branch that ends the run): one row below everything on
  // the main row, each under the gap after its source.
  const mainBottom = rowBottom(nodes, top);
  const sideTop = mainBottom + SIDE_GAP;
  const sideCenterY = sideTop + CANVAS.nodeHeight / 2;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let sideX = CANVAS.padding;
  for (const step of sideSteps) {
    const source = graph.find(
      (e) => e.to === step.id && e.kind !== 'loop' && byId.has(e.from),
    );
    const from = source ? byId.get(source.from) : undefined;
    const width = step.kind === 'agent' ? CANVAS.agentWidth : CANVAS.square;
    const after = from ? byId.get(path[path.indexOf(from.id) + 1]) : undefined;
    const gapX = from
      ? after
        ? (from.x + from.width + after.x) / 2
        : from.x + from.width + CANVAS.colGap / 2
      : sideX + width / 2;
    const nodeX = Math.max(sideX, gapX - width / 2);
    const node: CanvasNode = {
      ...stepNode(w, step, numbers.get(step.id) ?? null, nodeX, sideTop),
      x: nodeX,
      y: sideTop,
      height: CANVAS.nodeHeight,
      centerY: sideCenterY,
    };
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
    const shape = edgeShape(g, from, to, end);
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

  const right = Math.max(
    ...nodes.map((n) => n.x + n.width),
    ...nodes.flatMap((n) =>
      n.subNodes.map((s) => s.x + s.size / 2 + CANVAS.subSpacing / 2),
    ),
  );
  const sideNodes = nodes.filter((n) => n.y !== top);
  const bottom = Math.max(
    mainBottom,
    ...sideNodes.map((n) => rowBottom([n], n.y)),
  );

  return {
    width: right + CANVAS.padding,
    height: bottom + CANVAS.padding,
    nodes,
    edges,
    subEdges,
  };
}

/** A step's node at column `x` on the row whose top is `top`. */
function stepNode(
  w: Pick<WorkflowDetail, 'agents'>,
  step: WorkflowDetailStep,
  number: number | null,
  x: number,
  top: number,
): Omit<CanvasNode, 'x' | 'y' | 'height' | 'centerY'> {
  const isAgent = step.kind === 'agent';
  const width = isAgent ? CANVAS.agentWidth : CANVAS.square;
  const centreX = x + width / 2;
  const exits = step.exits.map((exit, row): CanvasExit => ({
    text: `${exit.label} → ${EXIT_TEXT[exit.outcome]}`,
    outcome: exit.outcome,
    x: centreX,
    y: isAgent
      ? top - EXIT_GAP - (step.exits.length - row) * CANVAS.exitRowHeight
      : top +
        CANVAS.nodeHeight +
        CANVAS.labelHeight +
        row * CANVAS.exitRowHeight,
  }));
  const ports: CanvasPort[] =
    isAgent && step.agent
      ? [
          {
            kind: 'model',
            label: 'Model',
            x: x + width * PORT_AT.model,
            y: top + CANVAS.nodeHeight,
          },
          {
            kind: 'tool',
            label: 'Tools',
            x: x + width * PORT_AT.tool,
            y: top + CANVAS.nodeHeight,
          },
        ]
      : [];
  return {
    kind: isAgent ? 'agent' : 'code',
    id: step.id,
    width,
    number,
    title: step.title,
    subtitle: step.id,
    agentLine: step.agent
      ? `${step.agent.name} · ≤ ${step.agent.maxSteps} steps`
      : null,
    step,
    exits,
    ports,
    subNodes: subNodesOf(w, step, x, top),
  };
}

/** The lowest point of these nodes: a square's label and exits, sub-nodes and their labels. */
function rowBottom(nodes: CanvasNode[], top: number): number {
  return Math.max(
    ...nodes.map((n) =>
      n.kind === 'agent'
        ? top + CANVAS.nodeHeight
        : top +
          CANVAS.nodeHeight +
          CANVAS.labelHeight +
          n.exits.length * CANVAS.exitRowHeight,
    ),
    ...nodes.flatMap((n) =>
      n.subNodes.map((s) => s.y + s.size + CANVAS.subLabelHeight),
    ),
  );
}

/** The gap between two columns: wider when the edge between them has a label. */
function columnGap(label: string | undefined): number {
  if (!label) return CANVAS.colGap;
  return Math.max(CANVAS.colGap, label.length * LABEL_CHAR + 2 * LABEL_PAD);
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
 * a side node along its row and up into End; or, for a loop, a curve above
 * the row from the later node's top back into the earlier node's right side.
 */
function edgeShape(
  g: WorkflowEdge,
  from: CanvasNode,
  to: CanvasNode,
  end: CanvasNode,
): EdgeShape {
  const x1 = from.x + from.width;
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
      branchLabelX: gx,
      branchLabelY: from.y + CANVAS.nodeHeight + BRANCH_LABEL_DROP,
    };
  }
  if (from.centerY > to.centerY && to.id === end.id) {
    // From a side node along its row, then up into End's left side.
    const gx = end.x - END_RISE_X;
    const yIn = end.centerY + END_ENTRY_Y;
    return {
      path: `M ${x1} ${from.centerY} L ${gx - CORNER} ${from.centerY} Q ${gx} ${from.centerY} ${gx} ${from.centerY - CORNER} L ${gx} ${yIn + CORNER} Q ${gx} ${yIn} ${gx + CORNER} ${yIn} L ${end.x} ${yIn}`,
      labelX: (x1 + gx) / 2,
      labelY: from.centerY - EDGE_LABEL_RISE,
      branchLabelX: (x1 + gx) / 2,
      branchLabelY: from.centerY + EDGE_LABEL_RISE,
    };
  }
  const x2 = to.x;
  return {
    path: `M ${x1} ${from.centerY} L ${x2} ${to.centerY}`,
    labelX: (x1 + x2) / 2,
    labelY: from.centerY - EDGE_LABEL_RISE,
    branchLabelX: (x1 + x2) / 2,
    branchLabelY: from.centerY + EDGE_LABEL_RISE,
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
