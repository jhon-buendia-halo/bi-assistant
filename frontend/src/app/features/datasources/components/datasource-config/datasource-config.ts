import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideAngularModule,
  Database,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-angular';
import { DatasourcesApiService } from '../../services/datasources-api.service';
import {
  DATASOURCE_KINDS,
  DatabricksConfig,
  Datasource,
  DatasourceConfig as DatasourceConnectionConfig,
  DatasourceKind,
  PostgresConfig,
  RestApiConfig,
  RestAuthConfig,
  RestEndpointDef,
  kindLabel,
} from '../../models/datasource.model';
import { ToastService } from '../../../../core/toast/toast.service';

const EMPTY_DATABRICKS: DatabricksConfig = {
  host: '',
  token: '',
  warehouseId: '',
};
const EMPTY_POSTGRES: PostgresConfig = {
  host: '',
  port: 5432,
  database: '',
  user: '',
  password: '',
  ssl: false,
};
const emptyRest = (): RestApiConfig => ({
  baseUrl: '',
  auth: { type: 'none' },
  endpoints: [{ name: '', path: '' }],
});

const AUTH_TYPES: { value: RestAuthConfig['type']; label: string }[] = [
  { value: 'none', label: 'No auth' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'api-key-header', label: 'API key header' },
  { value: 'basic', label: 'Basic' },
];

type PaginationStyle = NonNullable<RestEndpointDef['pagination']>['style'];
const PAGINATION_STYLES: { value: PaginationStyle; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'page', label: 'Page' },
  { value: 'offset', label: 'Offset' },
  { value: 'cursor', label: 'Cursor' },
];

@Component({
  selector: 'app-datasource-config',
  imports: [LucideAngularModule],
  templateUrl: './datasource-config.html',
  styleUrl: './datasource-config.scss',
})
export class DatasourceConfig implements OnInit {
  readonly Database = Database;
  readonly Loader2 = Loader2;
  readonly Pencil = Pencil;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly authTypes = AUTH_TYPES;
  readonly paginationStyles = PAGINATION_STYLES;
  readonly kinds = DATASOURCE_KINDS;
  readonly kindLabel = kindLabel;

  private readonly api = inject(DatasourcesApiService);
  private readonly toast = inject(ToastService);

