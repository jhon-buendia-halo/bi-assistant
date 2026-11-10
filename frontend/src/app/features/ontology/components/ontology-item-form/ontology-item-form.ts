import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Loader2, Plus, Trash2, X } from 'lucide-angular';
import { OntologyApiService } from '../../services/ontology-api.service';
import {
  ConceptMapping,
  ONTOLOGY_KINDS,
  OntologyItem,
  OntologyItemInput,
  OntologyKind,
  RELATION_TYPES,
  RelationType,
  ontologyKindDescription,
} from '../../models/ontology.model';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { MetricsApiService } from '../../../datasets/services/metrics-api.service';
import { Metric } from '../../../datasets/models/metric.model';
import { ToastService } from '../../../../core/toast/toast.service';

/** One editable mapping row; all three are plain strings in the form. */
interface MappingRow {
  entity: string;
  column: string;
  expression: string;
}

/** What one mapping points at: a column, the whole table, or an expression. */
type MappingTarget = 'column' | 'table' | 'expression';

/** The open Add/Edit mapping picker; `index` null means a new mapping. */
interface MappingPicker {
  index: number | null;
  entity: string;
  target: MappingTarget;
  column: string;
  expression: string;
}

/**
 * Create/edit panel for one ontology item. The fields follow the chosen kind
 * (contract "Editor per kind"). `item` null means "new item"; an existing
 * item keeps its kind (the backend refuses a kind change).
 */
@Component({
  selector: 'app-ontology-item-form',
  imports: [LucideAngularModule, NgTemplateOutlet],
  templateUrl: './ontology-item-form.html',
})
export class OntologyItemForm implements OnInit {
  readonly Loader2 = Loader2;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly X = X;
  readonly kinds = ONTOLOGY_KINDS;
  readonly relationTypes = RELATION_TYPES;
  readonly kindDescription = ontologyKindDescription;

  private readonly api = inject(OntologyApiService);
  private readonly metricsApi = inject(MetricsApiService);
  private readonly toast = inject(ToastService);

  /** The dataset being edited (tables and entities snapshot). */
  readonly dataset = input.required<Dataset>();
  readonly item = input<OntologyItem | null>(null);
  /** Concepts listed for this dataset, shared ones included. */
  readonly concepts = input<OntologyItem[]>([]);

  readonly saved = output<OntologyItem>();
  readonly cancelled = output<void>();

  readonly kind = signal<OntologyKind>('concept');
  readonly name = signal('');
  /** Concept definition, instruction text, relation/constraint note. */
  readonly description = signal('');
  readonly synonyms = signal('');
  readonly mappings = signal<MappingRow[]>([]);
  /** The mapping being added or edited, or null when the picker is closed. */
  readonly picker = signal<MappingPicker | null>(null);
  readonly targetOptions: { value: MappingTarget; label: string; hint: string }[] = [
    { value: 'column', label: 'A column', hint: 'the concept is the values of one column' },
    { value: 'table', label: 'The whole table', hint: 'each row is one of these' },
    { value: 'expression', label: 'A SQL expression', hint: 'computed from the columns' },
  ];
  readonly predicate = signal('');
  readonly conceptId = signal('');
  readonly entities = signal<string[]>([]);
  readonly from = signal('');
  readonly relationType = signal<RelationType>('is-a');
  readonly to = signal('');
  readonly metricId = signal('');
  readonly shared = signal(false);

  readonly metrics = signal<Metric[]>([]);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly isNew = computed(() => this.item() === null);
  readonly tables = computed(() => this.dataset().tables ?? []);

  /** Concepts a relation or constraint can point at (never the item itself). */
  readonly conceptOptions = computed(() => {
    const self = this.item()?.id;
    return this.concepts().filter((c) => c.kind === 'concept' && c.id !== self);
  });

  readonly canSave = computed(() => {
    // A half-entered mapping must be added or cancelled first.
    if (this.saving() || this.picker() !== null) return false;
    switch (this.kind()) {
      case 'concept':
        return (
          this.name().trim() !== '' &&
          this.description().trim() !== '' &&
          this.mappings().every((m) => m.entity.trim() !== '')
        );
      case 'instruction':
        return this.name().trim() !== '' && this.description().trim() !== '';
      case 'constraint':
        return this.name().trim() !== '' && this.predicate().trim() !== '';
      case 'relation':
        return (
          this.from() !== '' &&
          (this.relationType() === 'measured-by'
            ? this.metricId() !== ''
            : this.to() !== '')
        );
    }
  });

