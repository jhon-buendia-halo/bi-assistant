import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import {
  ChartColumnIncreasing,
  ChevronRight,
  Loader2,
  LucideAngularModule,
} from 'lucide-angular';
import { ShellState } from '../../../../core/shell/shell-state';
import { EMPTY_FILTERS } from '../../../monitoring/models/llm-call.model';
import { MonitoringStateService } from '../../../monitoring/services/monitoring-state.service';
import {
  DEFAULT_USAGE_PERIOD,
  USAGE_PERIODS,
  UsagePeriod,
  UsageSummary,
  formatCompact,
  formatCount,
  formatDay,
  formatMonth,
  formatUsd,
  localTimeZone,
  periodStart,
  toLocalInput,
} from '../../models/usage.model';
import { UsageApiService } from '../../services/usage-api.service';

type Outcome =
  { ok: true; summary: UsageSummary } | { ok: false; message: string };

/** One bar of a column chart. */
interface Column {
  key: string;
  label: string;
  axisLabel: string;
  costUsd: number;
  calls: number;
  /** 0..100, of the chart's scale. */
  height: number;
}

/** One row of a ranking. */
interface RankRow {
  key: string;
  name: string;
  detail: string | null;
  costUsd: number;
  calls: number;
  /** 0..100, of the ranking's highest cost. */
  width: number;
  /** Opens Monitoring's LLM calls filtered to it; null when it cannot. */
  filter: { key: 'agent' | 'model'; value: string } | null;
  unpriced: boolean;
}

/** A round scale ceiling at or above the highest value (1, 2, 2.5, 5 × 10ⁿ). */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

function columns(
  items: {
    key: string;
    label: string;
    axisLabel: string;
    costUsd: number;
    calls: number;
  }[],
): { scale: number; bars: Column[] } {
  const scale = niceCeiling(Math.max(0, ...items.map((i) => i.costUsd)));
  return {
    scale,
    bars: items.map((i) => ({ ...i, height: (i.costUsd / scale) * 100 })),
  };
}

function ranking(items: Omit<RankRow, 'width'>[]): RankRow[] {
  const top = Math.max(0, ...items.map((i) => i.costUsd));
  return items.map((i) => ({
    ...i,
    width: top > 0 ? (i.costUsd / top) * 100 : 0,
  }));
}

/**
 * The Costs (rail item): the estimated LLM cost of the app's agents
 * today, this month and over a chosen period, by day, by month and ranked by
 * model, workflow and agent. A model or agent opens Monitoring's LLM calls
 * filtered to it.
 */
@Component({
  selector: 'app-costs-page',
  imports: [LucideAngularModule, NgTemplateOutlet],
  templateUrl: './costs-page.html',
})
export class CostsPage {
  readonly ChartColumnIncreasing = ChartColumnIncreasing;
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;

  readonly periods = USAGE_PERIODS;
  readonly formatUsd = formatUsd;
  readonly formatCount = formatCount;
  readonly formatCompact = formatCompact;

  private readonly api = inject(UsageApiService);
  private readonly shell = inject(ShellState);
  private readonly monitoring = inject(MonitoringStateService);

  readonly period = signal<UsagePeriod>(DEFAULT_USAGE_PERIOD);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly summary = signal<UsageSummary | null>(null);
  readonly showDailyTable = signal(false);
  readonly showMonthlyTable = signal(false);
  /** The hovered or focused bar, for its tooltip: `<chart>:<key>`. */
  readonly hovered = signal<string | null>(null);

  readonly periodLabel = computed(
    () => this.periods.find((p) => p.value === this.period())?.label ?? '',
  );

  readonly unpricedCalls = computed(() => {
    const totals = this.summary()?.totals;
    return totals ? totals.calls - totals.pricedCalls : 0;
  });

  readonly daily = computed(() =>
    columns(
      (this.summary()?.daily ?? []).map((d) => ({
        key: d.date,
        label: formatDay(d.date),
        axisLabel: formatDay(d.date),
        costUsd: d.costUsd,
        calls: d.calls,
      })),
    ),
  );

  /** First, middle and last day under the daily chart. */
  readonly dailyTicks = computed(() => {
    const bars = this.daily().bars;
    if (bars.length === 0) return [];
    const picks = [
      ...new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1]),
    ];
    return picks.map((i) => bars[i].axisLabel);
  });

  readonly monthly = computed(() =>
    columns(
      (this.summary()?.monthly ?? []).map((m) => ({
        key: m.month,
        label: formatMonth(m.month),
        axisLabel: formatMonth(m.month, true),
        costUsd: m.costUsd,
        calls: m.calls,
      })),
    ),
  );

  readonly byModel = computed(() =>
    ranking(
      (this.summary()?.byModel ?? []).map((m) => ({
        key: `${m.provider}:${m.model}`,
        name: m.model,
        detail: m.provider || null,
        costUsd: m.costUsd,
        calls: m.calls,
        filter: m.model ? { key: 'model' as const, value: m.model } : null,
        unpriced: !m.priced,
      })),
    ),
  );

  readonly byWorkflow = computed(() =>
    ranking(
      (this.summary()?.byWorkflow ?? []).map((w) => ({
        key: `${w.kind}:${w.id ?? w.name}`,
        name: w.name,
        detail: w.kind === 'none' ? 'Chats, the agent panel, previews' : null,
        costUsd: w.costUsd,
        calls: w.calls,
        filter: null,
        unpriced: false,
      })),
    ),
  );

  readonly byAgent = computed(() =>
    ranking(
      (this.summary()?.byAgent ?? []).map((a) => ({
        key: a.id ?? '',
        name: a.name,
        detail: null,
        costUsd: a.costUsd,
        calls: a.calls,
        filter: a.id ? { key: 'agent' as const, value: a.id } : null,
        unpriced: false,
      })),
    ),
  );

  constructor() {
    toObservable(this.period)
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((period) =>
          this.api
            .summary({ from: periodStart(period), timeZone: localTimeZone() })
            .pipe(
              map((summary): Outcome => ({ ok: true, summary })),
              catchError((err) => {
                const detail = err?.error?.message;
                return of<Outcome>({
                  ok: false,
                  message:
                    typeof detail === 'string' && detail
                      ? `Could not load usage: ${detail}`
                      : 'Could not load usage',
                });
              }),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => {
        if (outcome.ok) this.summary.set(outcome.summary);
        else this.error.set(outcome.message);
        this.loading.set(false);
      });
  }

  onPeriod(event: Event): void {
    this.period.set((event.target as HTMLSelectElement).value as UsagePeriod);
  }

  /** "$1.23 · 4 calls" for a bar's tooltip and accessible name. */
  barText(bar: Column): string {
    return `${bar.label}: ${formatUsd(bar.costUsd)} · ${formatCount(bar.calls)} ${bar.calls === 1 ? 'call' : 'calls'}`;
  }

  callsText(calls: number): string {
    return `${formatCount(calls)} ${calls === 1 ? 'call' : 'calls'}`;
  }

  /**
   * Opens Monitoring's LLM calls filtered to a model or an agent, over the
   * Costs page's period (Custom from its start; Any time for All time).
   */
  openInMonitoring(row: RankRow): void {
    if (!row.filter) return;
    const start = periodStart(this.period());
    this.monitoring.filters.set({
      ...EMPTY_FILTERS,
      [row.filter.key]: row.filter.value,
      range: start ? 'custom' : 'any',
      from: start ? toLocalInput(start) : '',
    });
    this.monitoring.page.set(1);
    this.monitoring.setTab('calls');
    this.shell.selectArea('monitoring');
  }
}
