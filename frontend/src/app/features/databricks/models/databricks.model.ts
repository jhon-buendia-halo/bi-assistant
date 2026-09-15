export interface DatabricksConnectionConfig {
  host: string;
  token: string;
  warehouseId: string;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

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

export interface InventoryResult {
  ok: boolean;
  message?: string;
  catalogs?: CatalogInfo[];
}