  constructor() {
    // Re-sync whenever the parent swaps in a different item (or clears it).
    effect(() => {
      const current = this.item();
      this.error.set(null);
      if (current) this.prefill(current);
      else this.reset();
    });
  }

  ngOnInit(): void {
    this.metricsApi.list(this.tables()).subscribe({
      next: (res) => this.metrics.set(res.metrics ?? []),
      error: () => this.metrics.set([]),
    });
  }

  setKind(kind: OntologyKind): void {
    if (!this.isNew()) return;
    this.kind.set(kind);
    this.error.set(null);
  }

  /** Columns of one entity, from the dataset's schema snapshot. */
  columnsOf(entity: string): string[] {
    return (
      this.dataset()
        .entities?.find((e) => e.key === entity)
        ?.columns.map((c) => c.name) ?? []
    );
  }

  /** The picker can add or update once its target is fully chosen. */
  readonly pickerReady = computed(() => {
    const p = this.picker();
    if (!p || !p.entity) return false;
    if (p.target === 'column') return p.column.trim() !== '';
    if (p.target === 'expression') return p.expression.trim() !== '';
    return true;
  });

  openAddMapping(): void {
    this.picker.set({
      index: null,
      entity: this.tables()[0] ?? '',
      target: 'column',
      column: '',
      expression: '',
    });
  }

  openEditMapping(index: number): void {
    const row = this.mappings()[index];
    if (!row) return;
    this.picker.set({
      index,
      entity: row.entity,
      target: this.targetOf(row),
      column: row.column,
      expression: row.expression,
    });
  }

  setPicker(field: 'entity' | 'target' | 'column' | 'expression', value: string): void {
    this.picker.update((p) => {
      if (!p) return p;
      // A new table invalidates the column chosen for the old one.
      if (field === 'entity') return { ...p, entity: value, column: '' };
      if (field === 'target') return { ...p, target: value as MappingTarget };
      return { ...p, [field]: value };
    });
  }

  /** Writes the picker back as one mapping with exactly one target. */
  commitPicker(): void {
    const p = this.picker();
    if (!p || !this.pickerReady()) return;
    const row: MappingRow = {
      entity: p.entity,
      column: p.target === 'column' ? p.column.trim() : '',
      expression: p.target === 'expression' ? p.expression.trim() : '',
    };
    this.mappings.update((rows) =>
      p.index === null
        ? [...rows, row]
        : rows.map((r, i) => (i === p.index ? row : r)),
    );
    this.picker.set(null);
  }

  cancelPicker(): void {
    this.picker.set(null);
  }

  removeMapping(index: number): void {
    this.mappings.update((rows) => rows.filter((_, i) => i !== index));
  }

  /** An expression wins over a column, as the assistant's line renders it. */
  targetOf(row: MappingRow): MappingTarget {
    if (row.expression.trim()) return 'expression';
    if (row.column.trim()) return 'column';
    return 'table';
  }

  /**
   * A table's short name: the last part of `catalog.schema.table`, or
   * `schema.table` when two of the dataset's tables share that last part.
   */
  shortTable(entity: string): string {
    const parts = entity.split('.');
    const last = parts[parts.length - 1] ?? entity;
    const clash = this.tables().some(
      (t) => t !== entity && t.split('.').pop() === last,
    );
    return clash && parts.length >= 2 ? parts.slice(-2).join('.') : last;
  }

  /** The full mapping in words, for the tooltip and screen readers. */
  mappingTitle(row: MappingRow): string {
    switch (this.targetOf(row)) {
      case 'column':
        return `${row.entity}, column ${row.column}`;
      case 'expression':
        return row.column.trim()
          ? `${row.entity}: ${row.expression} (column ${row.column})`
          : `${row.entity}: ${row.expression}`;
      default:
        return `${row.entity}, whole table`;
    }
  }

  toggleEntity(entity: string, checked: boolean): void {
    this.entities.update((list) =>
      checked
        ? list.includes(entity)
          ? list
          : [...list, entity]
        : list.filter((e) => e !== entity),
    );
  }

