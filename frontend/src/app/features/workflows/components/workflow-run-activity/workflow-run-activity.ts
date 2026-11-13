import { Component, input } from '@angular/core';

/**
 * The live activity line under the run progress (ui.md 4.4b): what the run
 * is doing now, announced politely as it changes. The element stays in the
 * page so a change of its text is read out.
 */
@Component({
  selector: 'app-workflow-run-activity',
  template: `<p
    class="m-0 text-[13px] text-fg-muted"
    data-testid="workflow-run-activity"
    aria-live="polite"
  >
    {{ line() }}
  </p>`,
  host: { class: 'block' },
})
export class WorkflowRunActivity {
  /** The line to show; null shows nothing. */
  readonly line = input<string | null>(null);
}
