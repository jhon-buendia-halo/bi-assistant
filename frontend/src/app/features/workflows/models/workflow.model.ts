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
  | 'datasets';

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
  /** 'datasets': only datasets bound to these kinds. */
  datasourceKinds?: ('postgres' | 'databricks' | 'rest')[];
  /** Set by the app, never rendered as a control. */
  hidden?: boolean;
  /**
   * The ids of the steps that read this field straight from the workflow
   * input, in step order (api.md 116, 117).
   */
  usedBy?: string[];
  /** 'text' / 'textarea': the longest value accepted, trimmed. */
  maxLength?: number;
  /** 'number': the smallest value accepted. */
  min?: number;
  /** 'number': the largest value accepted. */
  max?: number;
}

/**
 * One refusal of a run's input (api.md 118, 119 `errors[]`); `field` is null
 * for an error that is not about one field (`context.fromRunId`).
 */
export interface WorkflowInputError {
  field: string | null;
  message: string;
}

/** One value of a run's input (api.md 118). */
export type WorkflowInputValue = string | number | boolean | string[];

/**
 * One workflow of the catalogue, as `GET /workflows` lists it (api.md 116;
 * workflows R1). Copied from the backend's `WorkflowSummary`
 * (backend/src/modules/workflows/workflows.service.ts).
 */
export interface WorkflowSummary {
  /**
   * `qti-v2-turn`, the catalogue's only workflow. Agents are a library and
   * have no workflow of their own.
   */
  id: string;
  name: string;
  description: string;
  /** Defined in code. */
  kind: 'code';
  owner: 'Official';
  /** The agents its steps call, in step order, each once. */
  agents: { key: string; name: string }[];
  stepCount: number;
  /** Every workflow runs once on a typed input (api.md 118). */
  trigger: 'run';
  /** The typed input of a run workflow, in form order. */
  input: WorkflowInputField[];
  /** Empty: the run picks its datasets. */
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
  /** The agent's tools, as `GET /agents/:key` lists them (api.md 34). */
  toolDetails?: WorkflowAgentToolDetail[];
}

/** One tool of a workflow's agent (api.md 117 `agents[].toolDetails`). */
export interface WorkflowAgentToolDetail {
  name: string;
  description: string;
  /** Top-level input parameter names. */
  inputs: string[];
}

/**
 * A JSON Schema as `GET /workflows/:id` sends a step's declared contract
 * (api.md 117 `inputSchema` / `outputSchema`): an object schema whose
 * `properties` carry `type`, `items` and `description`, plus `required`.
 * Only the keywords the page reads are typed; others pass through.
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  [keyword: string]: unknown;
}

/** One step of a workflow detail: an agent step also names its agent's key (api.md 117). */
export type WorkflowDetailStep = Omit<AgentWorkflow['steps'][number], 'agent'> & {
  agent?: NonNullable<AgentWorkflow['steps'][number]['agent']> & { key?: string };
  /** The step's declared input contract; absent from an older backend. */
  inputSchema?: JsonSchema;
  /** The step's declared output contract; absent from an older backend. */
  outputSchema?: JsonSchema;
};

/**
 * One workflow with its steps (api.md 117). Structurally an `AgentWorkflow`,
 * so the 1.23.1 drawing takes it unchanged.
 */
export interface WorkflowDetail extends Omit<WorkflowSummary, 'agents'> {
  agents: WorkflowAgentDetail[];
  steps: WorkflowDetailStep[];
  /**
   * The first 12 hex of the sha256 of the workflow's contract (its input
   * fields and every step's schemas); absent from an older backend.
   */
  contractHash?: string;
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
 * One message of a chat with an agent step about its run data (api.md 136,
 * 137), stored with the run, per step.
 */
export interface NodeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** An assistant message: the read-only tool calls of its turn, in order. */
  toolCalls?: WorkflowRunToolCall[];
  /** The turn was stopped; `content` is the partial answer. */
  stopped?: true;
  /** The turn failed after it started. */
  error?: string;
  createdAt: string;
}

/**
 * Whether the node dialog of an agent step offers its Chat tab: `hidden`
 * when the run shown has no workflow in the catalogue, `no-run` before a
 * stored run is shown, `running` while it streams, `ready` once it ended.
 */
export type NodeChatAvailability =
  | { state: 'hidden' }
  | { state: 'no-run' }
  | { state: 'running' }
  | { state: 'ready'; runId: string };

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
 * Copied from api.md, not from the backend. Runs stored by a workflow that
 * is no longer in the catalogue keep their shape and read as plain runs.
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
  /** A run with an agent step: the user message the agent received. */
  question?: string;
  /** A run with an agent step: the persisted answer; absent when it stopped or failed first. */
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
  /** The workflow's `contractHash` when the run started; old runs lack it. */
  contractHash?: string;
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
  /** The agent step's answer (absent while streaming, or when none came). */
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
