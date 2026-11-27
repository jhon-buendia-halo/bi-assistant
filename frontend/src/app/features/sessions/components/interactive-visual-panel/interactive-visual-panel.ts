import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  BarChart3,
  ChevronDown,
  Download,
  History,
  Loader2,
  LucideAngularModule,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-angular';
import {
  DataPointSelection,
  InteractiveVisualization,
  SessionActionResult,
} from '../../models/session.model';
import {
  RunVisualResult,
  WorkflowRunsApiService,
} from '../../../workflows/services/workflow-runs-api.service';
import {
  ResolvedTheme,
  ThemeService,
} from '../../../../core/theme/theme.service';
import {
  BackgroundTask,
  BackgroundTasksService,
} from '../../../../core/background-tasks/background-tasks.service';
import { RunsState } from '../../../runs/services/runs-state';
import { BRAND } from '../../../../core/brand/brand';
import type { Brand } from '../../../../core/brand/brand.model';

/**
 * Starts the visual's document in the app's theme and brand: the frame picks
 * its Light or Dark tokens from the root's `data-theme` (visuals R40) and the
 * brand's palette from `data-brand` (ADR-0045).
 */
export function withVisualTheme(
  document: string,
  theme: ResolvedTheme,
  brand: Brand['id'] = BRAND.id,
): string {
  return document.replace(
    /<html\b/i,
    `<html data-theme="${theme}" data-brand="${brand}"`,
  );
}

/**
 * Finished refresh tasks whose result a panel already applied, so a
 * panel shown again later does not apply the same result twice.
 */
