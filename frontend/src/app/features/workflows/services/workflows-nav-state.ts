import { Injectable, inject, signal } from '@angular/core';
import { ShellState } from '../../../core/shell/shell-state';

/** The Workflows area's navigation state (workflows R7, R8). */
@Injectable({ providedIn: 'root' })
export class WorkflowsNavState {
  private readonly shell = inject(ShellState);

  /** Id of the workflow open on its page (workflows R7). */
  readonly activeWorkflowId = signal<string | null>(null);

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
}
