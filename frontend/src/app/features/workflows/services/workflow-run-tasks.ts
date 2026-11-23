import { Injectable, Injector, inject } from '@angular/core';
import { Observable, exhaustMap, retry, takeWhile, timer } from 'rxjs';
import {
  BackgroundTask,
  BackgroundTaskHandle,
  BackgroundTaskPerson,
  BackgroundTaskProgress,
  BackgroundTasksService,
} from '../../../core/background-tasks/background-tasks.service';
import { RunsState } from '../../runs/services/runs-state';
import {
  LiveToolCall,
  WorkflowDetail,
  WorkflowRun,
  WorkflowRunStep,
} from '../models/workflow.model';
import { WorkflowRunsApiService } from './workflow-runs-api.service';
import { WorkflowsApiService } from './workflows-api.service';
import {
  StoryRunStep,
  agentStepStories,
  teamActivity,
} from './agent-step-story';

/** How often a run's task reads the run (api.md 121) until it ends. */
export const RUN_TASK_POLL_MS = 3000;

/** A live team told by the page this recently wins over the stored run. */
const LIVE_FRESH_MS = 10_000;

/** The longest run title in a task's title, in characters. */
const TITLE_MAX = 80;

/** A run to follow as a background task. */
export interface TrackedRun {
  id: string;
  workflowName: string;
  /** The run's question or input summary (120's `title`). */
  title: string;
}

/** `<workflow name>: <run title>`, the run title cut at 80 characters. */
export function runTaskTitle(workflowName: string, title: string): string {
  const text = title.trim().replace(/\s+/g, ' ');
  const cut =
    text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
  return cut ? `${workflowName}: ${cut}` : workflowName;
}

/** What a running run's task row says: `Waiting for a free slot`, `Waiting for you`, or its running step. */
export function runTaskDetail(run: WorkflowRun): string | null {
  if (run.status === 'queued') return 'Waiting for a free slot';
  if (run.status === 'suspended') return 'Waiting for you';
  const step = [...(run.steps ?? [])]
    .reverse()
    .find((candidate) => candidate.status === 'running');
  return step ? step.title : null;
}

/** What a running run's task row shows of its agents (ui.md 3.7). */
export interface RunTaskTeam {
  /** `Michael is running query 2 · step 4 of 9`; the plain detail when no agent works. */
  detail: string | null;
  progress: BackgroundTaskProgress | null;
  people: BackgroundTaskPerson[] | null;
}

/**
 * The run's agents for its task row: their faces and states, who works now
 * and how far the run is, told from the run's steps and its workflow's
 * catalogue (`agentStepStories`). With no catalogue, the plain detail.
 */
export function runTaskTeam(
  run: WorkflowRun,
  workflow: WorkflowDetail | null,
): RunTaskTeam {
  const lastAttempt = new Map<string, WorkflowRunStep>();
  for (const step of run.steps ?? []) lastAttempt.set(step.id, step);
  return teamFromSteps(
    workflow,
    [...lastAttempt.values()],
    ACTIVE.has(run.status),
    runTaskDetail(run),
  );
}

/**
 * The same, from the steps the workflow page streams: who works now is
 * known there, while the stored run has its steps only once it ends.
 */
export function teamFromSteps(
  workflow: WorkflowDetail | null,
  steps: readonly StoryRunStep[],
  running: boolean,
  plain: string | null,
  liveToolCalls?: readonly LiveToolCall[],
): RunTaskTeam {
  if (!workflow) return { detail: plain, progress: null, people: null };
  const byId = new Map(steps.map((step) => [step.id, step]));
  const stories = agentStepStories({
    steps: workflow.steps,
    runSteps: steps,
    running,
    liveToolCalls,
  });
  const told = steps.some((step) => step.status !== null);
  const total = workflow.steps.length;
  const done = workflow.steps.filter((step) => {
    const status = byId.get(step.id)?.status;
    return status === 'success' || status === 'skipped' || status === 'failed';
  }).length;
  const people = [...stories.values()]
    .filter((story) => story.state !== 'skipped')
    .map<BackgroundTaskPerson>((story) => ({
      key: story.agent.key,
      name: story.agent.name,
      state: !told
        ? 'unknown'
        : story.state === 'active' || story.state === 'asking'
          ? 'active'
          : story.state === 'done' ||
              story.state === 'failed' ||
              story.state === 'stopped'
            ? 'done'
            : 'waiting',
    }));
  const who = teamActivity(stories.values());
  const at = Math.min(done + 1, total);
  return {
    detail: who ? `${who} · step ${at} of ${total}` : plain,
    progress: told && total > 0 ? { done, total } : null,
    people: people.length > 0 ? people : null,
  };
}

const ACTIVE: ReadonlySet<WorkflowRun['status']> = new Set([
  'queued',
  'running',
  'suspended',
]);

