/**
 * What every deterministic check is (agents-evals R112): a pure function of a
 * recorded turn with a fixed id, name and default criterion, the arguments a
 * question bank file may give it, and a description built from them. The
 * Mastra scorer around it is `check-scorer.ts`; the registry is `index.ts`.
 *
 * Pure module: types and small helpers only.
 */
import type { EvalCriterion, EvalDialect } from '../eval-set-files';
import type { CheckTurn } from './turn';

/**
 * The views of a sample by name, each with the tables and views its
 * definition reads; every name is a last name part, lowercased
 * (`v_match_results` → `matches`, `tournaments`, `venues`, `teams`).
 */
export type ViewTables = ReadonlyMap<string, readonly string[]>;

/** What a check knows besides the turn: bound when the set is built. */
export interface CheckContext {
  /** The set's dialect (R107), for `dialect` and `qualifiedNames`. */
  dialect: EvalDialect;
  /** The case's reference query in that dialect, for `usesEntities`. */
  expectedSql?: string;
  /**
   * The views of the set's sample, for `usesEntities` (R124). A function,
   * called on first use, because they come from the sample's seed SQL,
   * which can be large. Absent or empty: no view is opened.
   */
  views?: () => ViewTables;
}

/** A check's verdict: on failure, the rule that broke and the text at fault. */
export interface CheckVerdict {
  passed: boolean;
  reason?: string;
}

export const PASS: CheckVerdict = { passed: true };

export function fail(reason: string): CheckVerdict {
  return { passed: false, reason };
}

/** Required and optional `args` keys, as the loader checks them. */
export interface CheckArgKeys {
  required: readonly string[];
  optional: readonly string[];
}

export interface DeterministicCheck<A = Record<string, unknown>> {
  /** The `type` a question bank file names. */
  type: string;
  /** The scorer id, shown in reports (`check-names-not-ids`). */
  id: string;
  /** The scorer name (`Names Not Ids Check`). */
  name: string;
  /** The criterion a check of this type measures unless the file says. */
  criterion?: EvalCriterion;
  args: CheckArgKeys;
  /**
   * Problems with the argument values (the loader has checked the keys);
   * a message, or undefined when they are usable.
   */
  validateArgs?: (args: Record<string, unknown>) => string | undefined;
  /**
   * Problems with the check on this case: `usesEntities` without entities
   * needs a reference query naming at least one table.
   */
  validateCase?: (
    args: Record<string, unknown>,
    expectedSql: Partial<Record<EvalDialect, string>> | undefined,
  ) => string | undefined;
  /** The description shown with the check (R15, R37). */
  describe: (args: A, context: CheckContext) => string;
  evaluate: (turn: CheckTurn, args: A, context: CheckContext) => CheckVerdict;
}

/** A non-empty array of non-empty strings, or a message saying what is wrong. */
export function stringListProblem(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string' && item.trim() !== '')
  ) {
    return `args."${key}" must be a non-empty array of non-empty strings`;
  }
  return undefined;
}

/** `pattern` and `flags` as `matches` takes them: no `g` or `y`, must compile. */
export function patternProblem(
  args: Record<string, unknown>,
): string | undefined {
  if (typeof args.pattern !== 'string' || args.pattern === '') {
    return 'args."pattern" must be a non-empty string';
  }
  const flags = args.flags ?? '';
  if (typeof flags !== 'string' || /[gy]/.test(flags)) {
    return 'args."flags" must be a string without "g" or "y" (they make the match stateful)';
  }
  try {
    new RegExp(args.pattern, flags);
  } catch (err) {
    return `args."pattern" is not a valid regular expression: ${err instanceof Error ? err.message : String(err)}`;
  }
  return undefined;
}

export interface PatternArgs {
  pattern: string;
  flags?: string;
}

export function patternRegExp(args: PatternArgs): RegExp {
  return new RegExp(args.pattern, args.flags ?? '');
}

/** A quoted list for descriptions and reasons: `"a", "b"`. */
export function quotedList(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(', ');
}
