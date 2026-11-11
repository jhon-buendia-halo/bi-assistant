import { AgentWorkflow } from '../../agents/services/agents-api.service';

/** One field of a run workflow's input, defined in code (api.md 116). */
export interface WorkflowInputField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number';
  required: boolean;
  placeholder?: string;
}

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
}

/**
 * One workflow with its steps (api.md 117). Structurally an `AgentWorkflow`,
 * so the 1.23.1 drawing takes it unchanged.
 */
export interface WorkflowDetail extends WorkflowSummary {
  steps: AgentWorkflow['steps'];
}

/** One step of a run, in the workflow's order (api.md 118). */
export interface WorkflowRunStepResult {
  id: string;
  title: string;
  status: 'success' | 'failed' | 'skipped';
  output?: Record<string, unknown>;
  error?: string;
}

/**
 * What `POST /workflows/:id/runs` answers (api.md 118). Copied from the
 * backend's `WorkflowRunResult` (backend/src/mastra/workflows/workflow-run.ts).
 */
export interface WorkflowRunResult {
  workflowId: string;
  status: 'success' | 'failed';
  steps: WorkflowRunStepResult[];
  output?: Record<string, unknown>;
  error?: string;
}
