/**
 * The run context (the shared-context experiment of `answer-business-question`,
 * approach B): one board per workflow run where the steps publish the run's
 * large context once (the catalog's columns, Read images' notes, the
 * queries and their rows) and from which the agents read only what they need
 * through `list_run_context` and `read_run_context`, instead of each agent
 * receiving all of it in its prompt.
 *
 * Plain data and functions, no framework import, so Jest and the catalogue
 * read it (lessons.md, Evals and agents). The board lives on the run's
 * RequestContext under `RUN_CONTEXT_KEY`; like the runtime it is rebuilt
 * empty on a resume (a promotion would keep it in Mastra workflow state).
 */

/** The RequestContext key of the run's board. */
export const RUN_CONTEXT_KEY = 'answer-business-question-run-context';

/** The most characters one `read_run_context` call returns. */
export const RUN_CONTEXT_PAGE_CHARS = 8_000;

/**
 * The steps Analyse gets on top of its budget in a shared-context run: its
 * catalog columns are reads now, so the reads do not eat its SQL steps.
 */
export const RUN_CONTEXT_ANALYSE_EXTRA_STEPS = 3;

/** The most rows of one query the board holds (Write answer's cap). */
export const RUN_CONTEXT_ROWS_CAP = 50;

/** The board's keys. */
export const RUN_CONTEXT_KEYS = {
  /** One entity's columns. */
  catalog: (entity: string) => `catalog/${entity}`,
  /** Read images' notes. */
  imageNotes: 'image-notes',
  /** Query `n` (1-based) of the run's analysis, with its rows. */
  query: (n: number) => `queries/${n}`,
  /** The earlier attempt's queries, on an Analyse retry. */
  earlierQueries: 'earlier-queries',
} as const;

/** One entry of the board. */
export interface RunContextEntry {
  key: string;
  /** One line saying what the entry holds. */
  title: string;
  content: string;
}

/** What `list_run_context` returns for one entry. */
export interface RunContextSummary {
  key: string;
  title: string;
  chars: number;
}

/** What `read_run_context` returns. */
export type RunContextPage =
  | {
      key: string;
      title: string;
      content: string;
      offset: number;
      /** Where the next page starts; `null` on the last page. */
      nextOffset: number | null;
      totalChars: number;
    }
  | { error: string };

/** The board of one run. Writes replace an entry with the same key. */
export class RunContextBoard {
  private readonly entries = new Map<string, RunContextEntry>();
  /** Every read, in order, for the experiment's measurements. */
  readonly reads: { key: string; offset: number; chars: number }[] = [];

  write(key: string, title: string, content: string): void {
    this.entries.set(key, { key, title, content });
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): RunContextEntry | undefined {
    return this.entries.get(key);
  }

