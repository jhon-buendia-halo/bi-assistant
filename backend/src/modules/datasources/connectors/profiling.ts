// Profiling capability for data readiness (BA-251, ADR in architecture.md).
// Aggregate-only statistics, separate from the user read-only SQL path.
// Ported from data-readiness-agent's Connector stats methods; `config` replaces
// the reference's connection string.

/** Foreign-key edge (declared, or an inferred candidate to verify). */
export interface FkEdge {
  schema: string;
  table: string;
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
}

/** Declared key constraint. */
export interface KeyConstraint {
  schema: string;
  table: string;
  kind: 'primary' | 'unique';
  columns: string[];
}

/** One aggregate pass over a table. Missing columns are simply absent. */
export interface ColumnStats {
  totalRows: number;
  nullCounts: Record<string, number>;
  distinctCounts: Record<string, number>;
  minValues: Record<string, string>;
  maxValues: Record<string, string>;
}

export interface TablePrivilege {
  schema: string;
  table: string;
  selectable: boolean;
}

/** A table as the profiler sees it (from the cached inventory). */
export interface ProfiledTable {
  /** Postgres: schema. Databricks: `catalog.schema` (flattened). */
  schema: string;
  table: string;
  columns: { name: string; type: string; nullable: boolean }[];
  /** ISO time, when the platform reports it (Databricks `last_altered`). */
  lastModifiedAt?: string;
}

export interface ProfilingConnector<TConfig = unknown> {
  readonly kind: 'postgres' | 'databricks';
  /** Tables in scope (all when `schema` is omitted). */
  tables(config: TConfig, schema?: string): Promise<ProfiledTable[]>;
  columnStats(
    config: TConfig,
    schema: string,
    table: string,
    nullableColumns: string[],
    allColumns: string[],
    comparableColumns: string[],
  ): Promise<ColumnStats>;
  keys(config: TConfig): Promise<KeyConstraint[]>;
  foreignKeys(config: TConfig): Promise<FkEdge[]>;
  duplicateCount(
    config: TConfig,
    schema: string,
    table: string,
    fields: string[],
  ): Promise<number>;
  orphanCount(config: TConfig, edge: FkEdge): Promise<number>;
  invalidFormatCount(
    config: TConfig,
    schema: string,
    table: string,
    column: string,
    pattern: string,
  ): Promise<number>;
  normalizedDistinctCount(
    config: TConfig,
    schema: string,
    table: string,
    column: string,
  ): Promise<number>;
  tablePrivileges(config: TConfig): Promise<TablePrivilege[]>;
}
