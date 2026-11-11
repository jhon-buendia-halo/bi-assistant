import { NgTemplateOutlet } from '@angular/common';
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
  Layers,
  ChevronDown,
  CircleCheck,
  CornerDownLeft,
  Copy,
  Database,
  FlaskConical,
  FolderKanban,
  PanelLeft,
  Menu,
  SquarePen,
  PanelRight,
  RotateCcw,
  Search,
  ScrollText,
  Settings,
  Signal,
  Sparkle,
  Sparkles,
  TestTube,
  Workflow,
  SunMoon,
  Users,
  Wrench,
  Network,
  ChartColumn,
  Activity,
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
import { UiPreferencesService } from './core/preferences/ui-preferences.service';
import { DatasetList } from './features/datasets/components/dataset-list/dataset-list';
import { AgentHub } from './features/agents/components/agent-hub/agent-hub';
import { AgentDetail } from './features/agents/components/agent-detail/agent-detail';
import { WorkflowsPage } from './features/workflows/components/workflows-page/workflows-page';
import { WorkflowDetailPage } from './features/workflows/components/workflow-detail/workflow-detail';
import { WorkflowSummary } from './features/workflows/models/workflow.model';
import { workflowStartAction } from './features/workflows/services/workflows.util';
import { EvalTrace } from './features/agents/components/eval-trace/eval-trace';
import { AgentEditor } from './features/agents/components/agent-editor/agent-editor';
import { AgentPreview } from './features/agents/components/agent-preview/agent-preview';
import { SkillsLibrary } from './features/agents/components/skills-library/skills-library';
import { SkillEditor } from './features/agents/components/skill-editor/skill-editor';
import { BuiltInSkillEditor } from './features/agents/components/builtin-skill-editor/builtin-skill-editor';
import { BuiltInSkillEditorService } from './features/agents/services/builtin-skill-editor.service';
import { SkillEditorService } from './features/agents/services/skill-editor.service';
import { AgentEditorService } from './features/agents/services/agent-editor.service';
import { AgentPageState } from './features/agents/services/agent-page-state.service';
import { Agent } from './features/agents/services/agents-api.service';
import {
  ASSISTANT_PICKER_DESCRIPTION,
  ASSISTANT_PICKER_KEY,
  NewSessionAgentOption,
  newSessionAgentOptions,
  picksDatasets,
  startsInComposer,
} from './features/agents/services/agent-hub.util';
import {
  Agent as AgentEntry,
  AgentsApiService,
} from './features/agents/services/agents-api.service';
import { PersonaList } from './features/personas/components/persona-list/persona-list';
import { VisualLibrary } from './features/visuals/components/visual-library/visual-library';
import { OntologyOverview } from './features/ontology/components/ontology-overview/ontology-overview';
import { MonitoringTabs } from './features/monitoring/components/monitoring-tabs/monitoring-tabs';
import { LlmCallDetailPage } from './features/monitoring/components/llm-call-detail/llm-call-detail';
import { SessionFlowPage } from './features/monitoring/components/session-flow/session-flow';
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
import { SessionsList } from './features/sessions/components/sessions-list/sessions-list';
import { Welcome } from './features/home/components/welcome/welcome';
import { WorkflowBar } from './features/sessions/components/workflow-bar/workflow-bar';
import { SessionPanel } from './features/sessions/components/session-panel/session-panel';
import {
  ChatMessage,
  DataPointSelection,
  InteractiveVisualization,
  PanelItem,
  PanelItemEvent,
  WorkflowView,
  Session,
  SessionActionResult,
  SessionVisualization,
  VisualEvent,
  sessionAgentLabel,
} from './features/sessions/models/session.model';
import {
  LlmSettingsView,
  ReasoningEffort,
} from './features/llm/models/llm.model';
import { ToastService } from './core/toast/toast.service';
import { APP_VERSION } from './core/config/app-version';

type SettingsSection =
  'datasources' | 'llm' | 'testing-data' | 'developer' | 'appearance' | null;
