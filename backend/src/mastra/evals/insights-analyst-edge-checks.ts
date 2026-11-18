import type { EvalCustomCheck, EvalRawToolCall } from './assistant.evals';
import type { EvalRunDetails } from './eval-details';
import {
  markdownTableRows,
  numbersInText,
  successfulSql,
} from './insights-analyst-eval-checks';
import { derivedFigures } from './derived-figures';
import type { SqlTruthComparator } from './sql-truth-check';

/**
 * Checks of the `insights-analyst-edge` set (agents.md 8.1): Michael through
 * the whole Answer a Business Question workflow on Edge Cases. Two families:
 * what an answer over a border case must (not) say, and the consistency of
 * the workflow's steps with each other, read from `details.steps` (Plan's
 * entities against Analyse's SQL, Write answer's headline against Analyse's
 * rows). The truth of a count comes from `sqlTruthCheck`, not from here.
 */

/** Lower-case, accents removed, for matching. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The SQL texts of the run: Analyse's queries from the steps, else its tool calls. */
export function sqlOfRun(
  details: EvalRunDetails | undefined,
  toolCalls: EvalRawToolCall[],
): string[] {
  const queries = (
    details?.steps?.['analyse'] as { queries?: { sql?: unknown }[] } | undefined
  )?.queries;
  const fromSteps = (queries ?? [])
    .map((query) => query.sql)
    .filter((sql): sql is string => typeof sql === 'string');
  if (fromSteps.length > 0) return fromSteps;
  return successfulSql(toolCalls)
    .map((call) => (call.input as { sql?: unknown } | undefined)?.sql)
    .filter((sql): sql is string => typeof sql === 'string');
}

/** A successful query mentions one of the fragments (case-insensitive). */
export function sqlUsesAny(
  fragments: string[],
  label: string,
): EvalCustomCheck {
  return {
    id: 'sql-uses-' + label,
    description: `A query uses ${fragments.join(' or ')}`,
    run: ({ details, toolCalls }) => {
      const sql = sqlOfRun(details, toolCalls).map((s) => s.toLowerCase());
      return fragments.some((f) =>
        sql.some((statement) => statement.includes(f.toLowerCase())),
      )
        ? undefined
        : `no query uses ${fragments.join(' or ')}`;
    },
  };
}

const TIE_WORDS =
  /\b(tie[ds]?|tying|same|equal(?:ly)?|identical|joint|share[ds]?|all five|all 5|five products)\b/i;
const STRICT_ORDER = /\b(first place|1st|second place|2nd|runner[- ]up)\b/i;
/**
 * "Tied for first place", "share first place", "all in first place": the tie
 * itself, no order.
 */
const TIED_FOR_FIRST =
  /\b(?:tie[ds]?|tying|joint(?:ly)?|share[ds]?|sharing|equal(?:ly)?|all)\s+(?:(?:for|in|at|on)\s+)?(?:the\s+)?(?:first place|1st)\b/gi;

/**
 * The answer about a tied ranking says they tie and invents no strict
 * order: no "first place" and "second place" among equals. "Tied for first
 * place" is the tie, so it is taken out before the order is looked for.
 */
export function answerKeepsTie(): EvalCustomCheck {
  return {
    id: 'keeps-the-tie',
    description:
      'The answer says the products tie and ranks none above another',
    run: ({ answer }) => {
      if (!TIE_WORDS.test(answer)) return 'the answer does not say they tie';
      return STRICT_ORDER.test(answer.replace(TIED_FOR_FIRST, ''))
        ? 'the answer ranks tied products in a strict order'
        : undefined;
    },
  };
}

/** The reading of a weight that is NaN or Infinity as a value. */
const NON_FINITE_VALUE =
  /(?:\bis|\bwas|=|:|\bof|\bat)\s*\**\s*-?(?:NaN|Infinity|inf)\b/i;
const NON_FINITE_EXPLAINED =
  /\b(nan|not a number|infinity|infinite|non-finite|invalid|unusable|excluded?|exclud\w+|ignor\w+|filter\w+|skipp\w+|omit\w+)\b/i;
