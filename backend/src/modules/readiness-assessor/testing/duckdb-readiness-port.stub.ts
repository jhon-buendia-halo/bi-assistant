// A fake ReadinessPort over an in-memory DuckDB, for the engine's tests: the
// engine's statements run for real (DuckDB reads the Postgres quoting), so a
// non-portable aggregate fails the test. Excluded from the build (*.stub.ts).
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { plainRows } from '../../datasources/connectors/duckdb';
import type { DatasetSnapshot } from '../../../mastra/tool-services';
import type { ReadinessAssessment, ReadinessPort } from '../readiness.types';
import { tableRef } from '../sql';

export interface DuckPortOptions {
  /** Entities (`datasetKey`) whose SQL and samples fail like a permission error. */
  denied?: string[];
  /** A shared baseline store, to chain assessments. */
  store?: ReadinessAssessment[];
}

export interface DuckPort extends ReadinessPort {
  statements: string[];
  saved: ReadinessAssessment[];
  close(): void;
}

export async function duckPort(
  setup: string[],
  datasets: DatasetSnapshot[],
  options: DuckPortOptions = {},
): Promise<DuckPort> {
  const instance = await DuckDBInstance.create(':memory:', {
    autoinstall_known_extensions: 'false',
    autoload_known_extensions: 'false',
  });
  const connection: DuckDBConnection = await instance.connect();
  for (const sql of setup) await connection.run(sql);
  const statements: string[] = [];
  const saved = options.store ?? [];
  const denied = (text: string) =>
    (options.denied ?? []).some((key) =>
      text.includes(tableRef({ kind: 'postgres', datasetKey: key })),
    );
  const query = async (sql: string) => {
    statements.push(sql);
    if (denied(sql)) throw new Error('permission denied for table');
    const reader = await connection.runAndReadAll(sql);
    const columns = reader.deduplicatedColumnNames();
    return { columns, rows: plainRows(columns, reader.getRowsJS()) };
  };
  return {
    statements,
    saved,
    datasets: (names) =>
      Promise.resolve(datasets.filter((d) => names.includes(d.name))),
    runSql: (_id, sql) => query(sql),
    sampleRows: (_id, entity, limit) => {
      if ((options.denied ?? []).includes(entity)) {
        return Promise.reject(new Error('permission denied for table'));
      }
      const ref = tableRef({ kind: 'postgres', datasetKey: entity });
      return query(`SELECT * FROM ${ref} ORDER BY 1 LIMIT ${limit}`);
    },
    previous: (key) =>
      Promise.resolve(
        [...saved].reverse().find((a) => a.useCaseKey === key) ?? null,
      ),
    save: (a) => {
      saved.push(a);
      return Promise.resolve();
    },
    close: () => {
      connection.closeSync();
      instance.closeSync();
    },
  };
}
