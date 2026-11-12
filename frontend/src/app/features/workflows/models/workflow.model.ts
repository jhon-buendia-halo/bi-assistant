import { AgentWorkflow } from '../../agents/services/agents-api.service';
import {
  ChatMessage,
  PanelItem,
  SessionAgent,
  SessionVisualization,
  WorkflowView,
} from '../../sessions/models/session.model';

/** The control a run form shows for a field (api.md 116). */
export type WorkflowInputFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  /** A checkbox; absent means false (or its default). */
  | 'boolean'
  /** One or more dataset names. */
  | 'datasets'
  /** Exactly one dataset name. */
  | 'dataset';

/** One field of a workflow's input, defined in code (api.md 116). */
export interface WorkflowInputField {
  name: string;
  label: string;
  type: WorkflowInputFieldType;
  required: boolean;
  placeholder?: string;
  /** One line under the control. */
  help?: string;
  /** The value of a field that is missing or empty. */
  default?: string | number | boolean;
  /** 'dataset' / 'datasets': only datasets bound to these kinds. */
  datasourceKinds?: ('postgres' | 'databricks' | 'rest')[];
  /** Set by the app (the RFP Builder's Continue), never rendered as a control. */
  hidden?: boolean;
}

/** One value of a run's input (api.md 118). */
export type WorkflowInputValue = string | number | boolean | string[];

/**
 * One workflow of the catalogue, as `GET /workflows` lists it (api.md 116;
 * workflows R1). Copied from the backend's `WorkflowSummary`
 * (backend/src/modules/workflows/workflows.service.ts).
 */
export interface WorkflowSummary {
  /** `qti-v2-turn` | `agent:<registry key>` | `agent:<user-agent id>`. */
  id: string;
  name: string;
  description: string;
  /** Defined in code, or the one-step workflow of an agent. */
  kind: 'code' | 'agent';
  /** `You` for a user agent's workflow. */
  owner: 'Official' | 'You';
  /** The agents its steps call, in step order, each once. */
  agents: { key: string; name: string }[];
  stepCount: number;
  /** What drives a chat's workflow bar: these steps, or the agent's own phases. */
  bar: 'steps' | 'agent';
  /** Runs in a chat, or once on a typed input (api.md 118). */
  trigger: 'chat' | 'run';
  /** The typed input of a run workflow, in form order; `[]` for a chat workflow. */
  input: WorkflowInputField[];
  /** The session takes the datasets the user picks. */
  picksDatasets: boolean;
  /** The datasets a session would take; empty when `picksDatasets`. */
  datasets: string[];
  /** Named datasets that don't exist. */
  missingDatasets: string[];
  starterQuestions: string[];
  /** Why a chat can't start now; absent when it can. */
  chatRequirement?: string;
  /** Why a run can't start now; absent when it can (api.md 116). */
  runRequirement?: string;
}

/**
 * One workflow with its steps (api.md 117). Structurally an `AgentWorkflow`,
 * so the 1.23.1 drawing takes it unchanged.
 */
export interface WorkflowDetail extends WorkflowSummary {
  steps: AgentWorkflow['steps'];
}

/** A step's status in a streamed run (api.md 3.6 `step`). */
export type WorkflowRunStepStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'stopped';

/** One `step` event of the run stream, or a step of a stored run (api.md 3.6). */
export interface WorkflowRunStep {
  id: string;
  title: string;
  status: WorkflowRunStepStatus;
  output?: Record<string, unknown>;
  outputTruncated?: true;
  error?: string;
}

/** The body of `POST /workflows/:id/runs/stream` (api.md 118, 119). */
export interface WorkflowRunRequest {
  input: Record<string, WorkflowInputValue>;
  context?: { fromRunId: string };
}

/**
 * A stored run (api.md 3.6 `WorkflowRun`, 121), as `done.run` carries it.
 * Copied from api.md, not from the backend.
 */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  input: Record<string, WorkflowInputValue>;
  context?: { fromRunId: string };
  status: 'running' | 'success' | 'failed' | 'stopped';
  steps: WorkflowRunStep[];
  output?: Record<string, unknown>;
  error?: string;
  /** Agent workflows: the user message the agent received. */
  question?: string;
  /** Agent workflows: the persisted answer; absent when it stopped or failed first. */
  answer?: ChatMessage;
  datasets: string[];
  agentKey?: string;
  agentId?: string;
  agentName?: string;
  agent?: SessionAgent;
  rfpId?: string;
  panelItems?: PanelItem[];
  visualizations?: SessionVisualization[];
  /** The cards of the visual actions taken after the run (api.md 130-134). */
  events?: ChatMessage[];
  workflow?: WorkflowView;
  startedAt: string;
  finishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** One row of the run history (api.md 120 `WorkflowRunSummary`). */
export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowRun['status'];
  title: string;
  startedAt: string;
  finishedAt?: string;
}
