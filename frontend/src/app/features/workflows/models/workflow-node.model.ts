import {
  WorkflowAgentDetail,
  WorkflowDetailStep,
  WorkflowRun,
  WorkflowRunStepStatus,
  WorkflowRunToolCall,
} from './workflow.model';

/**
 * The nodes of the n8n-style workflow page (ui.md 4.4b): the Start trigger,
 * one node per step, and the End output. The canvas, the node dialog and the
 * Workflow state panel all read these shapes.
 */

/** The id of the Start (trigger) node; no step may use it. */
export const START_NODE_ID = 'start';
/** The id of the End (output) node; no step may use it. */
export const END_NODE_ID = 'end';

export type WorkflowNodeKind = 'trigger' | 'code' | 'agent' | 'output';

/** A tool call shown in a node's Output: stored, or live while the step runs. */
export interface NodeToolCallView extends WorkflowRunToolCall {
  finished: boolean;
}

/** What one node received and produced in the run shown. */
export interface NodeRunView {
  status: WorkflowRunStepStatus;
  input?: Record<string, unknown>;
  inputTruncated?: true;
  output?: Record<string, unknown>;
  outputTruncated?: true;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  /** Null when either timestamp is missing. */
  durationMs: number | null;
  /** Stored `step.toolCalls`, else the live calls of the running agent step. */
  toolCalls: NodeToolCallView[];
}

/** What a step can see while it runs, besides its own input. */
export interface NodeContext {
  workflowInput: Record<string, unknown> | null;
  /** The steps before it, in order, with their status in the run shown. */
  earlierSteps: {
    id: string;
    title: string;
    status: WorkflowRunStepStatus | null;
  }[];
  agent: {
    key: string;
    name: string;
    model: string | null;
    tools: string[];
  } | null;
}

/** Everything the node dialog and the Workflow state panel show about one node. */
export interface NodeInspection {
  /** START_NODE_ID | a step id | END_NODE_ID. */
  nodeId: string;
  kind: WorkflowNodeKind;
  /** `Start` | the step's title | `End`. */
  title: string;
  /** 1-based step number; null for Start and End. */
  number: number | null;
  /** The step's summary; Start: the workflow's description; End: ''. */
  summary: string;
  step: WorkflowDetailStep | null;
  /** The step's agent, resolved through `step.agent.key`. */
  agent: WorkflowAgentDetail | null;
  /** Null when no run is shown, or the node never started. */
  run: NodeRunView | null;
  /** Steps only. */
  context: NodeContext | null;
}

/** The summary row of the Workflow state panel. */
export interface WorkflowStateSummary {
  /** Null when no run is shown. */
  status: WorkflowRun['status'] | null;
  /** Nodes whose status is success, failed or stopped. */
  ran: number;
  /** Steps + 2 (Start and End). */
  total: number;
  durationMs: number | null;
  runId: string | null;
}
