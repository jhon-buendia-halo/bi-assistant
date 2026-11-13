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
 * lines to round sub-nodes below it: its model and one Tools sub-node. Roomy
 * rather than packed: readability wins over fitting, so a wide workflow may
 * need a little panning at the minimum zoom. Everything here is a pure
 * function of the workflow, in canvas pixels at 100%.
 */
export const CANVAS = {
  /** Around the whole graph. */
  padding: 40,
  /** Start, a code step and End are squares of this side. */
  square: 88,
  agentWidth: 220,
  /** An agent step's height; squares share its centre line. */
  nodeHeight: 88,
  /** Between two columns, where the edge and its labels run (wider for a wider label). */
  colGap: 80,
  /** The title and subtitle under a square node: their width (their height follows the text). */
  labelWidth: 150,
  exitRowHeight: 16,
  /** An agent's exit note wraps past this width (the agent's own). */
  exitWidth: 220,
  /** A sub-node's diameter. */
  subSize: 52,
  /** From the agent's bottom edge to the top of its sub-nodes. */
  subTop: 56,
  /** The label and subtitle under a sub-node: their box (the Model's; the Tools' is narrower). */
  subLabelWidth: 120,
  toolsLabelWidth: 80,
  subLabelHeight: 52,
  /** Between the main row's lowest point and the side row, where the side edges' labels sit. */
  sideGap: 40,
} as const;

/** The zoom levels zoom in / out step through; fit may land between them. */
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5] as const;
export const MIN_ZOOM = 0.4;
/** Fit prefers at least this zoom, for readable nodes, as long as the canvas's height shows. */
export const FIT_MIN_ZOOM = 0.7;
export const MAX_ZOOM = 1.5;

/** Between an agent's exit notes and its top edge (room for the status badge). */
const EXIT_GAP = 12;
/** Between a square's label and the exit notes under it. */
const EXIT_LABEL_GAP = 4;
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
/**
 * A side edge's label: this far beside its vertical line. A main-path label
 * in a gap a side edge drops from sits this far right of the drop too.
 */
const SIDE_LABEL_OFFSET = 6;
/** A branch label (11 px medium) per character, and its padding and border. */
const LABEL_CHAR = 5.5;
const LABEL_PAD = 14;
/** A field count label (11 px mono) per character, and its padding. */
const FIELDS_CHAR = 6.6;
const FIELDS_PAD = 8;
/** The room an edge label keeps from the nodes (and their handles) each side. */
const LABEL_MARGIN = 16;
/** A port's label (11 px) per character. */
const PORT_CHAR = 5.5;
/** A square's label starts this far under it; a sub-node's this far. */
const SQUARE_LABEL_TOP = 8;
const SUB_LABEL_TOP = 6;
/** A square's title (13 px medium, at most 2 lines) and subtitle (11 px, at most 3): per character and line height. */
const TITLE_CHAR = 7.2;
const TITLE_LINE = 18;
const SUBTITLE_CHAR = 6;
const SUBTITLE_MONO_CHAR = 6.6;
const SUBTITLE_LINE = 14;
/** Between a square's title and subtitle (`gap-px`). */
const LABEL_ROW_GAP = 1;
/** Between two agents' sub-node labels. */
const SUB_LABEL_GAP = 4;
/** The ports' places along the agent's bottom edge, as a fraction of its width. */
const PORT_AT = { model: 0.25, tool: 0.75 } as const;

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
  outcome: 'fails' | 'stops' | 'waits';
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
  /** A square's label under it (title and subtitle), estimated from their text: its height; 0 for an agent. */
  labelHeight: number;
  /** An agent step's agent, drawn under the action (ui.md 4.4b); else null. */
  agent: CanvasNodeAgent | null;
  step: WorkflowDetailStep | null;
  exits: CanvasExit[];
  ports: CanvasPort[];
  subNodes: CanvasSubNode[];
}

