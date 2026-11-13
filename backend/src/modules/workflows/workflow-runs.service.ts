import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MastraService } from '../../mastra/mastra.service';
import {
  agentRunTurn,
  agentWorkflowId,
  draftRunInput,
  oneStepWorkflowSteps,
  wrappedAgentMaxSteps,
  type AgentRunTurn,
  type WorkflowInputValues,
} from '../../mastra/workflows/workflow-catalog';
import {
  inputFieldsWithUsage,
  validateWorkflowInput,
  type WorkflowInputError,
} from '../../mastra/workflows/workflow-input';
import { QTI_V2_TURN_WORKFLOW_ID } from '../../mastra/workflows/qti-v2-turn.steps';
import { runErrorMessage } from '../../mastra/workflows/workflow-run';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { clarifyingQuestionText } from '../sessions/turn/turn-workflow';
import type {
  ChatMessage,
  FilePanelItem,
  InteractiveVisualization,
  VisualEvent,
} from '../sessions/entities/session.entity';
import {
  RUN_HOST_ID_PREFIX,
  SessionsService,
  type RunVisualAction,
  type StreamEvent,
  type TurnSuspension,
} from '../sessions/sessions.service';
import { WorkflowNodeChatsRepository } from './repositories/workflow-node-chats.repository';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import { SuspendedRuns } from './suspended-runs';
import {
  RUN_EXPIRED_ERROR,
  RunStepTracker,
  expiredRunPatch,
  interruptedRunPatch,
  loopStepIds,
  noteToolFrame,
  runAnswerOf,
  runHostDoc,
  runSummaryOf,
  type WorkflowRun,
  type WorkflowRunDoc,
  type WorkflowRunSummary,
  type WorkflowRunWaitingFor,
} from './workflow-run-steps';
import { WorkflowsService, type WorkflowDefinition } from './workflows.service';

/** What a visual action on a run answers (api.md 130-134). */
export interface RunVisualResult {
  run: WorkflowRun;
  visualization: InteractiveVisualization;
}

/** The assistant message a visual event is logged as, as a session logs it. */
function visualEventMessage(event: VisualEvent): ChatMessage {
  const verb =
    event.action === 'created'
      ? 'Created'
      : event.action === 'updated'
        ? 'Updated'
        : 'Reverted';
  return {
    role: 'assistant',
    content: `${verb} interactive visual "${event.title}" (v${event.version}).`,
    at: new Date().toISOString(),
    visual: event,
  };
}

/**
 * One event of the run stream (api.md 119, 138): the turn's events, and the
 * run's own; `input-required` when the run waits for the user's answer.
 */
export type RunStreamEvent =
  | StreamEvent
  | { type: 'run'; runId: string; workflowId: string }
  | ({ type: 'step' } & WorkflowRun['steps'][number])
  | ({ type: 'input-required'; runId: string } & Pick<
      WorkflowRunWaitingFor,
      'stepId' | 'title' | 'question' | 'options' | 'expiresAt'
    >)
  | { type: 'done'; run: WorkflowRun }
  | { type: 'error'; content: string };

/** A run event sink that sends nothing once the request was stopped. */
function liveEmit(
  emit: (event: RunStreamEvent) => void,
  abortSignal?: AbortSignal,
): (event: RunStreamEvent) => void {
  return (event) => {
    if (!abortSignal?.aborted) emit(event);
  };
}

/** Where a run's turn reports, for one request (its start or a resume). */
interface TurnIo {
  emit: (event: StreamEvent) => void;
  onStepEvent: (event: Parameters<RunStepTracker['apply']>[0]) => void;
}

/**
 * A run between its requests (ADR-0043): what it was prepared from, its
 * stored start, its step tracker and, once created, its host; while it
 * waits for the user, the turn's suspension that resumes it.
 */
interface HeldRun {
  prepared: PreparedRun;
  base: WorkflowRunDoc;
  tracker: RunStepTracker;
  hostId?: string;
  suspension?: TurnSuspension;
}

/** A resume request that passed every check (api.md 138). */
export interface PreparedResume {
  held: HeldRun;
  answer: string;
}

