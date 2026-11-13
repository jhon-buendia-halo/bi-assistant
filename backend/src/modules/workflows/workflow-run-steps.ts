/**
 * A workflow run as the run stream reports it and the store keeps it
 * (api.md 119-121; data-model 3.16; agents.md 5.14): its shape, its steps
 * from the engine's step events, its answer from the run host, its summary
 * and the run-backed host its files are served from. Plain data and pure
 * functions, no framework import, so Jest can read them without loading
 * Mastra.
 */
import { runErrorMessage } from '../../mastra/workflows/workflow-run';
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

/**
 * A run's status: `running` until it ends; `suspended` while it waits for
 * the user's answer (api.md 138, ADR-0043).
 */
export type WorkflowRunStatus =
  'running' | 'suspended' | 'success' | 'failed' | 'stopped';

/** A step's status in a run (api.md 119 `step`); `suspended`: it waits. */
export type WorkflowRunStepStatus =
  'running' | 'suspended' | 'success' | 'failed' | 'skipped' | 'stopped';

/**
 * What a suspended run waits for (api.md 119 `input-required`, 138;
 * data-model 3.16): the waiting step, its question and options, when it
 * started waiting and when it stops being resumable. `expired` once it no
 * longer can (it expired or the app restarted): the run is then `stopped`.
 */
export interface WorkflowRunWaitingFor {
  stepId: string;
  title: string;
  question: string;
  options: string[];
  since: string;
  expiresAt: string;
  expired?: true;
}

/**
 * One tool call of an agent step, from its agent turn's `tool` and
 * `tool-result` events (api.md 3.1, 3.6).
 */
export interface WorkflowRunToolCall {
  tool: string;
  /**
   * What the tool ran: the `tool-result` input (the SQL), else the `tool`
   * event's; at most `TOOL_CALL_INPUT_CAP` characters.
   */
  input?: string;
  rowCount?: number;
  error?: string;
  /** From the `tool` event to its `tool-result`; absent when no result came. */
  durationMs?: number;
}

/**
 * One step of a run, as a `step` event and in the run carry it. Runs stored
 * before the n8n-style workflow page lack `input`, the times and `toolCalls`.
 */
