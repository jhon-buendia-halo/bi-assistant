import type {
  DatasetColumnSnapshot,
  DatasetSnapshot,
} from '../../mastra/tool-services';
import {
  closestNames,
  matchEntity,
  nameSimilarity,
  qualifierMap,
  readEntities,
  resolveColumnRef,
  scanSql,
  scopeEntities,
  shortEntityName,
  type QualifierTarget,
  type ScopeEntity,
  type SqlColumnRef,
  type SqlScan,
  type SqlToken,
} from './sql-precheck';

/**
 * L3 `descriptiveErrors`: turn a raw datasource error (or an empty result)
 * into a hint the assistant can act on — the closest table/column names,
 * their types, a known value — instead of a bare driver message it can only
 * retry blind.
 *
 * Omni's first big win (engineering plan §9.7): "invest in providing great
 * error messages that were descriptive about what was happening and how you
 * might fix it". It matters most with the fixer off (`fixer-off` arm), where
 * the assistant — which knows the question — does the retry itself and has
 * nothing but this text to go on.
 *
 * Deterministic, from the dataset snapshot and its column profiles; no model
 * call. The original message always comes first and unchanged, so nothing
 * the engine said is lost; an error this module does not recognise is
 * returned exactly as it was.
 */

/** Separates the engine's message from what this module adds. */
export const SQL_HINT_MARKER = '\nHint: ';
/** Values listed per column in a hint — the profile keeps at most 25. */
const LISTED_VALUES = 25;
/** In-scope tables listed on an unknown-table error. */
const LISTED_TABLES = 10;

/** The text to surface for a failed `run_readonly_sql` call. Never throws. */
export function describeSqlError(
  error: unknown,
  sql: string,
  snapshots: DatasetSnapshot[],
): string {
  const message = error instanceof Error ? error.message : String(error);
  try {
    // The bridge describes the error itself when the fixer is off; a second
    // pass in the tool must not append the same hint twice.
    if (message.includes(SQL_HINT_MARKER)) return message;
    const entities = scopeEntities(snapshots);
    if (!entities.length) return message;
    const hints = errorHints(
      message,
      typeof sql === 'string' ? sql : '',
      entities,
    );
    return hints.length
      ? `${message}${SQL_HINT_MARKER}${hints.join(' ')}`
      : message;
  } catch {
    return message;
  }
}

/** Guidance to append when a statement succeeded but returned zero rows; `undefined` = nothing to add. Never throws. */
export function emptyResultHint(
  sql: string,
  snapshots: DatasetSnapshot[],
): string | undefined {
  try {
    const entities = scopeEntities(snapshots);
    if (!entities.length || typeof sql !== 'string') return undefined;
    const context = statementContext(sql, entities);
    const hints: string[] = [];
    const seen = new Set<string>();
    for (const filter of equalityFilters(context)) {
      const resolved = resolveColumn(filter.ref, context);
      if (!resolved) continue;
      const known = knownValues(resolved.column);
      if (!known) continue;
      const missing = filter.values.filter(
        (value) => !known.values.includes(value),
      );
      if (!missing.length) continue;
      const key = `${resolved.entity.key}.${resolved.column.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const listed = known.values.slice(0, LISTED_VALUES).join(', ');
      const verb = known.complete ? 'holds' : 'holds values such as';
      const recased = missing
        .map((value) => {
          const match = known.values.find(
            (candidate) => candidate.toLowerCase() === value.toLowerCase(),
          );
          return match ? `'${value}' is stored as '${match}'` : null;
        })
        .filter(Boolean);
      hints.push(
        `${resolved.column.name} ${verb}: ${listed} (case-sensitive)${recased.length ? ` — ${recased.join(', ')}` : ''}.`,
      );
    }
    return hints.length ? hints.join(' ') : undefined;
  } catch {
    return undefined;
  }
}

/* ---------------------------------------------------------------- errors */

interface StatementContext {
  scan: SqlScan;
  entities: ScopeEntity[];
  qualifiers: Map<string, QualifierTarget>;
  read: ScopeEntity[];
}

function statementContext(
  sql: string,
  entities: ScopeEntity[],
): StatementContext {
  const scan = scanSql(sql);
  return {
    scan,
    entities,
    qualifiers: qualifierMap(scan, entities),
    read: readEntities(scan, entities),
  };
}

/** `` `c`.`amount` `` / `"c.amount"` / `c.amount` → `['c', 'amount']`. */
function nameParts(raw: string): string[] {
  const backticked = [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const parts = backticked.length
    ? backticked
    : raw.replace(/"/g, '').split('.');
  return parts.map((part) => part.trim().toLowerCase()).filter(Boolean);
}

const COLUMN_PATTERNS: RegExp[] = [
  // Postgres: column "amount" does not exist / column c.amount does not exist
  /column\s+(?:"([^"]+)"|([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*))\s+does not exist/i,
  // Databricks: [UNRESOLVED_COLUMN.WITH_SUGGESTION] … with name `c`.`amount` cannot be resolved
  /UNRESOLVED_COLUMN[\s\S]*?with name\s+((?:`[^`]+`\.?)+)/i,
  // Older Spark: cannot resolve '`amount`' given input columns
  /cannot resolve '([^']+)' given input columns/i,
];

