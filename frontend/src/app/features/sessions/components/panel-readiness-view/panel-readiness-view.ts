import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import {
  READINESS_DIMENSION_ORDER,
  READINESS_SEVERITY_RANK,
  READINESS_UNASSESSED,
  ReadinessDimension,
  ReadinessFinding,
  ReadinessMaturity,
  ReadinessNotProfiled,
  ReadinessReport,
  ReadinessSeverity,
  readinessLabel,
  readinessTime,
} from '../../models/readiness.model';
import { ReadinessPanelItem } from '../../models/session.model';
import { SessionsApiService } from '../../services/sessions-api.service';

/** One row of the dimension bars. */
export interface ReadinessBar {
  dimension: ReadinessDimension;
  label: string;
  assessed: boolean;
  score: number;
  findingCount: number;
  totalChecks: number;
}

export type ReadinessFilter<T extends string> = T | 'all';

/** The eight dimensions the Dimension filter offers (R25). */
export const READINESS_FILTER_DIMENSIONS: readonly ReadinessDimension[] =
  READINESS_DIMENSION_ORDER.filter((d) => !READINESS_UNASSESSED.includes(d));

export const READINESS_FILTER_SEVERITIES: readonly ReadinessSeverity[] = [
  'high',
  'medium',
  'low',
  'info',
];

/** The ten bars in scorecard order; a dimension missing from the report reads as not assessed. */
export function readinessBars(report: ReadinessReport): ReadinessBar[] {
  return READINESS_DIMENSION_ORDER.map((dimension) => {
    const score = report.dimensionScores.find(
      (s) => s.dimension === dimension,
    );
    const assessed = !!score?.assessed;
    return {
      dimension,
      label: readinessLabel(dimension),
      assessed,
      score: assessed ? Math.max(0, Math.min(100, score!.score)) : 0,
      findingCount: score?.findingCount ?? 0,
      totalChecks: score?.totalChecks ?? 0,
    };
  });
}

/** Findings narrowed by both filters, most severe first, then in report order. */
export function filterReadinessFindings(
  findings: readonly ReadinessFinding[],
  dimension: ReadinessFilter<ReadinessDimension>,
  severity: ReadinessFilter<ReadinessSeverity>,
): ReadinessFinding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .filter(
      ({ finding }) =>
        (dimension === 'all' || finding.dimension === dimension) &&
        (severity === 'all' || finding.severity === severity),
    )
    .sort(
      (a, b) =>
        READINESS_SEVERITY_RANK[b.finding.severity] -
          READINESS_SEVERITY_RANK[a.finding.severity] || a.index - b.index,
    )
    .map(({ finding }) => finding);
}

/** `<namespace>.<entity>`, or the namespace for a source-level finding. */
export function readinessFindingTable(finding: ReadinessFinding): string {
  if (finding.entity) {
    return finding.namespace
      ? `${finding.namespace}.${finding.entity}`
      : finding.entity;
  }
  return finding.namespace ?? '';
}

export function readinessMeasured(value: number | string | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : String(value);
  }
  return value;
}

/** Why an entity's column checks were skipped, in words. */
export function readinessNotProfiledReason(np: ReadinessNotProfiled): string {
  if (np.reason === 'too-large') {
    return np.rowCount !== undefined
      ? `Too large — ${np.rowCount.toLocaleString('en-US')} rows, column checks skipped`
      : 'Too large — column checks skipped';
  }
  return 'Timed out — column checks skipped';
}

/** The band pill's status colour (ui.md 4.13.5). */
export function readinessMaturityClass(maturity: ReadinessMaturity): string {
  switch (maturity) {
    case 'Optimised':
    case 'Managed':
      return 'chip-success';
    case 'Defined':
      return 'chip-info';
    case 'Repeatable':
      return 'chip-warning';
    default:
      return 'chip-danger';
  }
}

export function readinessSeverityClass(severity: ReadinessSeverity): string {
  switch (severity) {
    case 'high':
      return 'chip-danger';
    case 'medium':
      return 'chip-warning';
    case 'low':
      return 'chip-info';
    default:
      return 'bg-surface-muted text-fg-muted';
  }
}

/**
 * The readiness scorecard (ui.md 4.13.5): a stored report's overall score and
 * band, one bar per dimension and the filterable findings table.
 *
 * Past assessments (unit BA-263) mounts in the summary row through the
 * `[readinessHistory]` content slot. The host reads `report()` (its
 * `datasourceId`) and `shownReportId()`, and calls `showReport(id)` to show
 * another report; the panel item stays the same.
 */