type MainView =
  | 'home'
  | 'dataset'
  | 'dataset-new'
  | 'workflows'
  | 'workflow-detail'
  | 'agents'
  | 'agent-detail'
  | 'agent-editor'
  | 'skills'
  | 'skill-editor'
  | 'builtin-skill-editor'
  | 'context'
  | 'personas'
  | 'visuals'
  | 'ontologies'
  | 'sessions'
  | 'conversation-new'
  | 'session-chat'
  | 'monitoring'
  | 'monitoring-session'
  | 'llm-call';

/** What the navigation rail selects (app-shell R3–R5, R46). */
type Area =
  | 'datasets'
  | 'workflows'
  | 'agents'
  | 'context'
  | 'sessions'
  | 'monitoring'
  | 'settings';

/** The view each workspace area opens on. */
const AREA_ROOT: Record<Exclude<Area, 'settings'>, MainView> = {
  datasets: 'dataset',
  workflows: 'workflows',
  agents: 'agents',
  context: 'context',
  sessions: 'sessions',
  monitoring: 'monitoring',
};

const AREA_OF_VIEW: Partial<Record<MainView, Area>> = {
  dataset: 'datasets',
  'dataset-new': 'datasets',
  workflows: 'workflows',
  'workflow-detail': 'workflows',
  agents: 'agents',
  'agent-detail': 'agents',
  'agent-editor': 'agents',
  skills: 'agents',
  'skill-editor': 'agents',
  'builtin-skill-editor': 'agents',
  context: 'context',
  personas: 'context',
  visuals: 'context',
  ontologies: 'context',
  sessions: 'sessions',
  'conversation-new': 'sessions',
  'session-chat': 'sessions',
  monitoring: 'monitoring',
  'monitoring-session': 'monitoring',
  'llm-call': 'monitoring',
};

const DEFAULT_RIGHT_PANEL_WIDTH = 572;
const MIN_RIGHT_PANEL_WIDTH = 360;
const MAX_RIGHT_PANEL_WIDTH = 960;
const MIN_PRIMARY_CONTENT_WIDTH = 240;
const RIGHT_PANEL_RESIZE_STEP = 24;
const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'questions-to-insights:right-panel-width';

/** A row of the New conversation screen's Agent picker. */
export interface ComposerAgentRow {
  key: string;
  name: string;
  description: string;
  /** Why the agent cannot start a chat now, or null. */
  disabledReason: string | null;
}

/**
 * The composer chip's label for the saved LLM configuration (llm-settings
 * R53): the model, or for a custom endpoint `<model> · <host>` where host is
 * the saved base URL's host with its port. Null when nothing is configured.
 */
export function composerModelLabel(view: LlmSettingsView): string | null {
  if (!view.configured || !view.model) return null;
  if (view.provider === 'copilot') return `${view.model} · GitHub Copilot`;
  if (view.provider !== 'custom' || !view.baseUrl) return view.model;
  return `${view.model} · ${urlHost(view.baseUrl)}`;
}

function urlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

