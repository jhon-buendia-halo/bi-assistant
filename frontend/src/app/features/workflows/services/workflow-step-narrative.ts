import { NodeRunView, NodeToolCallView } from '../models/workflow-node.model';
import { WorkflowRunStepStatus } from '../models/workflow.model';

/**
 * The Preview of an agent step's artifact (ui.md 4.4b): a story of what the
 * step received, did and returned in the run shown, built only from the
 * stored run data (no model call). Pure, so the dialog and its tests share it.
 */

/** What one tool call did, as a line of "What it did". */
export interface NarrativeAction {
  /** 1-based, in call order. */
  index: number;
  tool: string;
  /** The query's rationale when the step kept one, else a phrase for the tool. */
  text: string;
  /** What the call ran (the SQL), when recorded. */
  sql: string | null;
  /** `5 rows · 340 ms`; '' when nothing is known. */
  detail: string;
  error: string | null;
  running: boolean;
  /** The rows of the stored query this call ran; null when none matches. */
  rows: Record<string, unknown>[] | null;
}

/** The result table of the last query that returned rows. */
export interface NarrativeTable {
  columns: string[];
  rows: string[][];
  /** Rows the query returned; more than `rows` when cut. */
  rowCount: number;
  truncated: boolean;
  /** The first numeric column after the first one, drawn as bars; null when none. */
  barColumn: number | null;
  /** Each row's bar width, 0..1, when `barColumn` is set. */
  bars: number[];
}

export interface NarrativeField {
  name: string;
  value: string;
}

export interface StepNarrative {
  /** The question the run answers, else the step's title. */
  heading: string;
  /** `Michael · attempt 2 of 2 · 18.4 s · 4 tool calls · 1 failed`. */
  meta: string;
  status: WorkflowRunStepStatus | null;
  /** The step's own words: its headline, notes or answer (Markdown); null when none. */
  summary: string | null;
  error: string | null;
  received: NarrativeField[];
  actions: NarrativeAction[];
  table: NarrativeTable | null;
  /** The output's field names, in order. */
  returned: string[];
}

export interface NarrativeSource {
  title: string;
  agentName: string | null;
  run: NodeRunView | null;
  /** The attempt shown and how many there were; 1 of 1 for a step that ran once. */
  attempt: number;
  attempts: number;
  /** `18.4 s`, as the dialog formats it; '' when unknown. */
  duration: string;
}

/** At most this many result rows in the Preview; the Data view has them all. */
export const NARRATIVE_MAX_ROWS = 10;
const VALUE_MAX = 140;

const TOOL_PHRASES: Record<string, string> = {
  list_entities: 'Listed the entities of the datasets',
  describe_entity: 'Read the columns of an entity',
  sample_rows: 'Looked at sample rows',
  run_readonly_sql: 'Ran a query',
  ask_clarification: 'Asked you a question',
  submit_dashboard: 'Submitted the dashboard',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function clip(text: string, max = VALUE_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A short, one-line reading of a received value. */
export function previewValue(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'string') return clip(value) || '""';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return plural(value.length, 'item');
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return keys.length ? clip(keys.join(', ')) : 'Empty';
  }
  return clip(String(value));
}

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

interface StoredQuery {
  sql: string;
  rationale?: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  error?: string;
}

/** The step's `queries` (Analyse, Validate), as stored; [] for any other output. */
function queriesOf(output: Record<string, unknown> | undefined): StoredQuery[] {
  const list = output?.['queries'];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (q): q is StoredQuery => isRecord(q) && typeof q['sql'] === 'string',
  );
}

/** The query a SQL call ran: the call's input is the SQL, cut at 2 000 characters. */
function queryFor(
  call: NodeToolCallView,
  queries: StoredQuery[],
  used: Set<StoredQuery>,
): StoredQuery | null {
  const input = call.input?.trim();
  if (!input) return null;
  return (
    queries.find(
      (q) =>
        !used.has(q) &&
        (q.sql.trim() === input || q.sql.trim().startsWith(input)),
    ) ?? null
  );
}

function actionsOf(
  calls: NodeToolCallView[],
  queries: StoredQuery[],
): NarrativeAction[] {
  const used = new Set<StoredQuery>();
  return calls.map((call, i) => {
    const query = queryFor(call, queries, used);
    if (query) used.add(query);
    const rows = call.rowCount ?? query?.rowCount;
    const detail = [
      rows !== undefined && !call.error ? plural(rows, 'row') : '',
      formatMs(call.durationMs),
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      index: i + 1,
      tool: call.tool,
      text:
        query?.rationale?.trim() ||
        TOOL_PHRASES[call.tool] ||
        `Called ${call.tool}`,
      sql: call.input?.trim() || null,
      detail,
      error: call.error ?? query?.error ?? null,
      running: !call.finished,
      rows: query && Array.isArray(query.rows) ? query.rows : null,
    };
  });
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return clip(JSON.stringify(value), 60);
  return clip(String(value), 60);
}

