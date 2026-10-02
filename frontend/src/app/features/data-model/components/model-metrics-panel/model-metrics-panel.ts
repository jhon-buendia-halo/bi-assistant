import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
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
import { DataModelApiService } from '../../services/data-model-api.service';
import {
  AGGREGATIONS,
  Aggregation,
  Entity,
  Metric,
  MetricCandidate,
  ModelIssue,
  PREDICATE_OPS,
  PredicateOp,
} from '../../models/data-model.model';
import { ToastService } from '../../../../core/toast/toast.service';

const NO_VALUE_OPS: PredicateOp[] = ['is_null', 'not_null'];

/**
 * The metrics panel re-homed onto the model (brief §2,
 * `model-metrics-panel`) — roadmap 1.2.3's editor of record for metrics,
 * replacing `features/datasets/components/metrics-panel` (deleted; the
 * legacy `metrics` store/API it talked to stays only for backward
 * compatibility, see `MetricsModule`'s header). Every write here goes
 * straight to `/datasets/:name/model/metrics*` as a new `user` version.
 *
 * Scope note: the DSL's `where` predicate is a full boolean tree (`and`/
 * `or`/`not`, arbitrarily nested); this panel's builder only offers one
 * `{ attr, op, value }` leaf. A metric needing more than that is still
 * reachable — edit it in the YAML tab — this form just does not attempt a
 * recursive predicate UI for the common case.
 */
@Component({
  selector: 'app-model-metrics-panel',
  imports: [LucideAngularModule],
  templateUrl: './model-metrics-panel.html',
  styleUrl: './model-metrics-panel.scss',
})
export class ModelMetricsPanel {
  readonly Gauge = Gauge;
  readonly Loader2 = Loader2;
  readonly Pencil = Pencil;
  readonly Plus = Plus;
  readonly Sparkles = Sparkles;
  readonly Trash2 = Trash2;
  readonly X = X;
  readonly aggregations = AGGREGATIONS;
  readonly predicateOps = PREDICATE_OPS;

  private readonly api = inject(DataModelApiService);
  private readonly toast = inject(ToastService);

  readonly datasetName = input.required<string>();
  readonly entities = input.required<Entity[]>();
  /** Emits the new current version after any create/update/delete. */
  readonly saved = output<number>();

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly metrics = signal<Metric[]>([]);
  readonly candidates = signal<MetricCandidate[]>([]);
  readonly deleting = signal<string | null>(null);
  readonly saving = signal(false);
  readonly errors = signal<ModelIssue[]>([]);

  readonly formOpen = signal(false);
  /** The metric being edited (by its current name), null means "new". */
  readonly editingName = signal<string | null>(null);
  readonly label = signal('');
  readonly name = signal('');
  readonly entity = signal('');
  readonly mode = signal<'agg' | 'sql'>('agg');
  readonly agg = signal<Aggregation>('count');
  readonly of = signal('');
  readonly numerator = signal('');
  readonly denominator = signal('');
  readonly sql = signal('');
  readonly dimensions = signal<Set<string>>(new Set());
  readonly description = signal('');
  readonly whereEnabled = signal(false);
  readonly whereAttr = signal('');
  readonly whereOp = signal<PredicateOp>('eq');
  readonly whereValue = signal('');
  readonly sourceVerifiedQueryId = signal<string | null>(null);
  /** The metric being edited has a shape this single-condition, one-mode
   * form cannot represent (review finding 7: a compound `where` tree, or
   * both `agg` and `expressions.sql` at once) — the form opens read-only
   * with a note instead of silently dropping the part it cannot load. */
  readonly readOnlyMetric = signal(false);

  readonly entityOptions = computed(() => this.entities().map((e) => e.name));

  readonly selectedEntityAttributes = computed(
    () => this.entities().find((e) => e.name === this.entity())?.attributes ?? [],
  );

