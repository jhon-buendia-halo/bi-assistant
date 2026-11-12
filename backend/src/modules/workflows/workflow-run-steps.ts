/**
 * A workflow run as the run stream reports it and the store keeps it
 * (api.md 119-121; data-model 3.16; agents.md 5.14): its shape, its steps
 * from the engine's step events, its answer from the run host, its summary
 * and the run-backed host its files are served from. Plain data and pure
 * functions, no framework import, so Jest can read them without loading
 * Mastra.
 */
import {
  runErrorMessage,
  type WorkflowRunResult,
} from '../../mastra/workflows/workflow-run';
import type { WorkflowInputValues } from '../../mastra/workflows/workflow-catalog';
import type {
  ChatMessage,
  PanelItem,
  SessionAgentRef,
  SessionDoc,
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
 * One run of a workflow on an input, as the API shows it (api.md 119
 * `done.run`, 121): the stored run (`WorkflowRunDoc`) plus, for an agent
 * workflow, the derived `panelItems`, `workflow` view and `agent`, computed
 * as a session's are (api.md 2.1) on every read.
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
  /** Legacy and inert (data-model 3.14): `local`. */
  ownerId?: string;
  startedAt: string;
  finishedAt?: string;
  /** Store-maintained. */
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A run as the `workflow_runs` collection stores it (data-model 3.16; plan
 * 5.3): the wire run without the derived `agent` and `workflow` view.
 * `panelItems` are the host's items as they were when the run ended.
 */
export type WorkflowRunDoc = Omit<WorkflowRun, 'agent' | 'workflow'>;

/** A run in the history list (api.md 120). */
export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  title: string;
  startedAt: string;
  finishedAt?: string;
}

/** The longest run title, in characters (plan 5.3). */
export const RUN_TITLE_MAX = 120;

/** A run the app stopped in, as start-up recovery fails it (plan 5.1 step 5). */
export const RUN_INTERRUPTED_ERROR = 'The app stopped before the run finished';

/**
 * A run's title (plan 5.3): its question, else the first of `textFields`
 * (the workflow's `text` and `textarea` inputs, in form order) with a value,
 * else the workflow's name; trimmed, at most `RUN_TITLE_MAX` characters.
 */
export function runTitle(
  run: Pick<WorkflowRunDoc, 'question' | 'input' | 'workflowName'>,
  textFields: readonly string[],
): string {
  const candidates = [
    run.question,
    ...textFields.map((name) => run.input[name]),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed.slice(0, RUN_TITLE_MAX);
  }
  return run.workflowName.slice(0, RUN_TITLE_MAX);
}

/** A stored run as the history lists it (api.md 120). */
export function runSummaryOf(
  run: WorkflowRunDoc,
  textFields: readonly string[],
): WorkflowRunSummary {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    status: run.status,
    title: runTitle(run, textFields),
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
  };
}

/**
 * The run-backed host of a stored run (plan 5.2): a `SessionDoc` shaped as
 * the run's host was, so the services that serve a session's visuals, panel
 * files and RFP packages (api.md 9, 14, 105-107) and derive its views (2.1)
 * serve the run's from its workspace `session-run-<id>`. Its transcript is
 * the run's question and answer, so a visual finds its source answer.
 * Never held, stored or listed.
 */
export function runHostDoc(run: WorkflowRunDoc): SessionDoc {
  const id = `run-${run.id}`;
  return {
    id,
    name: run.workflowName.slice(0, 64),
    workspaceId: `session-${id}`,
    run: true,
    datasets: run.datasets,
    ...(run.agentKey ? { agentKey: run.agentKey } : {}),
    ...(run.agentId ? { agentId: run.agentId } : {}),
    ...(run.agentName ? { agentName: run.agentName } : {}),
    workflowId: run.workflowId,
    ...(run.rfpId ? { rfpId: run.rfpId } : {}),
    messages: [
      ...(run.question !== undefined
        ? [{ role: 'user' as const, content: run.question, at: run.startedAt }]
        : []),
      ...(run.answer ? [run.answer] : []),
    ],
    ...(run.panelItems ? { panelItems: run.panelItems } : {}),
    visualizations: run.visualizations ?? [],
    ...(run.workflowState ? { workflowState: run.workflowState } : {}),
    createdAt: run.startedAt,
    updatedAt: run.finishedAt ?? run.startedAt,
  };
}

/** What a code-only run's synchronous result stores (api.md 118). */
export function runOfResult(
  result: WorkflowRunResult,
  finishedAt: string,
): Partial<WorkflowRunDoc> {
  return {
    status: result.status,
    steps: result.steps.map((step) => {
      const { output, ...rest } = step;
      return output === undefined ? rest : { ...rest, ...outputFields(output) };
    }),
    ...(result.output ? { output: result.output } : {}),
    ...(result.error ? { error: result.error } : {}),
    finishedAt,
  };
}

/**
 * What start-up recovery writes on a run the app stopped in (plan 5.1 step
 * 5): `failed` with `RUN_INTERRUPTED_ERROR`, and so is any step still running.
 */
export function interruptedRunPatch(
  run: WorkflowRunDoc,
  finishedAt: string,
): Partial<WorkflowRunDoc> {
  return {
    status: 'failed',
    error: RUN_INTERRUPTED_ERROR,
    steps: run.steps.map((step) =>
      step.status === 'running'
        ? { ...step, status: 'failed', error: RUN_INTERRUPTED_ERROR }
        : step,
    ),
    finishedAt,
  };
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
