import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  LucideAngularModule,
  ChevronRight,
  CircleCheck,
  CircleMinus,
  Database,
  FolderTree,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  ScanSearch,
  Search,
  Table2,
  X,
} from 'lucide-angular';
import { DatasourcesApiService } from '../../../datasources/services/datasources-api.service';
import {
  CatalogInfo,
  Datasource,
  kindLabel,
  SchemaInfo,
  TableInfo,
} from '../../../datasources/models/datasource.model';
import { DatasetSelectionService } from '../../services/dataset-selection.service';
import {
  InclusionState,
  DatasetInclusionService,
} from '../../services/dataset-inclusion.service';
import { DatasetEditingService } from '../../services/dataset-editing.service';
import { Dataset, DatasetsApiService } from '../../services/datasets-api.service';
import { relativeTime } from '../../utils/column-profile.utils';
import { MetricsPanel } from '../metrics-panel/metrics-panel';
import { ToastService } from '../../../../core/toast/toast.service';

/** One-paragraph description cap, enforced client and server side. */
export const DATASET_DESCRIPTION_MAX_LENGTH = 2000;

@Component({
  selector: 'app-catalog-browser',
  imports: [LucideAngularModule, MetricsPanel],
  templateUrl: './catalog-browser.html',
  styleUrl: './catalog-browser.scss',
})
export class CatalogBrowser implements OnInit, OnDestroy {
  readonly ChevronRight = ChevronRight;
  readonly CircleCheck = CircleCheck;
  readonly CircleMinus = CircleMinus;
  readonly Database = Database;
  readonly FolderTree = FolderTree;
  readonly Loader2 = Loader2;
  readonly Lock = Lock;
  readonly Play = Play;
  readonly RefreshCw = RefreshCw;
  readonly ScanSearch = ScanSearch;
  readonly Search = Search;
  readonly Table2 = Table2;
  readonly X = X;

