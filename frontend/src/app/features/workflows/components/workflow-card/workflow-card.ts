import { Component, computed, input, output } from '@angular/core';
import {
  Loader2,
  LucideAngularModule,
  MessageSquarePlus,
  Play,
  TriangleAlert,
  Workflow,
} from 'lucide-angular';
import { WorkflowSummary } from '../../models/workflow.model';
import {
  workflowKindLabel,
  workflowUsesLabel,
} from '../../services/workflows.util';

/**
 * One workflow on the Workflows page (workflows R5, R6, R12; ui.md 4.4a). The
 * open control and Start chat (Run, for a run workflow) are sibling buttons,
 * so no interactive control sits inside another. There is no edit, delete or
 * reorder control (R3).
 */
@Component({
  selector: 'app-workflow-card',
  imports: [LucideAngularModule],
  templateUrl: './workflow-card.html',
  host: { class: 'block h-full' },
})
export class WorkflowCard {
  readonly Loader2 = Loader2;
  readonly MessageSquarePlus = MessageSquarePlus;
  readonly Play = Play;
  readonly TriangleAlert = TriangleAlert;
  readonly Workflow = Workflow;

  readonly workflow = input.required<WorkflowSummary>();
  /** True while a session is being created from this workflow. */
  readonly starting = input(false);
  readonly open = output<void>();
  readonly startChat = output<void>();

  readonly kindLabel = computed(() => workflowKindLabel(this.workflow()));
  readonly usesLabel = computed(() => workflowUsesLabel(this.workflow()));
  readonly missing = computed(() =>
    this.workflow().missingDatasets.join(', '),
  );
}