const TABLE_PATTERNS: RegExp[] = [
  /relation\s+"([^"]+)"\s+does not exist/i,
  /TABLE_OR_VIEW_NOT_FOUND[\s\S]*?table or view\s+((?:`[^`]+`\.?)+)/i,
  /Table or view not found:\s*([\w.`]+)/i,
];

function errorHints(
  message: string,
  sql: string,
  entities: ScopeEntity[],
): string[] {
  const context = statementContext(sql, entities);
  for (const pattern of COLUMN_PATTERNS) {
    const match = pattern.exec(message);
    if (!match) continue;
    const parts = nameParts(match[1] ?? match[2] ?? '');
    if (parts.length) return [unknownColumnHint(parts, context)];
  }
  for (const pattern of TABLE_PATTERNS) {
    const match = pattern.exec(message);
    if (!match) continue;
    const parts = nameParts(match[1] ?? '');
    if (parts.length) return [tablesInScopeHint(parts, entities)];
  }
  const missingAlias = /missing FROM-clause entry for table "([^"]+)"/i.exec(
    message,
  );
  if (missingAlias) {
    const aliases = [...context.qualifiers.keys()].filter(
      (name) => !name.includes('.'),
    );
    return [
      aliases.length
        ? `"${missingAlias[1]}" is not defined in this query — its tables and aliases are: ${aliases.join(', ')}.`
        : tablesInScopeHint([missingAlias[1].toLowerCase()], entities),
    ];
  }
  return typeHints(message, context);
}

function unknownColumnHint(parts: string[], context: StatementContext): string {
  const column = parts[parts.length - 1];
  if (parts.length > 1) {
    const qualifier = parts.slice(0, -1).join('.');
    const target = context.qualifiers.get(qualifier);
    const entity =
      target?.kind === 'entity'
        ? target.entity
        : (() => {
            const match = matchEntity(parts.slice(0, -1), context.entities);
            return match.status === 'known' ? match.entity : undefined;
          })();
    if (entity?.columns?.length) {
      const closest = closestNames(
        column,
        entity.columns.map((c) => c.name),
      );
      return `Closest columns on ${shortEntityName(entity.key)}: ${closest.join(', ')}.`;
    }
  }
  const owners = context.read.length ? context.read : context.entities;
  const candidates: { name: string; owner: string }[] = [];
  for (const entity of owners) {
    for (const c of entity.columns ?? []) {
      candidates.push({ name: c.name, owner: shortEntityName(entity.key) });
    }
  }
  // A column the query itself defines (a CTE or output alias) is as likely
  // a target as a table column — pointing only at tables would misdirect.
  for (const alias of context.scan.outputAliases) {
    candidates.push({ name: alias, owner: 'this query' });
  }
  if (!candidates.length) return tablesInScopeHint([column], context.entities);
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      score: nameSimilarity(column, candidate.name),
    }))
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, 3);
  const byOwner = new Map<string, string[]>();
  for (const entry of ranked) {
    byOwner.set(entry.owner, [...(byOwner.get(entry.owner) ?? []), entry.name]);
  }
  const groups = [...byOwner.entries()].map(([owner, names]) =>
    owner === 'this query'
      ? `defined in this query: ${names.join(', ')}`
      : `on ${owner}: ${names.join(', ')}`,
  );
  return `Closest columns ${groups.join('; ')}.`;
}

