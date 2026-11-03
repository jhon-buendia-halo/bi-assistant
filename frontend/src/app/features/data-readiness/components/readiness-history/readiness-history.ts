import { DatePipe } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { History, LucideAngularModule } from 'lucide-angular';
import {
  ReadinessMaturity,
  ReadinessReport,
  ReadinessReportSummary,
} from '../../../sessions/models/readiness.model';
import { ReadinessApiService } from '../../services/readiness-api.service';

const BAND_CLASSES: Record<ReadinessMaturity, string> = {
  Optimised: 'bg-success-soft text-on-success-soft',
  Managed: 'bg-success-soft text-on-success-soft',
  Defined: 'bg-info-soft text-on-info-soft',
  Repeatable: 'bg-warning-soft text-on-warning-soft',
  Initial: 'bg-danger-soft text-on-danger-soft',
};

/**
 * "Past assessments" button and menu of the readiness scorecard (ui.md
 * 4.13.5). Self-contained: loads the datasource's saved reports when the menu
 * opens and emits the chosen report in full.
 */
@Component({
  selector: 'app-readiness-history',
  imports: [DatePipe, LucideAngularModule],
  templateUrl: './readiness-history.html',
  host: { class: 'relative inline-block' },
})
export class ReadinessHistory {
  private readonly api = inject(ReadinessApiService);

  readonly History = History;

  readonly datasourceId = input.required<string>();
  readonly currentReportId = input<string | undefined>();
  readonly openReport = output<ReadinessReport>();

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly reports = signal<ReadinessReportSummary[]>([]);
  /** Id of the report being fetched after a choice. */
  readonly choosing = signal<string | null>(null);

  toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    this.open.set(true);
    this.load();
  }

  close(): void {
    this.open.set(false);
  }

  /** With only the current report saved there is nothing earlier to show. */
  isEmpty(): boolean {
    const list = this.reports();
    const current = this.currentReportId();
    return (
      list.length === 0 ||
      (list.length === 1 && current !== undefined && list[0].id === current)
    );
  }

  bandClass(m: ReadinessMaturity): string {
    return BAND_CLASSES[m] ?? 'bg-surface-muted text-fg';
  }

  choose(r: ReadinessReportSummary): void {
    if (r.id === this.currentReportId() || this.choosing()) return;
    this.choosing.set(r.id);
    this.error.set(null);
    this.api.get(r.id).subscribe({
      next: (report) => {
        this.choosing.set(null);
        this.open.set(false);
        this.openReport.emit(report);
      },
      error: () => {
        this.choosing.set(null);
        this.error.set('Could not open that assessment.');
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list(this.datasourceId()).subscribe({
      next: ({ reports }) => {
        this.reports.set(reports);
        this.loading.set(false);
      },
      error: () => {
        this.reports.set([]);
        this.error.set('Could not load past assessments.');
        this.loading.set(false);
      },
    });
  }
}
