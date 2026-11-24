/**
 * The memory checks (agents-evals R241 to R243, BA-190): what an attempt of a
 * memory case is scored on besides its turn. `noRowValuesRetained` (M1)
 * reads what the attempt's memory held after the teach step,
 * `notRejectedSql` (M2) the probe's SQL and rows against each rejected SQL,
 * and `teachNotRecalled` (M3) what the probe's recall returned.
 *
 * They read the attempt's memory record, which no Mastra scorer sees, so
 * they are not scorers: the loader keeps them on the case (`memoryChecks`,
 * with their criteria) and the runner scores them after the result-set
 * check, each as a check result with the id below. Under `none` they are
 * scored too, on an empty record.
 *
 * Pure module: no Nest, no Mastra, no model. `notRejectedSql` runs a
 * rejected SQL only through the runner it is handed, as the result-set
 * check runs a reference.
 */
import type { LearningStoreItem } from '../../../modules/memory/learning-store.port';
import { redactSqlLiterals } from '../../../modules/memory/signal-text';
// Type-only: erased at compile time, so no runtime edge to the agent stack.
import type { EvalRawToolCall, ScoredCheckResult } from '../assistant.evals';
import type { EvalCriterion } from '../eval-set-files';
import type {
  EvalMemoryRecord,
  MemoryCheckType,
  TeachSignal,
} from '../memory-case';
import { compareEvidence } from '../result-set-check';
import type { ResultSetCheckOptions } from '../result-set-check';
import { tokenizeSql } from './sql-text';
import type { SqlToken } from './sql-text';
import { executedSql, quote } from './turn';
import type { CheckToolCall } from './turn';

/** What a memory check is: its scorer-like id, name, description, criterion. */
export interface MemoryCheckDescriptor {
  id: string;
  name: string;
  description: string;
  /** The criterion it measures unless the file names another (R244). */
  criterion: EvalCriterion;
}

/** The three memory checks by the `type` `memory.json` names (R241 to R243). */
export const MEMORY_CHECKS: Readonly<
  Record<MemoryCheckType, MemoryCheckDescriptor>
> = {
  noRowValuesRetained: {
    id: 'check-no-row-values-retained',
    name: 'No Row Values Retained Check',
    description: 'Checks that nothing the memory holds keeps a row value',
    criterion: 'M1',
  },
  notRejectedSql: {
    id: 'check-not-rejected-sql',
    name: 'Not Rejected SQL Check',
    description:
      'Checks that the probe neither ran nor answered with a rejected SQL',
    criterion: 'M2',
  },
  teachNotRecalled: {
    id: 'check-teach-not-recalled',
    name: 'Teach Not Recalled Check',
    description: 'Checks that no taught signal was recalled into the probe',
    criterion: 'M3',
  },
};

type Row = Record<string, unknown>;

/** Runs a rejected SQL as the result-set check runs a reference (R242). */
export type RejectedSqlRunner = (sql: string) => Promise<Row[]>;

function verdict(type: MemoryCheckType, reason?: string): ScoredCheckResult {
  const { id, description } = MEMORY_CHECKS[type];
  return reason === undefined
    ? { id, description, score: 1, passed: true }
    : { id, description, score: 0, passed: false, reason };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------- M1 */

/**
 * A single-quoted SQL string literal, found exactly as `signal-text.ts`
 * finds one (`''` and `\'` escapes stay inside it).
 */
const STRING_LITERAL = /'(?:[^'\\]|\\.|'')*'/g;

/** A number written as text, as a PostgreSQL numeric or bigint arrives. */
const NUMBER_TEXT = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * A literal's text as the redaction reads it: unescaped, `LIKE` wildcards at
 * either end and blanks trimmed.
 */
function literalText(literal: string): string {
  return literal
    .slice(1, -1)
    .replace(/''/g, "'")
    .replace(/\\(.)/g, '$1')
    .replace(/^[%_]+|[%_]+$/g, '')
    .trim();
}

/**
 * The text of each string literal of a signal's SQL that the memory redacts
 * to `'?'` (R241, the first kind of row value). Asked of `redactSqlLiterals`
 * itself, one literal at a time with the signal's own question, so the check
 * and the memory apply one rule and cannot drift apart.
 */
