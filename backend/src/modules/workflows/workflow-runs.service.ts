import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { RequestContext } from '@mastra/core/request-context';
import { randomUUID } from 'crypto';
import { MastraService } from '../../mastra/mastra.service';
import { DEEP_ANALYSIS_WORKFLOW_ID } from '../../mastra/workflows/deep-analysis.steps';
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
import type {
  FilePanelItem,
  InteractiveVisualization,
  SessionDoc,
  WorkflowState,
} from '../sessions/entities/session.entity';
import {
  RUN_HOST_ID_PREFIX,
  SessionsService,
  type StreamEvent,
} from '../sessions/sessions.service';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import {
  assembledReportOf,
  deepAnalysisContext,
  deepAnalysisRunAnswer,
  deepAnalysisRuntime,
} from './deep-analysis-run';
import {
  RunStepTracker,
  interruptedRunPatch,
  runAnswerOf,
  runHostDoc,
  runOfResult,
  runSummaryOf,
  type WorkflowRun,
  type WorkflowRunDoc,
  type WorkflowRunSummary,
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
  context?: {
    fromRunId: string;
    question: string;
    answer: string;
    /** Its RFP and stage tracker: an RFP Continue starts from them (plan 4.3). */
    rfpId?: string;
    workflowState?: WorkflowState;
  };
}

