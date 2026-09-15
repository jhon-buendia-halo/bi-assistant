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
import { ToastService } from '../../../core/toast/toast.service';

type LogFilter = 'all' | 'issues';

@Component({
  selector: 'app-system-logs-panel',
  imports: [LucideAngularModule],
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
  readonly visibleEntries = computed(() => {
    const filter = this.filter();
    const query = this.query().trim().toLowerCase();
    return this.diagnostics.entries().filter((entry) => {
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
    });
  });
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

  levelClasses(entry: DiagnosticEntry): string {
    if (entry.level === 'error')
      return 'border-red-500/25 bg-red-500/10 text-red-300';
    if (entry.level === 'warn')
      return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
    if (entry.level === 'debug')
      return 'border-sky-500/20 bg-sky-500/10 text-sky-300';
    return 'border-white/10 bg-white/5 text-zinc-400';
  }

  explainSource(source: string): string {
    if (source === 'user-visible')
      return 'An operation shown in the app failed.';
    if (source.startsWith('backend:mastra'))
      return 'The AI agent runtime reported this event.';
    if (source.startsWith('backend'))
      return 'The local data and project service reported this event.';
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
