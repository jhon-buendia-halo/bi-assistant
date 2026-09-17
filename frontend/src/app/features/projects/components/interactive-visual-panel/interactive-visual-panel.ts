import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  BarChart3,
  ChevronDown,
  Download,
  Filter,
  GalleryVerticalEnd,
  History,
  LayoutGrid,
  Loader2,
  LucideAngularModule,
  Maximize2,
  Pin,
  PinOff,
  RefreshCw,
  Rows3,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
} from 'lucide-angular';
import {
  DashboardFilter,
  DataPointSelection,
  InteractiveVisualization,
  ProjectActionResult,
  ProjectVisualization,
} from '../../models/project.model';
import { ProjectsApiService } from '../../services/projects-api.service';

/** How the right panel shows visuals: one at a time, or a pinned grid. */
export type PanelViewMode = 'single' | 'dashboard';

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
  readonly Filter = Filter;
  readonly GalleryVerticalEnd = GalleryVerticalEnd;
  readonly History = History;
  readonly LayoutGrid = LayoutGrid;
  readonly Loader2 = Loader2;
  readonly Maximize2 = Maximize2;
  readonly Pin = Pin;
  readonly PinOff = PinOff;
  readonly RefreshCw = RefreshCw;
  readonly Rows3 = Rows3;
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
  /** Ids pinned to the dashboard, so the single view can show pinned state. */
  readonly pins = input<string[]>([]);
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
  /** A pin/unpin call succeeded — the host should refresh the project doc. */
  readonly pinsChanged = output<void>();
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

  /** Single visual vs. pinned dashboard grid. */
  readonly viewMode = signal<PanelViewMode>('single');
  readonly dashboardTiles = signal<InteractiveVisualization[]>([]);
  readonly dashboardLoading = signal(false);
  /** Filterable columns for the dashboard, derived server-side from the pinned tiles. */
  readonly dashboardFilters = signal<DashboardFilter[]>([]);
  /** Selected values per active filter column; a missing key means "no filter". */
  readonly activeFilters = signal<Record<string, string[]>>({});
  /** Which filter column's popover is open, if any. */
  readonly openFilterColumn = signal<string | null>(null);
  /** Every rendered dashboard tile iframe, kept live via a template ref. */
  private readonly tileFrames = viewChildren<ElementRef<HTMLIFrameElement>>('tileFrame');
  /** A pin/unpin call from the single view's Pin button is in flight. */
  readonly pinning = signal(false);
  /** `visualId` of a dashboard tile currently being unpinned. */
  readonly unpinningTileId = signal<string | null>(null);
  /** `visualId` of a dashboard tile currently having its data refreshed. */
  readonly refreshingTileId = signal<string | null>(null);
  /** A data-refresh call for the single open visual is in flight. */
  readonly refreshingData = signal(false);

  private readonly api = inject(ProjectsApiService);
  /** `visualId:version` pairs already given their one auto-repair attempt. */
  private readonly repairAttempts = new Set<string>();
  /** Tracks project changes so active filters reset for a new project. */
  private lastFilteredProjectId: string | null = null;

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
    // Fetch tiles whenever the dashboard becomes visible, and refetch when
    // the project changes while it stays visible.
    effect(() => {
      const mode = this.viewMode();
      const projectId = this.projectId();
      if (mode === 'dashboard' && projectId) this.refreshDashboard();
    });
    // A new project starts with a clean filter bar.
    effect(() => {
      const projectId = this.projectId();
      if (projectId === this.lastFilteredProjectId) return;
      this.lastFilteredProjectId = projectId;
      this.activeFilters.set({});
    });
    // Any change to the active filters is broadcast to every tile iframe.
    effect(() => {
      this.activeFilters();
      this.broadcastFilters();
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
      // Repair targets the single open visual — a tile's runtime error must
      // not kick off the auto-repair loop from underneath the dashboard grid.
      if (this.viewMode() === 'dashboard') return;
      this.handleRuntimeError(data.message ?? 'The visual threw an error');
      return;
    }
    if (data?.type === 'visual-select' && data.value !== undefined) {
      const column = data.column === undefined ? undefined : String(data.column);
      if (this.viewMode() === 'dashboard') {
        // Dashboard clicks cross-filter; only marks that name their column
        // can drive that (an unmarked mark has nothing to filter by).
        if (column) this.toggleFilterValue(column, String(data.value));
        return;
      }
      this.dataPointSelected.emit({
        value: String(data.value),
        label: data.label === undefined ? undefined : String(data.label),
        ...(column ? { column } : {}),
      });
    }
  }

  // ------------------------------------------------------- dashboard filters

  /** `{column, values}` pairs ready to post to every tile iframe. */
  private activeFilterArray(): DashboardFilter[] {
    return Object.entries(this.activeFilters()).map(([column, values]) => ({
      column,
      values,
    }));
  }

  /** Post one message to a tile iframe's sandboxed window. Isolated in its
   * own method so tests can verify what would be sent without depending on
   * cross-origin (opaque `about:srcdoc`) postMessage delivery. */
  private postToTile(
    iframe: HTMLIFrameElement,
    message: { type: 'qti-filter'; filters: DashboardFilter[] },
  ): void {
    iframe.contentWindow?.postMessage(message, '*');
  }

  /** Post the current filters to every dashboard tile iframe. */
  private broadcastFilters(): void {
    const filters = this.activeFilterArray();
    for (const ref of this.tileFrames()) {
      this.postToTile(ref.nativeElement, { type: 'qti-filter', filters });
    }
  }

  /** A tile iframe finished (re)loading — catch it up on the active filters. */
  onTileFrameLoad(event: Event): void {
    const iframe = event.target as HTMLIFrameElement;
    this.postToTile(iframe, {
      type: 'qti-filter',
      filters: this.activeFilterArray(),
    });
  }

  isFilterActive(column: string): boolean {
    return (this.activeFilters()[column]?.length ?? 0) > 0;
  }

  activeFilterCount(column: string): number {
    return this.activeFilters()[column]?.length ?? 0;
  }

  isFilterValueSelected(column: string, value: string): boolean {
    return this.activeFilters()[column]?.includes(value) ?? false;
  }

  readonly hasActiveFilters = computed(
    () => Object.keys(this.activeFilters()).length > 0,
  );

  toggleFilterPopover(column: string): void {
    this.openFilterColumn.update((current) => (current === column ? null : column));
  }

  toggleFilterValue(column: string, value: string): void {
    this.activeFilters.update((current) => {
      const existing = current[column] ?? [];
      const next = existing.includes(value)
        ? existing.filter((v) => v !== value)
        : [...existing, value];
      const updated = { ...current };
      if (next.length) updated[column] = next;
      else delete updated[column];
      return updated;
    });
  }

  clearFilters(): void {
    this.activeFilters.set({});
  }

  /** Drop active filter entries whose column or values no longer exist. */
  private pruneActiveFilters(filters: DashboardFilter[]): void {
    const allowed = new Map(filters.map((f) => [f.column, new Set(f.values)]));
    this.activeFilters.update((current) => {
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [column, values] of Object.entries(current)) {
        const allowedValues = allowed.get(column);
        if (!allowedValues) {
          changed = true;
          continue;
        }
        const kept = values.filter((v) => allowedValues.has(v));
        if (kept.length !== values.length) changed = true;
        if (kept.length) next[column] = kept;
        else changed = true;
      }
      return changed ? next : current;
    });
  }

  setViewMode(mode: PanelViewMode): void {
    this.viewMode.set(mode);
  }

  /** Ids pinned to the dashboard, for O(1) membership checks. */
  private readonly pinnedIds = computed(() => new Set(this.pins()));

  isPinned(visualId: string): boolean {
    return this.pinnedIds().has(visualId);
  }

  /** Fetch the current pinned-visual tiles. Public so the host can call it
   * after a tailor/repair/revert/create flow updates a pinned visual. */
  refreshDashboard(): void {
    const projectId = this.projectId();
    if (!projectId) return;
    this.dashboardLoading.set(true);
    this.api.getDashboard(projectId).subscribe({
      next: (result) => {
        this.dashboardLoading.set(false);
        this.dashboardTiles.set(result.tiles);
        const filters = result.filters ?? [];
        this.dashboardFilters.set(filters);
        this.pruneActiveFilters(filters);
      },
      error: () => {
        this.dashboardLoading.set(false);
        this.dashboardTiles.set([]);
        this.dashboardFilters.set([]);
        this.activeFilters.set({});
      },
    });
  }

  /** Pin/unpin the visual open in the single view. */
  togglePin(): void {
    const visual = this.visualization();
    const projectId = this.projectId();
    if (!visual || !projectId || this.pinning()) return;
    this.pinning.set(true);
    const pinned = this.isPinned(visual.id);
    const request$ = pinned
      ? this.api.unpinVisualization(projectId, visual.id)
      : this.api.pinVisualization(projectId, visual.id);
    request$.subscribe({
      next: () => {
        this.pinning.set(false);
        this.pinsChanged.emit();
        if (this.viewMode() === 'dashboard') this.refreshDashboard();
      },
      error: () => this.pinning.set(false),
    });
  }

  /** Unpin a tile from the dashboard grid, then refresh it. */
  unpinTile(visualId: string): void {
    const projectId = this.projectId();
    if (!projectId || this.unpinningTileId()) return;
    this.unpinningTileId.set(visualId);
    this.api.unpinVisualization(projectId, visualId).subscribe({
      next: () => {
        this.unpinningTileId.set(null);
        this.pinsChanged.emit();
        this.refreshDashboard();
      },
      error: () => this.unpinningTileId.set(null),
    });
  }

  /** Re-run a dashboard tile's stored SQL, then refetch its tile document. */
  refreshTile(visualId: string): void {
    const projectId = this.projectId();
    if (!projectId || this.refreshingTileId()) return;
    this.refreshingTileId.set(visualId);
    this.api.refreshVisualizationData(projectId, visualId).subscribe({
      next: () => {
        this.refreshingTileId.set(null);
        this.refreshDashboard();
      },
      error: () => this.refreshingTileId.set(null),
    });
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

  /** Open a dashboard tile in the single view. */
  openTileInSingle(tile: InteractiveVisualization): void {
    this.viewMode.set('single');
    this.viewVisual.emit(tile);
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

  /** Sandboxed documents for every dashboard tile, keyed by visual id. */
  readonly safeTileDocuments = computed(() => {
    const map = new Map<string, SafeHtml>();
    for (const tile of this.dashboardTiles()) {
      map.set(tile.id, this.sanitizer.bypassSecurityTrustHtml(tile.document));
    }
    return map;
  });

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
