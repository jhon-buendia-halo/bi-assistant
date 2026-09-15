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
  Table2,
} from 'lucide-angular';
import { DatabricksApiService } from '../../../databricks/services/databricks-api.service';
import {
  CatalogInfo,
  SchemaInfo,
  TableInfo,
} from '../../../databricks/models/databricks.model';
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
  readonly Table2 = Table2;

  private readonly api = inject(DatabricksApiService);
  private readonly selectionService = inject(SandboxSelectionService);
  private readonly inclusionService = inject(SandboxInclusionService);
  private readonly sandboxApi = inject(SandboxApiService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly catalogs = signal<CatalogInfo[]>([]);
  readonly expanded = signal<Set<string>>(new Set());
  readonly saving = signal(false);
  readonly sandboxName = signal('');
  readonly saved = output<void>();
  /** When set, the browser opens in edit mode with this sandbox's data. */
  readonly initial = input<Sandbox | null>(null);

  readonly includedCount = computed(() => this.inclusionService.included().size);

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
    this.api.getInventory().subscribe({
      next: (res) => {
        if (res.ok) {
          this.catalogs.set(res.catalogs ?? []);
        } else {
          this.error.set(res.message ?? 'Failed to load the inventory');
        }
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  isExpanded(key: string): boolean {
    return this.expanded().has(key);
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
    // inventory in hand) — spares the backend live Databricks round-trips.
    const included = this.inclusionService.included();
    const entities: { key: string; columns: { name: string; type: string; nullable: boolean }[] }[] = [];
    for (const catalog of this.catalogs()) {
      for (const schema of catalog.schemas) {
        for (const table of schema.tables) {
          const key = `${catalog.name}.${schema.name}.${table.name}`;
          if (included.has(key)) entities.push({ key, columns: table.columns });
        }
      }
    }
    this.sandboxApi
      .createSandbox(name, Array.from(included), entities)
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