/** A run whose request passed every check, ready to start (api.md 119). */
export interface PreparedRun {
  workflow: WorkflowDefinition;
  values: WorkflowInputValues;
  /** The agent turn the input asks for. */
  turn: AgentRunTurn;
  /** The earlier run given as context (plan 5.4). */
  context?: {
    fromRunId: string;
    question: string;
    answer: string;
  };
  /**
   * A draft run (api.md R12; agents-evals R60): the user agent whose saved
   * draft the agent turn runs. Nothing about it is stored, and its host and
   * workspace are discarded when it ends.
   */
  draft?: { agentId: string };
}

/**
 * The 400 a refused run request answers (api.md 118, 119; Style B): Nest's
 * error body, `message` the first error's text, and `errors` every one.
 */
export function inputRefusal(
  errors: readonly WorkflowInputError[],
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    message: errors[0]?.message ?? 'Bad Request',
    error: 'Bad Request',
    errors: errors.map((entry) => ({ ...entry })),
  });
}

/** A file a run's route sends as an attachment (api.md 124, 126, 127). */
export interface RunAttachment {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * Runs a workflow once on its typed input and keeps the run (ADR-0041;
 * api.md 118-127; agents.md 5.14; data-model 3.16). A run (of
 * `qti-v2-turn`, the one catalogue workflow, or a user agent's draft) runs
 * one agent turn on a run host, an in-memory session `SessionsService`
 * holds, through today's turn path unchanged, and the host is projected
 * into the run. Every run but a draft's is stored in `workflow_runs` when it
 * starts and updated when it ends; its files stay in its workspace
 * `session-run-<id>` until it is deleted. A stored run of a removed workflow
 * (`agent:*`, `seq-text-demo`, `deep-analysis`) still lists and reads as a
 * plain run; a run request naming its workflow is refused as not found.
 * `SessionsService` never depends on this service (that would be a module
 * cycle).
 */
@Injectable()
export class WorkflowRunsService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowRunsService.name);
  /** The runs waiting for the user's answer (api.md 138, ADR-0043). */
  private readonly waiting = new SuspendedRuns<HeldRun>((id, held) =>
    this.expire(id, held).catch((failure) =>
      this.logger.warn(
        `Could not expire run ${id}: ${runErrorMessage(failure)}`,
      ),
    ),
  );

  constructor(
    private readonly workflows: WorkflowsService,
    private readonly sessions: SessionsService,
    private readonly datasets: DatasetsRepository,
    private readonly mastra: MastraService,
    private readonly repository: WorkflowRunsRepository,
    private readonly nodeChats: WorkflowNodeChatsRepository,
  ) {}

  /**
   * Start-up recovery (plan 5.1 step 5): a run still `running` was cut off
   * when the app stopped, so it becomes `failed` (its memory thread deleted,
   * its workspace kept); a run workspace no stored run owns is deleted with
   * its memory thread.
   */
  async onModuleInit(): Promise<void> {
    const now = new Date().toISOString();
    for (const run of await this.repository.listRunning()) {
      await this.repository.update(run.id, interruptedRunPatch(run, now));
      await this.quietly(`delete the memory thread of run ${run.id}`, () =>
        this.mastra.deleteMemoryThread(`${RUN_HOST_ID_PREFIX}${run.id}`),
      );
    }
    // A run that waited for an answer when the app stopped can't go on: its
    // turn lived in memory (ADR-0043). It is stopped, `waitingFor` expired,
    // and the workflow's leftover snapshots are deleted.
    for (const run of await this.repository.listSuspended()) {
      await this.repository.update(run.id, expiredRunPatch(run, now));
      await this.quietly(`delete the memory thread of run ${run.id}`, () =>
        this.mastra.deleteMemoryThread(`${RUN_HOST_ID_PREFIX}${run.id}`),
      );
    }
    await this.quietly('delete the snapshots of suspended runs', async () => {
      await this.mastra.discardSuspendedWorkflowRuns(QTI_V2_TURN_WORKFLOW_ID);
    });
    let hostIds: string[];
    try {
      hostIds = this.sessions.runHostWorkspaceIds();
    } catch {
      return;
    }
    for (const hostId of hostIds) {
      const runId = hostId.slice(RUN_HOST_ID_PREFIX.length);
      if (await this.repository.get(runId)) continue;
      await this.quietly(`delete the orphan workspace ${hostId}`, () =>
        this.sessions.deleteRunHostResources(hostId),
      );
    }
  }

