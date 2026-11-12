import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import {
  Loader2,
  LucideAngularModule,
  MessageSquarePlus,
  Rocket,
  TriangleAlert,
} from 'lucide-angular';
import { WorkflowSummary } from '../../models/workflow.model';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import {
  canRunFromPage,
  workflowKindLabel,
} from '../../services/workflows.util';
import { WorkflowCanvas } from '../workflow-canvas/workflow-canvas';

/**
 * A workflow's page, laid out as a designer (workflows R6, R7, R12; ui.md
 * 4.4b): a header with the breadcrumb, the name, id and kind and the primary
 * action (Execute for a run workflow, Start chat for a chat workflow), and
 * the graph on a canvas filling the rest. Its configuration, run and code are
 * in the right panel (`WorkflowPanel`), which shares this page's state
 * through the designer. Read-only (R3).
 */
@Component({
  selector: 'app-workflow-detail',
  imports: [LucideAngularModule, WorkflowCanvas],
  templateUrl: './workflow-detail.html',
  host: { class: 'flex min-h-0 flex-col' },
})
export class WorkflowDetailPage {
  readonly Loader2 = Loader2;
  readonly MessageSquarePlus = MessageSquarePlus;
  readonly Rocket = Rocket;
  readonly TriangleAlert = TriangleAlert;

  protected readonly designer = inject(WorkflowDesigner);

  readonly workflowId = input.required<string>();
  /** True while a session is being created from this workflow. */
  readonly starting = input(false);
  /** Whether the right panel is open; closed, the header leaves room for its Expand button. */
  readonly panelOpen = input(true);
  /** All workflows. */
  readonly back = output<void>();
  readonly startChat = output<WorkflowSummary>();
  /** A node or Execute asks for the right panel. */
  readonly openPanel = output<void>();

  /** The breadcrumb's last part: the name, or the id until it loads. */
  readonly crumb = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null ? this.workflowId() : workflow.name;
  });
  readonly kindLabel = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null ? '' : workflowKindLabel(workflow);
  });
  /** Execute and the Run tab (workflows R12, R21). */
  readonly runnable = computed(() => {
    const workflow = this.designer.workflow();
    return workflow !== null && canRunFromPage(workflow);
  });
  readonly missing = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null ? '' : workflow.missingDatasets.join(', ');
  });

  constructor() {
    effect(() => {
      const id = this.workflowId();
      untracked(() => this.designer.load(id));
    });
    // Leaving the page discards the workflow and its run (R13).
    inject(DestroyRef).onDestroy(() => this.designer.clear());
  }

  /** A node selects its step and shows it in the panel; the background clears it. */
  onSelectStep(id: string | null): void {
    this.designer.select(id);
    if (id !== null) this.openPanel.emit();
  }

  /** Execute: the panel opens on Run. */
  execute(): void {
    this.designer.setTab('run');
    this.openPanel.emit();
  }
}