function tablesInScopeHint(parts: string[], entities: ScopeEntity[]): string {
  const target = parts[parts.length - 1];
  const tables = closestNames(
    target,
    entities.map((entity) => entity.parts[entity.parts.length - 1]),
    entities.length,
  ).flatMap((table) =>
    entities
      .filter((entity) => entity.parts[entity.parts.length - 1] === table)
      .map((entity) => entity.key),
  );
  const shown = tables.slice(0, LISTED_TABLES);
  const more =
    tables.length > shown.length
      ? ` (+${tables.length - shown.length} more)`
      : '';
  return `Tables in scope: ${shown.join(', ')}${more}.`;
}

/* ------------------------------------------------------------ type errors */

type TypeFamily =
  'text' | 'integer' | 'numeric' | 'date' | 'timestamp' | 'boolean' | 'other';

function typeFamily(type: string): TypeFamily {
  const t = (type ?? '').toLowerCase();
  if (/(char|text|string|citext|uuid|enum)/.test(t)) return 'text';
  if (/timestamp|datetime/.test(t)) return 'timestamp';
  if (/\bdate\b/.test(t)) return 'date';
  if (/bool/.test(t)) return 'boolean';
  if (
    /(^|[^a-z])(int|integer|bigint|smallint|tinyint|long|int2|int4|int8|short)([^a-z]|$)/.test(
      t,
    )
  )
    return 'integer';
  if (/(numeric|decimal|double|float|real|number)/.test(t)) return 'numeric';
  return 'other';
}

