/**
 * Join-graph inference from naming, for datasources that declare no foreign
 * keys (Databricks lakehouse tables almost never do).
 *
 * Without join hints the assistant invents them from the question, not the
 * schema: it writes `goals.team_id` when the column is `goals.scoring_team_id`
 * and the query dies on `column "team_id" does not exist`. When it guesses the
 * column right but skips the join entirely it answers "Team ID 5" instead of
 * "Belgium" — 40-60% of answers in the measured runs.
 *
 * The bias is deliberately asymmetric: a missing edge costs one extra
 * exploration step, a wrong edge is followed confidently and silently produces
 * a plausible, wrong number. Every rule below therefore bails on ambiguity
 * rather than picking a best candidate.
 */

import type {
  DatasetColumnSnapshot,
  DatasetEntitySnapshot,
} from './repositories/datasets.repository';

/** A join edge between two dataset entities. Entity keys are `catalog.schema.table`. */
export interface ForeignKeyEdge {
  from: { entity: string; column: string };
  to: { entity: string; column: string };
}

/** Suffixes that make a column look like a key rather than a measure. */
const KEY_SUFFIXES = ['id', 'key', 'code'] as const;
type KeySuffix = (typeof KEY_SUFFIXES)[number];

const KEY_COLUMN = new RegExp(`^(?:(.+)_)?(${KEY_SUFFIXES.join('|')})$`, 'i');

interface KeyColumnParts {
  /** `_`-separated tokens left of the suffix — empty for a bare `id`/`code`. */
  prefix: string[];
  suffix: KeySuffix;
}

/** `scoring_team_id` → `{ prefix: ['scoring','team'], suffix: 'id' }`. */
function parseKeyColumn(name: string): KeyColumnParts | null {
  const match = KEY_COLUMN.exec(name.trim());
  if (!match) return null;
  const prefix = (match[1] ?? '').toLowerCase().split('_').filter(Boolean);
  return { prefix, suffix: match[2].toLowerCase() as KeySuffix };
}

/**
 * Enough pluralisation to match `team_id` against a table called `teams` and
 * `match_id` against `matches` — the irregular plural that a naive `+ 's'`
 * gets wrong and that costs the single most-used join in the fixture schema.
 * Both sides are folded to the singular so the comparison works either way.
 */
function singularize(word: string): string {
  const lower = word.toLowerCase();
  // Too short to strip safely: `ids`, `os`, `as` are not plurals worth guessing.
  if (lower.length < 4) return lower;
  // matches → match, boxes → box, dishes → dish.
  if (/(?:s|x|z|ch|sh)es$/.test(lower)) return lower.slice(0, -2);
  // countries → country, cities → city (but not `series` → `serie`-ish noise:
  // the consonant guard is what keeps `movies` → `movy` from firing on vowels).
  if (/[^aeiou]ies$/.test(lower)) return `${lower.slice(0, -3)}y`;
  // address / status / analysis are singular already; stripping the `s` would
  // invent a table name that matches nothing (or worse, matches the wrong one).
  if (/(?:ss|us|is)$/.test(lower)) return lower;
  if (/s$/.test(lower)) return lower.slice(0, -1);
  return lower;
}

/** Case- and plural-insensitive form of a table or column-prefix name. */
function canonical(name: string): string {
  const tokens = name.toLowerCase().split('_').filter(Boolean);
  if (!tokens.length) return '';
  tokens[tokens.length - 1] = singularize(tokens[tokens.length - 1]);
  return tokens.join('_');
}

