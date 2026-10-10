import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../core/toast/toast.service';
import { DatasetsApiService } from '../../datasets/services/datasets-api.service';
import { LlmApiService } from '../../llm/services/llm-api.service';
import { Session } from '../../sessions/models/session.model';
import { SessionsApiService } from '../../sessions/services/sessions-api.service';
import {
  AgentMutationResult,
  AgentStatus,
  AgentsApiService,
} from './agents-api.service';
import {
  AgentForm,
  agentFormChanged,
  agentFormFromConfig,
  agentSaveInput,
  canSaveAgent,
  datasetOptions,
  emptyAgentForm,
  hasExistingDataset,
  showAgentPublish,
} from './agent-editor.util';

/** The preview chat in the Details panel (agents-evals R60, R61). */
export type PreviewState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'no-dataset'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; session: Session };

const NO_DATASET_MESSAGE = 'Select at least one dataset to preview';

/**
 * State of the agent editor (agents-evals R54-R61), shared by the editor in
 * the main column, its preview chat in the Details panel and the app shell,
 * which asks before leaving with unsaved changes. One editor is open at a
 * time; `open` starts it afresh and `close` discards the preview.
 */
@Injectable({ providedIn: 'root' })
export class AgentEditorService {
  private readonly agentsApi = inject(AgentsApiService);
  private readonly datasetsApi = inject(DatasetsApiService);
  private readonly llmApi = inject(LlmApiService);
  private readonly sessionsApi = inject(SessionsApiService);
  private readonly toast = inject(ToastService);

  /** The agent's id once it exists; null for a new agent never saved. */
  readonly agentId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly form = signal<AgentForm>(emptyAgentForm());
  /** The form as last saved (or loaded); empty for a new agent. */
  readonly saved = signal<AgentForm>(emptyAgentForm());
  readonly status = signal<AgentStatus | null>(null);
  readonly hasUnpublishedChanges = signal(false);
  /** Names of the datasets that exist. */
  readonly existingDatasets = signal<string[]>([]);
  /** The configured LLM's model, for the Model placeholder. */
  readonly configuredModel = signal<string | null>(null);
  readonly saving = signal(false);
  readonly publishing = signal(false);
  readonly preview = signal<PreviewState>({ kind: 'idle' });

  readonly changed = computed(() =>
    agentFormChanged(this.form(), this.saved()),
  );
  readonly canSave = computed(() =>
    canSaveAgent({
      form: this.form(),
      changed: this.changed(),
      saving: this.saving(),
    }),
  );
  readonly showPublish = computed(() =>
    showAgentPublish({
      saved: this.agentId() !== null,
      status: this.status(),
      hasUnpublishedChanges: this.hasUnpublishedChanges(),
      changed: this.changed(),
    }),
  );
  readonly title = computed(() =>
    this.agentId() === null ? 'New agent' : `Edit ${this.saved().name}`,
  );
  readonly datasetOptions = computed(() =>
    datasetOptions(
      this.existingDatasets(),
      this.saved().datasets,
      this.form().datasets,
    ),
  );

  /** Resolves once the agent, datasets and model have loaded. */
  private ready: Promise<void> = Promise.resolve();
  /** Bumped on every open, close and discard, to drop stale answers. */
  private generation = 0;
  private previewGeneration = 0;

