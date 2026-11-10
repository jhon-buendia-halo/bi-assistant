import { Component, computed, inject } from '@angular/core';
import {
  LucideAngularModule,
  CircleCheck,
  CircleMinus,
  Database,
  FolderTree,
  Table2,
} from 'lucide-angular';
import { DatasetSelectionService } from '../../services/dataset-selection.service';
import { DatasetInclusionService } from '../../services/dataset-inclusion.service';
import { DatasetSchemaNotesService } from '../../services/dataset-schema-notes.service';
import {
  SCHEMA_DESCRIPTION_MAX,
  SCHEMA_LAYERS,
  SchemaLayer,
} from '../../services/datasets-api.service';
import { ToastService } from '../../../../core/toast/toast.service';

@Component({
  selector: 'app-entity-details',
  imports: [LucideAngularModule],
  templateUrl: './entity-details.html',
  styleUrl: './entity-details.scss',
})
export class EntityDetails {
  readonly CircleCheck = CircleCheck;
  readonly CircleMinus = CircleMinus;
  readonly Database = Database;
  readonly FolderTree = FolderTree;
  readonly Table2 = Table2;

  private readonly selectionService = inject(DatasetSelectionService);
  private readonly inclusionService = inject(DatasetInclusionService);
  private readonly toast = inject(ToastService);
  private readonly schemaNotes = inject(DatasetSchemaNotesService);

  readonly layers = SCHEMA_LAYERS;
  readonly descriptionMax = SCHEMA_DESCRIPTION_MAX;

  readonly selection = this.selectionService.selection;

  readonly schemaNoteKey = computed(() => {
    const sel = this.selection();
    return sel?.kind === 'schema'
      ? this.schemaNotes.schemaKey(sel.catalogName, sel.schema.name)
      : null;
  });

  readonly schemaNote = computed(() => {
    const key = this.schemaNoteKey();
    return key ? this.schemaNotes.get(key) : undefined;
  });

  setLayer(value: string): void {
    const key = this.schemaNoteKey();
    if (key) this.schemaNotes.setLayer(key, value as SchemaLayer | '');
  }

  setDescription(value: string): void {
    const key = this.schemaNoteKey();
    if (key) this.schemaNotes.setDescription(key, value);
  }

  readonly totalEntities = computed(() => {
    const sel = this.selection();
    if (sel?.kind !== 'catalog') return 0;
    return sel.catalog.schemas.reduce((sum, s) => sum + s.tables.length, 0);
  });

  readonly inclusionState = computed(() => {
    const sel = this.selection();
    // Depend on the included set so the state recomputes on changes.
    this.inclusionService.included();
    return sel ? this.inclusionService.selectionState(sel) : 'none';
  });

  toggleInclusion(): void {
    const sel = this.selection();
    if (!sel) return;
    const name =
      sel.kind === 'catalog'
        ? sel.catalog.name
        : sel.kind === 'schema'
          ? sel.schema.name
          : sel.table.name;
    const before = this.inclusionService.included().size;
    if (this.inclusionState() === 'full') {
      this.inclusionService.remove(sel);
      const removed = before - this.inclusionService.included().size;
      this.toast.info(`Removed ${name} — ${removed} entities excluded`);
    } else {
      this.inclusionService.include(sel);
      const added = this.inclusionService.included().size - before;
      this.toast.success(`Included ${name} — ${added} entities added`);
    }
  }
}
