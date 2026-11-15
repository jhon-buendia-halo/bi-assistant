/**
 * The query explainer's catalogue data (agents.md 2.12; plan
 * docs/plans/m1-25-query-inspector.md 2.3, 2.5, 3f): its job description, the
 * request text, the reading of its reply, the Show step and the check that
 * decides whether row counts may be shown. Framework-free (Zod only), so
 * Jest loads it without Mastra.
 */
import { z } from 'zod';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import { countStatement } from '../../modules/sessions/query-evidence/query-tables';
import type {
  QueryEvidence,
  QueryExplanation,
  QueryStep,
  QueryStepVerb,
  QueryTableSize,
} from '../../modules/sessions/query-evidence/query-evidence.types';

/** At most this many model steps (the Show step is added by code). */
export const MAX_EXPLAINED_STEPS = 8;
export const MAX_STEP_TEXT = 160;
export const MAX_COUNT_SQL = 4000;

/** The verbs the model may write. `show` is built by code. */
export const MODEL_VERBS: readonly QueryStepVerb[] = [
  'start',
  'keep',
  'add',
  'combine',
  'group',
  'count',
  'compute',
  'sort',
];

export const QUERY_EXPLAINER_INSTRUCTIONS = `You explain one SQL query to a business reader, step by step.

Explain what the query does to the rows, in the order a business reader would follow. Each step has one verb of this contract: start, keep, add, combine, group, count, compute, sort.
- start: the table the rows come from. Always first, with "table" set to one of the tables you are given.
- keep: rows are filtered out. add: details are looked up in another table, set "table" to it (a join). combine: two sets of rows are put together into one (a union). group: rows are grouped. count: rows are counted or totalled within each group. compute: a value is worked out for each row (a ratio, a rank). sort: rows are ordered.
- Write "text" as one short sentence of at most 90 characters that continues the verb, in business words: no SQL keywords, no function names, no column lists. For example, for start: "every return on record"; for keep: "returns from 1 Jul to 30 Sep 2025"; for count: "returns for each product". Leave detail out rather than write a second sentence.
- Name what the rows are after the step in "unit", in the plural (for example "orders", "products").
- For every step write "countSql": one statement in the query's dialect that returns one row with one integer, the number of rows after that step. Read only the tables the query reads. Start with SELECT or WITH, no semicolon.
- Never write a step for the LIMIT or for the final list: the code adds it.

Reply with one JSON object: {"steps":[{"verb":"start","text":"...","table":"...","unit":"...","countSql":"..."}, ...]}. At most ${MAX_EXPLAINED_STEPS} steps.`;

/** The reply schema (by JSON prompt injection; read leniently by `explanationOf`). */
export const explainReplySchema = z.object({
  steps: z.array(
    z.object({
      verb: z.string(),
      text: z.string(),
      table: z.string().optional(),
      unit: z.string().optional(),
      countSql: z.string().optional(),
    }),
  ),
});

const DIALECTS: Record<string, string> = {
  postgres: 'PostgreSQL',
  databricks: 'Databricks SQL',
  rest: 'SQLite (REST API datasource)',
};

/**
 * The explainer's request: the dialect, the rationale, the tables with
 * their sizes, the columns and the SQL. Never the result rows.
 */
