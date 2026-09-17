import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  BarChart3,
  ChevronDown,
  Download,
  GalleryVerticalEnd,
  History,
  Loader2,
  LucideAngularModule,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
} from 'lucide-angular';
import {
  DataPointSelection,
  InteractiveVisualization,
  ProjectActionResult,
  ProjectVisualization,
} from '../../models/project.model';
import { ProjectsApiService } from '../../services/projects-api.service';

export type TailorChartType =
  | 'auto'
  | 'bar'
  | 'line'
  | 'scatter'
  | 'heatmap'
  | 'metric-cards'
  | 'table'
  | 'donut';

export type TailorSort = 'none' | 'asc' | 'desc';

export interface TailorOptions {
  chartType: TailorChartType;
  sort: TailorSort;
  topN: number | null;
}

const CHART_TYPE_PHRASES: Record<
  Exclude<TailorChartType, 'auto'>,
  string
> = {
  bar: 'Change the visual to a bar chart.',
  line: 'Change the visual to a line chart.',
  scatter: 'Change the visual to a scatter plot.',
  heatmap: 'Change the visual to a heatmap.',
  'metric-cards': 'Change the visual to metric cards.',
  table: 'Change the visual to a compact sortable table.',
  donut: 'Change the visual to a donut chart.',
};

/** Options offered in the tailoring popover, in display order. */
export const TAILOR_CHART_TYPES: { value: TailorChartType; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'heatmap', label: 'Heatmap' },
  { value: 'metric-cards', label: 'Metric cards' },
  { value: 'table', label: 'Table' },
  { value: 'donut', label: 'Donut' },
];

