import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Link2, Loader2, Plus, Save, Trash2 } from 'lucide-angular';
import { DataModelApiService } from '../../services/data-model-api.service';
import {
  ATTRIBUTE_ROLES,
  ATTRIBUTE_TYPES,
  AttributeRole,
  AttributeType,
  CARDINALITIES,
  Cardinality,
  DataModel,
  Entity,
  ModelIssue,
  Relationship,
} from '../../models/data-model.model';
import { ToastService } from '../../../../core/toast/toast.service';

/** A relationship paired with its index in the model's flat
 * `relationships` array, so an edit/remove can address the right entry
 * after the per-entity list has been filtered down for display. */
interface IndexedRelationship {
  relationship: Relationship;
  index: number;
}

/**
 * Structured entity forms (brief §2, `entity-editor`): entity label,
 * description and key; per-attribute type/role/description; the
 * relationships touching this entity (cardinality, description, add new,
 * remove). Edits a working copy of the whole `DataModel` in memory, then
 * saves through the one write path every other edit surface uses —
 * `/serialize` to get the YAML, then `PUT .../model` to validate and
 * version it (brief: "one write path, one validator").
 */
@Component({
  selector: 'app-entity-editor',
  imports: [LucideAngularModule],
  templateUrl: './entity-editor.html',
  styleUrl: './entity-editor.scss',
})
export class EntityEditor {
  readonly Link2 = Link2;
  readonly Loader2 = Loader2;
  readonly Plus = Plus;
  readonly Save = Save;
  readonly Trash2 = Trash2;
  readonly attributeTypes = ATTRIBUTE_TYPES;
  readonly attributeRoles = ATTRIBUTE_ROLES;
  readonly cardinalities = CARDINALITIES;

  private readonly api = inject(DataModelApiService);
  private readonly toast = inject(ToastService);

  readonly datasetName = input.required<string>();
  readonly model = input.required<DataModel>();
  /** Set by the parent (e.g. clicking an entity in the Overview tab) to
   * jump straight to that entity; optional, defaults to the first entity. */
  readonly focusEntityName = input<string | null>(null);
  readonly saved = output<number>();

  readonly working = signal<DataModel | null>(null);
  readonly selectedEntityName = signal<string | null>(null);
  readonly saving = signal(false);
  readonly errors = signal<ModelIssue[]>([]);

  readonly entities = computed(() => this.working()?.entities ?? []);

  readonly selectedEntity = computed<Entity | null>(() => {
    const name = this.selectedEntityName();
    return this.entities().find((e) => e.name === name) ?? null;
  });

  readonly dirty = computed(
    () => JSON.stringify(this.working()) !== JSON.stringify(this.model()),
  );
  readonly canSave = computed(() => this.dirty() && !this.saving());

  /** Relationships touching the selected entity, with their index in the
   * model's flat array so an edit/remove addresses the right one. */
  readonly entityRelationships = computed<IndexedRelationship[]>(() => {
    const entity = this.selectedEntityName();
    if (!entity) return [];
    return (this.working()?.relationships ?? [])
      .map((relationship, index) => ({ relationship, index }))
      .filter(
        ({ relationship }) =>
          relationship.from.split('.')[0] === entity ||
          relationship.to.split('.')[0] === entity,
      );
  });

  readonly otherEntityNames = computed(() =>
    this.entities()
      .map((e) => e.name)
      .filter((name) => name !== this.selectedEntityName()),
  );

  constructor() {
    // Re-sync the working copy whenever the parent hands in a different
    // model (initial load, or after a save/revert elsewhere) — a plain
    // `effect` rather than comparing by reference only, since `saved` here
    // re-emits a model the parent re-fetches as a new object either way.
    effect(() => {
      const model = this.model();
      this.working.set(structuredClone(model));
      this.errors.set([]);
      const current = this.selectedEntityName();
      const stillExists = model.entities.some((e) => e.name === current);
      if (!stillExists) {
        this.selectedEntityName.set(model.entities[0]?.name ?? null);
      }
    });

    // A focus request from the parent always wins once the named entity
    // exists — distinct from the model re-sync above, which only falls
    // back to "first entity" when the current selection has disappeared.
    effect(() => {
      const focus = this.focusEntityName();
      if (!focus) return;
      if (this.model().entities.some((e) => e.name === focus)) {
        this.selectedEntityName.set(focus);
      }
    });
  }