export interface WorkflowRunStep {
  id: string;
  title: string;
  status: WorkflowRunStepStatus;
  /**
   * A step inside a loop (v2's Analyse and Validate): which run of it this
   * is, from 1; a run keeps one entry per attempt. Absent on any other step
   * and on a loop step that never ran (`skipped`).
   */
  attempt?: number;
  /** What the step received, when under `STEP_OUTPUT_CAP` as JSON. */
  input?: Record<string, unknown>;
  /** Set instead of `input` when the input is larger than the cap. */
  inputTruncated?: true;
  /** A step's output once it ended, when under `STEP_OUTPUT_CAP` as JSON. */
  output?: Record<string, unknown>;
  /** Set instead of `output` when the output is larger than the cap. */
  outputTruncated?: true;
  /** A failed step's error. */
  error?: string;
  /** ISO time the step started. */
  startedAt?: string;
  /** ISO time the step ended (absent for a skipped step). */
  endedAt?: string;
  /**
   * Agent steps fed by an agent turn: their tool calls in call order, at
   * most `STEP_TOOL_CALL_CAP`; absent when the step made none.
   */
  toolCalls?: WorkflowRunToolCall[];
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
  /**
   * The workflow's contract hash when the run started (api.md 117;
   * agents.md 5.12). Absent on runs stored before it, and on draft runs.
   */
  contractHash?: string;
  input: WorkflowInputValues;
  context?: { fromRunId: string };
  status: WorkflowRunStatus;
  /** Every step of the workflow, in its order. */
  steps: WorkflowRunStep[];
  /** The workflow's final output (success only). */
  output?: Record<string, unknown>;
  /** Why the run failed. */
  error?: string;
  /**
   * A suspended run: what it waits for (api.md 138). Kept, `expired`, on a
   * run that could no longer be resumed; dropped once it is resumed.
   */
  waitingFor?: WorkflowRunWaitingFor;
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
  panelItems?: PanelItem[];
  visualizations?: SessionVisualization[];
  /**
   * Agent workflows: the cards of the visual actions taken after the run
   * (created, updated, reverted), as the assistant messages a session logs
   * (api.md 125a-125e); `runHostDoc` places them after the answer.
   */
  events?: ChatMessage[];
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
 * files (api.md 9, 14, 106-107) and derive its views (2.1)
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
    messages: [
      ...(run.question !== undefined
        ? [{ role: 'user' as const, content: run.question, at: run.startedAt }]
        : []),
      ...(run.answer ? [run.answer] : []),
      ...(run.events ?? []),
    ],
    ...(run.panelItems ? { panelItems: run.panelItems } : {}),
    visualizations: run.visualizations ?? [],
    ...(run.workflowState ? { workflowState: run.workflowState } : {}),
    createdAt: run.startedAt,
    updatedAt: run.finishedAt ?? run.startedAt,
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

/** Why a suspended run can no longer go on (api.md 138 410). */
export const RUN_EXPIRED_ERROR =
  'This run can no longer continue — run it again with your answer';

/**
 * What a suspended run becomes once it can no longer be resumed (ADR-0043:
 * it waited too long, or the app restarted): `stopped`, its `waitingFor`
 * kept and marked `expired`, the waiting step `stopped`.
 */
export function expiredRunPatch(
  run: WorkflowRunDoc,
  finishedAt: string,
): Partial<WorkflowRunDoc> {
  return {
    status: 'stopped',
    ...(run.waitingFor
      ? { waitingFor: { ...run.waitingFor, expired: true as const } }
      : {}),
    steps: run.steps.map((step) =>
      step.status === 'suspended' || step.status === 'running'
        ? { ...step, status: 'stopped', endedAt: finishedAt }
        : step,
    ),
    finishedAt,
  };
}

/** The largest step output or input carried, as JSON characters (plan 5.3). */
export const STEP_OUTPUT_CAP = 20_000;

/** The most tool calls one step keeps. */
export const STEP_TOOL_CALL_CAP = 50;

/** The longest tool call input kept, in characters. */
export const TOOL_CALL_INPUT_CAP = 2_000;

/**
 * An engine step event, as much of it as the tracker reads. Mastra's
 * `workflow-step-start` carries the step's input as `payload.payload`.
 */
export interface EngineStepEvent {
  type: string;
  payload?: {
    id?: string;
    status?: string;
    payload?: unknown;
    output?: unknown;
    error?: unknown;
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A record under `STEP_OUTPUT_CAP` as JSON, `'truncated'` above, else none. */
function capped(
  value: unknown,
): Record<string, unknown> | 'truncated' | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  let size = Infinity;
  try {
    size = JSON.stringify(record).length;
  } catch {
    // A circular or otherwise unserializable value is not carried.
  }
  return size <= STEP_OUTPUT_CAP ? record : 'truncated';
}

/** A step's output, or the truncation mark when it is too large. */
function outputFields(
  value: unknown,
): Pick<WorkflowRunStep, 'output' | 'outputTruncated'> {
  const output = capped(value);
  if (output === undefined) return {};
  return output === 'truncated' ? { outputTruncated: true } : { output };
}

/** A step's input, or the truncation mark when it is too large. */
function inputFields(
  value: unknown,
): Pick<WorkflowRunStep, 'input' | 'inputTruncated'> {
  const input = capped(value);
  if (input === undefined) return {};
  return input === 'truncated' ? { inputTruncated: true } : { input };
}

/** What a step keeps from its start once it ends: input, start, calls. */
function startedFields(
  state: WorkflowRunStep | undefined,
): Pick<WorkflowRunStep, 'input' | 'inputTruncated' | 'startedAt'> {
  if (!state) return {};
  return {
    ...(state.input ? { input: state.input } : {}),
    ...(state.inputTruncated ? { inputTruncated: true } : {}),
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
  };
}

/** A tool call input, clipped to `TOOL_CALL_INPUT_CAP`. */
function callInput(input: unknown): Pick<WorkflowRunToolCall, 'input'> {
  return typeof input === 'string' && input
    ? { input: input.slice(0, TOOL_CALL_INPUT_CAP) }
    : {};
}
/** A tool call as a step holds it: the call, its start, whether it ended. */
interface TrackedCall {
  call: WorkflowRunToolCall;
  startedAt?: number;
  done: boolean;
}

/** A step of the workflow, as the tracker reads it. */
export interface TrackedStepShape {
  id: string;
  title: string;
  kind?: 'code' | 'agent';
  /** A step inside a loop (agents.md 5.11): it can run more than once. */
  repeats?: boolean;
}

/**
 * The steps of one run, from the engine's step events (agents.md 5.14): a
 * step that starts is `running`, with what it received and when; one that
 * ends is `success`, `failed` with its error, or `stopped` when it ended the
 * run early (an agent step whose output says `stopped`, or one that bailed),
 * keeping its input and start and adding its end. A step this workflow
 * doesn't have, and any other event, change nothing. An agent step that is
 * running also collects its turn's tool calls (`noteTool`,
 * `noteToolResult`).
 *
 * A step inside a loop (`repeats`) keeps one entry per attempt: each start
 * after its last attempt ended begins the next one, and every event of such
 * a step carries its `attempt` (1, 2, …). Any other step keeps one entry.
 */
export class RunStepTracker {
  /** Each step's attempts, oldest first. */
  private readonly states = new Map<string, WorkflowRunStep[]>();
  /** Tool calls by step id and attempt (`<id>#<attempt>`). */
  private readonly calls = new Map<string, TrackedCall[]>();