  /** Removes every entry whose key starts with `prefix`. */
  remove(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /** The entries whose key starts with `prefix` (all without one). */
  list(prefix = ''): RunContextSummary[] {
    return [...this.entries.values()]
      .filter((entry) => entry.key.startsWith(prefix))
      .map(({ key, title, content }) => ({
        key,
        title,
        chars: content.length,
      }));
  }

  read(
    key: string,
    offset = 0,
    limit = RUN_CONTEXT_PAGE_CHARS,
  ): RunContextPage {
    const entry = this.entries.get(key.trim());
    if (!entry) {
      const known = this.list().map((summary) => summary.key);
      return {
        error: `No run context entry "${key}". Known keys: ${known.join(', ') || '(none)'}`,
      };
    }
    const start = Math.max(0, Math.floor(offset));
    const size = Math.max(
      1,
      Math.min(Math.floor(limit), RUN_CONTEXT_PAGE_CHARS),
    );
    const content = entry.content.slice(start, start + size);
    const end = start + content.length;
    this.reads.push({ key: entry.key, offset: start, chars: content.length });
    return {
      key: entry.key,
      title: entry.title,
      content,
      offset: start,
      nextOffset: end < entry.content.length ? end : null,
      totalChars: entry.content.length,
    };
  }
}

/** The board on a RequestContext, if the run has one. */
export function runContextOf(requestContext: {
  get(key: string): unknown;
}): RunContextBoard | undefined {
  const value = requestContext.get(RUN_CONTEXT_KEY);
  return value instanceof RunContextBoard ? value : undefined;
}

/** The shapes the publishers read (structural, from the workflow schemas). */
export interface BoardCatalogEntity {
  entity: string;
  dataset: string;
  columnCount: number | null;
}
export interface BoardEntityColumns {
  entity: string;
  columns: { name: string; type: string }[];
  more?: number;
}
export interface BoardQuery {
  sql: string;
  rationale?: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  error?: string;
}

/** Publishes each entity's columns under `catalog/<entity>`. */
export function publishCatalog(
  board: RunContextBoard,
  catalog: readonly BoardCatalogEntity[],
  columns: readonly BoardEntityColumns[],
): void {
  for (const entity of catalog) {
    const known = columns.find((entry) => entry.entity === entity.entity);
    const listed = (known?.columns ?? []).map(
      (column) => `- ${column.name}${column.type ? ` ${column.type}` : ''}`,
    );
    const more = known?.more ? [`(+${known.more} more not listed)`] : [];
    board.write(
      RUN_CONTEXT_KEYS.catalog(entity.entity),
      `Columns of ${entity.entity} (dataset: ${entity.dataset})`,
      [
        `Columns of ${entity.entity} (name type):`,
        ...(listed.length ? listed : ['(none listed)']),
        ...more,
      ].join('\n'),
    );
  }
}

/** Publishes Read images' notes; blank notes publish nothing. */
export function publishImageNotes(
  board: RunContextBoard,
  imageNotes: string | undefined,
): void {
  const notes = (imageNotes ?? '').trim();
  if (notes) {
    board.write(
      RUN_CONTEXT_KEYS.imageNotes,
      'Notes on the reference images the user attached',
      notes,
    );
  }
}

/** One query as the board holds it: its outcome, SQL and capped rows. */
export function queryEntryContent(query: BoardQuery, n: number): string {
  const shown = Math.min(query.rows.length, RUN_CONTEXT_ROWS_CAP);
  const facts = query.error
    ? `failed: ${query.error}`
    : `${query.rowCount} rows${shown < query.rowCount ? `, the first ${shown} kept` : ''}${query.truncated ? ', cut at its row limit' : ''}`;
  return [
    `Query ${n}: ${query.rationale ?? '(no rationale given)'} (${facts})`,
    `SQL: ${query.sql}`,
    ...(query.error
      ? []
      : ['Rows:', JSON.stringify(query.rows.slice(0, RUN_CONTEXT_ROWS_CAP))]),
  ].join('\n');
}

/** Publishes each query under `queries/<n>` (1-based), replacing earlier ones. */
export function publishQueries(
  board: RunContextBoard,
  queries: readonly BoardQuery[],
): void {
  // A later attempt's list replaces the earlier one.
  board.remove('queries/');
  queries.forEach((query, index) => {
    board.write(
      RUN_CONTEXT_KEYS.query(index + 1),
      `Query ${index + 1}: ${query.rationale ?? '(no rationale given)'}`,
      queryEntryContent(query, index + 1),
    );
  });
}

/**
 * The index line every shared-context prompt ends its context with: which
 * entries the board holds and how to read them. Lists the keys under
 * `prefixes` (all when none), at most `max` of them.
 */
export function runContextIndexBlock(
  board: RunContextBoard,
  prefixes: readonly string[] = [],
  max = 60,
): string {
  const entries = board
    .list()
    .filter(
      (entry) =>
        prefixes.length === 0 ||
        prefixes.some((prefix) => entry.key.startsWith(prefix)),
    );
  if (!entries.length) return 'Run context: no entries.';
  const shown = entries.slice(0, max);
  return [
    'Run context (read an entry with read_run_context by its key; list them with list_run_context):',
    ...shown.map(
      (entry) => `- ${entry.key} — ${entry.title} (${entry.chars} chars)`,
    ),
    ...(entries.length > shown.length
      ? [`- … and ${entries.length - shown.length} more (list_run_context)`]
      : []),
  ].join('\n');
}