  /** Open the editor on an agent's draft, or empty for a new agent (R54). */
  open(agentId: string | null): void {
    this.close();
    const generation = this.generation;
    this.agentId.set(agentId);
    this.form.set(emptyAgentForm());
    this.saved.set(emptyAgentForm());
    this.status.set(null);
    this.hasUnpublishedChanges.set(false);
    this.loadError.set(null);
    this.existingDatasets.set([]);
    this.configuredModel.set(null);
    this.loading.set(agentId !== null);

    this.llmApi.getSettings().subscribe({
      next: (settings) => {
        if (generation !== this.generation) return;
        this.configuredModel.set(settings.configured ? settings.model : null);
      },
      error: () => undefined,
    });
    const datasets = firstValueFrom(this.datasetsApi.getDatasets()).then(
      (res) => {
        if (generation !== this.generation) return;
        this.existingDatasets.set(res.datasets.map((dataset) => dataset.name));
      },
      () => undefined,
    );
    const agent =
      agentId === null
        ? Promise.resolve()
        : firstValueFrom(this.agentsApi.getAgent(agentId)).then(
            (detail) => {
              if (generation !== this.generation) return;
              const draft = detail.draft ?? detail.live;
              if (detail.kind !== 'user' || !draft) {
                this.loadError.set(`Agent "${agentId}" cannot be edited`);
                return;
              }
              const form = agentFormFromConfig(draft);
              this.form.set(form);
              this.saved.set(form);
              this.status.set(detail.status ?? 'draft');
              this.hasUnpublishedChanges.set(!!detail.hasUnpublishedChanges);
            },
            (err) => {
              if (generation !== this.generation) return;
              this.loadError.set(err?.error?.message ?? 'Backend unreachable');
            },
          );
    this.ready = Promise.all([datasets, agent]).then(() => {
      if (generation === this.generation) this.loading.set(false);
    });
  }

  /** Leave the editor: the preview is discarded (R61). */
  close(): void {
    this.generation++;
    this.discardPreview();
  }

  update(patch: Partial<AgentForm>): void {
    this.form.update((form) => ({ ...form, ...patch }));
  }

  toggleDataset(name: string, checked: boolean): void {
    this.form.update((form) => ({
      ...form,
      datasets: checked
        ? [...form.datasets.filter((item) => item !== name), name]
        : form.datasets.filter((item) => item !== name),
    }));
  }

  setStarter(index: number, value: string): void {
    this.form.update((form) => ({
      ...form,
      starterQuestions: form.starterQuestions.map((question, i) =>
        i === index ? value : question,
      ),
    }));
  }

  addStarter(): void {
    this.form.update((form) => ({
      ...form,
      starterQuestions: [...form.starterQuestions, ''],
    }));
  }

  removeStarter(index: number): void {
    this.form.update((form) => ({
      ...form,
      starterQuestions: form.starterQuestions.filter((_, i) => i !== index),
    }));
  }

  /**
   * Store the form as the draft, creating the agent on its first save, and
   * toast the backend's message (R56). Resolves whether it saved.
   */
  async save(options: { refreshPreview?: boolean } = {}): Promise<boolean> {
    if (this.saving()) return false;
    const form = this.form();
    if (!form.name.trim()) {
      this.toast.error('Agent name is required');
      return false;
    }
    const generation = this.generation;
    const id = this.agentId();
    const input = agentSaveInput(form);
    this.saving.set(true);
    let res: AgentMutationResult;
    try {
      res = await firstValueFrom(
        id === null
          ? this.agentsApi.createAgent(input)
          : this.agentsApi.saveDraft(id, input),
      );
    } catch (err) {
      const error = err as { error?: { message?: string } };
      this.toast.error(error?.error?.message ?? 'Backend unreachable');
      return false;
    } finally {
      this.saving.set(false);
    }
    if (!res.ok || !res.agent) {
      this.toast.error(res.message);
      return false;
    }
    this.toast.success(res.message);
    if (generation !== this.generation) return true;
    this.agentId.set(res.agent.key ?? res.agent.id);
    // The snapshot that was sent, not what was typed while it was in flight.
    this.saved.set(form);
    this.status.set(res.agent.status ?? 'draft');
    this.hasUnpublishedChanges.set(!!res.agent.hasUnpublishedChanges);
    if (options.refreshPreview !== false) this.refreshPreview();
    return true;
  }

  /** Save the form when it has changes, then publish the draft (R57). */
  async publish(): Promise<void> {
    if (this.publishing()) return;
    const generation = this.generation;
    this.publishing.set(true);
    try {
      if (this.agentId() === null || this.changed()) {
        if (!(await this.save())) return;
      }
      const id = this.agentId();
      if (id === null || generation !== this.generation) return;
      const res = await firstValueFrom(this.agentsApi.publish(id));
      if (!res.ok) {
        this.toast.error(res.message);
        return;
      }
      this.toast.success(res.message);
      if (generation !== this.generation) return;
      this.status.set(res.agent?.status ?? 'live');
      this.hasUnpublishedChanges.set(!!res.agent?.hasUnpublishedChanges);
    } catch (err) {
      const error = err as { error?: { message?: string } };
      this.toast.error(error?.error?.message ?? 'Backend unreachable');
    } finally {
      this.publishing.set(false);
    }
  }

