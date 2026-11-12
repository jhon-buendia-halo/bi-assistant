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
  /** Set by the app, never rendered as a control. */
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
  /** Every workflow runs once on a typed input (api.md 118). */
  trigger: 'run';
  /** The typed input of a run workflow, in form order. */
  input: WorkflowInputField[];
  /** The datasets the workflow's agent declares; empty when the run picks them. */
  datasets: string[];
  /** Named datasets that don't exist. */
  missingDatasets: string[];
  starterQuestions: string[];
  /** Why a run can't start now; absent when it can (api.md 116). */
  runRequirement?: string;
}

/** How a workflow starts, as its Start node says it (workflows R7). */
export const TRIGGER_LABELS: Record<WorkflowSummary['trigger'], string> = {
  run: 'Runs on an input',
};

/**
 * An agent a workflow's steps call, as `GET /workflows/:id` details it
 * (api.md 117). `model` and `systemPrompt` are optional here so a fixture
 * built from the list shape still type-checks; the backend always sends them.
 */
export interface WorkflowAgentDetail {
  key: string;
  name: string;
  /** `<provider>/<model>` of the agent's LLM; null when no LLM is set. */
  model?: string | null;
  /** The agent's base prompt (api.md 34 `instructions`); each run adds its own context. */
  systemPrompt?: string;
  /** The prompt was longer than 20 000 characters and was shortened. */
  systemPromptTruncated?: true;
}

/** One step of a workflow detail: an agent step also names its agent's key (api.md 117). */
export type WorkflowDetailStep = Omit<AgentWorkflow['steps'][number], 'agent'> & {
  agent?: NonNullable<AgentWorkflow['steps'][number]['agent']> & { key?: string };
};

/**
 * One workflow with its steps (api.md 117). Structurally an `AgentWorkflow`,
 * so the 1.23.1 drawing takes it unchanged.
 */
export interface WorkflowDetail extends Omit<WorkflowSummary, 'agents'> {
  agents: WorkflowAgentDetail[];
  steps: WorkflowDetailStep[];
}

/** A step's status in a streamed run (api.md 3.6 `step`). */
export type WorkflowRunStepStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'stopped';

/** One tool call of an agent step, from the turn's `tool` / `tool-result` events (api.md 3.6). */
export interface WorkflowRunToolCall {
  tool: string;
  /** What the tool ran (the SQL), at most 2 000 characters. */
  input?: string;
  rowCount?: number;
  error?: string;
  /** From the `tool` event to its `tool-result`; absent when no result came. */
  durationMs?: number;
}

/**
 * One `step` event of the run stream, or a step of a stored run (api.md 3.6).
 * Runs stored before the n8n-style page lack `input`, the timestamps and
 * `toolCalls`.
 */
export interface WorkflowRunStep {
  id: string;
  title: string;
  status: WorkflowRunStepStatus;
  /** What the step received, capped like `output`. */
  input?: Record<string, unknown>;
  inputTruncated?: true;
  output?: Record<string, unknown>;
  outputTruncated?: true;
  error?: string;
  /** ISO time the step started. */
  startedAt?: string;
  /** ISO time the step ended. */
  endedAt?: string;
  /** Agent steps fed by an agent turn: its tool calls in order, at most 50. */
  toolCalls?: WorkflowRunToolCall[];
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

/** A tool call of the run's agent turn, as it streams (api.md 3.1). */
export interface LiveToolCall {
  name: string;
  rationale?: string;
  input?: string;
  rowCount?: number;
  error?: string;
  /** The latest `tool-progress` message of a long-running tool. */
  progress?: string;
  /** Its `tool-result` arrived. */
  finished: boolean;
}

/** One step of the run shown, in the workflow's order. */
export interface RunStepView {
  id: string;
  title: string;
  kind: 'code' | 'agent';
  /** Null for a step that has not started yet. */
  status: WorkflowRunStepStatus | null;
  input?: Record<string, unknown>;
  inputTruncated?: true;
  output?: Record<string, unknown>;
  outputTruncated?: true;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  toolCalls?: WorkflowRunToolCall[];
}

/** The run shown on the workflow page: live while it streams, then as stored. */
export interface RunView {
  status: WorkflowRun['status'];
  error?: string;
  steps: RunStepView[];
  output?: Record<string, unknown>;
  /** Agent workflows: the answer (absent while streaming, or when none came). */
  answer?: ChatMessage;
  /** Null until the stream's `run` event arrives. */
  runId?: string | null;
  /** The input the run was started with; null when unknown. */
  input?: Record<string, WorkflowInputValue> | null;
  startedAt?: string;
  finishedAt?: string;
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
