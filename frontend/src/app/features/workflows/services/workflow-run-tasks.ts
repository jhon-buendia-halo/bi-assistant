import { Injectable, Injector, inject } from '@angular/core';
import { Observable, exhaustMap, retry, takeWhile, timer } from 'rxjs';
import {
  BackgroundTask,
  BackgroundTasksService,
} from '../../../core/background-tasks/background-tasks.service';
import { RunsState } from '../../runs/services/runs-state';
import { WorkflowRun } from '../models/workflow.model';
import { WorkflowRunsApiService } from './workflow-runs-api.service';

/** How often a run's task reads the run (api.md 121) until it ends. */
export const RUN_TASK_POLL_MS = 3000;

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

/** What a running run's task row says: `Waiting for you`, or its running step. */
export function runTaskDetail(run: WorkflowRun): string | null {
  if (run.status === 'suspended') return 'Waiting for you';
  const step = [...(run.steps ?? [])]
    .reverse()
    .find((candidate) => candidate.status === 'running');
  return step ? step.title : null;
}

const ACTIVE: ReadonlySet<WorkflowRun['status']> = new Set([
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
      onValue: (value, task) => task.update({ detail: runTaskDetail(value) }),
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
