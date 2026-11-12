import {
  BadRequestException,
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
import { runErrorMessage } from '../../mastra/workflows/workflow-run';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
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
} from '../sessions/sessions.service';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import {
  RunStepTracker,
  interruptedRunPatch,
  noteToolFrame,
  runAnswerOf,
  runHostDoc,
  runSummaryOf,
  type WorkflowRun,
  type WorkflowRunDoc,
  type WorkflowRunSummary,
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

/** One event of the run stream (api.md 119): the turn's events, and the run's own. */
export type RunStreamEvent =
  | StreamEvent
  | { type: 'run'; runId: string; workflowId: string }
  | ({ type: 'step' } & WorkflowRun['steps'][number])
  | { type: 'done'; run: WorkflowRun }
  | { type: 'error'; content: string };

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

  constructor(
    private readonly workflows: WorkflowsService,
    private readonly sessions: SessionsService,
    private readonly datasets: DatasetsRepository,
    private readonly mastra: MastraService,
    private readonly repository: WorkflowRunsRepository,
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
    const tracker = new RunStepTracker(
      workflow.steps.map((step) => ({
        id: step.id,
        title: step.title,
        kind: step.kind,
      })),
    );
    const live = (event: RunStreamEvent) => {
      if (!abortSignal?.aborted) emit(event);
    };
    const onStep = (event: Parameters<RunStepTracker['apply']>[0]) => {
      const step = tracker.apply(event);
      if (step) live({ type: 'step', ...step });
    };
    const base = await this.start(prepared);
    live({ type: 'run', runId: base.id, workflowId: workflow.id });
    let ended: WorkflowRunDoc;
    try {
      ended = await this.runAgent(
        prepared,
        prepared.turn,
        base,
        tracker,
        live,
        onStep,
        abortSignal,
      );
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
    } else {
      live({ type: 'done', run });
    }
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
   * Delete a run (api.md 122): its document and, for an agent run, its
   * workspace and memory thread. A running run is refused.
   */
  async delete(id: string): Promise<void> {
    const run = await this.stored(id);
    if (run.status === 'running') {
      throw new BadRequestException('Stop the run before deleting it');
    }
    if (run.question !== undefined) {
      await this.sessions.deleteRunHostResources(`${RUN_HOST_ID_PREFIX}${id}`);
    }
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
    if (run.status === 'running') {
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

  /** Store a run as it starts: `running`, with its input (data-model 3.16). */
  private async start(prepared: PreparedRun): Promise<WorkflowRunDoc> {
    const base: WorkflowRunDoc = {
      id: randomUUID(),
      workflowId: prepared.workflow.id,
      workflowName: prepared.workflow.name,
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
    base: WorkflowRunDoc,
    tracker: RunStepTracker,
    live: (event: RunStreamEvent) => void,
    onStep: (event: Parameters<RunStepTracker['apply']>[0]) => void,
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRunDoc> {
    let status: 'success' | 'failed' | 'stopped' = 'success';
    let error: string | undefined;
    let hostId: string | undefined;
    try {
      const host = await this.sessions.createRunHost({
        runId: base.id,
        workflowId: prepared.workflow.id,
        name: prepared.workflow.name,
        ...(prepared.draft ? { draftAgentId: prepared.draft.agentId } : {}),
        ...(turn.datasets ? { datasets: turn.datasets } : {}),
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
        // The turn's `done` carries the host; the run sends its own. Its
        // tool events are the running agent step's tool calls too.
        (event) => {
          noteToolFrame(tracker, event);
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

  /** Run a clean-up step, logging rather than throwing when it fails. */
  private async quietly(what: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (failure) {
      this.logger.warn(`Could not ${what}: ${runErrorMessage(failure)}`);
    }
  }
}