  /**
   * Check a run request as a whole before anything runs (api.md 118, 119
   * refusals, Style B): 404 for a workflow `GET /workflows` does not list;
   * 400 for a workflow without input fields, and for a request its input
   * node refuses: every field error in field order (`validateWorkflowInput`,
   * a whitespace-only text missing), then a `context.fromRunId` naming no
   * stored run with an answer. The 400 carries them all as `errors` and the
   * first one's text as `message`. Nothing is stored before it passes.
   */
  async prepare(id: string, body: unknown): Promise<PreparedRun> {
    const workflow = await this.workflows.definition(id);
    if (!workflow.input.length) {
      throw inputRefusal([
        { field: null, message: `Workflow "${id}" can't run on an input` },
      ]);
    }
    const request =
      body && typeof body === 'object'
        ? (body as { input?: unknown; context?: unknown })
        : {};
    const needsDatasets = workflow.input.some(
      (field) => field.type === 'dataset' || field.type === 'datasets',
    );
    const checked = validateWorkflowInput(workflow, request.input, {
      datasets: needsDatasets ? await this.datasets.list() : [],
    });
    const errors: WorkflowInputError[] = checked.ok ? [] : checked.errors;
    let context: PreparedRun['context'];
    try {
      context = await this.contextOf(request.context);
    } catch (refusal) {
      if (!(refusal instanceof BadRequestException)) throw refusal;
      errors.push({ field: null, message: refusal.message });
    }
    if (!checked.ok || errors.length) throw inputRefusal(errors);
    const turn = agentRunTurn(checked.input);
    if (!turn.question) {
      // A workflow whose input gives no question can't run an agent turn.
      throw inputRefusal([{ field: null, message: 'Question is required' }]);
    }
    return {
      workflow,
      values: checked.input,
      turn,
      ...(context ? { context } : {}),
    };
  }

  /**
   * Check a draft run request before anything runs (api.md R12): 404 for an
   * unknown agent, 400 `Select at least one dataset to preview` when none of
   * the draft's datasets exists, and `Question is required` for a blank
   * question. It runs the agent's draft on the agent-turn engine
   * (`agent:<id>`, never a catalogue workflow), with the draft's name.
   */
  async prepareDraft(agentId: string, body: unknown): Promise<PreparedRun> {
    const target = await this.sessions.draftRunTarget(agentId);
    const input =
      body && typeof body === 'object'
        ? (body as { input?: unknown }).input
        : undefined;
    const raw =
      input && typeof input === 'object'
        ? (input as { question?: unknown }).question
        : undefined;
    const question = typeof raw === 'string' ? raw.trim() : '';
    if (!question) throw new BadRequestException('Question is required');
    const steps = oneStepWorkflowSteps({
      key: agentId,
      name: target.name,
      tools: [],
      maxSteps: wrappedAgentMaxSteps(agentId),
    });
    return {
      workflow: {
        id: agentWorkflowId(agentId),
        name: target.name,
        description: '',
        kind: 'agent',
        owner: 'You',
        agents: [{ key: agentId, name: target.name }],
        stepCount: 1,
        bar: 'agent',
        trigger: 'run',
        input: inputFieldsWithUsage({ input: draftRunInput(), steps }),
        datasets: target.datasets,
        missingDatasets: [],
        starterQuestions: [],
        steps,
      },
      values: { question },
      turn: { question, careful: false },
      draft: { agentId },
    };
  }

