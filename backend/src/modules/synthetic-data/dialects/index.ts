import type { SyntheticDialect } from '../types';
import { databricksWriter } from './databricks.writer';
import { postgresWriter } from './postgres.writer';
import type { DialectWriter } from './writer';

export type {
  DialectWriter,
  SyntheticValue,
  WriterColumn,
  WriterTable,
} from './writer';
export { smokeCheckStatements } from './smoke';

/** The writer of a datasource's dialect (plan 2.5). Header notes come without a `-- ` prefix. */
export function writerFor(dialect: SyntheticDialect): DialectWriter {
  return dialect === 'postgres' ? postgresWriter : databricksWriter;
}