  /** The payload for the chosen kind — only that kind's fields. */
  buildInput(): OntologyItemInput {
    const kind = this.kind();
    const entities = this.entities();
    switch (kind) {
      case 'concept': {
        const synonyms = splitList(this.synonyms());
        const mappings = this.mappings().map(toMapping);
        return {
          kind,
          name: this.name().trim(),
          description: this.description().trim(),
          ...(synonyms.length ? { synonyms } : {}),
          ...(mappings.length ? { mappings } : {}),
        };
      }
      case 'relation': {
        const type = this.relationType();
        const measured = type === 'measured-by';
        return {
          kind,
          name: this.relationName(),
          description: this.description().trim(),
          from: this.from(),
          type,
          ...(measured ? { metricId: this.metricId() } : { to: this.to() }),
        };
      }
      case 'constraint':
        return {
          kind,
          name: this.name().trim(),
          predicate: this.predicate().trim(),
          description: this.description().trim(),
          // Always sent: '' clears a stored link on edit (the backend drops it).
          conceptId: this.conceptId(),
          ...(entities.length ? { entities } : {}),
        };
      case 'instruction':
        return {
          kind,
          name: this.name().trim(),
          description: this.description().trim(),
          ...(entities.length ? { entities } : {}),
        };
    }
  }

  /** A relation is named after what it says: `Member is-a Person`. */
  relationName(): string {
    const fromName = this.conceptName(this.from());
    const target =
      this.relationType() === 'measured-by'
        ? this.metricLabel(this.metricId())
        : this.conceptName(this.to());
    return [fromName, this.relationType(), target].filter(Boolean).join(' ');
  }

  save(): void {
    if (!this.canSave()) return;
    const input = this.buildInput();
    const existing = this.item();
    this.saving.set(true);
    this.error.set(null);
    let request;
    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { kind: _kind, ...patch } = input;
      request = this.api.update(existing.id, withClearedFields(patch, existing));
    } else {
      request = this.api.create(this.dataset().name, {
        ...input,
        ...(this.shared() ? { shared: true } : {}),
      });
    }
    request.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toast.success(existing ? 'Item updated' : 'Item created');
        this.saved.emit(result);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  cancel(): void {
    this.cancelled.emit();
  }

  private conceptName(id: string): string {
    return this.concepts().find((c) => c.id === id)?.name ?? '';
  }

  private metricLabel(id: string): string {
    const metric = this.metrics().find((m) => m.id === id);
    return metric ? metric.label || metric.name : '';
  }

  private prefill(item: OntologyItem): void {
    this.kind.set(item.kind);
    this.name.set(item.name);
    this.description.set(item.description ?? '');
    this.synonyms.set((item.synonyms ?? []).join(', '));
    this.mappings.set(
      (item.mappings ?? []).map((m) => ({
        entity: m.entity,
        column: m.column ?? '',
        expression: m.expression ?? '',
      })),
    );
    this.picker.set(null);
    this.predicate.set(item.predicate ?? '');
    this.conceptId.set(item.conceptId ?? '');
    this.entities.set([...(item.entities ?? [])]);
    this.from.set(item.from ?? '');
    this.relationType.set(item.type ?? 'is-a');
    this.to.set(item.to ?? '');
    this.metricId.set(item.metricId ?? '');
    this.shared.set(item.dataset === null);
  }

  private reset(): void {
    this.kind.set('concept');
    this.name.set('');
    this.description.set('');
    this.synonyms.set('');
    this.mappings.set([]);
    this.picker.set(null);
    this.predicate.set('');
    this.conceptId.set('');
    this.entities.set([]);
    this.from.set('');
    this.relationType.set('is-a');
    this.to.set('');
    this.metricId.set('');
    this.shared.set(false);
  }
}

function toMapping(row: MappingRow): ConceptMapping {
  const column = row.column.trim();
  const expression = row.expression.trim();
  return {
    entity: row.entity.trim(),
    ...(column ? { column } : {}),
    ...(expression ? { expression } : {}),
  };
}

/**
 * On edit, a list the user emptied must still be sent (as `[]`) so the
 * backend clears it; on create an empty list is simply omitted.
 */
function withClearedFields(
  patch: Omit<OntologyItemInput, 'kind'>,
  existing: OntologyItem,
): Omit<OntologyItemInput, 'kind'> {
  const result = { ...patch };
  if (existing.kind === 'concept') {
    result.synonyms ??= [];
    result.mappings ??= [];
  }
  if (existing.kind === 'constraint' || existing.kind === 'instruction') {
    result.entities ??= [];
  }
  return result;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function errorMessage(err: unknown): string {
  const message = (err as { error?: { message?: unknown } })?.error?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (typeof message === 'string' && message) return message;
  return 'Backend unreachable';
}
