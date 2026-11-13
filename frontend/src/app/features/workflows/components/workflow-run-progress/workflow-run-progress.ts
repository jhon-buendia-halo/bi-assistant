import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  Check,
  Circle,
  Clock,
  LucideAngularModule,
  Minus,
  Square,
  X,
} from 'lucide-angular';
import {
  ProgressState,
  ProgressStep,
  elapsedLabel,
} from '../../services/workflow-run-progress';

const STATE_LABELS: Record<ProgressState, string> = {
  pending: 'Not started',
  done: 'Done',
  current: 'Running',
  waiting: 'Waiting for you',
  failed: 'Failed',
  skipped: 'Skipped',
  stopped: 'Stopped',
};

/**
 * The run progress at the top of the Run panel (ui.md 4.4b): the workflow's
 * steps in path order, each done, current (spinner and elapsed seconds,
 * `aria-current="step"`), waiting for the user, failed, skipped or not
 * started. Presentational: the steps come from `progressSteps`.
 */
@Component({
  selector: 'app-workflow-run-progress',
  imports: [LucideAngularModule],
  templateUrl: './workflow-run-progress.html',
  host: { 'data-testid': 'workflow-run-progress', class: 'block' },
})
export class WorkflowRunProgress {
  readonly steps = input.required<ProgressStep[]>();

  protected readonly Check = Check;
  protected readonly Circle = Circle;
  protected readonly Clock = Clock;
  protected readonly Minus = Minus;
  protected readonly Square = Square;
  protected readonly X = X;

  private readonly now = signal(Date.now());

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected readonly items = computed(() =>
    this.steps().map((step) => ({
      ...step,
      label: STATE_LABELS[step.state],
      elapsed:
        step.startedAt !== undefined
          ? elapsedLabel(step.startedAt, this.now())
          : null,
    })),
  );
}
