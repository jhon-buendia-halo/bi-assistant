import { Injectable, computed, inject, signal } from '@angular/core';
import { ShellState } from '../../../core/shell/shell-state';
import { ToastService } from '../../../core/toast/toast.service';
import {
  Dataset,
  DatasetsApiService,
} from '../../datasets/services/datasets-api.service';
import {
  LlmSettingsView,
  ReasoningEffort,
} from '../../llm/models/llm.model';
import { LlmApiService } from '../../llm/services/llm-api.service';
import { WorkflowSummary } from '../../workflows/models/workflow.model';
import { WorkflowsApiService } from '../../workflows/services/workflows-api.service';
import {
  ASSISTANT_WORKFLOW_DESCRIPTION,
  ASSISTANT_WORKFLOW_ID,
  ASSISTANT_WORKFLOW_NAME,
  chatWorkflows,
  composerCreateBody,
  composerWorkflowId,
} from '../../workflows/services/workflows.util';
import { SessionsApiService } from './sessions-api.service';
import { SessionsState } from './sessions-state';

/** A row of the New conversation screen's Workflow picker. */
export interface ComposerWorkflowRow {
  id: string;
  name: string;
  description: string;
  /** Why the workflow cannot start a chat now (its `chatRequirement`), or null. */
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

/** The New conversation screen's state and handlers (sessions-chat R64). */
@Injectable({ providedIn: 'root' })
export class ComposerState {
  private readonly shell = inject(ShellState);
  private readonly toast = inject(ToastService);
  private readonly sessions = inject(SessionsState);
  private readonly sessionsApi = inject(SessionsApiService);
  private readonly workflowsApi = inject(WorkflowsApiService);
  private readonly llmApi = inject(LlmApiService);
  private readonly datasetApi = inject(DatasetsApiService);

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
  /** Workflows the New conversation screen offers, in catalogue order (R64). */
  readonly composerWorkflows = signal<WorkflowSummary[]>([]);
  /** The picked workflow's id; Assistant on every visit, never remembered. */
  readonly composerWorkflowId = signal<string>(ASSISTANT_WORKFLOW_ID);
  readonly composerWorkflow = computed<WorkflowSummary | null>(
    () =>
      this.composerWorkflows().find(
        (w) => w.id === this.composerWorkflowId(),
      ) ?? null,
  );
  readonly composerWorkflowDescription = computed(
    () => this.composerWorkflow()?.description ?? ASSISTANT_WORKFLOW_DESCRIPTION,
  );
  readonly composerWorkflowDatasets = computed(
    () => this.composerWorkflow()?.datasets ?? [],
  );
  /**
   * Whether the screen shows the dataset picker and requires a name: a
   * workflow that takes the datasets the user picks (Assistant, Questions to
   * Insights v2), not one that brings its own (R64).
   */
  readonly composerPicksDatasets = computed(
    () => this.composerWorkflow()?.picksDatasets ?? true,
  );

  pickComposerWorkflow(id: string): void {
    this.composerWorkflowId.set(composerWorkflowId(this.composerWorkflows(), id));
  }