/** The agent an agent node names: its persona's name and job title ('' when none). */
export interface CanvasNodeAgent {
  name: string;
  role: string;
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
  /** That label as drawn: one line (its gap widens to fit it); empty without one. */
  branchLabelLines: string[];
  /**
   * That label's centre: below the line (right of the drop when a side edge
   * drops from the same gap), beside the drop to a side node, or on the
   * loop's curve.
   */
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

const EXIT_TEXT = {
  fails: 'fails',
  stops: 'ends here',
  waits: 'waits for you',
} as const;
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

/** The agent inside an agent node: its persona's name and job title. */
function nodeAgent(step: WorkflowDetailStep): CanvasNodeAgent | null {
  const agent = step.agent;
  if (!agent) return null;
  return { name: agent.name, role: agent.role ?? '' };
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

/** How many lines `text` wraps onto at `width`, word by word (a long word breaks anywhere). */
function textLines(text: string, charWidth: number, width: number): number {
  if (!text) return 0;
  const perLine = Math.max(1, Math.floor(width / charWidth));
  let lines = 1;
  let used = 0;
  for (const word of text.split(' ')) {
    const need = used ? used + 1 + word.length : word.length;
    if (need <= perLine) {
      used = need;
    } else if (used) {
      lines += Math.ceil(word.length / perLine);
      used = word.length % perLine || perLine;
    } else {
      lines += Math.ceil(word.length / perLine) - 1;
      used = word.length % perLine || perLine;
    }
  }
  return lines;
}

/** The height of a square's label (title, then subtitle), from its top edge under the square. */
function squareLabelHeight(
  title: string,
  subtitle: string,
  mono: boolean,
): number {
  const titleLines = Math.min(2, Math.max(1, textLines(title, TITLE_CHAR, CANVAS.labelWidth)));
  const subLines = Math.min(
    3,
    textLines(subtitle, mono ? SUBTITLE_MONO_CHAR : SUBTITLE_CHAR, CANVAS.labelWidth),
  );
  return (
    SQUARE_LABEL_TOP +
    titleLines * TITLE_LINE +
    (subLines ? LABEL_ROW_GAP + subLines * SUBTITLE_LINE : 0)
  );
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
  // The main nodes a side step hangs from: a side edge drops down the gap after each.
  const sideIds = new Set(sideSteps.map((s) => s.id));
  const dropsFrom = new Set(
    graph
      .filter((e) => e.kind !== 'loop' && sideIds.has(e.to) && onPath.has(e.from))
      .map((e) => e.from),
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
      columnGap(
        fieldsLabel(fields),
        edge?.label ? [edge.label] : [],
        dropsFrom.has(prev.id),
      )
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

  // Start's exit note runs right, under the next column's label: when that
  // label (or its exit notes) reaches lower, the note goes below them.
  const [start, next] = nodes;
  if (start.exits.length && next && next.kind !== 'agent') {
    const exit = start.exits[0];
    const nextLeft = next.x + next.width / 2 - CANVAS.labelWidth / 2;
    if (exit.x + exitBoxWidth(exit) > nextLeft) {
      const below = Math.max(
        exit.y,
        next.y + next.height + next.labelHeight + EXIT_LABEL_GAP,
        ...next.exits.map((e) => e.y + e.lines * CANVAS.exitRowHeight + EXIT_LABEL_GAP),
      );
      start.exits = [{ ...exit, y: below }];
    }
  }

  // Side steps (a branch off the main path): one row below everything on
  // the main row, each under the gap after its source.
  const mainBottom = rowBottom(nodes);
  const sideTop = mainBottom + CANVAS.sideGap;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let sideX = CANVAS.padding;
  /** Where a side edge drops from a main node's gap: the x of its line. */
  const dropAt = new Map<string, number>();
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
    if (from && !dropAt.has(from.id)) dropAt.set(from.id, nodeX + width / 2);
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
    const lines = g.label ? [g.label] : [];
    const shape = edgeShape(g, from, to, end, lines, main ? dropAt.get(from.id) : undefined);
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
  const labelHeight = squareLabelHeight(base.title, base.subtitle, false);
  return {
    ...base,
    x,
    y,
    width: CANVAS.square,
    height: CANVAS.square,
    centerY,
    number: null,
    labelHeight,
    agent: null,
    step: null,
    // Start is the first column: its note starts at its left edge, right under its label.
    exits: exitNote
      ? [
          {
            text: exitNote,
            outcome: 'fails',
            x,
            y: y + CANVAS.square + labelHeight + EXIT_LABEL_GAP,
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
  const labelHeight = isAgent ? 0 : squareLabelHeight(step.title, step.id, true);
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
    // Right under its own label, one after another.
    let above = 0;
    for (const exit of step.exits) {
      const text = exitText(exit);
      const lines = exitLines(text, CANVAS.labelWidth);
      exits.push({
        text,
        outcome: exit.outcome,
        x: centreX,
        y: bottom + labelHeight + EXIT_LABEL_GAP + above * CANVAS.exitRowHeight,
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
    labelHeight,
    agent: nodeAgent(step),
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
      Math.max(
        n.y + n.height + n.labelHeight,
        ...n.exits.map((e) => e.y + e.lines * CANVAS.exitRowHeight),
      ),
    ),
    ...nodes.flatMap((n) =>
      n.subNodes.map((s) => s.y + s.size + CANVAS.subLabelHeight),
    ),
  );
}

/**
 * The gap between two columns: wider when the edge's labels need it. When a
 * side edge drops down its middle, the branch label sits right of the drop,
 * so the right half holds it.
 */
function columnGap(fields: string, branch: string[], drop: boolean): number {
  const branchW = branch.length ? branchLabelWidth(branch) : 0;
  return Math.ceil(Math.max(
    CANVAS.colGap,
    fields ? fieldsLabelWidth(fields) + 2 * LABEL_MARGIN : 0,
    branchW ? branchW + 2 * LABEL_MARGIN : 0,
    drop && branchW ? 2 * (SIDE_LABEL_OFFSET + branchW + LABEL_MARGIN) : 0,
  ));
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
        h: n.labelHeight - SQUARE_LABEL_TOP,
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
  /** The x of a side edge dropping down the same gap, when one does. */
  dropX?: number,
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
    // Right of a drop down the same gap, never on it.
    branchLabelX:
      dropX === undefined
        ? (x1 + x2) / 2
        : dropX + SIDE_LABEL_OFFSET + labelW / 2,
    branchLabelY: from.centerY + BRANCH_LABEL_DROP + labelH / 2,
  };
}

/**
 * Fit to screen: the largest zoom, in steps of 5%, at which the whole canvas
 * shows in the viewport, never above 100%. Readability wins over showing the
 * whole width: when that zoom is below FIT_MIN_ZOOM, fit takes FIT_MIN_ZOOM
 * (or less, only as far as the canvas's full height needs) and the canvas
 * pans sideways. Never below MIN_ZOOM.
 */
export function fitZoom(
  layout: Pick<CanvasLayout, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const byHeight = viewportHeight / layout.height;
  const whole = Math.min(viewportWidth / layout.width, byHeight);
  const ratio = whole >= FIT_MIN_ZOOM ? whole : Math.min(FIT_MIN_ZOOM, byHeight);
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