/** Last segment of `catalog.schema.table`; tolerates malformed keys. */
function tableNameOf(key: string): string {
  const parts = String(key ?? '')
    .split('.')
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function findColumn(
  entity: DatasetEntitySnapshot,
  name: string,
): DatasetColumnSnapshot | undefined {
  const wanted = name.toLowerCase();
  return entity.columns?.find((c) => c.name?.toLowerCase() === wanted);
}

/**
 * Is `column` plausibly what other tables point at? Only two shapes qualify:
 * a surrogate `id`/`code`/`key`, or the leading column of a table that has no
 * surrogate at all (the `match_team_statistics(match_id, team_id, …)` shape).
 * Nullable columns are excluded — a nullable column is a reference, not a key.
 */
function isPrimaryish(
  entity: DatasetEntitySnapshot,
  column: DatasetColumnSnapshot,
): boolean {
  const parts = parseKeyColumn(column.name ?? '');
  if (!parts || column.nullable) return false;
  if (!parts.prefix.length) return true;
  if (findColumn(entity, 'id')) return false;
  return entity.columns[0]?.name === column.name;
}

/**
 * Where a `<prefix>_<suffix>` column should land inside the matched table.
 * The candidate order keeps the suffix honest: a `_code` column joins to a
 * `code`, never to an `id`. Silently retargeting `host_country_code` at
 * `countries.id` would join a char(3) to a bigint and fail at runtime.
 */
function resolveTargetColumn(
  target: DatasetEntitySnapshot,
  matchedPrefix: string,
  suffix: KeySuffix,
): DatasetColumnSnapshot | null {
  for (const name of [suffix, `${matchedPrefix}_${suffix}`]) {
    const hit = findColumn(target, name);
    if (hit) return hit;
  }
  // Fallback: exactly one column of the right flavour, so there is nothing to
  // choose between. Two candidates means we do not know, which means no edge.
  const flavoured = (target.columns ?? []).filter((c) => {
    const parts = parseKeyColumn(c.name ?? '');
    return parts?.suffix === suffix;
  });
  return flavoured.length === 1 ? flavoured[0] : null;
}

/**
 * Join edges guessed from column and table naming. Only edges whose BOTH ends
 * are inside the given entity set are returned.
 */
export function inferRelationships(
  entities: DatasetEntitySnapshot[],
): ForeignKeyEdge[] {
  const snapshots = (entities ?? []).filter(
    (entity): entity is DatasetEntitySnapshot =>
      !!entity && Array.isArray(entity.columns),
  );

  // Canonical table name → entity. A collision (`sales.orders` and
  // `finance.order`) makes every match through that name ambiguous, so the
  // name is withdrawn instead of resolved by arbitrary precedence.
  const byName = new Map<string, DatasetEntitySnapshot | null>();
  for (const entity of snapshots) {
    const name = canonical(tableNameOf(entity.key));
    if (!name) continue;
    byName.set(name, byName.has(name) ? null : entity);
  }

  const edges: ForeignKeyEdge[] = [];
  const claimed = new Set<string>();

  const emit = (
    from: DatasetEntitySnapshot,
    column: DatasetColumnSnapshot,
    to: DatasetEntitySnapshot,
    target: DatasetColumnSnapshot,
  ): void => {
    // A self-edge is never a join, it is a naming coincidence
    // (`teams.team_id` is the key, not a reference to another row).
    if (to.key === from.key) return;
    const slot = `${from.key}|${column.name}`;
    if (claimed.has(slot)) return;
    claimed.add(slot);
    edges.push({
      from: { entity: from.key, column: column.name },
      to: { entity: to.key, column: target.name },
    });
  };

  // Rule 1 — suffix match on a key-looking column. Runs to completion before
  // rule 2 so that a table-name match always beats a shared-name match.
  for (const entity of snapshots) {
    for (const column of entity.columns) {
      const parts = parseKeyColumn(column.name ?? '');
      if (!parts || !parts.prefix.length) continue;
      // Strip left-hand qualifiers one token at a time: `scoring_team` has no
      // table, `team` does. Longest first, so `tournament_team_id` reaches
      // `tournament_teams` rather than stopping at `teams`.
      for (let start = 0; start < parts.prefix.length; start += 1) {
        const candidate = parts.prefix.slice(start).join('_');
        const target = byName.get(canonical(candidate));
        if (!target) continue;
        const targetColumn = resolveTargetColumn(
          target,
          candidate,
          parts.suffix,
        );
        if (targetColumn) emit(entity, column, target, targetColumn);
        break; // the table name matched; a shorter suffix would be a worse read
      }
    }
  }

  // Rule 2 — shared column name. Catches the dimensional naming rule 1 cannot
  // see: `claims.member_id` → `member_profiles.member_id`, where the target
  // table name says nothing about the column.
  for (const entity of snapshots) {
    for (const column of entity.columns) {
      const parts = parseKeyColumn(column.name ?? '');
      if (!parts || !parts.prefix.length) continue;
      if (claimed.has(`${entity.key}|${column.name}`)) continue;
      // If the column is this table's own key, a same-named key elsewhere is a
      // sibling, not a parent — `countries.code` does not reference
      // `confederations.code` just because both tables are keyed `code`.
      if (isPrimaryish(entity, column)) continue;
      const hosts = snapshots.filter((other) => {
        if (other.key === entity.key) return false;
        const hit = findColumn(other, column.name);
        return !!hit && isPrimaryish(other, hit);
      });
      if (hosts.length !== 1) continue;
      const target = findColumn(hosts[0], column.name);
      if (target) emit(entity, column, hosts[0], target);
    }
  }

  return edges;
}

/**
 * Merge join edges onto the columns they belong to. One reference per column,
 * declared beating inferred, so a hint the datasource guarantees is never
 * displaced by a guess.
 */
export function applyReferences(
  entities: DatasetEntitySnapshot[],
  declared: ForeignKeyEdge[],
  inferred: ForeignKeyEdge[],
): DatasetEntitySnapshot[] {
  const byColumn = new Map<
    string,
    { entity: string; column: string; source: 'declared' | 'inferred' }
  >();
  for (const edge of inferred) {
    if (!edge?.from?.entity || !edge?.to?.entity) continue;
    byColumn.set(`${edge.from.entity}.${edge.from.column}`, {
      entity: edge.to.entity,
      column: edge.to.column,
      source: 'inferred',
    });
  }
  for (const edge of declared) {
    if (!edge?.from?.entity || !edge?.to?.entity) continue;
    byColumn.set(`${edge.from.entity}.${edge.from.column}`, {
      entity: edge.to.entity,
      column: edge.to.column,
      source: 'declared',
    });
  }
  if (!byColumn.size) return entities;
  return entities.map((entity) => {
    if (!entity?.key) return entity;
    let touched = false;
    const columns = (entity.columns ?? []).map((column) => {
      const reference = byColumn.get(`${entity.key}.${column.name}`);
      if (!reference) return column;
      touched = true;
      return { ...column, references: reference };
    });
    return touched ? { ...entity, columns } : entity;
  });
}