export const TAILOR_SORTS: { value: TailorSort; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

export const TAILOR_MIN_TOP_N = 3;
export const TAILOR_MAX_TOP_N = 50;

/**
 * Turn the popover selections into one plain-English instruction for the
 * designer agent. "Auto"/"None"/empty parts are skipped; an all-default form
 * yields an empty string (Apply stays disabled).
 */
export function buildTailorInstruction(options: TailorOptions): string {
  const parts: string[] = [];
  if (options.chartType !== 'auto') {
    parts.push(CHART_TYPE_PHRASES[options.chartType]);
  }
  if (options.sort === 'asc') {
    parts.push('Sort ascending by the main measure.');
  } else if (options.sort === 'desc') {
    parts.push('Sort descending by the main measure.');
  }
  const topN = options.topN;
  if (
    topN !== null &&
    Number.isInteger(topN) &&
    topN >= TAILOR_MIN_TOP_N &&
    topN <= TAILOR_MAX_TOP_N
  ) {
    parts.push(
      `Show only the top ${topN} items and group the rest as "Other".`,
    );
  }
  return parts.join(' ');
}

@Component({
  selector: 'app-interactive-visual-panel',
  imports: [LucideAngularModule],
  templateUrl: './interactive-visual-panel.html',
  styleUrl: './interactive-visual-panel.scss',
})
export class InteractiveVisualPanel {
  readonly BarChart3 = BarChart3;
  readonly ChevronDown = ChevronDown;
  readonly Download = Download;
  readonly GalleryVerticalEnd = GalleryVerticalEnd;
  readonly History = History;
  readonly Loader2 = Loader2;
  readonly RefreshCw = RefreshCw;
  readonly SlidersHorizontal = SlidersHorizontal;
  readonly Sparkles = Sparkles;
  readonly TriangleAlert = TriangleAlert;

  readonly chartTypes = TAILOR_CHART_TYPES;
  readonly sorts = TAILOR_SORTS;
  readonly minTopN = TAILOR_MIN_TOP_N;
  readonly maxTopN = TAILOR_MAX_TOP_N;

  readonly projectId = input<string | null>(null);
  readonly visualization = input<InteractiveVisualization | null>(null);
  readonly visualizations = input<ProjectVisualization[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly downloading = input(false);
  readonly viewVisual = output<ProjectVisualization>();
  readonly downloadVisual = output<InteractiveVisualization>();
  readonly selectVersion = output<number>();
  readonly revertVersion = output<number>();
  /** A repair or tailoring call returned a fresh project + visualization. */
  readonly visualRefreshed = output<ProjectActionResult>();
  /** The user clicked a data mark inside the sandboxed visual. */
  readonly dataPointSelected = output<DataPointSelection>();
  readonly visualMenuOpen = signal(false);
  readonly versionMenuOpen = signal(false);
  readonly tailorMenuOpen = signal(false);
  /** Runtime error reported by the sandboxed visual via postMessage. */
  readonly runtimeError = signal<string | null>(null);
  /** An auto-repair round trip is in flight. */
  readonly repairing = signal(false);
  readonly tailoring = signal(false);
  readonly tailorError = signal<string | null>(null);
  readonly tailorChartType = signal<TailorChartType>('auto');
  readonly tailorSort = signal<TailorSort>('none');
  readonly tailorTopN = signal<number | null>(null);

  /** A data-refresh call for the single open visual is in flight. */
  readonly refreshingData = signal(false);

  private readonly api = inject(ProjectsApiService);
  /** `visualId:version` pairs already given their one auto-repair attempt. */
  private readonly repairAttempts = new Set<string>();

  readonly tailorInstruction = computed(() =>
    buildTailorInstruction({
      chartType: this.tailorChartType(),
      sort: this.tailorSort(),
      topN: this.tailorTopN(),
    }),
  );

  /** Version history of the open visual, newest first. */
  readonly versions = computed(() => {
    const visual = this.visualization();
    if (!visual) return [];
    const history = visual.versions?.length
      ? visual.versions
      : [{ version: 1, createdAt: visual.createdAt, sourceMessageAt: visual.sourceMessageAt }];
    return history.slice().reverse();
  });
  readonly currentVersion = computed(
    () => this.visualization()?.currentVersion ?? 1,
  );
  readonly viewingOldVersion = computed(() => {
    const visual = this.visualization();
    return !!visual && visual.version !== this.currentVersion();
  });

  constructor() {
    // A new document means a fresh chance to run cleanly.
    effect(() => {
      this.visualization();
      this.runtimeError.set(null);
      this.versionMenuOpen.set(false);
    });
  }

  @HostListener('window:message', ['$event'])
  onFrameMessage(event: MessageEvent): void {
    const data = event.data as
      | {
          type?: string;
          message?: string;
          value?: string;
          label?: string;
          column?: string;
        }
      | null;
    if (data?.type === 'visual-error') {
      this.handleRuntimeError(data.message ?? 'The visual threw an error');
      return;
    }
    if (data?.type === 'visual-select' && data.value !== undefined) {
      const column = data.column === undefined ? undefined : String(data.column);
      this.dataPointSelected.emit({
        value: String(data.value),
        label: data.label === undefined ? undefined : String(data.label),
        ...(column ? { column } : {}),
      });
    }
  }

  /** Re-run the open visual's stored SQL and adopt the fresh document. */
  refreshData(): void {
    const visual = this.visualization();
    const projectId = this.projectId();
    if (!visual || !projectId || this.refreshingData()) return;
    this.refreshingData.set(true);
    this.api.refreshVisualizationData(projectId, visual.id).subscribe({
      next: (result) => {
        this.refreshingData.set(false);
        if (!result.ok || !result.visualization) return;
        this.visualRefreshed.emit(result);
      },
      error: () => this.refreshingData.set(false),
    });
  }

  /**
   * Try one silent repair per broken generation: only for the current version,
   * never while already repairing, and never for a version that is itself an
   * auto-repair. Anything else falls back to the banner.
   */
  private handleRuntimeError(message: string): void {
    const visual = this.visualization();
    const projectId = this.projectId();
    if (
      !visual ||
      !projectId ||
      this.viewingOldVersion() ||
      this.repairing() ||
      this.isAutoRepairVersion() ||
      this.repairAttempts.has(this.repairKey(visual.id, visual.version))
    ) {
      this.runtimeError.set(message);
      return;
    }

    this.repairAttempts.add(this.repairKey(visual.id, visual.version));
    this.runtimeError.set(null);
    this.repairing.set(true);
    this.api
      .repairVisualization(projectId, visual.id, message, visual.version)
      .subscribe({
        next: (result) => {
          this.repairing.set(false);
          if (!result.ok || !result.visualization) {
            this.runtimeError.set(message);
            return;
          }
          this.visualRefreshed.emit(result);
        },
        error: () => {
          this.repairing.set(false);
          this.runtimeError.set(message);
        },
      });
  }

  private repairKey(visualId: string, version: number): string {
    return `${visualId}:${version}`;
  }

  /** The version on screen was itself produced by an auto-repair. */
  private isAutoRepairVersion(): boolean {
    const visual = this.visualization();
    if (!visual) return false;
    const entry = visual.versions?.find((v) => v.version === visual.version);
    return !!entry?.instruction?.startsWith('auto-repair:');
  }

  toggleTailorMenu(): void {
    const open = !this.tailorMenuOpen();
    this.tailorMenuOpen.set(open);
    if (open) this.tailorError.set(null);
  }

  setTopN(raw: string): void {
    const value = Number(raw);
    this.tailorTopN.set(raw.trim() === '' || !Number.isFinite(value) ? null : Math.round(value));
  }

  applyTailoring(): void {
    const instruction = this.tailorInstruction();
    const visual = this.visualization();
    const projectId = this.projectId();
    if (!instruction || !visual || !projectId || this.tailoring()) return;

    this.tailorError.set(null);
    this.tailoring.set(true);
    this.api.tailorVisualization(projectId, visual.id, instruction).subscribe({
      next: (result) => {
        this.tailoring.set(false);
        if (!result.ok || !result.visualization) {
          this.tailorError.set(result.message || 'Tailoring failed');
          return;
        }
        this.resetTailorForm();
        this.tailorMenuOpen.set(false);
        this.visualRefreshed.emit(result);
      },
      error: (err) => {
        this.tailoring.set(false);
        this.tailorError.set(
          err?.error?.message ?? 'Backend unreachable',
        );
      },
    });
  }

  private resetTailorForm(): void {
    this.tailorChartType.set('auto');
    this.tailorSort.set('none');
    this.tailorTopN.set(null);
    this.tailorError.set(null);
  }

  pickVersion(version: number): void {
    this.versionMenuOpen.set(false);
    this.selectVersion.emit(version);
  }

  readonly savedVisualizations = computed(() =>
    this.visualizations().slice().reverse(),
  );

  private readonly sanitizer = inject(DomSanitizer);
  readonly safeDocument = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      this.visualization()?.document ?? '',
    ),
  );

  selectVisualization(visualization: ProjectVisualization): void {
    this.visualMenuOpen.set(false);
    this.viewVisual.emit(visualization);
  }

  formatCreatedAt(createdAt: string): string {
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime())
      ? createdAt
      : date.toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
  }
}
