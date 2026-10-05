import { Component, computed, input } from '@angular/core';
import {
  TrendPoint,
  armLabel,
  formatRate,
  trendSeries,
} from '../../models/eval.model';

interface PlottedPoint {
  x: number;
  y: number;
  point: TrendPoint;
}

interface PlottedLine {
  key: string;
  color: string;
  path: string;
  points: PlottedPoint[];
}

interface AxisTick {
  x: number;
  label: string;
}

/**
 * Fixed dark-surface categorical order (the `dataviz` skill's validated
 * reference palette, `references/palette.md`): one hue per arm/model, in this
 * exact order, never cycled or reassigned as the series set changes. Past
 * eight distinct series the overflow folds into one muted "Other" line
 * rather than reusing a hue for a different identity.
 */
const SERIES_COLORS = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
];
const OTHER_COLOR = '#71717a';
const MAX_SERIES = SERIES_COLORS.length;

/**
 * Inline SVG line chart of pass^k rate over time, one line per arm (or
 * model), for the History sub-tab's "how is this suite trending" view.
 * Presentational only — the parent fetches `GET /evals/trend` and passes the
 * points down; this component just groups (`trendSeries`) and plots them.
 */
@Component({
  selector: 'app-eval-trend-chart',
  imports: [],
  templateUrl: './eval-trend-chart.html',
  styleUrl: './eval-trend-chart.scss',
})
export class EvalTrendChart {
  readonly points = input<TrendPoint[]>([]);
  /** One line per arm (default) or per model. */
  readonly groupBy = input<'arm' | 'model'>('arm');

  private readonly width = 640;
  private readonly height = 220;
  private readonly padLeft = 34;
  private readonly padRight = 16;
  private readonly padTop = 14;
  private readonly padBottom = 30;

  readonly viewBox = `0 0 ${this.width} ${this.height}`;
  readonly plotLeft = this.padLeft;
  readonly plotRight = this.width - this.padRight;
  readonly plotTop = this.padTop;
  readonly plotBottom = this.height - this.padBottom;

  /** Gridlines + labels at 0/25/50/75/100%. */
  readonly yTicks = [0, 25, 50, 75, 100].map((pct) => ({
    pct,
    y: this.yFor(pct / 100),
  }));

  readonly hasData = computed(() => this.points().length > 0);

  private readonly timeline = computed(() =>
    [...new Set(this.points().map((p) => p.startedAt))].sort((a, b) =>
      a.localeCompare(b),
    ),
  );

  /** X-axis labels: every run when there are few, else just first/middle/last. */
  readonly xTicks = computed<AxisTick[]>(() => {
    const timeline = this.timeline();
    const picks =
      timeline.length <= 8
        ? timeline
        : [
            timeline[0],
            timeline[Math.floor(timeline.length / 2)],
            timeline[timeline.length - 1],
          ];
    return [...new Set(picks)].map((startedAt) => ({
      x: this.xFor(startedAt),
      label: this.dateLabel(startedAt),
    }));
  });

  readonly lines = computed<PlottedLine[]>(() => {
    const series = trendSeries(this.points(), this.groupBy());
    const primary = series.slice(0, MAX_SERIES);
    const overflow = series.slice(MAX_SERIES);
    const lines = primary.map((s, i) =>
      this.toLine(s.key, s.points, SERIES_COLORS[i]),
    );
    if (overflow.length > 0) {
      const merged = overflow
        .flatMap((s) => s.points)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      lines.push(this.toLine('Other', merged, OTHER_COLOR));
    }
    return lines;
  });

  private toLine(
    key: string,
    points: TrendPoint[],
    color: string,
  ): PlottedLine {
    const plotted = points.map((point) => ({
      x: this.xFor(point.startedAt),
      y: this.yFor(point.passKRate),
      point,
    }));
    const path = plotted
      .map(
        (p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
      )
      .join(' ');
    return { key, color, path, points: plotted };
  }

  private xFor(startedAt: string): number {
    const timeline = this.timeline();
    const idx = timeline.indexOf(startedAt);
    const inner = this.plotRight - this.plotLeft;
    if (timeline.length <= 1) return this.plotLeft + inner / 2;
    return this.plotLeft + (idx / (timeline.length - 1)) * inner;
  }

  private yFor(rate: number): number {
    const inner = this.plotBottom - this.plotTop;
    const clamped = Math.max(0, Math.min(1, rate));
    return this.plotTop + (1 - clamped) * inner;
  }

  dateLabel(startedAt: string): string {
    const date = new Date(startedAt);
    return Number.isNaN(date.getTime())
      ? startedAt.slice(0, 10)
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /** Tooltip text for one dot's native `<title>`: label, model, pass^k, date. */
  pointTitle(point: TrendPoint): string {
    const label = point.label ? `${point.label} — ` : '';
    const arm = point.arm ? `${armLabel(point.arm)} · ` : '';
    const model = point.model ? `${point.model} · ` : '';
    return `${label}${arm}${model}pass^k ${formatRate(point.passKRate)} · ${this.dateLabel(point.startedAt)}`;
  }
}
