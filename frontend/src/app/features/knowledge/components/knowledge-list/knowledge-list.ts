import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideAngularModule,
  BookOpen,
  Filter,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Check,
  Sparkles,
  Tag,
  Trash2,
  Wand2,
  X,
} from 'lucide-angular';
import {
  KnowledgeApiService,
  KnowledgeBootstrapProgress,
} from '../../services/knowledge-api.service';
import {
  KNOWLEDGE_KINDS,
  KnowledgeSnippet,
  KnowledgeSnippetKind,
  kindAccentClass,
  kindDescription,
  kindLabel,
} from '../../models/knowledge.model';
import {
  Dataset,
  DatasetsApiService,
} from '../../../datasets/services/datasets-api.service';
import { ToastService } from '../../../../core/toast/toast.service';
import { KnowledgeForm } from '../knowledge-form/knowledge-form';

type KindFilter = 'all' | KnowledgeSnippetKind;

@Component({
  selector: 'app-knowledge-list',
  imports: [LucideAngularModule, KnowledgeForm],
  templateUrl: './knowledge-list.html',
  styleUrl: './knowledge-list.scss',
})
export class KnowledgeList implements OnInit {
  readonly BookOpen = BookOpen;
  readonly Check = Check;
  readonly Filter = Filter;
  readonly Loader2 = Loader2;
  readonly Pencil = Pencil;
  readonly Plus = Plus;
  readonly Sparkles = Sparkles;
  readonly Trash2 = Trash2;
  readonly Wand2 = Wand2;
  readonly X = X;

  readonly kinds = KNOWLEDGE_KINDS;
  readonly kindLabel = kindLabel;
  readonly kindDescription = kindDescription;
  readonly kindAccentClass = kindAccentClass;

  private readonly api = inject(KnowledgeApiService);
  private readonly datasetApi = inject(DatasetsApiService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly snippets = signal<KnowledgeSnippet[]>([]);
  readonly datasets = signal<Dataset[]>([]);

  readonly kindFilter = signal<KindFilter>('all');
  readonly datasetFilter = signal<'all' | string>('all');
  readonly pendingOnly = signal(false);

  readonly formOpen = signal(false);
  readonly editingSnippet = signal<KnowledgeSnippet | null>(null);

  readonly generateOpen = signal(false);
  readonly generateDatasetId = signal('');
  readonly generating = signal(false);
  /** What the run is doing, oldest first — the last one is still in flight. */
  readonly generateSteps = signal<KnowledgeBootstrapProgress[]>([]);

  readonly togglingId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);

  readonly pendingCount = computed(
    () =>
      this.snippets().filter((s) => s.source === 'mined' && !s.enabled).length,
  );

  readonly filteredSnippets = computed(() => {
    let list = this.snippets();
    if (this.pendingOnly()) {
      return list.filter((s) => s.source === 'mined' && !s.enabled);
    }
    if (this.kindFilter() !== 'all') {
      list = list.filter((s) => s.kind === this.kindFilter());
    }
    if (this.datasetFilter() !== 'all') {
      const dataset = this.datasetFilter();
      list = list.filter(
        (s) => !s.scope?.datasetId || s.scope.datasetId === dataset,
      );
    }
    return list;
  });

  ngOnInit(): void {
    this.loadDatasets();
    this.loadSnippets();
  }

  private loadDatasets(): void {
    this.datasetApi.getDatasets().subscribe({
      next: (res) => this.datasets.set(res.datasets),
      error: () => this.datasets.set([]),
    });
  }