export function redactedLiterals(
  signal: Pick<TeachSignal, 'question' | 'sql'>,
): string[] {
  const question = (signal.question ?? '').trim();
  return (signal.sql.match(STRING_LITERAL) ?? [])
    .filter(
      (literal) =>
        literal !== "'?'" && redactSqlLiterals(literal, question) === "'?'",
    )
    .map(literalText)
    .filter(Boolean);
}

/**
 * Whether a cell's text is a category code (`own_goal`, `DF`) by the
 * redaction's own rule: with no question, a code is the only literal
 * `redactSqlLiterals` keeps.
 */
function isCategoryCode(text: string): boolean {
  const literal = `'${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  return redactSqlLiterals(literal, '') !== "'?'";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `text` holds `value` as whole words, ignoring case (R241). */
function holdsWords(text: string, value: string): boolean {
  const body = value.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`,
    'iu',
  ).test(text);
}

/**
 * The row values of R241: the text of each literal the redaction removes
 * from a teach signal's SQL, then each text cell of the probe reference's
 * rows that is not a number written as text, not a category code and in no
 * teach signal's question or note. One entry per value, ignoring case.
 */
export function rowValues(
  teach: readonly TeachSignal[],
  referenceRows: readonly Row[],
): string[] {
  const values = new Map<string, string>();
  const add = (value: string) => {
    const key = value.toLowerCase();
    if (!values.has(key)) values.set(key, value);
  };
  teach.flatMap(redactedLiterals).forEach(add);
  const taught = teach.flatMap((signal) => [
    signal.question,
    signal.note ?? '',
  ]);
  for (const row of referenceRows) {
    for (const cell of Object.values(row)) {
      if (typeof cell !== 'string') continue;
      const text = cell.trim();
      if (!text || NUMBER_TEXT.test(text) || isCategoryCode(text)) continue;
      if (taught.some((said) => holdsWords(said, text))) continue;
      add(text);
    }
  }
  return [...values.values()];
}

/** How a reason names a held item: its kind, and its signal's id if any. */
function heldItemName(item: LearningStoreItem): string {
  return item.documentId
    ? `its ${item.kind} item ${item.documentId}`
    : `its ${item.kind} item`;
}

/**
 * `noRowValuesRetained` (R241, M1): no item the scope held after the teach
 * step (every copy of text the store keeps: each message, the vector
 * index's copy of it, the summary, and a fact store's facts and
 * observations) holds a row value. Fails naming the first item that does
 * and quoting the value. An empty scope, as under `none`, passes.
 */
export function noRowValuesRetained(
  teach: readonly TeachSignal[] | undefined,
  held: readonly LearningStoreItem[],
  referenceRows: readonly Row[] | undefined,
): ScoredCheckResult {
  if (held.length === 0) return verdict('noRowValuesRetained');
  const values = rowValues(teach ?? [], referenceRows ?? []);
  const found: string[] = [];
  for (const item of held) {
    for (const value of values) {
      if (holdsWords(item.text, value)) {
        found.push(`"${quote(value, 80)}" in ${heldItemName(item)}`);
      }
    }
  }
  if (found.length === 0) return verdict('noRowValuesRetained');
  const more = found.length > 1 ? ` (and ${found.length - 1} more)` : '';
  return verdict(
    'noRowValuesRetained',
    `the memory holds the row value ${found[0]}${more}`,
  );
}

/* ------------------------------------------------------------------- M2 */

/** Words that are never a table alias (as `sql-text.ts` reads them). */
const NOT_AN_ALIAS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'on',
  'using',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'full',
  'cross',
  'natural',
  'lateral',
  'group',
  'order',
  'by',
  'having',
  'limit',
  'offset',
  'union',
  'intersect',
  'except',
  'window',
  'qualify',
  'fetch',
  'as',
  'with',
  'tablesample',
]);

/** Functions whose arguments use FROM as a keyword. */
const FROM_FUNCTIONS = new Set([
  'extract',
  'substring',
  'trim',
  'overlay',
  'position',
]);

const isName = (token: SqlToken | undefined): token is SqlToken =>
  token?.kind === 'word' || token?.kind === 'quoted';

const isPunct = (token: SqlToken | undefined, text: string): boolean =>
  token?.kind === 'punct' && token.text === text;

