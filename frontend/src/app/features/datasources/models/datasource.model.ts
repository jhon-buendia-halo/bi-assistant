export type DatasourceKind = 'databricks' | 'postgres';

export const DATASOURCE_KINDS: { value: DatasourceKind; label: string }[] = [
  { value: 'databricks', label: 'Databricks' },
  { value: 'postgres', label: 'PostgreSQL' },
];

export interface DatabricksConfig {
  host: string;
  token: string;
  warehouseId: string;
}

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export type DatasourceConfig = DatabricksConfig | PostgresConfig;

export interface Datasource {
  id: string;
  name: string;
  kind: DatasourceKind;
  /** One-line description of where it points (no secrets). */
  summary: string;
  /** Secrets arrive masked (••••••••); send them back unchanged to keep them. */
  config: DatasourceConfig;
  createdAt?: string;
  updatedAt?: string;
}

export interface DatasourceActionResult {
  ok: boolean;
  message: string;
  datasource?: Datasource;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  /**
   * Whether the credentials can query this object. Only an explicit `false`
   * means no access (renders greyed); `undefined` = accessible.
   */
  selectable?: boolean;
}

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
  /** See {@link TableInfo.selectable}. */
  selectable?: boolean;
}

export interface CatalogInfo {
  name: string;
  schemas: SchemaInfo[];
  /** See {@link TableInfo.selectable}. */
  selectable?: boolean;
}

export interface InventoryResult {
  ok: boolean;
  message?: string;
  catalogs?: CatalogInfo[];
  /** ISO timestamp of the live fetch this inventory came from. */
  fetchedAt?: string;
  /** True when the backend served its stored snapshot instead of a live walk. */
  cached?: boolean;
}

export function kindLabel(kind: DatasourceKind | undefined): string {
  return DATASOURCE_KINDS.find((k) => k.value === kind)?.label ?? 'Unknown';
}