  private readonly api = inject(DatasourcesApiService);
  private readonly selectionService = inject(DatasetSelectionService);
  private readonly inclusionService = inject(DatasetInclusionService);
  private readonly editingService = inject(DatasetEditingService);
  private readonly datasetApi = inject(DatasetsApiService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  /**
   * A datasource is picked but its inventory has not been requested yet. The
   * first pull waits for the user so a slow datasource (a cold Databricks
   * warehouse) never blocks picking a different one.
   */
  readonly awaitingChoice = signal(false);
  /** In-flight inventory request, cancelled when the datasource changes. */
  private inventorySub: Subscription | null = null;
  readonly datasources = signal<Datasource[]>([]);
  readonly datasourceId = signal('');
  readonly error = signal<string | null>(null);
  readonly catalogs = signal<CatalogInfo[]>([]);
  /** When the served inventory was read from the datasource (ISO), if known. */
  readonly fetchedAt = signal<string | null>(null);
  readonly cached = signal(false);
  /** Free-text filter over catalog / schema / entity names. */
  readonly search = signal('');
  readonly expanded = signal<Set<string>>(new Set());

  /**
   * The tree pruned to the current search: a catalog matching by name keeps
   * all its schemas/tables; otherwise only schemas (or their tables) that
   * match survive. Empty search returns the full tree unchanged.
   */
  readonly filteredCatalogs = computed<CatalogInfo[]>(() => {
    const term = this.search().trim().toLowerCase();
    const catalogs = this.catalogs();
    if (!term) return catalogs;
    const has = (name: string) => name.toLowerCase().includes(term);
    const result: CatalogInfo[] = [];
    for (const catalog of catalogs) {
      if (has(catalog.name)) {
        result.push(catalog);
        continue;
      }
      const schemas: SchemaInfo[] = [];
      for (const schema of catalog.schemas) {
        if (has(schema.name)) {
          schemas.push(schema);
          continue;
        }
        const tables = schema.tables.filter((t) => has(t.name));
        if (tables.length) schemas.push({ ...schema, tables });
      }
      if (schemas.length) result.push({ ...catalog, schemas });
    }
    return result;
  });
  readonly saving = signal(false);
  readonly datasetName = signal('');
  readonly saved = output<void>();
  /** When set, the browser opens in edit mode with this dataset's data. */
  readonly initial = input<Dataset | null>(null);

  /**
   * Local, updatable copy of the dataset being edited — refreshed after a
   * successful save, re-profile or description update so the header reflects
   * the change immediately, without waiting on the parent to re-pass
   * `initial()`. Mirrored into `DatasetEditingService` so `EntityDetails` can
   * merge persisted column profiles into the live catalog tree.
   */
  readonly currentDataset = signal<Dataset | null>(null);
  readonly descriptionDraft = signal('');
  readonly savingDescription = signal(false);
  readonly reprofiling = signal(false);

  readonly descriptionDirty = computed(
    () => this.descriptionDraft() !== (this.currentDataset()?.description ?? ''),
  );
  readonly profiledLabel = computed(() => {
    const at = this.currentDataset()?.profiledAt;
    if (!at) return '';
    return relativeTime(at) || '';
  });
  readonly selectedDatasource = computed(
    () => this.datasources().find((d) => d.id === this.datasourceId()) ?? null,
  );
  readonly datasourceLabel = computed(() =>
    kindLabel(this.selectedDatasource()?.kind),
  );

  readonly includedCount = computed(
    () => this.inclusionService.included().size,
  );

  /** Included entities, the scope the metrics panel curates definitions for. */
  readonly includedEntities = computed(() =>
    Array.from(this.inclusionService.included()),
  );

  /** Key of the currently selected element, for row highlighting. */
  readonly selectedKey = computed(() => {
    const sel = this.selectionService.selection();
    if (!sel) return null;
    if (sel.kind === 'catalog') return sel.catalog.name;
    if (sel.kind === 'schema') return `${sel.catalogName}.${sel.schema.name}`;
    return `${sel.catalogName}.${sel.schemaName}.${sel.table.name}`;
  });

  ngOnInit(): void {
    const editing = this.initial();
    this.setCurrentDataset(editing);
    if (editing) {
      // Edit mode — prefill the name and the included entities.
      this.datasetName.set(editing.name);
      this.inclusionService.included.set(new Set(editing.tables));
    } else {
      // A new dataset starts with a clean selection.
      this.inclusionService.included.set(new Set());
    }
    this.api.list().subscribe({
      next: (res) => {
        const datasources = res.datasources;
        this.datasources.set(datasources);
        if (datasources.length === 0) {
          this.error.set(
            'No datasource configured. Add one in Datasource Configuration first.',
          );
          this.loading.set(false);
          return;
        }
        const editingId = editing?.datasourceId;
        const selected =
          datasources.find((d) => d.id === editingId) ??
          datasources.find((d) => d.kind === 'databricks') ??
          datasources[0];
        if (editingId && selected.id !== editingId) {
          this.inclusionService.included.set(new Set());
          this.selectionService.clear();
          this.toast.error(
            'The dataset datasource is no longer available. Choose entities from another datasource.',
          );
        }
        this.datasourceId.set(selected.id);
        // With a real choice to make, never open a live connection before the
        // user has settled on a datasource: a cached snapshot renders straight
        // away, otherwise the picker waits for an explicit load. A single
        // datasource leaves nothing to choose, so it loads as before.
        if (editing || datasources.length === 1) {
          this.loadInventory(selected.id);
        } else {
          this.loadCachedInventory(selected.id);
        }
      },
      error: (err) => {
        this.error.set(
          err?.error?.message ?? 'Could not load configured datasources',
        );
        this.loading.set(false);
      },
    });
  }

  changeDatasource(id: string): void {
    if (!id || id === this.datasourceId()) return;
    // Switching is an explicit intent: drop whatever is still loading and
    // pull the newly picked datasource straight away.
    this.cancelInventoryRequest();
    this.datasourceId.set(id);
    this.catalogs.set([]);
    this.fetchedAt.set(null);
    this.search.set('');
    this.expanded.set(new Set());
    this.inclusionService.included.set(new Set());
    this.selectionService.clear();
    this.error.set(null);
    this.awaitingChoice.set(false);
    this.loadInventory(id);
  }

  /** Pull the inventory for the datasource the user settled on. */
  loadSelected(): void {
    const id = this.datasourceId();
    if (!id || this.loading()) return;
    this.awaitingChoice.set(false);
    this.loadInventory(id);
  }

  /** Abandon a slow pull and go back to the picker. */
  cancelLoad(): void {
    if (!this.loading()) return;
    this.cancelInventoryRequest();
    this.loading.set(false);
    this.awaitingChoice.set(true);
  }

  /** Re-read the inventory from the datasource, bypassing the cached snapshot. */
  refreshInventory(): void {
    const id = this.datasourceId();
    if (!id || this.loading()) return;
    this.loadInventory(id, true);
  }

  /** Local-time label for the snapshot timestamp, empty when unknown. */
  readonly updatedLabel = computed(() => {
    const at = this.fetchedAt();
    if (!at) return '';
    const date = new Date(at);
    return isNaN(date.getTime()) ? '' : date.toLocaleString();
  });

  /**
   * Show the stored snapshot if the backend already has one; otherwise fall
   * back to the picker so nothing is read until the user asks for it.
   */
  private loadCachedInventory(id: string): void {
    this.cancelInventoryRequest();
    this.loading.set(true);
    this.error.set(null);
    this.inventorySub = this.api
      .getInventory(id, { cachedOnly: true })
      .subscribe({
        next: (res) => {
          if (res.ok && res.catalogs) {
            this.catalogs.set(res.catalogs);
            this.fetchedAt.set(res.fetchedAt ?? null);
            this.cached.set(true);
          } else {
            this.awaitingChoice.set(true);
          }
          this.loading.set(false);
        },
        error: () => {
          // A failed probe is not worth an error banner — offer the load.
          this.awaitingChoice.set(true);
          this.loading.set(false);
        },
      });
  }

  private cancelInventoryRequest(): void {
    this.inventorySub?.unsubscribe();
    this.inventorySub = null;
  }

  ngOnDestroy(): void {
    this.cancelInventoryRequest();
  }

  private loadInventory(id: string, refresh = false): void {
    this.cancelInventoryRequest();
    this.loading.set(true);
    this.error.set(null);
    this.inventorySub = this.api.getInventory(id, { refresh }).subscribe({
      next: (res) => {
        if (res.ok) {
          this.catalogs.set(res.catalogs ?? []);
          this.fetchedAt.set(res.fetchedAt ?? null);
          this.cached.set(res.cached === true);
        } else this.error.set(res.message ?? 'Failed to load the inventory');
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  isExpanded(key: string): boolean {
    // An active search force-expands the pruned tree so matches deep in a
    // catalog stay visible without manual drilling.
    return this.search().trim() !== '' || this.expanded().has(key);
  }

  toggle(key: string): void {
    const next = new Set(this.expanded());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expanded.set(next);
  }

  selectCatalog(catalog: CatalogInfo): void {
    this.toggle(catalog.name);
    this.selectionService.select({ kind: 'catalog', catalog });
  }

  selectSchema(catalogName: string, schema: SchemaInfo): void {
    this.toggle(`${catalogName}.${schema.name}`);
    this.selectionService.select({ kind: 'schema', catalogName, schema });
  }

  selectTable(catalogName: string, schemaName: string, table: TableInfo): void {
    this.selectionService.select({
      kind: 'table',
      catalogName,
      schemaName,
      table,
    });
  }

  catalogState(catalog: CatalogInfo): InclusionState {
    return this.inclusionService.catalogState(catalog);
  }

  schemaState(catalogName: string, schema: SchemaInfo): InclusionState {
    return this.inclusionService.schemaState(catalogName, schema);
  }

  /** No-access objects (browse-only) render greyed. Only explicit `false`. */
  isCatalogLocked(catalog: CatalogInfo): boolean {
    return catalog.selectable === false;
  }

  isSchemaLocked(schema: SchemaInfo): boolean {
    return schema.selectable === false;
  }

  isTableLocked(table: TableInfo): boolean {
    return table.selectable === false;
  }

  isTableIncluded(
    catalogName: string,
    schemaName: string,
    table: TableInfo,
  ): boolean {
    return this.inclusionService.isTableIncluded(
      catalogName,
      schemaName,
      table.name,
    );
  }

  saveDataset(): void {
    if (this.saving()) return;
    const name = this.datasetName().trim();
    if (!name) {
      this.toast.error('Give the dataset a name first');
      return;
    }
    this.saving.set(true);
    // Schema snapshot for the included entities (we already have the
    // inventory in hand) — spares the backend live datasource round-trips.
    const included = this.inclusionService.included();
    const entities: {
      key: string;
      columns: { name: string; type: string; nullable: boolean }[];
    }[] = [];
    for (const catalog of this.catalogs()) {
      for (const schema of catalog.schemas) {
        for (const table of schema.tables) {
          const key = `${catalog.name}.${schema.name}.${table.name}`;
          if (included.has(key)) entities.push({ key, columns: table.columns });
        }
      }
    }
    const datasource = this.selectedDatasource();
    if (!datasource) {
      this.saving.set(false);
      this.toast.error('Select a datasource first');
      return;
    }
    this.datasetApi
      .createDataset(name, Array.from(included), entities, {
        id: datasource.id,
        kind: datasource.kind,
      })
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          if (res.ok) {
            this.toast.success(res.message);
            this.saved.emit();
          } else {
            this.toast.error(res.message);
          }
        },
        error: (err) => {
          this.toast.error(err?.error?.message ?? 'Backend unreachable');
          this.saving.set(false);
        },
      });
  }

  /** Save the "what questions this dataset answers" description. Empty clears it. */
  saveDescription(): void {
    const dataset = this.currentDataset();
    if (!dataset || this.savingDescription() || !this.descriptionDirty()) return;
    const description = this.descriptionDraft()
      .trim()
      .slice(0, DATASET_DESCRIPTION_MAX_LENGTH);
    this.savingDescription.set(true);
    this.datasetApi.updateDescription(dataset.name, description).subscribe({
      next: (res) => {
        this.savingDescription.set(false);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.toast.success(res.message);
        this.setCurrentDataset(res.dataset ?? { ...dataset, description });
      },
      error: (err) => {
        this.savingDescription.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /** Discard unsaved edits to the description, back to the last saved value. */
  cancelDescription(): void {
    this.descriptionDraft.set(this.currentDataset()?.description ?? '');
  }

  /** Recompute column profiles (null rate, distinct count, top values, …). */
  reprofile(): void {
    const dataset = this.currentDataset();
    if (!dataset || this.reprofiling()) return;
    this.reprofiling.set(true);
    this.datasetApi.reprofile(dataset.name).subscribe({
      next: (res) => {
        this.reprofiling.set(false);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.toast.success(res.message);
        if (res.dataset) this.setCurrentDataset(res.dataset);
      },
      error: (err) => {
        this.reprofiling.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  private setCurrentDataset(dataset: Dataset | null): void {
    this.currentDataset.set(dataset);
    this.descriptionDraft.set(dataset?.description ?? '');
    this.editingService.set(dataset);
  }
}
