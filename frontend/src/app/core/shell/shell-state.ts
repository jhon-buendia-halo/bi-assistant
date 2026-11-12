import { Injectable, computed, inject, signal } from '@angular/core';
import { AgentEditorService } from '../../features/agents/services/agent-editor.service';
import { AgentPageState } from '../../features/agents/services/agent-page-state.service';
import { BuiltInSkillEditorService } from '../../features/agents/services/builtin-skill-editor.service';
import { SkillEditorService } from '../../features/agents/services/skill-editor.service';

export type MainView =
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
export type Area =
  | 'datasets'
  | 'workflows'
  | 'agents'
  | 'context'
  | 'sessions'
  | 'monitoring'
  | 'settings';

/** The view each workspace area opens on. */
export const AREA_ROOT: Record<Exclude<Area, 'settings'>, MainView> = {
  datasets: 'dataset',
  workflows: 'workflows',
  agents: 'agents',
  context: 'context',
  sessions: 'sessions',
  monitoring: 'monitoring',
};

export const AREA_OF_VIEW: Partial<Record<MainView, Area>> = {
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

/**
 * What every area shares: the shown view, whether Settings covers it, the
 * right panel, and the rule that leaving an agent or skill editor asks about
 * unsaved changes first. The area containers read and set it.
 */
@Injectable({ providedIn: 'root' })
export class ShellState {
  readonly mainView = signal<MainView>('home');
  readonly settingsOpen = signal(false);
  /** Closed on launch; opens on demand (app-shell R2, R10). */
  readonly rightPanelOpen = signal(false);

  private readonly agentEditor = inject(AgentEditorService);
  private readonly skillEditor = inject(SkillEditorService);
  private readonly builtInSkillEditor = inject(BuiltInSkillEditorService);
  private readonly agentPageState = inject(AgentPageState);

  /** The rail area that is shown, or null on home. */
  readonly currentArea = computed<Area | null>(() =>
    this.settingsOpen() ? 'settings' : (AREA_OF_VIEW[this.mainView()] ?? null),
  );

  /**
   * Every way out of the agent editor (Back, the rail, the drawer, Settings)
   * asks first when the form has unsaved changes; cancelling stays put
   * (R59). Leaving destroys the editor, which discards its preview (R61).
   */
  confirmLeaveAgentEditor(): boolean {
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

  /** An editor is open: its unsaved changes are asked about before leaving. */
  inEditor(): boolean {
    return (
      this.mainView() === 'agent-editor' ||
      this.mainView() === 'skill-editor' ||
      this.mainView() === 'builtin-skill-editor'
    );
  }

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
}