@Component({
  selector: 'app-panel-readiness-view',
  host: { class: 'block' },
  template: `
    <div
      class="h-full overflow-y-auto p-4"
      data-testid="readiness-scorecard"
    >
      @if (loading()) {
        <p class="text-[12px] text-fg-muted">Loading report…</p>
      } @else if (error(); as message) {
        <p
          role="alert"
          class="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-on-danger-soft"
        >
          {{ message }}
        </p>
      } @else if (report(); as r) {
        <header class="flex items-start gap-4">
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <div class="min-w-0">
              <h2 class="truncate text-[14px] font-medium text-fg-strong">
                {{ r.datasourceName }}
              </h2>
              <p class="text-[12px] text-fg-muted">
                <time [attr.datetime]="r.generatedAt">{{
                  time(r.generatedAt)
                }}</time>
              </p>
            </div>
            <div class="flex">
              <ng-content select="[readinessHistory]" />
            </div>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1">
            <p class="text-fg-muted">
              <span
                class="text-[28px] leading-8 font-semibold text-fg-strong"
                data-testid="readiness-overall"
                >{{ r.overallScore }}</span
              ><span class="text-[13px]">/100</span>
            </p>
            <span
              class="chip"
              [class]="maturityClass(r.maturity)"
              data-testid="readiness-maturity"
              >{{ r.maturity }}</span
            >
          </div>
        </header>

        <section class="mt-5" aria-labelledby="readiness-dimensions-heading">
          <h3 id="readiness-dimensions-heading" class="sr-only">Dimensions</h3>
          <ul class="flex flex-col gap-2" data-testid="readiness-dimensions">
            @for (bar of bars(); track bar.dimension) {
              <li
                class="flex items-center gap-3"
                [attr.data-testid]="'readiness-dimension-' + bar.dimension"
                [attr.data-assessed]="bar.assessed"
              >
                <span
                  class="w-[120px] shrink-0 text-[13px]"
                  [class]="bar.assessed ? 'text-fg' : 'text-fg-muted'"
                  >{{ bar.label }}</span
                >
                <span
                  class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted"
                  role="meter"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  [attr.aria-valuenow]="bar.assessed ? bar.score : null"
                  [attr.aria-label]="bar.label"
                  [attr.aria-valuetext]="
                    bar.assessed ? bar.score + ' out of 100' : 'Not assessed'
                  "
                >
                  @if (bar.assessed) {
                    <span
                      class="block h-full rounded-full bg-primary"
                      [style.width.%]="bar.score"
                    ></span>
                  }
                </span>
                @if (bar.assessed) {
                  <span
                    class="w-8 shrink-0 text-right text-[13px] font-medium text-fg"
                    >{{ bar.score }}</span
                  >
                  <span class="w-40 shrink-0 text-[12px] text-fg-muted"
                    >{{ bar.findingCount }}
                    {{ bar.findingCount === 1 ? "finding" : "findings" }} ·
                    {{ bar.totalChecks }}
                    {{ bar.totalChecks === 1 ? "check" : "checks" }}</span
                  >
                } @else {
                  <span class="w-48 shrink-0 text-[12px] text-fg-muted"
                    >Not assessed</span
                  >
                }
              </li>
            }
          </ul>
        </section>

        @if (r.notProfiled?.length) {
          <section
            class="mt-6"
            aria-labelledby="readiness-not-profiled-heading"
            data-testid="readiness-not-profiled"
          >
            <h3
              id="readiness-not-profiled-heading"
              class="text-[13px] font-medium text-fg-strong"
            >
              Not profiled ({{ r.notProfiled!.length }})
            </h3>
            <ul class="mt-2 flex flex-col gap-1">
              @for (np of r.notProfiled; track $index) {
                <li
                  class="flex flex-wrap items-baseline gap-x-3 text-[12px]"
                  [attr.data-testid]="'readiness-not-profiled-' + $index"
                >
                  <span class="font-mono text-[11px] text-fg">{{
                    np.entity
                  }}</span>
                  <span class="text-fg-muted">{{ notProfiledReason(np) }}</span>
                </li>
              }
            </ul>
          </section>
        }

        <section class="mt-6" aria-labelledby="readiness-findings-heading">
          <div class="flex flex-wrap items-end gap-3">
            <h3
              id="readiness-findings-heading"
              class="mr-auto text-[13px] font-medium text-fg-strong"
            >
              Findings
            </h3>
            <label class="flex flex-col gap-1">
              <span class="field-label">Dimension</span>
              <select
                class="field py-1 text-[12px]"
                aria-label="Dimension"
                data-testid="readiness-filter-dimension"
                [value]="dimensionFilter()"
                (change)="setDimension($event)"
              >
                <option value="all">All</option>
                @for (d of filterDimensions; track d) {
                  <option [value]="d">{{ label(d) }}</option>
                }
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span class="field-label">Severity</span>
              <select
                class="field py-1 text-[12px]"
                aria-label="Severity"
                data-testid="readiness-filter-severity"
                [value]="severityFilter()"
                (change)="setSeverity($event)"
              >
                <option value="all">All</option>
                @for (s of filterSeverities; track s) {
                  <option [value]="s">{{ label(s) }}</option>
                }
              </select>
            </label>
          </div>

          @if (r.findings.length === 0) {
            <p
              class="mt-3 text-[12px] text-fg-muted"
              data-testid="readiness-findings-empty"
            >
              No findings: every check passed.
            </p>
          } @else if (findings().length === 0) {
            <p
              class="mt-3 text-[12px] text-fg-muted"
              data-testid="readiness-findings-empty"
            >
              No findings match these filters.
            </p>
          } @else {
            <div class="mt-3 overflow-x-auto rounded-xl border border-border">
              <table class="w-full border-collapse text-left text-[12px]">
                <caption class="sr-only">
                  Findings, most severe first
                </caption>
                <thead class="bg-surface-muted">
                  <tr>
                    @for (column of columns; track column) {
                      <th
                        scope="col"
                        class="border-b border-border px-3 py-2 font-medium whitespace-nowrap text-fg-muted"
                      >
                        {{ column }}
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (finding of findings(); track $index) {
                    <tr
                      class="border-b border-border align-top last:border-b-0"
                      data-testid="readiness-finding"
                      [attr.data-severity]="finding.severity"
                      [attr.data-dimension]="finding.dimension"
                    >
                      <td class="px-3 py-2">
                        <span
                          class="chip"
                          [class]="severityClass(finding.severity)"
                          >{{ label(finding.severity) }}</span
                        >
                      </td>
                      <td class="px-3 py-2 whitespace-nowrap text-fg">
                        {{ label(finding.dimension) }}
                      </td>
                      <td class="px-3 py-2 font-mono text-[11px] text-fg">
                        {{ table(finding) }}
                      </td>
                      <td class="px-3 py-2 font-mono text-[11px] text-fg">
                        {{ finding.field ?? "" }}
                      </td>
                      <td class="px-3 py-2 whitespace-nowrap text-fg">
                        {{ measured(finding.measured) }}
                      </td>
                      <td class="min-w-[220px] px-3 py-2">
                        <p class="text-fg">{{ finding.description }}</p>
                        <p class="mt-0.5 text-[12px] text-fg-muted">
                          {{ finding.recommendation }}
                        </p>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }
    </div>
  `,
})
export class PanelReadinessView {
  private readonly api = inject(SessionsApiService);

