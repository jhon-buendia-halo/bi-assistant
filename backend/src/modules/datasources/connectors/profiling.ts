// Profiling capability the Synthetic data profile uses (BA-251, ADR in
// architecture.md): catalogue reads (tables, keys, foreign keys) on pooled
// read-only sessions, separate from the user read-only SQL path. Ported from
// data-readiness-agent's Connector methods; `config` replaces the reference's
// connection string.

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

/**
 * BA-323 / ADR-0033: a profiler bound to pooled sessions for one run.
 * Same methods as `ProfilingConnector` (the `config` argument is still passed
 * and must equal the one the scope was opened with); every statement reuses
 * one of the scope's sessions instead of opening its own.
 */
export type ScopedProfiler<TConfig> = Omit<
  ProfilingConnector<TConfig>,
  'withSessions'
>;

/** A table as the profiler sees it (from the cached inventory). */
export interface ProfiledTable {
  /** Postgres: schema. Databricks: `catalog.schema` (flattened). */
  schema: string;
  table: string;
  columns: { name: string; type: string; nullable: boolean }[];
  /** ISO time, when the platform reports it (Databricks `last_altered`). */
  lastModifiedAt?: string;
}

/**
 * The part of a source one run needs: its namespaces (Databricks
 * `catalog.schema`) and, when known, its exact tables. Databricks reads the
 * inventory, keys and foreign keys of these schemas only, instead of every
 * catalog of the workspace; PostgreSQL ignores it (one database).
 */
export interface ProfilingReach {
  namespaces: string[];
  entities?: { namespace: string; name: string }[];
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
   * cancelled on the server, not left running. `reach`, when given, bounds
   * what the scoped profiler's catalogue reads cover (`ProfilingReach`).
   */
  withSessions<T>(
    config: TConfig,
    size: number,
    signal: AbortSignal | undefined,
    fn: (scoped: ScopedProfiler<TConfig>) => Promise<T>,
    reach?: ProfilingReach,
  ): Promise<T>;
  /** Tables in scope (all when `schema` is omitted). */
  tables(config: TConfig, schema?: string): Promise<ProfiledTable[]>;
  keys(config: TConfig): Promise<KeyConstraint[]>;
  foreignKeys(config: TConfig): Promise<FkEdge[]>;
}
