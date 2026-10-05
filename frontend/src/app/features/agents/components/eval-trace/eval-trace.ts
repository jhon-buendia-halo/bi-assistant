import { Component, computed, inject, signal } from '@angular/core';
import {
  LucideAngularModule,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  Coins,
  Gauge,
  Wrench,
} from 'lucide-angular';
import {
  EvalRunLogAttempt,
  EvalVerdict,
  TokenUsage,
  formatTokenCount,
  formatTokensCompact,
  isUsageMeasured,
  verdictClass,
} from '../../models/eval.model';
import { EvalSelectionService } from '../../services/eval-selection.service';

@Component({
  selector: 'app-eval-trace',
  imports: [LucideAngularModule],
  templateUrl: './eval-trace.html',
  styleUrl: './eval-trace.scss',
})
export class EvalTrace {
  readonly CircleCheck = CircleCheck;
  readonly CircleHelp = CircleHelp;
  readonly CircleX = CircleX;
  readonly Clock = Clock;
  readonly Coins = Coins;
  readonly Gauge = Gauge;
  readonly Wrench = Wrench;

  private readonly selectionService = inject(EvalSelectionService);

  readonly selection = this.selectionService.selection;
  readonly result = computed(() => this.selection()?.result ?? null);

  /**
   * Tokens this question spent, only when the provider actually reported
   * them — a silent provider must not render as a free question.
   */
  readonly usage = computed(() => {
    const usage = this.result()?.usage;
    return isUsageMeasured(usage) ? (usage ?? null) : null;
  });

  readonly tokenCount = formatTokenCount;
  readonly tokensCompact = formatTokensCompact;
  readonly verdictClass = verdictClass;

  /** Checks that failed, which is what explains an overall failure. */
  readonly failedChecks = computed(
    () => this.result()?.checkResults.filter((check) => !check.passed) ?? [],
  );

  durationLabel(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  /* ---- Run log v2 attempts -------------------------------------------
   * Repeat > 1 (or a v2-recorded single run) carries one `EvalRunLogAttempt`
   * per try. When present, this is the whole trace for the case — the
   * checks/toolCalls view below it is the pre-repeat shape and stays for
   * results that predate attempts.
   */

  readonly attempts = computed<EvalRunLogAttempt[]>(
    () => this.result()?.attempts ?? [],
  );

  /** Which attempt is expanded, by its 1-based `attempt` number. */
  readonly expandedAttempt = signal<number | null>(null);

  toggleAttempt(attempt: number): void {
    this.expandedAttempt.set(
      this.expandedAttempt() === attempt ? null : attempt,
    );
  }

  isAttemptExpanded(attempt: number): boolean {
    return this.expandedAttempt() === attempt;
  }

  attemptUsage(attempt: EvalRunLogAttempt): TokenUsage | null {
    return isUsageMeasured(attempt.usage) ? (attempt.usage ?? null) : null;
  }

  attemptVerdictIcon(verdict: EvalVerdict) {
    switch (verdict) {
      case 'PASS':
        return this.CircleCheck;
      case 'FAIL':
      case 'ERROR':
        return this.CircleX;
      default:
        return this.CircleHelp;
    }
  }

  attemptVerdictTooltip(verdict: EvalVerdict): string | undefined {
    return verdict === 'GAP'
      ? 'the harness could not measure this — not counted'
      : undefined;
  }
}
