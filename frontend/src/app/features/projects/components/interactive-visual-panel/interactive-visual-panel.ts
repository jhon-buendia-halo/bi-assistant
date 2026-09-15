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
  Sparkles,
  TriangleAlert,
} from 'lucide-angular';
import {
  InteractiveVisualization,
  ProjectVisualization,
} from '../../models/project.model';

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
  readonly Sparkles = Sparkles;
  readonly TriangleAlert = TriangleAlert;

  readonly visualization = input<InteractiveVisualization | null>(null);
  readonly visualizations = input<ProjectVisualization[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly downloading = input(false);
  readonly viewVisual = output<ProjectVisualization>();
  readonly downloadVisual = output<InteractiveVisualization>();
  readonly selectVersion = output<number>();
  readonly revertVersion = output<number>();
  readonly visualMenuOpen = signal(false);
  readonly versionMenuOpen = signal(false);
  /** Runtime error reported by the sandboxed visual via postMessage. */
  readonly runtimeError = signal<string | null>(null);

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
    const data = event.data as { type?: string; message?: string } | null;
    if (data?.type === 'visual-error') {
      this.runtimeError.set(data.message ?? 'The visual threw an error');
    }
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
