import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MastraService } from '../../mastra/mastra.service';
import {
  agentRunTurn,
  parseWorkflowInput,
  type AgentRunTurn,
  type WorkflowInputValues,
} from '../../mastra/workflows/workflow-catalog';
import {
  runErrorMessage,
  type WorkflowRunResult,
} from '../../mastra/workflows/workflow-run';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import {
  RUN_HOST_ID_PREFIX,
  SessionsService,
  type StreamEvent,
} from '../sessions/sessions.service';
import {
  RunStepTracker,
  runAnswerOf,
  type WorkflowRun,
} from './workflow-run-steps';
import { WorkflowsService, type WorkflowDetail } from './workflows.service';

/** One event of the run stream (api.md 119): the turn's events, and the run's own. */
export type RunStreamEvent =
  | StreamEvent
  | { type: 'run'; runId: string; workflowId: string }
  | ({ type: 'step' } & WorkflowRun['steps'][number])
  | { type: 'done'; run: WorkflowRun }
  | { type: 'error'; content: string };

/** A run whose request passed every check, ready to start (api.md 119). */
export interface PreparedRun {
  workflow: WorkflowDetail;
  values: WorkflowInputValues;
  /** Agent workflows: the agent turn the input asks for. */
  turn?: AgentRunTurn;
  /** The earlier run given as context (plan 5.4). */
  context?: { fromRunId: string; question: string; answer: string };
}

/**
 * How many runs are held in memory until stored runs arrive (1.23.14): the
 * oldest beyond it is forgotten, and its run workspace deleted.
 */
export const HELD_RUNS = 50;

/**
 * Runs a workflow once on its typed input (ADR-0041; api.md 118, 119;
 * agents.md 5.14). A code-only workflow runs its registered engine
 * workflow. An agent workflow runs one agent turn on a run host, an
 * in-memory session `SessionsService` holds, through today's turn path
 * unchanged, and the host is projected into the run. Runs are held in memory
 * in this version (the last `HELD_RUNS`), so a later run can take one as
 * context; they are stored from 1.23.14. `SessionsService` never depends on
 * this service (that would be a module cycle).
 */
@Injectable()
export class WorkflowRunsService {
  private readonly logger = new Logger(WorkflowRunsService.name);
  private readonly runs = new Map<string, WorkflowRun>();

  constructor(
    private readonly workflows: WorkflowsService,
    private readonly sessions: SessionsService,
    private readonly datasets: DatasetsRepository,
    private readonly mastra: MastraService,
  ) {}

  /**
   * Check a run request before anything runs (api.md 119 refusals, Style B):
   * 404 for a workflow `GET /workflows` does not list; 400 for a workflow
   * without input fields, for its run requirement, for an input its fields
   * refuse (plan 4.1), for an agent run whose question is blank, and for a
   * `context.fromRunId` naming no held run with an answer.
   */
  async prepare(id: string, body: unknown): Promise<PreparedRun> {
    const workflow = await this.workflows.get(id);
    if (!workflow.input.length) {
      throw new BadRequestException(`Workflow "${id}" can't run on an input`);
    }
    if (workflow.runRequirement) {
      throw new BadRequestException(workflow.runRequirement);
    }
    const request =
      body && typeof body === 'object'
        ? (body as { input?: unknown; context?: unknown })
        : {};
    const needsDatasets = workflow.input.some(
      (field) => field.type === 'dataset' || field.type === 'datasets',
    );
    const parsed = parseWorkflowInput(
      workflow.input,
      request.input,
      needsDatasets ? await this.datasets.list() : [],
    );
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    if (!workflow.agents.length) {
      return { workflow, values: parsed.values };
    }
    const turn = agentRunTurn(parsed.values);
    if (!turn.question) {
      const field = workflow.input.find(
        (candidate) =>
          candidate.name === 'question' || candidate.name === 'message',
      );
      throw new BadRequestException(
        `${field?.label ?? 'Question'} is required`,
      );
    }
    const context = this.contextOf(request.context);
    return {
      workflow,
      values: parsed.values,
      turn,
      ...(context ? { context } : {}),
    };
  }

