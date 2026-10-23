import type { EvalDialect } from '../eval-set-files';
import { fail, PASS } from './check';
import type { DeterministicCheck } from './check';
import { withoutLiterals } from './sql-text';
import { quote, writtenStatements } from './turn';

/** How the reason names each dialect. */
export const DIALECT_NAMES: Readonly<Record<EvalDialect, string>> = {
  postgres: 'PostgreSQL',
  sqlite: 'SQLite (the REST connector)',
  databricks: 'Databricks SQL',
};

/**
 * Constructs each dialect cannot run (agents-evals R118), matched on the
 * statement with comments removed and string literals emptied. The SQLite
 * list is pinned against the engine the REST connector bundles
 * (`better-sqlite3`) by `dialect.spec.ts`: each one fails to prepare there.
 */
export const DIALECT_RULES: Readonly<
  Record<EvalDialect, readonly [RegExp, string][]>
> = {
  sqlite: [
    [/::/, '"::" casts'],
    [/\bILIKE\b/i, 'ILIKE'],
    [/\bSIMILAR\s+TO\b/i, 'SIMILAR TO'],
    [/\bDISTINCT\s+ON\b/i, 'DISTINCT ON'],
    [/\bQUALIFY\b/i, 'QUALIFY'],
    [/\bINTERVAL\s*''/i, "INTERVAL '…' literals"],
    [/\bEXTRACT\s*\(/i, 'EXTRACT'],
    [/\bDATE_TRUNC\s*\(/i, 'DATE_TRUNC'],
    [/\bTO_CHAR\s*\(/i, 'TO_CHAR'],
    [/\bNOW\s*\(/i, 'NOW()'],
    [/\bGREATEST\s*\(/i, 'GREATEST'],
    [/\bLEAST\s*\(/i, 'LEAST'],
  ],
  postgres: [
    [/`/, 'backtick-quoted names'],
    [/\bQUALIFY\b/i, 'QUALIFY'],
    [/\bIFNULL\s*\(/i, 'IFNULL'],
    [/\bSTRFTIME\s*\(/i, 'STRFTIME'],
    [/\bGROUP_CONCAT\s*\(/i, 'GROUP_CONCAT'],
    [/\bDATEDIFF\s*\(/i, 'DATEDIFF'],
  ],
  databricks: [
    [/"[^"]*"\s*\.|\.\s*"[^"]*"/, 'double-quoted names (read as strings)'],
    [/\bDISTINCT\s+ON\b/i, 'DISTINCT ON'],
    [/\bSTRFTIME\s*\(/i, 'STRFTIME'],
  ],
};

/** The first construct `sql` uses that `dialect` cannot run. */
export function dialectProblem(
  sql: string,
  dialect: EvalDialect,
): string | undefined {
  const scanned = withoutLiterals(sql);
  for (const [pattern, what] of DIALECT_RULES[dialect]) {
    if (pattern.test(scanned)) return what;
  }
  return undefined;
}

/**
 * `dialect` (agents-evals R118, criterion I6): every statement the assistant
 * wrote fits the set's dialect, so the same question is held to SQLite on
 * the REST set and to PostgreSQL on the World Cup set.
 */
export const dialect: DeterministicCheck = {
  type: 'dialect',
  id: 'check-dialect',
  name: 'Dialect Check',
  criterion: 'I6',
  args: { required: [], optional: [] },
  describe: (_args, context) =>
    `Checks that the SQL fits the ${DIALECT_NAMES[context.dialect]} dialect`,
  evaluate: (turn, _args, context) => {
    for (const sql of writtenStatements(turn)) {
      const problem = dialectProblem(sql, context.dialect);
      if (problem) {
        return fail(
          `the SQL uses ${problem}, which ${DIALECT_NAMES[context.dialect]} does not support: "${quote(sql)}"`,
        );
      }
    }
    return PASS;
  },
};
