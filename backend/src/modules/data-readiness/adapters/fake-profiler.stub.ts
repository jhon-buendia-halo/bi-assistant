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
  /** `schema.table` → `rowCount` result (default: that table's stats total). */
  rowCounts?: Record<string, number>;
  /** `schema.table`s whose `columnStats` rejects with a statement timeout. */
  timeouts?: string[];
  /** `schema.table`s whose `columnStats` rejects only when extras are asked. */
  failingFolded?: string[];
  /** `schema.table`s whose second (normalized-distinct) statement rejects. */
  failingNormalized?: string[];
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
  const fake: FakeProfiler<C> = {
    kind,
    calls,
    withSessions: (_c, size, _signal, fn) => {
      calls.push({ method: 'withSessions', args: [size] });
      return fn(fake);
    },
    rowCount: (_c, schema, table) => {
      const id = `${schema}.${table}`;
      return run('rowCount', id, [schema, table], 0).then(() =>
        need(src.rowCounts?.[id] ?? src.stats?.[id]?.totalRows, `rows ${id}`),
      );
    },
    tables: (_c, schema) =>
      run('tables', '', [schema], src.tables).then((t) =>
        schema ? t.filter((x) => x.schema === schema) : t,
      ),
    columnStats: (_c, schema, table, nullable, all, comparable, extras) => {
      const id = `${schema}.${table}`;
      const args: unknown[] = [schema, table, nullable, all, comparable];
      if (extras) args.push(extras);
      if (src.timeouts?.includes(id)) {
        calls.push({ method: 'columnStats', args });
        return Promise.reject(
          new Error('canceling statement due to statement timeout'),
        );
      }
      if (extras?.normalizedDistinct && src.failingNormalized?.includes(id)) {
        calls.push({ method: 'columnStats', args });
        return Promise.reject(new Error('columnStats failed (normalized)'));
      }
      if (extras && src.failingFolded?.includes(id)) {
        calls.push({ method: 'columnStats', args });
        return Promise.reject(new Error('columnStats failed (folded)'));
      }
      return run('columnStats', id, args, src.stats?.[id]).then((base) => {
        const s = need(base, `stats ${id}`);
        if (!extras) return s;
        const normalized: Record<string, number> = {};
        for (const c of extras.normalizedDistinct ?? []) {
          const v = src.normalized?.[`${id}.${c}`];
          if (v !== undefined) normalized[c] = v;
        }
        const invalid: Record<string, number> = {};
        for (const f of extras.formats ?? []) {
          const v = src.invalid?.[`${id}.${f.column}`];
          if (v !== undefined) invalid[f.column] = v;
        }
        return {
          ...s,
          normalizedDistinctCounts: normalized,
          invalidFormatCounts: invalid,
        };
      });
    },
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
  return fake;
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
