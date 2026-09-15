import {
  DestroyRef,
  Injectable,
  NgZone,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  DiagnosticEntry,
  DiagnosticExportResult,
  DiagnosticLevel,
} from './diagnostics.types';

const MAX_ENTRIES = 2_000;

@Injectable({ providedIn: 'root' })
export class DiagnosticsService {
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bridge =
    typeof window === 'undefined' ? undefined : window.systemDiagnostics;
  private fallbackSequence = 0;

  readonly entries = signal<DiagnosticEntry[]>([]);
  readonly loading = signal(false);
  readonly issueCount = computed(
    () =>
      this.entries().filter(
        (entry) => entry.level === 'error' || entry.level === 'warn',
      ).length,
  );

  constructor() {
    const unsubscribe = this.bridge?.subscribe((entry) => {
      this.zone.run(() => this.mergeEntries([entry]));
    });
    if (unsubscribe) this.destroyRef.onDestroy(unsubscribe);
    void this.refresh();

    if (typeof window !== 'undefined') {
      const onError = (event: ErrorEvent) => {
        this.record(
          'error',
          'renderer',
          event.message || 'Unexpected interface error',
          {
            filename: event.filename,
            line: event.lineno,
            column: event.colno,
            stack: event.error instanceof Error ? event.error.stack : undefined,
          },
        );
      };
      const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        this.record(
          'error',
          'renderer',
          reason instanceof Error
            ? reason.message
            : `Unhandled promise rejection: ${String(reason)}`,
          reason instanceof Error ? { stack: reason.stack } : undefined,
        );
      };
      window.addEventListener('error', onError);
      window.addEventListener('unhandledrejection', onUnhandledRejection);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onUnhandledRejection);
      });
    }
  }

  async refresh(): Promise<void> {
    if (!this.bridge) return;
    this.loading.set(true);
    try {
      const entries = await this.bridge.list();
      this.zone.run(() => this.mergeEntries(entries));
    } finally {
      this.zone.run(() => this.loading.set(false));
    }
  }

  record(
    level: DiagnosticLevel,
    source: string,
    message: string,
    details?: unknown,
  ): void {
    if (this.bridge) {
      this.bridge.record({ level, source, message, details });
      return;
    }
    this.mergeEntries([
      {
        id: `browser-${Date.now()}-${++this.fallbackSequence}`,
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
        details,
      },
    ]);
  }

  async exportForLlm(): Promise<DiagnosticExportResult> {
    if (this.bridge) return this.bridge.exportForLlm();

    const report = this.buildFallbackMarkdown();
    const url = URL.createObjectURL(
      new Blob([report], { type: 'text/markdown;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `questions-to-insights-diagnostics-${new Date()
      .toISOString()
      .slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { ok: true, canceled: false, count: this.entries().length };
  }

  private mergeEntries(incoming: DiagnosticEntry[]): void {
    const byId = new Map(this.entries().map((entry) => [entry.id, entry]));
    for (const entry of incoming) byId.set(entry.id, entry);
    this.entries.set(
      Array.from(byId.values())
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-MAX_ENTRIES),
    );
  }

  private buildFallbackMarkdown(): string {
    const issues = this.entries().filter(
      (entry) => entry.level === 'error' || entry.level === 'warn',
    );
    return [
      '# Questions to Insights — Diagnostics Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Entries: ${this.entries().length}`,
      '',
      '## Instructions for the analyzing LLM',
      '',
      'Identify the earliest likely root cause, distinguish it from downstream symptoms, cite timestamps and sources, and propose safe next steps.',
      '',
      '## Errors and warnings',
      '',
      ...(issues.length
        ? issues.map((entry) => this.formatEntry(entry))
        : ['No errors or warnings were captured.']),
      '',
      '## Chronological log',
      '',
      ...this.entries().map((entry) => this.formatEntry(entry)),
      '',
    ].join('\n');
  }

  private formatEntry(entry: DiagnosticEntry): string {
    return `${entry.timestamp} ${entry.level.toUpperCase()} [${entry.source}] ${entry.message.replace(/\r?\n/g, '\\n')}`;
  }
}
