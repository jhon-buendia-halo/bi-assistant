import { Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { ExternalLink, Loader2, LucideAngularModule } from 'lucide-angular';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import { STATUS_LABELS } from '../../models/llm-call.model';
import {
  SPAN_KINDS,
  SPAN_KIND_LABELS,
  SpanNode,
  TraceDetail,
  formatSeconds,
  spanColour,
} from '../../models/session-flow.model';

type Outcome =
  | { ok: true; trace: TraceDetail }
  | { ok: false; message: string };

/** Indentation of a span's label per level of depth, in px. */
export const INDENT_PX = 14;

/**
 * One turn's spans as a waterfall (roadmap 1.21.16): an indented tree, each
 * span a bar on a shared time axis, and a panel with the selected span's
 * details. Framework spans are hidden until the switch shows them.
 */
@Component({
  selector: 'app-trace-waterfall',
  imports: [LucideAngularModule],
  templateUrl: './trace-waterfall.html',
})
export class TraceWaterfall {
  readonly ExternalLink = ExternalLink;
  readonly Loader2 = Loader2;

  readonly kinds = SPAN_KINDS;
  readonly kindLabels = SPAN_KIND_LABELS;
  readonly statusLabels = STATUS_LABELS;
  readonly colour = spanColour;
  readonly formatSeconds = formatSeconds;
  readonly indent = INDENT_PX;
  /** A running span's bar is striped (and faded). */
  readonly runningStripes =
    'repeating-linear-gradient(45deg, transparent 0 4px, rgb(255 255 255 / 0.5) 4px 8px)';

  readonly traceId = input.required<string>();
  /** The call (model_generation span id) to open. */
  readonly openCall = output<string>();

  private readonly api = inject(MonitoringApiService);

  /** Shows the framework spans (skill, processor, workspace, inference). */
  readonly framework = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly trace = signal<TraceDetail | null>(null);
  readonly selectedId = signal<string | null>(null);

  private readonly request = computed(() => ({
    traceId: this.traceId(),
    framework: this.framework(),
  }));

  readonly spans = computed(() => this.trace()?.spans ?? []);
  readonly hiddenCount = computed(() => this.trace()?.hiddenFramework ?? 0);

  /** The axis length in ms: the trace's duration, else its last span end. */
  readonly totalMs = computed(() => {
    const trace = this.trace();
    if (trace === null) return 1;
    const end = trace.spans.reduce(
      (max, span) => Math.max(max, span.startMs + (span.durationMs ?? 0)),
      0,
    );
    return Math.max(1, trace.durationMs ?? end, end);
  });

  /** 0, ¼, ½, ¾ and the total, in seconds. */
  readonly ticks = computed(() => {
    const total = this.totalMs() / 1000;
    return [0, 0.25, 0.5, 0.75, 1].map((f, i) => {
      if (i === 0) return '0 s';
      const value = (total * f).toFixed(1);
      return i === 4 ? `${value} s` : value;
    });
  });

  readonly selected = computed(() => {
    const id = this.selectedId();
    return id === null
      ? null
      : (this.spans().find((span) => span.id === id) ?? null);
  });

  constructor() {
    toObservable(this.request)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap(({ traceId, framework }) =>
          this.api.getTrace(traceId, framework).pipe(
            map((trace): Outcome => ({ ok: true, trace })),
            catchError((err) => {
              const detail = err?.error?.message;
              return of<Outcome>({
                ok: false,
                message:
                  typeof detail === 'string' && detail
                    ? detail
                    : 'Could not load the timeline',
              });
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => {
        if (outcome.ok) {
          this.trace.set(outcome.trace);
          this.keepSelection(outcome.trace.spans);
        } else {
          this.error.set(outcome.message);
        }
        this.loading.set(false);
      });
  }

  /** Keeps the selected span when it is still listed; else the first request. */
  private keepSelection(spans: SpanNode[]): void {
    const id = this.selectedId();
    if (id !== null && spans.some((span) => span.id === id)) return;
    const first =
      spans.find((span) => span.kind === 'request') ?? spans[0] ?? null;
    this.selectedId.set(first === null ? null : first.id);
  }

  toggleFramework(): void {
    this.framework.update((shown) => !shown);
  }

  select(span: SpanNode): void {
    this.selectedId.set(span.id);
  }

  /** The bar's left edge, in % of the axis. */
  left(span: SpanNode): number {
    return Math.min(100, (span.startMs / this.totalMs()) * 100);
  }

  /** The bar's width, in % of the axis; a running span runs to the end. */
  width(span: SpanNode): number {
    const total = this.totalMs();
    const duration =
      span.durationMs === null ? total - span.startMs : span.durationMs;
    return Math.max(0, Math.min(100 - this.left(span), (duration / total) * 100));
  }

  /** "running" while the span has no end. */
  duration(span: SpanNode): string {
    return span.durationMs === null ? 'running' : formatSeconds(span.durationMs);
  }

  /** "+3.58 s". */
  offset(span: SpanNode): string {
    return `+${(span.startMs / 1000).toFixed(2)} s`;
  }

  canOpenCall(span: SpanNode): boolean {
    return (span.kind === 'model' || span.kind === 'request') && span.callId !== null;
  }

  open(span: SpanNode): void {
    if (span.callId !== null) this.openCall.emit(span.callId);
  }
}