  readonly needsOf = computed(
    () => this.mode() === 'agg' && this.agg() !== 'count' && this.agg() !== 'ratio',
  );
  readonly needsRatioOperands = computed(
    () => this.mode() === 'agg' && this.agg() === 'ratio',
  );
  readonly whereNeedsValue = computed(
    () => !NO_VALUE_OPS.includes(this.whereOp()),
  );

  readonly canSave = computed(() => {
    if (this.saving() || this.readOnlyMetric()) return false;
    if (!this.label().trim() || !this.name().trim() || !this.entity().trim()) {
      return false;
    }
    if (this.mode() === 'sql') return this.sql().trim() !== '';
    if (this.needsOf()) return this.of().trim() !== '';
    if (this.needsRatioOperands()) {
      return this.numerator().trim() !== '' && this.denominator().trim() !== '';
    }
    return true;
  });

  constructor() {
    effect(() => this.load(this.datasetName()));
  }

  private load(datasetName: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.listModelMetrics(datasetName).subscribe({
      next: (res) => {
        this.metrics.set(res.metrics);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
    this.api.modelMetricCandidates(datasetName).subscribe({
      next: (res) => this.candidates.set(res.candidates),
      error: () => this.candidates.set([]),
    });
  }

  startNew(): void {
    this.reset();
    this.entity.set(this.entityOptions()[0] ?? '');
    this.formOpen.set(true);
  }

  startEdit(metric: Metric): void {
    this.editingName.set(metric.name);
    this.label.set(metric.label);
    this.name.set(metric.name);
    this.entity.set(metric.entity);
    this.description.set(metric.description ?? '');
    this.dimensions.set(new Set(metric.dimensions ?? []));
    this.sourceVerifiedQueryId.set(metric.sourceVerifiedQueryId ?? null);
    // Detect a shape this form cannot fully represent BEFORE loading
    // anything into its fields, so "read-only" always means "every field
    // below reflects the metric honestly" — never a partial load an
    // accidental Save would then silently narrow (review finding 7).
    this.readOnlyMetric.set(isAdvancedMetricShape(metric));
    if (metric.expressions?.sql && !metric.agg) {
      this.mode.set('sql');
      this.sql.set(metric.expressions.sql);
    } else {
      this.mode.set('agg');
      this.agg.set(metric.agg ?? 'count');
      this.of.set(metric.of ?? '');
      this.numerator.set(metric.numerator ?? '');
      this.denominator.set(metric.denominator ?? '');
      // A read-only metric with BOTH `agg` and `expressions.sql` still
      // shows the sql it is not editing in the sql field, for visibility.
      this.sql.set(metric.expressions?.sql ?? '');
    }
    if (metric.where && 'attr' in metric.where) {
      this.whereEnabled.set(true);
      this.whereAttr.set(metric.where.attr);
      this.whereOp.set(metric.where.op);
      this.whereValue.set(
        metric.where.value !== undefined ? String(metric.where.value) : '',
      );
    } else {
      this.whereEnabled.set(false);
    }
    this.formOpen.set(true);
  }

  startFromCandidate(candidate: MetricCandidate): void {
    this.reset();
    this.label.set(candidate.label);
    this.name.set(candidate.name);
    this.entity.set(candidate.entity);
    this.mode.set('sql');
    this.description.set(`Promoted from verified query: ${candidate.sql}`);
    this.sourceVerifiedQueryId.set(candidate.verifiedQueryId);
    this.formOpen.set(true);
  }

  cancel(): void {
    this.reset();
    this.formOpen.set(false);
  }

  toggleDimension(name: string): void {
    const next = new Set(this.dimensions());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.dimensions.set(next);
  }

  save(): void {
    if (!this.canSave()) return;
    const metric = this.buildMetric();
    const editing = this.editingName();
    this.saving.set(true);
    this.errors.set([]);
    const request = editing
      ? this.api.updateModelMetric(this.datasetName(), editing, metric)
      : this.api.createModelMetric(this.datasetName(), metric);
    request.subscribe({
      next: (res) => {
        this.saving.set(false);
        if (!res.ok || res.version === undefined) {
          this.errors.set(res.errors ?? []);
          return;
        }
        this.toast.success(`Metric "${metric.label}" saved`);
        this.cancel();
        this.load(this.datasetName());
        this.saved.emit(res.version);
      },
      error: (err) => {
        this.saving.set(false);
        const body = err?.error as { errors?: ModelIssue[] } | undefined;
        if (body?.errors) {
          this.errors.set(body.errors);
        } else {
          this.toast.error(err?.error?.message ?? 'Backend unreachable');
        }
      },
    });
  }

  remove(metric: Metric): void {
    const confirmed = window.confirm(
      `Delete the metric “${metric.label}”?\n\nAnswers will stop reusing its definition.`,
    );
    if (!confirmed) return;
    this.deleting.set(metric.name);
    this.api.deleteModelMetric(this.datasetName(), metric.name).subscribe({
      next: (res) => {
        this.deleting.set(null);
        if (!res.ok || res.version === undefined) {
          this.toast.error('Delete failed');
          return;
        }
        this.toast.success(`Metric "${metric.label}" deleted`);
        if (this.editingName() === metric.name) this.cancel();
        this.load(this.datasetName());
        this.saved.emit(res.version);
      },
      error: (err) => {
        this.deleting.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  private buildMetric(): Metric {
    const metric: Metric = {
      name: this.name().trim().toLowerCase(),
      label: this.label().trim(),
      entity: this.entity().trim(),
      ...(this.description().trim()
        ? { description: this.description().trim() }
        : {}),
      ...(this.dimensions().size
        ? { dimensions: Array.from(this.dimensions()) }
        : {}),
      ...(this.sourceVerifiedQueryId()
        ? { sourceVerifiedQueryId: this.sourceVerifiedQueryId()! }
        : {}),
    };
    if (this.mode() === 'sql') {
      metric.expressions = { sql: this.sql().trim() };
    } else {
      metric.agg = this.agg();
      if (this.needsRatioOperands()) {
        metric.numerator = this.numerator().trim();
        metric.denominator = this.denominator().trim();
      } else if (this.needsOf()) {
        metric.of = this.of().trim();
      }
    }
    if (this.whereEnabled() && this.whereAttr().trim()) {
      metric.where = {
        attr: this.whereAttr().trim(),
        op: this.whereOp(),
        ...(this.whereNeedsValue()
          ? { value: coercePredicateValue(this.whereValue()) }
          : {}),
      };
    }
    return metric;
  }

  private reset(): void {
    this.editingName.set(null);
    this.label.set('');
    this.name.set('');
    this.entity.set('');
    this.mode.set('agg');
    this.agg.set('count');
    this.of.set('');
    this.numerator.set('');
    this.denominator.set('');
    this.sql.set('');
    this.dimensions.set(new Set());
    this.description.set('');
    this.whereEnabled.set(false);
    this.whereAttr.set('');
    this.whereOp.set('eq');
    this.whereValue.set('');
    this.sourceVerifiedQueryId.set(null);
    this.readOnlyMetric.set(false);
    this.errors.set([]);
  }
}

/** A metric shape the single-condition, one-mode form cannot fully
 * represent (review finding 7): a compound `where` (`and`/`or`/`not`, not
 * a bare `{attr, op, value}` leaf), or both a portable `agg` and a dialect
 * `expressions.sql` at once — the form only ever writes one or the other. */
function isAdvancedMetricShape(metric: Metric): boolean {
  const compoundWhere = !!metric.where && !('attr' in metric.where);
  const bothModes = !!metric.agg && !!metric.expressions?.sql;
  return compoundWhere || bothModes;
}

/** A predicate value typed as free text — numeric-looking input becomes a
 * number, everything else stays a string. Good enough for the common
 * "attribute = 2022" / "status = 'denied'" cases this builder targets. */
function coercePredicateValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return raw;
}
