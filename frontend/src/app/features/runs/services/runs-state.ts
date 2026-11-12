import { Injectable, computed, inject, signal } from '@angular/core';
import { retry, timer } from 'rxjs';
import { ShellState } from '../../../core/shell/shell-state';
import { ToastService } from '../../../core/toast/toast.service';
import {
  WorkflowRun,
  WorkflowRunSummary,
} from '../../workflows/models/workflow.model';
import { WorkflowDesigner } from '../../workflows/services/workflow-designer.service';
import { WorkflowRunsApiService } from '../../workflows/services/workflow-runs-api.service';
import { WorkflowsApiService } from '../../workflows/services/workflows-api.service';
import { WorkflowsNavState } from '../../workflows/services/workflows-nav-state';

/** The two tabs of the Runs page (app-shell R3, R46). */
export type RunsTab = 'runs' | 'past-chats';

/**
 * The Runs area's state: the run history, the open run, and Run again. Past
 * chats keep `SessionsState`.
 */
@Injectable({ providedIn: 'root' })
export class RunsState {
  private readonly shell = inject(ShellState);
  private readonly toast = inject(ToastService);
  private readonly api = inject(WorkflowRunsApiService);
  private readonly workflowsApi = inject(WorkflowsApiService);
  private readonly designer = inject(WorkflowDesigner);
  private readonly workflowsNav = inject(WorkflowsNavState);

  readonly tab = signal<RunsTab>('runs');
  readonly runs = signal<WorkflowRunSummary[]>([]);
  readonly runsLoaded = signal(false);
  readonly deletingRun = signal<string | null>(null);

  readonly activeRun = signal<WorkflowRun | null>(null);
  readonly loadingRun = signal(false);
  readonly runError = signal<string | null>(null);
  /**
   * Run again is offered only once the open run's workflow is found in the
   * catalogue (api.md 117): a run of a removed workflow reads as a plain run.
   */
  readonly canRunAgain = signal(false);

  /** The open run's title as the Runs list shows it. */
  readonly activeTitle = computed(() => {
    const run = this.activeRun();
    if (run === null) return 'Run';
    const listed = this.runs().find((r) => r.id === run.id);
    return listed?.title ?? run.question ?? run.workflowName;
  });

  setTab(tab: RunsTab): void {
    this.tab.set(tab);
  }

  loadRuns(): void {
    this.api
      .list()
      .pipe(
        retry({
          count: 12,
          delay: (_error, retryCount) =>
            timer(Math.min(retryCount * 200, 1_000)),
        }),
      )
      .subscribe({
        next: (res) => {
          this.runs.set(res.runs);
          this.runsLoaded.set(true);
        },
        error: () => {
          this.runsLoaded.set(true);
          this.toast.error('Could not load runs');
        },
      });
  }

  /** A row of the Runs list, or a Monitoring run, opens its stored run. */
  openRun(id: string): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.shell.settingsOpen.set(false);
    this.activeRun.set(null);
    this.runError.set(null);
    this.canRunAgain.set(false);
    this.loadingRun.set(true);
    this.tab.set('runs');
    this.shell.mainView.set('run-detail');
    this.api.getRun(id).subscribe({
      next: (run) => {
        this.activeRun.set(run);
        this.loadingRun.set(false);
        this.checkWorkflow(run);
      },
      error: (err) => {
        this.runError.set(err?.error?.message ?? 'Backend unreachable');
        this.loadingRun.set(false);
      },
    });
  }

  /** Whether the run's workflow is still in the catalogue: Run again shows. */
  private checkWorkflow(run: WorkflowRun): void {
    this.workflowsApi.getWorkflow(run.workflowId).subscribe({
      next: () => {
        if (this.activeRun()?.id === run.id) this.canRunAgain.set(true);
      },
      error: () => {
        if (this.activeRun()?.id === run.id) this.canRunAgain.set(false);
      },
    });
  }

  /** Back to the Runs list. */
  closeRun(): void {
    this.activeRun.set(null);
    this.shell.mainView.set('runs');
  }

  deleteRun(run: WorkflowRunSummary): void {
    if (run.status === 'running') {
      this.toast.error('Stop the run before deleting it');
      return;
    }
    const confirmed = window.confirm(
      `Delete the run “${run.title}”?\n\nThis permanently removes the run and its workspace files.`,
    );
    if (!confirmed) return;
    this.deletingRun.set(run.id);
    this.api.delete(run.id).subscribe({
      next: (res) => {
        this.deletingRun.set(null);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.runs.update((rows) => rows.filter((r) => r.id !== run.id));
        if (this.activeRun()?.id === run.id) this.closeRun();
        this.toast.success(res.message);
      },
      error: (err) => {
        this.deletingRun.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /**
   * Run again with this input: the run's workflow opens on its Run tab with
   * the form filled in; the user presses Run.
   */
  runAgain(run: WorkflowRun): void {
    this.designer.prefillRunAgain(run.input);
    this.workflowsNav.openWorkflow(run.workflowId);
  }
}
