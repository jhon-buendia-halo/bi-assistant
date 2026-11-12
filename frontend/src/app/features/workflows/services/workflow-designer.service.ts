import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  Dataset,
  DatasetsApiService,
} from '../../datasets/services/datasets-api.service';
import { ToastService } from '../../../core/toast/toast.service';
import {
  ChatMessage,
  MessageFeedback,
  WorkflowView,
} from '../../sessions/models/session.model';
import {
  WorkflowDetail,
  WorkflowInputValue,
  WorkflowRun,
  WorkflowRunRequest,
  WorkflowRunStep,
  WorkflowRunStepStatus,
} from '../models/workflow.model';
import { WorkflowRunsApiService } from './workflow-runs-api.service';
import { WorkflowsApiService } from './workflows-api.service';
import {
  RunFormValues,
  canRunFromPage,
  followUpRequest,
  initialInputValues,
  questionFieldName,
  runAgainValues,
  runInput,
} from './workflows.util';

/** The right panel's tabs on a workflow's page (ui.md 4.4b). */
export type WorkflowPanelTab = 'workflow' | 'step' | 'run' | 'code';

export const WORKFLOW_PANEL_TABS: readonly {
  id: WorkflowPanelTab;
  label: string;
}[] = [
  { id: 'workflow', label: 'Workflow' },
  { id: 'step', label: 'Step' },
  { id: 'run', label: 'Run' },
  { id: 'code', label: 'Code' },
];

/** A tool call of the run's agent turn, as it streams (api.md 3.1). */
export interface LiveToolCall {
  name: string;
  rationale?: string;
  input?: string;
  rowCount?: number;
  error?: string;
  /** The latest `tool-progress` message of a long-running tool. */
  progress?: string;
  /** Its `tool-result` arrived. */
  finished: boolean;
}

/** One step of the run shown, in the workflow's order. */
export interface RunStepView {
  id: string;
  title: string;
  kind: 'code' | 'agent';
  /** Null for a step that has not started yet. */
  status: WorkflowRunStepStatus | null;
  output?: Record<string, unknown>;
  outputTruncated?: true;
  error?: string;
}

/** The run shown in the Run tab: live while it streams, then as stored. */
export interface RunView {
  status: WorkflowRun['status'];
  error?: string;
  steps: RunStepView[];
  output?: Record<string, unknown>;
  /** Agent workflows: the answer (absent while streaming, or when none came). */
  answer?: ChatMessage;
}

/** How often, and how many times, a stopped run is read back until it is stored. */
const STOPPED_POLL_MS = 300;
const STOPPED_POLL_TRIES = 10;

/**
 * The state of the workflow designer, shared by the page in the content area
 * (header and canvas) and its right panel (workflows R7, R12, R13, R21): the
 * open workflow, the selected step, the panel's tab, the run form, and the
 * run shown, streamed live (api.md 119, 3.6) and then as stored. Leaving the
 * page discards the form and the run shown (the run itself stays stored).
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

  readonly selectedStepId = signal<string | null>(null);
  readonly tab = signal<WorkflowPanelTab>('workflow');

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

  /** Live: the step events so far, by step id. */
  readonly liveSteps = signal<Record<string, WorkflowRunStep>>({});
  /** Live: the agent's reasoning so far. */
  readonly reasoning = signal('');
  /** Live: the agent's tool calls so far. */
  readonly toolCalls = signal<LiveToolCall[]>([]);
  /** Live: the answer text so far (not authoritative; `done.run` replaces it). */
  readonly streamingText = signal('');
  /** Live: the agent's phases (`workflow` event), for the phases bar. */
  private readonly livePhases = signal<WorkflowView | null>(null);
  /** The agent's phases bar: live while it streams, then as stored. */
  readonly phases = computed<WorkflowView | null>(
    () => this.run()?.workflow ?? this.livePhases(),
  );
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

  /** The tabs this workflow has: Run only when it runs from its page (R21). */
  readonly tabs = computed(() => {
    const workflow = this.workflow();
    return WORKFLOW_PANEL_TABS.filter(
      (tab) =>
        tab.id !== 'run' || (workflow !== null && canRunFromPage(workflow)),
    );
  });

  readonly selectedStep = computed(() => {
    const workflow = this.workflow();
    const id = this.selectedStepId();
    if (workflow === null || id === null) return null;
    const index = workflow.steps.findIndex((step) => step.id === id);
    return index < 0 ? null : { step: workflow.steps[index], number: index + 1 };
  });

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
      return {
        status: stored.status,
        ...(stored.error !== undefined ? { error: stored.error } : {}),
        steps: stored.steps.map((step) => ({
          ...step,
          kind: kinds.get(step.id) ?? 'code',
        })),
        ...(stored.output !== undefined ? { output: stored.output } : {}),
        ...(stored.answer !== undefined ? { answer: stored.answer } : {}),
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
          ...(event?.output !== undefined ? { output: event.output } : {}),
          ...(event?.outputTruncated ? { outputTruncated: true as const } : {}),
          ...(event?.error !== undefined ? { error: event.error } : {}),
        };
      }),
    };
  });

  /** Each step's status in the run shown, by step id; empty with no run. */
  readonly stepStatuses = computed<Record<string, WorkflowRunStepStatus>>(() => {
    const statuses: Record<string, WorkflowRunStepStatus> = {};
    for (const step of this.runResult()?.steps ?? []) {
      if (step.status !== null) statuses[step.id] = step.status;
    }
    return statuses;
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

  /**
   * Run again (plan 1.24.11): the next workflow opened shows its Run tab with
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
          this.setTab('run');
        }
        if (
          workflow.input.some(
            (field) =>
              !field.hidden &&
              (field.type === 'datasets' || field.type === 'dataset'),
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
    this.tab.set('workflow');
    this.datasets.set([]);
    this.inputValues.set({});
    this.followUpText.set('');
    this.runError.set(null);
    this.resetRun();
  }

  /** Select a step (the panel shows it on Step), or clear the selection. */
  select(id: string | null): void {
    this.selectedStepId.set(id);
    if (id !== null) this.tab.set('step');
  }

  setTab(tab: WorkflowPanelTab): void {
    if (this.tabs().some((t) => t.id === tab)) this.tab.set(tab);
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

  /** Run the workflow once on the form's values (api.md 119). */
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
    this.start(workflow, followUpRequest(run, field, text), {
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
        if (run.status !== 'running') this.run.set(run);
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

  private resetRun(): void {
    this.runId.set(null);
    this.run.set(null);
    this.contextRun.set(null);
    this.liveSteps.set({});
    this.reasoning.set('');
    this.toolCalls.set([]);
    this.streamingText.set('');
    this.livePhases.set(null);
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
            if (live()) this.runId.set(runId);
          },
          onStep: (step) => {
            if (!live()) return;
            this.liveSteps.update((steps) => ({ ...steps, [step.id]: step }));
          },
          onReasoning: (delta) => {
            if (live()) this.reasoning.update((text) => text + delta);
          },
          onWorkflow: (view) => {
            if (live()) this.livePhases.set(view);
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
            this.run.set(run);
            this.runId.set(run.id);
            this.running.set(false);
          },
          onError: (message) => {
            if (!live()) return;
            if (this.runId() === null) {
              // Refused (or unreachable) before the run started: no result.
              this.runError.set(message);
              this.resetRun();
            } else {
              this.streamError.set(message);
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