  /**
   * Run a prepared run and report it on `emit` (api.md 119): `run`, then
   * the `step` events and, for an agent workflow, its turn's events as the
   * chat stream sends them, then `done { run }`, or `error { content }` when
   * the agent turn failed. A stopped run (`abortSignal`) sends nothing more.
   * Answers the run, which is held in memory.
   */
  async stream(
    prepared: PreparedRun,
    emit: (event: RunStreamEvent) => void,
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRun> {
    const { workflow } = prepared;
    const runId = randomUUID();
    const tracker = new RunStepTracker(
      workflow.steps.map((step) => ({ id: step.id, title: step.title })),
    );
    const live = (event: RunStreamEvent) => {
      if (!abortSignal?.aborted) emit(event);
    };
    const onStep = (event: Parameters<RunStepTracker['apply']>[0]) => {
      const step = tracker.apply(event);
      if (step) live({ type: 'step', ...step });
    };
    const base: WorkflowRun = {
      id: runId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      input: prepared.values,
      ...(prepared.context
        ? { context: { fromRunId: prepared.context.fromRunId } }
        : {}),
      status: 'running',
      steps: [],
      datasets: [],
      startedAt: new Date().toISOString(),
    };
    live({ type: 'run', runId, workflowId: workflow.id });
    const run = prepared.turn
      ? await this.runAgent(
          prepared,
          prepared.turn,
          base,
          tracker,
          live,
          onStep,
          abortSignal,
        )
      : await this.runCode(prepared, base, tracker, live, onStep);
    this.hold(run);
    if (run.status === 'failed' && prepared.turn) {
      live({ type: 'error', content: run.error ?? 'The run failed' });
    } else {
      live({ type: 'done', run });
    }
    return run;
  }

  /**
   * Run a workflow once and answer when it ends (api.md 118): a code-only
   * workflow's `WorkflowRunResult`, as before; an agent workflow's run, as
   * `done.run` of the stream carries it.
   */
  async run(
    id: string,
    body: unknown,
  ): Promise<WorkflowRunResult | WorkflowRun> {
    const prepared = await this.prepare(id, body);
    if (!prepared.turn) {
      return this.mastra.runWorkflow(id, prepared.values);
    }
    return this.stream(prepared, () => undefined);
  }

  /** A held run, or undefined (the context of a later run). */
  held(runId: string): WorkflowRun | undefined {
    const run = this.runs.get(runId);
    return run ? { ...run } : undefined;
  }

  /** The earlier run a request names as context (plan 5.4). */
  private contextOf(raw: unknown): PreparedRun['context'] {
    const fromRunId =
      raw && typeof raw === 'object'
        ? (raw as { fromRunId?: unknown }).fromRunId
        : undefined;
    if (fromRunId === undefined || fromRunId === null || fromRunId === '') {
      return undefined;
    }
    const earlier =
      typeof fromRunId === 'string' ? this.runs.get(fromRunId) : undefined;
    if (!earlier) {
      const named =
        typeof fromRunId === 'string' ? fromRunId : JSON.stringify(fromRunId);
      throw new BadRequestException(`Run "${named}" not found`);
    }
    if (!earlier.question || !earlier.answer?.content) {
      throw new BadRequestException(
        `Run "${earlier.id}" has no answer to continue from`,
      );
    }
    return {
      fromRunId: earlier.id,
      question: earlier.question,
      answer: earlier.answer.content,
    };
  }

  /**
   * An agent workflow's run (agents.md 5.14): a run host, its one turn
   * through today's turn path with every step event reported, then the host
   * projected into the run and discarded (its memory thread deleted; its
   * workspace kept for the run).
   */
  private async runAgent(
    prepared: PreparedRun,
    turn: AgentRunTurn,
    base: WorkflowRun,
    tracker: RunStepTracker,
    live: (event: RunStreamEvent) => void,
    onStep: (event: Parameters<RunStepTracker['apply']>[0]) => void,
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRun> {
    let status: 'success' | 'failed' | 'stopped' = 'success';
    let error: string | undefined;
    let hostId: string | undefined;
    try {
      const host = await this.sessions.createRunHost({
        runId: base.id,
        workflowId: prepared.workflow.id,
        name: prepared.workflow.name,
        ...(turn.datasets ? { datasets: turn.datasets } : {}),
        ...(turn.rfpId ? { rfpId: turn.rfpId } : {}),
        ...(prepared.context
          ? {
              context: {
                question: prepared.context.question,
                answer: prepared.context.answer,
              },
            }
          : {}),
      });
      hostId = host.id;
      await this.sessions.streamRunTurn(
        host.id,
        turn.question,
        // The turn's `done` carries the host; the run sends its own.
        (event) => {
          if (event.type !== 'done') live(event);
        },
        abortSignal,
        turn.careful,
        onStep,
      );
    } catch (failure) {
      if (!abortSignal?.aborted) {
        status = 'failed';
        error = runErrorMessage(failure);
      }
    }
    if (abortSignal?.aborted) status = 'stopped';
    const ended = tracker.finish(status, error);
    for (const step of ended.changed) live({ type: 'step', ...step });
    const finishedAt = new Date().toISOString();
    if (!hostId) {
      return {
        ...base,
        status,
        steps: ended.steps,
        ...(error ? { error } : {}),
        question: turn.question,
        finishedAt,
      };
    }
    const view = await this.sessions.finishRunHost(hostId);
    const answer = runAnswerOf(view.messages, prepared.context ? 2 : 0);
    const output = status === 'success' ? tracker.lastOutput() : undefined;
    return {
      ...base,
      status,
      steps: ended.steps,
      ...(output ? { output } : {}),
      ...(error ? { error } : {}),
      ...(answer ? { answer } : {}),
      question: turn.question,
      datasets: view.datasets,
      ...(view.agentKey ? { agentKey: view.agentKey } : {}),
      ...(view.agentId ? { agentId: view.agentId } : {}),
      ...(view.agentName ? { agentName: view.agentName } : {}),
      ...(view.agent ? { agent: view.agent } : {}),
      ...(view.rfpId ? { rfpId: view.rfpId } : {}),
      panelItems: view.panelItems,
      visualizations: view.visualizations ?? [],
      ...(view.workflowState ? { workflowState: view.workflowState } : {}),
      ...(view.workflow ? { workflow: view.workflow } : {}),
      finishedAt,
    };
  }

  /** A code-only workflow's run: its engine run, streamed step by step. */
  private async runCode(
    prepared: PreparedRun,
    base: WorkflowRun,
    tracker: RunStepTracker,
    live: (event: RunStreamEvent) => void,
    onStep: (event: Parameters<RunStepTracker['apply']>[0]) => void,
  ): Promise<WorkflowRun> {
    let status: 'success' | 'failed' = 'success';
    let error: string | undefined;
    let output: Record<string, unknown> | undefined;
    try {
      const engine = await this.mastra.streamWorkflow(
        prepared.workflow.id,
        prepared.values,
      );
      for await (const event of engine.fullStream) onStep(event);
      const result = await engine.result;
      if (result.status === 'success') {
        const value = result.result;
        output =
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : undefined;
      } else {
        status = 'failed';
        error =
          result.error === undefined
            ? `The run ended as ${result.status}`
            : runErrorMessage(result.error);
      }
    } catch (failure) {
      status = 'failed';
      error = runErrorMessage(failure);
    }
    const ended = tracker.finish(status, error);
    for (const step of ended.changed) live({ type: 'step', ...step });
    const failedStep = ended.steps.find((step) => step.status === 'failed');
    return {
      ...base,
      status,
      steps: ended.steps,
      ...(output ? { output } : {}),
      ...(status === 'failed' ? { error: failedStep?.error ?? error } : {}),
      finishedAt: new Date().toISOString(),
    };
  }

  /** Hold a run; forget the oldest beyond `HELD_RUNS`, with its workspace. */
  private hold(run: WorkflowRun): void {
    this.runs.set(run.id, run);
    while (this.runs.size > HELD_RUNS) {
      const [oldest] = this.runs.keys();
      const forgotten = this.runs.get(oldest);
      this.runs.delete(oldest);
      if (forgotten?.question === undefined) continue;
      this.sessions
        .deleteRunHostResources(`${RUN_HOST_ID_PREFIX}${oldest}`)
        .catch((failure: unknown) =>
          this.logger.warn(
            `Could not delete the workspace of run ${oldest}: ${runErrorMessage(failure)}`,
          ),
        );
    }
  }
}
