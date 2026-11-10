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
  /**
   * BA-323: per text column, `COUNT(DISTINCT lower(trim(col)))`, folded into
   * the same statement when `ColumnStatsExtras.normalizedDistinct` asks.
   */
  normalizedDistinctCounts?: Record<string, number>;
  /**
   * BA-323: per column, rows whose non-null value does not match its format
   * pattern (same predicate as `invalidFormatCount`), folded likewise.
   */
  invalidFormatCounts?: Record<string, number>;
}

/** BA-323: extra per-column aggregates folded into the `columnStats` statement. */
export interface ColumnStatsExtras {
  /** Text columns to count normalized (lower-cased, trimmed) distinct values for. */
  normalizedDistinct?: string[];
  /** Columns to count invalid-format rows for, with the dialect pattern. */
  formats?: { column: string; pattern: string }[];
}

/**
 * BA-323 / ADR-0033: a profiler bound to pooled sessions for one assessment.
 * Same methods as `ProfilingConnector` (the `config` argument is still passed
 * and must equal the one the scope was opened with); every statement reuses
 * one of the scope's sessions instead of opening its own.
 */
export type ScopedProfiler<TConfig> = Omit<
  ProfilingConnector<TConfig>,
  'withSessions'
>;

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
  /**
   * BA-323 / ADR-0033: run `fn` with a profiler whose statements reuse at most
   * `size` sessions (Databricks: client + session; PostgreSQL: client + one
   * read-only transaction each), all closed when `fn` settles. When `signal`
   * aborts, in-flight statements are cancelled (best effort) and further
   * statements reject with an AbortError. The 15 s per-statement timeout and
   * the read-only guard are unchanged; a statement that times out is
   * cancelled on the server, not left running.
   */
  withSessions<T>(
    config: TConfig,
    size: number,
    signal: AbortSignal | undefined,
    fn: (scoped: ScopedProfiler<TConfig>) => Promise<T>,
  ): Promise<T>;
  /** BA-323: `SELECT COUNT(*)` (cheap from table metadata on Delta). */
  rowCount(config: TConfig, schema: string, table: string): Promise<number>;
  /** Tables in scope (all when `schema` is omitted). */
  tables(config: TConfig, schema?: string): Promise<ProfiledTable[]>;
  columnStats(
    config: TConfig,
    schema: string,
    table: string,
    nullableColumns: string[],
    allColumns: string[],
    comparableColumns: string[],
    extras?: ColumnStatsExtras,
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