/**
 * Workflow runs as background tasks (ADR-0047, ADR-0048; workflows R16):
 * a run runs on the server whatever screen is shown, so its task only
 * follows it, reading the run (121) every 3 s until it ends (one request at
 * a time, never an SSE connection per run). A run waiting for the user
 * stays running, `Waiting for you`. Stop on the task stops the run (150);
 * Open shows it on its workflow's page, as Runs opens a run. At start-up the
 * runs the server still runs, or that wait, get their task back.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowRunTasks {
  private readonly tasks = inject(BackgroundTasksService);
  private readonly api = inject(WorkflowRunsApiService);
  private readonly workflows = inject(WorkflowsApiService);
  /** Each workflow's catalogue, read once, for its runs' agents; null when it cannot be read. */
  private readonly catalogue = new Map<
    string,
    WorkflowDetail | null | 'loading'
  >();
  /** When the workflow page last told a run's team live, by run id. */
  private readonly liveAt = new Map<string, number>();
  private readonly injector = inject(Injector);
  /** Runs being stopped through `stop`: their task's Stop sends nothing more. */
  private readonly stopping = new Set<string>();
  /** The run the workflow page shows: its end is not toasted. */
  private shown: () => string | null = () => null;
  /** The runs whose end the page showed already: their end is not toasted. */
  private readonly seen = new Set<string>();

  /** The workflow page tells which run it shows (its end shows there). */
  watchShown(shown: () => string | null): void {
    this.shown = shown;
  }

  /** The page showed this run's end (its stored run); no toast for it. */
  markSeen(id: string): void {
    if (this.tasks.active('workflow-run', id)) this.seen.add(id);
  }

  /** Follow a run as a task; a run followed already keeps its task. */
  track(run: TrackedRun): BackgroundTask {
    const id = run.id;
    return this.tasks.start<WorkflowRun>({
      kind: 'workflow-run',
      key: id,
      title: runTaskTitle(run.workflowName, run.title),
      work: () => this.poll(id),
      onValue: (value, task) => this.showTeam(value, task),
      outcome: (last) =>
        last?.status === 'success'
          ? { ok: true }
          : {
              ok: false,
              message:
                last?.status === 'stopped'
                  ? 'Run stopped'
                  : (last?.error ?? 'The run failed'),
            },
      open: () => this.injector.get(RunsState).openRun(id),
      // A stopped run says so where it shows; the page shows its own end.
      toast: (task) => {
        const seen = this.seen.delete(id);
        return (
          (task.result as WorkflowRun | undefined)?.status !== 'stopped' &&
          !seen &&
          this.shown() !== id
        );
      },
      onCancel: () => {
        if (this.stopping.has(id)) return;
        this.api.stopRun(id).subscribe({ error: () => undefined });
      },
    });
  }

  /**
   * Stop a run (api.md 150) from its page: its task ends `stopped`, with no
   * toast, and the stored run is answered.
   */
  stop(
    id: string,
  ): Observable<{ ok: boolean; message: string; run: WorkflowRun }> {
    const task = this.tasks.active('workflow-run', id);
    if (task) {
      this.stopping.add(id);
      try {
        this.tasks.cancel(task.id);
      } finally {
        this.stopping.delete(id);
      }
    }
    return this.api.stopRun(id);
  }

  /**
   * At start-up: a task for every run the server still runs or that waits
   * for the user (api.md 120), retried while the backend starts.
   */
  trackActive(): void {
    this.api
      .list()
      .pipe(
        retry({
          count: 12,
          delay: (_error, attempt) => timer(Math.min(attempt * 200, 1_000)),
        }),
      )
      .subscribe({
        next: ({ runs }) => {
          for (const run of runs) {
            if (ACTIVE.has(run.status)) this.track(run);
          }
        },
        error: () => undefined,
      });
  }

  /**
   * The task row's agents (ui.md 3.7): from the run and its workflow's
   * catalogue, which is read the first time; until then, the plain detail.
   */
  private showTeam(run: WorkflowRun, task: BackgroundTaskHandle): void {
    // The page streams this run: its live team is truer than the stored run,
    // except while it is queued, when the stream has no steps to tell.
    const live = this.liveAt.get(run.id);
    if (run.status !== 'queued' && live !== undefined && Date.now() - live < LIVE_FRESH_MS) return;
    const known = this.catalogue.get(run.workflowId);
    if (known === undefined) {
      this.catalogue.set(run.workflowId, 'loading');
      this.workflows.getWorkflow(run.workflowId).subscribe({
        next: (detail) => {
          this.catalogue.set(run.workflowId, detail);
          task.update(runTaskTeam(run, detail));
        },
        error: () => this.catalogue.set(run.workflowId, null),
      });
    }
    task.update(runTaskTeam(run, known && known !== 'loading' ? known : null));
  }

  /**
   * The workflow page streams a run: its task row shows the live team (who
   * works now, how far), which the stored run cannot tell before it ends.
   */
  showLive(
    runId: string,
    workflow: WorkflowDetail,
    steps: readonly StoryRunStep[],
    liveToolCalls: readonly LiveToolCall[],
  ): void {
    const task = this.tasks.active('workflow-run', runId);
    if (!task) return;
    this.liveAt.set(runId, Date.now());
    this.tasks.update(
      task.id,
      teamFromSteps(workflow, steps, true, task.detail, liveToolCalls),
    );
  }

  /** The run, every 3 s, until it ends (its last read included). */
  private poll(id: string): Observable<WorkflowRun> {
    return timer(RUN_TASK_POLL_MS, RUN_TASK_POLL_MS).pipe(
      exhaustMap(() =>
        this.api.getRun(id).pipe(retry({ count: 2, delay: RUN_TASK_POLL_MS })),
      ),
      takeWhile((run) => ACTIVE.has(run.status), true),
    );
  }
}
