import { Injectable, computed, inject, signal } from '@angular/core';
import { retry, timer } from 'rxjs';
import { ShellState } from '../../../core/shell/shell-state';
import { ToastService } from '../../../core/toast/toast.service';
import {
  WorkflowRun,
  WorkflowRunSummary,
} from '../../workflows/models/workflow.model';
import {
  agentKeyOfBinding,
  isConversationalAgentWorkflow,
} from '../../agents/models/conversation.model';
import { AgentsNavState } from '../../agents/services/agents-nav-state';
import { WorkflowDesigner } from '../../workflows/services/workflow-designer.service';
import { WorkflowRunsApiService } from '../../workflows/services/workflow-runs-api.service';
import { WorkflowsApiService } from '../../workflows/services/workflows-api.service';
import { WorkflowsNavState } from '../../workflows/services/workflows-nav-state';
import { isLiveRun } from '../../workflows/services/workflows.util';

/** The two tabs of the Runs page (app-shell R3, R46). */
export type RunsTab = 'runs' | 'past-chats';

/**
 * The Runs area's state: the run history and opening a run (on its
 * workflow's page, else read-only). Past chats keep `SessionsState`.
 */
@Injectable({ providedIn: 'root' })
export class RunsState {
  private readonly shell = inject(ShellState);
  private readonly toast = inject(ToastService);
  private readonly api = inject(WorkflowRunsApiService);
  private readonly workflowsApi = inject(WorkflowsApiService);
  private readonly designer = inject(WorkflowDesigner);
  private readonly workflowsNav = inject(WorkflowsNavState);
  private readonly agentsNav = inject(AgentsNavState);

  readonly tab = signal<RunsTab>('runs');
  readonly runs = signal<WorkflowRunSummary[]>([]);
  readonly runsLoaded = signal(false);
  /** The Runs list shows only archived runs (api.md 120 `?archived=true`). */
  readonly showArchived = signal(false);
  readonly deletingRun = signal<string | null>(null);

  readonly activeRun = signal<WorkflowRun | null>(null);
  readonly loadingRun = signal(false);
  readonly runError = signal<string | null>(null);
  /** The run being opened, until it shows; a newer open or view replaces it. */
  private opening: string | null = null;

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

  setShowArchived(on: boolean): void {
    this.showArchived.set(on);
    this.loadRuns();
  }

  loadRuns(): void {
    this.api
      .list(this.showArchived() ? { archived: true } : {})
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

  /**
   * A row of the Runs list, a Monitoring run, or a run's background task
   * opens its stored run (workflows R19): on its workflow's page, drawn with
   * that run, while the workflow is in the catalogue (a run still running is
   * followed there live, ADR-0048); read-only here otherwise (a removed
   * workflow's run, R23).
   */
  openRun(id: string): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.shell.settingsOpen.set(false);
    this.activeRun.set(null);
    this.runError.set(null);
    this.loadingRun.set(true);
    this.opening = id;
    this.tab.set('runs');
    this.shell.mainView.set('run-detail');
    this.api.getRun(id).subscribe({
      next: (run) => {
        if (!this.stillOpening(id)) return;
        this.openInWorkflow(run);
      },
      error: (err) => {
        if (!this.stillOpening(id)) return;
        this.opening = null;
        this.runError.set(err?.error?.message ?? 'Backend unreachable');
        this.loadingRun.set(false);
      },
    });
  }

  private stillOpening(id: string): boolean {
    return this.opening === id && this.shell.mainView() === 'run-detail';
  }

  /** Its workflow's page shows the run, if the catalogue still has it. */
  private openInWorkflow(run: WorkflowRun): void {
    this.workflowsApi.getWorkflow(run.workflowId).subscribe({
      next: () => {
        if (!this.stillOpening(run.id)) return;
        this.opening = null;
        this.loadingRun.set(false);
        if (isConversationalAgentWorkflow(run.workflowId)) {
          // A conversation with an agent (agents-evals R115): its own page.
          this.agentsNav.openConversation(
            agentKeyOfBinding(run.workflowId),
            run.id,
          );
          return;
        }
        this.designer.showRunOnLoad(run);
        this.workflowsNav.openWorkflow(run.workflowId);
      },
      error: () => {
        if (this.stillOpening(run.id)) this.showReadOnly(run);
      },
    });
  }

  private showReadOnly(run: WorkflowRun): void {
    this.opening = null;
    this.activeRun.set(run);
    this.loadingRun.set(false);
  }

  /** Back to the Runs list. */
  closeRun(): void {
    this.activeRun.set(null);
    this.shell.mainView.set('runs');
  }

  deleteRun(run: WorkflowRunSummary): void {
    if (isLiveRun(run.status)) {
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
}
