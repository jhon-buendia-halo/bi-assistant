import { randomUUID } from 'crypto';
import type {
  PanelToolInput,
  PanelToolResult,
  DatasetToolTurnRecord,
} from '../../mastra/tool-services';
import type {
  PanelItem,
  SessionDoc,
  TablePanelItem,
} from './entities/session.entity';
import { STORED_ROWS_CAP } from './turn-data';
import { readWorkspaceFile } from './workspace-files';

/** Items kept per session; the oldest file, document and table go first. */
export const MAX_PANEL_ITEMS = 100;
/** Longest Markdown document an agent may show. */
export const DOCUMENT_MAX_CHARS = 50_000;

/** The id of a visual's item: one per visual, upserted. */
export const visualItemId = (visualId: string) => `visual:${visualId}`;
const UPSERTED_KINDS = new Set<PanelItem['kind']>(['visual']);

/** What the panel-item builder needs besides the tool's input. */
export interface PanelItemContext {
  session: SessionDoc;
  /** The live records of the current turn (grounding for `table`). */
  turnRecords?: DatasetToolTurnRecord[];
  now?: Date;
}

/** A built item, with the summary the tool returns. */
export interface BuiltPanelItem {
  item: PanelItem;
  summary: PanelToolResult;
}

/**
 * Every item the session shows, oldest first: the stored ones plus a
 * synthesized `visual:<id>` for each visual without one, stamped with the
 * visual's creation time, so sessions saved before panel items need no
 * migration. Stored items of the retired kind `phases` (the workflow now lives
 * in the workflow bar) are dropped here, at read time.
 */
export function withVisualItems(session: SessionDoc): PanelItem[] {
  const stored = (session.panelItems ?? []).filter(
    (item) => (item.kind as string) !== 'phases',
  );
  const known = new Set(stored.map((item) => item.id));
  const synthesized = (session.visualizations ?? [])
    .filter((visual) => !known.has(visualItemId(visual.id)))
    .map((visual): PanelItem => ({
      id: visualItemId(visual.id),
      kind: 'visual',
      title: visual.title,
      shownAt: visual.createdAt,
      visualId: visual.id,
    }));
  return [...stored, ...synthesized];
}

/**
 * `items` with `item` added: a visual item replaces the one with its id, any other is appended. Past `MAX_PANEL_ITEMS`, the oldest file,
 * document and table items are dropped.
 */
export function upsertPanelItem(
  items: readonly PanelItem[],
  item: PanelItem,
): PanelItem[] {
  const index = UPSERTED_KINDS.has(item.kind)
    ? items.findIndex((existing) => existing.id === item.id)
    : -1;
  const next =
    index === -1
      ? [...items, item]
      : items.map((existing, i) => (i === index ? item : existing));
  const excess = next.length - MAX_PANEL_ITEMS;
  if (excess <= 0) return next;
  const dropped = new Set(
    next
      .filter((existing) => !UPSERTED_KINDS.has(existing.kind))
      .sort((a, b) => a.shownAt.localeCompare(b.shownAt))
      .slice(0, excess)
      .map((existing) => existing.id),
  );
  return next.filter((existing) => !dropped.has(existing.id));
}

/** The item shown last, or undefined when none was. */
export function latestPanelItem(
  items: readonly PanelItem[],
): PanelItem | undefined {
  return items.reduce<PanelItem | undefined>(
    (latest, item) =>
      !latest || item.shownAt >= latest.shownAt ? item : latest,
    undefined,
  );
}