  /**
   * Run a prepared run and report it on `emit` (api.md 119): `run`, then
   * the `step` events and the agent turn's events as the chat stream sends
   * them, then `done { run }`, or `error { content }` when the agent turn
   * failed. A stopped run (`abortSignal`) sends nothing more.
   * The run is stored before `run` is sent and updated when it ends; a run
   * that throws while ending is stored `failed` and the error rethrown.
   * Answers the run as `GET /workflow-runs/:id` shows it.
   */
  async stream(
    prepared: PreparedRun,
    emit: (event: RunStreamEvent) => void,
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRun> {
    const { workflow } = prepared;
    // Steps inside a loop keep one entry per attempt (api.md 3.6).
    const repeats = loopStepIds(workflow.edges);
    const tracker = new RunStepTracker(
      workflow.steps.map((step) => ({
        id: step.id,
        title: step.title,
        kind: step.kind,
        repeats: repeats.has(step.id),
      })),
    );
    const base = await this.start(prepared);
    const held: HeldRun = { prepared, base, tracker };
    const live = liveEmit(emit, abortSignal);
    live({ type: 'run', runId: base.id, workflowId: workflow.id });
    return this.drive(held, live, abortSignal, async (io) => {
      const host = await this.sessions.createRunHost({
        runId: base.id,
        workflowId: workflow.id,
        name: workflow.name,
        ...(prepared.draft ? { draftAgentId: prepared.draft.agentId } : {}),
        ...(prepared.turn.datasets ? { datasets: prepared.turn.datasets } : {}),
        ...(prepared.context
          ? {
              context: {
                question: prepared.context.question,
                answer: prepared.context.answer,
              },
            }
          : {}),
      });
      held.hostId = host.id;
      return this.sessions.streamRunTurn(
        host.id,
        prepared.turn.question,
        io.emit,
        abortSignal,
        prepared.turn.careful,
        io.onStepEvent,
      );
    });
  }

  /**
   * Check a resume request before any SSE frame (api.md 138, Style B): 404
   * `Run "<id>" not found`; 410 when the run waited too long or the app
   * restarted since (the stored run is then `stopped` with `waitingFor`
   * marked `expired`); 409 `Run "<id>" is not waiting for an answer`; 400
   * `Answer is required`; 400 `Step "<stepId>" is not waiting for an
   * answer`. A run that passes is taken out of the waiting runs, so it is
   * resumed once.
   */
  async prepareResume(id: string, body: unknown): Promise<PreparedResume> {
    const run = await this.stored(id);
    if (run.status === 'stopped' && run.waitingFor?.expired) {
      throw new GoneException(RUN_EXPIRED_ERROR);
    }
    if (run.status !== 'suspended' || !run.waitingFor) {
      throw new ConflictException(`Run "${id}" is not waiting for an answer`);
    }
    const request =
      body && typeof body === 'object'
        ? (body as { stepId?: unknown; answer?: unknown })
        : {};
    const answer =
      typeof request.answer === 'string' ? request.answer.trim() : '';
    if (!answer) throw new BadRequestException('Answer is required');
    const stepId = typeof request.stepId === 'string' ? request.stepId : '';
    if (stepId !== run.waitingFor.stepId) {
      throw new BadRequestException(
        `Step "${stepId}" is not waiting for an answer`,
      );
    }
    const taken = this.waiting.take(id);
    if (!taken || taken.expired) {
      await this.expire(id, taken?.value);
      throw new GoneException(RUN_EXPIRED_ERROR);
    }
    return { held: taken.value, answer };
  }

  /**
   * Resume a prepared run with the user's answer and report it on `emit`
   * (api.md 138): `run`, then the same events as 119 for the same run (its
   * steps keep their ids and attempts), ending in `done { run }` (possibly
   * `suspended` again) or `error`.
   */
  async resume(
    prepared: PreparedResume,
    emit: (event: RunStreamEvent) => void,
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRun> {
    const { held, answer } = prepared;
    const { base, prepared: run } = held;
    await this.repository.update(base.id, {
      status: 'running',
      waitingFor: undefined,
    });
    const live = liveEmit(emit, abortSignal);
    live({ type: 'run', runId: base.id, workflowId: run.workflow.id });
    const suspension = held.suspension;
    if (!suspension) throw new Error(`Run "${base.id}" has no turn to resume`);
    return this.drive(held, live, abortSignal, (io) =>
      suspension.resume(answer, {
        emit: io.emit,
        abortSignal,
        onStepEvent: io.onStepEvent,
      }),
    );
  }

  /**
   * Drive a run's turn (its start, or a resume) to its end and report it
   * (api.md 119, 138): a turn that waits for the user leaves the run
   * `suspended`, held for `SUSPENDED_RUN_TTL_MS`, and sends the waiting
   * step's `step`, `input-required` and `done { run }`; any other end is
   * stored as before. A run that throws while ending is stored `failed`
   * and the error rethrown.
   */
  private async drive(
    held: HeldRun,
    live: (event: RunStreamEvent) => void,
    abortSignal: AbortSignal | undefined,
    turn: (io: TurnIo) => Promise<TurnSuspension | undefined>,
  ): Promise<WorkflowRun> {
    const { prepared, base, tracker } = held;
    const onStep = (event: Parameters<RunStepTracker['apply']>[0]) => {
      const step = tracker.apply(event);
      if (step) live({ type: 'step', ...step });
    };
    const io: TurnIo = {
      // The turn's `done` carries the host; the run sends its own. Its tool
      // events are the running agent step's tool calls too.
      emit: (event) => {
        noteToolFrame(tracker, event);
        if (event.type !== 'done') live(event);
      },
      onStepEvent: onStep,
    };
    let ended: WorkflowRunDoc;
    try {
      ended = await this.runAgent(held, live, abortSignal, () => turn(io));
    } catch (failure) {
      if (!prepared.draft) {
        await this.end(base.id, {
          status: 'failed',
          error: runErrorMessage(failure),
          finishedAt: new Date().toISOString(),
        });
      }
      throw failure;
    }
    const { id, ...patch } = ended;
    // A draft run is never stored: the run is the doc it ended with.
    const run: WorkflowRun = prepared.draft
      ? ended
      : await this.wire((await this.end(id, patch)) ?? ended);
    if (run.status === 'failed') {
      live({ type: 'error', content: run.error ?? 'The run failed' });
      return run;
    }
    if (run.status === 'suspended' && run.waitingFor) {
      const { stepId, title, question, options, expiresAt } = run.waitingFor;
      live({
        type: 'input-required',
        runId: run.id,
        stepId,
        title,
        question,
        options,
        expiresAt,
      });
    }
    live({ type: 'done', run });
    return run;
  }

  /**
   * Run a workflow once and answer when it ends (api.md 118): the stored
   * run, as `done.run` of the stream carries it.
   */
  async run(id: string, body: unknown): Promise<WorkflowRun> {
    return this.stream(await this.prepare(id, body), () => undefined);
  }

  /**
   * The run history (api.md 120): every stored run, or one workflow's,
   * newest first, as summaries titled from the question or the workflow's
   * first text input (plan 5.3).
   */
  async list(workflowId?: string): Promise<WorkflowRunSummary[]> {
    const [runs, catalogue] = await Promise.all([
      this.repository.list(workflowId),
      this.workflows.list(),
    ]);
    const textFields = new Map(
      catalogue.map((workflow) => [
        workflow.id,
        workflow.input
          .filter(
            (field) =>
              (field.type === 'text' || field.type === 'textarea') &&
              !field.hidden,
          )
          .map((field) => field.name),
      ]),
    );
    // A run of a workflow the catalogue no longer holds (`seq-text-demo`,
    // `deep-analysis`, `agent:*`) is titled from its stored text inputs.
    return runs.map((run) =>
      runSummaryOf(
        run,
        textFields.get(run.workflowId) ??
          Object.keys(run.input).filter(
            (name) => typeof run.input[name] === 'string',
          ),
      ),
    );
  }

  /** One stored run with its derived views (api.md 121), or 404. */
  async get(id: string): Promise<WorkflowRun> {
    return this.wire(await this.stored(id));
  }

  /**
   * Rate the run's answer (api.md 128; verified-queries R1-R7): the stored
   * answer takes the rating and the `verified` mark, and a thumbs-up saves
   * the question and SQL as a verified query keyed by the run. 404 when the
   * run has no answer.
   */
  async rateAnswer(id: string, rating?: string): Promise<WorkflowRun> {
    const run = await this.stored(id);
    if (!run.answer) throw new NotFoundException(`Run "${id}" has no answer`);
    const answer = await this.sessions.rateRunAnswer(
      id,
      runHostDoc(run),
      run.answer.at,
      rating as 'up' | 'down',
    );
    const updated = await this.repository.update(id, { answer });
    return this.wire(updated ?? { ...run, answer });
  }

  /**
   * Delete a run (api.md 122): its document, its node chats (data-model
   * 3.17) and, for an agent run, its workspace and memory thread. A running
   * run is refused.
   */
  async delete(id: string): Promise<void> {
    const run = await this.stored(id);
    if (run.status === 'running') {
      throw new BadRequestException('Stop the run before deleting it');
    }
    // A run waiting for an answer is dropped with its turn and host.
    const held = this.waiting.remove(id);
    if (held) await this.expire(id, held);
    if (run.question !== undefined) {
      await this.sessions.deleteRunHostResources(`${RUN_HOST_ID_PREFIX}${id}`);
    }
    await this.nodeChats.deleteByRun(id);
    await this.repository.delete(id);
  }

  /** A run's visual (api.md 123), as a session's (9). */
  async getVisualization(
    id: string,
    visualizationId: string,
    version?: number,
  ): Promise<InteractiveVisualization> {
    return this.sessions.getVisualizationOf(
      await this.host(id),
      visualizationId,
      version,
    );
  }

  /** A run's visual as a zip (api.md 124), as a session's (14). */
  async downloadVisualization(
    id: string,
    visualizationId: string,
    version?: number,
  ): Promise<{ filename: string; archive: Buffer }> {
    return this.sessions.downloadVisualizationOf(
      await this.host(id),
      visualizationId,
      version,
    );
  }

  /** Create a visual from the run's answer (api.md 130), as a session's (8). */
  generateVisualization(
    id: string,
    sourceMessageAt?: string,
  ): Promise<RunVisualResult> {
    return this.visualAction(id, (run) => ({
      kind: 'create',
      sourceMessageAt: sourceMessageAt || run.answer?.at,
    }));
  }

  /** Tailor a run's visual from an instruction (api.md 131), as 10. */
  tailorVisualization(
    id: string,
    visualizationId: string,
    instruction: string,
  ): Promise<RunVisualResult> {
    return this.visualAction(id, () => ({
      kind: 'tailor',
      visualId: visualizationId,
      instruction,
    }));
  }

  /** Move a run's visual to an earlier version (api.md 132), as 11. */
  revertVisualization(
    id: string,
    visualizationId: string,
    version: number,
  ): Promise<RunVisualResult> {
    return this.visualAction(id, () => ({
      kind: 'revert',
      visualId: visualizationId,
      version,
    }));
  }

  /** Re-run the SQL behind a run's visual (api.md 133), as 12. */
  refreshVisualization(
    id: string,
    visualizationId: string,
  ): Promise<RunVisualResult> {
    return this.visualAction(id, () => ({
      kind: 'refresh',
      visualId: visualizationId,
    }));
  }

  /** Repair a run's failing visual once (api.md 134), as 13. */
  repairVisualization(
    id: string,
    visualizationId: string,
    error: string,
    version: number,
  ): Promise<RunVisualResult> {
    return this.visualAction(id, () => ({
      kind: 'repair',
      visualId: visualizationId,
      error,
      version,
    }));
  }

  /**
   * One visual action on a finished agent run (api.md 130-134): the sessions
   * service does the work on the run-backed host; the new metadata, the
   * visual's panel item and, for create, tailor and revert, the event card
   * are stored on the run, so a later read of it shows them.
   */
  private async visualAction(
    id: string,
    action: (run: WorkflowRunDoc) => RunVisualAction,
  ): Promise<RunVisualResult> {
    const run = await this.stored(id);
    if (run.question === undefined) {
      throw new BadRequestException(`Run "${id}" has no answer to visualize`);
    }
    if (run.status === 'running' || run.status === 'suspended') {
      throw new BadRequestException('Wait for the run to finish');
    }
    const outcome = await this.sessions.runVisualAction(
      runHostDoc(run),
      action(run),
    );
    const fresh = await this.stored(id);
    const { metadata } = outcome;
    const patch: Partial<WorkflowRunDoc> = {
      visualizations: [
        ...(fresh.visualizations ?? []).filter((v) => v.id !== metadata.id),
        metadata,
      ],
      panelItems: outcome.panelItems,
      ...(outcome.event
        ? {
            events: [
              ...(fresh.events ?? []),
              visualEventMessage(outcome.event),
            ],
          }
        : {}),
    };
    const updated = (await this.repository.update(id, patch)) ?? {
      ...fresh,
      ...patch,
    };
    return {
      run: await this.wire(updated),
      visualization: await this.sessions.getVisualizationOf(
        runHostDoc(updated),
        metadata.id,
        outcome.version,
      ),
    };
  }

  /** A run's file item's text (api.md 125), as a session's (106). */
  async panelItemFile(
    id: string,
    itemId: string,
  ): Promise<{ item: FilePanelItem; contentType: string; text: string }> {
    return this.sessions.panelItemFileOf(await this.host(id), itemId);
  }

  /** A run's panel item as an attachment (api.md 126), as a session's (107). */
  async downloadPanelItem(
    id: string,
    itemId: string,
    format?: 'pdf' | 'md' | 'csv',
  ): Promise<RunAttachment> {
    return this.sessions.downloadPanelItemOf(
      await this.host(id),
      itemId,
      format,
    );
  }

  /** A stored run, or 404 `Run "<id>" not found` (Style B). */
  private async stored(id: string): Promise<WorkflowRunDoc> {
    const run = await this.repository.get(id);
    if (!run) throw new NotFoundException(`Run "${id}" not found`);
    return run;
  }

  /** A stored run's run-backed host (plan 5.2), or 404. */
  private async host(id: string) {
    return runHostDoc(await this.stored(id));
  }

  /**
   * A stored run as the API shows it (api.md 121): the document plus, for
   * an agent run, the derived `panelItems`, `workflow` view and `agent`,
   * computed on its run-backed host as a session's are (2.1).
   */
  private async wire(stored: WorkflowRunDoc): Promise<WorkflowRun> {
    // A run of the removed RFP Builder may still carry its `rfpId`: dropped.
    const run: WorkflowRunDoc & { rfpId?: unknown } = { ...stored };
    delete run.rfpId;
    if (run.question === undefined) return run;
    const view = await this.sessions.toView(runHostDoc(run));
    return {
      ...run,
      panelItems: view.panelItems,
      ...(view.workflow ? { workflow: view.workflow } : {}),
      ...(view.agent ? { agent: view.agent } : {}),
    };
  }

  /**
   * Store a run as it starts: `running`, with its input and the workflow's
   * contract hash at that moment (data-model 3.16).
   */
  private async start(prepared: PreparedRun): Promise<WorkflowRunDoc> {
    const base: WorkflowRunDoc = {
      id: randomUUID(),
      workflowId: prepared.workflow.id,
      workflowName: prepared.workflow.name,
      ...(prepared.workflow.contractHash
        ? { contractHash: prepared.workflow.contractHash }
        : {}),
      input: prepared.values,
      ...(prepared.context
        ? { context: { fromRunId: prepared.context.fromRunId } }
        : {}),
      status: 'running',
      steps: [],
      datasets: [],
      startedAt: new Date().toISOString(),
    };
    if (!prepared.draft) await this.repository.insert(base);
    return base;
  }

  /** Store how a run ended. */
  private end(
    id: string,
    patch: Partial<WorkflowRunDoc>,
  ): Promise<WorkflowRunDoc | null> {
    return this.repository.update(id, patch);
  }

  /** The earlier run a request names as context (plan 5.4). */
  private async contextOf(raw: unknown): Promise<PreparedRun['context']> {
    const fromRunId =
      raw && typeof raw === 'object'
        ? (raw as { fromRunId?: unknown }).fromRunId
        : undefined;
    if (fromRunId === undefined || fromRunId === null || fromRunId === '') {
      return undefined;
    }
    const earlier =
      typeof fromRunId === 'string'
        ? await this.repository.get(fromRunId)
        : null;
    if (!earlier) {
      const named =
        typeof fromRunId === 'string' ? fromRunId : JSON.stringify(fromRunId);
      throw new BadRequestException(`Run "${named}" not found`);
    }
    // A run that waited for an answer it can no longer take ("Run again
    // with my answer", api.md 138 410): its question and the clarifying
    // question it asked are the context, so the new run's question (the
    // user's answer) is planned with the original question.
    if (earlier.question && !earlier.answer && earlier.waitingFor) {
      return {
        fromRunId: earlier.id,
        question: earlier.question,
        answer: clarifyingQuestionText(earlier.waitingFor),
      };
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
    held: HeldRun,
    live: (event: RunStreamEvent) => void,
    abortSignal: AbortSignal | undefined,
    runTurn: () => Promise<TurnSuspension | undefined>,
  ): Promise<WorkflowRunDoc> {
    const { prepared, base, tracker } = held;
    const turn = prepared.turn;
    let status: 'success' | 'failed' | 'stopped' = 'success';
    let error: string | undefined;
    let suspension: TurnSuspension | undefined;
    try {
      suspension = await runTurn();
    } catch (failure) {
      if (!abortSignal?.aborted) {
        status = 'failed';
        error = runErrorMessage(failure);
      }
    }
    if (abortSignal?.aborted) status = 'stopped';
    const hostId = held.hostId;
    if (suspension && status === 'success' && hostId && !prepared.draft) {
      return this.suspend(held, hostId, suspension);
    }
    // A suspension the run does not keep (a stop, a draft) is dropped.
    if (suspension) {
      await this.quietly(`discard the waiting turn of run ${base.id}`, () =>
        suspension.discard(),
      );
    }
    held.suspension = undefined;
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
    // A draft run keeps nothing: its workspace goes with its host.
    if (prepared.draft) {
      await this.quietly(`delete the workspace of draft run ${base.id}`, () =>
        this.sessions.deleteRunHostResources(hostId),
      );
    }
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
      panelItems: view.panelItems,
      visualizations: view.visualizations ?? [],
      ...(view.workflowState ? { workflowState: view.workflowState } : {}),
      finishedAt,
    };
  }

  /**
   * A run whose turn waits for the user (api.md 138, ADR-0043): it is held
   * in memory (its suspension, host and tracker) until it is resumed or
   * expires, and stored `suspended` with `waitingFor` and the steps that
   * ran so far; its host stays in memory.
   */
  private async suspend(
    held: HeldRun,
    hostId: string,
    suspension: TurnSuspension,
  ): Promise<WorkflowRunDoc> {
    const { prepared, base, tracker } = held;
    held.suspension = suspension;
    const since = new Date();
    const expiresAt = this.waiting.add(base.id, held);
    const view = await this.sessions.runHostView(hostId);
    const step = prepared.workflow.steps.find(
      (candidate) => candidate.id === suspension.stepId,
    );
    return {
      ...base,
      status: 'suspended',
      steps: tracker.pause(),
      waitingFor: {
        stepId: suspension.stepId,
        title: step?.title ?? suspension.stepId,
        question: suspension.question,
        options: suspension.options,
        since: since.toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      },
      question: prepared.turn.question,
      datasets: view.datasets,
      ...(view.agentKey ? { agentKey: view.agentKey } : {}),
      ...(view.agentId ? { agentId: view.agentId } : {}),
      ...(view.agentName ? { agentName: view.agentName } : {}),
      ...(view.workflowState ? { workflowState: view.workflowState } : {}),
    };
  }

  /**
   * A waiting run that can no longer be resumed (ADR-0043: it expired, or
   * it is no longer held): its turn is dropped (the workflow snapshot
   * deleted), its host leaves memory, and the stored run, if still
   * `suspended`, becomes `stopped` with `waitingFor.expired`.
   */
  private async expire(id: string, held?: HeldRun): Promise<void> {
    const suspension = held?.suspension;
    if (suspension) {
      await this.quietly(`discard the waiting turn of run ${id}`, () =>
        suspension.discard(),
      );
    }
    const hostId = held?.hostId;
    if (hostId) {
      await this.quietly(`end the host of run ${id}`, async () => {
        await this.sessions.finishRunHost(hostId);
      });
    }
    const stored = await this.repository.get(id);
    if (stored?.status === 'suspended') {
      await this.repository.update(
        id,
        expiredRunPatch(stored, new Date().toISOString()),
      );
    }
  }

  /** Run a clean-up step, logging rather than throwing when it fails. */
  private async quietly(what: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (failure) {
      this.logger.warn(`Could not ${what}: ${runErrorMessage(failure)}`);
    }
  }
}
