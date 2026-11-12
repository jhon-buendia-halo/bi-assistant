import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  HostListener,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  LucideIconData,
  Activity,
  Bot,
  FlaskConical,
  FolderKanban,
  Layers,
  Menu,
  PanelRight,
  ScrollText,
  Settings,
  Workflow,
} from 'lucide-angular';
import { ShellState, Area } from './core/shell/shell-state';
import { UiPreferencesService } from './core/preferences/ui-preferences.service';
import { ThemeService } from './core/theme/theme.service';
import { DiagnosticsService } from './core/diagnostics/diagnostics.service';
import { AgentEditorService } from './features/agents/services/agent-editor.service';
import { AgentsNavState } from './features/agents/services/agents-nav-state';
import { EvalSelectionService } from './features/agents/services/eval-selection.service';
import { AgentsArea } from './features/agents/components/agents-area/agents-area';
import { AgentTryIt } from './features/agents/components/agent-try-it/agent-try-it';
import { EvalTrace } from './features/agents/components/eval-trace/eval-trace';
import { ContextArea } from './features/context/components/context-area/context-area';
import { DatasetSelectionService } from './features/datasets/services/dataset-selection.service';
import { DatasetsArea } from './features/datasets/components/datasets-area/datasets-area';
import { EntityDetails } from './features/datasets/components/entity-details/entity-details';
import { Welcome } from './features/home/components/welcome/welcome';
import { MonitoringArea } from './features/monitoring/components/monitoring-area/monitoring-area';
import { SessionsArea } from './features/sessions/components/sessions-area/sessions-area';
import { SessionsHeader } from './features/sessions/components/sessions-header/sessions-header';
import { SessionsPanel } from './features/sessions/components/sessions-panel/sessions-panel';
import { ComposerState } from './features/sessions/services/composer-state';
import { SessionsState } from './features/sessions/services/sessions-state';
import { SettingsContent } from './features/settings/components/settings-content/settings-content';
import { SettingsNav } from './features/settings/components/settings-nav/settings-nav';
import { WorkflowPanel } from './features/workflows/components/workflow-panel/workflow-panel';
import { WorkflowsArea } from './features/workflows/components/workflows-area/workflows-area';
import { BackendStatusBanner } from './shared/components/backend-status-banner/backend-status-banner';
import { SystemLogsPanel } from './shared/components/system-logs-panel/system-logs-panel';
import { ToastContainer } from './shared/components/toast-container/toast-container';

const DEFAULT_RIGHT_PANEL_WIDTH = 572;
const MIN_RIGHT_PANEL_WIDTH = 360;
const MAX_RIGHT_PANEL_WIDTH = 960;
const MIN_PRIMARY_CONTENT_WIDTH = 240;
const RIGHT_PANEL_RESIZE_STEP = 24;
const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'questions-to-insights:right-panel-width';

/**
 * The shell: the navigation rail, the banner, the right-panel host and the
 * switch between the area containers (each area's state, handlers and template
 * live under features/<area>/, see specs/system/tech-stack.md).
 */
@Component({
  selector: 'app-shell',
  imports: [
    NgTemplateOutlet,
    LucideAngularModule,
    BackendStatusBanner,
    ToastContainer,
    SystemLogsPanel,
    Welcome,
    SettingsNav,
    SettingsContent,
    DatasetsArea,
    WorkflowsArea,
    AgentsArea,
    ContextArea,
    SessionsArea,
    SessionsHeader,
    MonitoringArea,
    SessionsPanel,
    AgentTryIt,
    EvalTrace,
    WorkflowPanel,
    EntityDetails,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly shell = inject(ShellState);
  readonly sessions = inject(SessionsState);
  readonly composer = inject(ComposerState);
  readonly agents = inject(AgentsNavState);
  readonly agentEditor = inject(AgentEditorService);
  readonly diagnostics = inject(DiagnosticsService);
  private readonly datasetSelection = inject(DatasetSelectionService);
  private readonly evalSelection = inject(EvalSelectionService);
  private readonly uiPreferences = inject(UiPreferencesService);
  // Created with the shell so the resolved theme is applied from start-up.
  private readonly theme = inject(ThemeService);

  readonly Menu = Menu;
  readonly PanelRight = PanelRight;
  readonly ScrollText = ScrollText;
  readonly Settings = Settings;

  readonly rightPanelResizing = signal(false);
  readonly rightPanelWidth = signal(this.readRightPanelWidth());
  readonly rightPanelMinWidth = MIN_RIGHT_PANEL_WIDTH;
  readonly systemLogsOpen = signal(false);

  readonly railItems: {
    area: Exclude<Area, 'settings'>;
    label: string;
    icon: LucideIconData;
  }[] = [
    { area: 'datasets', label: 'Datasets', icon: FlaskConical },
    { area: 'workflows', label: 'Workflows', icon: Workflow },
    { area: 'agents', label: 'Agents', icon: Bot },
    { area: 'context', label: 'Context', icon: Layers },
    { area: 'runs', label: 'Runs', icon: FolderKanban },
    { area: 'monitoring', label: 'Monitoring', icon: Activity },
  ];

  /**
   * The rail's drawer with the item labels (app-shell R48).
   * Expanded unless the user last collapsed it (R2, R50).
   */
  readonly navExpanded = this.uiPreferences.navExpanded;

  constructor() {
    // Selecting a datasource element reveals its details in the right panel.
    effect(() => {
      if (this.datasetSelection.selection()) this.shell.rightPanelOpen.set(true);
    });
    // Selecting an eval question reveals how it ran (R10).
    effect(() => {
      if (this.evalSelection.selection()) this.shell.rightPanelOpen.set(true);
    });
    this.sessions.loadSessions();
    this.uiPreferences.load();
  }

  /** The Expand / Collapse navigation button; remembered (R50). */
  toggleNav(): void {
    this.uiPreferences.setNavExpanded(!this.navExpanded());
  }

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
}
