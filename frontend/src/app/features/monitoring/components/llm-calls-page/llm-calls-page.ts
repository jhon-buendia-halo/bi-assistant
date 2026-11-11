import { Component, computed, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import {
  ChevronLeft,
  ChevronRight,
  Activity,
  Loader2,
  LucideAngularModule,
  X,
} from 'lucide-angular';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import { MonitoringStateService } from '../../services/monitoring-state.service';
import {
  DateRange,
  LlmCallFacets,
  LlmCallFilters,
  LlmCallPage,
  LlmCallRow,
  LlmCallStatus,
  PAGE_SIZES,
  PageSize,
  STATUS_CHIPS,
  STATUS_LABELS,
  formatCost,
  formatDuration,
  formatStarted,
  formatTokens,
  sessionLabel,
  toQuery,
} from '../../models/llm-call.model';

type Outcome =
  | { ok: true; page: LlmCallPage }
  | { ok: false; message: string };

const NO_FACETS: LlmCallFacets = {
  agents: [],
  models: [],
  providers: [],
  sessions: [],
};

/**
 * The Monitoring page's table of LLM calls (roadmap 1.21.14): filters,
 * newest first, paged. A row opens the call (`openCall`).
 */
@Component({
  selector: 'app-llm-calls-page',
  imports: [LucideAngularModule],
  templateUrl: './llm-calls-page.html',
})
export class LlmCallsPage {
  readonly Activity = Activity;
  readonly ChevronLeft = ChevronLeft;
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;
  readonly X = X;

  readonly pageSizes = PAGE_SIZES;
  readonly statuses: LlmCallStatus[] = ['succeeded', 'failed', 'running'];
  readonly statusLabels = STATUS_LABELS;
  readonly statusChips = STATUS_CHIPS;
  readonly ranges: { value: DateRange; label: string }[] = [
    { value: 'any', label: 'Any time' },
    { value: 'hour', label: 'Last hour' },
    { value: 'day', label: 'Last 24 hours' },
    { value: 'week', label: 'Last 7 days' },
    { value: 'custom', label: 'Custom' },
  ];

  readonly formatTokens = formatTokens;
  readonly formatDuration = formatDuration;
  readonly formatCost = formatCost;
  readonly formatStarted = formatStarted;
  readonly sessionLabel = sessionLabel;

  readonly openCall = output<string>();

  private readonly api = inject(MonitoringApiService);
  readonly state = inject(MonitoringStateService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly result = signal<LlmCallPage | null>(null);

  readonly filters = this.state.filters;

  private readonly query = computed(() =>
    toQuery(this.state.filters(), this.state.page(), this.state.pageSize()),
  );

  readonly facets = computed(() => this.result()?.facets ?? NO_FACETS);

  /** A chosen session the facets lack still shows in its select. */
  readonly sessionOptions = computed(() => {
    const sessions = this.facets().sessions;
    const chosen = this.filters().session;
    return chosen === '' || sessions.some((s) => s.id === chosen)
      ? sessions
      : [...sessions, { id: chosen, name: null }];
  });

  readonly rows = computed(() => this.result()?.items ?? []);
  readonly total = computed(() => this.result()?.total ?? 0);

  /** "1–25 of 132". */
  readonly summary = computed(() => {
    const total = this.total();
    const first = (this.state.page() - 1) * this.state.pageSize() + 1;
    const last = Math.min(total, first + this.rows().length - 1);
    return total === 0 ? '0 of 0' : `${first}–${last} of ${total}`;
  });

  readonly hasPrevious = computed(() => this.state.page() > 1);
  readonly hasNext = computed(
    () => this.state.page() * this.state.pageSize() < this.total(),
  );

  constructor() {
    toObservable(this.query)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((query) =>
          this.api.list(query).pipe(
            map((page): Outcome => ({ ok: true, page })),
            catchError((err) => {
              const detail = err?.error?.message;
              return of<Outcome>({
                ok: false,
                message:
                  typeof detail === 'string' && detail
                    ? `Could not load LLM calls: ${detail}`
                    : 'Could not load LLM calls',
              });
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => {
        if (outcome.ok) this.result.set(outcome.page);
        else this.error.set(outcome.message);
        this.loading.set(false);
      });
  }

  setFilter<K extends keyof LlmCallFilters>(
    key: K,
    value: LlmCallFilters[K],
  ): void {
    this.state.setFilter(key, value);
  }

  onSelect(key: keyof LlmCallFilters, event: Event): void {
    const value = (event.target as HTMLSelectElement | HTMLInputElement).value;
    this.state.setFilter(key, value as never);
  }

  onPageSize(event: Event): void {
    const size = Number((event.target as HTMLSelectElement).value);
    if ((PAGE_SIZES as readonly number[]).includes(size)) {
      this.state.setPageSize(size as PageSize);
    }
  }

  previous(): void {
    if (this.hasPrevious()) this.state.setPage(this.state.page() - 1);
  }

  next(): void {
    if (this.hasNext()) this.state.setPage(this.state.page() + 1);
  }

  open(row: LlmCallRow): void {
    this.openCall.emit(row.id);
  }
}
