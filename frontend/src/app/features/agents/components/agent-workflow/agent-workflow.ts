import { Component, computed, input, signal } from '@angular/core';
import { CircleX, LucideAngularModule, RefreshCw, Square } from 'lucide-angular';
import { AgentWorkflow } from '../../services/agents-api.service';
import { WorkflowCard, workflowCards } from '../../services/workflow-flow';

/**
 * The top of a workflow-backed agent's Graph tab (agents-evals R108, ui.md
 * 4.5.6): its turn workflow as a row of step cards, code steps and the agent
 * step told apart, labelled arrows for what each step passes on, the other
 * exits under each card, and a details card for the selected step.
 */
@Component({
  selector: 'app-agent-workflow',
  imports: [LucideAngularModule],
  templateUrl: './agent-workflow.html',
  styleUrl: './agent-workflow.scss',
})
export class AgentWorkflowView {
  readonly workflow = input.required<AgentWorkflow>();

  protected readonly CircleX = CircleX;
  protected readonly Square = Square;
  protected readonly RefreshCw = RefreshCw;

  protected readonly cards = computed(() => workflowCards(this.workflow()));
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed<WorkflowCard | null>(
    () =>
      this.cards().find((card) => card.step.id === this.selectedId()) ?? null,
  );

  /** Selects a step, or closes its details when it is already selected. */
  protected toggle(id: string): void {
    this.selectedId.update((current) => (current === id ? null : id));
  }
}
