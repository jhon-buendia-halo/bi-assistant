// Test-only in-memory ProfilingConnector (BA-258). Not imported by production code.
import type {
  ColumnStats,
  FkEdge,
  KeyConstraint,
  ProfiledTable,
  ProfilingConnector,
  TablePrivilege,
} from '../../datasources/connectors/profiling';

export interface FakeSource {
  tables: ProfiledTable[];
  stats?: Record<string, ColumnStats>;
  keys?: KeyConstraint[];
  foreignKeys?: FkEdge[];
  privileges?: TablePrivilege[];
  /** `schema.table|col,col` → duplicate count */
  duplicates?: Record<string, number>;
  /** `schema.table.column` → orphan count */
  orphans?: Record<string, number>;
  /** `schema.table.column` → invalid count */
  invalid?: Record<string, number>;
  /** `schema.table.column` → normalized distinct count */
  normalized?: Record<string, number>;
  /** Probe names (e.g. `columnStats:s.t`, `keys`) that reject. */
  failing?: string[];
}

export type FakeProfiler<C> = ProfilingConnector<C> & {
  calls: { method: string; args: unknown[] }[];
};

export function fakeProfiler<C>(
  kind: 'postgres' | 'databricks',
  src: FakeSource,
): FakeProfiler<C> {
  const calls: { method: string; args: unknown[] }[] = [];
  const fails = new Set(src.failing ?? []);
  const run = <T>(method: string, id: string, args: unknown[], v: T) => {
    calls.push({ method, args });
    if (fails.has(method) || fails.has(`${method}:${id}`)) {
      return Promise.reject(new Error(`${method} failed`));
    }
    return Promise.resolve(v);
  };
  const need = <T>(v: T | undefined, what: string): T => {
    if (v === undefined) throw new Error(`fake has no ${what}`);
    return v;
  };
  return {
    kind,
    calls,
    tables: (_c, schema) =>
      run('tables', '', [schema], src.tables).then((t) =>
        schema ? t.filter((x) => x.schema === schema) : t,
      ),
    columnStats: (_c, schema, table, nullable, all, comparable) =>
      run(
        'columnStats',
        `${schema}.${table}`,
        [schema, table, nullable, all, comparable],
        src.stats?.[`${schema}.${table}`],
      ).then((s) => need(s, `stats ${schema}.${table}`)),
    keys: () => run('keys', '', [], src.keys ?? []),
    foreignKeys: () => run('foreignKeys', '', [], src.foreignKeys ?? []),
    tablePrivileges: () => run('tablePrivileges', '', [], src.privileges ?? []),
    duplicateCount: (_c, schema, table, fields) => {
      const id = `${schema}.${table}|${fields.join(',')}`;
      return run('duplicateCount', id, [schema, table, fields], 0).then(() =>
        need(src.duplicates?.[id], `duplicates ${id}`),
      );
    },
    orphanCount: (_c, e) => {
      const id = `${e.schema}.${e.table}.${e.column}`;
      return run('orphanCount', id, [e], 0).then(() =>
        need(src.orphans?.[id], `orphans ${id}`),
      );
    },
    invalidFormatCount: (_c, schema, table, column, pattern) => {
      const id = `${schema}.${table}.${column}`;
      return run(
        'invalidFormatCount',
        id,
        [schema, table, column, pattern],
        0,
      ).then(() => need(src.invalid?.[id], `invalid ${id}`));
    },
    normalizedDistinctCount: (_c, schema, table, column) => {
      const id = `${schema}.${table}.${column}`;
      return run(
        'normalizedDistinctCount',
        id,
        [schema, table, column],
        0,
      ).then(() => need(src.normalized?.[id], `normalized ${id}`));
    },
  };
}

export function stats(
  totalRows: number,
  cols: Record<
    string,
    { nulls?: number; distinct?: number; min?: string; max?: string }
  >,
): ColumnStats {
  const s: ColumnStats = {
    totalRows,
    nullCounts: {},
    distinctCounts: {},
    minValues: {},
    maxValues: {},
  };
  for (const [name, c] of Object.entries(cols)) {
    if (c.nulls !== undefined) s.nullCounts[name] = c.nulls;
    if (c.distinct !== undefined) s.distinctCounts[name] = c.distinct;
    if (c.min !== undefined) s.minValues[name] = c.min;
    if (c.max !== undefined) s.maxValues[name] = c.max;
  }
  return s;
}
