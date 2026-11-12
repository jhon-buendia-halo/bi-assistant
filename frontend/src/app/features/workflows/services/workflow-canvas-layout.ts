import { AgentWorkflowStep } from '../../agents/services/agents-api.service';

/**
 * The workflow designer's canvas (ui.md 4.4b): Start, one node per step and
 * End, top to bottom on one centre line, with a connector between each pair.
 * Everything here is a pure function of the steps, in canvas pixels at 100%.
 */
export const CANVAS = {
  nodeWidth: 280,
  nodeHeight: 64,
  /** The agent step shows its agent name and `≤ <n> steps` on a third line. */
  agentNodeHeight: 84,
  /** Start and End are circles of this diameter. */
  terminalSize: 48,
  /** The connector's length between two nodes. */
  gap: 48,
  padX: 24,
  /** Room for the zoom toolbar at the canvas top-left. */
  padTop: 56,
  padBottom: 32,
  /** Right of the nodes: the exit notes and the connector labels' tail. */
  sideWidth: 180,
  /** Between a node's right edge and its exit notes; the line and its label. */
  noteGap: 10,
  exitRowHeight: 16,
} as const;

/** The zoom levels the toolbar steps through; fit may land between them. */
export const ZOOM_LEVELS = [0.75, 1, 1.25, 1.5] as const;
export const MIN_ZOOM = ZOOM_LEVELS[0];
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

export interface CanvasExit {
  text: string;
  outcome: 'fails' | 'stops';
  /** Top-left of the note, in canvas pixels. */
  x: number;
  y: number;
}

export interface CanvasNode {
  kind: 'start' | 'step' | 'end';
  /** `start`, `end` or the step's id. */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-based step number; null for Start and End. */
  number: number | null;
  step: AgentWorkflowStep | null;
  exits: CanvasExit[];
}

export interface CanvasConnector {
  /** `<from id>-<to id>`. */
  id: string;
  x: number;
  y1: number;
  y2: number;
  /** The SVG path, drawn with an arrowhead at `y2`. */
  path: string;
  /** The fields passed down this connector. */
  label: string;
  /** The label's left edge and vertical middle. */
  labelX: number;
  labelY: number;
}

export interface CanvasLayout {
  width: number;
  height: number;
  /** Start, the steps in run order, End. */
  nodes: CanvasNode[];
  /** One per pair of consecutive nodes, top to bottom. */
  connectors: CanvasConnector[];
}

const EXIT_TEXT = { fails: 'fails', stops: 'ends here' } as const;

function stepHeight(step: AgentWorkflowStep): number {
  return step.kind === 'agent' && step.agent
    ? CANVAS.agentNodeHeight
    : CANVAS.nodeHeight;
}

/**
 * What a connector carries: from Start, the first step's input; from a
 * step, its output (to End, the workflow's output).
 */
function connectorLabel(
  from: CanvasNode,
  to: CanvasNode,
): string {
  if (from.step !== null) return from.step.output.join(', ');
  return to.step !== null ? to.step.input.join(', ') : '';
}

/** The canvas layout of a workflow's steps. A pure function. */
export function workflowCanvasLayout(
  steps: readonly AgentWorkflowStep[],
): CanvasLayout {
  const cx = CANVAS.padX + CANVAS.nodeWidth / 2;
  const terminalX = cx - CANVAS.terminalSize / 2;
  const nodes: CanvasNode[] = [];
  let y = CANVAS.padTop;

  const terminal = (kind: 'start' | 'end'): CanvasNode => ({
    kind,
    id: kind,
    x: terminalX,
    y,
    width: CANVAS.terminalSize,
    height: CANVAS.terminalSize,
    number: null,
    step: null,
    exits: [],
  });

  nodes.push(terminal('start'));
  y += CANVAS.terminalSize + CANVAS.gap;
  steps.forEach((step, i) => {
    const height = stepHeight(step);
    const notesTop =
      y + (height - step.exits.length * CANVAS.exitRowHeight) / 2;
    nodes.push({
      kind: 'step',
      id: step.id,
      x: CANVAS.padX,
      y,
      width: CANVAS.nodeWidth,
      height,
      number: i + 1,
      step,
      exits: step.exits.map((exit, row) => ({
        text: `${exit.label} → ${EXIT_TEXT[exit.outcome]}`,
        outcome: exit.outcome,
        x: CANVAS.padX + CANVAS.nodeWidth + CANVAS.noteGap,
        y: notesTop + row * CANVAS.exitRowHeight,
      })),
    });
    y += height + CANVAS.gap;
  });
  nodes.push(terminal('end'));

  const connectors = nodes.slice(1).map((to, i): CanvasConnector => {
    const from = nodes[i];
    const y1 = from.y + from.height;
    const y2 = to.y;
    return {
      id: `${from.id}-${to.id}`,
      x: cx,
      y1,
      y2,
      path: `M ${cx} ${y1} V ${y2}`,
      label: connectorLabel(from, to),
      labelX: cx + CANVAS.noteGap,
      labelY: (y1 + y2) / 2,
    };
  });

  return {
    width:
      CANVAS.padX + CANVAS.nodeWidth + CANVAS.sideWidth + CANVAS.padX,
    height: y + CANVAS.terminalSize + CANVAS.padBottom,
    nodes,
    connectors,
  };
}

/**
 * Fit to screen: the largest zoom, in steps of 5%, at which the whole canvas
 * shows in the viewport, kept between 75% and 150% so the graph stays
 * readable (the canvas scrolls below 75%).
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
  const fives = Math.floor(ratio * 20 + 1e-6);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fives / 20));
}

/** The next zoom level above `zoom`, or the largest. */
export function zoomIn(zoom: number): number {
  return ZOOM_LEVELS.find((level) => level > zoom + 1e-6) ?? MAX_ZOOM;
}

/** The next zoom level below `zoom`, or the smallest. */
export function zoomOut(zoom: number): number {
  return (
    [...ZOOM_LEVELS].reverse().find((level) => level < zoom - 1e-6) ?? MIN_ZOOM
  );
}