  constructor(
    private readonly steps: readonly TrackedStepShape[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The `step` event one engine event makes, or undefined. */
  apply(event: EngineStepEvent): WorkflowRunStep | undefined {
    const id = event.payload?.id;
    const step = this.steps.find((candidate) => candidate.id === id);
    if (!step) return undefined;
    const attempts = this.states.get(step.id) ?? [];
    const prev = attempts.at(-1);
    let next: WorkflowRunStep | undefined;
    let replace = true;
    if (event.type === 'workflow-step-start' && prev?.status === 'suspended') {
      // A resumed step (ADR-0043) goes on in the same attempt: it keeps its
      // input, its start and the tool calls it made before it waited.
      next = { ...prev, status: 'running' };
      delete next.toolCalls;
    } else if (event.type === 'workflow-step-start') {
      const again = !!step.repeats && !!prev && prev.status !== 'running';
      const attempt = again ? (prev.attempt ?? 1) + 1 : (prev?.attempt ?? 1);
      replace = !again;
      next = {
        id: step.id,
        title: step.title,
        status: 'running',
        ...(step.repeats ? { attempt } : {}),
        ...inputFields(event.payload?.payload),
        startedAt: this.now().toISOString(),
      };
      this.calls.delete(callKey(next));
    } else if (event.type === 'workflow-step-suspended') {
      // The step waits for the user's answer (api.md 138).
      next = {
        id: step.id,
        title: step.title,
        status: 'suspended',
        ...(step.repeats ? { attempt: prev?.attempt ?? 1 } : {}),
        ...startedFields(prev),
      };
    } else if (event.type === 'workflow-step-result') {
      const status = event.payload?.status;
      const fields = outputFields(event.payload?.output);
      const attempt = step.repeats ? { attempt: prev?.attempt ?? 1 } : {};
      if (status === 'success' || status === 'bailed') {
        const stopped =
          status === 'bailed' || fields.output?.['stopped'] === true;
        next = {
          id: step.id,
          title: step.title,
          status: stopped ? 'stopped' : 'success',
          ...attempt,
          ...startedFields(prev),
          ...fields,
          endedAt: this.now().toISOString(),
        };
      } else if (status === 'failed') {
        // An event without the error leaves it to the run's (`finish`).
        next = {
          id: step.id,
          title: step.title,
          status: 'failed',
          ...attempt,
          ...startedFields(prev),
          ...(event.payload?.error === undefined
            ? {}
            : { error: runErrorMessage(event.payload.error) }),
          endedAt: this.now().toISOString(),
        };
      }
    }
    if (!next) return undefined;
    this.states.set(
      step.id,
      replace && attempts.length
        ? [...attempts.slice(0, -1), next]
        : [...attempts, next],
    );
    return this.view(next);
  }

  /**
   * A tool call of the agent turn (api.md 3.1 `tool`): it belongs to the
   * agent step that is running (its current attempt); none running, or the
   * step holding `STEP_TOOL_CALL_CAP` calls already, drops it.
   */
  noteTool(name: string, input?: string): void {
    const key = this.runningAgentStep();
    if (!key) return;
    const calls = this.calls.get(key) ?? [];
    if (calls.length >= STEP_TOOL_CALL_CAP) return;
    calls.push({
      call: { tool: name, ...callInput(input) },
      startedAt: this.now().getTime(),
      done: false,
    });
    this.calls.set(key, calls);
  }

  /**
   * A tool call's result (api.md 3.1 `tool-result`): it ends the first
   * unfinished call of the same tool of the running agent step (FIFO), with
   * its input (the SQL) when it has one, its row count or error and the
   * call's duration. A result without a call is kept as a call of its own.
   */
  noteToolResult(result: {
    tool: string;
    input?: string;
    rowCount?: number;
    error?: string;
  }): void {
    const key = this.runningAgentStep();
    if (!key) return;
    const calls = this.calls.get(key) ?? [];
    let tracked = calls.find(
      (candidate) => !candidate.done && candidate.call.tool === result.tool,
    );
    if (!tracked) {
      if (calls.length >= STEP_TOOL_CALL_CAP) return;
      tracked = { call: { tool: result.tool }, done: false };
      calls.push(tracked);
      this.calls.set(key, calls);
    }
    tracked.done = true;
    tracked.call = {
      ...tracked.call,
      ...callInput(result.input),
      ...(typeof result.rowCount === 'number'
        ? { rowCount: result.rowCount }
        : {}),
      ...(typeof result.error === 'string' && result.error
        ? { error: result.error }
        : {}),
      ...(tracked.startedAt !== undefined
        ? { durationMs: Math.max(0, this.now().getTime() - tracked.startedAt) }
        : {}),
    };
  }

  /**
   * The steps once the run ended, and those the end changed: a step still
   * running ends `stopped` (the run stopped) or `failed` with `error` (the
   * run failed), keeping its input and start and taking its end; a failed
   * step whose event had no error takes `error`; a step that never started
   * is `skipped` (with no `attempt`). Steps come in catalogue order, a
   * repeated step's attempts one after the other.
   */
  finish(
    status: Exclude<WorkflowRunStatus, 'running'>,
    error?: string,
  ): { steps: WorkflowRunStep[]; changed: WorkflowRunStep[] } {
    const changed: WorkflowRunStep[] = [];
    const ended = (state: WorkflowRunStep): WorkflowRunStep => {
      if (state.status === 'failed' && state.error === undefined) {
        const filled = { ...state, error: error ?? 'The step failed' };
        changed.push(this.view(filled));
        return filled;
      }
      if (state.status !== 'running') return state;
      const { input, inputTruncated, startedAt } = startedFields(state);
      const closed: WorkflowRunStep = {
        id: state.id,
        title: state.title,
        ...(status === 'failed'
          ? { status: 'failed' as const, error: error ?? 'The step failed' }
          : { status: 'stopped' as const }),
        ...(state.attempt !== undefined ? { attempt: state.attempt } : {}),
        ...(input ? { input } : {}),
        ...(inputTruncated ? { inputTruncated } : {}),
        ...(startedAt ? { startedAt } : {}),
        endedAt: this.now().toISOString(),
      };
      changed.push(this.view(closed));
      return closed;
    };
    const steps = this.steps.flatMap((step) => {
      const attempts = this.states.get(step.id);
      if (!attempts?.length) {
        const skipped: WorkflowRunStep = {
          id: step.id,
          title: step.title,
          status: 'skipped',
        };
        changed.push({ ...skipped });
        return [skipped];
      }
      const closed = attempts.map(ended);
      this.states.set(step.id, closed);
      return closed.map((state) => this.view(state));
    });
    return { steps, changed };
  }

  /**
   * The steps of a run that waits for the user (ADR-0043): those that ran
   * or run, in catalogue order (a repeated step's attempts one after the
   * other), the waiting one `suspended`. Steps that have not started are
   * left out: they may still run once the run is resumed.
   */
  pause(): WorkflowRunStep[] {
    return this.steps.flatMap((step) =>
      (this.states.get(step.id) ?? []).map((state) => this.view(state)),
    );
  }

  /** The call key of the agent step attempt that is running, if any. */
  private runningAgentStep(): string | undefined {
    for (const step of this.steps) {
      if (step.kind !== 'agent') continue;
      const current = this.states.get(step.id)?.at(-1);
      if (current?.status === 'running') return callKey(current);
    }
    return undefined;
  }

  /** A copy of a step's state, with its tool calls when it made any. */
  private view(state: WorkflowRunStep): WorkflowRunStep {
    const calls = this.calls.get(callKey(state));
    return calls?.length
      ? { ...state, toolCalls: calls.map((tracked) => ({ ...tracked.call })) }
      : { ...state };
  }

  /** The output of the last step that ended with one (its last attempt). */
  lastOutput(): Record<string, unknown> | undefined {
    for (const step of [...this.steps].reverse()) {
      const output = this.states.get(step.id)?.at(-1)?.output;
      if (output) return output;
    }
    return undefined;
  }
}

/** Where a step attempt's tool calls are kept. */
function callKey(state: Pick<WorkflowRunStep, 'id' | 'attempt'>): string {
  return `${state.id}#${state.attempt ?? 1}`;
}

/**
 * The steps of a workflow inside a loop (agents.md 5.11): for each `loop`
 * edge, the steps on the way from its target back to its source, both
 * included: an edge straight to the source, else the `next` edge (so v2's
 * Plan → Clarify branch, looped back by Clarify → Plan, counts). Such a step
 * can run more than once in a run.
 */
export function loopStepIds(
  edges: readonly { from: string; to: string; kind: string }[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const loop of (edges ?? []).filter((edge) => edge.kind === 'loop')) {
    const path = [loop.to];
    let current = loop.to;
    while (current !== loop.from && path.length <= (edges ?? []).length) {
      const next =
        (edges ?? []).find(
          (edge) =>
            edge.from === current &&
            edge.to === loop.from &&
            edge.kind !== 'loop',
        ) ??
        (edges ?? []).find(
          (edge) => edge.from === current && edge.kind === 'next',
        );
      if (!next) break;
      current = next.to;
      path.push(current);
    }
    if (current === loop.from) path.forEach((id) => ids.add(id));
  }
  return ids;
}

/**
 * Feed one event of a run's agent turn to its tracker (api.md 3.1): a `tool`
 * event (`{ name, input? }`, or a bare legacy tool name) starts a call, a
 * `tool-result` (`{ tool, input?, rowCount?, error? }`) ends one. Any other
 * event, and a malformed one, changes nothing.
 */
export function noteToolFrame(
  tracker: RunStepTracker,
  event: { type: string; content?: string },
): void {
  if (event.type !== 'tool' && event.type !== 'tool-result') return;
  const content = event.content;
  if (typeof content !== 'string' || !content) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // A legacy `tool` event carries the bare tool name.
    if (event.type === 'tool') tracker.noteTool(content);
    return;
  }
  const frame = asRecord(parsed);
  if (!frame) return;
  const text = (value: unknown) =>
    typeof value === 'string' ? value : undefined;
  if (event.type === 'tool') {
    const name = text(frame['name']);
    if (name) tracker.noteTool(name, text(frame['input']));
    return;
  }
  const tool = text(frame['tool']);
  if (!tool) return;
  const rowCount = frame['rowCount'];
  tracker.noteToolResult({
    tool,
    input: text(frame['input']),
    ...(typeof rowCount === 'number' ? { rowCount } : {}),
    error: text(frame['error']),
  });
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
