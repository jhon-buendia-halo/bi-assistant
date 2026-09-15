import { Component, effect, inject, signal } from '@angular/core';
import { retry, timer } from 'rxjs';
import {
  LucideAngularModule,
  ArrowLeft,
  Bot,
  ChevronDown,
  CircleHelp,
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
  Settings,
  Signal,
  Sparkle,
  Trash2,
  Workflow,
} from 'lucide-angular';
import { DatabricksConfig } from './features/databricks/components/databricks-config/databricks-config';
import { LlmConfig } from './features/llm/components/llm-config/llm-config';
import { SandboxList } from './features/data-sandbox/components/sandbox-list/sandbox-list';
import { CatalogBrowser } from './features/data-sandbox/components/catalog-browser/catalog-browser';
import { EntityDetails } from './features/data-sandbox/components/entity-details/entity-details';
import { SandboxSelectionService } from './features/data-sandbox/services/sandbox-selection.service';
import { ToastContainer } from './shared/components/toast-container/toast-container';
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
  InteractiveVisualization,
  Project,
  ProjectVisualization,
} from './features/projects/models/project.model';
import { ReasoningEffort } from './features/llm/models/llm.model';
import { ToastService } from './core/toast/toast.service';

type SettingsSection = 'databricks' | 'llm' | null;
type MainView =
  'home' | 'sandbox' | 'sandbox-new' | 'conversation-new' | 'project-chat';

@Component({
  selector: 'app-root',
  imports: [
    LucideAngularModule,
    DatabricksConfig,
    LlmConfig,
    SandboxList,
    CatalogBrowser,
    EntityDetails,
    ToastContainer,
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
  readonly CircleHelp = CircleHelp;
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
  readonly Settings = Settings;
  readonly Signal = Signal;
  readonly Sparkle = Sparkle;
  readonly Trash2 = Trash2;
  readonly Workflow = Workflow;

  readonly sidebarOpen = signal(true);
  readonly settingsOpen = signal(false);
  readonly settingsSection = signal<SettingsSection>(null);
  readonly rightPanelOpen = signal(true);
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

  private readonly sandboxApi = inject(SandboxApiService);
  private readonly projectsApi = inject(ProjectsApiService);

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
    this.activeProject.set(project);
    this.mainView.set('project-chat');
    this.loadLatestVisualization(project);
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

  showVisualization(visualization: ProjectVisualization): void {
    const project = this.activeProject();
    if (!project) return;
    this.activeVisualization.set(null);
    this.visualizationError.set(null);
    this.rightPanelOpen.set(true);
    this.projectsApi.getVisualization(project.id, visualization.id).subscribe({
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
    // Selecting a Databricks element reveals its details in the right panel.
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
