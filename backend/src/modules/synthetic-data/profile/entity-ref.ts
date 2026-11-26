import type { SyntheticDialect } from '../types';

/** One table of a datasource, as (namespace, name). */
export interface EntityRef {
  namespace: string;
  name: string;
}

/**
 * Map an inventory key (api.md 108) to the profiler's (namespace, name).
 * PostgreSQL `database.schema.table` → (schema, table); Databricks
 * `catalog.schema.table` → (`catalog.schema`, table), as the profilers flatten
 * namespaces. Null for a key that cannot name a table, or (PostgreSQL) one
 * naming another database than the connection's `database`.
 */
export function entityRefFromKey(
  kind: SyntheticDialect,
  key: unknown,
  database?: string,
): EntityRef | null {
  if (typeof key !== 'string') return null;
  const parts = key.split('.').map((p) => p.trim());
  if (parts.length < 3 || parts.some((p) => !p)) return null;
  const [catalog, schema, ...table] = parts;
  if (kind === 'postgres' && database && catalog !== database) return null;
  return {
    namespace: kind === 'postgres' ? schema : `${catalog}.${schema}`,
    name: table.join('.'),
  };
}
