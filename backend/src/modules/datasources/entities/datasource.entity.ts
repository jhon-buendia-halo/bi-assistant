export type DatasourceKind = 'databricks' | 'postgres' | 'rest' | 'file';

export const DATASOURCE_KINDS: DatasourceKind[] = [
  'databricks',
  'postgres',
  'rest',
  'file',
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

/** One endpoint proposed by reading an OpenAPI / Swagger spec. */
export interface DiscoveredEndpoint {
  endpoint: RestEndpointDef;
  method: string;
  summary?: string;
  /** True when the response schema is a list of rows. */
  listResponse: boolean;
  /** Number of row fields the spec declares, when known. */
  fields?: number;
}

export interface RestDiscovery {
  specUrl: string;
  title?: string;
  /** Server URL the endpoint paths are relative to. */
  baseUrl: string;
  endpoints: DiscoveredEndpoint[];
  skipped: { path: string; reason: string }[];
}

/**
 * The `file` kind (ADR-0052, plan m1-31 3): uploaded `.xlsx` and `.csv`
 * files imported into the datasource's own DuckDB database. No secrets.
 */
export interface FileDatasourceConfig {
  files: SourceFile[];
}

export interface SourceFile {
  /** uuid, stable across Replace file. */
  id: string;
  /** Original file name, e.g. "sales_2026.xlsx". */
  name: string;
  format: 'xlsx' | 'csv';
  sizeBytes: number;
  sha256: string;
  /** ISO. */
  uploadedAt: string;
  /** Entity schema segment, e.g. "sales_2026" (plan m1-31 4). */
  schema: string;
  sheets: SheetImport[];
  /** Set only while the file is not saved yet. */
  uploadId?: string;
}

export interface SheetImport {
  /** Workbook sheet name; for a CSV, the file name without extension. */
  sheet: string;
  /** Entity table segment, e.g. "region" (plan m1-31 4). */
  table: string;
  include: boolean;
  /** 1-based row of the column names. */
  headerRow: number;
  /** A1 range of header + data, e.g. "A3:H12482". */
  range: string;
  excludeLastRow: boolean;
  allText: boolean;
  /** Data rows imported, set by the import. */
  rowCount?: number;
  /** Set by the import. */
  columns?: { name: string; type: string }[];
  warnings?: SheetWarning[];
}

export type SheetWarning =
  /** "Last row looks like a total". */
  | { code: 'total-row'; row: number }
  /** "No table found" (sheet skipped). */
  | { code: 'no-table' }
  /** "Header found on row <n>". */
  | { code: 'header-guessed'; row: number }
  /** Renamed "<name>_2". */
  | { code: 'duplicate-columns'; names: string[] };

export interface SheetPreview {
  sheet: string;
  headerRow: number;
  range: string;
  /** Rows in range below the header. */
  totalRows: number;
  columns: { letter: string; name: string; type: string }[];
  /** First 7 + last 2 sheet rows. */
  rows: { row: number; cells: (string | number | boolean | null)[] }[];
  warnings: SheetWarning[];
}

export type DatasourceConfig =
  DatabricksConfig | PostgresConfig | RestApiConfig | FileDatasourceConfig;

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
  /**
   * `runReadOnlySql` only: the rows the statement produced before the row
   * cap sliced them (the query inspector's facts, plan m1-25 1.25.1).
   */
  totalRows?: number;
}
