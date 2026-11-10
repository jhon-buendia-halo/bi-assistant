import { Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { ChevronDown, ChevronRight, Loader2, LucideAngularModule } from 'lucide-angular';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import {
  ContextSegment,
  ContextSegmentKey,
  LlmCallDetail,
  STATUS_CHIPS,
  STATUS_LABELS,
  formatCost,
  formatDuration,
  formatShare,
  formatStarted,
  formatTokens,
  sessionLabel,
} from '../../models/llm-call.model';

type Outcome =
  | { ok: true; call: LlmCallDetail }
  | { ok: false; message: string };

/**
 * One LLM call (roadmap 1.21.15): its facts, its context window as seven
 * boxes with their exact text, and its steps.
 */
@Component({
  selector: 'app-llm-call-detail',
  imports: [LucideAngularModule],
  templateUrl: './llm-call-detail.html',
})
export class LlmCallDetailPage {
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;

  readonly statusLabels = STATUS_LABELS;
  readonly statusChips = STATUS_CHIPS;
  readonly formatTokens = formatTokens;
  readonly formatDuration = formatDuration;
  readonly formatCost = formatCost;
  readonly formatShare = formatShare;
  readonly formatStarted = formatStarted;
  readonly sessionLabel = sessionLabel;

  readonly callId = input.required<string>();
  /** The session id, when its chat should open. */
  readonly openSession = output<string>();

  private readonly api = inject(MonitoringApiService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly call = signal<LlmCallDetail | null>(null);

  /** The boxes whose text is shown. */
  readonly expanded = signal<ReadonlySet<ContextSegmentKey>>(new Set());

  readonly title = computed(() => {
    const call = this.call();
    if (call === null) return '';
    return `${call.agent !== null ? call.agent.name : 'Model call'} · ${call.model}`;
  });

  /** The context size: the last step's input, else the segments' sum. */
  readonly contextTokens = computed(() => {
    const call = this.call();
    if (call === null) return 0;
    return (
      call.contextTokens ??
      call.segments.reduce((sum, segment) => sum + segment.tokens, 0)
    );
  });

  /** "≈ 17,647 tokens of 1,000,000 (1.8 %)", or "≈ 17,647 tokens". */
  readonly contextCaption = computed(() => {
    const call = this.call();
    const tokens = this.contextTokens();
    const base = `≈ ${formatTokens(tokens)} tokens`;
    if (call === null || call.contextLimit === null || call.contextLimit <= 0) {
      return base;
    }
    return `${base} of ${formatTokens(call.contextLimit)} (${formatShare(
      tokens / call.contextLimit,
    )})`;
  });

  /** The bar's parts: the non-empty segments. */
  readonly barParts = computed(() =>
    (this.call()?.segments ?? []).filter((segment) => segment.tokens > 0),
  );

  constructor() {
    toObservable(this.callId)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
          this.call.set(null);
          this.expanded.set(new Set());
        }),
        switchMap((id) =>
          this.api.get(id).pipe(
            map((call): Outcome => ({ ok: true, call })),
            catchError((err) => {
              const detail = err?.error?.message;
              return of<Outcome>({
                ok: false,
                message:
                  typeof detail === 'string' && detail
                    ? detail
                    : 'Could not load the LLM call',
              });
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => {
        if (outcome.ok) this.call.set(outcome.call);
        else this.error.set(outcome.message);
        this.loading.set(false);
      });
  }

  /** The segment's colour token (tokens.css, one per box). */
  colour(key: ContextSegmentKey): string {
    return `var(--qti-context-${key})`;
  }

  /** "Label: ≈ N tokens (P %)". */
  partTitle(segment: ContextSegment): string {
    return `${segment.label}: ≈ ${formatTokens(segment.tokens)} tokens (${formatShare(
      segment.share,
    )})`;
  }

  itemCount(segment: ContextSegment): string {
    const n = segment.items.length;
    return n === 1 ? '1 item' : `${n} items`;
  }

  isExpanded(key: ContextSegmentKey): boolean {
    return this.expanded().has(key);
  }

  toggle(key: ContextSegmentKey): void {
    this.expanded.update((keys) => {
      const next = new Set(keys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
}