  private loadSnippets(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (snippets) => {
        this.snippets.set(snippets);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  setKindFilter(kind: KindFilter): void {
    this.pendingOnly.set(false);
    this.kindFilter.set(kind);
  }

  setDatasetFilter(id: string): void {
    this.pendingOnly.set(false);
    this.datasetFilter.set(id);
  }

  togglePendingOnly(): void {
    this.pendingOnly.set(!this.pendingOnly());
  }

  scopeLabel(snippet: KnowledgeSnippet): string {
    if (!snippet.scope?.datasetId) return 'Global';
    return snippet.scope.datasetId;
  }

  updatedLabel(snippet: KnowledgeSnippet): string {
    const date = new Date(snippet.updatedAt);
    return isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  kindIcon(kind: KnowledgeSnippetKind) {
    switch (kind) {
      case 'instruction':
        return FileText;
      case 'term':
        return Tag;
      case 'default_filter':
        return Filter;
    }
  }

  openNew(): void {
    this.generateOpen.set(false);
    this.editingSnippet.set(null);
    this.formOpen.set(true);
  }

  openEdit(snippet: KnowledgeSnippet): void {
    this.generateOpen.set(false);
    this.editingSnippet.set(snippet);
    this.formOpen.set(true);
  }

  cancelForm(): void {
    this.formOpen.set(false);
    this.editingSnippet.set(null);
  }

  onSnippetSaved(): void {
    this.formOpen.set(false);
    this.editingSnippet.set(null);
    this.loadSnippets();
  }

  /** Approve (enable) a snippet — used both for edits and pending accepts. */
  toggleEnabled(snippet: KnowledgeSnippet): void {
    if (this.togglingId()) return;
    const next = !snippet.enabled;
    this.togglingId.set(snippet.id);
    this.api.update(snippet.id, { enabled: next }).subscribe({
      next: (updated) => {
        this.togglingId.set(null);
        this.snippets.update((list) =>
          list.map((item) => (item.id === updated.id ? updated : item)),
        );
        this.toast.success(next ? 'Snippet enabled' : 'Snippet disabled');
      },
      error: (err) => {
        this.togglingId.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  deleteSnippet(snippet: KnowledgeSnippet): void {
    const confirmed = window.confirm(
      `Delete “${snippet.title}”?\n\nThe assistant will stop using it.`,
    );
    if (!confirmed) return;
    this.remove(snippet);
  }

  /** Reject a mined suggestion — deletes it, same as a regular delete. */
  rejectSuggestion(snippet: KnowledgeSnippet): void {
    const confirmed = window.confirm(
      `Reject “${snippet.title}”?\n\nThis permanently removes the suggestion.`,
    );
    if (!confirmed) return;
    this.remove(snippet);
  }

  private remove(snippet: KnowledgeSnippet): void {
    this.deletingId.set(snippet.id);
    this.api.delete(snippet.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.snippets.update((list) =>
          list.filter((item) => item.id !== snippet.id),
        );
        this.toast.success('Snippet deleted');
      },
      error: (err) => {
        this.deletingId.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  openGenerate(): void {
    this.formOpen.set(false);
    this.generateDatasetId.set(this.datasets()[0]?.name ?? '');
    this.generateSteps.set([]);
    this.generateOpen.set(true);
  }

  cancelGenerate(): void {
    if (this.generating()) return;
    this.generateOpen.set(false);
    this.generateSteps.set([]);
  }

  /**
   * The step currently in flight — the last one reported. Falls back to a
   * starting line so the panel never shows an empty box between the click
   * and the backend's first progress event.
   */
  currentStep(): KnowledgeBootstrapProgress | null {
    if (!this.generating()) return null;
    const steps = this.generateSteps();
    return steps.length
      ? steps[steps.length - 1]
      : { key: 'start', message: 'Starting' };
  }

  /** Steps already finished — everything before the one in flight. */
  finishedSteps(): KnowledgeBootstrapProgress[] {
    const steps = this.generateSteps();
    return this.generating() ? steps.slice(0, -1) : steps;
  }

  generateSuggestions(): void {
    const datasetId = this.generateDatasetId();
    if (!datasetId || this.generating()) return;
    this.generating.set(true);
    this.generateSteps.set([]);
    void this.api.bootstrapStream(datasetId, {
      onProgress: (progress) => this.recordStep(progress),
      onDone: (created) => {
        this.generating.set(false);
        this.generateOpen.set(false);
        this.generateSteps.set([]);
        const count = created.length;
        this.toast.success(
          count === 0
            ? 'No new suggestions this time'
            : `${count} suggestion${count === 1 ? '' : 's'} generated — review in Pending suggestions`,
        );
        this.pendingOnly.set(true);
        this.loadSnippets();
      },
      onError: (message) => {
        this.generating.set(false);
        this.generateSteps.set([]);
        this.toast.error(
          message || 'Could not generate suggestions — try again shortly',
        );
      },
    });
  }

  /**
   * Append a step, or replace the last one when it is the same stage — a
   * stage that counts up (sampling 2 of 5 tables) rewrites its own line.
   */
  private recordStep(progress: KnowledgeBootstrapProgress): void {
    this.generateSteps.update((steps) => {
      const last = steps[steps.length - 1];
      return last?.key === progress.key
        ? [...steps.slice(0, -1), progress]
        : [...steps, progress];
    });
  }
}
