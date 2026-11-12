import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  Dataset,
  DatasetsApiService,
} from '../../datasets/services/datasets-api.service';
import { ToastService } from '../../../core/toast/toast.service';
import { MessageFeedback } from '../../sessions/models/session.model';
import {
  LiveToolCall,
  RunStepView,
  RunView,
  WorkflowDetail,
  WorkflowInputValue,
  WorkflowRun,
  WorkflowRunRequest,
  WorkflowRunStep,
  WorkflowRunStepStatus,
} from '../models/workflow.model';
import {
  NodeInspection,
  WorkflowStateSummary,
} from '../models/workflow-node.model';
import {
  NodeInspectionSource,
  buildNodeInspections,
  buildToolInspection,
  nodeStatuses,
  workflowStateSummary,
} from './workflow-node-inspection';
import { WorkflowRunsApiService } from './workflow-runs-api.service';
import { WorkflowsApiService } from './workflows-api.service';
import {
  RunFormValues,
  followUpRequest,
  initialInputValues,
  questionFieldName,
  runAgainValues,
  runInput,
} from './workflows.util';

export type { LiveToolCall, RunStepView, RunView };

/** How often, and how many times, a stopped run is read back until it is stored. */
const STOPPED_POLL_MS = 300;
const STOPPED_POLL_TRIES = 10;

const NO_RUN_SUMMARY: WorkflowStateSummary = {
  status: null,
  ran: 0,
  total: 0,
  durationMs: null,
  runId: null,
};

/**
 * The state of the workflow designer, shared by the page in the content area
 * (header, canvas, Workflow state panel, node dialog) and its right panel,
 * the Run form (workflows R7, R12, R13, R21): the open workflow, the selected
 * and the open node, the run form, and the run shown, streamed live (api.md
 * 119, 3.6) and then as stored. Leaving the page discards the form and the
 * run shown (the run itself stays stored).
 */
