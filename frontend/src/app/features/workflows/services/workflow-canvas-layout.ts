import {
  END_NODE_ID,
  START_NODE_ID,
  WorkflowNodeKind,
} from '../models/workflow-node.model';
import { WorkflowDetail, WorkflowDetailStep } from '../models/workflow.model';

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
/** The ports' places along the agent's bottom edge, as a fraction of its width. */
const PORT_AT = { model: 0.25, tool: 0.75 } as const;

export type CanvasNodeKind = WorkflowNodeKind;

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
  path: string;
  /** What runs along the edge: the source step's output (from Start, the first step's input). */
  fields: string[];
  /** `1 field` | `<n> fields` | `` when nothing is passed. */
  label: string;
  /** The label's centre. */
  labelX: number;
  labelY: number;
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
  /** Start, the steps in run order, End. */
  nodes: CanvasNode[];
  /** One per pair of consecutive nodes, left to right. */
  edges: CanvasEdge[];
  /** One per sub-node, from its port down to it. */
  subEdges: CanvasSubEdge[];
}

const EXIT_TEXT = { fails: 'fails', stops: 'ends here' } as const;

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
      id: `${step.id}-tool-${tool}`,
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
  w: Pick<WorkflowDetail, 'input' | 'steps' | 'agents'>,
): CanvasLayout {
  const steps = w.steps;
  // Room above the main row for the agent steps' exit notes.
  const agentExits = Math.max(
    0,
    ...steps.filter((s) => s.kind === 'agent').map((s) => s.exits.length),
  );
  const top =
    CANVAS.padding +
    (agentExits > 0 ? agentExits * CANVAS.exitRowHeight + EXIT_GAP : 0);
  const centerY = top + CANVAS.nodeHeight / 2;

  const nodes: CanvasNode[] = [];
  let x = CANVAS.padding;
  const place = (
    node: Omit<CanvasNode, 'x' | 'y' | 'height' | 'centerY'>,
  ): void => {
    nodes.push({ ...node, x, y: top, height: CANVAS.nodeHeight, centerY });
    x += node.width + CANVAS.colGap;
  };

  place({
    kind: 'trigger',
    id: START_NODE_ID,
    width: CANVAS.square,
    number: null,
    title: 'Start',
    subtitle: w.input.map((f) => f.name).join(', '),
    agentLine: null,
    step: null,
    exits: [],
    ports: [],
    subNodes: [],
  });

  steps.forEach((step, i) => {
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
    place({
      kind: isAgent ? 'agent' : 'code',
      id: step.id,
      width,
      number: i + 1,
      title: step.title,
      subtitle: step.id,
      agentLine: step.agent
        ? `${step.agent.name} · ≤ ${step.agent.maxSteps} steps`
        : null,
      step,
      exits,
      ports,
      subNodes: subNodesOf(w, step, x, top),
    });
  });

  const last = steps[steps.length - 1];
  place({
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
  });

  const edges = nodes.slice(1).map((to, i): CanvasEdge => {
    const from = nodes[i];
    const fields = from.step ? from.step.output : (to.step?.input ?? []);
    const x1 = from.x + from.width;
    const x2 = to.x;
    return {
      id: `${from.id}-${to.id}`,
      from: from.id,
      to: to.id,
      path: `M ${x1} ${centerY} L ${x2} ${centerY}`,
      fields: [...fields],
      label: fieldsLabel(fields.length),
      labelX: (x1 + x2) / 2,
      labelY: centerY - EDGE_LABEL_RISE,
    };
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
  const bottom = Math.max(
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

  return {
    width: right + CANVAS.padding,
    height: bottom + CANVAS.padding,
    nodes,
    edges,
    subEdges,
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