/** Postgres / Databricks type error → the columns involved, with their type and a real value. */
function typeHints(message: string, context: StatementContext): string[] {
  const refs: SqlColumnRef[] = [];
  const operator =
    /operator does not exist:\s*([\w ]+?)\s*(=|<>|!=|<=|>=|<|>|~~\*?|\+|-)\s*([\w ]+?)(?:\s*[—;.\n]|\s*$|\s+HINT)/i.exec(
      message,
    );
  const invalidInput =
    /invalid input (?:syntax|value) for (?:type|enum) ([\w. ]+?):\s*"([^"]*)"/i.exec(
      message,
    ) ?? /CAST_INVALID_INPUT[\s\S]*?The value '([^']*)'/i.exec(message);
  const mismatch = /DATATYPE_MISMATCH[\s\S]*?Cannot resolve "([^"]+)"/i.exec(
    message,
  );
  const fn = /function\s+([\w.]+)\(([^)]*)\)\s+does not exist/i.exec(message);

  if (operator) {
    const families = new Set([
      typeFamily(operator[1]),
      typeFamily(operator[3]),
    ]);
    for (const ref of context.scan.columnRefs) {
      if (!comparedToLiteral(context.scan, ref)) continue;
      const resolved = resolveColumn(ref, context);
      if (resolved && families.has(typeFamily(resolved.column.type)))
        refs.push(ref);
    }
  } else if (invalidInput) {
    const literal = invalidInput.length > 2 ? invalidInput[2] : invalidInput[1];
    refs.push(...columnsComparedWith(context.scan, literal));
  } else if (mismatch) {
    const inner = scanSql(`SELECT ${mismatch[1]}`);
    const names = new Set(
      inner.columnRefs.map((ref) => ref.parts[ref.parts.length - 1]),
    );
    refs.push(
      ...context.scan.columnRefs.filter((ref) =>
        names.has(ref.parts[ref.parts.length - 1]),
      ),
    );
  } else if (fn) {
    const name = fn[1].toLowerCase().split('.').pop() ?? '';
    for (const aggregate of context.scan.aggregates) {
      if (aggregate.name !== name) continue;
      refs.push(
        ...context.scan.columnRefs.filter(
          (ref) => ref.first > aggregate.open && ref.last < aggregate.close,
        ),
      );
    }
  } else {
    return [];
  }

  const hints: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const resolved = resolveColumn(ref, context);
    if (!resolved) continue;
    const key = `${resolved.entity.key}.${resolved.column.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push(typeHint(resolved.column, !!invalidInput));
  }
  return hints;
}

function typeHint(column: DatasetColumnSnapshot, listValues: boolean): string {
  const known = knownValues(column);
  if (listValues && known && typeFamily(column.type) === 'text') {
    return `${column.name} is ${column.type} and ${known.complete ? 'holds' : 'holds values such as'}: ${known.values.slice(0, LISTED_VALUES).join(', ')}.`;
  }
  const sample =
    column.profile?.topValues?.[0]?.value ??
    column.sampleValues?.[0] ??
    column.profile?.min;
  if (sample === undefined || sample === null || sample === '') {
    return `${column.name} is ${column.type}.`;
  }
  const shown =
    typeFamily(column.type) === 'text' ? `'${sample}'` : String(sample);
  return `${column.name} is ${column.type}, e.g. ${shown}.`;
}

/* --------------------------------------------------------------- helpers */

function resolveColumn(
  ref: SqlColumnRef,
  context: StatementContext,
): { entity: ScopeEntity; column: DatasetColumnSnapshot } | null {
  const resolved = resolveColumnRef(ref, context.qualifiers);
  if (!resolved) return null;
  const find = (entity: ScopeEntity) =>
    entity.columns?.find(
      (column) => column.name.toLowerCase() === resolved.column.toLowerCase(),
    );
  if (resolved.target) {
    if (resolved.target.kind !== 'entity') return null;
    const column = find(resolved.target.entity);
    return column ? { entity: resolved.target.entity, column } : null;
  }
  // Bare name: only when exactly one table the query reads has it.
  const owners = context.read.filter((entity) => find(entity));
  if (owners.length !== 1) return null;
  const column = find(owners[0]);
  return column ? { entity: owners[0], column } : null;
}

function comparedToLiteral(scan: SqlScan, ref: SqlColumnRef): boolean {
  const after = scan.tokens[ref.last + 1];
  const value = scan.tokens[ref.last + 2];
  const before = scan.tokens[ref.first - 1];
  const earlier = scan.tokens[ref.first - 2];
  const literal = (token?: { kind: string }) =>
    token?.kind === 'string' || token?.kind === 'number';
  return (
    (after?.kind === 'operator' && literal(value)) ||
    (before?.kind === 'operator' && literal(earlier))
  );
}

/** Column refs compared with (or listed against) a literal holding `value`. */
function columnsComparedWith(scan: SqlScan, value: string): SqlColumnRef[] {
  const refs: SqlColumnRef[] = [];
  const byLast = new Map(scan.columnRefs.map((ref) => [ref.last, ref]));
  const byFirst = new Map(scan.columnRefs.map((ref) => [ref.first, ref]));
  scan.tokens.forEach((token, index) => {
    if (
      (token.kind !== 'string' && token.kind !== 'number') ||
      token.value !== value
    )
      return;
    const right = scan.tokens[index + 1];
    if (right?.kind === 'operator') {
      const ref = byFirst.get(index + 2);
      if (ref) refs.push(ref);
    }
    for (let j = index - 1; j >= 0 && j >= index - 60; j -= 1) {
      const t = scan.tokens[j];
      if (t.kind === 'identifier') {
        const ref = byLast.get(j);
        if (ref) refs.push(ref);
        break;
      }
      const skippable =
        t.kind === 'string' ||
        t.kind === 'number' ||
        (t.kind === 'punct' && (t.value === '(' || t.value === ',')) ||
        (t.kind === 'operator' && t.value !== '::') ||
        (t.kind === 'keyword' &&
          [
            'in',
            'not',
            'like',
            'ilike',
            'date',
            'timestamp',
            'interval',
          ].includes(t.value));
      if (!skippable) break;
    }
  });
  return refs;
}

/**
 * A literal's value: a `'string'`, or — Databricks reads `"PAID"` as a
 * string — a double-quoted name that is no column of the tables read.
 */
function literalValue(
  token: SqlToken | undefined,
  isColumn: (name: string) => boolean,
): string | undefined {
  if (!token) return undefined;
  if (token.kind === 'string') return token.value;
  if (
    token.kind === 'identifier' &&
    token.text.startsWith('"') &&
    !isColumn(token.value)
  ) {
    return token.text.slice(1, -1).replace(/""/g, '"');
  }
  return undefined;
}

/** `col = 'x'`, `'x' = col`, `col IN ('x', 'y')` with string literals. */
function equalityFilters(
  context: StatementContext,
): { ref: SqlColumnRef; values: string[] }[] {
  const { scan } = context;
  const columns = new Set(
    context.read.flatMap((entity) =>
      (entity.columns ?? []).map((column) => column.name.toLowerCase()),
    ),
  );
  const isColumn = (name: string) => columns.has(name.toLowerCase());
  const isEquals = (token: SqlToken | undefined) =>
    token?.kind === 'operator' && (token.value === '=' || token.value === '==');
  const filters: { ref: SqlColumnRef; values: string[] }[] = [];
  const byFirst = new Map(scan.columnRefs.map((ref) => [ref.first, ref]));
  const literalRefs = new Set<number>();
  for (const ref of scan.columnRefs) {
    const op = scan.tokens[ref.last + 1];
    const next = scan.tokens[ref.last + 2];
    const value = isEquals(op) ? literalValue(next, isColumn) : undefined;
    if (value !== undefined) {
      const after = scan.tokens[ref.last + 3];
      if (!after || after.kind !== 'operator') {
        filters.push({ ref, values: [value] });
        literalRefs.add(ref.last + 2);
      }
      continue;
    }
    if (
      op?.kind === 'keyword' &&
      op.value === 'in' &&
      next?.kind === 'punct' &&
      next.value === '('
    ) {
      const values: string[] = [];
      let j = ref.last + 3;
      for (; j < scan.tokens.length; j += 1) {
        const t = scan.tokens[j];
        const listed = literalValue(t, isColumn);
        if (listed !== undefined) values.push(listed);
        else if (t.kind === 'punct' && t.value === ',') continue;
        else break;
      }
      if (values.length && scan.tokens[j]?.value === ')')
        filters.push({ ref, values });
    }
  }
  scan.tokens.forEach((token, index) => {
    if (literalRefs.has(index)) return;
    const value = literalValue(token, isColumn);
    if (value === undefined || !isEquals(scan.tokens[index + 1])) return;
    const ref = byFirst.get(index + 2);
    if (ref) filters.push({ ref, values: [value] });
  });
  return filters;
}

/**
 * The values a column is known to hold. The profile's `topValues` are the
 * whole vocabulary when it has at most 25 distinct values; save-time
 * `sampleValues` are a handful from a 50-row sample, so they are only
 * examples.
 */
function knownValues(
  column: DatasetColumnSnapshot,
): { values: string[]; complete: boolean } | null {
  const top = column.profile?.topValues;
  if (top?.length) {
    return {
      values: top.map((entry) => String(entry.value)),
      complete: (column.profile?.distinctCount ?? Infinity) <= top.length,
    };
  }
  if (column.sampleValues?.length) {
    return { values: column.sampleValues.map(String), complete: false };
  }
  return null;
}