@Injectable({ providedIn: 'root' })
export class WorkflowDesigner {
  private readonly api = inject(WorkflowsApiService);
  private readonly runsApi = inject(WorkflowRunsApiService);
  private readonly toast = inject(ToastService);
  private readonly datasetsApi = inject(DatasetsApiService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly workflow = signal<WorkflowDetail | null>(null);

  /** The selected node: a step id, `start` or `end`; null for none. */
  readonly selectedStepId = signal<string | null>(null);
  /** The node whose dialog is open; null when none is. */
  readonly openNodeId = signal<string | null>(null);
  /** Whether the Workflow state panel under the canvas is expanded. */
  readonly stateOpen = signal(true);
  /**
   * Bumped by Execute workflow on the canvas: the right panel focuses the run
   * form. Execute workflow itself never runs.
   */
  readonly runFormRequest = signal(0);

  /** The datasets a `datasets` or `dataset` field picks from. */
  readonly datasets = signal<Dataset[]>([]);
  /** The run form's values, by field name. */
  readonly inputValues = signal<RunFormValues>({});
  /** The follow-up field under an answer. */
  readonly followUpText = signal('');

  readonly running = signal(false);
  /** The server's refusal of the last Execute (before anything ran), or `Backend unreachable`. */
  readonly runError = signal<string | null>(null);

  /** The run streaming or shown: its id once the stream said it started. */
  readonly runId = signal<string | null>(null);
  /** The run as stored (`done.run`, or read back after a stop). */
  readonly run = signal<WorkflowRun | null>(null);
  /** The shown answer's rating is being saved. */
  readonly ratingPending = signal(false);
  /** The earlier run this one follows up (its context), if any. */
  readonly contextRun = signal<{ id: string; question: string } | null>(null);

  /** The input of the run started here (Execute, Follow up, Continue); null before one. */
  readonly liveInput = signal<Record<string, WorkflowInputValue> | null>(null);
  /** Live: when the run started and ended, stamped here. */
  private readonly liveStartedAt = signal<string | null>(null);
  private readonly liveFinishedAt = signal<string | null>(null);
  /** Live: the step events so far, by step id. */
  readonly liveSteps = signal<Record<string, WorkflowRunStep>>({});
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

  /** Run again: the values the next loaded workflow's form opens with. */
  private prefill: RunFormValues | null = null;

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
        ...(finishedAt !== null && finishedAt !== undefined ? { finishedAt } : {}),
      };
    }
    if (this.runId() === null && !this.running() && !this.stopped()) {
      return null;
    }
    const live = this.liveSteps();
    const failure = this.streamError();
    const status: RunView['status'] = this.stopped()
      ? 'stopped'
      : failure !== null
        ? 'failed'
        : 'running';
    const startedAt = this.liveStartedAt();
    const finishedAt = this.liveFinishedAt();
    return {
      status,
      ...(failure !== null ? { error: failure } : {}),
      steps: workflow.steps.map((step) => {
        const event = Object.hasOwn(live, step.id) ? live[step.id] : null;
        let stepStatus = event === null ? null : event.status;
        if (stepStatus === 'running' && status !== 'running') {
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
          ...(event?.outputTruncated ? { outputTruncated: true as const } : {}),
          ...(event?.error !== undefined ? { error: event.error } : {}),
          ...(event?.startedAt !== undefined ? { startedAt: event.startedAt } : {}),
          ...(event?.endedAt !== undefined ? { endedAt: event.endedAt } : {}),
          ...(event?.toolCalls !== undefined ? { toolCalls: event.toolCalls } : {}),
        };
      }),
      runId: this.runId(),
      input: this.liveInput(),
      ...(startedAt !== null ? { startedAt } : {}),
      ...(finishedAt !== null ? { finishedAt } : {}),
    };
  });

  private readonly inspectionSource = computed<NodeInspectionSource | null>(() => {
    const workflow = this.workflow();
    if (workflow === null) return null;
    return {
      workflow,
      run: this.runResult(),
      liveToolCalls: this.toolCalls(),
      running: this.running(),
    };
  });

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

  /** Each node's status in the run shown (Start and End included); empty with no run. */
  readonly nodeStatuses = computed<Record<string, WorkflowRunStepStatus>>(() =>
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

  /**
   * Run again (plan 1.24.11): the next workflow opened shows its run form with
   * this earlier run's input filled in.
   */
  prefillRunAgain(input: WorkflowRun['input']): void {
    this.prefill = input as RunFormValues;
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
        if (this.prefill !== null) {
          const input = this.prefill;
          this.prefill = null;
          this.inputValues.set(runAgainValues(workflow.input, input));
          this.requestRunForm();
        }
        if (
          workflow.input.some(
            (field) => !field.hidden && field.type === 'datasets',
          )
        ) {
          this.loadDatasets();
        }
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  private loadDatasets(): void {
    this.datasetsSubscription = this.datasetsApi.getDatasets().subscribe({
      next: (response) => this.datasets.set(response.datasets ?? []),
      error: () => this.datasets.set([]),
    });
  }

  /** Leaving the page discards the workflow, the selection and the run shown (R13). */
  clear(): void {
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
    this.runFormRequest.set(0);
    this.datasets.set([]);
    this.inputValues.set({});
    this.followUpText.set('');
    this.runError.set(null);
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

  /** Execute workflow on the canvas: ask the right panel to focus its run form. */
  requestRunForm(): void {
    this.runFormRequest.update((n) => n + 1);
  }

  setInput(name: string, value: WorkflowInputValue): void {
    this.inputValues.update((values) => ({ ...values, [name]: value }));
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
   * Run the workflow once on the form's values (api.md 119).
   */
  execute(): void {
    const workflow = this.workflow();
    if (workflow === null || this.running()) return;
    this.start(workflow, { input: runInput(workflow.input, this.inputValues()) }, null);
  }

  /**
   * Follow up on the answer shown, or answer its clarifying question: a new
   * run on the same input with this question, the shown run as its context
   * (plan 5.4; workflows R17, R21). The form's question becomes it.
   */
  followUp(question: string): void {
    const workflow = this.workflow();
    const run = this.run();
    const field = this.questionField();
    const text = question.trim();
    if (workflow === null || run === null || field === null || !text) return;
    if (this.running()) return;
    this.setInput(field, text);
    this.followUpText.set('');
    const request = followUpRequest(run, field, text);
    this.start(workflow, request, {
      id: run.id,
      question: run.question ?? '',
    });
  }

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
   * Stop the run (api.md 3.6): the stream is aborted, the server stores the
   * run `stopped` with any partial answer, which is then read back.
   */
  stop(): void {
    if (!this.running()) return;
    this.cancelStream();
    this.stopped.set(true);
    this.liveFinishedAt.set(new Date().toISOString());
    const id = this.runId();
    if (id !== null) this.readBackStopped(id, this.generation, 0);
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
  }

  private resetRun(): void {
    this.runId.set(null);
    this.run.set(null);
    this.contextRun.set(null);
    this.liveInput.set(null);
    this.liveStartedAt.set(null);
    this.liveFinishedAt.set(null);
    this.liveSteps.set({});
    this.reasoning.set('');
    this.toolCalls.set([]);
    this.streamingText.set('');
    this.streamError.set(null);
    this.stopped.set(false);
  }

  private start(
    workflow: WorkflowDetail,
    request: WorkflowRunRequest,
    context: { id: string; question: string } | null,
  ): void {
    this.cancelStream();
    const generation = this.generation;
    this.resetRun();
    this.contextRun.set(context);
    this.liveInput.set(request.input);
    this.liveStartedAt.set(new Date().toISOString());
    this.runError.set(null);
    this.running.set(true);
    const controller = new AbortController();
    this.abort = controller;
    const live = () => generation === this.generation;

    void this.runsApi
      .streamRun(
        workflow.id,
        request,
        {
          onRun: ({ runId }) => {
            if (!live()) return;
            this.runId.set(runId);
          },
          onStep: (step) => {
            if (!live()) return;
            this.liveSteps.update((steps) => ({ ...steps, [step.id]: step }));
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
            this.liveFinishedAt.set(new Date().toISOString());
            this.running.set(false);
            this.showStored(run);
          },
          onError: (message) => {
            if (!live()) return;
            if (this.runId() === null) {
              // Refused (or unreachable) before the run started: no result.
              this.runError.set(message);
              this.resetRun();
            } else {
              this.streamError.set(message);
              this.liveFinishedAt.set(new Date().toISOString());
            }
            this.running.set(false);
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
