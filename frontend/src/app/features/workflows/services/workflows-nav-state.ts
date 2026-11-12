import { Injectable, inject, signal } from '@angular/core';
import { ShellState } from '../../../core/shell/shell-state';
import { ToastService } from '../../../core/toast/toast.service';
import { ComposerState } from '../../sessions/services/composer-state';
import { SessionsApiService } from '../../sessions/services/sessions-api.service';
import { SessionsState } from '../../sessions/services/sessions-state';
import { WorkflowSummary } from '../models/workflow.model';
import { workflowStartAction } from './workflows.util';

/** The Workflows area's navigation state and Start chat (workflows R6–R8). */
@Injectable({ providedIn: 'root' })
export class WorkflowsNavState {
  private readonly shell = inject(ShellState);
  private readonly toast = inject(ToastService);
  private readonly sessions = inject(SessionsState);
  private readonly composer = inject(ComposerState);
  private readonly sessionsApi = inject(SessionsApiService);

  /** Id of the workflow open on its page (workflows R7). */
  readonly activeWorkflowId = signal<string | null>(null);
  /** Id of the workflow a session is being created from, while in flight. */
  readonly startingWorkflowId = signal<string | null>(null);

  /**
   * A workflow card on the Workflows page, or a Used in chip on an agent's
   * page (agents-evals R109), opens the workflow's page (R7) with the right
   * panel open on its configuration (ui.md 4.4b).
   */
  openWorkflow(id: string): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.shell.settingsOpen.set(false);
    this.activeWorkflowId.set(id);
    this.shell.mainView.set('workflow-detail');
    this.shell.rightPanelOpen.set(true);
  }

  /** All workflows, from a workflow's page. */
  closeWorkflowDetail(): void {
    this.shell.mainView.set('workflows');
  }

  /**
   * Start chat on a workflow card or page (workflows R6). A workflow that
   * takes the datasets the user picks opens the New conversation screen
   * with that workflow preselected (sessions-chat R64); any other workflow
   * gets its session created at once and opened. A refusal keeps the user
   * where they are.
   */
  startChatWithWorkflow(workflow: WorkflowSummary): void {
    const action = workflowStartAction(workflow);
    if (action.kind === 'composer') {
      this.composer.openComposer(action.workflowId);
      return;
    }
    if (this.startingWorkflowId()) return;
    this.startingWorkflowId.set(workflow.id);
    this.sessionsApi.createFromWorkflow(workflow.id).subscribe({
      next: (res) => {
        this.startingWorkflowId.set(null);
        if (res.ok && res.session) {
          this.toast.success(res.message);
          this.sessions.loadSessions();
          this.sessions.openSession(res.session);
        } else {
          this.toast.error(res.message);
        }
      },
      error: (err) => {
        this.startingWorkflowId.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }
}