/** The last query that returned rows, as a table with bars for its first measure. */
export function tableOf(queries: StoredQuery[]): NarrativeTable | null {
  const query = [...queries]
    .reverse()
    .find((q) => !q.error && Array.isArray(q.rows) && q.rows.some(isRecord));
  if (!query) return null;
  const records = query.rows.filter(isRecord);
  const columns = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const shown = records.slice(0, NARRATIVE_MAX_ROWS);
  const barColumn = columns.findIndex(
    (c, i) =>
      i > 0 &&
      shown.every(
        (r) =>
          r[c] === null ||
          r[c] === undefined ||
          typeof r[c] === 'number' ||
          (typeof r[c] === 'string' &&
            r[c] !== '' &&
            !Number.isNaN(Number(r[c]))),
      ),
  );
  const values =
    barColumn > 0
      ? shown.map((r) => Math.max(0, Number(r[columns[barColumn]] ?? 0)))
      : [];
  const max = Math.max(0, ...values);
  return {
    columns,
    rows: shown.map((r) => columns.map((c) => cell(r[c]))),
    rowCount: Math.max(query.rowCount ?? records.length, records.length),
    truncated: query.truncated || records.length > NARRATIVE_MAX_ROWS,
    barColumn: barColumn > 0 ? barColumn : null,
    bars: barColumn > 0 ? values.map((v) => (max > 0 ? v / max : 0)) : [],
  };
}

/** The step's own words: Write answer's headline, Analyse's notes, else an answer. */
function summaryOf(output: Record<string, unknown> | undefined): string | null {
  for (const key of ['headline', 'text', 'answer']) {
    const value = output?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * A step's tool calls in order, each with its query's rationale and rows when
 * the step's output kept them (Analyse's `queries`).
 */
export function callActions(
  calls: NodeToolCallView[],
  output: Record<string, unknown> | undefined,
): NarrativeAction[] {
  return actionsOf(calls, queriesOf(output));
}

/**
 * What a step with no tool calls of its own read: `Based on 7 rows from 2
 * queries` for a step handed the earlier queries (Write answer's `queries`);
 * null when its input has none.
 */
export function readSummary(
  input: Record<string, unknown> | undefined,
): string | null {
  const queries = queriesOf(input).filter((q) => !q.error);
  if (!queries.length) return null;
  const rows = queries.reduce(
    (sum, q) => sum + (typeof q.rowCount === 'number' ? q.rowCount : 0),
    0,
  );
  return `Based on ${plural(rows, 'row')} from ${plural(queries.length, 'query', 'queries')}`;
}

export function buildStepNarrative(source: NarrativeSource): StepNarrative {
  const run = source.run;
  const input = run?.input;
  const output = run?.output;
  const question = input?.['question'];
  const actions = actionsOf(run?.toolCalls ?? [], queriesOf(output));
  const failed = actions.filter((a) => a.error).length;
  const meta = [
    source.agentName ?? '',
    source.attempts > 1
      ? `attempt ${source.attempt} of ${source.attempts}`
      : '',
    run ? source.duration : '',
    actions.length ? plural(actions.length, 'tool call') : '',
    failed ? `${failed} failed` : '',
  ].filter(Boolean);
  return {
    heading:
      typeof question === 'string' && question.trim()
        ? clip(question, 200)
        : source.title,
    meta: meta.join(' · '),
    status: run?.status ?? null,
    summary: summaryOf(output),
    error: run?.error ?? null,
    received: Object.entries(input ?? {}).map(([name, value]) => ({
      name,
      value: previewValue(value),
    })),
    actions,
    table: tableOf(queriesOf(output)),
    returned: Object.keys(output ?? {}),
  };
}

/** The Preview as Markdown, for Copy. */
export function narrativeMarkdown(title: string, n: StepNarrative): string {
  const lines = [
    `# ${n.heading}`,
    '',
    `_${title}${n.meta ? ` · ${n.meta}` : ''}_`,
    '',
  ];
  if (n.error) lines.push(`> **Failed:** ${n.error}`, '');
  if (n.summary) lines.push(n.summary, '');
  if (n.received.length) {
    lines.push('## What it received', '');
    for (const f of n.received) lines.push(`- **${f.name}**: ${f.value}`);
    lines.push('');
  }
  if (n.actions.length) {
    lines.push('## What it did', '');
    for (const a of n.actions) {
      const tail = [a.detail, a.error ? `failed: ${a.error}` : '']
        .filter(Boolean)
        .join(' · ');
      lines.push(
        `${a.index}. ${a.text} (\`${a.tool}\`${tail ? ` · ${tail}` : ''})`,
      );
      if (a.sql)
        lines.push(
          '',
          '   ```sql',
          ...a.sql.split('\n').map((l) => `   ${l}`),
          '   ```',
        );
    }
    lines.push('');
  }
  if (n.table) {
    lines.push("## Last query's result", '');
    lines.push(`| ${n.table.columns.join(' | ')} |`);
    lines.push(`| ${n.table.columns.map(() => '---').join(' | ')} |`);
    for (const row of n.table.rows) lines.push(`| ${row.join(' | ')} |`);
    lines.push('');
  }
  if (n.returned.length) {
    lines.push(
      '## What it returned',
      '',
      n.returned.map((f) => `\`${f}\``).join(', '),
      '',
    );
  }
  return lines.join('\n').trimEnd() + '\n';
}
