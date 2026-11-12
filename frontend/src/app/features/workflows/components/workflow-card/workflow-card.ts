import { Component, computed, input, output } from '@angular/core';
import {
  LucideAngularModule,
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
 * One workflow on the Workflows page (workflows R5, R12; ui.md 4.4a). The
 * open control and Run are sibling buttons, so no interactive control sits
 * inside another. There is no edit, delete or
 * reorder control (R3).
 */
@Component({
  selector: 'app-workflow-card',
  imports: [LucideAngularModule],
  templateUrl: './workflow-card.html',
  host: { class: 'block h-full' },
})
export class WorkflowCard {
  readonly Play = Play;
  readonly TriangleAlert = TriangleAlert;
  readonly Workflow = Workflow;

  readonly workflow = input.required<WorkflowSummary>();
  readonly open = output<void>();

  readonly kindLabel = computed(() => workflowKindLabel(this.workflow()));
  readonly usesLabel = computed(() => workflowUsesLabel(this.workflow()));
  readonly missing = computed(() =>
    this.workflow().missingDatasets.join(', '),
  );
}
