import { Component, input, output } from '@angular/core';

/**
 * `Attempt 1 | Attempt 2`: picks which run of a repeated step (a loop's
 * retry) the node dialog or the Workflow state detail shows (ui.md 4.4b).
 * Shown only for a step that ran more than once.
 */
@Component({
  selector: 'app-workflow-attempt-switcher',
  template: `
    @if (attempts().length > 1) {
      <div
        class="inline-flex overflow-hidden rounded-md border border-border"
        role="group"
        aria-label="Attempt"
        data-testid="workflow-attempts"
      >
        @for (n of attempts(); track n) {
          <button
            type="button"
            [attr.data-testid]="'workflow-attempt-' + n"
            [attr.aria-pressed]="selected() === n"
            (click)="selectAttempt.emit(n)"
            class="px-2.5 py-0.5 text-[12px] font-medium"
            [class.bg-primary-soft]="selected() === n"
            [class.text-on-primary-soft]="selected() === n"
            [class.text-fg-muted]="selected() !== n"
          >
            Attempt {{ n }}
          </button>
        }
      </div>
    }
  `,
})
export class WorkflowAttemptSwitcher {
  /** The attempts' numbers, in order (1, 2, …). */
  readonly attempts = input.required<number[]>();
  /** The attempt shown. */
  readonly selected = input.required<number>();
  readonly selectAttempt = output<number>();
}
