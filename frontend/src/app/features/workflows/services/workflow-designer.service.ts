import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  Dataset,
  DatasetsApiService,
} from '../../datasets/services/datasets-api.service';
import {
  QueryOpener,
  queryOpenerOf,
} from '../../../shared/query-evidence/query-opener';
import { ToastService } from '../../../core/toast/toast.service';
import { MessageFeedback } from '../../sessions/models/session.model';
import {
  answerHasQueries,
  LiveToolCall,
  NodeChatAvailability,
  RunStepView,
  RunView,
  WorkflowDetail,
  WorkflowInputError,
  WorkflowInputValue,
  WorkflowRun,
  WorkflowRunRequest,
  WorkflowRunStep,
  WorkflowWaitingFor,
} from '../models/workflow.model';
import { AgentStepStory, agentStepStories } from './agent-step-story';
import { RunLine, stepRunLine } from './workflow-run-story';
import {
  NodeInspection,
  WorkflowNodeStatus,
  WorkflowStateSummary,
} from '../models/workflow-node.model';
import {
  NodeInspectionSource,
  buildNodeInspections,
  buildToolInspection,
  nodeStatuses,
  workflowStateSummary,
} from './workflow-node-inspection';
import {
  inputErrorsByField,
  validateRunForm,
} from './workflow-input-validation';
import { ContractSide, contractViolationSides } from './workflow-contract';
import {
  RunStreamHandlers,
  WorkflowRunsApiService,
} from './workflow-runs-api.service';
import { WorkflowRunTasks } from './workflow-run-tasks';
import { WorkflowsApiService } from './workflows-api.service';
import {
  RunFormValues,
  IMAGES_FIELD,
  followUpRequest,
  initialInputValues,
  questionFieldName,
  runAgainValues,
  runInput,
} from './workflows.util';

export type { LiveToolCall, RunStepView, RunView };

/** A step of the run panel: its last attempt, and how many times it ran. */
export type RunPanelStep = RunStepView & { attempts: number };

/** The only workflow whose follow-up can ask one agent step (api.md 118). */
const ASK_AGENT_WORKFLOW = 'answer-business-question';

/**
 * What a follow-up does, under the agent picker (workflows R40; ui.md
 * 4.4b): the whole workflow, or what each agent does when asked alone.
 */
export const ASK_HINTS: Readonly<Record<string, string>> = {
  '': 'Runs every step again: plans, queries the data, checks and writes a new answer.',
  'read-images': 'Read images step: reads your reference images again with this question.',
  'interpret-follow-up':
    'Interpret follow-up step: pages, filters or sorts the earlier result. Runs no new analysis.',
  plan: 'Plan step: plans how to answer your question. Reads no data.',
  analyse:
    'Analyse step: answers with new queries over the data, with no plan or checks around it.',
  'write-answer':
    'Write answer step: rewrites the earlier answer from the same results. Runs no new queries.',
  'build-visual':
    "Ryan designs a new visual from the earlier answer's rows, following what you type. No new queries run.",
};

/** How often, and how many times, a stopped run is read back until it is stored. */
const STOPPED_POLL_MS = 300;
const STOPPED_POLL_TRIES = 10;

const NO_RUN_SUMMARY: WorkflowStateSummary = {
  status: null,
  ran: 0,
  total: 0,
  durationMs: null,
  runId: null,
  invalidFields: 0,
};

/**
 * The state of the workflow designer, shared by the page in the content area
 * (header, canvas, node dialog) and the Run panel beside the canvas (the
 * Chat, How it ran) (workflows R7, R12, R13, R21): the open workflow, the selected
 * and the open node, the run form, and the run shown, streamed live (api.md
 * 119, 3.6) and then as stored. Leaving the page discards the form and the
 * run shown (the run itself stays stored). A run runs on the server whatever
 * the page does (ADR-0048): leaving only drops its stream, the run goes on
 * as a background task, and opening its workflow again (or the run from
 * Runs or the task) follows it again with the live view rebuilt (api.md
 * 149). Stop stops it on the server (150).
 */
@Injectable({ providedIn: 'root' })
export class WorkflowDesigner {
  private readonly api = inject(WorkflowsApiService);
  private readonly runsApi = inject(WorkflowRunsApiService);
  private readonly runTasks = inject(WorkflowRunTasks);
  private readonly toast = inject(ToastService);
  private readonly datasetsApi = inject(DatasetsApiService);

  constructor() {
    // The run shown ends here, not in a toast.
    this.runTasks.watchShown(() => this.runId());
    // While the page streams a run, its task row shows the live team (ui.md 3.7).
    effect(() => {
      const id = this.runId();
      const workflow = this.workflow();
      if (!id || !workflow || !this.running()) return;
      const steps = this.runPanelSteps();
      const calls = this.toolCalls();
      untracked(() => this.runTasks.showLive(id, workflow, steps, calls));
    });
  }

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly workflow = signal<WorkflowDetail | null>(null);

  /** The selected node: a step id, `start` or `end`; null for none. */
  readonly selectedStepId = signal<string | null>(null);
  /** The node whose dialog is open; null when none is. */
  readonly openNodeId = signal<string | null>(null);
  /** Whether the Run panel under the canvas is unfolded. */
  readonly stateOpen = signal(true);
  /** Whether the Run panel is maximized (opening a query restores it). */
  readonly runDockMaximized = signal(false);
  /** The query open in the inspector sheet (an index into the answer's `data`); null when none is. */
  readonly openQueryIndex = signal<number | null>(null);
  /**
   * The run whose answer holds the open query when it is not the shown run:
   * an earlier turn of the Business view's conversation (workflows R38).
   * Null for the shown run.
   */
  readonly queryRun = signal<WorkflowRun | null>(null);
  /** What opened the sheet, to give the focus back on close. */
  private queryOpener: QueryOpener | null = null;
  /** The runs whose answer evidence was already requested (api.md 139): once per run id. */
  private readonly preparedRuns = new Set<string>();
  /**
   * Bumped by Execute workflow on the canvas (and New question): the Run
   * panel's composer takes the focus. Execute workflow itself never runs.
   */
  readonly runFormRequest = signal(0);

