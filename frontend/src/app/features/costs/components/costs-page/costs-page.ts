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
import { RunsState } from '../../../runs/services/runs-state';
import {
  DEFAULT_USAGE_PERIOD,
  USAGE_PERIODS,
  UsagePeriod,
  UsageSummary,
  UsageTopRun,
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
 * The Costs page (rail item): the estimated LLM cost of the app's agents
 * today, this month and over a chosen period; by day and month; per
 * workflow run and per question; split by token kind; the most expensive
 * runs; and ranked by model and agent. A run opens its page, and a model or
 * an agent opens Monitoring's LLM calls filtered to it.
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
  private readonly runs = inject(RunsState);

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

  /** Cost per workflow run: the workflows first, the calls outside last. */
  readonly workflowRows = computed(() => {
    const rows = this.summary()?.byWorkflow ?? [];
    return [
      ...rows.filter((w) => w.kind === 'workflow'),
      ...rows.filter((w) => w.kind === 'none'),
    ].map((w) => ({ ...w, key: `${w.kind}:${w.id ?? w.name}` }));
  });

  /** Where the cost goes: one row per token kind, sized to the period total. */
  readonly splitRows = computed(() => {
    const s = this.summary()?.split;
    if (!s) return [];
    const total = s.inputUsd + s.cacheWriteUsd + s.cacheReadUsd + s.outputUsd;
    const share = (usd: number) => (total > 0 ? (usd / total) * 100 : 0);
    return [
      { key: 'input', label: 'Input', usd: s.inputUsd, tokens: s.inputTokens },
      {
        key: 'cache-write',
        label: 'Cache writes',
        usd: s.cacheWriteUsd,
        tokens: s.cacheWriteTokens,
      },
      {
        key: 'cache-read',
        label: 'Cache reads',
        usd: s.cacheReadUsd,
        tokens: s.cacheReadTokens,
      },
      {
        key: 'output',
        label: 'Output',
        usd: s.outputUsd,
        tokens: s.outputTokens,
      },
    ].map((row) => ({ ...row, share: share(row.usd) }));
  });

  readonly topRuns = computed(() => this.summary()?.topRuns ?? []);

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

  countText(count: number, one: string, many: string): string {
    return `${formatCount(count)} ${count === 1 ? one : many}`;
  }

  /** "45.2 %". */
  formatShare(share: number): string {
    return `${share.toFixed(1)} %`;
  }

  /** "Nov 14, 3:05 PM" of an ISO instant, in local time. */
  formatStarted(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  /** A stored run opens on its page (its workflow's canvas or the run). */
  openRun(run: UsageTopRun): void {
    if (run.workflowId === null) return;
    this.runs.openRun(run.runId);
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
