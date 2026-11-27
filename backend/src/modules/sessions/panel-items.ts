import type { PanelItem, SessionDoc } from './entities/session.entity';

/** Items kept per session; the oldest file, document and table go first. */
export const MAX_PANEL_ITEMS = 100;

/** The id of a visual's item: one per visual, upserted. */
export const visualItemId = (visualId: string) => `visual:${visualId}`;
const UPSERTED_KINDS = new Set<PanelItem['kind']>(['visual']);
/**
 * Kinds a stored session may still hold that this version no longer shows:
 * `phases` (the workflow now lives in the workflow bar) and `readiness` (the
 * Data Readiness Agent's reports, removed with her).
 */
const RETIRED_KINDS = new Set(['phases', 'readiness']);

/**
 * Every item the session shows, oldest first: the stored ones plus a
 * synthesized `visual:<id>` for each visual without one, stamped with the
 * visual's creation time, so sessions saved before panel items need no
 * migration. Stored items of a retired kind (`RETIRED_KINDS`) are dropped
 * here, at read time.
 */
export function withVisualItems(session: SessionDoc): PanelItem[] {
  const stored = (session.panelItems ?? []).filter(
    (item) => !RETIRED_KINDS.has(item.kind as string),
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
 * `items` with `item` added: a visual item replaces the one with
 * its id (re-stamping `shownAt`), any other is appended. Past
 * `MAX_PANEL_ITEMS`, the oldest file, document and table items are dropped.
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
