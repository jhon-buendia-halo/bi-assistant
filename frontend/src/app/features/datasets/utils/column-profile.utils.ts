/**
 * Pure formatters and matchers behind the column profile stats shown in
 * `entity-details` and the "profiled …" label in `catalog-browser`. Kept
 * dependency-free (no Angular, no HTTP) so they are cheap to unit test.
 */
import { ColumnProfile, DatasetColumnSnapshot } from '../services/datasets-api.service';
import { KnowledgeSnippet } from '../../knowledge/models/knowledge.model';

// ---------------------------------------------------------------------------
// Entity key matching — mirrors the backend's `normalizeEntityKey` /
// `entityKeysMatch` (backend/src/modules/knowledge/knowledge-ranking.ts) so a
// knowledge snippet's `entities` line up with a dataset's table keys
// regardless of whether either side carries a catalog prefix.
// ---------------------------------------------------------------------------

/** `catalog.schema.table` → `schema.table` (last two dot-segments). */
export function normalizeEntityKey(entity: string): string {
  const segments = (entity ?? '').split('.').filter(Boolean);
  return segments.slice(-2).join('.');
}

/** Exact match, or a match on the last two dot-segments of both sides. */
export function entityKeysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return normalizeEntityKey(a) === normalizeEntityKey(b);
}

/**
 * True when `snippet` is a knowledge note scoped to exactly `column` on
 * `entityKey` — the "context next to the definition" match: comparing only
 * the last two dot segments so a snippet written against a bare
 * `schema.table` still lines up with a catalog-qualified dataset entity.
 */
export function matchesColumn(
  snippet: KnowledgeSnippet,
  entityKey: string,
  column: string,
): boolean {
  if (!snippet.column || snippet.column !== column) return false;
  return (snippet.entities ?? []).some((entity) =>
    entityKeysMatch(entity, entityKey),
  );
}

/** Every snippet in `snippets` scoped to `entityKey`.`column`. */
export function knowledgeForColumn(
  snippets: KnowledgeSnippet[],
  entityKey: string,
  column: string,
): KnowledgeSnippet[] {
  return snippets.filter((snippet) => matchesColumn(snippet, entityKey, column));
}

/**
 * Groups `snippets` by column name for one entity, so a component can look
 * notes up per column with a single `Map.get` instead of re-filtering on
 * every render.
 */
export function groupKnowledgeByColumn(
  snippets: KnowledgeSnippet[],
  entityKey: string,
): Map<string, KnowledgeSnippet[]> {
  const map = new Map<string, KnowledgeSnippet[]>();
  for (const snippet of snippets) {
    if (!snippet.column) continue;
    if (!(snippet.entities ?? []).some((e) => entityKeysMatch(e, entityKey))) {
      continue;
    }
    const list = map.get(snippet.column) ?? [];
    list.push(snippet);
    map.set(snippet.column, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Relative time — "profiled 3 minutes ago" / "profiled just now".
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const JUST_NOW_THRESHOLD_MS = 45_000;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** `''` for an absent/invalid timestamp — the caller decides the fallback copy. */
export function relativeTime(
  iso: string | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = now.getTime() - then;
  if (diff < JUST_NOW_THRESHOLD_MS) return 'just now';
  if (diff < HOUR_MS) return plural(Math.round(diff / MINUTE_MS), 'minute');
  if (diff < DAY_MS) return plural(Math.round(diff / HOUR_MS), 'hour');
  if (diff < WEEK_MS) return plural(Math.round(diff / DAY_MS), 'day');
  if (diff < MONTH_MS) return plural(Math.round(diff / WEEK_MS), 'week');
  if (diff < YEAR_MS) return plural(Math.round(diff / MONTH_MS), 'month');
  return plural(Math.round(diff / YEAR_MS), 'year');
}

// ---------------------------------------------------------------------------
// Column profile summary — null rate, distinct count, min…max, magnitude.
// ---------------------------------------------------------------------------

const MAGNITUDE_HINTS: Record<
  NonNullable<ColumnProfile['magnitude']>,
  string
> = {
  'cents-like': 'cents — ÷100 for dollars',
  fraction: 'fraction — already 0..1',
  count: 'count',
  'large-integer': 'large integer',
};

export function magnitudeHint(
  magnitude: ColumnProfile['magnitude'] | undefined,
): string | undefined {
  return magnitude ? MAGNITUDE_HINTS[magnitude] : undefined;
}

export interface ProfileSummary {
  nullRatePct: string;
  distinctLabel: string;
  rangeLabel?: string;
  magnitudeHint?: string;
  constant: boolean;
}

/** Formats a `ColumnProfile` into display-ready strings for the column row. */
export function profileSummary(profile: ColumnProfile): ProfileSummary {
  const pct = Math.round((profile.nullRate ?? 0) * 100);
  return {
    nullRatePct: `${pct}% null`,
    distinctLabel:
      profile.distinctCount === 1
        ? '1 distinct value'
        : `${profile.distinctCount} distinct values`,
    rangeLabel:
      profile.min !== undefined && profile.max !== undefined
        ? `${profile.min}…${profile.max}`
        : undefined,
    magnitudeHint: magnitudeHint(profile.magnitude),
    constant: profile.constant,
  };
}

// ---------------------------------------------------------------------------
// Join target — "→ providers.id · many-to-one".
// ---------------------------------------------------------------------------

/** `undefined` when the column has no reference to render. */
export function formatCardinality(
  references: DatasetColumnSnapshot['references'] | undefined,
): string | undefined {
  if (!references) return undefined;
  const targetTable = references.entity.split('.').at(-1) ?? references.entity;
  const target = `${targetTable}.${references.column}`;
  return references.cardinality && references.cardinality !== 'unknown'
    ? `→ ${target} · ${references.cardinality}`
    : `→ ${target}`;
}

// ---------------------------------------------------------------------------
// Top values — collapse beyond a limit behind "+N more".
// ---------------------------------------------------------------------------

export interface VisibleValues<T> {
  shown: T[];
  hiddenCount: number;
}

export const DEFAULT_TOP_VALUES_LIMIT = 8;

export function visibleTopValues<T>(
  values: T[] | undefined,
  expanded: boolean,
  limit: number = DEFAULT_TOP_VALUES_LIMIT,
): VisibleValues<T> {
  const all = values ?? [];
  if (expanded || all.length <= limit) return { shown: all, hiddenCount: 0 };
  return { shown: all.slice(0, limit), hiddenCount: all.length - limit };
}
