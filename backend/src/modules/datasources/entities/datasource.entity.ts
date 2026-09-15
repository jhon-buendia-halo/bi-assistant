export type DatasourceKind = 'databricks' | 'postgres';

export const DATASOURCE_KINDS: DatasourceKind[] = ['databricks', 'postgres'];

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

/** A saved connection to a data platform the sandboxes can draw from. */
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
}

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
}

export interface CatalogInfo {
  name: string;
  schemas: SchemaInfo[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}