  /** The datasets a `datasets` or `dataset` field picks from. */
  readonly datasets = signal<Dataset[]>([]);
  /** The datasets list answered; until then a picked dataset is not checked. */
  private readonly datasetsLoaded = signal(false);
  /** The run form's values, by field name. */
  readonly inputValues = signal<RunFormValues>({});
  /** The follow-up field under an answer. */
  readonly followUpText = signal('');

  readonly running = signal(false);
  /** The server's refusal of the last Execute (before anything ran), or `Backend unreachable`. */
  readonly runError = signal<string | null>(null);
  /**
   * The errors that refused the last Execute, by the run form or the server
   * (api.md 119 `errors[]`; ui.md 4.4b); empty when it was not refused.
   */
  readonly inputErrors = signal<WorkflowInputError[]>([]);
  /** Each field's message, shown under its control. */
  readonly fieldErrors = computed(() => inputErrorsByField(this.inputErrors()));
  /** Bumped by a refusal with field errors: the run form focuses the first one. */
  readonly invalidFocusRequest = signal(0);

  /** The run streaming or shown: its id once the stream said it started. */
  readonly runId = signal<string | null>(null);
  /** The run as stored (`done.run`, or read back after a stop). */
  readonly run = signal<WorkflowRun | null>(null);
  /** The shown answer's rating is being saved. */
  readonly ratingPending = signal(false);
  /** The earlier run this one follows up (its context), if any. */
  readonly contextRun = signal<{
    id: string;
    question: string;
    /** The agent asked alone (a live run started from the picker). */
    askedAgent?: string;
  } | null>(null);

  /** The follow-up composer's picked step id; '' is the whole workflow. */
  readonly askStep = signal('');

  /**
   * The agent steps a follow-up can ask alone (answer-business-question
   * only): those that ran in the run shown, last attempt, in step order.
   */
  readonly askableSteps = computed<
    { id: string; agentName: string; label: string }[]
  >(() => {
    const workflow = this.workflow();
    if (workflow === null || workflow.id !== ASK_AGENT_WORKFLOW) return [];
    const ran = new Map(
      this.runPanelSteps().map((step) => [step.id, step.status]),
    );
    // Build visual works from the earlier answer's query rows (api.md 118):
    // askable when there are some, even if it was skipped or made no visual.
    const hasRows = (this.runResult()?.answer?.data ?? []).some(
      (record) =>
        record.tool === 'run_readonly_sql' && (record.rows?.length ?? 0) > 0,
    );
    return workflow.steps.flatMap((step) => {
      const status = ran.get(step.id);
      const buildVisual = step.id === 'build-visual';
      if (
        step.kind !== 'agent' ||
        !step.agent ||
        status === undefined ||
        status === null ||
        status === 'running' ||
        (buildVisual && !hasRows) ||
        (status === 'skipped' && !buildVisual)
      ) {
        return [];
      }
      // The agent's role says what it is responsible for (Olivia · Analysis
      // Lead); its step's title when it has none.
      return [
        {
          id: step.id,
          agentName: step.agent.name,
          label: `${step.agent.name} · ${step.agent.role || step.title}`,
        },
      ];
    });
  });

  /** What the picked follow-up does (`ASK_HINTS`), shown under the picker. */
  readonly askHint = computed(() => ASK_HINTS[this.askStep()] ?? '');

  /** The name of the agent picked in the composer; null for the whole workflow. */
  readonly askedAgentName = computed(
    () =>
      this.askableSteps().find((s) => s.id === this.askStep())?.agentName ??
      null,
  );

  /**
   * The agent a stored run asked alone (its `context.askStep`), else the one
   * a live run was started with; null for a whole-workflow run.
   */
  readonly contextAgent = computed<string | null>(() => {
    const step = this.run()?.context?.askStep;
    if (step) {
      return (
        this.workflow()?.steps.find((s) => s.id === step)?.agent?.name ?? null
      );
    }
    return this.contextRun()?.askedAgent ?? null;
  });

  /** The input of the run started here (Execute, Follow up, Continue); null before one. */
  readonly liveInput = signal<Record<string, WorkflowInputValue> | null>(null);
  /** Live: when the run started and ended, stamped here. */
  private readonly liveStartedAt = signal<string | null>(null);
  private readonly liveFinishedAt = signal<string | null>(null);
  /** Live: the step events so far, by step id: one per attempt, in order. */
  readonly liveSteps = signal<Record<string, WorkflowRunStep[]>>({});
  /** Live: the agent's reasoning so far. */
  readonly reasoning = signal('');
  /** Live: the agent's tool calls so far. */
  readonly toolCalls = signal<LiveToolCall[]>([]);
  /** Live: the answer text so far (not authoritative; `done.run` replaces it). */
  readonly streamingText = signal('');
  /** The run started, then the stream failed (`error` event, a dropped stream). */
  private readonly streamError = signal<string | null>(null);
  /** The user stopped the run shown. */
  private readonly stopped = signal(false);
  /** What the streaming run waits on (`input-required`), until it resumes. */
  private readonly liveWaiting = signal<WorkflowWaitingFor | null>(null);
  /** The server refused to resume (not a failed run): shown on the waiting card. */
  readonly resumeError = signal<string | null>(null);

  /** A stored run to show once the workflow has loaded (a run opened from Runs). */
  private pendingRun: WorkflowRun | null = null;
  /** Form values to hold once the workflow has loaded (an artifact's "Use in"). */
  private pendingValues: Record<string, WorkflowInputValue> | null = null;
  /** Run the workflow on the held values once it has loaded (the home's Ask). */
  private pendingExecute = false;

  /**
   * The run the page showed running (or waiting) when it was left: opening
   * its workflow again shows it again (ADR-0048).
   */
  private leftRun: { workflowId: string; runId: string } | null = null;
  /** Stop was pressed before the run had an id: stop it once it has one. */
  private stopRequested = false;

