import {
  Component,
  HostListener,
  effect,
  inject,
  signal,
} from '@angular/core';
import { forkJoin, retry, timer } from 'rxjs';
import {
  LucideAngularModule,
  ArrowLeft,
  Bot,
  ChevronDown,
  CircleCheck,
  CornerDownLeft,
  Database,
  EllipsisVertical,
  FlaskConical,
  FolderKanban,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  ScrollText,
  Settings,
  Signal,
  Sparkle,
  Trash2,
  Workflow,
} from 'lucide-angular';
import { DatasourceConfig } from './features/datasources/components/datasource-config/datasource-config';
import {
  Datasource,
  kindLabel,
} from './features/datasources/models/datasource.model';
import { DatasourcesApiService } from './features/datasources/services/datasources-api.service';
import { LlmConfig } from './features/llm/components/llm-config/llm-config';
import { SandboxList } from './features/data-sandbox/components/sandbox-list/sandbox-list';
import { CatalogBrowser } from './features/data-sandbox/components/catalog-browser/catalog-browser';
import { EntityDetails } from './features/data-sandbox/components/entity-details/entity-details';
import { SandboxSelectionService } from './features/data-sandbox/services/sandbox-selection.service';
import { ToastContainer } from './shared/components/toast-container/toast-container';
import { SystemLogsPanel } from './shared/components/system-logs-panel/system-logs-panel';
import { DiagnosticsService } from './core/diagnostics/diagnostics.service';
import {
  Sandbox,
  SandboxApiService,
} from './features/data-sandbox/services/sandbox-api.service';
import { LlmApiService } from './features/llm/services/llm-api.service';
import { ProjectsApiService } from './features/projects/services/projects-api.service';
import { ProjectChat } from './features/projects/components/project-chat/project-chat';
import { InteractiveVisualPanel } from './features/projects/components/interactive-visual-panel/interactive-visual-panel';
import {
  ChatMessage,
  DataPointSelection,
  InteractiveVisualization,
  Project,
  ProjectActionResult,
  ProjectVisualization,
  VisualEvent,
} from './features/projects/models/project.model';
import { ReasoningEffort } from './features/llm/models/llm.model';
import { ToastService } from './core/toast/toast.service';

type SettingsSection = 'datasources' | 'llm' | null;
type MainView =
  'home' | 'sandbox' | 'sandbox-new' | 'conversation-new' | 'project-chat';

const DEFAULT_RIGHT_PANEL_WIDTH = 572;
const MIN_RIGHT_PANEL_WIDTH = 360;
const MAX_RIGHT_PANEL_WIDTH = 960;
const MIN_PRIMARY_CONTENT_WIDTH = 240;
const RIGHT_PANEL_RESIZE_STEP = 24;
const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'questions-to-insights:right-panel-width';