  /**
   * Start the preview chat of the saved draft (R60). A form with changes is
   * saved first; a new agent only once it has a dataset to preview with.
   * Does nothing while a preview is starting or open.
   */
  async startPreview(): Promise<void> {
    const state = this.preview().kind;
    if (state === 'starting' || state === 'ready') return;
    const generation = ++this.previewGeneration;
    const current = () => generation === this.previewGeneration;
    this.preview.set({ kind: 'starting' });

    await this.ready;
    if (!current()) return;
    const isNew = this.agentId() === null;
    const form = this.form();
    const saveFirst = isNew
      ? form.name.trim() !== '' &&
        hasExistingDataset(form.datasets, this.existingDatasets())
      : this.changed() && form.name.trim() !== '';
    if (saveFirst && !(await this.save({ refreshPreview: false }))) {
      if (current()) this.preview.set({ kind: 'idle' });
      return;
    }
    if (!current()) return;

    const id = this.agentId();
    if (
      id === null ||
      !hasExistingDataset(this.saved().datasets, this.existingDatasets())
    ) {
      this.preview.set({ kind: 'no-dataset', message: NO_DATASET_MESSAGE });
      return;
    }
    try {
      const res = await firstValueFrom(this.sessionsApi.createPreview(id));
      if (!current()) {
        // Discarded while it was being created.
        if (res.ok && res.session) this.deleteSession(res.session.id);
        return;
      }
      if (res.ok && res.session) {
        this.preview.set({ kind: 'ready', session: res.session });
      } else if (res.message === NO_DATASET_MESSAGE) {
        this.preview.set({ kind: 'no-dataset', message: res.message });
      } else {
        this.preview.set({ kind: 'error', message: res.message });
      }
    } catch (err) {
      if (!current()) return;
      const error = err as { error?: { message?: string } };
      this.preview.set({
        kind: 'error',
        message: error?.error?.message ?? 'Backend unreachable',
      });
    }
  }

  /** Reset preview: discard the conversation and start an empty one (R61). */
  resetPreview(): void {
    this.discardPreview();
    void this.startPreview();
  }

  /** Discard the preview conversation, if any, with its memory and files. */
  discardPreview(): void {
    this.previewGeneration++;
    const state = this.preview();
    if (state.kind === 'ready') this.deleteSession(state.session.id);
    if (state.kind !== 'idle') this.preview.set({ kind: 'idle' });
  }

  /**
   * Gate for a preview message: save the form first when it has changes, so
   * the preview runs what Save stored (R60). A refusal stops the send.
   */
  readonly beforePreviewSend = async (): Promise<boolean> => {
    if (!this.changed()) return true;
    return this.save({ refreshPreview: false });
  };

  /** The preview chat persisted a turn; keep the copy current. */
  previewUpdated(session: Session): void {
    const state = this.preview();
    if (state.kind === 'ready' && state.session.id === session.id) {
      this.preview.set({ kind: 'ready', session });
    }
  }

  /**
   * After a save, a preview waiting for a dataset tries again, and an open
   * one that nobody has asked anything yet re-reads the draft's description
   * and starter questions for its welcome card.
   */
  private refreshPreview(): void {
    const state = this.preview();
    if (state.kind === 'no-dataset' || state.kind === 'error') {
      this.preview.set({ kind: 'idle' });
      void this.startPreview();
      return;
    }
    if (state.kind !== 'ready' || state.session.messages.length > 0) return;
    const id = state.session.id;
    this.sessionsApi.get(id).subscribe({
      next: (session) => {
        const now = this.preview();
        if (
          now.kind === 'ready' &&
          now.session.id === id &&
          now.session.messages.length === 0 &&
          session.messages.length === 0
        ) {
          this.preview.set({ kind: 'ready', session });
        }
      },
      error: () => undefined,
    });
  }

  private deleteSession(id: string): void {
    // Fire and forget: the backend also discards leftovers at its next start.
    this.sessionsApi.delete(id).subscribe({ error: () => undefined });
  }
}
