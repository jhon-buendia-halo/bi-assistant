import type {
  SampledColumn, SampledRelationship, SyntheticDialect,
} from '../types';

export type SyntheticValue =
  | null | boolean | string                     // string: already-formatted text for text/uuid/numeric
  | { kind: 'number'; text: string }            // decimal text, no exponent
  | { kind: 'date'; text: string }              // YYYY-MM-DD
  | { kind: 'timestamp'; text: string; zoned: boolean }  // YYYY-MM-DD HH:MM:SS[.ffffff][+00:00]
  | { kind: 'neutral' };                        // the dialect's neutral literal for the column type
export interface WriterColumn { name: string; ddlType: string; notNull: boolean; source: SampledColumn }
export interface WriterTable  { key: string; targetName: string; columns: WriterColumn[]; primaryKey: string[]; uniqueKeys: string[][] }
export interface DialectWriter {
  readonly dialect: SyntheticDialect;
  quoteIdent(name: string): string;
  qualify(targetSchema: string, table: string): string;
  /** Declared type → DDL type, with a note when replaced. */
  ddlType(column: SampledColumn): { ddl: string; note?: string };
  literal(value: SyntheticValue, column: WriterColumn): string;
  begin(): string[]; end(): string[];          // PostgreSQL BEGIN/COMMIT; Databricks []
  createSchema(targetSchema: string): string;
  createTable(targetSchema: string, table: WriterTable, includeConstraints: boolean): string;
  insert(targetSchema: string, table: WriterTable, rows: SyntheticValue[][]): string;  // ≤ 500 rows
  addForeignKey(targetSchema: string, rel: SampledRelationship, from: WriterTable, to: WriterTable): string;
  headerNotes(): string[];                     // dialect caveats for the header
}
