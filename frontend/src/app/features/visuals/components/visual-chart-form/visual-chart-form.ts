import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Loader2, Trash2, X } from 'lucide-angular';
import { VisualsApiService } from '../../services/visuals-api.service';
import {
  NO_PREVIEW,
  VISUAL_LIMITS,
  VISUAL_PREVIEW_KEYS,
  VISUAL_RENDERER_FORMS,
  VisualChart,
  VisualChartInput,
  keyLabel,
} from '../../models/visual-chart.model';
import { ToastService } from '../../../../core/toast/toast.service';
import { VisualPreview } from '../visual-preview/visual-preview';

let nextFormId = 0;

/**
 * Create/edit form for a chart in the Visuals library. `chart` null means
 * "new chart"; setting it prefills the form and offers Delete.
 */
@Component({
  selector: 'app-visual-chart-form',
  imports: [LucideAngularModule, VisualPreview],
  templateUrl: './visual-chart-form.html',
})
export class VisualChartForm {
  readonly Loader2 = Loader2;
  readonly Trash2 = Trash2;
  readonly X = X;
  readonly limits = VISUAL_LIMITS;
  readonly noPreview = NO_PREVIEW;
  readonly previewOptions = VISUAL_PREVIEW_KEYS.map((value) => ({
    value,
    label: keyLabel(value),
  }));
  readonly rendererOptions = VISUAL_RENDERER_FORMS.map((value) => ({
    value,
    label: keyLabel(value),
  }));

  /** Unique per instance, for the Category datalist. */
  readonly datalistId = `visual-categories-${nextFormId++}`;

  private readonly api = inject(VisualsApiService);
  private readonly toast = inject(ToastService);

  readonly chart = input<VisualChart | null>(null);
  /** Existing categories, offered in the Category datalist. */
  readonly categories = input<string[]>([]);

  readonly saved = output<VisualChart>();
  readonly deleted = output<string>();
  readonly cancelled = output<void>();

  readonly name = signal('');
  readonly category = signal('');
  readonly previewKey = signal<string>(NO_PREVIEW);
  /** '' stands for "Not drawn by the app" (null). */
  readonly rendererForm = signal('');
  readonly description = signal('');
  readonly whenToUse = signal('');
  readonly whenToAvoid = signal('');
  readonly dataShape = signal('');
  readonly enabled = signal(true);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  /** The backend's reason for the last failed save or delete, shown inline. */
  readonly error = signal<string | null>(null);

  readonly isEdit = computed(() => this.chart() !== null);
  readonly canSave = computed(
    () =>
      !this.saving() &&
      !this.deleting() &&
      this.name().trim() !== '' &&
      this.category().trim() !== '',
  );

  constructor() {
    effect(() => {
      const current = this.chart();
      this.error.set(null);
      this.name.set(current?.name ?? '');
      this.category.set(current?.category ?? '');
      this.previewKey.set(current?.previewKey ?? NO_PREVIEW);
      this.rendererForm.set(current?.rendererForm ?? '');
      this.description.set(current?.description ?? '');
      this.whenToUse.set(current?.whenToUse ?? '');
      this.whenToAvoid.set(current?.whenToAvoid ?? '');
      this.dataShape.set(current?.dataShape ?? '');
      this.enabled.set(current?.enabled ?? true);
    });
  }

  /** What Save sends: trimmed text, '' renderer as null. */
  buildInput(): VisualChartInput {
    const renderer = this.rendererForm();
    return {
      name: this.name().trim(),
      category: this.category().trim(),
      previewKey: this.previewKey(),
      rendererForm: renderer === '' ? null : renderer,
      description: this.description().trim(),
      whenToUse: this.whenToUse().trim(),
      whenToAvoid: this.whenToAvoid().trim(),
      dataShape: this.dataShape().trim(),
      enabled: this.enabled(),
    };
  }

  save(): void {
    if (!this.canSave()) return;
    const input = this.buildInput();
    const existing = this.chart();
    this.saving.set(true);
    this.error.set(null);
    const request =
      existing !== null
        ? this.api.update(existing.id, input)
        : this.api.create(input);
    request.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toast.success(existing !== null ? 'Chart updated' : 'Chart added');
        this.saved.emit(result);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  remove(): void {
    const existing = this.chart();
    if (existing === null || this.deleting()) return;
    if (!window.confirm(`Delete chart "${existing.name}"?`)) return;
    this.deleting.set(true);
    this.error.set(null);
    this.api.remove(existing.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.toast.success('Chart deleted');
        this.deleted.emit(existing.id);
      },
      error: (err) => {
        this.deleting.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  cancel(): void {
    this.cancelled.emit();
  }
}

/** Nest's validation errors send `message` as an array; join it. */
function errorMessage(err: { error?: { message?: unknown } }): string {
  const message = err?.error?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message
    ? message
    : 'Backend unreachable';
}
