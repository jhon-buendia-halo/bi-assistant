import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
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
  revisionImagesOf,
  validateWorkflowInput,
  withStoredImages,
  type InputImageFile,
  type WorkflowInputError,
} from '../../mastra/workflows/workflow-input';
import { REVIEW_WEBSITE_WORKFLOW_ID } from '../../mastra/workflows/review-website.steps';
import { ORCHESTRATED_ANSWER_WORKFLOW_ID } from '../../mastra/workflows/orchestrated-answer.steps';

/** The most turns of a conversation Avery reads (workflows R45). */
export const CONVERSATION_TURNS = 20;
import { runErrorMessage } from '../../mastra/workflows/workflow-run';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { clarifyingQuestionText } from '../sessions/turn/turn-workflow';
import type {
  ChatMessage,
  FilePanelItem,
  InteractiveVisualization,
  SessionVisualization,
  VisualEvent,
} from '../sessions/entities/session.entity';
import type {
  FilterInterpretation,
  PageRequest,
  PageResult,
  ResultView,
} from '../datasources/connectors/paged-sql.types';
import {
  AnswerEvidenceService,
  type AnswerHost,
  type LoadedAnswer,
} from '../sessions/query-evidence/answer-evidence.service';
import type {
  QueryEvidenceService,
  QueryExport,
  QueryRerunResult,
} from '../sessions/query-evidence/query-evidence.service';
import { QUERY_EVIDENCE_SERVICE } from '../sessions/query-evidence/query-evidence.token';
import type { QueryEvidence } from '../sessions/query-evidence/query-evidence.types';
import {
  explorableQueriesOf,
  type ExplorableQuery,
} from '../sessions/query-evidence/explorable-queries';
import {
  RUN_HOST_ID_PREFIX,
  SessionsService,
  type RunVisualAction,
  type StreamEvent,
  type TurnSuspension,
} from '../sessions/sessions.service';
import { WorkflowNodeChatsRepository } from './repositories/workflow-node-chats.repository';
import { nodeChatHostRunId } from './node-chat-context';
import {
  askHostOf,
  askRefusal,
  chartedRunOf,
  type AskHost,
} from './ask-agent-context';
import type { AskableStepId } from '../../mastra/workflows/ask-agent.steps';
import { HeldDraftRuns } from './held-draft-runs';
import {
  IdleWatchdog,
  LiveRuns,
  RUN_IDLE_LIMIT_MS,
  RUN_UNWIND_MS,
  RunCheckpoint,
  runStalledMessage,
  type LiveRunEvent,
} from './live-runs';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import { SuspendedRuns } from './suspended-runs';
import {
  RUN_EXPIRED_ERROR,
  RunStepTracker,
  expiredRunPatch,
  failOpenSteps,
  forcedEndPatch,
  interruptedRunPatch,
  loopStepIds,
  noteToolFrame,
  runAnswerOf,
  runHostDoc,
  runSummaryOf,
  withStepStories,
  type StepTeller,
  type WorkflowRun,
  type WorkflowRunDoc,
  type WorkflowRunStep,
  type WorkflowRunSummary,
  type WorkflowRunWaitingFor,
} from './workflow-run-steps';
import { WorkflowsService, type WorkflowDefinition } from './workflows.service';
import { tellRunStep } from '../../mastra/workflows/workflow-stories';

/**
 * The storyteller of a run's steps (ui.md 4.4b, Logs *Story*): its
 * workflow's, reading the run's input and steps so far.
 */
function runStepTeller(
  workflowId: string,
  runInput: Record<string, unknown>,
): StepTeller {
  return (step, steps, runStatus) =>
    tellRunStep(workflowId, step, { runInput, steps, runStatus });
}

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
 * The event of the visual Build visual stored (agents.md 5.11, workflows
 * R41), logged beside the answer as a visual action is, so the answer keeps
 * its query evidence; none when the step did not run or built nothing.
 */
