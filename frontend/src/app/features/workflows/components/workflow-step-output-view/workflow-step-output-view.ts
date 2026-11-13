import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { CircleCheck, CircleX, LucideAngularModule } from 'lucide-angular';
import {
  planOutputOf,
  validateOutputOf,
} from '../../services/workflow-step-output';

/**
 * A structured step output as a readable panel (ui.md 4.4b), shown in the
 * node dialog's Output above the raw data: a Plan (the question, measures,
 * entities, scope and assumptions; the clarification asked when it needs
 * one) or a Validate (each check passed or failed). Shows nothing for any
 * other output.
 */
@Component({
  selector: 'app-workflow-step-output-view',
  imports: [LucideAngularModule, NgTemplateOutlet],
  templateUrl: './workflow-step-output-view.html',
})
export class WorkflowStepOutputView {
  protected readonly CircleCheck = CircleCheck;
  protected readonly CircleX = CircleX;

  readonly output = input<Record<string, unknown> | null | undefined>(null);
  /** The step's input field names: a step that received `plan` only passes it on. */
  readonly inputFields = input<readonly string[]>([]);

  /** A validation first: Validate passes the plan on beside its findings. */
  protected readonly validation = computed(() =>
    validateOutputOf(this.output()),
  );
  protected readonly plan = computed(() =>
    this.validation() === null
      ? planOutputOf(this.output(), this.inputFields().includes('plan'))
      : null,
  );
  protected readonly passed = computed(
    () => this.validation()?.findings.filter((f) => f.passed).length ?? 0,
  );
}