/** "Excluded: NaN weights", "ignoring the Infinity": what was left out, no value. */
const NON_FINITE_LEFT_OUT =
  /\b(?:exclud\w+|ignor\w+|filter\w+|skipp\w+|omit\w+|remov\w+|dropp\w+)\s*:?\s*(?:the\s+|all\s+|\d+\s+)?(?:NaN|Infinity|inf)\b/gi;

/**
 * The comparator of the average weight: the answer never reports NaN or
 * Infinity as the average, and states the finite average (within 0.01) or
 * explains why it cannot.
 */
export function averageHandlesNonFinite(column = 'avg'): SqlTruthComparator {
  return (rows, { answer }) => {
    // A label naming what was left out is no reported value.
    if (NON_FINITE_VALUE.test(answer.replace(NON_FINITE_LEFT_OUT, ''))) {
      return 'the answer reports NaN or Infinity as the average';
    }
    const expected = Number(rows[0]?.[column]);
    if (!Number.isFinite(expected)) {
      return `the reference SQL gave no finite ${column}`;
    }
    const states = numbersInText(answer).some(
      (n) => Math.abs(n - expected) <= 0.01 + 1e-9,
    );
    if (states || NON_FINITE_EXPLAINED.test(answer)) return undefined;
    return `the answer neither states the finite average ${expected} nor explains the NaN and Infinity weights`;
  };
}

/**
 * The answer is an aggregate over a huge table: it lists at most
 * `maxTableRows` rows, and a successful query aggregates (`count(`, `sum(`
 * …) instead of selecting the lines.
 */
