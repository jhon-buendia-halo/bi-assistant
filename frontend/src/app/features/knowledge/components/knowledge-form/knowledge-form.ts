import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Loader2, X } from 'lucide-angular';
import { KnowledgeApiService } from '../../services/knowledge-api.service';
import {
  KNOWLEDGE_KINDS,
  KnowledgeSnippet,
  KnowledgeSnippetInput,
  KnowledgeSnippetKind,
} from '../../models/knowledge.model';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { ToastService } from '../../../../core/toast/toast.service';

/**
 * Create/edit panel for a knowledge snippet. `snippet` null means "new
 * snippet"; setting it prefills the form and switches "Create" to "Save".
 * Only the fields the feature spec calls out are editable here — approval
 * (enabled) lives in the list/pending view instead.
 */
@Component({
  selector: 'app-knowledge-form',
  imports: [LucideAngularModule],
  templateUrl: './knowledge-form.html',
  styleUrl: './knowledge-form.scss',
})
export class KnowledgeForm {
  readonly Loader2 = Loader2;
  readonly X = X;
  readonly kinds = KNOWLEDGE_KINDS;

  private readonly api = inject(KnowledgeApiService);
  private readonly toast = inject(ToastService);

  readonly snippet = input<KnowledgeSnippet | null>(null);
  readonly datasets = input<Dataset[]>([]);

  readonly saved = output<KnowledgeSnippet>();
  readonly cancelled = output<void>();

  readonly kind = signal<KnowledgeSnippetKind>('instruction');
  readonly title = signal('');
  readonly body = signal('');
  /** '' = Global scope; otherwise a dataset name. */
  readonly datasetScope = signal('');
  /** Comma-separated in the form, split into an array on save. */
  readonly synonyms = signal('');
  readonly entities = signal('');
  readonly saving = signal(false);

  readonly canSave = computed(
    () =>
      !this.saving() && this.title().trim() !== '' && this.body().trim() !== '',
  );

  constructor() {
    // Re-sync whenever the parent swaps in a different snippet (or clears it).
    effect(() => {
      const current = this.snippet();
      if (current) {
        this.kind.set(current.kind);
        this.title.set(current.title);
        this.body.set(current.body);
        this.datasetScope.set(current.scope?.datasetId ?? '');
        this.synonyms.set((current.synonyms ?? []).join(', '));
        this.entities.set((current.entities ?? []).join(', '));
      } else {
        this.reset();
      }
    });
  }

  save(): void {
    if (!this.canSave()) return;
    const input: KnowledgeSnippetInput = {
      kind: this.kind(),
      title: this.title().trim(),
      body: this.body().trim(),
      scope: this.datasetScope() ? { datasetId: this.datasetScope() } : null,
      ...(this.kind() === 'term'
        ? { synonyms: splitList(this.synonyms()) }
        : {}),
      ...(this.entities().trim()
        ? { entities: splitList(this.entities()) }
        : {}),
    };
    const existing = this.snippet();
    this.saving.set(true);
    const request = existing
      ? this.api.update(existing.id, input)
      : this.api.create(input);
    request.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toast.success(existing ? 'Snippet updated' : 'Snippet created');
        this.saved.emit(result);
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  cancel(): void {
    this.cancelled.emit();
  }

  private reset(): void {
    this.kind.set('instruction');
    this.title.set('');
    this.body.set('');
    this.datasetScope.set('');
    this.synonyms.set('');
    this.entities.set('');
  }
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
