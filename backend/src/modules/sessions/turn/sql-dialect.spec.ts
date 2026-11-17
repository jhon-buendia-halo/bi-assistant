import { sqlDialectOf } from './sql-dialect';
import {
  SQL_FIXER_PROMPT,
  SQL_VERIFIER_PROMPT,
} from '../../../mastra/agents/system-prompts';
import { runReadOnlySqlTool } from '../../../mastra/tools/dataset.tools';
import type { DatasetSnapshot } from '../../../mastra/tool-services';

const of = (kind?: string) =>
  [{ datasourceKind: kind }] as unknown as DatasetSnapshot[];

describe('sqlDialectOf', () => {
  it('names duckdb for a file dataset', () => {
    expect(sqlDialectOf(of('file'))).toBe('duckdb');
  });
  it('names sqlite for rest and keeps postgres and databricks', () => {
    expect(sqlDialectOf(of('rest'))).toBe('sqlite');
    expect(sqlDialectOf(of('postgres'))).toBe('postgres');
    expect(sqlDialectOf(of('databricks'))).toBe('databricks');
  });
  it('falls back to databricks for a missing kind and does not pass an unknown kind through', () => {
    expect(sqlDialectOf(of(undefined))).toBe('databricks');
    expect(sqlDialectOf(of('mystery'))).not.toBe('mystery');
  });
});

describe('the dialect in the SQL agents', () => {
  it('the fixer and verifier prompts mention DuckDB', () => {
    expect(SQL_FIXER_PROMPT).toMatch(/duckdb/i);
    expect(SQL_VERIFIER_PROMPT).toMatch(/duckdb/i);
  });
  it('run_readonly_sql keeps its wording: the DuckDB hint is in Block 1', () => {
    expect(runReadOnlySqlTool.description).not.toMatch(/DuckDB/);
  });
});
