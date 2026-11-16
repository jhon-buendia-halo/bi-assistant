import { getDatasetToolServices } from '../tool-services';
import type { EvalCustomCheck } from './assistant.evals';
import type { EvalRunDetails } from './eval-details';
import { numbersInText } from './insights-analyst-eval-checks';
import { RESULT_SET_ROW_LIMIT } from './result-set-check';

/**
 * The live-SQL truth check (agents.md 8.1, `sqlTruthCheck`): a custom check
 * that runs a trusted reference SQL read-only on the case's datasource at
 * eval time (the path `expectedSql` takes: `runReadOnlySql` over the run's
 * datasets, at most 500 rows) and hands its rows to a comparator, which
 * answers a failure reason or `undefined`. The truth is read from the
 * fixture as it is, never hard-coded, so a figure the answer or a JSON
 * field states is checked against the data itself.
 *
 * Ready comparators: `answerHasNumber`, `jsonFieldEquals`,
 * `answerMentionsAll`. Any other is a function of the same shape.
 */

/** What a comparator reads besides the rows. */
export interface SqlTruthCompareInput {
  /** The scored answer text. */
  answer: string;
  /** The answer parsed as JSON (isolated-call targets), else undefined. */
  parsed: unknown;
  /** The run's details (`details.steps`, `details.report`, …). */
  details: EvalRunDetails;
}

export type SqlTruthRows = Record<string, unknown>[];

/** A failure reason, or `undefined` when the answer agrees with the rows. */
export type SqlTruthComparator = (
  rows: SqlTruthRows,
  input: SqlTruthCompareInput,
) => string | undefined;

export interface SqlTruthSpec {
  /** Unique within its case. */
  id: string;
  description: string;
  /** Trusted read-only SQL over the fixture, schema-qualified. */
  sql: string;
  compare: SqlTruthComparator;
}

/** The answer as JSON (a markdown fence tolerated), else undefined. */
function parsedJson(answer: string): unknown {
  const trimmed = answer
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function sqlTruthCheck(spec: SqlTruthSpec): EvalCustomCheck {
  return {
    id: spec.id,
    description: spec.description,
    run: async ({ answer, datasets, details }) => {
      const services = getDatasetToolServices();
      const snapshots = await services.getDatasets(datasets);
      const datasourceId = snapshots.find(
        (snapshot) => snapshot.datasourceId,
      )?.datasourceId;
      if (!datasourceId) {
        return 'could not resolve a datasource for the reference SQL';
      }
      let rows: SqlTruthRows;
      try {
        const result = await services.runReadOnlySql(
          datasourceId,
          spec.sql,
          RESULT_SET_ROW_LIMIT,
          datasets,
        );
        if (result.truncated) {
          return 'the reference SQL result is truncated; the truth cannot be read';
        }
        rows = result.rows;
      } catch (error) {
        return `the reference SQL failed to run — ${error instanceof Error ? error.message : String(error)}`;
      }
      return spec.compare(rows, {
        answer,
        parsed: parsedJson(answer),
        details: details ?? {},
      });
    },
  };
}

/**
 * Which value of the rows a comparator compares: a column of the first
 * row, a function of all rows, or (absent) the first row's first column.
 */
export type SqlTruthValue = string | ((rows: SqlTruthRows) => unknown);

function valueOf(
  rows: SqlTruthRows,
  pick: SqlTruthValue | undefined,
): unknown {
  if (typeof pick === 'function') return pick(rows);
  const first = rows[0];
  if (!first) return undefined;
  return pick === undefined ? Object.values(first)[0] : first[pick];
}

function labelOf(rows: SqlTruthRows, pick: SqlTruthValue | undefined): string {
  if (typeof pick === 'function') return 'the picked value';
  return pick ?? Object.keys(rows[0] ?? {})[0] ?? 'the first column';
}

/** A number from a SQL cell (numeric strings and bigints included). */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Lower-case, accents removed, trimmed. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * The answer text states the SQL value, within `tolerance` (absolute;
 * 0 = exact). Numbers are read as `numbersInText` reads them: thousands
 * separators dropped (`1,200` = 1200), the words zero to twelve; a
 * percentage is its number (`12.3%` = 12.3).
 */
export function answerHasNumber(
  value?: SqlTruthValue,
  options: { tolerance?: number } = {},
): SqlTruthComparator {
  const tolerance = options.tolerance ?? 0;
  return (rows, { answer }) => {
    const label = labelOf(rows, value);
    const expected = numberOf(valueOf(rows, value));
    if (expected === undefined) {
      return `the reference SQL gave no number for ${label}`;
    }
    const numbers = numbersInText(answer);
    if (numbers.some((n) => Math.abs(n - expected) <= tolerance + 1e-9)) {
      return undefined;
    }
    return `expected the answer to state ${expected} (${label} from the reference SQL); the numbers in it are ${[...new Set(numbers)].slice(0, 12).join(', ') || 'none'}`;
  };
}

/** The value at a dot path (`a.b.0.c`) of a parsed JSON answer. */
function atPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * A field of the JSON answer (a dot path, array indexes as numbers) equals
 * the SQL value: numbers within `tolerance`, anything else as text without
 * case, accents or surrounding spaces.
 */
export function jsonFieldEquals(
  path: string,
  value?: SqlTruthValue,
  options: { tolerance?: number } = {},
): SqlTruthComparator {
  const tolerance = options.tolerance ?? 0;
  return (rows, { parsed }) => {
    if (parsed === undefined) return `the answer is not JSON with ${path}`;
    const actual = atPath(parsed, path);
    const expected = valueOf(rows, value);
    const expectedNumber = numberOf(expected);
    const actualNumber = numberOf(actual);
    const same =
      expectedNumber !== undefined && actualNumber !== undefined
        ? Math.abs(actualNumber - expectedNumber) <= tolerance + 1e-9
        : fold(String(actual ?? '')) === fold(String(expected ?? ''));
    return same
      ? undefined
      : `${path} is ${JSON.stringify(actual)}; the reference SQL gives ${JSON.stringify(expected)}`;
  };
}

/**
 * The answer text mentions every value of a column across all rows
 * (case and accents ignored): every tied name, every listed category.
 */
export function answerMentionsAll(column: string): SqlTruthComparator {
  return (rows, { answer }) => {
    if (rows.length === 0) return 'the reference SQL returned no row';
    const text = fold(answer);
    const missing = rows
      .map((row) => String(row[column] ?? ''))
      .filter((wanted) => !text.includes(fold(wanted)));
    return missing.length
      ? `the answer does not mention ${missing.join(', ')} (${column} from the reference SQL)`
      : undefined;
  };
}
