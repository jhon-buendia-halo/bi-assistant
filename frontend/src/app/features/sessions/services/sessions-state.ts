import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, retry, timer } from 'rxjs';
import { ShellState } from '../../../core/shell/shell-state';
import { ToastService } from '../../../core/toast/toast.service';
import { Datasource } from '../../datasources/models/datasource.model';
import { DatasourcesApiService } from '../../datasources/services/datasources-api.service';
import { DatasetsApiService } from '../../datasets/services/datasets-api.service';
import {
  ChatMessage,
  DataPointSelection,
  InteractiveVisualization,
  PanelItem,
  PanelItemEvent,
  Session,
  SessionActionResult,
  SessionVisualization,
  VisualEvent,
  WorkflowView,
} from '../models/session.model';
import { SessionsApiService } from './sessions-api.service';

/**
 * The Sessions area's state and handlers: the session list, the open chat and
 * what the right panel shows for it (the agent's panel items and visuals).
 */
@Injectable({ providedIn: 'root' })
export class SessionsState {
  private readonly shell = inject(ShellState);
  private readonly toast = inject(ToastService);
  private readonly datasetApi = inject(DatasetsApiService);
  private readonly datasourcesApi = inject(DatasourcesApiService);
  private readonly sessionsApi = inject(SessionsApiService);

  readonly activeSessionDatasources = signal<Datasource[]>([]);
  readonly loadingSessionDatasources = signal(false);
  readonly sessions = signal<Session[]>([]);
  /** False until the first list answer, for the Sessions page's loading line. */
  readonly sessionsLoaded = signal(false);
  readonly activeSession = signal<Session | null>(null);
  /** The open chat is a past chat: readable, not continuable (sessions-chat R66). */
  readonly readOnlyChat = signal(false);
  readonly deletingSession = signal<string | null>(null);
  readonly generatingVisualSession = signal<string | null>(null);
  readonly downloadingVisualization = signal<string | null>(null);
  readonly activeVisualization = signal<InteractiveVisualization | null>(null);
  readonly visualizationError = signal<string | null>(null);
  /** What the right panel shows: the latest thing the agent showed, or the user's pick. */
  readonly activePanelItem = signal<PanelItem | null>(null);
  /** Latest data mark clicked inside a visual; drives the chat follow-up chips. */
  readonly selectedDataPoint = signal<DataPointSelection | null>(null);

  /** Title of the Runs area's page header (app-shell R49). */
  readonly pageTitle = computed(() => {
    const view = this.shell.mainView();
    return view === 'session-chat'
      ? (this.activeSession()?.name ?? 'Runs')
      : 'Runs';
  });

  /** The page header shows the session's datasources while a chat is open. */
  readonly showSessionContext = computed(
    () =>
      !this.shell.settingsOpen() &&
      this.shell.mainView() === 'session-chat' &&
      this.activeSession() !== null,
  );

  /** Copy the open session's id, which a user shares to diagnose it. */
  copySessionId(id: string): void {
    void navigator.clipboard.writeText(id).then(
      () => this.toast.success('Session ID copied'),
      () => this.toast.error('Copy failed'),
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

  /** A row of the Past chats tab: opens the chat read-only (sessions-chat R66). */
  openPastChat(session: Session): void {
    this.openSession(session, true);
  }

  openSession(session: Session, readOnly = false): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.readOnlyChat.set(readOnly);
    this.selectedDataPoint.set(null);
    this.activeSession.set(session);
    this.shell.mainView.set('session-chat');
    this.loadActiveSessionDatasources(session);
    this.loadLatestPanelItem(session);
  }

  /** The call page's Session link: opens that session's chat. */
  openSessionById(id: string): void {
    const known = this.sessions().find((session) => session.id === id);
    if (known) {
      this.openPastChat(known);
      return;
    }
    this.sessionsApi.get(id).subscribe({
      next: (session) => this.openPastChat(session),
      error: () => this.toast.error('Could not open the session'),
    });
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
    this.shell.rightPanelOpen.set(true);
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
    this.shell.rightPanelOpen.set(true);
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
    this.shell.rightPanelOpen.set(true);
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
          if (!this.shell.inEditor()) this.shell.mainView.set('runs');
        }
        this.toast.success(res.message);
      },
      error: (err) => {
        this.deletingSession.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }
}
