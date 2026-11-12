import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  WorkflowDetail,
  WorkflowRunResult,
  WorkflowRunStepResult,
} from '../models/workflow.model';
import { WorkflowsApiService } from './workflows-api.service';

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

/**
 * The state of the workflow designer, shared by the page in the content area
 * (header and canvas) and its right panel (workflows R7, R12, R13): the open
 * workflow, the selected step, the panel's tab, and the run form and the last
 * run's result, held only while the page is open (nothing is stored).
 */
@Injectable({ providedIn: 'root' })
export class WorkflowDesigner {
  private readonly api = inject(WorkflowsApiService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly workflow = signal<WorkflowDetail | null>(null);

  readonly selectedStepId = signal<string | null>(null);
  readonly tab = signal<WorkflowPanelTab>('workflow');

  /** The run form's values, by field name. */
  readonly inputValues = signal<Record<string, string>>({});
  readonly running = signal(false);
  /** The server's refusal of the last Execute (400), or `Backend unreachable`. */
  readonly runError = signal<string | null>(null);
  /** The last run's result; running again replaces it. */
  readonly runResult = signal<WorkflowRunResult | null>(null);

  private loadSubscription: Subscription | null = null;
  private runSubscription: Subscription | null = null;

  /** The tabs this workflow has: Run only for a run workflow. */
  readonly tabs = computed(() => {
    const workflow = this.workflow();
    return WORKFLOW_PANEL_TABS.filter(
      (tab) => tab.id !== 'run' || workflow?.trigger === 'run',
    );
  });

  readonly selectedStep = computed(() => {
    const workflow = this.workflow();
    const id = this.selectedStepId();
    if (workflow === null || id === null) return null;
    const index = workflow.steps.findIndex((step) => step.id === id);
    return index < 0 ? null : { step: workflow.steps[index], number: index + 1 };
  });

  /** Each step's status in the run shown, by step id; empty with no run. */
  readonly stepStatuses = computed<
    Record<string, WorkflowRunStepResult['status']>
  >(() => {
    const statuses: Record<string, WorkflowRunStepResult['status']> = {};
    for (const step of this.runResult()?.steps ?? []) {
      statuses[step.id] = step.status;
    }
    return statuses;
  });

  /** Open a workflow: everything of the previous one is discarded. */
  load(id: string): void {
    this.clear();
    this.loading.set(true);
    this.loadSubscription = this.api.getWorkflow(id).subscribe({
      next: (workflow) => {
        this.workflow.set(workflow);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  /** Leaving the page discards the workflow, the selection and the run (R13). */
  clear(): void {
    this.loadSubscription?.unsubscribe();
    this.loadSubscription = null;
    this.runSubscription?.unsubscribe();
    this.runSubscription = null;
    this.loading.set(false);
    this.error.set(null);
    this.workflow.set(null);
    this.selectedStepId.set(null);
    this.tab.set('workflow');
    this.inputValues.set({});
    this.running.set(false);
    this.runError.set(null);
    this.runResult.set(null);
  }

  /** Select a step (the panel shows it on Step), or clear the selection. */
  select(id: string | null): void {
    this.selectedStepId.set(id);
    if (id !== null) this.tab.set('step');
  }

  setTab(tab: WorkflowPanelTab): void {
    if (this.tabs().some((t) => t.id === tab)) this.tab.set(tab);
  }

  setInput(name: string, value: string): void {
    this.inputValues.update((values) => ({ ...values, [name]: value }));
  }

  /** A field's typed value; empty until typed. */
  inputValue(name: string): string {
    return Object.hasOwn(this.inputValues(), name)
      ? this.inputValues()[name]
      : '';
  }

  /** Run the workflow once on the form's values (api.md 118). */
  run(): void {
    const workflow = this.workflow();
    if (workflow === null || this.running()) return;
    const input: Record<string, string> = {};
    for (const field of workflow.input) {
      const value = this.inputValues()[field.name];
      if (value !== undefined) input[field.name] = value;
    }
    this.running.set(true);
    this.runError.set(null);
    this.runSubscription = this.api.runWorkflow(workflow.id, input).subscribe({
      next: (result) => {
        this.runResult.set(result);
        this.running.set(false);
      },
      error: (err) => {
        this.runResult.set(null);
        this.runError.set(err?.error?.message ?? 'Backend unreachable');
        this.running.set(false);
      },
    });
  }
}
