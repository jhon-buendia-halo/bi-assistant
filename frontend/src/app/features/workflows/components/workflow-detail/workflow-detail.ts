import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { Loader2, LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import { workflowKindLabel } from '../../services/workflows.util';
import { WorkflowCanvas } from '../workflow-canvas/workflow-canvas';
import { WorkflowNodeDialog } from '../workflow-node-dialog/workflow-node-dialog';
import { WorkflowLogsDock } from '../workflow-logs-dock/workflow-logs-dock';
import { WorkflowRunDock } from '../workflow-run-dock/workflow-run-dock';

/**
 * A workflow's page, laid out as an n8n-style designer (workflows R6, R7,
 * R12; ui.md 4.4b): a header with the breadcrumb, the name, id and kind; the
 * canvas, left to right, with Execute workflow at its top-right; the Run
 * panel under it (Chat, Logs and the selected node's data); and a node's
 * dialog over the page. The app's right panel is not used on this page.
 * Read-only (R3).
 */
@Component({
  selector: 'app-workflow-detail',
  imports: [
    LucideAngularModule,
    WorkflowCanvas,
    WorkflowNodeDialog,
    WorkflowLogsDock,
    WorkflowRunDock,
  ],
  templateUrl: './workflow-detail.html',
  host: { class: 'flex min-h-0 flex-col' },
})
export class WorkflowDetailPage {
  readonly Loader2 = Loader2;
  readonly TriangleAlert = TriangleAlert;

  protected readonly designer = inject(WorkflowDesigner);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly workflowId = input.required<string>();
  /** All workflows. */
  readonly back = output<void>();
  /** The node dialog's agent link; the shell opens the agent's detail (R8). */
  readonly openAgent = output<string>();

  /** The breadcrumb's last part: the name, or the id until it loads. */
  readonly crumb = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null ? this.workflowId() : workflow.name;
  });
  readonly kindLabel = computed(() => {
    const workflow = this.designer.workflow();
    return workflow === null ? '' : workflowKindLabel(workflow);
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

  /**
   * Execute workflow: the Run panel unfolds and its composer takes the
   * focus. It never runs; the composer's own Execute does.
   */
  execute(): void {
    this.designer.requestRunForm();
  }

  /**
   * The dialog closes; the focus goes back to the node it was opened from,
   * or, for a tool, to its agent's Tools sub-node.
   */
  closeNode(): void {
    const id = this.designer.openNodeId();
    this.designer.closeNode();
    if (id === null) return;
    const key = CSS.escape(id);
    setTimeout(() => {
      const host = this.host.nativeElement;
      const node = host.querySelector<HTMLElement>(
        `[data-testid="workflow-node-${key}"]`,
      );
      const tools = Array.from(
        host.querySelectorAll<HTMLElement>('.sub-node[data-kind="tools"]'),
      ).find((el) => id.startsWith(`${el.dataset['step']}-tool-`));
      (node ?? tools)?.focus();
    });
  }

  /** The dialog's agent link: the dialog closes and the agent's page opens. */
  onOpenAgent(key: string): void {
    this.designer.closeNode();
    this.openAgent.emit(key);
  }
}
