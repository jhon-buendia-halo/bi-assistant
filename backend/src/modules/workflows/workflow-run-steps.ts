/**
 * A workflow run as the run stream reports it (api.md 119; agents.md 5.14):
 * its shape, its steps from the engine's step events, and its answer from
 * the run host. Plain data and pure functions, no framework import, so Jest
 * can read them without loading Mastra.
 */
import { runErrorMessage } from '../../mastra/workflows/workflow-run';
import type { WorkflowInputValues } from '../../mastra/workflows/workflow-catalog';
import type {
  ChatMessage,
  PanelItem,
  SessionAgentRef,
  SessionVisualization,
  WorkflowState,
  WorkflowView,
} from '../sessions/entities/session.entity';

/** A run's status: `running` until it ends. */
export type WorkflowRunStatus = 'running' | 'success' | 'failed' | 'stopped';

/** A step's status in a run (api.md 119 `step`). */
export type WorkflowRunStepStatus =
  'running' | 'success' | 'failed' | 'skipped' | 'stopped';

/** One step of a run, as a `step` event and in the run carry it. */
export interface WorkflowRunStep {
  id: string;
  title: string;
  status: WorkflowRunStepStatus;
  /** A step's output once it ended, when under `STEP_OUTPUT_CAP` as JSON. */
  output?: Record<string, unknown>;
  /** Set instead of `output` when the output is larger than the cap. */
  outputTruncated?: true;
  /** A failed step's error. */
  error?: string;
}

/**
 * One run of a workflow on an input (api.md 119 `done.run`; plan 5.3 without
 * the store fields): its input, its steps and outcome and, for an agent
 * workflow, what its agent turn left on the run host.
 */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  input: WorkflowInputValues;
  context?: { fromRunId: string };
  status: WorkflowRunStatus;
  /** Every step of the workflow, in its order. */
  steps: WorkflowRunStep[];
  /** The workflow's final output (success only). */
  output?: Record<string, unknown>;
  /** Why the run failed. */
  error?: string;
  /** Agent workflows: the answer message, as a session's assistant message. */
  answer?: ChatMessage;
  /** Agent workflows: the user message the agent received. */
  question?: string;
  /** The datasets the run worked over (`[]` for a code-only run). */
  datasets: string[];
  agentKey?: string;
  agentId?: string;
  agentName?: string;
  /** The agent its agent step ran, as a session's `agent` (api.md 2.1). */
  agent?: SessionAgentRef;
  /** RFP Builder runs: the RFP the run worked on. */
  rfpId?: string;
  panelItems?: PanelItem[];
  visualizations?: SessionVisualization[];
  workflowState?: WorkflowState;
  /** The agent's phases (the derived view, api.md 2.1). */
  workflow?: WorkflowView;
  startedAt: string;
  finishedAt?: string;
}

/** The largest step output carried, as JSON characters (plan 5.3). */
export const STEP_OUTPUT_CAP = 20_000;

/** An engine step event, as much of it as the tracker reads. */
export interface EngineStepEvent {
  type: string;
  payload?: { id?: string; status?: string; output?: unknown; error?: unknown };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A step's output, or the truncation mark when it is too large. */
function outputFields(
  value: unknown,
): Pick<WorkflowRunStep, 'output' | 'outputTruncated'> {
  const output = asRecord(value);
  if (!output) return {};
  let size = Infinity;
  try {
    size = JSON.stringify(output).length;
  } catch {
    // A circular or otherwise unserializable output is not carried.
  }
  return size <= STEP_OUTPUT_CAP ? { output } : { outputTruncated: true };
}

/**
 * The steps of one run, from the engine's step events (agents.md 5.14): a
 * step that starts is `running`; one that ends is `success`, `failed` with
 * its error, or `stopped` when it ended the run early (an agent step whose
 * output says `stopped`, or one that bailed). A step this workflow doesn't
 * have, and any other event, change nothing.
 */
export class RunStepTracker {
  private readonly states = new Map<string, WorkflowRunStep>();

  constructor(
    private readonly steps: readonly { id: string; title: string }[],
  ) {}

  /** The `step` event one engine event makes, or undefined. */
  apply(event: EngineStepEvent): WorkflowRunStep | undefined {
    const id = event.payload?.id;
    const step = this.steps.find((candidate) => candidate.id === id);
    if (!step) return undefined;
    let next: WorkflowRunStep | undefined;
    if (event.type === 'workflow-step-start') {
      next = { id: step.id, title: step.title, status: 'running' };
    } else if (event.type === 'workflow-step-result') {
      const status = event.payload?.status;
      const fields = outputFields(event.payload?.output);
      if (status === 'success' || status === 'bailed') {
        const stopped =
          status === 'bailed' || fields.output?.['stopped'] === true;
        next = {
          id: step.id,
          title: step.title,
          status: stopped ? 'stopped' : 'success',
          ...fields,
        };
      } else if (status === 'failed') {
        // An event without the error leaves it to the run's (`finish`).
        next = {
          id: step.id,
          title: step.title,
          status: 'failed',
          ...(event.payload?.error === undefined
            ? {}
            : { error: runErrorMessage(event.payload.error) }),
        };
      }
    }
    if (!next) return undefined;
    this.states.set(step.id, next);
    return { ...next };
  }

  /**
   * The steps once the run ended, and those the end changed: a step still
   * running ends `stopped` (the run stopped) or `failed` with `error` (the
   * run failed); a failed step whose event had no error takes `error`; a
   * step that never started is `skipped`.
   */
  finish(
    status: Exclude<WorkflowRunStatus, 'running'>,
    error?: string,
  ): { steps: WorkflowRunStep[]; changed: WorkflowRunStep[] } {
    const changed: WorkflowRunStep[] = [];
    const steps = this.steps.map((step) => {
      const state = this.states.get(step.id);
      if (state?.status === 'failed' && state.error === undefined) {
        const filled = { ...state, error: error ?? 'The step failed' };
        changed.push({ ...filled });
        return filled;
      }
      if (state && state.status !== 'running') return { ...state };
      const ended: WorkflowRunStep = state
        ? status === 'failed'
          ? {
              id: step.id,
              title: step.title,
              status: 'failed',
              error: error ?? 'The step failed',
            }
          : { id: step.id, title: step.title, status: 'stopped' }
        : { id: step.id, title: step.title, status: 'skipped' };
      changed.push({ ...ended });
      return ended;
    });
    return { steps, changed };
  }

  /** The output of the last step that ended with one. */
  lastOutput(): Record<string, unknown> | undefined {
    for (const step of [...this.steps].reverse()) {
      const output = this.states.get(step.id)?.output;
      if (output) return output;
    }
    return undefined;
  }
}

/**
 * The answer a run host's turn left (agents.md 5.14): its last message when
 * that is an assistant message after the run's own question, else none (the
 * turn was stopped or failed before answering). An earlier run's answer,
 * given as context, is never this run's.
 */
export function runAnswerOf(
  messages: readonly ChatMessage[],
  contextMessages: number,
): ChatMessage | undefined {
  const last = messages.at(-1);
  if (messages.length <= contextMessages + 1) return undefined;
  return last?.role === 'assistant' ? last : undefined;
}
