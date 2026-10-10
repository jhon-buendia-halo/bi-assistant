import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { forkJoin, retry, timer } from 'rxjs';
import {
  LucideAngularModule,
  LucideIconData,
  ArrowLeft,
  Bot,
  BookOpen,
  ChevronDown,
  CircleCheck,
  CornerDownLeft,
  Database,
  EllipsisVertical,
  FlaskConical,
  FolderKanban,
  PanelLeft,
  Menu,
  SquarePen,
  PanelRight,
  Plus,
  RotateCcw,
  Search,
  ScrollText,
  Settings,
  Signal,
  Sparkle,
  Sparkles,
  TestTube,
  Trash2,
  Workflow,
  SunMoon,
  Wrench,
} from 'lucide-angular';
import { DatasourceConfig } from './features/datasources/components/datasource-config/datasource-config';
import {
  Datasource,
  kindLabel,
} from './features/datasources/models/datasource.model';
import { DatasourcesApiService } from './features/datasources/services/datasources-api.service';
import { LlmConfig } from './features/llm/components/llm-config/llm-config';
import { TestingDataConfig } from './features/testing-data/components/testing-data-config/testing-data-config';
import { DeveloperSettingsConfig } from './features/developer/components/developer-settings/developer-settings';
import { AppearanceSettings } from './features/appearance/components/appearance-settings/appearance-settings';
import { ThemeService } from './core/theme/theme.service';
import { DatasetList } from './features/datasets/components/dataset-list/dataset-list';
import { AgentHub } from './features/agents/components/agent-hub/agent-hub';
import { AgentDetail } from './features/agents/components/agent-detail/agent-detail';
import { EvalTrace } from './features/agents/components/eval-trace/eval-trace';
import { AgentEditor } from './features/agents/components/agent-editor/agent-editor';
import { AgentPreview } from './features/agents/components/agent-preview/agent-preview';
import { AgentEditorService } from './features/agents/services/agent-editor.service';
import { Agent } from './features/agents/services/agents-api.service';
import { agentKind } from './features/agents/services/agent-hub.util';
import { KnowledgeList } from './features/knowledge/components/knowledge-list/knowledge-list';
import { CatalogBrowser } from './features/datasets/components/catalog-browser/catalog-browser';
import { EntityDetails } from './features/datasets/components/entity-details/entity-details';
import { DatasetSelectionService } from './features/datasets/services/dataset-selection.service';
import { EvalSelectionService } from './features/agents/services/eval-selection.service';
import { BackendStatusBanner } from './shared/components/backend-status-banner/backend-status-banner';
import { ToastContainer } from './shared/components/toast-container/toast-container';
import { SystemLogsPanel } from './shared/components/system-logs-panel/system-logs-panel';
import { DiagnosticsService } from './core/diagnostics/diagnostics.service';
import {
  Dataset,
  DatasetsApiService,
} from './features/datasets/services/datasets-api.service';
import { LlmApiService } from './features/llm/services/llm-api.service';
import { SessionsApiService } from './features/sessions/services/sessions-api.service';
import { SessionChat } from './features/sessions/components/session-chat/session-chat';
import { InteractiveVisualPanel } from './features/sessions/components/interactive-visual-panel/interactive-visual-panel';
import {
  ChatMessage,
  DataPointSelection,
  InteractiveVisualization,
  Session,
  SessionActionResult,
  SessionVisualization,
  VisualEvent,
  sessionAgentLabel,
  sessionListSubtitle,
} from './features/sessions/models/session.model';
import { ReasoningEffort } from './features/llm/models/llm.model';
import { ToastService } from './core/toast/toast.service';
import { APP_VERSION } from './core/config/app-version';

type SettingsSection =
  | 'datasources'
  | 'llm'
  | 'testing-data'
  | 'developer'
  | 'appearance'
  | null;
type MainView =
  | 'home'
  | 'dataset'
  | 'dataset-new'
  | 'agents'
  | 'agent-detail'
  | 'agent-editor'
  | 'knowledge'
  | 'sessions'
  | 'conversation-new'
  | 'session-chat';

/** What the navigation rail selects (app-shell R3–R5, R46). */
type Area = 'datasets' | 'agents' | 'knowledge' | 'sessions' | 'settings';

