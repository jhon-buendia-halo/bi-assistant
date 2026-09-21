import { Component, computed, inject } from '@angular/core';
import {
  LucideAngularModule,
  CircleCheck,
  CircleX,
  Clock,
  Gauge,
  Wrench,
} from 'lucide-angular';
import { EvalSelectionService } from '../../services/eval-selection.service';

@Component({
  selector: 'app-eval-trace',
  imports: [LucideAngularModule],
  templateUrl: './eval-trace.html',
  styleUrl: './eval-trace.scss',
})
export class EvalTrace {
  readonly CircleCheck = CircleCheck;
  readonly CircleX = CircleX;
  readonly Clock = Clock;
  readonly Gauge = Gauge;
  readonly Wrench = Wrench;

  private readonly selectionService = inject(EvalSelectionService);

  readonly selection = this.selectionService.selection;
  readonly result = computed(() => this.selection()?.result ?? null);

  /** Checks that failed, which is what explains an overall failure. */
  readonly failedChecks = computed(
    () => this.result()?.checkResults.filter((check) => !check.passed) ?? [],
  );

  durationLabel(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
}