function builtVisualEvent(
  steps: readonly WorkflowRunStep[],
  visualizations: readonly SessionVisualization[],
): ChatMessage | undefined {
  const built = steps.find((step) => step.id === 'build-visual')?.output?.[
    'visual'
  ] as { visualId?: unknown } | undefined;
  const metadata = visualizations.find((v) => v.id === built?.visualId);
  return metadata
    ? visualEventMessage({
        visualId: metadata.id,
        version: 1,
        title: metadata.title,
        action: 'created',
      })
    : undefined;
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

/**
 * Where a run's turn reports, for one request (its start or a resume), and
 * the signal its work runs on: the caller's (Stop, a closed request) or the
 * no-progress watchdog's, whichever aborts first.
 */
interface TurnIo {
  emit: (event: StreamEvent) => void;
  onStepEvent: (event: Parameters<RunStepTracker['apply']>[0]) => void;
  abortSignal: AbortSignal;
}

/** How a run was stored ended without its work (api.md 150; workflows spec). */
interface ForcedEnd {
  status: 'stopped' | 'failed';
  error?: string;
  finishedAt: string;
}

/**
 * A turn while it is driven (api.md 119, 138, 150): its progress
 * checkpoints, the no-progress error once it stalled, and, once the run was
 * ended without its work, that end, which the late unwind keeps.
 */
interface DrivenTurn {
  checkpoint?: RunCheckpoint<Pick<WorkflowRunDoc, 'steps'>>;
  stalled?: string;
  forced?: ForcedEnd;
  /** The turn's work settled: nothing forces its end any more. */
  settled: boolean;
  /** Ends the drive with the run stored without its work. */
  finish: (run: WorkflowRunDoc) => void;
}

/**
 * A run between its requests (ADR-0043): what it was prepared from, its
 * stored start, its step tracker and, once created, its host; while it
 * waits for the user, the turn's suspension that resumes it; while its turn
 * is driven, that turn.
 */
interface HeldRun {
  prepared: PreparedRun;
  base: WorkflowRunDoc;
  tracker: RunStepTracker;
  hostId?: string;
  suspension?: TurnSuspension;
  driven?: DrivenTurn;
}

/** A resume request that passed every check (api.md 138). */
export interface PreparedResume {
  held: HeldRun;
  answer: string;
  /**
   * Reference images sent with a change on Build visual's approval gate
   * (workflows R44): written to the run's workspace before it resumes.
   */
  images: { path: string; data: Buffer }[];
}

/** A run whose request passed every check, ready to start (api.md 119). */
export interface PreparedRun {
  workflow: WorkflowDefinition;
  values: WorkflowInputValues;
  /** The agent turn the input asks for. */
  turn: AgentRunTurn;
  /**
   * The input's image (agents.md 5.17), taken out of `values`: the run's
   * host stores it in its workspace at `path`, the field's value.
   */
  image?: { path: string; data: Buffer };
  /**
   * Every image file the input carried, in field then list order (the
   * `image` field's and each `images` entry's): the host writes them all.
   */
  images: InputImageFile[];
  /** The earlier run given as context (plan 5.4). */
  context?: {
    fromRunId: string;
    question: string;
    answer: string;
    /**
     * The earlier answer's queries, for `explore_result` (agents.md 3.15;
     * plan m1-27 2); absent when it ran none.
     */
    queries?: ExplorableQuery[];
    /**
     * A follow-up that asks one agent alone (workflows R40; agents.md
     * 5.21): the asked step and how its host is set up.
     */
    ask?: AskHost;
    /**
     * A conversation with Avery (workflows R45): the conversation the new
     * run joins, and its earlier turns in order (at most
     * `CONVERSATION_TURNS`), which Avery reads as the conversation so far.
     */
    conversationId?: string;
    transcript?: { role: 'user' | 'assistant'; content: string }[];
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
 * `answer-business-question`, the one catalogue workflow, or a user agent's draft) runs
 * one agent turn on a run host, an in-memory session `SessionsService`
 * holds, through today's turn path unchanged, and the host is projected
 * into the run. Every run but a draft's is stored in `workflow_runs` when it
 * starts and updated at each step change and when it ends; its files stay in its workspace
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
    // The query inspector's queries (api.md 139-143).
    @Inject(QUERY_EVIDENCE_SERVICE)
    queryEvidence: QueryEvidenceService,
    // The saved dashboards a run's input names.
    private readonly artifacts: ArtifactsService,
    // The query inspector's engine (api.md 139-148), shared with the
    // sessions; built here from the two above when none is given.
    @Optional() answers?: AnswerEvidenceService,
  ) {
    this.answers = answers ?? new AnswerEvidenceService(queryEvidence, mastra);
  }

  /** Its lock per answer and single flight cover 128 and 139-143. */
  private readonly answers: AnswerEvidenceService;

  /**
   * Finished draft runs (Try it), in memory for 30 minutes, 20 at most:
   * only 139-143 reach them (plan section 5).
   */
  readonly drafts = new HeldDraftRuns();

  /**
   * The runs started (119) or resumed (138) detached from their request
   * (ADR-0048): their stop signal and the log of their events, which the
   * request and any later client (149) follow; Stop is 150.
   */
  readonly live = new LiveRuns();

  /**
   * How long a turn may report nothing before it is ended `failed` (the
   * workflows spec's failure rules): `WORKFLOW_RUN_IDLE_MINUTES`, read once;
   * 0 turns the watchdog off.
   */
  idleLimitMs = RUN_IDLE_LIMIT_MS;

  /** The stored runs whose turn is being driven, so Stop can end one (150). */
  private readonly driving = new Map<string, HeldRun>();

  /**
   * Start-up recovery (plan 5.1 step 5): a run still `running` was cut off
   * when the app stopped, so it becomes `failed` (its workspace and memory
   * threads kept, as any finished run's); a run workspace no stored run
   * owns is deleted with its memory threads.
   */
  async onModuleInit(): Promise<void> {
    const now = new Date().toISOString();
    for (const run of await this.repository.listRunning()) {
      await this.repository.update(run.id, interruptedRunPatch(run, now));
    }
    // A run that waited for an answer when the app stopped can't go on: its
    // turn lived in memory (ADR-0043). It is stopped, `waitingFor` expired,
    // and every workflow's leftover snapshots are deleted.
    for (const run of await this.repository.listSuspended()) {
      await this.repository.update(run.id, expiredRunPatch(run, now));
    }
    await this.quietly('delete the snapshots of suspended runs', async () => {
      await this.mastra.discardSuspendedWorkflowRuns();
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
    const checked = validateWorkflowInput(
      workflow,
      await this.withEarlierImages(workflow, request.input, request.context),
      {
        datasets: needsDatasets ? await this.datasets.list() : [],
        artifacts: workflow.input.some((field) => field.type === 'artifact')
          ? await this.artifacts.list()
          : [],
      },
    );
    const errors: WorkflowInputError[] = checked.ok ? [] : checked.errors;
    let context: PreparedRun['context'];
    try {
      context = await this.contextOf(request.context, workflow.id);
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
    // An image never stays in the input: the run stores it as a file.
    const stored = withStoredImages(workflow, checked.input);
    // Recreate dashboard's single image is its `image` field's file.
    const image = stored.images.find((file) => file.field === 'image');
    return {
      workflow,
      values: stored.input,
      turn,
      images: stored.images,
      ...(image ? { image: { path: image.path, data: image.data } } : {}),
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
        agents: [{ key: agentId, name: target.name, role: target.role }],
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
      images: [],
      draft: { agentId },
    };
  }

  /**
   * Run a prepared run and report it on `emit` (api.md 119): `run`, then
   * the `step` events and the agent turn's events as the chat stream sends
   * them, then `done { run }`, or `error { content }` when the agent turn
   * failed. A stopped run (`abortSignal`) sends nothing more.
   * The run is stored before `run` is sent, its steps updated at each step
   * change, and the whole run updated when it ends; a run
   * that throws while ending is stored `failed` and the error rethrown.
   * Answers the run as `GET /workflow-runs/:id` shows it.
   */
  async stream(
    prepared: PreparedRun,
    emit: (event: RunStreamEvent) => void,
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRun> {
    return this.runOpened(await this.open(prepared), emit, abortSignal);
  }

  /**
   * Start a prepared run detached from the request (api.md 119; ADR-0048):
   * stored `running`, then run on the live runs' signal, every event logged
   * there, until it ends or Stop (150) aborts it. Answers its id; the
   * request follows it like any client (149), and closing the connection
   * stops only the following. 429 when `live.cap` runs are running already:
   * the slot is taken before anything awaits, so two starts arriving
   * together for one free slot give one run, and a refused run stores
   * nothing. The slot frees when the run ends, fails, stops or suspends.
   */
  async launch(prepared: PreparedRun): Promise<string> {
    const slot = this.live.reserve();
    if (!slot) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many runs are in progress (${this.live.cap}). Wait for one to finish, or stop one.`,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    let held: HeldRun;
    try {
      held = await this.open(prepared);
    } catch (failure) {
      slot.release();
      throw failure;
    }
    const id = held.base.id;
    const signal = this.live.begin(id, slot);
    this.detach(id, signal, (emit) => this.runOpened(held, emit, signal));
    return id;
  }

  /**
   * Resume a prepared run detached from the request (api.md 138; ADR-0048),
   * as `launch` starts one: its events go to a fresh log of the same run.
   * A resume is never refused for the cap, but holds a slot while it runs.
   */
  resumeDetached(prepared: PreparedResume): string {
    const id = prepared.held.base.id;
    const slot = this.live.claim();
    let signal: AbortSignal;
    try {
      signal = this.live.begin(id, slot);
    } catch (failure) {
      slot.release();
      throw failure;
    }
    this.detach(id, signal, (emit) => this.resume(prepared, emit, signal));
    return id;
  }

  /**
   * Stop a run (api.md 150): a live run is aborted and stored `stopped` with
   * any partial answer, as a closed connection did before ADR-0048; a run
   * waiting for the user is dropped and stored `stopped` as an expired one
   * (138). Idempotent: a run that already ended answers as it is. Answers
   * the stored run; 404 for an unknown one. A live run whose work has not
   * unwound within `RUN_UNWIND_MS` is stored `stopped` here, its running
   * steps stopped, and its log ended with `done { run }`: the answer is
   * never `running`. The late unwind keeps it `stopped` (`drive`).
   */
  async stop(id: string): Promise<WorkflowRun> {
    const run = await this.stored(id);
    if (this.live.stop(id)) {
      await this.settled(this.live.whenEnded(id));
      if ((await this.repository.get(id))?.status === 'running') {
        await this.forceStop(id);
      }
    } else if (run.status === 'suspended') {
      const held = this.waiting.remove(id);
      await this.expire(id, held);
    }
    return this.get(id);
  }

  /**
   * Check that a run's events can be followed (api.md 149) before any SSE
   * frame: 404 `Run "<id>" not found` for no stored run, and 404 `Run
   * "<id>" has no live events` for one the live runs no longer hold (it
   * ended more than 10 minutes ago, or before a restart: read it with 121).
   */
  async checkLive(id: string): Promise<void> {
    if (this.live.has(id)) return;
    await this.stored(id);
    throw new NotFoundException(`Run "${id}" has no live events`);
  }

  /**
   * Run `work` in the background, its events logged for `id`: a throw that
   * is not a stop is sent as `error { content }` (as `streamSse` sends it);
   * a stopped run, which sends nothing more, ends its log with `done { run
   * }` as stored (`stopped`), so a client still following it sees the end.
   * The run's log ends either way.
   */
  private detach(
    id: string,
    signal: AbortSignal,
    work: (emit: (event: RunStreamEvent) => void) => Promise<unknown>,
  ): void {
    const emit = (event: RunStreamEvent) =>
      this.live.publish(id, event as LiveRunEvent);
    const background = async () => {
      try {
        await work(emit);
      } catch (failure) {
        if (!signal.aborted) {
          const message =
            failure instanceof Error ? failure.message : String(failure);
          emit({ type: 'error', content: message });
        }
      }
      if (signal.aborted) {
        try {
          emit({ type: 'done', run: await this.get(id) });
        } catch (failure) {
          this.logger.warn(
            `Could not read stopped run ${id}: ${runErrorMessage(failure)}`,
          );
        }
      }
    };
    void background().finally(() => this.live.end(id));
  }

  /**
   * Store a stopped live run whose work did not unwind (api.md 150): its
   * drive ends with it stored `stopped`, and Stop waits for its log to end.
   * A run not being driven (a resume between its writes) is stored
   * `stopped` from what is stored, and its log ended with `done { run }`.
   */
  private async forceStop(id: string): Promise<void> {
    const held = this.driving.get(id);
    if (held?.driven) {
      await this.forceEnd(held, { status: 'stopped' });
      await this.live.whenEnded(id);
      return;
    }
    const stored = await this.repository.get(id);
    if (!stored) return;
    await this.end(
      id,
      forcedEndPatch(stored.steps, {
        status: 'stopped',
        finishedAt: new Date().toISOString(),
      }),
    );
    this.live.publish(id, { type: 'done', run: await this.get(id) });
    this.live.end(id);
  }

  /**
   * End a driven run without its work (api.md 150; the workflows spec's
   * failure rules): Stop's (`stopped`) or a stalled run's (`failed` with the
   * no-progress error) when the work did not unwind in time. Its
   * checkpoints are closed, the run stored with its steps as last tracked
   * (a draft is not stored), and the drive ends with it. Once only, and
   * never after the work settled.
   */
  private async forceEnd(
    held: HeldRun,
    end: Omit<ForcedEnd, 'finishedAt'>,
  ): Promise<void> {
    const driven = held.driven;
    if (!driven || driven.settled || driven.forced) return;
    const forced: ForcedEnd = { ...end, finishedAt: new Date().toISOString() };
    driven.forced = forced;
    await driven.checkpoint?.close();
    const { base, prepared, tracker } = held;
    const patch = forcedEndPatch(tracker.pause(), forced);
    const doc: WorkflowRunDoc = {
      ...base,
      ...patch,
      question: prepared.turn.question,
    };
    if (prepared.draft) {
      driven.finish(doc);
      return;
    }
    try {
      driven.finish((await this.end(base.id, patch)) ?? doc);
    } catch (failure) {
      this.logger.warn(
        `Could not store the end of run ${base.id}: ${runErrorMessage(failure)}`,
      );
      driven.finish(doc);
    }
  }

  /** Wait for a stopped run to be stored, at most `RUN_UNWIND_MS`. */
  private async settled(ended: Promise<void> | undefined): Promise<void> {
    if (!ended) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, RUN_UNWIND_MS);
      (timer as { unref?: () => void }).unref?.();
    });
    await Promise.race([ended, limit]);
    clearTimeout(timer);
  }

  /** Store a prepared run as it starts, with its step tracker. */
  private async open(prepared: PreparedRun): Promise<HeldRun> {
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
      undefined,
      runStepTeller(workflow.id, prepared.values),
    );
    const base = await this.start(prepared);
    return { prepared, base, tracker };
  }

  /** Run an opened run's turn and report it on `emit` (as `stream`). */
  private runOpened(
    held: HeldRun,
    emit: (event: RunStreamEvent) => void,
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRun> {
    const { prepared, base } = held;
    const { workflow } = prepared;
    const live = liveEmit(emit, abortSignal);
    live({ type: 'run', runId: base.id, workflowId: workflow.id });
    // A follow-up that asks one agent alone (agents.md 5.21).
    const ask = prepared.context?.ask;
    return this.drive(held, live, abortSignal, async (io) => {
      const host = await this.sessions.createRunHost({
        runId: base.id,
        ...(ask?.agentKey
          ? { agentKey: ask.agentKey }
          : { workflowId: workflow.id }),
        name: workflow.name,
        ...(ask ? { ask: ask.ask } : {}),
        ...(ask?.contextBlock ? { contextBlock: ask.contextBlock } : {}),
        ...(prepared.draft ? { draftAgentId: prepared.draft.agentId } : {}),
        ...(prepared.turn.datasets ? { datasets: prepared.turn.datasets } : {}),
        ...(prepared.turn.buildVisual ? { buildVisual: true } : {}),
        ...(prepared.turn.approveSteps ? { approveSteps: true } : {}),
        ...(prepared.image ? { image: prepared.image } : {}),
        ...(prepared.images.length
          ? {
              inputFiles: prepared.images.map(({ path, data }) => ({
                path,
                data,
              })),
              inputImages: prepared.images.map((file) => file.path),
            }
          : {}),
        ...(prepared.turn.artifact ? { artifact: prepared.turn.artifact } : {}),
        // Review a Website's steps read the whole form (agents.md 5.19).
        ...(workflow.id === REVIEW_WEBSITE_WORKFLOW_ID
          ? { inputValues: prepared.values }
          : {}),
        ...(prepared.context
          ? {
              // A message to Avery reads the whole conversation so far
              // (workflows R45); any other follow-up the earlier run alone.
              ...(prepared.context.transcript?.length
                ? { transcript: prepared.context.transcript }
                : {
                    context: {
                      question: prepared.context.question,
                      answer: prepared.context.answer,
                    },
                  }),
              // Its agents go on from copies of the earlier run's threads
              // (not Sarah asked alone: the host's thread is the Analyst's).
              ...(ask?.continuesThreads === false
                ? {}
                : {
                    continuesThreadsOf: `${RUN_HOST_ID_PREFIX}${prepared.context.fromRunId}`,
                  }),
              // "Next page" or "only Brazil" explores its queries.
              ...(prepared.context.queries?.length
                ? { contextQueries: prepared.context.queries }
                : {}),
            }
          : {}),
      });
      held.hostId = host.id;
      // A Stop or a stall while the host was made: the turn's work never
      // starts, and the run ends as a stopped (or stalled) turn does.
      if (io.abortSignal.aborted) return undefined;
      return this.sessions.streamRunTurn(
        host.id,
        prepared.turn.question,
        io.emit,
        io.abortSignal,
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
   * answer`. A run whose workflow's contract changed since it started
   * (its stored `contractHash`, data-model 3.16; e.g. the Clarify path
   * that moved under `question-path` in roadmap 1.28.8) cannot be resumed
   * either: 410, as an expired run. A run that passes is taken out of the
   * waiting runs, so it is resumed once.
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
        ? (body as { stepId?: unknown; answer?: unknown; images?: unknown })
        : {};
    const answer =
      typeof request.answer === 'string' ? request.answer.trim() : '';
    // Reference images go only with a change to Ryan's visual (workflows
    // R44); they may stand for the words.
    const takesImages = Boolean(run.waitingFor.visualId);
    const sent = Array.isArray(request.images) && request.images.length > 0;
    if (sent && !takesImages) {
      throw new BadRequestException(
        `Step "${run.waitingFor.stepId}" takes no images`,
      );
    }
    const images = revisionImagesOf(request.images, Date.now());
    if (!images.ok) throw new BadRequestException(images.error);
    if (!answer && !images.images.length) {
      throw new BadRequestException('Answer is required');
    }
    const stepId = typeof request.stepId === 'string' ? request.stepId : '';
    if (stepId !== run.waitingFor.stepId) {
      throw new BadRequestException(
        `Step "${stepId}" is not waiting for an answer`,
      );
    }
    const changed = await this.contractChanged(run);
    const taken = this.waiting.take(id);
    if (!taken || taken.expired || changed) {
      await this.expire(id, taken?.value);
      throw new GoneException(RUN_EXPIRED_ERROR);
    }
    return {
      held: taken.value,
      answer,
      images: images.images.map(({ path, data }) => ({ path, data })),
    };
  }

  /**
   * Whether the run's workflow no longer has the contract the run started
   * with: its stored hash differs from the catalogue's. A run stored
   * without a hash, or of a workflow the catalogue no longer holds, is
   * left to the other checks.
   */
  private async contractChanged(run: WorkflowRunDoc): Promise<boolean> {
    if (!run.contractHash) return false;
    try {
      const workflow = await this.workflows.definition(run.workflowId);
      return (
        workflow.contractHash !== undefined &&
        workflow.contractHash !== run.contractHash
      );
    } catch {
      return false;
    }
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
    const { held, answer, images } = prepared;
    const { base, prepared: run } = held;
    await this.repository.update(base.id, {
      status: 'running',
      waitingFor: undefined,
    });
    // The change's reference images go into the run's workspace, where Zoe
    // reads them (workflows R44).
    for (const image of images) {
      await this.sessions.writeRunHostFile(
        `${RUN_HOST_ID_PREFIX}${base.id}`,
        image.path,
        image.data,
      );
    }
    const live = liveEmit(emit, abortSignal);
    live({ type: 'run', runId: base.id, workflowId: run.workflow.id });
    const suspension = held.suspension;
    if (!suspension) throw new Error(`Run "${base.id}" has no turn to resume`);
    return this.drive(held, live, abortSignal, (io) =>
      // Stopped (or stalled) before it resumed: the turn does not go on, and
      // the waiting turn handed back is dropped as a stopped run's is.
      io.abortSignal.aborted
        ? Promise.resolve(suspension)
        : suspension.resume(answer, {
            emit: io.emit,
            abortSignal: io.abortSignal,
            onStepEvent: io.onStepEvent,
            ...(images.length
              ? { images: images.map((image) => image.path) }
              : {}),
          }),
    );
  }

  /**
   * Drive a run's turn (its start, or a resume) to its end and report it
   * (api.md 119, 138): a turn that waits for the user leaves the run
   * `suspended`, held for `SUSPENDED_RUN_TTL_MS`, and sends the waiting
   * step's `step`, `input-required` and `done { run }`; any other end is
   * stored as before. A run that throws while ending is stored `failed`,
   * any step still running or waiting failed with it, and the error
   * rethrown. While the turn runs, each step change stores
   * the tracker's steps so far, the running step and its tool calls
   * included (data-model 3.16), so a restart keeps them (workflows R20);
   * those checkpoints are closed before the write that ends the turn.
   *
   * A no-progress watchdog times the turn (the workflows spec's failure
   * rules): every event it reports resets the clock, and `idleLimitMs` of
   * silence aborts its work with the no-progress error, the run ending
   * `failed` (`stall`). The clock stops when the turn ends or waits for the
   * user. A run ended without its work (`forceEnd`: Stop, or a stall that
   * did not unwind) ends the drive at once with that run; its work's late
   * unwind sends nothing and keeps that end (`unwound`).
   */
  private async drive(
    held: HeldRun,
    live: (event: RunStreamEvent) => void,
    abortSignal: AbortSignal | undefined,
    turn: (io: TurnIo) => Promise<TurnSuspension | undefined>,
  ): Promise<WorkflowRun> {
    const { prepared, base, tracker } = held;
    // A draft run is never stored, so it has no progress to store.
    const checkpoint = prepared.draft
      ? undefined
      : new RunCheckpoint<Pick<WorkflowRunDoc, 'steps'>>(
          (patch) => this.repository.update(base.id, patch),
          (failure) =>
            this.logger.warn(
              `Could not store the progress of run ${base.id}: ${runErrorMessage(failure)}`,
            ),
        );
    let finish!: (run: WorkflowRunDoc) => void;
    const forcedRun = new Promise<WorkflowRunDoc>(
      (resolve) => (finish = resolve),
    );
    const driven: DrivenTurn = {
      ...(checkpoint ? { checkpoint } : {}),
      settled: false,
      finish,
    };
    held.driven = driven;
    if (!prepared.draft) this.driving.set(base.id, held);
    // Nothing reaches the run's clients once it ended without its work.
    const send = (event: RunStreamEvent) => {
      if (!driven.forced) live(event);
    };
    // The turn's work stops on the caller's abort or the watchdog's.
    const turnAbort = new AbortController();
    const watchdog = new IdleWatchdog(this.idleLimitMs, () =>
      this.stall(held, driven, abortSignal, turnAbort),
    );
    const onAbort = () => {
      watchdog.stop();
      turnAbort.abort(abortSignal?.reason);
    };
    if (abortSignal?.aborted) onAbort();
    else abortSignal?.addEventListener('abort', onAbort, { once: true });
    const onStep = (event: Parameters<RunStepTracker['apply']>[0]) => {
      watchdog.touch();
      const step = tracker.apply(event);
      if (!step || driven.forced) return;
      live({ type: 'step', ...step });
      checkpoint?.save({ steps: tracker.pause() });
    };
    const io: TurnIo = {
      // The turn's `done` carries the host; the run sends its own. Its tool
      // events are the running agent step's tool calls too.
      emit: (event) => {
        watchdog.touch();
        noteToolFrame(tracker, event);
        if (event.type !== 'done') send(event);
      },
      onStepEvent: onStep,
      abortSignal: turnAbort.signal,
    };
    const work = this.runAgent(held, send, abortSignal, () =>
      turn(io).finally(() => watchdog.stop()),
    );
    try {
      return await this.driveEnd(held, driven, live, work, forcedRun);
    } finally {
      watchdog.stop();
      abortSignal?.removeEventListener('abort', onAbort);
      if (this.driving.get(base.id) === held) this.driving.delete(base.id);
    }
  }

  /**
   * How a driven turn ends (`drive`): with its work's end, stored as
   * before, or with the run `forceEnd` stored without it. In the second
   * case the work's late end goes to `unwound`.
   */
  private async driveEnd(
    held: HeldRun,
    driven: DrivenTurn,
    live: (event: RunStreamEvent) => void,
    work: Promise<WorkflowRunDoc>,
    forcedRun: Promise<WorkflowRunDoc>,
  ): Promise<WorkflowRun> {
    const { prepared, base, tracker } = held;
    const checkpoint = driven.checkpoint;
    const outcome = await Promise.race([
      work.then(
        (doc) => {
          driven.settled = true;
          return { doc } as const;
        },
        (failure: unknown) => {
          driven.settled = true;
          return { failure } as const;
        },
      ),
      forcedRun.then((forced) => ({ forced }) as const),
    ]);
    // A forced end in progress when the work settled wins: it is stored.
    if ('forced' in outcome || driven.forced) {
      const forced = 'forced' in outcome ? outcome.forced : await forcedRun;
      const end = driven.forced!;
      void work
        .then(
          (doc) => this.unwound(held, end, doc),
          () => this.unwound(held, end),
        )
        .catch((failure: unknown) =>
          this.logger.warn(
            `Could not store the late end of run ${base.id}: ${runErrorMessage(failure)}`,
          ),
        );
      const run: WorkflowRun = prepared.draft
        ? forced
        : await this.wire(forced);
      if (prepared.draft) this.drafts.hold(run, prepared.draft.agentId);
      if (run.status === 'failed') {
        live({ type: 'error', content: run.error ?? 'The run failed' });
      } else {
        live({ type: 'done', run });
      }
      return run;
    }
    if ('failure' in outcome) {
      const { failure } = outcome;
      await checkpoint?.close();
      if (!prepared.draft) {
        // A checkpoint may have stored a step running or waiting: the end
        // write fails it too, so the failed run keeps no open step.
        const error = runErrorMessage(failure);
        await this.end(base.id, {
          status: 'failed',
          error,
          steps: failOpenSteps(tracker.pause(), error),
          finishedAt: new Date().toISOString(),
        });
      }
      throw failure;
    }
    const ended = outcome.doc;
    // The end write lands after every checkpoint, and none follows it.
    await checkpoint?.close();
    const { id, ...patch } = ended;
    // A draft run is never stored: the run is the doc it ended with, held
    // in memory for the query inspector (139-143) only.
    const run: WorkflowRun = prepared.draft
      ? ended
      : await this.wire((await this.end(id, patch)) ?? ended);
    if (prepared.draft) this.drafts.hold(run, prepared.draft.agentId);
    if (run.status === 'failed') {
      live({ type: 'error', content: run.error ?? 'The run failed' });
      return run;
    }
    if (run.status === 'suspended' && run.waitingFor) {
      const { stepId, title, question, options, review, visualId, expiresAt } =
        run.waitingFor;
      live({
        type: 'input-required',
        runId: run.id,
        stepId,
        title,
        question,
        options,
        ...(review ? { review } : {}),
        ...(visualId ? { visualId } : {}),
        expiresAt,
      });
    }
    live({ type: 'done', run });
    return run;
  }

  /**
   * A turn that reported nothing for `idleLimitMs` (the workflows spec's
   * failure rules; ADR-0048 amendment): its work is aborted, the abort's
   * reason the no-progress error, so the run ends `failed` with it, not
   * `stopped`. Work that has not unwound `RUN_UNWIND_MS` later is ended
   * without it (`forceEnd`). A Stop that came first keeps the run stopped,
   * and so does a Stop during that grace: Stop wins over a stall.
   */
  private stall(
    held: HeldRun,
    driven: DrivenTurn,
    abortSignal: AbortSignal | undefined,
    turnAbort: AbortController,
  ): void {
    if (abortSignal?.aborted || driven.settled) return;
    const error = runStalledMessage(this.idleLimitMs);
    this.logger.warn(`Run ${held.base.id}: ${error}`);
    driven.stalled = error;
    turnAbort.abort(new Error(error));
    const timer = setTimeout(() => {
      if (held.driven !== driven) return;
      void this.forceEnd(
        held,
        abortSignal?.aborted
          ? { status: 'stopped' }
          : { status: 'failed', error },
      );
    }, RUN_UNWIND_MS);
    (timer as { unref?: () => void }).unref?.();
  }

  /**
   * The late end of work whose run was ended without it (api.md 150): the
   * work released the run's host as it ended (`runAgent`); the stored run
   * keeps its forced status, error and end time, and takes the partial
   * answer and the final step details. A run deleted meanwhile is not
   * stored again: its host's resources (workspace, memory thread) are
   * deleted now. Nothing is sent: the run's log has ended.
   */
  private async unwound(
    held: HeldRun,
    forced: ForcedEnd,
    ended?: WorkflowRunDoc,
  ): Promise<void> {
    const { prepared, base } = held;
    if (prepared.draft) return;
    if (!(await this.repository.get(base.id))) {
      await this.quietly(`delete the host of deleted run ${base.id}`, () =>
        this.sessions.deleteRunHostResources(`${RUN_HOST_ID_PREFIX}${base.id}`),
      );
      return;
    }
    if (!ended) return;
    const { id, ...patch } = ended;
    await this.end(id, {
      ...patch,
      status: forced.status,
      ...(forced.error !== undefined ? { error: forced.error } : {}),
      finishedAt: forced.finishedAt,
    });
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
  async list(
    workflowId?: string,
    archived = false,
  ): Promise<WorkflowRunSummary[]> {
    const [stored, catalogue] = await Promise.all([
      this.repository.list(workflowId),
      this.workflows.list(),
    ]);
    // Archived conversations (api.md 159) only when asked for, and then alone.
    const runs = stored.filter((run) => Boolean(run.archivedAt) === archived);
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
    // Under the answer's lock: the run is read inside it, so a rating never
    // drops evidence another write just stored (and the other way round).
    return this.withAnswerLock(id, async () => {
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
    });
  }

  /**
   * Run `fn` holding the lock of run `id`'s answer: one write at a time per
   * run, in call order; a failed write does not block the next. Not
   * re-entrant: never call it (or `patchEvidence`) from inside `fn`.
   */
  async withAnswerLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.answers.withLock(id, fn);
  }

  /**
   * Merge `patch` into the evidence entry `index` of run `id`'s answer,
   * under the lock (plan 3c: re-read the run, patch one entry, write the
   * answer). For 1.25.3's explanation and step counts. The checks of
   * api.md 139-143 apply.
   */
  async patchEvidence(
    id: string,
    index: number,
    patch: Partial<Omit<QueryEvidence, 'index'>>,
  ): Promise<WorkflowRun> {
    return this.answers.patchEvidence(this.answerHost(id), index, patch);
  }

  /**
   * Build the evidence of an answer stored before the feature and size its
   * tables (api.md 139). Called again with nothing missing, it runs no
   * query and writes nothing.
   */
  async prepareEvidence(id: string): Promise<WorkflowRun> {
    return this.answers.prepare(this.answerHost(id));
  }

  /**
   * Explain one query step by step (api.md 140). Returns the stored
   * explanation when there is one; a `sample_rows` record is explained by
   * code, any other by one call to `query-explainer`. A second request for
   * the same run and index while one runs waits for the same result.
   */
  async explainQuery(id: string, index: number): Promise<WorkflowRun> {
    return this.answers.explain(this.answerHost(id), index);
  }

  /**
   * Count the rows after each step of an explained query (api.md 141);
   * `checkStageCounts` decides alone whether the counts are stored. A failed
   * check is stored as `unverified`, not raised.
   */
  async countQuerySteps(id: string, index: number): Promise<WorkflowRun> {
    return this.answers.countSteps(this.answerHost(id), index);
  }

  /** Run one of the answer's queries again; nothing is stored (api.md 142). */
  async rerunQuery(id: string, index: number): Promise<QueryRerunResult> {
    return this.answers.rerun(this.answerHost(id), index);
  }

  /**
   * One page of one of the answer's queries, filtered and sorted (api.md
   * 152); nothing is stored.
   */
  async pageQuery(
    id: string,
    index: number,
    request: PageRequest,
  ): Promise<PageResult> {
    return this.answers.page(this.answerHost(id), index, request);
  }

  /**
   * The user's words read as a view of one of the answer's queries (api.md
   * 153); nothing is stored.
   */
  async interpretFilter(
    id: string,
    index: number,
    text: string,
    view: ResultView | null,
  ): Promise<FilterInterpretation> {
    return this.answers.interpretFilter(this.answerHost(id), index, text, view);
  }

  /**
   * One query's rows as CSV (api.md 143): up to 50,000, `cut` when more
   * existed. The file is `query-<Q>-<first 8 of the run id>.csv`.
   */
  async queryCsv(
    id: string,
    index: number,
  ): Promise<QueryExport & { filename: string; q: number }> {
    const exported = await this.answers.exportRows(this.answerHost(id), index);
    return {
      ...exported,
      filename: `query-${exported.q}-${id.slice(0, 8)}.csv`,
    };
  }

  /**
   * Run `id`'s answer as the query inspector's host (api.md 139-143): a
   * stored run, else a finished draft run still held in memory.
   */
  private answerHost(id: string): AnswerHost<WorkflowRun> {
    return { key: id, owner: 'run', load: () => this.answered(id) };
  }

  /**
   * The checks every evidence endpoint shares (api.md 139-143): 404 for no
   * run (a draft run past its time included) or no answer, 400 while the
   * run is running or waiting. A stored run writes to the store; a held
   * draft run to its copy in memory.
   */
  private async answered(id: string): Promise<LoadedAnswer<WorkflowRun>> {
    const stored = await this.repository.get(id);
    const run: WorkflowRun | undefined = stored ?? (await this.heldDraft(id));
    if (!run) throw new NotFoundException(`Run "${id}" not found`);
    if (!run.answer) throw new NotFoundException(`Run "${id}" has no answer`);
    if (run.status === 'running' || run.status === 'suspended') {
      throw new BadRequestException('Wait for the run to finish');
    }
    if (!stored) {
      return {
        answer: run.answer,
        datasets: run.datasets,
        view: () => Promise.resolve(run),
        save: (answer) =>
          Promise.resolve(
            this.drafts.setAnswer(id, answer) ?? { ...run, answer },
          ),
      };
    }
    return {
      answer: run.answer,
      datasets: run.datasets,
      view: () => this.wire(stored),
      save: async (answer) =>
        this.wire(
          (await this.repository.update(id, { answer })) ?? {
            ...stored,
            answer,
          },
        ),
    };
  }

  /**
   * A finished draft run still held, under the rule of the request that
   * ran it (`POST /agents/:id/draft-runs/stream`): its agent must still
   * exist, or the run is dropped and reads as not found.
   */
  private async heldDraft(id: string): Promise<WorkflowRun | undefined> {
    const held = this.drafts.get(id);
    if (!held) return undefined;
    try {
      await this.sessions.draftRunTarget(held.agentId);
    } catch (refusal) {
      if (refusal instanceof NotFoundException) {
        this.drafts.drop(id);
        return undefined;
      }
      // Its datasets may have gone since; that is the re-run's own 400.
      if (!(refusal instanceof BadRequestException)) throw refusal;
    }
    return held.run;
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
    // Each node chat keeps a memory thread of its own (agents.md 5.16).
    for (const chat of await this.nodeChats.listByRun(id)) {
      const hostId = `${RUN_HOST_ID_PREFIX}${nodeChatHostRunId(id, chat.stepId)}`;
      await this.quietly(`delete the memory thread of ${hostId}`, () =>
        this.mastra.deleteMemoryResource(hostId),
      );
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

  /**
   * One image of a run's input (api.md 151): `path` must be a string value, or
   * an element of an array value, of the stored input that is an image path
   * (`inputs/<...>.png|jpg|webp`); the file is read from the run's workspace.
   * Any other path, or a file that is gone, is 404.
   */
  async inputImage(
    id: string,
    path: string,
  ): Promise<{ data: Buffer; mediaType: string }> {
    const run = await this.stored(id);
    const missing = () =>
      new NotFoundException(`Run "${id}" has no image "${path}"`);
    const listed = Object.values(run.input).some((value) =>
      Array.isArray(value) ? value.includes(path) : value === path,
    );
    if (!listed || !/^inputs\/.+\.(png|jpg|webp)$/.test(path)) {
      throw missing();
    }
    try {
      return await this.sessions.runHostImage(
        `${RUN_HOST_ID_PREFIX}${run.id}`,
        path,
      );
    } catch {
      throw missing();
    }
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
    const run: WorkflowRunDoc & { rfpId?: unknown } = {
      ...stored,
      // A run stored before step stories gets them told as it is read.
      steps: withStepStories(
        stored.steps ?? [],
        runStepTeller(stored.workflowId, stored.input ?? {}),
        stored.status,
      ),
    };
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
   * A follow-up's input with the earlier run's image put back (agents.md
   * 5.17): a stored run holds the path of its image, not the image, so a
   * follow-up on the same input sends that path. Where an `image` field's
   * value is the path the earlier run of the same workflow stored, it
   * becomes that file as a `data:` URL; anything else is left for the
   * input check to refuse.
   */
  private async withEarlierImages(
    workflow: WorkflowDefinition,
    input: unknown,
    context: unknown,
  ): Promise<unknown> {
    const fields = workflow.input.filter(
      (field) => field.type === 'image' || field.type === 'images',
    );
    const fromRunId = (context as { fromRunId?: unknown } | null | undefined)
      ?.fromRunId;
    if (
      !fields.length ||
      typeof fromRunId !== 'string' ||
      !input ||
      typeof input !== 'object'
    ) {
      return input;
    }
    const earlier = await this.repository.get(fromRunId);
    if (!earlier || earlier.workflowId !== workflow.id) return input;
    const hostId = `${RUN_HOST_ID_PREFIX}${earlier.id}`;
    // A stored path as the file's `data:` URL; undefined when the file is gone.
    const dataUrl = async (path: string): Promise<string | undefined> => {
      try {
        const image = await this.sessions.runHostImage(hostId, path);
        return `data:${image.mediaType};base64,${image.data.toString('base64')}`;
      } catch {
        // The file is gone: the input check asks for the image again.
        return undefined;
      }
    };
    const values: Record<string, unknown> = { ...input };
    for (const field of fields) {
      const value = values[field.name];
      const stored = earlier.input[field.name];
      if (field.type === 'images') {
        if (!Array.isArray(value) || !Array.isArray(stored)) continue;
        values[field.name] = await Promise.all(
          value.map(async (entry: unknown) => {
            if (typeof entry !== 'string' || !stored.includes(entry)) {
              return entry;
            }
            return (await dataUrl(entry)) ?? entry;
          }),
        );
        continue;
      }
      if (typeof value !== 'string' || value !== stored) continue;
      const url = await dataUrl(value);
      if (url) values[field.name] = url;
    }
    return values;
  }

  /**
   * Store a run as it starts: `running`, with its input and the workflow's
   * contract hash at that moment (data-model 3.16).
   */
  private async start(prepared: PreparedRun): Promise<WorkflowRunDoc> {
    const id = randomUUID();
    const base: WorkflowRunDoc = {
      id,
      workflowId: prepared.workflow.id,
      workflowName: prepared.workflow.name,
      ...(prepared.workflow.contractHash
        ? { contractHash: prepared.workflow.contractHash }
        : {}),
      input: prepared.values,
      // Avery's runs belong to a conversation (workflows R45): a first
      // message starts one (its own id), a follow-up joins its earlier run's.
      ...(prepared.workflow.id === ORCHESTRATED_ANSWER_WORKFLOW_ID
        ? { conversationId: prepared.context?.conversationId ?? id }
        : {}),
      ...(prepared.context
        ? {
            context: {
              fromRunId: prepared.context.fromRunId,
              ...(prepared.context.ask
                ? { askStep: prepared.context.ask.ask.step }
                : {}),
            },
          }
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
  private async contextOf(
    raw: unknown,
    workflowId: string,
  ): Promise<PreparedRun['context']> {
    const fromRunId =
      raw && typeof raw === 'object'
        ? (raw as { fromRunId?: unknown }).fromRunId
        : undefined;
    const askStep =
      raw && typeof raw === 'object'
        ? (raw as { askStep?: unknown }).askStep
        : undefined;
    const asks = askStep !== undefined && askStep !== null && askStep !== '';
    if (fromRunId === undefined || fromRunId === null || fromRunId === '') {
      // Asking one agent is a follow-up: it needs the run it follows.
      if (asks) {
        throw new BadRequestException('Asking one agent needs an earlier run');
      }
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
    if (earlier.question && !earlier.answer && earlier.waitingFor && !asks) {
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
    // Asking one agent (workflows R40): a step that ran in the earlier run
    // of Answer a Business Question.
    let ask: AskHost | undefined;
    if (asks) {
      const refused = askRefusal(workflowId, askStep, earlier);
      if (refused) throw new BadRequestException(refused);
      // Ryan charts the answer of the run that was not itself an ask of him.
      ask = askHostOf(
        earlier,
        askStep as AskableStepId,
        askStep === 'build-visual'
          ? await chartedRunOf(earlier, (id) => this.repository.get(id))
          : earlier,
      );
    }
    const queries = explorableQueriesOf(
      earlier.answer.data ?? [],
      earlier.answer.evidence,
    );
    return {
      fromRunId: earlier.id,
      question: earlier.question,
      answer: earlier.answer.content,
      ...(queries.length ? { queries } : {}),
      ...(ask ? { ask } : {}),
      ...(workflowId === ORCHESTRATED_ANSWER_WORKFLOW_ID
        ? await this.conversationOf(earlier)
        : {}),
    };
  }

  /**
   * The conversation a message to Avery joins (workflows R45): the earlier
   * run's, and its turns so far (each run's question and answer, oldest
   * first, the last `CONVERSATION_TURNS`). An archived conversation takes
   * no new message (409).
   */
  private async conversationOf(earlier: WorkflowRunDoc): Promise<{
    conversationId: string;
    transcript: { role: 'user' | 'assistant'; content: string }[];
  }> {
    if (earlier.archivedAt) {
      throw new ConflictException('This conversation is archived');
    }
    const conversationId = earlier.conversationId ?? earlier.id;
    const runs = await this.repository.listConversation(conversationId);
    if (!runs.some((run) => run.id === earlier.id)) runs.push(earlier);
    const turns = runs
      .filter((run) => run.question && run.answer?.content)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .slice(-CONVERSATION_TURNS);
    return {
      conversationId,
      transcript: turns.flatMap((run) => [
        { role: 'user' as const, content: run.question ?? '' },
        { role: 'assistant' as const, content: run.answer?.content ?? '' },
      ]),
    };
  }

  /**
   * Archive a run's conversation (api.md 159; workflows R45): every run of
   * it (or the run alone, outside a conversation) gets `archivedAt`, so it
   * leaves the run history and takes no new message. Refused while one of
   * its runs is running or waiting.
   */
  async archive(id: string): Promise<{
    ok: true;
    conversationId: string;
    archived: number;
  }> {
    const runs = await this.conversationRuns(id);
    if (
      runs.some((run) => run.status === 'running' || run.status === 'suspended')
    ) {
      throw new ConflictException('The run is still running');
    }
    const at = new Date().toISOString();
    for (const run of runs) {
      await this.repository.update(run.id, { archivedAt: at });
    }
    return {
      ok: true,
      conversationId: runs[0].conversationId ?? runs[0].id,
      archived: runs.length,
    };
  }

  /** Bring an archived conversation back (api.md 160; workflows R45). */
  async unarchive(id: string): Promise<{
    ok: true;
    conversationId: string;
    unarchived: number;
  }> {
    const runs = await this.conversationRuns(id);
    for (const run of runs) {
      await this.repository.update(run.id, { archivedAt: undefined });
    }
    return {
      ok: true,
      conversationId: runs[0].conversationId ?? runs[0].id,
      unarchived: runs.length,
    };
  }

  /** A run and every run of its conversation (404 for an unknown run). */
  private async conversationRuns(id: string): Promise<WorkflowRunDoc[]> {
    const run = await this.stored(id);
    if (!run.conversationId) return [run];
    const runs = await this.repository.listConversation(run.conversationId);
    return runs.length ? runs : [run];
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
    // A Stop is `stopped`; a turn the watchdog aborted fails with its error.
    const stalled = held.driven?.stalled;
    if (abortSignal?.aborted) status = 'stopped';
    else if (stalled) {
      status = 'failed';
      error = stalled;
    }
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
    const built = builtVisualEvent(ended.steps, view.visualizations ?? []);
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
      ...(built ? { events: [...(base.events ?? []), built] } : {}),
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
    // Read the host before the run is held: a host that cannot be read
    // fails the run, and a failed run must not stay among the waiting ones.
    const view = await this.sessions.runHostView(hostId);
    const since = new Date();
    const expiresAt = this.waiting.add(base.id, held);
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
        ...(suspension.review ? { review: suspension.review } : {}),
        ...(suspension.visualId ? { visualId: suspension.visualId } : {}),
        since: since.toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      },
      question: prepared.turn.question,
      datasets: view.datasets,
      ...(view.agentKey ? { agentKey: view.agentKey } : {}),
      ...(view.agentId ? { agentId: view.agentId } : {}),
      ...(view.agentName ? { agentName: view.agentName } : {}),
      // Ryan's visual is shown while the run waits on its approval gate
      // (workflows R44): the run carries the host's visuals.
      ...(suspension.visualId
        ? { visualizations: view.visualizations ?? [] }
        : {}),
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