  private loadSubscription: Subscription | null = null;
  private datasetsSubscription: Subscription | null = null;
  private stoppedSubscription: Subscription | null = null;
  private stoppedTimer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  /** Each run started bumps it; events of an older run are ignored. */
  private generation = 0;

  /** The field a follow-up's question goes into; null when it has none. */
  readonly questionField = computed(() => {
    const workflow = this.workflow();
    return workflow === null ? null : questionFieldName(workflow.input);
  });

  /**
   * The question the run shown waits on, or (`expired`) waited on and can no
   * longer continue; null otherwise.
   */
  readonly waitingFor = computed<WorkflowWaitingFor | null>(() => {
    const stored = this.run();
    if (stored !== null) {
      const waiting = stored.waitingFor ?? null;
      if (waiting === null) return null;
      return stored.status === 'suspended' || waiting.expired ? waiting : null;
    }
    return this.stopped() ? null : this.liveWaiting();
  });

  /** The run shown; null before the first Execute and after a refusal. */
  readonly runResult = computed<RunView | null>(() => {
    const workflow = this.workflow();
    if (workflow === null) return null;
    const kinds = new Map(workflow.steps.map((step) => [step.id, step.kind]));
    const stored = this.run();
    if (stored !== null) {
      const finishedAt = stored.finishedAt ?? this.liveFinishedAt();
      return {
        status: stored.status,
        ...(stored.waitingFor !== undefined
          ? { waitingFor: stored.waitingFor }
          : {}),
        ...(stored.error !== undefined ? { error: stored.error } : {}),
        steps: stored.steps.map((step) => ({
          ...step,
          kind: kinds.get(step.id) ?? 'code',
        })),
        ...(stored.output !== undefined ? { output: stored.output } : {}),
        ...(stored.answer !== undefined ? { answer: stored.answer } : {}),
        runId: stored.id,
        input: stored.input ?? null,
        startedAt: stored.startedAt,
        ...(finishedAt !== null && finishedAt !== undefined
          ? { finishedAt }
          : {}),
      };
    }
    if (this.runId() === null && !this.running() && !this.stopped()) {
      return null;
    }
    const live = this.liveSteps();
    const failure = this.streamError();
    const waiting = this.waitingFor();
    const status: RunView['status'] = this.stopped()
      ? 'stopped'
      : failure !== null
        ? 'failed'
        : waiting !== null
          ? 'suspended'
          : 'running';
    const startedAt = this.liveStartedAt();
    const finishedAt = this.liveFinishedAt();
    return {
      status,
      ...(status === 'suspended' && waiting !== null
        ? { waitingFor: waiting }
        : {}),
      ...(failure !== null ? { error: failure } : {}),
      steps: workflow.steps.flatMap((step) => {
        const events: (WorkflowRunStep | null)[] = Object.hasOwn(live, step.id)
          ? live[step.id]
          : [null];
        return events.map((event): RunStepView => {
          let stepStatus = event === null ? null : event.status;
          if (
            stepStatus === 'running' &&
            status !== 'running' &&
            status !== 'suspended'
          ) {
            stepStatus = status === 'stopped' ? 'stopped' : 'failed';
          }
          return {
            id: step.id,
            title: event?.title ?? step.title,
            kind: step.kind,
            status: stepStatus,
            ...(event?.input !== undefined ? { input: event.input } : {}),
            ...(event?.inputTruncated ? { inputTruncated: true as const } : {}),
            ...(event?.output !== undefined ? { output: event.output } : {}),
            ...(event?.outputTruncated
              ? { outputTruncated: true as const }
              : {}),
            ...(event?.error !== undefined ? { error: event.error } : {}),
            ...(event?.startedAt !== undefined
              ? { startedAt: event.startedAt }
              : {}),
            ...(event?.endedAt !== undefined ? { endedAt: event.endedAt } : {}),
            ...(event?.toolCalls !== undefined
              ? { toolCalls: event.toolCalls }
              : {}),
            ...(event?.attempt !== undefined ? { attempt: event.attempt } : {}),
            ...(event?.story !== undefined ? { story: event.story } : {}),
          };
        });
      }),
      runId: this.runId(),
      input: this.liveInput(),
      ...(startedAt !== null ? { startedAt } : {}),
      ...(finishedAt !== null ? { finishedAt } : {}),
    };
  });

  private readonly inspectionSource = computed<NodeInspectionSource | null>(
    () => {
      const workflow = this.workflow();
      if (workflow === null) return null;
      return {
        workflow,
        run: this.runResult(),
        liveToolCalls: this.toolCalls(),
        running: this.running(),
        inputErrors: this.inputErrors(),
      };
    },
  );

  /** Start, every step and End, with what each received and produced in the run shown. */
  readonly nodes = computed<NodeInspection[]>(() => {
    const source = this.inspectionSource();
    return source === null ? [] : buildNodeInspections(source);
  });

  /** The Workflow state panel's summary row. */
  readonly stateSummary = computed<WorkflowStateSummary>(() => {
    const source = this.inspectionSource();
    return source === null
      ? NO_RUN_SUMMARY
      : workflowStateSummary(source, this.nodes());
  });

  /**
   * The steps of the run shown that failed on a contract violation, by id,
   * with the side it broke on (ui.md 4.4b); empty with no run.
   */
  readonly contractViolations = computed<Record<string, ContractSide>>(() =>
    contractViolationSides(this.runResult()?.steps),
  );

  /** The stored run's `contractHash`; null while live, or for an old run. */
  readonly runContractHash = computed(() => this.run()?.contractHash ?? null);

  /**
   * The run panel's steps: each step once, as its last attempt, with how
   * many times it ran; in the order the run shows them.
   */
  readonly runPanelSteps = computed<RunPanelStep[]>(() => {
    const steps = this.runResult()?.steps ?? [];
    const byId = new Map<string, RunPanelStep>();
    for (const step of steps) {
      const seen = byId.get(step.id);
      byId.set(step.id, { ...step, attempts: (seen?.attempts ?? 0) + 1 });
    }
    return [...byId.values()];
  });

