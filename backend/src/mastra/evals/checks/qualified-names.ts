import type { EvalDialect } from '../eval-sets';
import { fail, PASS } from './check';
import type { DeterministicCheck } from './check';
import { tableReferences } from './sql-text';
import { quote, writtenStatements } from './turn';

/**
 * Name parts a table reference needs per dialect (agents-evals R75). On
 * PostgreSQL the catalog is the database, which the prompt lets the
 * assistant leave out; the REST connector only resolves `api.<schema>.<table>`.
 */
export const QUALIFIED_PARTS: Readonly<
  Record<EvalDialect, { parts: number; shape: string }>
> = {
  postgres: { parts: 2, shape: 'schema.table' },
  sqlite: { parts: 3, shape: 'api.schema.table' },
  databricks: { parts: 3, shape: 'catalog.schema.table' },
};

/**
 * `qualifiedNames` (agents-evals R75, criterion I6): "Always use
 * fully-qualified catalog.schema.table names", read on every statement the
 * assistant wrote.
 */
export const qualifiedNames: DeterministicCheck = {
  type: 'qualifiedNames',
  id: 'check-qualified-names',
  name: 'Qualified Names Check',
  criterion: 'I6',
  args: { required: [], optional: [] },
  describe: (_args, context) =>
    `Checks that every table in the SQL is fully qualified (${QUALIFIED_PARTS[context.dialect].shape})`,
  evaluate: (turn, _args, context) => {
    const { parts, shape } = QUALIFIED_PARTS[context.dialect];
    for (const sql of writtenStatements(turn)) {
      const short = tableReferences(sql).find(
        (reference) => reference.length < parts,
      );
      if (short) {
        return fail(
          `"${short.join('.')}" is not fully qualified (${shape}): "${quote(sql)}"`,
        );
      }
    }
    return PASS;
  },
};
