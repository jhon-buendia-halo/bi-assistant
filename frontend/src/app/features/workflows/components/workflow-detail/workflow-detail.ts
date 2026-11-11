import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Loader2,
  LucideAngularModule,
  MessageSquarePlus,
  TriangleAlert,
  Workflow,
} from 'lucide-angular';
import { AgentWorkflowView } from '../../../agents/components/agent-workflow/agent-workflow';
import { WorkflowDetail, WorkflowSummary } from '../../models/workflow.model';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { workflowKindLabel } from '../../services/workflows.util';

/** The note under the drawing: what drives a chat's workflow bar (R10). */
export const BAR_NOTES: Record<WorkflowSummary['bar'], string> = {
  steps: 'In a chat, the workflow bar shows these steps as they run.',
  agent: "In a chat, the workflow bar shows the agent's own steps as it sets them.",
};

/**
 * A workflow's page (workflows R7, R8, R10; ui.md 4.4b): its header and
 * Start chat, what happens on each message (the 1.23.1 drawing, fed by
 * `GET /workflows/:id`), the workflow bar note, and the agents its steps
 * call. Read-only (R3).
 */
@Component({
  selector: 'app-workflow-detail',
  imports: [LucideAngularModule, AgentWorkflowView],
  templateUrl: './workflow-detail.html',
})
export class WorkflowDetailPage {
  readonly ArrowLeft = ArrowLeft;
  readonly Bot = Bot;
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;
  readonly MessageSquarePlus = MessageSquarePlus;
  readonly TriangleAlert = TriangleAlert;
  readonly Workflow = Workflow;

  private readonly api = inject(WorkflowsApiService);

  readonly workflowId = input.required<string>();
  /** True while a session is being created from this workflow. */
  readonly starting = input(false);
  /** All workflows. */
  readonly back = output<void>();
  readonly startChat = output<WorkflowSummary>();
  /** An agent row; the shell opens the agent's detail (R8). */
  readonly openAgent = output<string>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly workflow = signal<WorkflowDetail | null>(null);

  readonly kindLabel = computed(() => {
    const workflow = this.workflow();
    return workflow === null ? '' : workflowKindLabel(workflow);
  });
  readonly barNote = computed(() => {
    const workflow = this.workflow();
    return workflow === null ? '' : BAR_NOTES[workflow.bar];
  });
  readonly missing = computed(() => {
    const workflow = this.workflow();
    return workflow === null ? '' : workflow.missingDatasets.join(', ');
  });

  constructor() {
    effect(() => this.load(this.workflowId()));
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.workflow.set(null);
    this.api.getWorkflow(id).subscribe({
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
}