/** RFC 4180 CSV: a header row of `columns`, CRLF line ends. */
export function tableCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const cell = (value: unknown): string => {
    const text =
      value === null || value === undefined
        ? ''
        : value instanceof Date
          ? value.toISOString()
          : typeof value === 'object'
            ? JSON.stringify(value)
            : `${value as string | number | boolean | bigint}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.map(cell).join(','),
    ...rows.map((row) => columns.map((column) => cell(row[column])).join(',')),
  ].join('\r\n');
}

/** A file-name-safe slug of a title, as the visual download's. */
export function titleSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

/**
 * Validate a `show_in_panel` call against the session and build its item.
 * Throws an `Error` whose message is the one the tool returns to the model.
 */
export async function buildPanelItem(
  input: PanelToolInput,
  context: PanelItemContext,
): Promise<BuiltPanelItem> {
  const shownAt = (context.now ?? new Date()).toISOString();
  const given = input.title?.trim() || undefined;
  switch (input.kind) {
    case 'file': {
      if (!input.path?.trim()) {
        throw new Error('path is required for kind "file"');
      }
      const file = await readWorkspaceFile(context.session.id, input.path);
      const title = given ?? file.path.split('/').pop() ?? file.path;
      const item: PanelItem = {
        id: randomUUID(),
        kind: 'file',
        title,
        shownAt,
        path: file.path,
        bytes: file.bytes,
      };
      return {
        item,
        summary: summaryOf(item, { bytes: file.bytes }),
      };
    }
    case 'document': {
      if (!input.markdown?.trim()) {
        throw new Error('markdown is required for kind "document"');
      }
      if (input.markdown.length > DOCUMENT_MAX_CHARS) {
        throw new Error('The document is at most 50,000 characters');
      }
      const item: PanelItem = {
        id: randomUUID(),
        kind: 'document',
        title: given ?? 'Document',
        shownAt,
        markdown: input.markdown,
      };
      return { item, summary: summaryOf(item) };
    }
    case 'table': {
      const item = tableItem(input, given, shownAt, context.turnRecords);
      return { item, summary: summaryOf(item, { rowCount: item.rowCount }) };
    }
    case 'visual': {
      if (!input.visualId?.trim()) {
        throw new Error('visualId is required for kind "visual"');
      }
      const visual = (context.session.visualizations ?? []).find(
        (v) => v.id === input.visualId,
      );
      if (!visual) {
        throw new Error(`Visual "${input.visualId}" not found in this session`);
      }
      const item: PanelItem = {
        id: visualItemId(visual.id),
        kind: 'visual',
        title: given ?? visual.title,
        shownAt,
        visualId: visual.id,
      };
      return { item, summary: summaryOf(item) };
    }
  }
}

function summaryOf(
  item: PanelItem,
  extra: { bytes?: number; rowCount?: number } = {},
): PanelToolResult {
  return {
    shown: true,
    id: item.id,
    kind: item.kind,
    title: item.title,
    ...extra,
  };
}

/** The query results of a turn: the records that carry columns and no error. */
function queryResults(
  records: readonly DatasetToolTurnRecord[] | undefined,
): DatasetToolTurnRecord[] {
  return (records ?? []).filter(
    (record) => Array.isArray(record.columns) && !record.error,
  );
}

function tableItem(
  input: PanelToolInput,
  given: string | undefined,
  shownAt: string,
  turnRecords: readonly DatasetToolTurnRecord[] | undefined,
): TablePanelItem {
  const results = queryResults(turnRecords);
  if (!results.length) {
    throw new Error(
      'No query result in this turn to show: run the query first',
    );
  }
  const number = input.record ?? results.length;
  if (number < 1 || number > results.length) {
    throw new Error(
      `record ${number} does not exist: this turn has ${results.length} query results`,
    );
  }
  const record = results[number - 1];
  const allRows = record.rows ?? [];
  const rows = allRows.slice(0, STORED_ROWS_CAP);
  const rowCount = record.rowCount ?? allRows.length;
  const truncated =
    record.truncated === true ||
    allRows.length > rows.length ||
    rowCount > rows.length;
  return {
    id: randomUUID(),
    kind: 'table',
    title: given ?? tableTitle(record),
    shownAt,
    tool: record.tool,
    ...(record.input ? { input: record.input } : {}),
    columns: record.columns ?? [],
    rows,
    rowCount,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** The first sentence of the query's rationale, else `<tool> result`. */
function tableTitle(record: DatasetToolTurnRecord): string {
  const sentence = (record.rationale ?? '')
    .trim()
    .split(/(?<=[.!?])\s/)[0]
    ?.replace(/[.!?]+$/, '')
    .trim();
  return sentence ? sentence.slice(0, 120) : `${record.tool} result`;
}
