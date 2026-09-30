export type DatasourceKind = 'databricks' | 'postgres' | 'rest';

export const DATASOURCE_KINDS: { value: DatasourceKind; label: string }[] = [
  { value: 'databricks', label: 'Databricks' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'rest', label: 'REST API' },
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

export interface RestAuthConfig {
  type: 'none' | 'bearer' | 'api-key-header' | 'basic';
  token?: string;
  headerName?: string;
  username?: string;
  password?: string;
}

export interface RestEndpointDef {
  name: string;
  group?: string;
  path: string;
  rowsPointer?: string;
  pagination?: {
    style: 'none' | 'page' | 'offset' | 'cursor';
    pageParam?: string;
    sizeParam?: string;
    offsetParam?: string;
    cursorParam?: string;
    cursorPointer?: string;
    pageSize?: number;
  };
  maxRows?: number;
}

export interface RestApiConfig {
  baseUrl: string;
  auth: RestAuthConfig;
  headers?: Record<string, string>;
  endpoints: RestEndpointDef[];
}

export interface DiscoveredEndpoint {
  /** Ready-to-use definition: name, path, group?, rowsPointer?, pagination? */
  endpoint: RestEndpointDef;
  /** HTTP method of the operation, e.g. 'GET'. */
  method: string;
  /** Operation summary from the spec. */
  summary?: string;
  /** True when the response schema is a list of rows; false = single object or unknown shape (still importable, not preselected). */
  listResponse: boolean;
  /** Number of row fields declared in the spec, when known. */
  fields?: number;
}

export interface RestDiscoveryResult {
  ok: boolean;
  /** e.g. 'Found 14 endpoints in "World Cup Test API"' or the error. */
  message: string;
  /** Spec URL actually used. */
  specUrl?: string;
  /** Spec info.title. */
  title?: string;
  /** Server URL the endpoint paths are relative to — set when the request had no baseUrl. */
  baseUrl?: string;
  endpoints?: DiscoveredEndpoint[];
  skipped?: { path: string; reason: string }[];
}

export type DatasourceConfig =
  DatabricksConfig | PostgresConfig | RestApiConfig;

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
