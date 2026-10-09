import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  Download,
  RefreshCw,
  Search,
  ScrollText,
  TriangleAlert,
  X,
  LucideAngularModule,
} from 'lucide-angular';
import { DiagnosticsService } from '../../../core/diagnostics/diagnostics.service';
import { DiagnosticEntry } from '../../../core/diagnostics/diagnostics.types';
import {
  filterGrouped,
  groupEntriesByRun,
  type LogRun,
} from '../../../core/diagnostics/log-runs';
import { ToastService } from '../../../core/toast/toast.service';

type LogFilter = 'all' | 'issues';

@Component({
  selector: 'app-system-logs-panel',
  imports: [LucideAngularModule, NgTemplateOutlet],
  templateUrl: './system-logs-panel.html',
})
export class SystemLogsPanel {
  readonly Download = Download;
  readonly RefreshCw = RefreshCw;
  readonly Search = Search;
  readonly ScrollText = ScrollText;
  readonly TriangleAlert = TriangleAlert;
  readonly X = X;

  readonly dismiss = output<void>();
  readonly diagnostics = inject(DiagnosticsService);
  private readonly toast = inject(ToastService);
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  readonly filter = signal<LogFilter>('all');
  readonly query = signal('');
  readonly follow = signal(true);
  readonly grouped = signal(true);
  readonly exporting = signal(false);
  readonly errorCount = computed(
    () =>
      this.diagnostics.entries().filter((entry) => entry.level === 'error')
        .length,
  );
  readonly warningCount = computed(
    () =>
      this.diagnostics.entries().filter((entry) => entry.level === 'warn')
        .length,
  );
  /** True when the level filter or search box is narrowing the stream. */
  readonly filtering = computed(
    () => this.filter() === 'issues' || this.query().trim().length > 0,
  );
  /** The level filter and search box, as one predicate both views share. */
  private readonly matcher = computed(() => {
    const filter = this.filter();
    const query = this.query().trim().toLowerCase();
    return (entry: DiagnosticEntry): boolean => {
      if (
        filter === 'issues' &&
        entry.level !== 'error' &&
        entry.level !== 'warn'
      ) {
        return false;
      }
      return (
        !query ||
        `${entry.source} ${entry.message} ${this.formatDetails(entry.details)}`
          .toLowerCase()
          .includes(query)
      );
    };
  });
  readonly visibleEntries = computed(() =>
    this.diagnostics.entries().filter(this.matcher()),
  );
  /**
   * Grouped on the full stream and filtered inside each run — grouping the
   * filtered list instead would hide the `[Nest]` lines the run boundaries are
   * derived from.
   */
  readonly visibleGroups = computed(() =>
    filterGrouped(
      groupEntriesByRun(this.diagnostics.entries()),
      this.matcher(),
    ),
  );
  readonly latestIssue = computed(() =>
    this.diagnostics
      .entries()
      .slice()
      .reverse()
      .find((entry) => entry.level === 'error' || entry.level === 'warn'),
  );

  constructor() {
    effect(() => {
      this.visibleEntries();
      if (!this.follow()) return;
      setTimeout(() => {
        const element = this.scroller()?.nativeElement;
        if (element) element.scrollTop = element.scrollHeight;
      });
    });
  }

  async exportForLlm(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const result = await this.diagnostics.exportForLlm();
      if (result.ok) {
        this.toast.success(`Exported ${result.count ?? 0} diagnostic entries`);
      }
    } catch (error) {
      this.toast.error(
        error instanceof Error ? error.message : 'Diagnostics export failed',
      );
    } finally {
      this.exporting.set(false);
    }
  }

  /**
   * Newest run stays expanded and older ones collapse, so the panel opens on
   * the run you are almost certainly here for. While filtering, every
   * surviving run expands instead: a match you cannot see is worse than a
   * long list, and a collapsed run would silently hide search hits.
   */
  isRunOpen(run: LogRun): boolean {
    return this.filtering() || run === this.visibleGroups().runs.at(-1);
  }

  runSpan(run: LogRun): string {
    const start = this.formatTime(run.startedAt);
    const end = this.formatTime(run.endedAt);
    return start === end ? start : `${start} – ${end}`;
  }

  levelClasses(entry: DiagnosticEntry): string {
    if (entry.level === 'error')
      return 'border-on-danger-soft/30 bg-danger-soft text-on-danger-soft';
    if (entry.level === 'warn')
      return 'border-on-warning-soft/30 bg-warning-soft text-on-warning-soft';
    if (entry.level === 'debug')
      return 'border-accent/30 bg-info-soft text-accent';
    return 'border-border bg-surface-muted text-fg-muted';
  }

  explainSource(source: string): string {
    if (source === 'user-visible')
      return 'An operation shown in the app failed.';
    if (source.startsWith('backend:mastra'))
      return 'The AI agent runtime reported this event.';
    if (source.startsWith('backend'))
      return 'The local data and backend service reported this event.';
    if (source.includes('renderer'))
      return 'The application interface reported this event.';
    if (source.startsWith('electron'))
      return 'The desktop application shell reported this event.';
    return 'A system component reported this event.';
  }

  formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
  }

  formatDetails(details: unknown): string {
    if (details === undefined) return '';
    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  }
}