/** A name token's parts, lower case (`"api.x.y"` splits). */
function nameParts(token: SqlToken): string[] {
  const text = token.text.toLowerCase();
  return token.kind === 'quoted' ? text.split('.') : [text];
}

/**
 * The tables each alias stands for, and where aliases are written: every
 * `<table> [AS] <alias>` after FROM or JOIN (and after a comma in a FROM
 * list), the table as its dotted name in lower case. Subqueries and table
 * functions name no table; an alias defined twice reads as its last table.
 * `bare` maps a qualified table's last name part to its whole name, so a
 * column qualified by the bare table name reads as an alias would.
 */
function readAliases(tokens: SqlToken[]): {
  aliases: Map<string, string>;
  bare: Map<string, string>;
  written: Set<number>;
} {
  const aliases = new Map<string, string>();
  const bare = new Map<string, string>();
  const written = new Set<number>();
  const calls: (string | undefined)[] = [];

  const readName = (from: number): [string[], number] => {
    const parts: string[] = [];
    let index = from;
    while (isName(tokens[index])) {
      parts.push(...nameParts(tokens[index]));
      if (!isPunct(tokens[index + 1], '.')) return [parts, index + 1];
      index += 2;
    }
    return [parts, index];
  };
  const isWord = (token: SqlToken | undefined, text: string) =>
    token?.kind === 'word' && token.text === text;

  tokens.forEach((token, index) => {
    if (isPunct(token, '(')) {
      const before = tokens[index - 1];
      calls.push(before?.kind === 'word' ? before.text : undefined);
      return;
    }
    if (isPunct(token, ')')) {
      calls.pop();
      return;
    }
    if (!isWord(token, 'from') && !isWord(token, 'join')) return;
    if (token.text === 'from') {
      const call = calls[calls.length - 1];
      if (call && FROM_FUNCTIONS.has(call)) return;
      if (isWord(tokens[index - 1], 'distinct')) return;
    }
    let cursor = index + 1;
    for (;;) {
      if (isWord(tokens[cursor], 'lateral')) cursor += 1;
      if (isPunct(tokens[cursor], '(')) break; // a subquery
      const [parts, next] = readName(cursor);
      if (!parts.length || isPunct(tokens[next], '(')) break; // a function
      const table = parts.join('.');
      if (parts.length > 1) bare.set(parts[parts.length - 1], table);
      cursor = next;
      const hasAs = isWord(tokens[cursor], 'as');
      const alias = tokens[hasAs ? cursor + 1 : cursor];
      if (
        isName(alias) &&
        !(alias.kind === 'word' && NOT_AN_ALIAS.has(alias.text))
      ) {
        aliases.set(alias.text.toLowerCase(), table);
        if (hasAs) written.add(cursor);
        cursor += hasAs ? 1 : 0;
        written.add(cursor);
        cursor += 1;
      }
      if (token.text === 'from' && isPunct(tokens[cursor], ',')) {
        cursor += 1;
        continue;
      }
      break;
    }
  });
  return { aliases, bare, written };
}

/** A token as the normalised statement writes it. */
function tokenText(token: SqlToken): string {
  if (token.kind === 'string') return `'${token.text.replace(/'/g, "''")}'`;
  if (token.kind === 'quoted') return nameParts(token).join('.');
  return token.text;
}

/**
 * A statement as R242 compares it: comments dropped, keywords and names in
 * lower case, one space between tokens (none around a dot), a trailing
 * semicolon dropped, and each table alias replaced by the table it stands
 * for, its definition removed (`g.minute … FROM world_cup.goals g` reads
 * `world_cup.goals.minute … FROM world_cup.goals`). A column qualified by a
 * table's bare name reads the same way. String literals keep their case:
 * they are values, not syntax.
 */
export function normalizedSql(sql: string): string {
  const tokens = tokenizeSql(sql);
  while (isPunct(tokens[tokens.length - 1], ';')) tokens.pop();
  const { aliases, bare, written } = readAliases(tokens);
  let text = '';
  // A name part joins the dot before it with no space, as it is written.
  let glued = true;
  tokens.forEach((token, index) => {
    if (written.has(index)) return;
    if (isPunct(token, '.')) {
      text += '.';
      glued = true;
      return;
    }
    let piece = tokenText(token);
    if (
      isName(token) &&
      isPunct(tokens[index + 1], '.') &&
      !isPunct(tokens[index - 1], '.')
    ) {
      const name = nameParts(token).join('.');
      piece = aliases.get(name) ?? bare.get(name) ?? piece;
    }
    text += glued ? piece : ` ${piece}`;
    glued = false;
  });
  return text;
}