  /**
   * What each agent of the run shown is doing (ui.md 4.4b, *Agents at work*):
   * its state, the canvas line and the Run panel's sentence, by step id.
   */
  readonly agentStories = computed(() => {
    const workflow = this.workflow();
    if (workflow === null) return new Map<string, AgentStepStory>();
    const status = this.runResult()?.status;
    return agentStepStories({
      steps: workflow.steps,
      runSteps: this.runPanelSteps(),
      running: this.running() || status === 'running' || status === 'suspended',
      liveToolCalls: this.toolCalls(),
    });
  });

  /**
   * Each code step's line on the canvas while a run is shown (ui.md 4.4b):
   * its story's few words and its time, or its state; by step id.
   */
  readonly runLines = computed<Record<string, RunLine>>(() => {
    const lines: Record<string, RunLine> = {};
    for (const node of this.nodes()) {
      if (node.kind !== 'code') continue;
      const line = stepRunLine(node.run);
      if (line) lines[node.nodeId] = line;
    }
    return lines;
  });

  /** How many times each step ran in the run shown (a loop's retry runs one twice); empty with no run. */
  readonly nodeAttempts = computed<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const step of this.runResult()?.steps ?? []) {
      if (step.status === null) continue;
      out[step.id] = (Object.hasOwn(out, step.id) ? out[step.id] : 0) + 1;
    }
    return out;
  });

  /** Each node's status in the run shown (Start and End included); empty with no run. */
  readonly nodeStatuses = computed<Record<string, WorkflowNodeStatus>>(() =>
    nodeStatuses(this.nodes()),
  );

  /**
   * The node whose dialog is open, with its data, or the tool whose sub-node
   * opened it; null when none is.
   */
  readonly openInspection = computed<NodeInspection | null>(() => {
    const id = this.openNodeId();
    return id === null ? null : this.inspect(id);
  });

  private inspect(id: string): NodeInspection | null {
    const nodes = this.nodes();
    return (
      nodes.find((node) => node.nodeId === id) ?? buildToolInspection(nodes, id)
    );
  }

  /**
   * Whether an agent step's dialog can chat about the run shown (api.md 136,
   * 137): only once that run ended and is stored, and only for a run of the
   * workflow this page resolved (a run of a removed workflow has none).
   */
  readonly nodeChat = computed<NodeChatAvailability>(() => {
    const workflow = this.workflow();
    if (workflow === null) return { state: 'hidden' };
    const stored = this.run();
    if (stored !== null) {
      if (stored.workflowId !== workflow.id) return { state: 'hidden' };
      return stored.status === 'running'
        ? { state: 'running' }
        : { state: 'ready', runId: stored.id };
    }
    if (this.running()) return { state: 'running' };
    const id = this.runId();
    return id === null ? { state: 'no-run' } : { state: 'ready', runId: id };
  });

  /** Follow up is offered under a stored answer of a workflow with a question. */
  readonly canFollowUp = computed(() => {
    const run = this.run();
    return (
      run !== null &&
      run.answer !== undefined &&
      run.status === 'success' &&
      this.questionField() !== null &&
      !this.running()
    );
  });

  /** The input of the run shown (as started here, else as stored); null without one. */
  private readonly shownInput = computed(
    () => this.liveInput() ?? this.run()?.input ?? null,
  );

  /** Run again is offered while a run with an input is shown and none is going. */
  readonly canRunAgain = computed(
    () =>
      this.runResult() !== null &&
      this.shownInput() !== null &&
      !this.running(),
  );

  /**
   * A run opened from Runs (workflows R19): the next workflow opened shows
   * this stored run, its form holding the run's input.
   */
  showRunOnLoad(run: WorkflowRun): void {
    this.pendingRun = run;
  }

  /**
   * The next workflow opened starts with these form values over its initial
   * ones (an artifact opened in Dashboard Image to Artifact). A name the workflow
   * has no field for is ignored. With `execute`, the workflow then runs on
   * them as Execute would (the home's Ask, app-shell R51), once its datasets
   * have loaded; not when the page shows a stored or still-running run.
   */
  prefillOnLoad(
    values: Record<string, WorkflowInputValue>,
    options: { execute?: boolean } = {},
  ): void {
    this.pendingValues = values;
    this.pendingExecute = options.execute === true;
  }

  /** Open a workflow: everything of the previous one is discarded. */
  load(id: string): void {
    this.clear();
    this.loading.set(true);
    this.loadSubscription = this.api.getWorkflow(id).subscribe({
      next: (workflow) => {
        this.workflow.set(workflow);
        this.inputValues.set(initialInputValues(workflow.input));
        this.loading.set(false);
        // The run left running on this workflow is shown once more at most.
        const left =
          this.leftRun?.workflowId === workflow.id ? this.leftRun : null;
        if (left !== null) this.leftRun = null;
        const runNow =
          this.pendingExecute && this.pendingRun === null && left === null;
        this.pendingExecute = false;
        if (this.pendingRun !== null) {
          const pending = this.pendingRun;
          this.pendingRun = null;
          if (pending.workflowId === workflow.id) {
            this.showOrFollow(workflow, pending);
            // New question keeps the run's other fields (its datasets).
            this.inputValues.set(runAgainValues(workflow.input, pending.input));
          }
        } else if (left !== null) {
          // The run left running here is shown again, as it is now.
          this.reopen(workflow, left.runId);
        }
        if (this.pendingValues !== null) {
          const prefill = this.pendingValues;
          this.pendingValues = null;
          const known = new Set(workflow.input.map((field) => field.name));
          this.inputValues.update((values) => ({
            ...values,
            ...Object.fromEntries(
              Object.entries(prefill).filter(([name]) => known.has(name)),
            ),
          }));
        }
        if (
          workflow.input.some(
            (field) =>
              !field.hidden &&
              (field.type === 'datasets' || field.type === 'dataset'),
          )
        ) {
          this.loadDatasets(runNow);
        } else if (runNow) {
          this.execute();
        }
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  /** The datasets a `datasets` field offers; then, with `thenExecute`, the run starts. */
  private loadDatasets(thenExecute = false): void {
    this.datasetsSubscription = this.datasetsApi
      .getDatasetSummaries()
      .subscribe({
        next: (response) => {
          this.datasets.set(response.datasets ?? []);
          this.datasetsLoaded.set(true);
          if (thenExecute) this.execute();
        },
        error: () => {
          this.datasets.set([]);
          if (thenExecute) this.execute();
        },
      });
  }

  /**
   * Leaving the page discards the workflow, the selection and the run shown
   * (R13). A run still running (or waiting for the user) is not stopped: only
   * its stream is dropped, and the page shows it again when the workflow is
   * opened again (ADR-0048).
   */
  clear(): void {
    const shownWorkflow = this.workflow();
    const shownRun = this.runId();
    if (
      shownWorkflow !== null &&
      shownRun !== null &&
      !this.stopped() &&
      (this.running() || this.runResult()?.status === 'suspended')
    ) {
      this.leftRun = { workflowId: shownWorkflow.id, runId: shownRun };
    }
    this.loadSubscription?.unsubscribe();
    this.loadSubscription = null;
    this.datasetsSubscription?.unsubscribe();
    this.datasetsSubscription = null;
    this.cancelStream();
    this.loading.set(false);
    this.error.set(null);
    this.workflow.set(null);
    this.selectedStepId.set(null);
    this.openNodeId.set(null);
    this.openQueryIndex.set(null);
    this.queryRun.set(null);
    this.queryOpener = null;
    this.runDockMaximized.set(false);
    this.runFormRequest.set(0);
    this.datasets.set([]);
    this.datasetsLoaded.set(false);
    this.inputValues.set({});
    this.followUpText.set('');
    this.runError.set(null);
    this.inputErrors.set([]);
    this.resetRun();
  }

  /** Select a node (a step, `start` or `end`), or clear the selection. */
  select(id: string | null): void {
    this.selectedStepId.set(id);
  }

  /**
   * Open a node's dialog, or a tool's from its sub-node id
   * (`<stepId>-tool-<name>`); the node, or the tool's agent step, is
   * selected too.
   */
  openNode(id: string): void {
    const node = this.inspect(id);
    this.selectedStepId.set(
      node?.kind === 'tool' && node.step ? node.step.id : id,
    );
    this.openNodeId.set(id);
  }

  closeNode(): void {
    this.openNodeId.set(null);
  }

  /** The shown run's answer ran queries (any workflow): it gets the query inspector. */
  readonly inspectsQueries = computed(() =>
    answerHasQueries(this.runResult()?.answer),
  );

  /**
   * Open a query of the shown answer in the inspector sheet (ui.md 4.4b). A
   * maximized Run panel is restored first; another query swaps the one shown.
   * `opener` is the chip or row that was used: Escape returns the focus to it.
   */
  openQuery(
    index: number,
    opener: Element | null = null,
    run: WorkflowRun | null = null,
  ): void {
    this.runDockMaximized.set(false);
    if (this.openQueryIndex() === null && opener !== null) {
      this.queryOpener = queryOpenerOf(opener);
    }
    this.queryRun.set(run);
    this.openQueryIndex.set(index);
  }

  /** Close the sheet; answers what opened it, to focus again. */
  closeQuery(): QueryOpener | null {
    const opener = this.queryOpener;
    this.queryOpener = null;
    this.openQueryIndex.set(null);
    this.queryRun.set(null);
    return opener;
  }

  /** A call changed the stored answer: show the updated run, when it is still the one shown. */
  applyRun(run: WorkflowRun): void {
    if (this.run()?.id === run.id) this.run.set(run);
    if (this.queryRun()?.id === run.id) this.queryRun.set(run);
  }

  /**
   * Build the evidence of the shown stored answer and size its tables (api.md
   * 139). Fired once per run id, in the background, when a stored answer
   * with data is shown; a failure is silent.
   */
  private prepareEvidence(run: WorkflowRun): void {
    if (
      !answerHasQueries(run.answer) ||
      run.status === 'running' ||
      run.status === 'suspended' ||
      this.preparedRuns.has(run.id)
    ) {
      return;
    }
    this.preparedRuns.add(run.id);
    this.runsApi.prepareEvidence(run.id).subscribe({
      next: (result) => this.applyRun(result.run),
      error: () => undefined,
    });
  }

  /** Execute workflow on the canvas: the Run panel unfolds and focuses its composer. */
  requestRunForm(): void {
    this.stateOpen.set(true);
    this.runFormRequest.update((n) => n + 1);
  }

  /** A field's new value; editing a field clears its error. */
  setInput(name: string, value: WorkflowInputValue): void {
    this.inputValues.update((values) => ({ ...values, [name]: value }));
    if (this.inputErrors().some((error) => error.field === name)) {
      this.inputErrors.update((errors) =>
        errors.filter((error) => error.field !== name),
      );
    }
  }

  /** A text, text area or number field's value; empty until typed. */
  inputValue(name: string): string {
    const values = this.inputValues();
    if (!Object.hasOwn(values, name)) return '';
    const value = values[name];
    return typeof value === 'string' ? value : '';
  }

  /** A checkbox's value. */
  checked(name: string): boolean {
    const values = this.inputValues();
    return Object.hasOwn(values, name) && values[name] === true;
  }

  /** The datasets picked in a `datasets` field. */
  picked(name: string): string[] {
    const values = this.inputValues();
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    return Array.isArray(value) ? value : [];
  }

  /** Pick or unpick one dataset in a `datasets` field. */
  toggleDataset(name: string, dataset: string): void {
    const picked = this.picked(name);
    this.setInput(
      name,
      picked.includes(dataset)
        ? picked.filter((d) => d !== dataset)
        : [...picked, dataset],
    );
  }

  /**
   * Run the workflow once on the form's values (api.md 119), once the form
   * has checked them: an invalid input sends nothing, each field shows its
   * error and Start is invalid (ui.md 4.4b).
   */
  execute(): void {
    const workflow = this.workflow();
    if (workflow === null || this.running()) return;
    const values = this.inputValues();
    const errors = validateRunForm(
      workflow.input,
      values,
      this.datasetsLoaded() ? this.datasets() : null,
    );
    if (errors.length > 0) {
      this.cancelStream();
      this.resetRun();
      this.runError.set(null);
      this.refuse(errors);
      return;
    }
    this.start(workflow, { input: runInput(workflow.input, values) }, null);
  }

  /** The input was refused: errors on the fields, focus on the first one. */
  private refuse(errors: WorkflowInputError[]): void {
    this.inputErrors.set(errors);
    if (Object.keys(this.fieldErrors()).length > 0) {
      this.invalidFocusRequest.update((n) => n + 1);
    }
  }

  /**
   * Follow up on the answer shown, or answer its clarifying question: a new
   * run on the same input with this question, the shown run as its context
   * (plan 5.4; workflows R17, R21). The form's question becomes it. `images`
   * is the composer's attachments (the run's kept paths and new `data:`
   * URLs); without it the earlier run's images carry over.
   */
  followUp(question: string, images?: readonly string[]): void {
    const workflow = this.workflow();
    const run = this.run();
    const field = this.questionField();
    const text = question.trim();
    if (workflow === null || run === null || field === null || !text) return;
    if (this.running()) return;
    this.setInput(field, text);
    this.followUpText.set('');
    const picked = this.askableSteps().find((s) => s.id === this.askStep());
    const request = followUpRequest(run, field, text, images, picked?.id);
    this.start(workflow, request, {
      id: run.id,
      question: run.question ?? '',
      ...(picked ? { askedAgent: picked.agentName } : {}),
    });
  }

  /**
   * New question (ui.md 4.4b): the chat drops the run shown and its question,
   * so the composer starts a fresh run; the other fields (the datasets) keep
   * their values. The run itself stays stored. Not while a run is going.
   */
  newQuestion(): void {
    if (this.running()) return;
    this.cancelStream();
    this.resetRun();
    this.runError.set(null);
    this.inputErrors.set([]);
    this.followUpText.set('');
    const field = this.questionField();
    if (field !== null) this.setInput(field, '');
    this.requestRunForm();
  }

  /**
   * Run again (workflows R19): like New question, the chat drops the run
   * shown, but the composer opens with that run's whole input (its question
   * too), to change and Execute as a new run. The run itself stays stored.
   */
  runAgain(): void {
    const workflow = this.workflow();
    const input = this.shownInput();
    if (workflow === null || input === null || this.running()) return;
    this.cancelStream();
    this.resetRun();
    this.runError.set(null);
    this.inputErrors.set([]);
    this.followUpText.set('');
    this.inputValues.set(runAgainValues(workflow.input, input));
    this.requestRunForm();
  }

  /**
   * The reference images of the run shown, as its input holds them: stored
   * paths (`inputs/images/1.png`), or `data:` URLs while a run started here
   * is not stored yet; empty without any.
   */
  readonly shownImages = computed((): string[] => {
    const value = this.shownInput()?.[IMAGES_FIELD];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  });

  /**
   * The question of the run shown, as the user asked it: the question field
   * of its input, else the message the agent received; null without one.
   */
  readonly shownQuestion = computed(() => {
    const field = this.questionField();
    const input = this.liveInput() ?? this.run()?.input ?? null;
    const value = field !== null && input !== null ? input[field] : undefined;
    if (typeof value === 'string' && value.trim()) return value.trim();
    return this.run()?.question?.trim() || null;
  });

  /**
   * Rate the answer shown (api.md 128): a thumbs-up saves a verified query,
   * a thumbs-down removes it. The same rating twice is a no-op.
   */
  rateAnswer(rating: MessageFeedback): void {
    const run = this.run();
    if (run === null || !run.answer || this.ratingPending()) return;
    if (run.answer.feedback === rating) return;
    this.ratingPending.set(true);
    this.runsApi.rateAnswer(run.id, rating).subscribe({
      next: (result) => {
        this.ratingPending.set(false);
        if (this.run()?.id === run.id) {
          this.run.update((shown) =>
            shown ? { ...shown, answer: result.run.answer } : shown,
          );
        }
        this.toast.success(result.message || 'Feedback saved');
      },
      error: (err) => {
        this.ratingPending.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /**
   * Stop the run (api.md 150): the stream is dropped and the server stops
   * the run, storing it `stopped` with any partial answer, shown as it
   * answers it. A run with no id yet is stopped as soon as it has one.
   */
  stop(): void {
    if (!this.running()) return;
    const id = this.runId();
    if (id === null) {
      this.stopRequested = true;
      this.running.set(false);
    } else {
      this.cancelStream();
      this.stopRun(id);
    }
    this.stopped.set(true);
    this.liveFinishedAt.set(new Date().toISOString());
  }

  /** Ask the server to stop the run, then show it as stored. */
  private stopRun(id: string): void {
    const generation = this.generation;
    this.stoppedSubscription = this.runTasks.stop(id).subscribe({
      next: (result) => {
        if (generation !== this.generation) return;
        if (result.run.status === 'running') {
          this.readBackStopped(id, generation, 0);
        } else {
          this.showStored(result.run);
        }
      },
      error: () => {
        if (generation === this.generation) {
          this.readBackStopped(id, generation, 0);
        }
      },
    });
  }

  /** Show a run opened on this page: a running one is followed live. */
  private showOrFollow(workflow: WorkflowDetail, run: WorkflowRun): void {
    if (run.status === 'running') this.follow(workflow, run);
    else this.showStored(run);
  }

  /** The run left running here, read again (121) and shown as it is now. */
  private reopen(workflow: WorkflowDetail, runId: string): void {
    const generation = this.generation;
    this.stoppedSubscription = this.runsApi.getRun(runId).subscribe({
      next: (run) => {
        if (generation !== this.generation) return;
        if (this.workflow()?.id !== workflow.id) return;
        this.inputValues.set(runAgainValues(workflow.input, run.input));
        this.showOrFollow(workflow, run);
      },
      error: () => undefined,
    });
  }

  /**
   * Follow a run that runs on the server (api.md 149; ADR-0048): its events
   * from the first one rebuild the live view (the steps, Thinking, tool
   * calls, the answer forming), then it goes on live to its end. A run the
   * server no longer holds is read back (121) and shown as stored.
   */
  private follow(workflow: WorkflowDetail, run: WorkflowRun): void {
    this.cancelStream();
    const generation = this.generation;
    const live = () => generation === this.generation;
    this.resetRun();
    const grouped: Record<string, WorkflowRunStep[]> = {};
    for (const step of run.steps) {
      (grouped[step.id] ??= []).push(step);
    }
    this.liveSteps.set(grouped);
    this.runId.set(run.id);
    this.liveInput.set(run.input ?? null);
    this.liveStartedAt.set(run.startedAt);
    this.running.set(true);
    const title = this.taskTitle(workflow, run.input);
    this.runTasks.track({
      id: run.id,
      workflowName: run.workflowName || workflow.name,
      title,
    });
    const controller = new AbortController();
    this.abort = controller;
    const base = this.streamHandlers(workflow, live, title);
    let refused: number | null = null;
    void this.runsApi
      .attachRun(
        run.id,
        {
          ...base,
          onRefused: (status) => {
            refused = status;
          },
          onError: (message, errors) => {
            if (!live()) return;
            if (refused === null) {
              base.onError?.(message, errors);
              return;
            }
            // No longer held: the stored run is how it ended.
            this.running.set(false);
            this.readBackStopped(run.id, generation, 0);
          },
        },
        controller.signal,
      )
      .finally(() => {
        if (!live()) return;
        this.running.set(false);
        this.abort = null;
      });
  }

  /** A run's task title: its question, else its first text input. */
  private taskTitle(
    workflow: WorkflowDetail,
    input: Record<string, WorkflowInputValue> | null | undefined,
  ): string {
    if (!input) return '';
    const field = questionFieldName(workflow.input);
    const question = field !== null ? input[field] : undefined;
    if (typeof question === 'string' && question.trim()) return question;
    const text = Object.values(input).find(
      (value): value is string => typeof value === 'string' && !!value.trim(),
    );
    return text ?? '';
  }

  private readBackStopped(id: string, generation: number, tries: number): void {
    this.stoppedSubscription = this.runsApi.getRun(id).subscribe({
      next: (run) => {
        if (generation !== this.generation) return;
        if (run.status === 'running' && tries + 1 < STOPPED_POLL_TRIES) {
          this.stoppedTimer = setTimeout(
            () => this.readBackStopped(id, generation, tries + 1),
            STOPPED_POLL_MS,
          );
          return;
        }
        if (run.status !== 'running') this.showStored(run);
      },
      error: () => undefined,
    });
  }

  private cancelStream(): void {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.running.set(false);
    this.stoppedSubscription?.unsubscribe();
    this.stoppedSubscription = null;
    if (this.stoppedTimer !== null) clearTimeout(this.stoppedTimer);
    this.stoppedTimer = null;
  }

  /** The run as stored: shown. */
  private showStored(run: WorkflowRun): void {
    this.run.set(run);
    this.prepareEvidence(run);
    // Its end shows here: its background task does not toast it.
    if (run.status !== 'running' && run.status !== 'suspended') {
      this.runTasks.markSeen(run.id);
    }
  }

  private resetRun(): void {
    this.openQueryIndex.set(null);
    this.queryRun.set(null);
    this.runId.set(null);
    this.run.set(null);
    this.contextRun.set(null);
    this.askStep.set('');
    this.liveInput.set(null);
    this.liveStartedAt.set(null);
    this.liveFinishedAt.set(null);
    this.liveSteps.set({});
    this.reasoning.set('');
    this.toolCalls.set([]);
    this.streamingText.set('');
    this.streamError.set(null);
    this.stopped.set(false);
    this.stopRequested = false;
    this.liveWaiting.set(null);
    this.resumeError.set(null);
  }

  /**
   * Answer the question a suspended run waits on (api.md 138): the SAME run
   * continues (same `runId`, its steps and attempts), its live progress
   * appended to what it had. A refusal before the stream leaves the run as
   * it was: an expired one reads as stopped, any other shows on the card.
   */
  resume(answer: string): void {
    const workflow = this.workflow();
    const stored = this.run();
    const waiting = this.waitingFor();
    const text = answer.trim();
    if (workflow === null || stored === null || waiting === null) return;
    if (this.running() || !text) return;
    if (stored.status !== 'suspended' || waiting.expired) return;
    this.cancelStream();
    const generation = this.generation;
    const live = () => generation === this.generation;
    const grouped: Record<string, WorkflowRunStep[]> = {};
    for (const step of stored.steps) {
      (grouped[step.id] ??= []).push(step);
    }
    this.resumeError.set(null);
    this.liveWaiting.set(null);
    this.liveSteps.set(grouped);
    this.runId.set(stored.id);
    this.liveInput.set(stored.input ?? null);
    this.liveStartedAt.set(stored.startedAt);
    this.liveFinishedAt.set(null);
    this.streamError.set(null);
    this.stopped.set(false);
    this.reasoning.set('');
    this.toolCalls.set([]);
    this.streamingText.set('');
    this.run.set(null);
    this.running.set(true);
    const controller = new AbortController();
    this.abort = controller;
    const base = this.streamHandlers(
      workflow,
      live,
      this.taskTitle(workflow, stored.input),
    );
    let refused: number | null = null;
    void this.runsApi
      .resumeRun(
        stored.id,
        waiting.stepId,
        text,
        {
          ...base,
          onRefused: (status) => {
            refused = status;
          },
          onError: (message, errors) => {
            if (!live()) return;
            if (refused === null) {
              base.onError?.(message, errors);
              return;
            }
            this.running.set(false);
            if (refused === 410) {
              this.showStored({
                ...stored,
                status: 'stopped',
                waitingFor: { ...waiting, expired: true },
              });
            } else {
              this.showStored(stored);
              this.resumeError.set(message);
            }
          },
        },
        controller.signal,
      )
      .finally(() => {
        if (!live()) return;
        this.running.set(false);
        this.abort = null;
      });
  }

  /**
   * An expired run: start a new one with the user's answer as a follow-up on
   * it (`context.fromRunId`).
   */
  rerunWithAnswer(answer: string): void {
    this.followUp(answer);
  }

  private start(
    workflow: WorkflowDetail,
    request: WorkflowRunRequest,
    context: { id: string; question: string; askedAgent?: string } | null,
  ): void {
    this.cancelStream();
    const generation = this.generation;
    this.resetRun();
    this.contextRun.set(context);
    this.liveInput.set(request.input);
    this.liveStartedAt.set(new Date().toISOString());
    this.runError.set(null);
    this.inputErrors.set([]);
    this.running.set(true);
    const controller = new AbortController();
    this.abort = controller;
    const live = () => generation === this.generation;

    void this.runsApi
      .streamRun(
        workflow.id,
        request,
        this.streamHandlers(
          workflow,
          live,
          this.taskTitle(workflow, request.input),
        ),
        controller.signal,
      )
      .finally(() => {
        if (!live()) return;
        this.running.set(false);
        this.abort = null;
      });
  }

  /**
   * The run stream's handlers, shared by a run, its resume and a run
   * followed again; `live` is false once superseded. Each run becomes a
   * background task (`title`) as soon as it has its id, so it stays listed
   * when the page is left (ADR-0048).
   */
  private streamHandlers(
    workflow: WorkflowDetail,
    live: () => boolean,
    title: string,
  ): RunStreamHandlers {
    return {
      onRun: ({ runId }) => {
        this.runTasks.track({ id: runId, workflowName: workflow.name, title });
        if (!live()) return;
        this.runId.set(runId);
        if (this.stopRequested) {
          this.stopRequested = false;
          this.cancelStream();
          this.stopRun(runId);
        }
      },
      onStep: (step) => {
        if (!live()) return;
        this.applyStep(workflow, step);
      },
      onInputRequired: (event) => {
        if (!live()) return;
        this.liveWaiting.set({
          stepId: event.stepId,
          title: event.title,
          question: event.question,
          options: event.options,
          expiresAt: event.expiresAt,
        });
      },
      onReasoning: (delta) => {
        if (live()) this.reasoning.update((text) => text + delta);
      },
      onText: (delta) => {
        if (live()) this.streamingText.update((text) => text + delta);
      },
      onTool: (call) => {
        if (!live()) return;
        this.toolCalls.update((calls) => [
          ...calls,
          { ...call, finished: false },
        ]);
      },
      onToolResult: (summary) => {
        if (!live()) return;
        this.updateOpenCall(summary.tool, (call) => ({
          ...call,
          finished: true,
          ...(summary.rowCount !== undefined
            ? { rowCount: summary.rowCount }
            : {}),
          ...(summary.error ? { error: summary.error } : {}),
        }));
      },
      onToolProgress: (progress) => {
        if (!live()) return;
        this.updateOpenCall(progress.tool, (call) => ({
          ...call,
          progress: progress.message,
        }));
      },
      onDone: (run) => {
        if (!live()) return;
        this.runId.set(run.id);
        if (run.status !== 'suspended') {
          this.liveFinishedAt.set(new Date().toISOString());
        }
        this.running.set(false);
        this.showStored(run);
      },
      onError: (message, errors) => {
        if (!live()) return;
        if (this.runId() === null) {
          // Refused (or unreachable) before the run started: no result.
          this.runError.set(
            errors ? this.unshownError(workflow, errors) : message,
          );
          if (errors) this.refuse(errors);
          this.resetRun();
        } else {
          this.streamError.set(message);
          this.liveFinishedAt.set(new Date().toISOString());
        }
        this.running.set(false);
      },
    };
  }

  /**
   * A step event: replaces the event of the same attempt, or adds the next
   * attempt. An agent step that starts begins with no live tool calls or
   * reasoning of its own (an earlier agent step's are in its stored event).
   */
  private applyStep(workflow: WorkflowDetail, step: WorkflowRunStep): void {
    const attempt = step.attempt ?? 1;
    this.liveSteps.update((steps) => {
      const list = Object.hasOwn(steps, step.id) ? [...steps[step.id]] : [];
      const at = list.findIndex((e) => (e.attempt ?? 1) === attempt);
      if (at >= 0) list[at] = step;
      else list.push(step);
      list.sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
      return { ...steps, [step.id]: list };
    });
    const kind = workflow.steps.find((s) => s.id === step.id)?.kind;
    if (kind === 'agent' && step.status === 'running') {
      this.toolCalls.set([]);
      this.reasoning.set('');
    }
  }

  /**
   * The first refusal no form control shows (not about a field, or about a
   * hidden one): it stays under Execute; null when every error has a field.
   */
  private unshownError(
    workflow: WorkflowDetail,
    errors: WorkflowInputError[],
  ): string | null {
    const shown = new Set(
      workflow.input.filter((f) => !f.hidden).map((f) => f.name),
    );
    const other = errors.find(
      (error) => error.field === null || !shown.has(error.field),
    );
    return other?.message ?? null;
  }

  /** Update the latest unfinished call of `tool`. */
  private updateOpenCall(
    tool: string,
    change: (call: LiveToolCall) => LiveToolCall,
  ): void {
    this.toolCalls.update((calls) => {
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i].name === tool && !calls[i].finished) {
          const next = [...calls];
          next[i] = change(calls[i]);
          return next;
        }
      }
      return calls;
    });
  }
}