@Component({
  selector: 'app-root',
  imports: [
    LucideAngularModule,
    DatasourceConfig,
    LlmConfig,
    SandboxList,
    CatalogBrowser,
    EntityDetails,
    ToastContainer,
    SystemLogsPanel,
    ProjectChat,
    InteractiveVisualPanel,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly ArrowLeft = ArrowLeft;
  readonly Bot = Bot;
  readonly ChevronDown = ChevronDown;
  readonly CircleCheck = CircleCheck;
  readonly CornerDownLeft = CornerDownLeft;
  readonly Database = Database;
  readonly EllipsisVertical = EllipsisVertical;
  readonly FlaskConical = FlaskConical;
  readonly FolderKanban = FolderKanban;
  readonly PanelLeft = PanelLeft;
  readonly PanelRight = PanelRight;
  readonly Plus = Plus;
  readonly Search = Search;
  readonly ScrollText = ScrollText;
  readonly Settings = Settings;
  readonly Signal = Signal;
  readonly Sparkle = Sparkle;
  readonly Trash2 = Trash2;
  readonly Workflow = Workflow;

  readonly sidebarOpen = signal(true);
  readonly settingsOpen = signal(false);
  readonly settingsSection = signal<SettingsSection>(null);
  readonly rightPanelOpen = signal(true);
  readonly rightPanelResizing = signal(false);
  readonly rightPanelWidth = signal(this.readRightPanelWidth());
  readonly rightPanelMinWidth = MIN_RIGHT_PANEL_WIDTH;
  readonly systemLogsOpen = signal(false);
  readonly activeProjectDatasources = signal<Datasource[]>([]);
  readonly loadingProjectDatasources = signal(false);
  readonly datasourceKindLabel = kindLabel;
  readonly mainView = signal<MainView>('home');
  /** Sandbox being edited in the catalog browser; null = creating a new one. */
  readonly editingSandbox = signal<Sandbox | null>(null);

  openSandboxEditor(sandbox: Sandbox | null): void {
    this.editingSandbox.set(sandbox);
    this.mainView.set('sandbox-new');
  }

  private readonly sandboxSelection = inject(SandboxSelectionService);
  private readonly llmApi = inject(LlmApiService);

  private readonly toast = inject(ToastService);
  readonly diagnostics = inject(DiagnosticsService);

  /** Model from the saved LLM configuration, shown in the composer chip. */
  readonly llmModel = signal<string | null>(null);
  readonly llmEffort = signal<ReasoningEffort>('high');
  readonly effortMenuOpen = signal(false);
  readonly reasoningEfforts: ReasoningEffort[] = ['low', 'medium', 'high'];

  /** Sandboxes offered in the composer; the project needs at least one. */
  readonly composerSandboxes = signal<Sandbox[]>([]);
  readonly selectedSandboxes = signal<Set<string>>(new Set());
  readonly composerName = signal('');
  readonly creatingProject = signal(false);

  readonly projects = signal<Project[]>([]);
  readonly activeProject = signal<Project | null>(null);
  readonly projectMenuOpen = signal<string | null>(null);
  readonly deletingProject = signal<string | null>(null);
  readonly generatingVisualProject = signal<string | null>(null);
  readonly downloadingVisualization = signal<string | null>(null);
  readonly activeVisualization = signal<InteractiveVisualization | null>(null);
  readonly visualizationError = signal<string | null>(null);
  /** Latest data mark clicked inside a visual; drives the chat follow-up chips. */
  readonly selectedDataPoint = signal<DataPointSelection | null>(null);

  private readonly sandboxApi = inject(SandboxApiService);
  private readonly datasourcesApi = inject(DatasourcesApiService);
  private readonly projectsApi = inject(ProjectsApiService);
  private rightPanelResizeStart:
    { pointerId: number; x: number; width: number } | undefined;
  private rightPanelResizeHandle: HTMLElement | undefined;

  rightPanelMaxWidth(): number {
    const viewportWidth =
      typeof window === 'undefined'
        ? MAX_RIGHT_PANEL_WIDTH + MIN_PRIMARY_CONTENT_WIDTH
        : window.innerWidth;
    return Math.max(
      MIN_RIGHT_PANEL_WIDTH,
      Math.min(
        MAX_RIGHT_PANEL_WIDTH,
        viewportWidth - MIN_PRIMARY_CONTENT_WIDTH,
      ),
    );
  }

  startRightPanelResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    this.rightPanelResizeHandle = handle;
    this.rightPanelResizeStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      width: this.rightPanelWidth(),
    };
    this.rightPanelResizing.set(true);
  }

  @HostListener('document:pointermove', ['$event'])
  resizeRightPanel(event: PointerEvent): void {
    const start = this.rightPanelResizeStart;
    if (!start || event.pointerId !== start.pointerId) return;
    this.setRightPanelWidth(start.width + start.x - event.clientX);
  }

  @HostListener('document:pointerup', ['$event'])
  @HostListener('document:pointercancel', ['$event'])
  finishRightPanelResize(event: PointerEvent): void {
    const start = this.rightPanelResizeStart;
    if (!start || event.pointerId !== start.pointerId) return;
    if (this.rightPanelResizeHandle?.hasPointerCapture(start.pointerId)) {
      this.rightPanelResizeHandle.releasePointerCapture(start.pointerId);
    }
    this.rightPanelResizeStart = undefined;
    this.rightPanelResizeHandle = undefined;
    this.rightPanelResizing.set(false);
    this.persistRightPanelWidth();
  }

  resizeRightPanelWithKeyboard(event: KeyboardEvent): void {
    let nextWidth: number | undefined;
    switch (event.key) {
      case 'ArrowLeft':
        nextWidth = this.rightPanelWidth() + RIGHT_PANEL_RESIZE_STEP;
        break;
      case 'ArrowRight':
        nextWidth = this.rightPanelWidth() - RIGHT_PANEL_RESIZE_STEP;
        break;
      case 'Home':
        nextWidth = MIN_RIGHT_PANEL_WIDTH;
        break;
      case 'End':
        nextWidth = this.rightPanelMaxWidth();
        break;
    }
    if (nextWidth === undefined) return;
    event.preventDefault();
    this.setRightPanelWidth(nextWidth);
    this.persistRightPanelWidth();
  }

  resetRightPanelWidth(): void {
    this.setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH);
    this.persistRightPanelWidth();
  }

  @HostListener('window:resize')
  constrainRightPanelWidth(): void {
    this.setRightPanelWidth(this.rightPanelWidth());
  }

  private setRightPanelWidth(width: number): void {
    this.rightPanelWidth.set(
      Math.round(
        Math.min(
          this.rightPanelMaxWidth(),
          Math.max(MIN_RIGHT_PANEL_WIDTH, width),
        ),
      ),
    );
  }

  private readRightPanelWidth(): number {
    if (typeof localStorage === 'undefined') return DEFAULT_RIGHT_PANEL_WIDTH;
    const saved = localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
    if (saved === null) return DEFAULT_RIGHT_PANEL_WIDTH;
    const stored = Number(saved);
    if (!Number.isFinite(stored)) return DEFAULT_RIGHT_PANEL_WIDTH;
    return Math.round(
      Math.min(
        this.rightPanelMaxWidth(),
        Math.max(MIN_RIGHT_PANEL_WIDTH, stored),
      ),
    );
  }

  private persistRightPanelWidth(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      RIGHT_PANEL_WIDTH_STORAGE_KEY,
      String(this.rightPanelWidth()),
    );
  }

  loadProjects(): void {
    this.projectsApi
      .list()
      .pipe(
        retry({
          count: 12,
          delay: (_error, retryCount) =>
            timer(Math.min(retryCount * 200, 1_000)),
        }),
      )
      .subscribe({
        next: (res) => this.projects.set(res.projects),
        // Preserve already-loaded projects if the backend is briefly offline.
        error: () => this.toast.error('Could not load projects'),
      });
  }

  openProject(project: Project): void {
    this.projectMenuOpen.set(null);
    this.selectedDataPoint.set(null);
    this.activeProject.set(project);
    this.mainView.set('project-chat');
    this.loadActiveProjectDatasources(project);
    this.loadLatestVisualization(project);
  }

  private loadActiveProjectDatasources(project: Project): void {
    this.activeProjectDatasources.set([]);
    this.loadingProjectDatasources.set(true);
    forkJoin({
      sandboxes: this.sandboxApi.getSandboxes(),
      datasources: this.datasourcesApi.list(),
    }).subscribe({
      next: ({ sandboxes, datasources }) => {
        if (this.activeProject()?.id !== project.id) return;
        const defaultDatasource =
          datasources.datasources.find((item) => item.kind === 'databricks') ??
          datasources.datasources[0];
        const datasourceIds = new Set(
          sandboxes.sandboxes
            .filter((sandbox) => project.sandboxes.includes(sandbox.name))
            .map((sandbox) => sandbox.datasourceId ?? defaultDatasource?.id)
            .filter((id): id is string => Boolean(id)),
        );
        this.activeProjectDatasources.set(
          datasources.datasources.filter((item) => datasourceIds.has(item.id)),
        );
        this.loadingProjectDatasources.set(false);
      },
      error: () => {
        if (this.activeProject()?.id !== project.id) return;
        this.loadingProjectDatasources.set(false);
      },
    });
  }

  private loadLatestVisualization(project: Project): void {
    this.activeVisualization.set(null);
    this.visualizationError.set(null);
    const latest = project.visualizations?.at(-1);
    if (!latest) return;

    this.projectsApi.getVisualization(project.id, latest.id).subscribe({
      next: (visualization) => {
        if (
          this.activeProject()?.id === project.id &&
          this.generatingVisualProject() !== project.id
        ) {
          this.activeVisualization.set(visualization);
        }
      },
      error: (err) => {
        if (this.activeProject()?.id === project.id) {
          this.visualizationError.set(
            err?.error?.message ?? 'Could not load the saved visual',
          );
        }
      },
    });
  }

  /** Re-read the active project so visuals metadata (versions) is fresh. */
  private refreshActiveProject(then?: (project: Project) => void): void {
    const current = this.activeProject();
    if (!current) return;
    this.projectsApi.get(current.id).subscribe({
      next: (project) => {
        this.projects.update((projects) =>
          projects.map((item) => (item.id === project.id ? project : item)),
        );
        if (this.activeProject()?.id === project.id) {
          this.activeProject.set(project);
          then?.(project);
        }
      },
      error: () => {
        // Keep the stale copy; the next turn will refresh it.
      },
    });
  }

  /**
   * The chat persisted the project out of band (answer feedback). Refresh the
   * cached copies; the chat guards same-id refreshes, so streams are safe.
   */
  onProjectUpdated(project: Project): void {
    this.projects.update((projects) =>
      projects.map((item) => (item.id === project.id ? project : item)),
    );
    if (this.activeProject()?.id === project.id) {
      this.activeProject.set(project);
    }
  }

  /** A chat turn created/updated a visual — show the new version live. */
  onVisualUpdated(event: VisualEvent): void {
    this.refreshActiveProject((project) => {
      const meta = project.visualizations?.find((v) => v.id === event.visualId);
      if (meta) this.showVisualization(meta, event.version);
    });
  }

  selectVisualVersion(version: number): void {
    const visual = this.activeVisualization();
    if (!visual) return;
    this.showVisualization(visual, version);
  }

  revertVisualVersion(version: number): void {
    const project = this.activeProject();
    const visual = this.activeVisualization();
    if (!project || !visual) return;
    this.projectsApi
      .revertVisualization(project.id, visual.id, version)
      .subscribe({
        next: (result) => {
          if (!this.applyVisualResult(result)) {
            this.toast.error(result.message || 'Revert failed');
            return;
          }
          this.toast.success(result.message);
        },
        error: (err) =>
          this.toast.error(err?.error?.message ?? 'Backend unreachable'),
      });
  }

  /**
   * The panel repaired or tailored the open visual and already has the fresh
   * payload — same refresh path as revert (no SSE event to wait for).
   */
  onVisualRefreshed(result: ProjectActionResult): void {
    if (this.applyVisualResult(result)) {
      this.toast.success(result.message);
    }
  }

  /**
   * Adopt a `{project, visualization}` payload into the cached copies. Returns
   * false when the call did not succeed, so callers can report it.
   */
  private applyVisualResult(result: ProjectActionResult): boolean {
    if (!result.ok || !result.project || !result.visualization) return false;
    const project = result.project;
    this.projects.update((projects) =>
      projects.map((item) => (item.id === project.id ? project : item)),
    );
    if (this.activeProject()?.id === project.id) {
      this.activeProject.set(project);
      this.activeVisualization.set(result.visualization);
    }
    return true;
  }

  /** A data mark inside the visual was clicked — offer follow-ups in the chat. */
  onDataPointSelected(selection: DataPointSelection): void {
    this.selectedDataPoint.set(selection);
  }

  showVisualization(
    visualization: ProjectVisualization | VisualEvent,
    version?: number,
  ): void {
    const project = this.activeProject();
    if (!project) return;
    const id =
      'visualId' in visualization ? visualization.visualId : visualization.id;
    this.activeVisualization.set(null);
    this.visualizationError.set(null);
    this.selectedDataPoint.set(null);
    this.rightPanelOpen.set(true);
    this.projectsApi.getVisualization(project.id, id, version).subscribe({
      next: (loaded) => {
        if (this.activeProject()?.id === project.id) {
          this.activeVisualization.set(loaded);
        }
      },
      error: (err) => {
        if (this.activeProject()?.id === project.id) {
          this.visualizationError.set(
            err?.error?.message ?? 'Could not load the saved visual',
          );
        }
      },
    });
  }

  downloadVisualization(visualization: InteractiveVisualization): void {
    const project = this.activeProject();
    if (!project || this.downloadingVisualization()) return;
    this.downloadingVisualization.set(visualization.id);
    this.projectsApi
      .downloadVisualization(project.id, visualization.id)
      .subscribe({
        next: (archive) => {
          this.downloadingVisualization.set(null);
          const slug = visualization.title
            .normalize('NFKD')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase()
            .slice(0, 64);
          const url = URL.createObjectURL(archive);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${slug || `visual-${visualization.id.slice(0, 8)}`}.zip`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          this.toast.success('Visual bundle downloaded');
        },
        error: (err) => {
          this.downloadingVisualization.set(null);
          this.toast.error(err?.error?.message ?? 'Bundle download failed');
        },
      });
  }

  generateInteractiveVisual(message: ChatMessage): void {
    const project = this.activeProject();
    if (!project || this.generatingVisualProject()) return;

    this.generatingVisualProject.set(project.id);
    this.activeVisualization.set(null);
    this.visualizationError.set(null);
    this.rightPanelOpen.set(true);
    this.projectsApi.generateVisualization(project.id, message.at).subscribe({
      next: (result) => {
        this.generatingVisualProject.set(null);
        if (!result.ok || !result.project || !result.visualization) {
          const error = result.message || 'Visual generation failed';
          if (this.activeProject()?.id === project.id) {
            this.visualizationError.set(error);
          }
          this.toast.error(error);
          return;
        }
        this.projects.update((projects) =>
          projects.map((item) =>
            item.id === result.project!.id ? result.project! : item,
          ),
        );
        if (this.activeProject()?.id === result.project.id) {
          this.activeProject.set(result.project);
          this.activeVisualization.set(result.visualization);
        }
        this.toast.success(result.message);
      },
      error: (err) => {
        this.generatingVisualProject.set(null);
        const error = err?.error?.message ?? 'Backend unreachable';
        if (this.activeProject()?.id === project.id) {
          this.visualizationError.set(error);
        }
        this.toast.error(error);
      },
    });
  }

  toggleProjectMenu(id: string): void {
    this.projectMenuOpen.set(this.projectMenuOpen() === id ? null : id);
  }

  deleteProject(project: Project): void {
    this.projectMenuOpen.set(null);
    const confirmed = window.confirm(
      `Delete “${project.name}”?\n\nThis permanently removes its conversation, agent memory, and workspace files.`,
    );
    if (!confirmed) return;

    this.deletingProject.set(project.id);
    this.projectsApi.delete(project.id).subscribe({
      next: (res) => {
        this.deletingProject.set(null);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.projects.update((projects) =>
          projects.filter((item) => item.id !== project.id),
        );
        if (this.activeProject()?.id === project.id) {
          this.activeProject.set(null);
          this.activeVisualization.set(null);
          this.visualizationError.set(null);
          this.mainView.set('home');
        }
        this.toast.success(res.message);
      },
      error: (err) => {
        this.deletingProject.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  createProject(): void {
    if (this.creatingProject()) return;
    const name = this.composerName().trim();
    if (!name || this.selectedSandboxes().size === 0) return;
    this.creatingProject.set(true);
    this.projectsApi
      .create(name, Array.from(this.selectedSandboxes()))
      .subscribe({
        next: (res) => {
          this.creatingProject.set(false);
          if (res.ok && res.project) {
            this.toast.success(res.message);
            this.composerName.set('');
            this.loadProjects();
            this.openProject(res.project);
          } else {
            this.toast.error(res.message);
          }
        },
        error: (err) => {
          this.creatingProject.set(false);
          this.toast.error(err?.error?.message ?? 'Backend unreachable');
        },
      });
  }

  openComposer(): void {
    this.mainView.set('conversation-new');
    this.selectedSandboxes.set(new Set());
    this.llmApi.getSettings().subscribe({
      next: (v) => {
        this.llmModel.set(v.configured ? v.model : null);
        this.llmEffort.set(v.reasoningEffort);
      },
      error: () => this.llmModel.set(null),
    });
    this.sandboxApi.getSandboxes().subscribe({
      next: (res) => this.composerSandboxes.set(res.sandboxes),
      error: () => this.composerSandboxes.set([]),
    });
  }

  toggleSandboxSelection(name: string): void {
    const next = new Set(this.selectedSandboxes());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.selectedSandboxes.set(next);
  }

  setEffort(effort: ReasoningEffort): void {
    this.effortMenuOpen.set(false);
    this.llmApi.saveReasoning(effort).subscribe({
      next: (res) => {
        if (res.ok) {
          this.llmEffort.set(effort);
          this.toast.success(res.message);
        } else {
          this.toast.error(res.message);
        }
      },
      error: (err) => {
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  constructor() {
    // Selecting a datasource element reveals its details in the right panel.
    effect(() => {
      if (this.sandboxSelection.selection()) this.rightPanelOpen.set(true);
    });
    this.loadProjects();
  }

  selectSection(section: Exclude<SettingsSection, null>): void {
    this.settingsSection.set(
      this.settingsSection() === section ? null : section,
    );
  }
}
