import { Component, computed, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { Gauge, Loader2, LucideAngularModule, X } from 'lucide-angular';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import { MonitoringStateService } from '../../services/monitoring-state.service';
import {
  AgentQualityFacets,
  AgentQualityPage as QualityPageData,
  AgentQualityRow,
  QUALITY_RANGES,
  QualityFilters,
  TONE_CHIPS,
  formatCost,
  formatDuration,
  formatErrorRate,
  formatLastEval,
  formatPassRate,
  formatPerQuestion,
  formatPercent,
  qualityTone,
  toQualityQuery,
} from '../../models/agent-quality.model';

type Outcome =
  { ok: true; page: QualityPageData } | { ok: false; message: string };

const NO_FACETS: AgentQualityFacets = { agents: [], sets: [], models: [] };

/**
 * The Monitoring page's Agent quality table: one row per agent persona with
 * its eval figures and its live figures (monitoring R58-R67). A row opens
 * the agent's eval executions (`openAgent`, the registry key).
 */
@Component({
  selector: 'app-agent-quality-page',
  imports: [LucideAngularModule],
  templateUrl: './agent-quality-page.html',
})
export class AgentQualityPage {
  readonly Gauge = Gauge;
  readonly Loader2 = Loader2;
  readonly X = X;

  readonly ranges = QUALITY_RANGES;
  readonly toneChips = TONE_CHIPS;
  readonly formatCost = formatCost;
  readonly formatDuration = formatDuration;
  readonly formatErrorRate = formatErrorRate;
  readonly formatLastEval = formatLastEval;
  readonly formatPassRate = formatPassRate;
  readonly formatPerQuestion = formatPerQuestion;
  readonly formatPercent = formatPercent;
  readonly tone = qualityTone;

  readonly openAgent = output<string>();

  private readonly api = inject(MonitoringApiService);
  readonly state = inject(MonitoringStateService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly result = signal<QualityPageData | null>(null);

  readonly filters = this.state.qualityFilters;

  private readonly query = computed(() => toQualityQuery(this.filters()));

  readonly facets = computed(() => this.result()?.facets ?? NO_FACETS);

  /** The sets of the chosen agent, or every set. */
  readonly setOptions = computed(() => {
    const agent = this.filters().agent;
    const sets = this.facets().sets;
    return agent === '' ? sets : sets.filter((s) => s.agentKey === agent);
  });

  readonly rows = computed(() => this.result()?.rows ?? []);

  constructor() {
    toObservable(this.query)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((query) =>
          this.api.getAgentQuality(query).pipe(
            map((page): Outcome => ({ ok: true, page })),
            catchError((err) => {
              const detail = err?.error?.message;
              return of<Outcome>({
                ok: false,
                message:
                  typeof detail === 'string' && detail
                    ? `Could not load agent quality: ${detail}`
                    : 'Could not load agent quality',
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

  onSelect(key: keyof QualityFilters, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.state.setQualityFilter(key, value as never);
  }

  open(row: AgentQualityRow): void {
    this.openAgent.emit(row.agentKey);
  }
}
