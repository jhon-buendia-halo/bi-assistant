import { Component, computed, inject } from '@angular/core';
import {
  LucideAngularModule,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  Gauge,
  Wrench,
} from 'lucide-angular';
import { EvalSelectionService } from '../../services/eval-selection.service';
import {
  EVAL_STATUS_LABELS,
  checkStatus,
  resultStatus,
} from '../../services/eval-run.util';

@Component({
  selector: 'app-eval-trace',
  imports: [LucideAngularModule],
  templateUrl: './eval-trace.html',
  styleUrl: './eval-trace.scss',
})
export class EvalTrace {
  readonly CircleCheck = CircleCheck;
  readonly CircleMinus = CircleMinus;
  readonly CircleX = CircleX;
  readonly Clock = Clock;
  readonly Gauge = Gauge;
  readonly Wrench = Wrench;

  readonly statusLabels = EVAL_STATUS_LABELS;
  readonly checkStatus = checkStatus;

  private readonly selectionService = inject(EvalSelectionService);

  readonly selection = this.selectionService.selection;
  readonly result = computed(() => this.selection()?.result ?? null);

  /** The question's verdict: passed, failed or not scored. */
  readonly status = computed(() => {
    const result = this.result();
    return result ? resultStatus(result) : null;
  });

  /**
   * Checks that failed, which is what explains an overall failure. A check
   * that was not scored (the judge was off) is not a failure.
   */
  readonly failedChecks = computed(
    () =>
      this.result()?.checkResults.filter(
        (check) => checkStatus(check) === 'failed',
      ) ?? [],
  );

  durationLabel(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
}
