import { Component, computed, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  LucideAngularModule,
  MessagesSquare,
  X,
} from 'lucide-angular';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import { MonitoringStateService } from '../../services/monitoring-state.service';
import {
  DateRange,
  PAGE_SIZES,
  PageSize,
  STATUS_CHIPS,
  STATUS_LABELS,
  formatCost,
  formatDuration,
  formatStarted,
  formatTokens,
} from '../../models/llm-call.model';
import {
  SessionFilters,
  SessionPage,
  SessionRow,
  sessionName,
  toSessionQuery,
} from '../../models/session-flow.model';

type Outcome =
  | { ok: true; page: SessionPage }
  | { ok: false; message: string };

/**
 * The Monitoring page's Sessions tab (roadmap 1.21.16): one row per session
 * with recorded agent runs and its totals, most recent first, paged. A row
 * opens the session's execution flow (`openSession`).
 */
@Component({
  selector: 'app-sessions-page',
  imports: [LucideAngularModule],
  templateUrl: './sessions-page.html',
})
export class SessionsPage {
  readonly ChevronLeft = ChevronLeft;
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;
  readonly MessagesSquare = MessagesSquare;
  readonly X = X;

  readonly pageSizes = PAGE_SIZES;
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
  readonly sessionName = sessionName;

  readonly openSession = output<string>();

  private readonly api = inject(MonitoringApiService);
  readonly state = inject(MonitoringStateService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly result = signal<SessionPage | null>(null);

  readonly filters = this.state.sessionFilters;

  private readonly query = computed(() =>
    toSessionQuery(
      this.state.sessionFilters(),
      this.state.sessionPage(),
      this.state.sessionPageSize(),
    ),
  );

  /** A chosen agent the facets lack still shows in its select. */
  readonly agentOptions = computed(() => {
    const agents = this.result()?.facets.agents ?? [];
    const chosen = this.filters().agent;
    return chosen === '' || agents.some((a) => a.id === chosen)
      ? agents
      : [...agents, { id: chosen, name: chosen }];
  });

  readonly rows = computed(() => this.result()?.items ?? []);
  readonly total = computed(() => this.result()?.total ?? 0);

  /** "1–25 of 132". */
  readonly summary = computed(() => {
    const total = this.total();
    const first =
      (this.state.sessionPage() - 1) * this.state.sessionPageSize() + 1;
    const last = Math.min(total, first + this.rows().length - 1);
    return total === 0 ? '0 of 0' : `${first}–${last} of ${total}`;
  });

  readonly hasPrevious = computed(() => this.state.sessionPage() > 1);
  readonly hasNext = computed(
    () =>
      this.state.sessionPage() * this.state.sessionPageSize() < this.total(),
  );

  constructor() {
    toObservable(this.query)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((query) =>
          this.api.listSessions(query).pipe(
            map((page): Outcome => ({ ok: true, page })),
            catchError((err) => {
              const detail = err?.error?.message;
              return of<Outcome>({
                ok: false,
                message:
                  typeof detail === 'string' && detail
                    ? `Could not load sessions: ${detail}`
                    : 'Could not load sessions',
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

  onSelect(key: keyof SessionFilters, event: Event): void {
    const value = (event.target as HTMLSelectElement | HTMLInputElement).value;
    this.state.setSessionFilter(key, value as never);
  }

  onPageSize(event: Event): void {
    const size = Number((event.target as HTMLSelectElement).value);
    if ((PAGE_SIZES as readonly number[]).includes(size)) {
      this.state.setSessionPageSize(size as PageSize);
    }
  }

  previous(): void {
    if (this.hasPrevious()) {
      this.state.setSessionPage(this.state.sessionPage() - 1);
    }
  }

  next(): void {
    if (this.hasNext()) this.state.setSessionPage(this.state.sessionPage() + 1);
  }

  /** "Questions to Insights Assistant, Visual Designer"; "—" when none. */
  agentNames(row: SessionRow): string {
    return row.agents.length === 0
      ? '—'
      : row.agents.map((agent) => agent.name).join(', ');
  }

  open(row: SessionRow): void {
    this.openSession.emit(row.id);
  }
}
