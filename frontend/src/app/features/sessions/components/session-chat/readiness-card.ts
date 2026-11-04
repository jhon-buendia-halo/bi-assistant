import { Component, input, output } from '@angular/core';
import { Gauge, LucideAngularModule } from 'lucide-angular';
import { readinessTime } from '../../models/readiness.model';
import { ReadinessReportRef } from '../../models/session.model';

/**
 * The readiness card on a Data Readiness Agent answer (ui.md 4.12, R25):
 * datasource, score and band, generation time and Open scorecard.
 */
@Component({
  selector: 'app-readiness-card',
  imports: [LucideAngularModule],
  template: `
    <div
      class="card flex items-start gap-3 p-4"
      data-testid="readiness-card"
      role="group"
      [attr.aria-label]="'Readiness report for ' + report().datasourceName"
    >
      <span
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg"
      >
        <lucide-angular [img]="Gauge" [size]="15" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-[14px] font-medium text-fg-strong">{{
          report().datasourceName
        }}</span>
        <span
          class="text-[13px] text-fg"
          data-testid="readiness-card-score"
          >{{ report().overallScore }}/100 · {{ report().maturity }}</span
        >
        <span class="text-[12px] text-fg-muted">
          <time [attr.datetime]="report().generatedAt">{{
            time(report().generatedAt)
          }}</time>
        </span>
      </span>
      <button
        type="button"
        class="btn btn-secondary shrink-0"
        data-testid="readiness-open-scorecard"
        (click)="openScorecard.emit()"
      >
        Open scorecard
      </button>
    </div>
  `,
})
export class ReadinessCard {
  readonly Gauge = Gauge;

  readonly report = input.required<ReadinessReportRef>();
  /** Show this report in the session panel (and open it). */
  readonly openScorecard = output<void>();

  protected readonly time = readinessTime;
}
