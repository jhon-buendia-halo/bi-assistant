import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Gauge,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-angular';
import { MetricsApiService } from '../../services/metrics-api.service';
import {
  Metric,
  MetricCandidate,
  MetricInput,
} from '../../models/metric.model';
import { ToastService } from '../../../../core/toast/toast.service';

/**
 * Curated metric definitions for the entities included in the dataset being
 * edited. One definition per business number, reused verbatim by the
 * assistant, so "denial rate" means the same thing in every answer.
 */
@Component({
  selector: 'app-metrics-panel',
  imports: [LucideAngularModule],
  templateUrl: './metrics-panel.html',
  styleUrl: './metrics-panel.scss',
})
export class MetricsPanel {
  readonly Gauge = Gauge;
  readonly Loader2 = Loader2;
  readonly Pencil = Pencil;
  readonly Plus = Plus;
  readonly Sparkles = Sparkles;
  readonly Trash2 = Trash2;
  readonly X = X;

  private readonly api = inject(MetricsApiService);
  private readonly toast = inject(ToastService);

  /** Fully-qualified entities currently included in the dataset. */
  readonly entities = input<string[]>([]);
  readonly datasourceId = input<string | null>(null);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly metrics = signal<Metric[]>([]);
  readonly candidates = signal<MetricCandidate[]>([]);
  readonly deleting = signal<string | null>(null);
  readonly saving = signal(false);

  /** Form state — `editingId` null with `formOpen` means "new metric". */
  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly label = signal('');
  readonly name = signal('');
  readonly entity = signal('');
  readonly expression = signal('');
  /** Comma-separated in the form, split on save. */
  readonly dimensions = signal('');
  readonly description = signal('');
  readonly sourceVerifiedQueryId = signal<string | null>(null);

  readonly canSave = computed(
    () =>
      !this.saving() &&
      this.label().trim() !== '' &&
      this.name().trim() !== '' &&
      this.entity().trim() !== '' &&
      this.expression().trim() !== '',
  );

  /** The entity list the select offers — always includes the edited value. */
  readonly entityOptions = computed(() => {
    const options = [...this.entities()];
    const current = this.entity();
    if (current && !options.includes(current)) options.unshift(current);
    return options;
  });

  constructor() {
    // The dataset selection drives the scope: re-read whenever it changes.
    effect(() => this.load(this.entities()));
  }

  private load(entities: string[]): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.list(entities).subscribe({
      next: (res) => {
        this.metrics.set(res.metrics);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
    this.api.candidates(entities).subscribe({
      next: (res) => this.candidates.set(res.candidates),
      // Prefill suggestions are a convenience — never surface their failure.
      error: () => this.candidates.set([]),
    });
  }

  startNew(): void {
    this.reset();
    this.entity.set(this.entities()[0] ?? '');
    this.formOpen.set(true);
  }

  startEdit(metric: Metric): void {
    this.editingId.set(metric.id);
    this.label.set(metric.label);
    this.name.set(metric.name);
    this.entity.set(metric.entity);
    this.expression.set(metric.expression);
    this.dimensions.set((metric.dimensions ?? []).join(', '));
    this.description.set(metric.description ?? '');
    this.sourceVerifiedQueryId.set(metric.sourceVerifiedQueryId ?? null);
    this.formOpen.set(true);
  }

  /** Promotion path: open the form prefilled from a verified query. */
  startFromCandidate(candidate: MetricCandidate): void {
    this.reset();
    this.label.set(candidate.label);
    this.name.set(candidate.name);
    this.entity.set(candidate.entity);
    // The expression stays empty on purpose — the approved SQL is a whole
    // statement, so the user lifts the aggregation out of it.
    this.description.set(`Promoted from verified query: ${candidate.sql}`);
    this.sourceVerifiedQueryId.set(candidate.verifiedQueryId);
    this.formOpen.set(true);
  }

  cancel(): void {
    this.reset();
    this.formOpen.set(false);
  }

  save(): void {
    if (!this.canSave()) return;
    const input: MetricInput = {
      label: this.label().trim(),
      name: this.name().trim().toLowerCase(),
      entity: this.entity().trim(),
      expression: this.expression().trim(),
      dimensions: this.dimensions()
        .split(',')
        .map((dimension) => dimension.trim())
        .filter(Boolean),
      ...(this.description().trim()
        ? { description: this.description().trim() }
        : {}),
      ...(this.datasourceId() ? { datasourceId: this.datasourceId()! } : {}),
      ...(this.sourceVerifiedQueryId()
        ? { sourceVerifiedQueryId: this.sourceVerifiedQueryId()! }
        : {}),
    };
    const id = this.editingId();
    this.saving.set(true);
    const request = id ? this.api.update(id, input) : this.api.create(input);
    request.subscribe({
      next: (res) => {
        this.saving.set(false);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.toast.success(res.message);
        this.cancel();
        this.load(this.entities());
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  remove(metric: Metric): void {
    const confirmed = window.confirm(
      `Delete the metric “${metric.label}”?\n\nAnswers will stop reusing its definition.`,
    );
    if (!confirmed) return;
    this.deleting.set(metric.id);
    this.api.delete(metric.id).subscribe({
      next: (res) => {
        this.deleting.set(null);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.toast.success(res.message);
        if (this.editingId() === metric.id) this.cancel();
        this.metrics.update((metrics) =>
          metrics.filter((item) => item.id !== metric.id),
        );
        this.load(this.entities());
      },
      error: (err) => {
        this.deleting.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /** Short entity label for the list rows: `catalog.schema.table` → `table`. */
  entityLabel(entity: string): string {
    return entity.split('.').at(-1) ?? entity;
  }

  private reset(): void {
    this.editingId.set(null);
    this.label.set('');
    this.name.set('');
    this.entity.set('');
    this.expression.set('');
    this.dimensions.set('');
    this.description.set('');
    this.sourceVerifiedQueryId.set(null);
  }
}