/** The view each workspace area opens on. */
const AREA_ROOT: Record<Exclude<Area, 'settings'>, MainView> = {
  datasets: 'dataset',
  agents: 'agents',
  knowledge: 'knowledge',
  sessions: 'sessions',
};

const AREA_OF_VIEW: Partial<Record<MainView, Area>> = {
  dataset: 'datasets',
  'dataset-new': 'datasets',
  agents: 'agents',
  'agent-detail': 'agents',
  'agent-editor': 'agents',
  knowledge: 'knowledge',
  sessions: 'sessions',
  'conversation-new': 'sessions',
  'session-chat': 'sessions',
};

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
    BackendStatusBanner,
    DatasourceConfig,
    LlmConfig,
    TestingDataConfig,
    DeveloperSettingsConfig,
    AppearanceSettings,
    DatasetList,
    AgentHub,
    AgentDetail,
    EvalTrace,
    AgentEditor,
    AgentPreview,
    KnowledgeList,
    CatalogBrowser,
    EntityDetails,
    ToastContainer,
    SystemLogsPanel,
    SessionChat,
    InteractiveVisualPanel,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /** Shown in the settings sidebar footer; matches the installer's version. */
  readonly appVersion = APP_VERSION;

  readonly ArrowLeft = ArrowLeft;
  readonly Bot = Bot;
  readonly BookOpen = BookOpen;
  readonly ChevronDown = ChevronDown;
  readonly CircleCheck = CircleCheck;
  readonly CornerDownLeft = CornerDownLeft;
  readonly Database = Database;
  readonly EllipsisVertical = EllipsisVertical;
  readonly FlaskConical = FlaskConical;
  readonly FolderKanban = FolderKanban;
  readonly PanelLeft = PanelLeft;
  readonly Menu = Menu;
  readonly SquarePen = SquarePen;
  readonly PanelRight = PanelRight;
  readonly Plus = Plus;
  readonly RotateCcw = RotateCcw;
  readonly Search = Search;
  readonly ScrollText = ScrollText;
  readonly Settings = Settings;
  readonly Signal = Signal;
  readonly Sparkle = Sparkle;
  readonly Sparkles = Sparkles;
  readonly TestTube = TestTube;
  readonly Wrench = Wrench;
  readonly SunMoon = SunMoon;
  readonly Trash2 = Trash2;
  readonly Workflow = Workflow;

  readonly settingsOpen = signal(false);
  readonly settingsSection = signal<SettingsSection>(null);
  /** Closed on launch; opens on demand (app-shell R2, R10). */
  readonly rightPanelOpen = signal(false);
  readonly rightPanelResizing = signal(false);
  readonly rightPanelWidth = signal(this.readRightPanelWidth());
  readonly rightPanelMinWidth = MIN_RIGHT_PANEL_WIDTH;
  readonly systemLogsOpen = signal(false);
  readonly activeSessionDatasources = signal<Datasource[]>([]);
  readonly loadingSessionDatasources = signal(false);
  readonly datasourceKindLabel = kindLabel;
  readonly mainView = signal<MainView>('home');
  /** Dataset being edited in the catalog browser; null = creating a new one. */
  readonly editingDataset = signal<Dataset | null>(null);

  openDatasetEditor(dataset: Dataset | null): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.editingDataset.set(dataset);
    this.mainView.set('dataset-new');
  }

  /** Registry key of the agent open in the detail view. */
  readonly activeAgentKey = signal<string | null>(null);

  openAgent(agent: Agent): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.activeAgentKey.set(agent.key);
    this.mainView.set('agent-detail');
  }

  readonly agentEditor = inject(AgentEditorService);
  /** The user agent open in the editor; null = a new agent. */
  readonly editingAgentId = signal<string | null>(null);

  /** New agent on the hub, or Edit in a user agent's detail (R54). */
  openAgentEditor(agentId: string | null): void {
    this.editingAgentId.set(agentId);
    this.mainView.set('agent-editor');
  }

  /**
   * Back from the editor: to the agent's detail, or to the hub for an agent
   * that was never saved (R59).
   */
  closeAgentEditor(): void {
    if (!this.confirmLeaveAgentEditor()) return;
    const id = this.agentEditor.agentId();
    if (id) {
      this.activeAgentKey.set(id);
      this.mainView.set('agent-detail');
    } else {
      this.mainView.set('agents');
    }
  }

  /**
   * Every way out of the agent editor (Back, the rail, the drawer, Settings)
   * asks first when the form has unsaved changes; cancelling stays put
   * (R59). Leaving destroys the editor, which discards its preview (R61).
   */
  private confirmLeaveAgentEditor(): boolean {
    if (this.settingsOpen() || this.mainView() !== 'agent-editor') return true;
    if (!this.agentEditor.changed()) return true;
    return window.confirm('Discard unsaved changes?');
  }

  readonly agentLabel = sessionAgentLabel;
  readonly sessionSubtitle = sessionListSubtitle;

  /**
   * Back to the hub after deleting a user agent. Its sessions now read
   * `<name> · agent deleted` (sessions-chat R59), so the list is reloaded.
   */
  onAgentDeleted(): void {
    this.mainView.set('agents');
    this.loadSessions();
  }

  /** Key of the agent a session is being created from, while in flight. */
  readonly startingAgentKey = signal<string | null>(null);

  /**
   * Start chat on a hub card or an agent's detail (agents-evals R53). The
   * Official agent has no datasets of its own, so it opens the New-session
   * composer; a Live user agent gets its session created and opened at once
   * (sessions-chat R52). A refusal keeps the user where they are.
   */
  startChatWithAgent(agent: Agent): void {
    if (agentKind(agent) === 'official') {
      this.openComposer();
      return;
    }
    if (this.startingAgentKey()) return;
    this.startingAgentKey.set(agent.key);
    this.sessionsApi.createFromAgent(agent.key).subscribe({
      next: (res) => {
        this.startingAgentKey.set(null);
        if (res.ok && res.session) {
          this.toast.success(res.message);
          this.loadSessions();
          this.openSession(res.session);
        } else {
          this.toast.error(res.message);
        }
      },
      error: (err) => {
        this.startingAgentKey.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  private readonly datasetSelection = inject(DatasetSelectionService);
  private readonly evalSelection = inject(EvalSelectionService);
  private readonly llmApi = inject(LlmApiService);

  private readonly toast = inject(ToastService);
  // Created with the shell so the resolved theme is applied from start-up.
  private readonly theme = inject(ThemeService);
  readonly diagnostics = inject(DiagnosticsService);

  /** Model from the saved LLM configuration, shown in the composer chip. */
  readonly llmModel = signal<string | null>(null);
  readonly llmEffort = signal<ReasoningEffort>('high');
  readonly effortMenuOpen = signal(false);
  readonly reasoningEfforts: ReasoningEffort[] = ['low', 'medium', 'high'];

  /** Datasets offered in the composer; the session needs at least one. */
  readonly composerDatasets = signal<Dataset[]>([]);
  readonly selectedDatasets = signal<Set<string>>(new Set());
  readonly composerName = signal('');
  readonly creatingSession = signal(false);

  readonly sessions = signal<Session[]>([]);
  readonly activeSession = signal<Session | null>(null);
  readonly sessionMenuOpen = signal<string | null>(null);
  readonly deletingSession = signal<string | null>(null);
  readonly generatingVisualSession = signal<string | null>(null);
  readonly downloadingVisualization = signal<string | null>(null);
  readonly activeVisualization = signal<InteractiveVisualization | null>(null);
  readonly visualizationError = signal<string | null>(null);
  /** Latest data mark clicked inside a visual; drives the chat follow-up chips. */
  readonly selectedDataPoint = signal<DataPointSelection | null>(null);

  private readonly datasetApi = inject(DatasetsApiService);
  private readonly datasourcesApi = inject(DatasourcesApiService);
  private readonly sessionsApi = inject(SessionsApiService);
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

  loadSessions(): void {
    this.sessionsApi
      .list()
      .pipe(
        retry({
          count: 12,
          delay: (_error, retryCount) =>
            timer(Math.min(retryCount * 200, 1_000)),
        }),
      )
      .subscribe({
        next: (res) => this.sessions.set(res.sessions),
        // Preserve already-loaded sessions if the backend is briefly offline.
        error: () => this.toast.error('Could not load sessions'),
      });
  }

  openSession(session: Session): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.sessionMenuOpen.set(null);
    this.selectedDataPoint.set(null);
    this.activeSession.set(session);
    this.mainView.set('session-chat');
    this.loadActiveSessionDatasources(session);
    this.loadLatestVisualization(session);
  }

  private loadActiveSessionDatasources(session: Session): void {
    this.activeSessionDatasources.set([]);
    this.loadingSessionDatasources.set(true);
    forkJoin({
      datasets: this.datasetApi.getDatasets(),
      datasources: this.datasourcesApi.list(),
    }).subscribe({
      next: ({ datasets, datasources }) => {
        if (this.activeSession()?.id !== session.id) return;
        const defaultDatasource =
          datasources.datasources.find((item) => item.kind === 'databricks') ??
          datasources.datasources[0];
        const datasourceIds = new Set(
          datasets.datasets
            .filter((dataset) => session.datasets.includes(dataset.name))
            .map((dataset) => dataset.datasourceId ?? defaultDatasource?.id)
            .filter((id): id is string => Boolean(id)),
        );
        this.activeSessionDatasources.set(
          datasources.datasources.filter((item) => datasourceIds.has(item.id)),
        );
        this.loadingSessionDatasources.set(false);
      },
      error: () => {
        if (this.activeSession()?.id !== session.id) return;
        this.loadingSessionDatasources.set(false);
      },
    });
  }

  private loadLatestVisualization(session: Session): void {
    this.activeVisualization.set(null);
    this.visualizationError.set(null);
    const latest = session.visualizations?.at(-1);
    if (!latest) return;

    this.sessionsApi.getVisualization(session.id, latest.id).subscribe({
      next: (visualization) => {
        if (
          this.activeSession()?.id === session.id &&
          this.generatingVisualSession() !== session.id
        ) {
          this.activeVisualization.set(visualization);
        }
      },
      error: (err) => {
        if (this.activeSession()?.id === session.id) {
          this.visualizationError.set(
            err?.error?.message ?? 'Could not load the saved visual',
          );
        }
      },
    });
  }

  /** Re-read the active session so visuals metadata (versions) is fresh. */
  private refreshActiveSession(then?: (session: Session) => void): void {
    const current = this.activeSession();
    if (!current) return;
    this.sessionsApi.get(current.id).subscribe({
      next: (session) => {
        this.sessions.update((sessions) =>
          sessions.map((item) => (item.id === session.id ? session : item)),
        );
        if (this.activeSession()?.id === session.id) {
          this.activeSession.set(session);
          then?.(session);
        }
      },
      error: () => {
        // Keep the stale copy; the next turn will refresh it.
      },
    });
  }

  /**
   * The chat persisted the session out of band (answer feedback). Refresh the
   * cached copies; the chat guards same-id refreshes, so streams are safe.
   */
  onSessionUpdated(session: Session): void {
    this.sessions.update((sessions) =>
      sessions.map((item) => (item.id === session.id ? session : item)),
    );
    if (this.activeSession()?.id === session.id) {
      this.activeSession.set(session);
    }
  }

  /** A chat turn created/updated a visual — show the new version live. */
  onVisualUpdated(event: VisualEvent): void {
    this.refreshActiveSession((session) => {
      const meta = session.visualizations?.find((v) => v.id === event.visualId);
      if (meta) this.showVisualization(meta, event.version);
    });
  }

  selectVisualVersion(version: number): void {
    const visual = this.activeVisualization();
    if (!visual) return;
    this.showVisualization(visual, version);
  }

  revertVisualVersion(version: number): void {
    const session = this.activeSession();
    const visual = this.activeVisualization();
    if (!session || !visual) return;
    this.sessionsApi
      .revertVisualization(session.id, visual.id, version)
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
  onVisualRefreshed(result: SessionActionResult): void {
    if (this.applyVisualResult(result)) {
      this.toast.success(result.message);
    }
  }

  /**
   * Adopt a `{session, visualization}` payload into the cached copies. Returns
   * false when the call did not succeed, so callers can report it.
   */
  private applyVisualResult(result: SessionActionResult): boolean {
    if (!result.ok || !result.session || !result.visualization) return false;
    const session = result.session;
    this.sessions.update((sessions) =>
      sessions.map((item) => (item.id === session.id ? session : item)),
    );
    if (this.activeSession()?.id === session.id) {
      this.activeSession.set(session);
      this.activeVisualization.set(result.visualization);
    }
    return true;
  }

  /** A data mark inside the visual was clicked — offer follow-ups in the chat. */
  onDataPointSelected(selection: DataPointSelection): void {
    this.selectedDataPoint.set(selection);
  }

  showVisualization(
    visualization: SessionVisualization | VisualEvent,
    version?: number,
  ): void {
    const session = this.activeSession();
    if (!session) return;
    const id =
      'visualId' in visualization ? visualization.visualId : visualization.id;
    this.activeVisualization.set(null);
    this.visualizationError.set(null);
    this.selectedDataPoint.set(null);
    this.rightPanelOpen.set(true);
    this.sessionsApi.getVisualization(session.id, id, version).subscribe({
      next: (loaded) => {
        if (this.activeSession()?.id === session.id) {
          this.activeVisualization.set(loaded);
        }
      },
      error: (err) => {
        if (this.activeSession()?.id === session.id) {
          this.visualizationError.set(
            err?.error?.message ?? 'Could not load the saved visual',
          );
        }
      },
    });
  }

  downloadVisualization(visualization: InteractiveVisualization): void {
    const session = this.activeSession();
    if (!session || this.downloadingVisualization()) return;
    this.downloadingVisualization.set(visualization.id);
    this.sessionsApi
      .downloadVisualization(session.id, visualization.id)
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
    const session = this.activeSession();
    if (!session || this.generatingVisualSession()) return;

    this.generatingVisualSession.set(session.id);
    this.activeVisualization.set(null);
    this.visualizationError.set(null);
    this.rightPanelOpen.set(true);
    this.sessionsApi.generateVisualization(session.id, message.at).subscribe({
      next: (result) => {
        this.generatingVisualSession.set(null);
        if (!result.ok || !result.session || !result.visualization) {
          const error = result.message || 'Visual generation failed';
          if (this.activeSession()?.id === session.id) {
            this.visualizationError.set(error);
          }
          this.toast.error(error);
          return;
        }
        this.sessions.update((sessions) =>
          sessions.map((item) =>
            item.id === result.session!.id ? result.session! : item,
          ),
        );
        if (this.activeSession()?.id === result.session.id) {
          this.activeSession.set(result.session);
          this.activeVisualization.set(result.visualization);
        }
        this.toast.success(result.message);
      },
      error: (err) => {
        this.generatingVisualSession.set(null);
        const error = err?.error?.message ?? 'Backend unreachable';
        if (this.activeSession()?.id === session.id) {
          this.visualizationError.set(error);
        }
        this.toast.error(error);
      },
    });
  }

  toggleSessionMenu(id: string): void {
    this.sessionMenuOpen.set(this.sessionMenuOpen() === id ? null : id);
  }

  deleteSession(session: Session): void {
    this.sessionMenuOpen.set(null);
    const confirmed = window.confirm(
      `Delete “${session.name}”?\n\nThis permanently removes its conversation, agent memory, and workspace files.`,
    );
    if (!confirmed) return;

    this.deletingSession.set(session.id);
    this.sessionsApi.delete(session.id).subscribe({
      next: (res) => {
        this.deletingSession.set(null);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.sessions.update((sessions) =>
          sessions.filter((item) => item.id !== session.id),
        );
        if (this.activeSession()?.id === session.id) {
          this.activeSession.set(null);
          this.activeVisualization.set(null);
          this.visualizationError.set(null);
          // The agent editor is never left without asking (agents-evals R59).
          if (this.mainView() !== 'agent-editor') this.mainView.set('sessions');
        }
        this.toast.success(res.message);
      },
      error: (err) => {
        this.deletingSession.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  createSession(): void {
    if (this.creatingSession()) return;
    const name = this.composerName().trim();
    if (!name || this.selectedDatasets().size === 0) return;
    this.creatingSession.set(true);
    this.sessionsApi
      .create(name, Array.from(this.selectedDatasets()))
      .subscribe({
        next: (res) => {
          this.creatingSession.set(false);
          if (res.ok && res.session) {
            this.toast.success(res.message);
            this.composerName.set('');
            this.loadSessions();
            this.openSession(res.session);
          } else {
            this.toast.error(res.message);
          }
        },
        error: (err) => {
          this.creatingSession.set(false);
          this.toast.error(err?.error?.message ?? 'Backend unreachable');
        },
      });
  }

  openComposer(): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.mainView.set('conversation-new');
    this.selectedDatasets.set(new Set());
    this.llmApi.getSettings().subscribe({
      next: (v) => {
        this.llmModel.set(v.configured ? v.model : null);
        this.llmEffort.set(v.reasoningEffort);
      },
      error: () => this.llmModel.set(null),
    });
    this.datasetApi.getDatasets().subscribe({
      next: (res) => this.composerDatasets.set(res.datasets),
      error: () => this.composerDatasets.set([]),
    });
  }

  toggleDatasetSelection(name: string): void {
    const next = new Set(this.selectedDatasets());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.selectedDatasets.set(next);
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
      if (this.datasetSelection.selection()) this.rightPanelOpen.set(true);
    });
    // Selecting an eval question reveals how it ran (R10).
    effect(() => {
      if (this.evalSelection.selection()) this.rightPanelOpen.set(true);
    });
    this.loadSessions();
  }

  /** The rail area that is shown, or null on home. */
  readonly currentArea = computed<Area | null>(() =>
    this.settingsOpen() ? 'settings' : (AREA_OF_VIEW[this.mainView()] ?? null),
  );

  readonly railItems: { area: Exclude<Area, 'settings'>; label: string; icon: LucideIconData }[] = [
    { area: 'datasets', label: 'Datasets', icon: FlaskConical },
    { area: 'agents', label: 'Agents', icon: Bot },
    { area: 'knowledge', label: 'Knowledge', icon: BookOpen },
    { area: 'sessions', label: 'Sessions', icon: FolderKanban },
  ];

  readonly settingsSections: {
    key: Exclude<SettingsSection, null>;
    label: string;
    icon: LucideIconData;
  }[] = [
    { key: 'datasources', label: 'Datasource Configuration', icon: Database },
    { key: 'llm', label: 'LLM Configuration', icon: Bot },
    { key: 'testing-data', label: 'Testing Data', icon: TestTube },
    { key: 'developer', label: 'Developer', icon: Wrench },
    { key: 'appearance', label: 'Appearance', icon: SunMoon },
  ];

  /** The rail's drawer with labels and the session list (app-shell R48). */
  readonly navExpanded = signal(false);

  /** Title of the Sessions area's page header (app-shell R49). */
  readonly pageTitle = computed(() => {
    if (this.mainView() === 'session-chat') {
      return this.activeSession()?.name ?? 'Sessions';
    }
    return this.mainView() === 'conversation-new'
      ? 'New conversation'
      : 'Sessions';
  });

  /** The page header shows the session's datasources while a chat is open. */
  readonly showSessionContext = computed(
    () =>
      !this.settingsOpen() &&
      this.mainView() === 'session-chat' &&
      this.activeSession() !== null,
  );

  /**
   * Shows a rail area. An area that is already shown keeps its current view;
   * otherwise it opens on its main screen. Settings keeps its chosen section.
   */
  selectArea(area: Area): void {
    // The rail is a way out of the agent editor, Agents included: it returns
    // to the hub (agents-evals R59).
    const leavingEditor =
      !this.settingsOpen() && this.mainView() === 'agent-editor';
    const alreadyShown = this.currentArea() === area && !leavingEditor;
    if (!alreadyShown && !this.confirmLeaveAgentEditor()) return;
    if (area === 'settings') {
      // Settings covers the main view; the editor closes rather than wait
      // behind it, so its preview never shows beside a settings form.
      if (this.mainView() === 'agent-editor') this.mainView.set('agents');
      this.settingsOpen.set(true);
      return;
    }
    this.settingsOpen.set(false);
    // The session list lives in the drawer, so Sessions opens it (R3).
    if (area === 'sessions') this.navExpanded.set(true);
    if (!alreadyShown) this.mainView.set(AREA_ROOT[area]);
  }

  selectSection(section: Exclude<SettingsSection, null>): void {
    this.settingsSection.set(
      this.settingsSection() === section ? null : section,
    );
  }
}