  /**
   * Rows of the Workflow picker: the catalogue in its own order, or
   * Assistant alone until it loads (or when it cannot).
   */
  readonly composerWorkflowRows = computed<ComposerWorkflowRow[]>(() => {
    const workflows = this.composerWorkflows();
    if (workflows.length === 0) {
      return [
        {
          id: ASSISTANT_WORKFLOW_ID,
          name: ASSISTANT_WORKFLOW_NAME,
          description: ASSISTANT_WORKFLOW_DESCRIPTION,
          disabledReason: null,
        },
      ];
    }
    return workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      disabledReason: w.chatRequirement ?? null,
    }));
  });
  readonly composerWorkflowName = computed(
    () =>
      this.composerWorkflowRows().find(
        (r) => r.id === this.composerWorkflowId(),
      )?.name ?? ASSISTANT_WORKFLOW_NAME,
  );
  readonly composerWorkflowMenuOpen = signal(false);
  /** Index in `composerWorkflowRows` of the highlighted option while open. */
  readonly composerWorkflowActive = signal(0);

  openComposerWorkflowMenu(): void {
    const index = this.composerWorkflowRows().findIndex(
      (r) => r.id === this.composerWorkflowId(),
    );
    this.composerWorkflowActive.set(Math.max(0, index));
    this.composerWorkflowMenuOpen.set(true);
  }

  closeComposerWorkflowMenu(): void {
    this.composerWorkflowMenuOpen.set(false);
    document.getElementById('new-session-workflow')?.focus();
  }

  chooseComposerWorkflow(id: string): void {
    const row = this.composerWorkflowRows().find((r) => r.id === id);
    if (!row || row.disabledReason) return;
    this.pickComposerWorkflow(id);
    this.closeComposerWorkflowMenu();
  }

  onComposerWorkflowKeydown(event: KeyboardEvent): void {
    const rows = this.composerWorkflowRows();
    if (!this.composerWorkflowMenuOpen()) {
      if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        this.openComposerWorkflowMenu();
      }
      return;
    }
    const step = (dir: 1 | -1) => {
      let i = this.composerWorkflowActive();
      for (let n = 0; n < rows.length; n++) {
        i = (i + dir + rows.length) % rows.length;
        if (!rows[i].disabledReason) return i;
      }
      return this.composerWorkflowActive();
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.composerWorkflowActive.set(step(1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.composerWorkflowActive.set(step(-1));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.chooseComposerWorkflow(
          rows[this.composerWorkflowActive()]?.id ?? '',
        );
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.closeComposerWorkflowMenu();
        break;
      case 'Tab':
        this.composerWorkflowMenuOpen.set(false);
        break;
    }
  }
  readonly selectedDatasets = signal<Set<string>>(new Set());
  readonly composerName = signal('');
  readonly creatingSession = signal(false);

  createSession(): void {
    if (this.creatingSession()) return;
    const name = this.composerName().trim();
    const picks = this.composerPicksDatasets();
    if (picks && (!name || this.selectedDatasets().size === 0)) return;
    this.creatingSession.set(true);
    // A workflow that picks datasets sends the name and the picked datasets;
    // one that brings its own sends the typed name when there is one and
    // starts exactly as Start chat on it does (sessions-chat R64).
    const body = composerCreateBody(
      this.composerWorkflow(),
      name,
      Array.from(this.selectedDatasets()),
    );
    this.sessionsApi
      .createFromWorkflow(body.workflowId, body.name, body.datasets)
      .subscribe({
        next: (res) => {
          this.creatingSession.set(false);
          if (res.ok && res.session) {
            this.toast.success(res.message);
            this.composerName.set('');
            this.sessions.loadSessions();
            this.sessions.openSession(res.session);
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
   * Open the New conversation screen. The Workflow field starts on
   * Assistant on every visit (R64), except from Start chat on a workflow
   * that picks datasets, which passes its id to preselect it.
   */
  openComposer(preselectWorkflowId?: string): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.shell.mainView.set('conversation-new');
    this.selectedDatasets.set(new Set());
    this.composerWorkflowMenuOpen.set(false);
    this.composerWorkflowId.set(preselectWorkflowId ?? ASSISTANT_WORKFLOW_ID);
    this.composerWorkflows.set([]);
    this.workflowsApi.getWorkflows().subscribe({
      next: (res) => {
        // A run workflow runs on its own page, never in a chat (R64).
        this.composerWorkflows.set(chatWorkflows(res.workflows));
        // Falls back to Assistant when the preselected workflow is not
        // offered or cannot start a chat now.
        this.pickComposerWorkflow(preselectWorkflowId ?? ASSISTANT_WORKFLOW_ID);
      },
      error: () => {
        this.composerWorkflows.set([]);
        this.composerWorkflowId.set(ASSISTANT_WORKFLOW_ID);
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
}