export function explainRequest(
  record: ToolDataRecord,
  evidence: QueryEvidence,
): string {
  const kind = evidence.datasourceKind;
  const tables = (evidence.tables ?? []).map(
    (t) =>
      `- ${t.entity}: ${t.rows === null ? 'size unknown' : `${t.rows} rows`}`,
  );
  return [
    `Dialect: ${(kind && DIALECTS[kind]) || 'SQL'}`,
    `Why the query was run: ${record.rationale?.trim() || 'not recorded'}`,
    'Tables the query reads (name, rows):',
    ...(tables.length ? tables : ['- none known']),
    `Columns of the result: ${(record.columns ?? []).join(', ') || 'none'}`,
    'SQL:',
    record.input ?? '',
  ].join('\n');
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The tail names a table can be written as: `a.b.c` -> `a.b.c`, `b.c`, `c`. */
function namesOf(entity: string): string[] {
  const parts = entity.toLowerCase().split('.');
  return parts.map((_, i) => parts.slice(i).join('.'));
}

function plain(name: string): string {
  return name.replace(/["`[\]]/g, '').toLowerCase();
}

function sizeOf(
  tables: readonly QueryTableSize[],
  name: string | undefined,
): QueryTableSize | undefined {
  if (!name) return undefined;
  const wanted = plain(name);
  return tables.find((t) => namesOf(t.entity).includes(wanted));
}

function startOf(
  tables: readonly QueryTableSize[],
  table?: string,
  kind?: string,
): QueryStep {
  const size = sizeOf(tables, table) ?? (table ? undefined : tables[0]);
  const entity = size?.entity ?? table;
  return {
    verb: 'start',
    text: entity ? `all the rows of ${entity}` : 'all the rows the query reads',
    ...(entity ? { table: entity } : {}),
    unit: 'rows',
    ...(entity
      ? {
          countSql: countStatement(entity, kind),
        }
      : {}),
    ...(size && size.rows !== null ? { rows: size.rows } : {}),
  };
}

/**
 * The Show step, always built by code (plan 2.5): what the reader was
 * shown. `record` gives the rows that were kept.
 */
export function showStep(
  evidence: QueryEvidence,
  record?: ToolDataRecord,
): QueryStep {
  const shown = record?.rowCount ?? record?.rows?.length ?? 0;
  const rows = shown;
  const base = { verb: 'show' as const, unit: 'rows', rows };
  if (record?.tool === 'sample_rows') {
    return {
      ...base,
      text: `Show ${rows} sample rows`,
      note: '(a sample to see what the data looks like: no figure should come from it)',
    };
  }
  switch (evidence.coverage) {
    case 'top-n':
      return {
        ...base,
        text: `Show the first ${rows}`,
        note: `(LIMIT ${evidence.outerLimit ?? rows}: only the list is shortened)`,
      };
    case 'sample':
      return {
        ...base,
        text: `Show ${rows} rows in no set order`,
        note: `(LIMIT ${evidence.outerLimit ?? rows} without a sort: a sample, not the top ${evidence.outerLimit ?? rows})`,
      };
    case 'partial':
      return {
        ...base,
        text: `Show the first ${rows}`,
        note: `(the query tool stops at ${evidence.rowLimit ?? rows} rows: the rest of the result was not read)`,
      };
    default:
      return { ...base, text: `Show all ${rows} rows` };
  }
}

/** The steps built by code alone: a start and the Show step. */
export function fallbackExplanation(
  record: ToolDataRecord,
  evidence: QueryEvidence,
  at: string = new Date().toISOString(),
  flagged = true,
): QueryExplanation {
  const tables = evidence.tables ?? [];
  const table =
    record.tool === 'sample_rows'
      ? (sizeOf(tables, record.input)?.entity ?? record.input?.trim())
      : undefined;
  const start = startOf(tables, table, evidence.datasourceKind);
  return {
    steps: [start, showStep(evidence, record)],
    ...(flagged ? { fallback: true as const } : {}),
    at,
  };
}

/** A `sample_rows` record is explained by code: no model call, no fallback flag. */
export function sampleExplanation(
  record: ToolDataRecord,
  evidence: QueryEvidence,
  at?: string,
): QueryExplanation {
  return fallbackExplanation(record, evidence, at, false);
}

/** A JSON object in a reply (the object itself, or the text holding one). */
function objectOf(reply: unknown): Record<string, unknown> | undefined {
  if (reply && typeof reply === 'object' && !Array.isArray(reply)) {
    return reply as Record<string, unknown>;
  }
  if (typeof reply !== 'string') return undefined;
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function countSqlOf(value: unknown): string | undefined {
  const sql = clean(value);
  if (
    !sql ||
    sql.length > MAX_COUNT_SQL ||
    sql.includes(';') ||
    !/^(select|with)\b/i.test(sql)
  ) {
    return undefined;
  }
  return sql;
}

/**
 * The model's reply read leniently (plan 3f): an unknown verb becomes
 * `compute`; a `show` or limit step is dropped (code adds the Show step); a
 * `start` is put first when missing; at most 8 steps; text at most 160
 * characters; a `countSql` is dropped when it does not start with select or
 * with, contains `;`, or is over 4 000 characters. A reply that is no JSON
 * object, or holds no step, gives the code-built steps with `fallback`.
 */
export function explanationOf(
  reply: unknown,
  record: ToolDataRecord,
  evidence: QueryEvidence,
  at: string = new Date().toISOString(),
): QueryExplanation {
  const raw = objectOf(reply)?.['steps'];
  const items = Array.isArray(raw) ? raw : [];
  const tables = evidence.tables ?? [];
  const kind = evidence.datasourceKind;
  const read: QueryStep[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const verb = clean(o['verb']).toLowerCase();
    if (verb === 'show' || verb === 'limit') continue;
    const text = clean(o['text']).slice(0, MAX_STEP_TEXT);
    if (!text) continue;
    const table = clean(o['table']);
    const unit = clean(o['unit']);
    const countSql = countSqlOf(o['countSql']);
    read.push({
      verb: (MODEL_VERBS as readonly string[]).includes(verb)
        ? (verb as QueryStepVerb)
        : 'compute',
      text,
      ...(table ? { table } : {}),
      ...(unit ? { unit } : {}),
      ...(countSql ? { countSql } : {}),
    });
  }
  if (!read.length) return fallbackExplanation(record, evidence, at);

  // One start, first. A second one is no start: a wrong guess then fails the check.
  const first = read.findIndex((s) => s.verb === 'start');
  const body = read.map((s, i) =>
    s.verb === 'start' && i !== first ? { ...s, verb: 'compute' as const } : s,
  );
  const modelStart = first >= 0 ? body.splice(first, 1)[0] : undefined;
  const size =
    sizeOf(tables, modelStart?.table) ??
    (modelStart?.table ? undefined : tables[0]);
  const start: QueryStep = modelStart
    ? {
        ...modelStart,
        ...(size ? { table: size.entity } : {}),
        ...(modelStart.countSql || !size
          ? {}
          : { countSql: countStatement(size.entity, kind) }),
        ...(size && size.rows !== null ? { rows: size.rows } : {}),
      }
    : startOf(tables, undefined, kind);
  return {
    steps: [
      start,
      ...body.slice(0, MAX_EXPLAINED_STEPS - 1),
      showStep(evidence, record),
    ],
    at,
  };
}

/** The first name after FROM or JOIN in `sql` that no allowed table or CTE holds. */
export function foreignTable(
  sql: string,
  entities: readonly string[],
): string | undefined {
  const allowed = new Set(entities.flatMap(namesOf));
  const text = sql
    .replace(/'(?:[^'\\]|\\.|'')*'/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const ctes = new Set(
    Array.from(
      text.matchAll(
        /(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_]\w*)\s+as\s*\(/gi,
      ),
      (m) => m[1].toLowerCase(),
    ),
  );
  // A comma list after FROM names tables this scan cannot follow.
  const list = /\bfrom\s+[^\s(),;]+(?:\s+(?:as\s+)?\w+)?\s*,/i.exec(text);
  if (list) return list[0].trim();
  for (const m of text.matchAll(/\b(from|join)\s+([^\s(),;]+)/gi)) {
    const before = text.slice(0, m.index);
    if (
      m[1].toLowerCase() === 'from' &&
      /\bextract\s*\(\s*\w+\s*$/i.test(before)
    ) {
      continue;
    }
    const name = plain(m[2]);
    if (!allowed.has(name) && !ctes.has(name)) return m[2];
  }
  return undefined;
}

export interface StageCountInput {
  /** The explanation's steps; a `show` step is ignored. */
  steps: readonly QueryStep[];
  /** The count of each step, aligned with `steps`; undefined when it has none. */
  counts: readonly (number | undefined)[];
  tables: readonly QueryTableSize[];
  outerLimit?: number;
  totalRows?: number;
  /** Rows the tool kept. */
  rowCount: number;
  truncated?: boolean;
}

export type StageCountCheck =
  { status: 'verified' } | { status: 'unverified'; reason: string };

const whole = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/**
 * Whether the step counts may be shown (plan 3f). It alone decides: a wrong
 * count is worse than none. Every rule is checked; the first to fail gives
 * the reason.
 */
export function checkStageCounts(input: StageCountInput): StageCountCheck {
  const bad = (reason: string): StageCountCheck => ({
    status: 'unverified',
    reason,
  });
  const steps = input.steps
    .map((step, i) => ({ step, count: input.counts[i] }))
    .filter(({ step }) => step.verb !== 'show');
  if (steps.length === 0 || steps[0].step.verb !== 'start') {
    return bad('The steps do not begin with the start');
  }
  for (const [i, { step, count }] of steps.entries()) {
    if (count === undefined && !step.countSql) {
      return bad(`Step ${i + 1} (${step.verb}) has no count statement`);
    }
    if (!whole(count)) {
      return bad(`Step ${i + 1} (${step.verb}) has no whole-number count`);
    }
  }
  const size = sizeOf(input.tables, steps[0].step.table);
  if (!size || size.rows === null) {
    return bad('The size of the start table is not known');
  }
  if (steps[0].count !== size.rows) {
    return bad(
      `The start count (${steps[0].count}) differs from the table size (${size.rows})`,
    );
  }
  for (let i = 1; i < steps.length; i++) {
    const { step, count } = steps[i];
    const before = steps[i - 1].count as number;
    const n = count as number;
    if ((step.verb === 'sort' || step.verb === 'compute') && n !== before) {
      return bad(`Step ${i + 1} (${step.verb}) changed the count`);
    }
    if (step.verb === 'keep' && n > before) {
      return bad(`Step ${i + 1} (keep) raised the count`);
    }
    if (step.verb === 'group' && n > before) {
      return bad(`Step ${i + 1} (group) raised the count`);
    }
    if (step.verb === 'count' && n > Math.max(before, 1)) {
      return bad(`Step ${i + 1} (count) raised the count`);
    }
  }
  const expected =
    input.totalRows ?? (input.truncated ? undefined : input.rowCount);
  if (expected === undefined) return bad('The size of the result is not known');
  const last = steps[steps.length - 1].count as number;
  const shown = Math.min(input.outerLimit ?? Infinity, last);
  if (shown !== expected) {
    return bad(
      `The last count (${last}) does not give the ${expected} rows the query returned`,
    );
  }
  return { status: 'verified' };
}