/** A file a run's route sends as an attachment (api.md 124, 126, 127). */
export interface RunAttachment {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * Runs a workflow once on its typed input and keeps the run (ADR-0041;
 * api.md 118-127; agents.md 5.14; data-model 3.16). A code-only workflow
 * runs its registered engine workflow. An agent workflow runs one agent turn
 * on a run host, an in-memory session `SessionsService` holds, through
 * today's turn path unchanged, and the host is projected into the run.
 * Every run is stored in `workflow_runs` when it starts and updated when it
 * ends; its files stay in its workspace `session-run-<id>` until it is
 * deleted. `SessionsService` never depends on this service (that would be a
 * module cycle).
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
   * Check a run request before anything runs (api.md 119 refusals, Style B):
   * 404 for a workflow `GET /workflows` does not list; 400 for a workflow
   * without input fields, for its run requirement, for an input its fields
   * refuse (plan 4.1), for an agent run whose question is blank, and for a
   * `context.fromRunId` naming no stored run with an answer.
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
    // A code workflow that runs on its input runs its engine workflow even
    // when its steps call an agent (deep analysis, agents.md 5.15); its
    // question is refused when blank, as an agent run's is.
    if (workflow.kind === 'code' && workflow.trigger === 'run') {
      const question = parsed.values['question'];
      if (typeof question === 'string' && !question.trim()) {
        throw new BadRequestException('Question is required');
      }
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
    const context = await this.contextOf(request.context);
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
      workflow.steps.map((step) => ({ id: step.id, title: step.title })),
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
      ended = prepared.turn
        ? await this.runAgent(
            prepared,
            prepared.turn,
            base,
            tracker,
            live,
            onStep,
            abortSignal,
          )
        : workflow.id === DEEP_ANALYSIS_WORKFLOW_ID
          ? await this.runDeepAnalysis(
              prepared,
              base,
              tracker,
              live,
              onStep,
              abortSignal,
            )
          : await this.runCode(prepared, base, tracker, live, onStep);
    } catch (failure) {
      await this.end(base.id, {
        status: 'failed',
        error: runErrorMessage(failure),
        finishedAt: new Date().toISOString(),
      });
      throw failure;
    }
    const { id, ...patch } = ended;
    const run = await this.wire((await this.end(id, patch)) ?? ended);
    if (run.status === 'failed' && prepared.turn) {
      live({ type: 'error', content: run.error ?? 'The run failed' });
    } else {
      live({ type: 'done', run });
    }
    return run;
  }

  /**
   * Run a workflow once and answer when it ends (api.md 118): a code-only
   * workflow's `WorkflowRunResult`, as before, with the stored run's
   * `runId`; an agent workflow's run, as `done.run` of the stream carries it.
   * Either way the run is stored.
   */
  async run(
    id: string,
    body: unknown,
  ): Promise<(WorkflowRunResult & { runId: string }) | WorkflowRun> {
    const prepared = await this.prepare(id, body);
    // A deep analysis needs its run host, which only the streamed path makes.
    if (prepared.turn || prepared.workflow.id === DEEP_ANALYSIS_WORKFLOW_ID) {
      return this.stream(prepared, () => undefined);
    }
    const base = await this.start(prepared);
    let result: WorkflowRunResult;
    try {
      result = await this.mastra.runWorkflow(id, prepared.values);
    } catch (failure) {
      await this.end(base.id, {
        status: 'failed',
        error: runErrorMessage(failure),
        finishedAt: new Date().toISOString(),
      });
      throw failure;
    }
    await this.end(base.id, runOfResult(result, new Date().toISOString()));
    return { ...result, runId: base.id };
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
    return runs.map((run) =>
      runSummaryOf(run, textFields.get(run.workflowId) ?? []),
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

  /** A run's RFP package or one of its files (api.md 127), as a session's (105). */
  async downloadRfpPackage(
    id: string,
    rfpId: string,
    file?: string,
    draft = false,
  ): Promise<RunAttachment> {
    return this.sessions.downloadRfpPackageOf(
      await this.host(id),
      rfpId,
      file,
      draft,
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
  private async wire(run: WorkflowRunDoc): Promise<WorkflowRun> {
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
    await this.repository.insert(base);
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
      ...(earlier.rfpId ? { rfpId: earlier.rfpId } : {}),
      ...(earlier.workflowState
        ? { workflowState: earlier.workflowState }
        : {}),
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
    // An RFP Continue (plan 4.3): the run on the same RFP starts from the
    // stages the earlier run left, so its tracker shows them from the start.
    const stages =
      turn.rfpId &&
      prepared.context?.rfpId === turn.rfpId &&
      prepared.context.workflowState
        ? prepared.context.workflowState
        : undefined;
    try {
      const host = await this.sessions.createRunHost({
        runId: base.id,
        workflowId: prepared.workflow.id,
        name: prepared.workflow.name,
        ...(turn.datasets ? { datasets: turn.datasets } : {}),
        ...(turn.rfpId ? { rfpId: turn.rfpId } : {}),
        ...(stages ? { workflowState: stages } : {}),
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
      ...(view.rfpId ? { rfpId: view.rfpId } : {}),
      panelItems: view.panelItems,
      visualizations: view.visualizations ?? [],
      ...(view.workflowState ? { workflowState: view.workflowState } : {}),
      finishedAt,
    };
  }

  /**
   * A deep analysis's run (agents.md 5.15): a run host over the input's
   * datasets, the engine run with the assistant's calls and the run
   * workspace on its RequestContext, then the host discarded (its workspace
   * kept for the run). A run that stored its report answers with the
   * executive summary and keeps the report as its file.
   */
  private async runDeepAnalysis(
    prepared: PreparedRun,
    base: WorkflowRunDoc,
    tracker: RunStepTracker,
    live: (event: RunStreamEvent) => void,
    onStep: (event: Parameters<RunStepTracker['apply']>[0]) => void,
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRunDoc> {
    const question = String(prepared.values['question'] ?? '');
    const raw = prepared.values['datasets'];
    const datasets = Array.isArray(raw) ? raw : [];
    let host: SessionDoc | undefined;
    let stored: () => number | undefined = () => undefined;
    let ended: WorkflowRunDoc;
    try {
      host = await this.sessions.createRunHost({
        runId: base.id,
        workflowId: prepared.workflow.id,
        name: prepared.workflow.name,
        datasets,
      });
      const made = deepAnalysisRuntime(
        {
          sessions: this.sessions,
          mastra: this.mastra,
          warn: (message) => this.logger.warn(message),
        },
        host,
        base.id,
        abortSignal,
      );
      stored = made.stored;
      ended = await this.runCode(prepared, base, tracker, live, onStep, {
        requestContext: deepAnalysisContext(made.runtime),
        abortSignal,
      });
    } catch (failure) {
      // The run host could not be made: nothing ran.
      const error = runErrorMessage(failure);
      const finished = tracker.finish('failed', error);
      for (const step of finished.changed) live({ type: 'step', ...step });
      ended = {
        ...base,
        status: 'failed',
        steps: finished.steps,
        error,
        finishedAt: new Date().toISOString(),
      };
    }
    if (host) {
      const hostId = host.id;
      await this.quietly(`end the run host of run ${base.id}`, async () => {
        await this.sessions.finishRunHost(hostId);
      });
    }
    const report =
      ended.status === 'success' ? assembledReportOf(ended.output) : undefined;
    const bytes = stored();
    const kept =
      report && bytes !== undefined
        ? deepAnalysisRunAnswer(base.id, report, bytes, ended.finishedAt!)
        : undefined;
    return {
      ...ended,
      question,
      datasets: host?.datasets ?? datasets,
      ...(kept ? kept : {}),
    };
  }

  /**
   * A code workflow's run: its engine run, streamed step by step, with the
   * run's RequestContext when it has one. A run whose `abortSignal` fired is
   * `stopped`.
   */
  private async runCode(
    prepared: PreparedRun,
    base: WorkflowRunDoc,
    tracker: RunStepTracker,
    live: (event: RunStreamEvent) => void,
    onStep: (event: Parameters<RunStepTracker['apply']>[0]) => void,
    engineRun: {
      requestContext?: RequestContext;
      abortSignal?: AbortSignal;
    } = {},
  ): Promise<WorkflowRunDoc> {
    let status: 'success' | 'failed' | 'stopped' = 'success';
    let error: string | undefined;
    let output: Record<string, unknown> | undefined;
    try {
      const engine = await this.mastra.streamWorkflow(
        prepared.workflow.id,
        prepared.values,
        engineRun.requestContext,
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
    if (engineRun.abortSignal?.aborted) {
      status = 'stopped';
      error = undefined;
      output = undefined;
    }
    const ended = tracker.finish(status, error);
    for (const step of ended.changed) live({ type: 'step', ...step });
    const failedStep = ended.steps.find((step) => step.status === 'failed');
    // A stopped run's step was cut off, not failed.
    const steps =
      status === 'stopped'
        ? ended.steps.map((step) =>
            step.status === 'failed'
              ? { id: step.id, title: step.title, status: 'stopped' as const }
              : step,
          )
        : ended.steps;
    return {
      ...base,
      status,
      steps,
      ...(output ? { output } : {}),
      ...(status === 'failed' ? { error: failedStep?.error ?? error } : {}),
      finishedAt: new Date().toISOString(),
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
