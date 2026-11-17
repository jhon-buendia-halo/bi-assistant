import type { DatasetSnapshot } from '../../../mastra/tool-services';

/** SQL dialect for prompts: REST datasources are queried as SQLite, Excel / CSV files as DuckDB. */
const DIALECT_OF_KIND: Record<string, string> = {
  databricks: 'databricks',
  postgres: 'postgres',
  rest: 'sqlite',
  file: 'duckdb',
};

export function sqlDialectOf(datasets: DatasetSnapshot[]): string {
  const kind = datasets.find((s) => s.datasourceKind)?.datasourceKind;
  return (kind && DIALECT_OF_KIND[kind]) || 'databricks';
}