const appliedTasks = new WeakMap<BackgroundTasksService, Set<number>>();

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
  readonly History = History;
  readonly Loader2 = Loader2;
  readonly RefreshCw = RefreshCw;
  readonly Sparkles = Sparkles;
  readonly TriangleAlert = TriangleAlert;

  /**
   * The stored run whose visual this is (api.md 133): Refresh data goes to its
   * route; a past chat has none (read-only).
   */
  readonly runId = input<string | null>(null);
  readonly visualization = input<InteractiveVisualization | null>(null);
  /** Read-only (a past chat): no Refresh, no revert. */
  readonly readOnly = input(false);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly downloading = input(false);
  /**
   * The panel's own label (`Visuals`) and its title and path line. A host that
   * titles the visual itself (a run's side panel, visuals R42) turns it off.
   */
  readonly chrome = input(true);
  readonly downloadVisual = output<InteractiveVisualization>();
  readonly selectVersion = output<number>();
  readonly revertVersion = output<number>();
  /** A refresh returned a fresh session + visualization. */
  readonly visualRefreshed = output<SessionActionResult & RunVisualResult>();
  /** The user clicked a data mark inside the sandboxed visual. */
  readonly dataPointSelected = output<DataPointSelection>();
  readonly versionMenuOpen = signal(false);
  /** Runtime error reported by the sandboxed visual via postMessage. */
  readonly runtimeError = signal<string | null>(null);
  private readonly runsApi = inject(WorkflowRunsApiService);
  private readonly tasks = inject(BackgroundTasksService);
  private readonly runs = inject(RunsState);
  private readonly destroyRef = inject(DestroyRef);
  private alive = true;

  /**
   * Refresh data runs as a background task keyed `<runId>/<visualId>`
   * (ADR-0047): they go on when the run is closed and read busy again when it
   * is reopened.
   */
  private readonly taskKey = computed(() => {
    const visual = this.visualization();
    const runId = this.runId();
    return visual && runId ? `${runId}/${visual.id}` : null;
  });
  private readonly refreshTask = computed(() => {
    const key = this.taskKey();
    return key ? this.tasks.latest('visual-refresh', key) : undefined;
  });
  /** A data-refresh call for the open visual is in flight. */
  readonly refreshingData = computed(
    () => this.refreshTask()?.status === 'running',
  );
  /** Version history of the open visual, newest first. */
  readonly versions = computed(() => {
    const visual = this.visualization();
    if (!visual) return [];
    const history = visual.versions?.length
      ? visual.versions
      : [
          {
            version: 1,
            createdAt: visual.createdAt,
            sourceMessageAt: visual.sourceMessageAt,
          },
        ];
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
    this.destroyRef.onDestroy(() => (this.alive = false));

    // A result is applied when the task ends and this panel shows that visual.
    this.tasks.finished$
      .pipe(takeUntilDestroyed())
      .subscribe((task) => this.applyFinished(task, true));
    // A panel shown again after the task ended applies the result it missed.
    effect(() => {
      const task = this.refreshTask();
      untracked(() => {
        if (task) this.applyFinished(task, false);
      });
    });

    // A new document means a fresh chance to run cleanly.
    effect(() => {
      this.visualization();
      this.runtimeError.set(null);
      this.versionMenuOpen.set(false);
    });
  }

  @HostListener('window:message', ['$event'])
  onFrameMessage(event: MessageEvent): void {
    const data = event.data as {
      type?: string;
      message?: string;
      value?: string;
      label?: string;
      column?: string;
    } | null;
    if (data?.type === 'visual-error') {
      this.runtimeError.set(data.message ?? 'The visual threw an error');
      return;
    }
    if (data?.type === 'visual-select' && data.value !== undefined) {
      const column =
        data.column === undefined ? undefined : String(data.column);
      this.dataPointSelected.emit({
        value: String(data.value),
        label: data.label === undefined ? undefined : String(data.label),
        ...(column ? { column } : {}),
      });
    }
  }

  private callRefresh(
    runId: string,
    visualId: string,
  ): Observable<RunVisualResult> {
    return this.runsApi.refreshVisualization(runId, visualId);
  }

  /** Re-run the open visual's stored SQL and adopt the fresh document. */
  refreshData(): void {
    const visual = this.visualization();
    const runId = this.runId();
    if (!visual || !runId || this.refreshingData()) return;
    this.startVisualTask(runId, visual, () =>
      this.callRefresh(runId, visual.id),
    );
  }

  private startVisualTask(
    runId: string,
    visual: InteractiveVisualization,
    work: () => Observable<RunVisualResult>,
  ): void {
    const key = `${runId}/${visual.id}`;
    this.tasks.start<RunVisualResult>({
      kind: 'visual-refresh',
      key,
      title: `Refreshing visual "${visual.title}"`,
      work,
      outcome: (last) => ({
        ok: !!last?.ok && !!last.visualization,
        message:
          last?.ok && last.visualization
            ? undefined
            : last?.message || 'Refresh failed',
      }),
      open: () => this.runs.openRun(runId),
      // A panel that still shows the visual reports the end itself.
      toast: () => !(this.alive && this.taskKey() === key),
    });
  }

  private applied(): Set<number> {
    let set = appliedTasks.get(this.tasks);
    if (!set) appliedTasks.set(this.tasks, (set = new Set<number>()));
    return set;
  }

  /** Adopts a finished refresh result the panel has not applied. */
  private applyFinished(task: BackgroundTask, justEnded: boolean): void {
    if (
      task.kind !== 'visual-refresh' ||
      task.status !== 'done' ||
      task.key !== this.taskKey() ||
      this.applied().has(task.id)
    ) {
      return;
    }
    const result = task.result as RunVisualResult | undefined;
    const open = this.visualization();
    if (!result?.ok || !result.visualization || !open) return;
    this.applied().add(task.id);
    if (
      !justEnded &&
      result.visualization.version === open.version &&
      result.visualization.currentVersion === open.currentVersion
    ) {
      return; // The host already shows this version.
    }
    this.visualRefreshed.emit(result);
  }

  pickVersion(version: number): void {
    this.versionMenuOpen.set(false);
    this.selectVersion.emit(version);
  }

  private readonly sanitizer = inject(DomSanitizer);
  private readonly theme = inject(ThemeService);
  private readonly frame =
    viewChild<ElementRef<HTMLIFrameElement>>('visualFrame');
  // The theme is read untracked: a theme change is sent to the open frame
  // (below) instead of reloading the visual and losing its state.
  readonly safeDocument = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      withVisualTheme(
        this.visualization()?.document ?? '',
        untracked(this.theme.resolved),
      ),
    ),
  );
  private readonly syncFrameTheme = effect(() => {
    const theme = this.theme.resolved();
    this.frame()?.nativeElement.contentWindow?.postMessage(
      { type: 'qti-theme', theme },
      '*',
    );
  });

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