export function aggregatesNeverLists(maxTableRows = 10): EvalCustomCheck {
  return {
    id: 'aggregates-never-lists',
    description: `The answer is an aggregate, not a list (at most ${maxTableRows} table rows)`,
    run: ({ answer, details, toolCalls }) => {
      const rowsListed = markdownTableRows(answer);
      if (rowsListed > maxTableRows) {
        return `the answer lists ${rowsListed} table rows`;
      }
      const sql = sqlOfRun(details, toolCalls);
      return sql.some((s) => /\b(count|sum|avg|min|max)\s*\(/i.test(s))
        ? undefined
        : 'no query aggregates (count, sum, avg, min or max)';
    },
  };
}

/**
 * The comparator of a per-category count: for every row, a line of the
 * answer holds the category and its count.
 */
export function answerStatesEachCount(
  labelColumn: string,
  countColumn: string,
): SqlTruthComparator {
  return (rows, { answer }) => {
    if (rows.length === 0) return 'the reference SQL returned no row';
    const lines = answer.split('\n');
    const missing = rows
      .filter((row) => {
        const label = fold(String(row[labelColumn]));
        const count = Number(row[countColumn]);
        return !lines.some(
          (line) =>
            fold(line).includes(label) && numbersInText(line).includes(count),
        );
      })
      .map((row) => `${String(row[labelColumn])}=${String(row[countColumn])}`);
    return missing.length
      ? `no line of the answer pairs ${missing.join(', ')} (the reference SQL)`
      : undefined;
  };
}

const NONE_WORDS =
  /\b(no|none|zero|0|empty|nothing|not any|never|has not|have not|haven't|hasn't)\b/i;

/**
 * A question whose data holds no row: the answer says there are none (zero,
 * none, empty) and lists no row of its own.
 */
export function answerSaysNoRows(subject: string): EvalCustomCheck {
  return {
    id: 'says-there-are-none',
    description: `The answer says there are no ${subject} and invents no row`,
    run: ({ answer }) => {
      if (!NONE_WORDS.test(answer))
        return `the answer does not say there are no ${subject}`;
      // A summary table of zeros is fine; a table with other figures is not.
      const table = answer
        .split('\n')
        .filter((line) => /^\s*\|/.test(line))
        .join('\n');
      return markdownTableRows(answer) > 0 &&
        /(?<![\d.])[1-9]\d*(?:\.\d+)?/.test(table)
        ? 'the answer shows a table of rows for an empty result'
        : undefined;
    },
  };
}

/** The table name an entity or a SQL reference names: last part, no quotes. */
function bareName(entity: string): string {
  const last = entity.split('.').pop() ?? entity;
  return last
    .replace(/["`[\]]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Cross-agent: every entity Plan names is read by a query of Analyse (the
 * table or view name appears in its SQL, quotes and schema ignored). A plan
 * with no entity passes.
 */
export function planEntitiesInSql(): EvalCustomCheck {
  return {
    id: 'plan-entities-in-sql',
    description: "Every entity of Plan's plan appears in a query of Analyse",
    run: ({ details, toolCalls }) => {
      const plan = (
        details?.steps?.['plan'] as
          { plan?: { entities?: unknown } } | undefined
      )?.plan;
      if (!plan) return 'the run has no Plan step output to compare';
      const entities = Array.isArray(plan.entities)
        ? plan.entities.filter((e): e is string => typeof e === 'string')
        : [];
      const sql = sqlOfRun(details, toolCalls)
        .join('\n')
        .replace(/["`]/g, '')
        .toLowerCase();
      const unread = entities.filter((entity) => {
        const name = bareName(entity);
        return (
          name !== '' && !new RegExp(`\\b${escapeRegExp(name)}\\b`).test(sql)
        );
      });
      return unread.length
        ? `Plan names ${unread.join(', ')} but no query of Analyse reads it`
        : undefined;
    },
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SCALES: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
};

/** The figures of a headline; "2.5 million" is 2,500,000 as well as 2.5. */
export function headlineFigures(headline: string): number[] {
  const scaled = [
    ...headline.matchAll(
      /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|bn|k|m|b)\b/gi,
    ),
  ].map((m) => Number(m[1].replace(/,/g, '')) * SCALES[m[2].toLowerCase()]);
  return [...numbersInText(headline), ...scaled];
}

/** Every number a query's rows hold (numeric cells and numeric strings), and its row count. */
function figuresOfRows(
  queries: { rows?: unknown; rowCount?: unknown }[],
): number[] {
  const found: number[] = [];
  for (const query of queries) {
    if (typeof query.rowCount === 'number') found.push(query.rowCount);
    if (!Array.isArray(query.rows)) continue;
    found.push(query.rows.length);
    for (const row of query.rows as Record<string, unknown>[]) {
      for (const cell of Object.values(row ?? {})) {
        const value =
          typeof cell === 'number'
            ? cell
            : typeof cell === 'string' && cell.trim() !== ''
              ? Number(cell)
              : NaN;
        if (Number.isFinite(value)) found.push(value);
      }
    }
  }
  return found;
}

/**
 * Cross-agent: every figure of Write answer's headline is in the rows of
 * Analyse's queries (a rounded figure within half a percent or 0.01), or is
 * a number the question itself gives ("top 5"). The reference-SQL checks
 * cover the figure's truth; this one catches a figure Write answer made up.
 */
export function headlineFiguresInRows(question: string): EvalCustomCheck {
  return {
    id: 'headline-figures-in-rows',
    description: "Every figure of Write answer's headline is in Analyse's rows",
    run: ({ details }) => {
      const headline = (
        details?.steps?.['write-answer'] as { headline?: unknown } | undefined
      )?.headline;
      if (typeof headline !== 'string') {
        return 'the run has no Write answer headline to compare';
      }
      const queries = (
        details?.steps?.['analyse'] as { queries?: unknown } | undefined
      )?.queries;
      const list = Array.isArray(queries) ? queries : [];
      // Cells, row counts, column sums, differences and shares: Write answer
      // may derive figures from the rows (its rules allow it).
      const available = derivedFigures(
        list.flatMap((q: { rows?: unknown }) =>
          Array.isArray(q.rows) ? (q.rows as Record<string, unknown>[]) : [],
        ),
        [...figuresOfRows(list), ...numbersInText(question)],
      );
      const orphans = headlineFigures(headline).filter(
        (figure) =>
          // Small whole numbers count things ("the other five statuses").
          !(Number.isInteger(figure) && Math.abs(figure) < 10) &&
          !available.some(
            (value) =>
              Math.abs(value - figure) <=
              Math.max(0.01, Math.abs(value) * 0.005) + 1e-9,
          ),
      );
      return orphans.length
        ? `the headline states ${[...new Set(orphans)].join(', ')}, which no Analyse query returned`
        : undefined;
    },
  };
}
