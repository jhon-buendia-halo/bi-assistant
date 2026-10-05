import { Component, computed, effect, inject, signal } from '@angular/core';
import {
  LucideAngularModule,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleMinus,
  Database,
  FolderTree,
  NotebookText,
  Table2,
} from 'lucide-angular';
import { ColumnInfo } from '../../../datasources/models/datasource.model';
import { KnowledgeApiService } from '../../../knowledge/services/knowledge-api.service';
import { KnowledgeSnippet } from '../../../knowledge/models/knowledge.model';
import { DatasetSelectionService } from '../../services/dataset-selection.service';
import { DatasetInclusionService } from '../../services/dataset-inclusion.service';
import { DatasetEditingService } from '../../services/dataset-editing.service';
import {
  ColumnProfile,
  DatasetColumnSnapshot,
} from '../../services/datasets-api.service';
import {
  entityKeysMatch,
  formatCardinality,
  groupKnowledgeByColumn,
  profileSummary,
  visibleTopValues,
  VisibleValues,
} from '../../utils/column-profile.utils';
import { ToastService } from '../../../../core/toast/toast.service';

/** A live catalog column merged with its persisted profile, when one exists. */
interface MergedColumn extends ColumnInfo {
  profile?: ColumnProfile;
  references?: DatasetColumnSnapshot['references'];
}

@Component({
  selector: 'app-entity-details',
  imports: [LucideAngularModule],
  templateUrl: './entity-details.html',
  styleUrl: './entity-details.scss',
})
export class EntityDetails {
  readonly ChevronDown = ChevronDown;
  readonly ChevronUp = ChevronUp;
  readonly CircleCheck = CircleCheck;
  readonly CircleMinus = CircleMinus;
  readonly Database = Database;
  readonly FolderTree = FolderTree;
  readonly NotebookText = NotebookText;
  readonly Table2 = Table2;

  private readonly selectionService = inject(DatasetSelectionService);
  private readonly inclusionService = inject(DatasetInclusionService);
  private readonly editingService = inject(DatasetEditingService);
  private readonly knowledgeApi = inject(KnowledgeApiService);
  private readonly toast = inject(ToastService);

  readonly selection = this.selectionService.selection;

  /** Knowledge snippets scoped to the dataset currently being edited. */
  private readonly knowledgeSnippets = signal<KnowledgeSnippet[]>([]);
  /** `entityKey.columnName` keys whose top-values chips are expanded. */
  private readonly expandedTopValues = signal<Set<string>>(new Set());

  readonly totalEntities = computed(() => {
    const sel = this.selection();
    if (sel?.kind !== 'catalog') return 0;
    return sel.catalog.schemas.reduce((sum, s) => sum + s.tables.length, 0);
  });

  /** Fully-qualified key of the table currently selected, if any. */
  readonly currentEntityKey = computed(() => {
    const sel = this.selection();
    return sel?.kind === 'table'
      ? `${sel.catalogName}.${sel.schemaName}.${sel.table.name}`
      : null;
  });

  /** The saved dataset's snapshot for the selected table, when it has one. */
  private readonly currentEntitySnapshot = computed(() => {
    const key = this.currentEntityKey();
    if (!key) return null;
    const entities = this.editingService.dataset()?.entities ?? [];
    return entities.find((e) => entityKeysMatch(e.key, key)) ?? null;
  });

  /** The selected table's columns, merged with persisted profile/references. */
  readonly mergedColumns = computed<MergedColumn[]>(() => {
    const sel = this.selection();
    if (sel?.kind !== 'table') return [];
    const snapshot = this.currentEntitySnapshot();
    return sel.table.columns.map((column) => {
      const match = snapshot?.columns.find((c) => c.name === column.name);
      return {
        ...column,
        profile: match?.profile,
        references: match?.references,
      };
    });
  });

  /** Column-scoped knowledge notes for the selected table, keyed by column name. */
  readonly columnNotes = computed(() => {
    const key = this.currentEntityKey();
    if (!key) return new Map<string, KnowledgeSnippet[]>();
    return groupKnowledgeByColumn(this.knowledgeSnippets(), key);
  });

  constructor() {
    // Fetch once per dataset being edited; columnNotes/matchesColumn filter
    // client-side per column so switching tables needs no extra round-trip.
    effect(() => {
      const dataset = this.editingService.dataset();
      if (!dataset) {
        this.knowledgeSnippets.set([]);
        return;
      }
      this.knowledgeApi.list({ datasetId: dataset.name }).subscribe({
        next: (snippets) => this.knowledgeSnippets.set(snippets),
        // Inline notes are a convenience — never surface their failure here.
        error: () => this.knowledgeSnippets.set([]),
      });
    });
  }

  summaryFor(profile: ColumnProfile) {
    return profileSummary(profile);
  }

  cardinalityLabel(column: MergedColumn): string | undefined {
    return formatCardinality(column.references);
  }

  private topValuesKey(column: string): string {
    return `${this.currentEntityKey() ?? ''}.${column}`;
  }

  isTopValuesExpanded(column: string): boolean {
    return this.expandedTopValues().has(this.topValuesKey(column));
  }

  toggleTopValues(column: string): void {
    const key = this.topValuesKey(column);
    const next = new Set(this.expandedTopValues());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expandedTopValues.set(next);
  }

  visibleValues(column: MergedColumn): VisibleValues<{
    value: string;
    count: number;
  }> {
    return visibleTopValues(
      column.profile?.topValues,
      this.isTopValuesExpanded(column.name),
    );
  }

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