  /** The panel item; showing it again (a new item object) shows its report again. */
  readonly item = input.required<ReadinessPanelItem>();

  /** The report on show: the item's, until `showReport` picks another. */
  readonly shownReportId = linkedSignal({
    source: this.item,
    computation: (item) => item.reportId,
  });
  readonly report = signal<ReadinessReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly dimensionFilter = signal<ReadinessFilter<ReadinessDimension>>('all');
  readonly severityFilter = signal<ReadinessFilter<ReadinessSeverity>>('all');

  readonly filterDimensions = READINESS_FILTER_DIMENSIONS;
  readonly filterSeverities = READINESS_FILTER_SEVERITIES;
  readonly columns = [
    'Severity',
    'Dimension',
    'Table',
    'Column',
    'Measured',
    'Description',
  ];

  readonly bars = computed(() => {
    const report = this.report();
    return report ? readinessBars(report) : [];
  });

  readonly findings = computed(() =>
    filterReadinessFindings(
      this.report()?.findings ?? [],
      this.dimensionFilter(),
      this.severityFilter(),
    ),
  );

  protected readonly label = readinessLabel;
  protected readonly table = readinessFindingTable;
  protected readonly measured = readinessMeasured;
  protected readonly maturityClass = readinessMaturityClass;
  protected readonly severityClass = readinessSeverityClass;
  protected readonly time = readinessTime;
  protected readonly notProfiledReason = readinessNotProfiledReason;

  constructor() {
    effect((onCleanup) => {
      const id = this.shownReportId();
      // Another report opens unfiltered: both filters default to All (R25).
      untracked(() => {
        this.dimensionFilter.set('all');
        this.severityFilter.set('all');
      });
      this.loading.set(true);
      this.error.set(null);
      this.report.set(null);
      const sub = this.api.getReadinessReport(id).subscribe({
        next: (report) => {
          this.report.set(report);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.message ?? 'Could not load the report');
          this.loading.set(false);
        },
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  /** Show another stored report (Past assessments, R26). */
  showReport(reportId: string): void {
    this.shownReportId.set(reportId);
  }

  setDimension(event: Event): void {
    this.dimensionFilter.set(
      (event.target as HTMLSelectElement)
        .value as ReadinessFilter<ReadinessDimension>,
    );
  }

  setSeverity(event: Event): void {
    this.severityFilter.set(
      (event.target as HTMLSelectElement)
        .value as ReadinessFilter<ReadinessSeverity>,
    );
  }
}