/** A raw tool call as the turn checks read one, for its executed SQL. */
function checkCall(call: EvalRawToolCall): CheckToolCall {
  const input = call.input;
  const args =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    name: call.name,
    args,
    argsReadable: true,
    ...(call.output !== undefined ? { result: call.output } : {}),
    ...(call.failed ? { error: 'the call failed' } : {}),
  };
}

/** Each result holds every row of the other, as the result-set match reads rows (R31). */
function sameRows(
  a: readonly Row[],
  b: readonly Row[],
  options: ResultSetCheckOptions,
): boolean {
  return (
    compareEvidence([...a], [...b], options).match &&
    compareEvidence([...b], [...a], options).match
  );
}

/**
 * `notRejectedSql` (R242, M2): the probe neither ran a rejected SQL again
 * nor answered with its rows. It fails when a successful
 * `run_readonly_sql` call's executed SQL (the SQL fixer's rewrite when it
 * repaired the call) is the SQL of a `rejection` teach signal after
 * `normalizedSql`; and when the rows of the last successful complete call
 * and the rejected SQL's rows, run through `runReference`, each hold every
 * row of the other. The reason says which of the two happened (both when
 * both did). A rejected SQL that fails to run fails the check, as a
 * reference that fails to run fails the result-set check. A case with no
 * rejection signal passes; so does a probe with no complete result, for the
 * second half.
 */
export async function notRejectedSql(
  teach: readonly TeachSignal[] | undefined,
  rawToolCalls: readonly EvalRawToolCall[],
  lastCompleteRows: readonly Row[] | undefined,
  runReference: RejectedSqlRunner,
  options: ResultSetCheckOptions = {},
): Promise<ScoredCheckResult> {
  const rejected = (teach ?? [])
    .map((signal, index) => ({ signal, n: index + 1 }))
    .filter(({ signal }) => signal.kind === 'rejection');
  if (rejected.length === 0) return verdict('notRejectedSql');

  const executed = rawToolCalls
    .filter((call) => call.name === 'run_readonly_sql')
    .map((call) => executedSql(checkCall(call)))
    .filter((sql): sql is string => sql !== undefined);
  const reasons: string[] = [];
  for (const { signal, n } of rejected) {
    const wanted = normalizedSql(signal.sql);
    const rerun = executed.find((sql) => normalizedSql(sql) === wanted);
    if (rerun !== undefined) {
      reasons.push(
        `the probe ran the rejected SQL of teach signal ${n} again: "${quote(rerun)}"`,
      );
    }
  }
  if (lastCompleteRows) {
    for (const { signal, n } of rejected) {
      let rows: Row[];
      try {
        rows = await runReference(signal.sql);
      } catch (error) {
        reasons.push(
          `the rejected SQL of teach signal ${n} failed to run — ${errorText(error)}`,
        );
        continue;
      }
      if (sameRows(lastCompleteRows, rows, options)) {
        reasons.push(
          `the answer has the rejected SQL's rows: the last successful SQL returned the ${rows.length} row(s) of teach signal ${n}'s rejected SQL`,
        );
      }
    }
  }
  return reasons.length
    ? verdict('notRejectedSql', reasons.join('; '))
    : verdict('notRejectedSql');
}

/* ------------------------------------------------------------------- M3 */

/**
 * `teachNotRecalled` (R243, M3): no taught signal was recalled into the
 * probe. Fails naming the recalled signals by document id. No record (the
 * arm `none`) and an empty recall pass; a summary is not a recalled signal.
 */
export function teachNotRecalled(
  record: EvalMemoryRecord | undefined,
): ScoredCheckResult {
  const recalled = record?.recalled ?? [];
  if (recalled.length === 0) return verdict('teachNotRecalled');
  return verdict(
    'teachNotRecalled',
    `the probe recalled ${recalled.length} taught signal${recalled.length === 1 ? '' : 's'}: ${recalled.map((signal) => signal.documentId).join(', ')}`,
  );
}
