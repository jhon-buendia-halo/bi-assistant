import {
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  ChevronRight,
  CircleCheck,
  CircleMinus,
  Database,
  FolderTree,
  Loader2,
  Lock,
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
import { SandboxSelectionService } from '../../services/sandbox-selection.service';
import {
  InclusionState,
  SandboxInclusionService,
} from '../../services/sandbox-inclusion.service';
import { Sandbox, SandboxApiService } from '../../services/sandbox-api.service';
import { ToastService } from '../../../../core/toast/toast.service';

@Component({
  selector: 'app-catalog-browser',
  imports: [LucideAngularModule],
  templateUrl: './catalog-browser.html',
  styleUrl: './catalog-browser.scss',
})
export class CatalogBrowser implements OnInit {
  readonly ChevronRight = ChevronRight;
  readonly CircleCheck = CircleCheck;
  readonly CircleMinus = CircleMinus;
  readonly Database = Database;
  readonly FolderTree = FolderTree;
  readonly Loader2 = Loader2;
  readonly Lock = Lock;
  readonly Search = Search;
  readonly Table2 = Table2;
  readonly X = X;

  private readonly api = inject(DatasourcesApiService);
  private readonly selectionService = inject(SandboxSelectionService);
  private readonly inclusionService = inject(SandboxInclusionService);
  private readonly sandboxApi = inject(SandboxApiService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly datasources = signal<Datasource[]>([]);
  readonly datasourceId = signal('');
  readonly error = signal<string | null>(null);
  readonly catalogs = signal<CatalogInfo[]>([]);
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
  readonly sandboxName = signal('');
  readonly saved = output<void>();
  /** When set, the browser opens in edit mode with this sandbox's data. */
  readonly initial = input<Sandbox | null>(null);
  readonly selectedDatasource = computed(
    () => this.datasources().find((d) => d.id === this.datasourceId()) ?? null,
  );
  readonly datasourceLabel = computed(() =>
    kindLabel(this.selectedDatasource()?.kind),
  );

  readonly includedCount = computed(
    () => this.inclusionService.included().size,
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
    if (editing) {
      // Edit mode — prefill the name and the included entities.
      this.sandboxName.set(editing.name);
      this.inclusionService.included.set(new Set(editing.tables));
    } else {
      // A new sandbox starts with a clean selection.
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
            'The sandbox datasource is no longer available. Choose entities from another datasource.',
          );
        }
        this.datasourceId.set(selected.id);
        this.loadInventory(selected.id);
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
    this.datasourceId.set(id);
    this.catalogs.set([]);
    this.search.set('');
    this.expanded.set(new Set());
    this.inclusionService.included.set(new Set());
    this.selectionService.clear();
    this.loadInventory(id);
  }

  private loadInventory(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getInventory(id).subscribe({
      next: (res) => {
        if (res.ok) this.catalogs.set(res.catalogs ?? []);
        else this.error.set(res.message ?? 'Failed to load the inventory');
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

  saveSandbox(): void {
    if (this.saving()) return;
    const name = this.sandboxName().trim();
    if (!name) {
      this.toast.error('Give the sandbox a name first');
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
    this.sandboxApi
      .createSandbox(name, Array.from(included), entities, {
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
}