  readonly datasources = signal<Datasource[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly deleting = signal<string | null>(null);

  /** Form state — null editingId means "new datasource"; formOpen gates visibility. */
  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly name = signal('');
  readonly kind = signal<DatasourceKind>('databricks');
  readonly databricks = signal<DatabricksConfig>({ ...EMPTY_DATABRICKS });
  readonly postgres = signal<PostgresConfig>({ ...EMPTY_POSTGRES });
  readonly rest = signal<RestApiConfig>(emptyRest());
  readonly testing = signal(false);
  readonly saving = signal(false);
  // Only a configuration whose test passed can be saved.
  readonly testedOk = signal(false);

  readonly canTest = computed(() => {
    if (this.testing()) return false;
    if (this.kind() === 'databricks') {
      const c = this.databricks();
      return !!(c.host.trim() && c.token.trim() && c.warehouseId.trim());
    }
    if (this.kind() === 'rest') {
      const c = this.rest();
      return (
        !!c.baseUrl.trim() &&
        c.endpoints.some((e) => e.name.trim() && e.path.trim())
      );
    }
    const c = this.postgres();
    return !!(c.host.trim() && c.database.trim() && c.user.trim());
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.list().subscribe({
      next: (res) => {
        this.datasources.set(res.datasources);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(
          err?.error?.message ?? 'Could not load configured datasources',
        );
        this.loading.set(false);
      },
    });
  }

  startNew(): void {
    this.editingId.set(null);
    this.name.set('');
    this.kind.set('databricks');
    this.databricks.set({ ...EMPTY_DATABRICKS });
    this.postgres.set({ ...EMPTY_POSTGRES });
    this.rest.set(emptyRest());
    this.testedOk.set(false);
    this.formOpen.set(true);
  }

  startEdit(datasource: Datasource): void {
    this.editingId.set(datasource.id);
    this.name.set(datasource.name);
    this.kind.set(datasource.kind);
    this.databricks.set({ ...EMPTY_DATABRICKS });
    this.postgres.set({ ...EMPTY_POSTGRES });
    this.rest.set(emptyRest());
    if (datasource.kind === 'databricks') {
      this.databricks.set({ ...(datasource.config as DatabricksConfig) });
    } else if (datasource.kind === 'postgres') {
      this.postgres.set({ ...(datasource.config as PostgresConfig) });
    } else {
      const c = datasource.config as RestApiConfig;
      this.rest.set({
        ...c,
        auth: { ...c.auth },
        endpoints: c.endpoints.length
          ? c.endpoints.map((e) => ({
              ...e,
              pagination: e.pagination ? { ...e.pagination } : undefined,
            }))
          : [{ name: '', path: '' }],
      });
    }
    this.testedOk.set(false);
    this.formOpen.set(true);
  }

  cancel(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  setKind(kind: DatasourceKind): void {
    this.kind.set(kind);
    this.onFieldChange();
  }

  patchDatabricks(patch: Partial<DatabricksConfig>): void {
    this.databricks.set({ ...this.databricks(), ...patch });
    this.onFieldChange();
  }

  patchPostgres(patch: Partial<PostgresConfig>): void {
    this.postgres.set({ ...this.postgres(), ...patch });
    this.onFieldChange();
  }

  patchRest(patch: Partial<Omit<RestApiConfig, 'auth' | 'endpoints'>>): void {
    this.rest.set({ ...this.rest(), ...patch });
    this.onFieldChange();
  }

  patchRestAuth(patch: Partial<RestAuthConfig>): void {
    const rest = this.rest();
    this.rest.set({ ...rest, auth: { ...rest.auth, ...patch } });
    this.onFieldChange();
  }

  addEndpoint(): void {
    const rest = this.rest();
    this.rest.set({
      ...rest,
      endpoints: [...rest.endpoints, { name: '', path: '' }],
    });
    this.onFieldChange();
  }

  removeEndpoint(index: number): void {
    const rest = this.rest();
    this.rest.set({
      ...rest,
      endpoints: rest.endpoints.filter((_, i) => i !== index),
    });
    this.onFieldChange();
  }

  patchEndpoint(index: number, patch: Partial<RestEndpointDef>): void {
    const rest = this.rest();
    this.rest.set({
      ...rest,
      endpoints: rest.endpoints.map((e, i) =>
        i === index ? { ...e, ...patch } : e,
      ),
    });
    this.onFieldChange();
  }

  patchPagination(
    index: number,
    patch: Partial<NonNullable<RestEndpointDef['pagination']>>,
  ): void {
    const current = this.rest().endpoints[index]?.pagination ?? {
      style: 'none' as const,
    };
    this.patchEndpoint(index, { pagination: { ...current, ...patch } });
  }

  onFieldChange(): void {
    // Editing invalidates the previous successful test.
    this.testedOk.set(false);
  }

  private config(): DatasourceConnectionConfig {
    if (this.kind() === 'databricks') {
      const c = this.databricks();
      return {
        host: c.host.trim(),
        token: c.token.trim(),
        warehouseId: c.warehouseId.trim(),
      };
    }
    if (this.kind() === 'rest') return this.restConfig();
    const c = this.postgres();
    return {
      host: c.host.trim(),
      port: Number(c.port) || 5432,
      database: c.database.trim(),
      user: c.user.trim(),
      password: c.password,
      ssl: !!c.ssl,
    };
  }

  /** Trimmed REST config; empty optionals dropped, secrets sent back unchanged (masked ones stay masked). */
  private restConfig(): RestApiConfig {
    const c = this.rest();
    const opt = (v: string | undefined) => v?.trim() || undefined;
    const a = c.auth;
    const auth: RestAuthConfig = { type: a.type };
    if (a.type === 'bearer') auth.token = a.token ?? '';
    if (a.type === 'api-key-header') {
      auth.headerName = (a.headerName ?? '').trim();
      auth.token = a.token ?? '';
    }
    if (a.type === 'basic') {
      auth.username = (a.username ?? '').trim();
      auth.password = a.password ?? '';
    }
    const endpoints: RestEndpointDef[] = c.endpoints
      .filter((e) => e.name.trim() || e.path.trim())
      .map((e) => {
        const out: RestEndpointDef = {
          name: e.name.trim(),
          path: e.path.trim(),
        };
        const group = opt(e.group);
        if (group) out.group = group;
        const rowsPointer = opt(e.rowsPointer);
        if (rowsPointer) out.rowsPointer = rowsPointer;
        if (e.maxRows) out.maxRows = e.maxRows;
        const p = e.pagination;
        if (p && p.style !== 'none') {
          const pagination: NonNullable<RestEndpointDef['pagination']> = {
            style: p.style,
          };
          const keys =
            p.style === 'page'
              ? (['pageParam', 'sizeParam'] as const)
              : p.style === 'offset'
                ? (['offsetParam', 'sizeParam'] as const)
                : (['cursorParam', 'cursorPointer'] as const);
          for (const k of keys) {
            const v = opt(p[k]);
            if (v) pagination[k] = v;
          }
          if (p.pageSize) pagination.pageSize = p.pageSize;
          out.pagination = pagination;
        }
        return out;
      });
    const config: RestApiConfig = {
      baseUrl: c.baseUrl.trim(),
      auth,
      endpoints,
    };
    if (c.headers && Object.keys(c.headers).length) config.headers = c.headers;
    return config;
  }

  testConnection(): void {
    if (!this.canTest()) return;
    this.testing.set(true);
    this.api
      .testConnection(this.kind(), this.config(), this.editingId() ?? undefined)
      .subscribe({
        next: (res) => {
          if (res.ok) this.toast.success(res.message);
          else this.toast.error(res.message);
          this.testedOk.set(res.ok);
          this.testing.set(false);
        },
        error: (err) => {
          this.toast.error(err?.error?.message ?? 'Backend unreachable');
          this.testedOk.set(false);
          this.testing.set(false);
        },
      });
  }

  save(): void {
    if (!this.testedOk() || this.saving()) return;
    const name = this.name().trim();
    if (!name) {
      this.toast.error('Give the datasource a name first');
      return;
    }
    this.saving.set(true);
    this.api
      .save({
        id: this.editingId() ?? undefined,
        name,
        kind: this.kind(),
        config: this.config(),
      })
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          if (res.ok) {
            this.toast.success(res.message);
            this.formOpen.set(false);
            this.editingId.set(null);
            this.reload();
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

  remove(datasource: Datasource): void {
    if (this.deleting()) return;
    const confirmed = window.confirm(
      `Delete datasource “${datasource.name}”?\n\nDatasets bound to it will stop working until re-saved against another datasource.`,
    );
    if (!confirmed) return;
    this.deleting.set(datasource.id);
    this.api.delete(datasource.id).subscribe({
      next: (res) => {
        this.deleting.set(null);
        if (res.ok) {
          this.toast.success(res.message);
          if (this.editingId() === datasource.id) this.cancel();
          this.reload();
        } else {
          this.toast.error(res.message);
        }
      },
      error: (err) => {
        this.deleting.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }
}