@Component({
  selector: 'app-shell',
  imports: [
    NgTemplateOutlet,
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
    WorkflowsPage,
    WorkflowDetailPage,
    EvalTrace,
    AgentEditor,
    SkillsLibrary,
    SkillEditor,
    BuiltInSkillEditor,
    AgentPreview,
    PersonaList,
    VisualLibrary,
    OntologyOverview,
    MonitoringTabs,
    LlmCallDetailPage,
    SessionFlowPage,
    CatalogBrowser,
    EntityDetails,
    ToastContainer,
    SystemLogsPanel,
    SessionChat,
    SessionPanel,
    WorkflowBar,
    Welcome,
    SessionsList,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /** Shown in the settings sidebar footer; matches the installer's version. */
  readonly appVersion = APP_VERSION;

  readonly ArrowLeft = ArrowLeft;
  readonly Bot = Bot;
  readonly ChevronDown = ChevronDown;
  readonly CircleCheck = CircleCheck;
  readonly CornerDownLeft = CornerDownLeft;
  readonly Copy = Copy;
  readonly Database = Database;
  readonly FlaskConical = FlaskConical;
  readonly FolderKanban = FolderKanban;
  readonly PanelLeft = PanelLeft;
  readonly Menu = Menu;
  readonly SquarePen = SquarePen;
  readonly PanelRight = PanelRight;
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
  private readonly agentPageState = inject(AgentPageState);

  /** All agents, from an agent's page; asks about an unsaved edit first. */
  closeAgentDetail(): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.mainView.set('agents');
  }
  /** The user agent open in the editor; null = a new agent. */
  readonly editingAgentId = signal<string | null>(null);

  /** New agent on the hub, or Edit in a user agent's detail (R54). */
  openAgentEditor(agentId: string | null): void {
    if (!this.confirmLeaveAgentEditor()) return;
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
    if (this.settingsOpen()) return true;
    const view = this.mainView();
    const changed =
      view === 'agent-editor'
        ? this.agentEditor.changed()
        : view === 'skill-editor'
          ? this.skillEditor.changed()
          : view === 'builtin-skill-editor'
            ? this.builtInSkillEditor.changed()
            : view === 'agent-detail' && this.agentPageState.dirty();
    if (!changed) return true;
    return window.confirm('Discard unsaved changes?');
  }

  readonly skillEditor = inject(SkillEditorService);
  readonly builtInSkillEditor = inject(BuiltInSkillEditorService);
  /** The built-in skill open in its editor. */
  readonly editingBuiltInName = signal<string | null>(null);
  /** The skill open in the skill editor; null = a new skill. */
  readonly editingSkillId = signal<string | null>(null);

  /** Skills on the hub, Back in the skill editor, or deleting a skill. */
  openSkillsLibrary(): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.mainView.set('skills');
  }

  /** New skill, or a row in the library. */
  openSkillEditor(skillId: string | null): void {
    this.editingSkillId.set(skillId);
    this.mainView.set('skill-editor');
  }

  /** A built-in row in the library. */
  openBuiltInSkillEditor(name: string, fromAgent = false): void {
    if (fromAgent && !this.confirmLeaveAgentEditor()) return;
    this.editingBuiltInName.set(name);
    this.builtInFromAgent = fromAgent;
    this.mainView.set('builtin-skill-editor');
  }

  /** The built-in editor was opened from an agent's Skills tab. */
  private builtInFromAgent = false;

  /** Back from the built-in editor: to the agent's page, or the library. */
  closeBuiltInSkillEditor(): void {
    if (this.builtInFromAgent && this.activeAgentKey()) {
      if (!this.confirmLeaveAgentEditor()) return;
      this.mainView.set('agent-detail');
      return;
    }
    this.openSkillsLibrary();
  }

  /** An editor is open: its unsaved changes are asked about before leaving. */
  private inEditor(): boolean {
    return (
      this.mainView() === 'agent-editor' ||
      this.mainView() === 'skill-editor' ||
      this.mainView() === 'builtin-skill-editor'
    );
  }

  readonly agentLabel = sessionAgentLabel;

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
   * Start chat on a hub card or an agent's detail (agents-evals R53). An
   * Official agent with no datasets of its own opens the New-session
   * composer, preselected to it when it picks datasets like the assistant
   * (Questions to Insights v2, sessions-chat R64); a Live user agent gets its
   * session created and opened at once (sessions-chat R52). A refusal keeps
   * the user where they are.
   */
  startChatWithAgent(agent: Agent): void {
    if (startsInComposer(agent)) {
      this.openComposer(picksDatasets(agent) ? agent.key : undefined);
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

  /** Id of the workflow open on its page (workflows R7). */
  readonly activeWorkflowId = signal<string | null>(null);
  /** Id of the workflow a session is being created from, while in flight. */
  readonly startingWorkflowId = signal<string | null>(null);

  /** A workflow card on the Workflows page opens the workflow's page (R7). */
  openWorkflow(id: string): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.settingsOpen.set(false);
    this.activeWorkflowId.set(id);
    this.mainView.set('workflow-detail');
  }

  /** All workflows, from a workflow's page. */
  closeWorkflowDetail(): void {
    this.mainView.set('workflows');
  }

  /** An agent row on a workflow's page opens the agent's detail (R8). */
  openAgentByKey(key: string): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.activeAgentKey.set(key);
    this.mainView.set('agent-detail');
  }

  /**
   * Start chat on a workflow card or page (workflows R6). A workflow that
   * takes the datasets the user picks opens the New conversation screen,
   * preselected through today's agent-key parameter (plan 5.7; 1.23.6 makes
   * it a workflow id); any other workflow gets its session created at once
   * and opened. A refusal keeps the user where they are.
   */
  startChatWithWorkflow(workflow: WorkflowSummary): void {
    const action = workflowStartAction(workflow);
    if (action.kind === 'composer') {
      this.openComposer(action.agentKey);
      return;
    }
    if (this.startingWorkflowId()) return;
    this.startingWorkflowId.set(workflow.id);
    this.sessionsApi.createFromWorkflow(workflow.id).subscribe({
      next: (res) => {
        this.startingWorkflowId.set(null);
        if (res.ok && res.session) {
          this.toast.success(res.message);
          this.loadSessions();
          this.openSession(res.session);
        } else {
          this.toast.error(res.message);
        }
      },
      error: (err) => {
        this.startingWorkflowId.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  private readonly datasetSelection = inject(DatasetSelectionService);
  private readonly evalSelection = inject(EvalSelectionService);
  private readonly llmApi = inject(LlmApiService);

  private readonly toast = inject(ToastService);

  /** Copy the open session's id, which a user shares to diagnose it. */
  copySessionId(id: string): void {
    void navigator.clipboard.writeText(id).then(
      () => this.toast.success('Session ID copied'),
      () => this.toast.error('Copy failed'),
    );
  }
  // Created with the shell so the resolved theme is applied from start-up.
  private readonly theme = inject(ThemeService);
  readonly diagnostics = inject(DiagnosticsService);

  /**
   * Model from the saved LLM configuration, shown in the composer chip
   * (`<model> · <host>` for a custom endpoint, llm-settings R53).
   */
  readonly llmModel = signal<string | null>(null);
  /** The chip's title: the full base URL for a custom endpoint (ui.md). */
  readonly llmModelTitle = signal<string | null>(null);
  readonly llmEffort = signal<ReasoningEffort>('high');
  readonly effortMenuOpen = signal(false);
  readonly reasoningEfforts: ReasoningEffort[] = ['low', 'medium', 'high'];

  /** Datasets offered in the composer; the session needs at least one. */
  readonly composerDatasets = signal<Dataset[]>([]);
  private readonly agentsApi = inject(AgentsApiService);
  readonly assistantPickerKey = ASSISTANT_PICKER_KEY;
  /** Agents the New conversation screen can start (sessions-chat R64). */
  readonly composerAgents = signal<NewSessionAgentOption[]>([]);
  /** The picked agent's key; Assistant on every visit, never remembered. */
  readonly composerAgentKey = signal<string>(ASSISTANT_PICKER_KEY);
  readonly composerAgent = computed<AgentEntry | null>(
    () =>
      this.composerAgents().find(
        (option) => option.agent.key === this.composerAgentKey(),
      )?.agent ?? null,
  );
  readonly composerAgentDescription = computed(
    () => this.composerAgent()?.description ?? ASSISTANT_PICKER_DESCRIPTION,
  );
  readonly composerAgentDatasets = computed(
    () => this.composerAgent()?.datasets ?? [],
  );
  /**
   * Whether the screen shows the dataset picker and requires a name: the
   * assistant and the agents that pick datasets like it (R64), not an agent
   * that brings its own datasets.
   */
  readonly composerPicksDatasets = computed(() => {
    const agent = this.composerAgent();
    return !agent || picksDatasets(agent);
  });

  pickComposerAgent(key: string): void {
    const option = this.composerAgents().find((o) => o.agent.key === key);
    this.composerAgentKey.set(
      option && !option.disabledReason ? key : ASSISTANT_PICKER_KEY,
    );
  }

  /** Rows of the Agent picker: Assistant first, then the agents it offers. */
  readonly composerAgentRows = computed<ComposerAgentRow[]>(() => [
    {
      key: ASSISTANT_PICKER_KEY,
      name: 'Assistant',
      description: ASSISTANT_PICKER_DESCRIPTION,
      disabledReason: null,
    },
    ...this.composerAgents().map((o) => ({
      key: o.agent.key,
      name: o.agent.name,
      description: o.agent.description ?? '',
      disabledReason: o.disabledReason,
    })),
  ]);
  readonly composerAgentName = computed(
    () =>
      this.composerAgentRows().find((r) => r.key === this.composerAgentKey())
        ?.name ?? 'Assistant',
  );
  readonly composerAgentMenuOpen = signal(false);
  /** Index in `composerAgentRows` of the highlighted option while open. */
  readonly composerAgentActive = signal(0);

  openComposerAgentMenu(): void {
    const index = this.composerAgentRows().findIndex(
      (r) => r.key === this.composerAgentKey(),
    );
    this.composerAgentActive.set(Math.max(0, index));
    this.composerAgentMenuOpen.set(true);
  }

  closeComposerAgentMenu(): void {
    this.composerAgentMenuOpen.set(false);
    document.getElementById('new-session-agent')?.focus();
  }

  chooseComposerAgent(key: string): void {
    const row = this.composerAgentRows().find((r) => r.key === key);
    if (!row || row.disabledReason) return;
    this.pickComposerAgent(key);
    this.closeComposerAgentMenu();
  }

  onComposerAgentKeydown(event: KeyboardEvent): void {
    const rows = this.composerAgentRows();
    if (!this.composerAgentMenuOpen()) {
      if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        this.openComposerAgentMenu();
      }
      return;
    }
    const step = (dir: 1 | -1) => {
      let i = this.composerAgentActive();
      for (let n = 0; n < rows.length; n++) {
        i = (i + dir + rows.length) % rows.length;
        if (!rows[i].disabledReason) return i;
      }
      return this.composerAgentActive();
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.composerAgentActive.set(step(1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.composerAgentActive.set(step(-1));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.chooseComposerAgent(rows[this.composerAgentActive()]?.key ?? '');
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.closeComposerAgentMenu();
        break;
      case 'Tab':
        this.composerAgentMenuOpen.set(false);
        break;
    }
  }
  readonly selectedDatasets = signal<Set<string>>(new Set());
  readonly composerName = signal('');
  readonly creatingSession = signal(false);

  readonly sessions = signal<Session[]>([]);
  /** False until the first list answer, for the Sessions page's loading line. */
  readonly sessionsLoaded = signal(false);
  readonly activeSession = signal<Session | null>(null);
  readonly deletingSession = signal<string | null>(null);
  readonly generatingVisualSession = signal<string | null>(null);
  readonly downloadingVisualization = signal<string | null>(null);
  readonly activeVisualization = signal<InteractiveVisualization | null>(null);
  readonly visualizationError = signal<string | null>(null);
  /** What the right panel shows: the latest thing the agent showed, or the user's pick. */
  readonly activePanelItem = signal<PanelItem | null>(null);
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
        next: (res) => {
          this.sessions.set(res.sessions);
          this.sessionsLoaded.set(true);
        },
        // Preserve already-loaded sessions if the backend is briefly offline.
        error: () => {
          this.sessionsLoaded.set(true);
          this.toast.error('Could not load sessions');
        },
      });
  }

  openSession(session: Session): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.selectedDataPoint.set(null);
    this.activeSession.set(session);
    this.mainView.set('session-chat');
    this.loadActiveSessionDatasources(session);
    this.loadLatestPanelItem(session);
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

  /** The item shown latest (largest `shownAt`), if the agent showed anything. */
  private latestPanelItem(session: Session): PanelItem | null {
    let latest: PanelItem | null = null;
    for (const item of session.panelItems ?? []) {
      if (!latest || item.shownAt >= latest.shownAt) latest = item;
    }
    return latest;
  }

  /** The visual panel item of `visualId`: the saved one, else a stand-in. */
  private visualPanelItem(
    session: Session,
    visualId: string,
    title?: string,
  ): PanelItem {
    const saved = session.panelItems?.find(
      (item) => item.kind === 'visual' && item.visualId === visualId,
    );
    if (saved) return saved;
    const meta = session.visualizations?.find((v) => v.id === visualId);
    return {
      id: `visual:${visualId}`,
      kind: 'visual',
      title: title ?? meta?.title ?? 'Visual',
      shownAt: meta?.createdAt ?? new Date().toISOString(),
      visualId,
    };
  }

  /**
   * Opening a session: the panel shows what the agent showed last. The latest
   * visual still loads behind a non-visual item, as the tailoring target.
   */
  private loadLatestPanelItem(session: Session): void {
    const latest = this.latestPanelItem(session);
    this.activePanelItem.set(latest);
    this.loadLatestVisualization(
      session,
      latest?.kind === 'visual' ? latest.visualId : undefined,
    );
  }

  private loadLatestVisualization(
    session: Session,
    preferredId?: string,
  ): void {
    this.activeVisualization.set(null);
    this.visualizationError.set(null);
    const latest = preferredId
      ? (session.visualizations?.find((v) => v.id === preferredId) ??
        session.visualizations?.at(-1))
      : session.visualizations?.at(-1);
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

  /** The `workflow` stream event: patch the open session's status bar live. */
  onWorkflowChanged(workflow: WorkflowView): void {
    this.activeSession.update((s) => (s ? { ...s, workflow } : s));
  }

  /** The agent called `show_in_panel`: show it live. */
  onPanelItem(event: PanelItemEvent): void {
    const { item } = event;
    if (!item) return;
    this.rightPanelOpen.set(true);
    if (item.kind === 'visual') {
      this.activePanelItem.set(item);
      this.refreshActiveSession((session) => {
        const meta = session.visualizations?.find(
          (v) => v.id === item.visualId,
        );
        if (meta) this.showVisualization(meta);
      });
      return;
    }
    this.activePanelItem.set(item);
    this.refreshActiveSession();
  }

  /** The user picked an entry of the panel's "Shown in this session" menu. */
  onSelectPanelItem(item: PanelItem): void {
    this.activePanelItem.set(item);
    if (item.kind !== 'visual') return;
    const session = this.activeSession();
    const meta = session?.visualizations?.find((v) => v.id === item.visualId);
    if (meta) this.showVisualization(meta);
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
    this.activePanelItem.set(
      this.visualPanelItem(
        session,
        id,
        'title' in visualization ? visualization.title : undefined,
      ),
    );
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
    this.activePanelItem.set({
      id: 'visual:pending',
      kind: 'visual',
      title: 'Visuals',
      shownAt: new Date().toISOString(),
      visualId: '',
    });
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
          this.activePanelItem.set(
            this.visualPanelItem(
              result.session,
              result.visualization.id,
              result.visualization.title,
            ),
          );
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

  deleteSession(session: Session): void {
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
          this.activePanelItem.set(null);
          this.activeVisualization.set(null);
          this.visualizationError.set(null);
          // The agent editor is never left without asking (agents-evals R59).
          if (!this.inEditor()) this.mainView.set('sessions');
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
    const agent = this.composerAgent();
    const picks = this.composerPicksDatasets();
    if (picks && (!name || this.selectedDatasets().size === 0)) return;
    this.creatingSession.set(true);
    // The assistant and the agents that pick datasets like it send the
    // picked datasets (with `agentId` for the latter); an agent with its own
    // datasets starts through the same path as Start chat, with the typed
    // name when there is one (sessions-chat R64).
    (picks
      ? this.sessionsApi.create(
          name,
          Array.from(this.selectedDatasets()),
          agent?.key,
        )
      : this.sessionsApi.createFromAgent(agent!.key, name || undefined)
    ).subscribe({
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

  /**
   * Open the New conversation screen. The Agent field starts on Assistant on
   * every visit (R64), except from Start chat on an agent that picks datasets
   * like the assistant, which passes its key to preselect it.
   */
  openComposer(preselectAgentKey?: string): void {
    if (!this.confirmLeaveAgentEditor()) return;
    this.mainView.set('conversation-new');
    this.selectedDatasets.set(new Set());
    this.composerAgentKey.set(preselectAgentKey ?? ASSISTANT_PICKER_KEY);
    this.composerAgents.set([]);
    this.agentsApi.getAgents().subscribe({
      next: (res) => {
        this.composerAgents.set(newSessionAgentOptions(res.agents));
        // Falls back to Assistant when the preselected agent is not offered.
        this.pickComposerAgent(this.composerAgentKey());
      },
      error: () => {
        this.composerAgents.set([]);
        this.composerAgentKey.set(ASSISTANT_PICKER_KEY);
      },
    });
    this.llmApi.getSettings().subscribe({
      next: (v) => {
        this.llmModel.set(composerModelLabel(v));
        this.llmModelTitle.set(
          v.configured && v.provider === 'custom' ? v.baseUrl : null,
        );
        this.llmEffort.set(v.reasoningEffort);
      },
      error: () => {
        this.llmModel.set(null);
        this.llmModelTitle.set(null);
      },
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
    this.uiPreferences.load();
  }

  /** The rail area that is shown, or null on home. */
  readonly currentArea = computed<Area | null>(() =>
    this.settingsOpen() ? 'settings' : (AREA_OF_VIEW[this.mainView()] ?? null),
  );

  readonly railItems: {
    area: Exclude<Area, 'settings'>;
    label: string;
    icon: LucideIconData;
  }[] = [
    { area: 'datasets', label: 'Datasets', icon: FlaskConical },
    { area: 'workflows', label: 'Workflows', icon: Workflow },
    { area: 'agents', label: 'Agents', icon: Bot },
    { area: 'context', label: 'Context', icon: Layers },
    { area: 'sessions', label: 'Sessions', icon: FolderKanban },
    { area: 'monitoring', label: 'Monitoring', icon: Activity },
  ];

  readonly settingsSections: {
    key: Exclude<SettingsSection, null>;
    label: string;
    icon: LucideIconData;
  }[] = [
    {
      key: 'datasources',
      label: 'Datasource Configuration',
      icon: Database,
    },
    {
      key: 'llm',
      label: 'LLM Configuration',
      icon: Bot,
    },
    {
      key: 'testing-data',
      label: 'Testing Data',
      icon: TestTube,
    },
    {
      key: 'developer',
      label: 'Developer',
      icon: Wrench,
    },
    { key: 'appearance', label: 'Appearance', icon: SunMoon },
  ];

  /**
   * The Context area's sections, one card each in this order (app-shell R3a).
   * A new section is one entry here plus its view in the template.
   */
  readonly contextSections: {
    view: MainView;
    label: string;
    description: string;
    icon: LucideIconData;
  }[] = [
    {
      view: 'ontologies',
      label: 'Ontologies',
      description:
        "Each dataset's concepts, relations, constraints and instructions the assistant applies.",
      icon: Network,
    },
    {
      view: 'personas',
      label: 'User personas',
      description:
        'Who asks the questions: their role, goals, typical questions and the answers they prefer.',
      icon: Users,
    },
    {
      view: 'visuals',
      label: 'Visuals',
      description:
        'Chart types for data visualization, grouped by category, with when to use each.',
      icon: ChartColumn,
    },
  ];

  /** Opens a Context section from its card (app-shell R3a). */
  openContextSection(view: MainView): void {
    this.mainView.set(view);
  }

  /** The LLM call shown on the `llm-call` view (roadmap 1.21.15). */
  readonly activeLlmCallId = signal<string | null>(null);

  /**
   * The session page a call was opened from; null when it was opened from
   * the LLM calls table (its back control then reads Monitoring).
   */
  readonly llmCallFromSession = signal<string | null>(null);

  /** The session shown on the `monitoring-session` view (roadmap 1.21.16). */
  readonly activeMonitoringSessionId = signal<string | null>(null);

  /** Opens a call from the Monitoring table. */
  openLlmCall(id: string): void {
    this.llmCallFromSession.set(null);
    this.activeLlmCallId.set(id);
    this.mainView.set('llm-call');
  }

  /** Opens a call from the session page; its back control returns there. */
  openLlmCallFromSession(id: string): void {
    this.llmCallFromSession.set(this.activeMonitoringSessionId());
    this.activeLlmCallId.set(id);
    this.mainView.set('llm-call');
  }

  /** The call page's back control: to its session page, else the table. */
  backFromLlmCall(): void {
    const sessionId = this.llmCallFromSession();
    if (sessionId !== null) {
      this.activeMonitoringSessionId.set(sessionId);
      this.mainView.set('monitoring-session');
      return;
    }
    this.selectArea('monitoring');
  }

  /** Opens a session's execution flow from the Sessions tab. */
  openMonitoringSession(id: string): void {
    this.activeMonitoringSessionId.set(id);
    this.mainView.set('monitoring-session');
  }

  /**
   * The session page's back control: the Monitoring page, on the Sessions
   * tab it was opened from (the tab is kept in MonitoringStateService).
   */
  backFromMonitoringSession(): void {
    this.selectArea('monitoring');
  }

  /** The call page's Session link: opens that session's chat. */
  openSessionById(id: string): void {
    const known = this.sessions().find((session) => session.id === id);
    if (known) {
      this.openSession(known);
      return;
    }
    this.sessionsApi.get(id).subscribe({
      next: (session) => this.openSession(session),
      error: () => this.toast.error('Could not open the session'),
    });
  }

  /** Every Settings section is always offered, in their fixed order. */
  readonly visibleSettingsSections = computed(() => this.settingsSections);

  /** The chosen section, or none when it is hidden (ui.md 1.6). */
  readonly shownSettingsSection = computed<SettingsSection>(() => {
    const section = this.settingsSection();
    return this.visibleSettingsSections().some((item) => item.key === section)
      ? section
      : null;
  });

  private readonly uiPreferences = inject(UiPreferencesService);

  /**
   * The rail's drawer with the item labels (app-shell R48).
   * Expanded unless the user last collapsed it (R2, R50).
   */
  readonly navExpanded = this.uiPreferences.navExpanded;

  /** The Expand / Collapse navigation button; remembered (R50). */
  toggleNav(): void {
    this.uiPreferences.setNavExpanded(!this.navExpanded());
  }

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
    const leavingEditor = !this.settingsOpen() && this.inEditor();
    // Sessions is shown only on its list: from a chat or the composer the
    // rail returns to the list (app-shell R3). Workflows likewise returns
    // from a workflow's page to the list (R3), Context from a section to its
    // cards (R3a), and Monitoring from a call to its table (roadmap 1.21.15).
    const alreadyShown =
      this.currentArea() === area &&
      !leavingEditor &&
      (area !== 'sessions' || this.mainView() === 'sessions') &&
      (area !== 'workflows' || this.mainView() === 'workflows') &&
      (area !== 'context' || this.mainView() === 'context') &&
      (area !== 'monitoring' || this.mainView() === 'monitoring');
    if (!alreadyShown && !this.confirmLeaveAgentEditor()) return;
    if (area === 'settings') {
      // Settings covers the main view; the editor closes rather than wait
      // behind it, so its preview never shows beside a settings form.
      if (this.inEditor()) this.mainView.set('agents');
      this.settingsOpen.set(true);
      return;
    }
    this.settingsOpen.set(false);
    if (!alreadyShown) this.mainView.set(AREA_ROOT[area]);
  }

  selectSection(section: Exclude<SettingsSection, null>): void {
    this.settingsSection.set(
      this.settingsSection() === section ? null : section,
    );
  }
}
