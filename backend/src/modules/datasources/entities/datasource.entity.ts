export type DatasourceKind = 'databricks' | 'postgres' | 'rest';

export const DATASOURCE_KINDS: DatasourceKind[] = [
  'databricks',
  'postgres',
  'rest',
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

export type DatasourceConfig =
  DatabricksConfig | PostgresConfig | RestApiConfig;

/** A saved connection to a data platform the datasets can draw from. */
export interface Datasource {
  id: string;
  name: string;
  kind: DatasourceKind;
  config: DatasourceConfig;
  createdAt?: string;
  updatedAt?: string;
}

/** API view — secrets masked. */
export interface DatasourceView {
  id: string;
  name: string;
  kind: DatasourceKind;
  /** Human summary of where it points (host / warehouse / database). */
  summary: string;
  config: DatasourceConfig;
  createdAt?: string;
  updatedAt?: string;
}

/** Shared inventory shape: every kind is normalised to catalog → schema → table. */
export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  /**
   * Whether the credentials can actually query this object (not browse-only).
   * `undefined` = access unknown (probe not run / soft-failed) → treated as
   * accessible. Only an explicit `false` means no access (renders greyed).
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

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}