  selectEntity(name: string): void {
    this.selectedEntityName.set(name);
  }

  updateEntityLabel(value: string): void {
    this.mutateEntity((entity) => ({ ...entity, label: value }));
  }

  updateEntityDescription(value: string): void {
    this.mutateEntity((entity) => ({ ...entity, description: value }));
  }

  /** Comma-separated key attribute names, same convention as the metrics
   * panel's dimensions field. */
  updateEntityKey(value: string): void {
    const key = value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    this.mutateEntity((entity) => ({ ...entity, key: key.length ? key : undefined }));
  }

  updateAttributeType(index: number, type: AttributeType): void {
    this.mutateEntity((entity) => ({
      ...entity,
      attributes: entity.attributes.map((a, i) =>
        i === index ? { ...a, type } : a,
      ),
    }));
  }

  updateAttributeRole(index: number, role: string): void {
    this.mutateEntity((entity) => ({
      ...entity,
      attributes: entity.attributes.map((a, i) =>
        i === index
          ? { ...a, role: (role || undefined) as AttributeRole | undefined }
          : a,
      ),
    }));
  }

  updateAttributeDescription(index: number, description: string): void {
    this.mutateEntity((entity) => ({
      ...entity,
      attributes: entity.attributes.map((a, i) =>
        i === index ? { ...a, description: description || undefined } : a,
      ),
    }));
  }

  updateRelationshipCardinality(index: number, cardinality: Cardinality): void {
    this.mutateRelationships((relationships) =>
      relationships.map((r, i) => (i === index ? { ...r, cardinality } : r)),
    );
  }

  updateRelationshipDescription(index: number, description: string): void {
    this.mutateRelationships((relationships) =>
      relationships.map((r, i) =>
        i === index ? { ...r, description: description || undefined } : r,
      ),
    );
  }

  /** New relationship from this entity's first key attribute to the target
   * entity's first key attribute — a starting point the user edits from,
   * not a guess meant to be correct unedited. */
  addRelationship(targetEntityName: string): void {
    const entity = this.selectedEntity();
    const target = this.entities().find((e) => e.name === targetEntityName);
    if (!entity || !target) return;
    const fromAttr = entity.key?.[0] ?? entity.attributes[0]?.name;
    const toAttr = target.key?.[0] ?? target.attributes[0]?.name;
    if (!fromAttr || !toAttr) {
      this.toast.error('That entity has no attributes to relate');
      return;
    }
    const relationship: Relationship = {
      from: `${entity.name}.${fromAttr}`,
      to: `${target.name}.${toAttr}`,
      cardinality: 'many_to_one',
      source: 'user',
    };
    this.working.update((model) =>
      model
        ? { ...model, relationships: [...model.relationships, relationship] }
        : model,
    );
  }

  removeRelationship(index: number): void {
    this.mutateRelationships((relationships) =>
      relationships.filter((_, i) => i !== index),
    );
  }

  save(): void {
    const model = this.working();
    if (!model || !this.canSave()) return;
    this.saving.set(true);
    this.errors.set([]);
    this.api.serialize(this.datasetName(), model).subscribe({
      next: ({ yaml }) => {
        this.api.putYaml(this.datasetName(), yaml).subscribe({
          next: (res) => {
            this.saving.set(false);
            if (!res.ok || res.version === undefined) {
              this.errors.set(res.errors ?? []);
              return;
            }
            this.toast.success(`Saved as version ${res.version}`);
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
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Could not serialize the model');
      },
    });
  }

  private mutateEntity(fn: (entity: Entity) => Entity): void {
    const name = this.selectedEntityName();
    if (!name) return;
    this.working.update((model) =>
      model
        ? {
            ...model,
            entities: model.entities.map((e) => (e.name === name ? fn(e) : e)),
          }
        : model,
    );
  }

  private mutateRelationships(
    fn: (relationships: Relationship[]) => Relationship[],
  ): void {
    this.working.update((model) =>
      model ? { ...model, relationships: fn(model.relationships) } : model,
    );
  }
}
