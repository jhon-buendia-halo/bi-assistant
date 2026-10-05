// Pure, DI-free system-context builders shared by `SessionsService` (a real
// chat turn), the assistant eval harness (no session, but the same
// datasets), and `KnowledgeService` (mining drafts from a dataset's schema).
// No Nest DI here, same pattern as `tool-services.ts`.
import type {
  ColumnProfile,
  DatasetColumnSnapshot,
  DatasetSnapshot,
} from './tool-services';

/** Join hints shown up front to the assistant — enough for a wide dataset. */
const JOIN_HINT_CHARS = 1_500;
/** Default character budget for `schemaSnapshotBlock` when unspecified. */
const DEFAULT_SCHEMA_BLOCK_CHARS = 6_000;
/** Default sample values shown per column when unspecified. */
const DEFAULT_SCHEMA_BLOCK_SAMPLE_VALUES = 3;
/** Default character budget for `schemaCardBlock` when unspecified. */
const DEFAULT_SCHEMA_CARD_CHARS = 3_500;
/** Knowledge snippet body length shown inline on a card (§9.7). */
const SCHEMA_CARD_NOTE_BODY_CHARS = 160;
/** One-line explanation the schema-card block opens with. */
const SCHEMA_CARD_HEADER =
  'Schema cards — column facts measured when the dataset was saved; values are exact, not samples.';

/** Plain-language label for a profiled column's numeric scale. */
const MAGNITUDE_LABELS: Record<
  NonNullable<ColumnProfile['magnitude']>,
  string
> = {
  'cents-like': 'cents (÷100 for dollars)',
  fraction: 'fraction (0…1)',
  count: 'count',
  'large-integer': 'large integer',
};

/**
 * ` -> teams.id` for a key column, so a schema line states where it joins.
 * `~>` marks an inferred edge: the model should trust it less than a declared
 * one and can confirm with describe_entity.
 */
export function referenceSuffix(column: DatasetColumnSnapshot): string {
  const reference = column.references;
  if (!reference?.entity || !reference?.column) return '';
  const arrow = reference.source === 'declared' ? '->' : '~>';
  return ` ${arrow} ${reference.entity}.${reference.column}`;
}

/**
 * ` (one-to-many)` appended to a reference line when the profiling pass
 * (U1-C) could tell how the two sides relate. Absent/`'unknown'` renders
 * nothing, so callers that never see a known cardinality are unaffected.
 */
function cardinalitySuffix(column: DatasetColumnSnapshot): string {
  const cardinality = column.references?.cardinality;
  if (!cardinality || cardinality === 'unknown') return '';
  return ` (${cardinality})`;
}

/**
 * The join graph, stated up front. Without it the assistant knows which
 * entities exist but not which column joins to which, so it guesses — writing
 * `goals.team_id` where the column is `goals.scoring_team_id`, which fails the
 * query and ends in an answer naming a raw id instead of a team.
 */
export function joinHintBlock(datasets: DatasetSnapshot[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  let budget = JOIN_HINT_CHARS;
  for (const dataset of datasets) {
    for (const entity of dataset.entities ?? []) {
      for (const column of entity.columns ?? []) {
        const suffix = referenceSuffix(column);
        if (!suffix) continue;
        const line = `- ${entity.key}.${column.name}${suffix}${cardinalitySuffix(column)}`;
        if (seen.has(line)) continue;
        if (line.length > budget) return joinHintHeader(lines);
        budget -= line.length;
        seen.add(line);
        lines.push(line);
      }
    }
  }
  return joinHintHeader(lines);
}

function joinHintHeader(lines: string[]): string {
  if (!lines.length) return '';
  return [
    'How these entities join (-> declared by the datasource, ~> inferred from',
    'naming; join on these columns rather than guessing a key name):',
    ...lines,
  ].join('\n');
}

/**
 * Dataset/entity orientation lines: which datasets are in scope, the
 * fully-qualified entities they expose, and how those entities join. This is
 * the dataset-grounding half of `SessionsService.agentContext`'s first
 * system block — extracted so the assistant eval harness, which has no
 * session, can still ground the model in the same datasets/join-hints a real
 * turn would see.
 */
export function entityOrientationLines(
  datasetNames: string[],
  datasets: DatasetSnapshot[],
): string[] {
  const entityLines = datasets.flatMap((s) =>
    s.tables.map(
      (t) =>
        `- ${t} (dataset: ${s.name}; datasource: ${s.datasourceKind ?? 'unknown'} ${s.datasourceId ?? ''})`,
    ),
  );
  const joinHints = joinHintBlock(datasets);
  return [
    `Datasets for this session: ${datasetNames.join(', ')}.`,
    'Entities available (fully-qualified catalog.schema.table):',
    ...(entityLines.length ? entityLines : ['(none — the datasets are empty)']),
    'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
    ...(joinHints ? ['', joinHints] : []),
  ];
}

/**
 * Compact `{...}` suffix appended to a `schemaSnapshotBlock` column when
 * `options.profiles` is on — distinct count, constant flag and top values,
 * the same facts `schemaCardBlock` renders at length, sized instead for the
 * verifier's terser one-line-per-column schema.
 */
function profileSnapshotSuffix(profile?: ColumnProfile): string {
  if (!profile) return '';
  if (profile.constant) {
    const value = profile.topValues?.[0]?.value ?? profile.min;
    return value === undefined ? ' {constant}' : ` {constant '${value}'}`;
  }
  if (profile.topValues?.length && profile.distinctCount <= 25) {
    return ` {${profile.distinctCount} distinct: ${profile.topValues.map((v) => v.value).join(', ')}}`;
  }
  if (profile.distinctCount) {
    return ` {${profile.distinctCount} distinct}`;
  }
  return '';
}

/**
 * `entity(column type [e.g. a, b], …)` lines with real sample values —
 * richer than a bare schema listing because sample values let a model match
 * filter literals (or a knowledge-mining pass match enum-like values) to
 * real data. Shared by the SQL verifier (`SessionsService.verifierContext`)
 * and the knowledge-bootstrap agent (`KnowledgeService.bootstrap`) so
 * neither duplicates this formatting.
 *
 * `options.profiles` (default off, byte-identical output when omitted)
 * appends each column's distinct count / constant flag / top values (U1-C)
 * for the verifier, which checks a candidate SQL statement against the
 * schema and benefits from the same exact facts `schemaCardBlock` shows the
 * assistant.
 */
export function schemaSnapshotBlock(
  datasets: DatasetSnapshot[],
  options: {
    budgetChars?: number;
    sampleValues?: number;
    profiles?: boolean;
  } = {},
): string {
  const budgetChars = options.budgetChars ?? DEFAULT_SCHEMA_BLOCK_CHARS;
  const sampleValues =
    options.sampleValues ?? DEFAULT_SCHEMA_BLOCK_SAMPLE_VALUES;
  const profiles = options.profiles ?? false;
  const lines: string[] = [];
  let budget = budgetChars;
  for (const dataset of datasets) {
    for (const key of dataset.tables) {
      const columns =
        dataset.entities?.find((e) => e.key === key)?.columns ?? [];
      const described = columns.map((column) => {
        const samples = (column.sampleValues ?? []).slice(0, sampleValues);
        const shown = samples.length ? ` [e.g. ${samples.join(', ')}]` : '';
        const profileSuffix = profiles
          ? profileSnapshotSuffix(column.profile)
          : '';
        return `${column.name} ${column.type}${shown}${referenceSuffix(column)}${profileSuffix}`;
      });
      const line = `${key}(${described.join(', ')})`;
      if (line.length > budget) return lines.join('\n');
      budget -= line.length;
      lines.push(line);
    }
  }
  return lines.join('\n');
}

/** Groups digits in threes with a space, e.g. `1250000` -> `1 250 000`. */
function formatNumber(value: number): string {
  const sign = value < 0 ? '-' : '';
  const [intPart, fracPart] = Math.abs(value).toString().split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fracPart ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`;
}

/** `min`/`max` on a `ColumnProfile` are strings; group them when numeric. */
function formatProfileBound(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? formatNumber(n) : raw;
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

type SchemaCardKnowledgeNote = { kind: string; title: string; body: string };
type SchemaCardKnowledgeMap = Map<string, SchemaCardKnowledgeNote[]>;

/** `"title: body clipped to 160 chars"`, joined with `; ` when several apply. */
function renderNotes(notes: SchemaCardKnowledgeNote[]): string {
  return notes
    .map(
      (note) =>
        `${note.title}: ${clipText(note.body, SCHEMA_CARD_NOTE_BODY_CHARS)}`,
    )
    .join('; ');
}

/**
 * The facts a profiled column earns on its schema-card line: constant value,
 * else low-cardinality enum values, else a numeric magnitude reading with its
 * observed range — plus null rate whenever it is non-zero, independent of
 * which of those applies.
 */
function profileFacts(profile?: ColumnProfile): string[] {
  if (!profile) return [];
  const facts: string[] = [];
  if (profile.constant) {
    const value = profile.topValues?.[0]?.value ?? profile.min;
    if (value !== undefined) facts.push(`constant '${value}'`);
  } else if (profile.topValues?.length && profile.distinctCount <= 25) {
    facts.push(
      `${profile.distinctCount} values: ${profile.topValues.map((v) => v.value).join(', ')}`,
    );
  } else if (profile.magnitude) {
    const label = MAGNITUDE_LABELS[profile.magnitude];
    const hasRange = profile.min !== undefined && profile.max !== undefined;
    facts.push(
      hasRange
        ? `${label}, ${formatProfileBound(profile.min!)}…${formatProfileBound(profile.max!)}`
        : label,
    );
  }
  if (profile.nullRate > 0) {
    facts.push(`${Math.round(profile.nullRate * 100)}% null`);
  }
  return facts;
}

/**
 * One column line on a schema card, e.g. `status text — 4 values: PAID,
 * DENIED, PENDING, REVERSED` or `provider_id int -> providers.id
 * (many-to-one)`. `null` when the column carries nothing beyond its name and
 * type — no profile fact, no join target, no inline knowledge — so the card
 * leaves it off rather than padding itself with empty lines.
 */
function schemaCardColumnLine(
  entityKey: string,
  column: DatasetColumnSnapshot,
  knowledgeByColumn?: SchemaCardKnowledgeMap,
): string | null {
  const facts = profileFacts(column.profile);
  const reference = `${referenceSuffix(column)}${cardinalitySuffix(column)}`;
  const notes = knowledgeNotes(knowledgeByColumn, entityKey, `.${column.name}`);

  if (!facts.length && !reference && !notes?.length) return null;

  let line = `${column.name} ${column.type}${reference}`;
  if (facts.length) line += ` — ${facts.join('; ')}`;
  if (notes?.length) line += ` — note: "${renderNotes(notes)}"`;
  return line;
}

/**
 * Knowledge entries for an entity (or one of its columns). `KnowledgeService`
 * keys the map by the entity's last two dotted segments (`schema.table`),
 * the same rule `suiteDatasetError` matches on, while dataset snapshots carry
 * the full inventory key (`catalog.schema.table`) — so try the full key
 * first, then the schema-qualified one. Without the fallback no inline note
 * would ever match a Postgres or Databricks snapshot key.
 */
function knowledgeNotes(
  knowledgeByColumn: SchemaCardKnowledgeMap | undefined,
  entityKey: string,
  suffix: string,
): { kind: string; title: string; body: string }[] | undefined {
  if (!knowledgeByColumn) return undefined;
  const exact = knowledgeByColumn.get(`${entityKey}${suffix}`);
  if (exact?.length) return exact;
  const schemaQualified = entityKey.split('.').slice(-2).join('.');
  return schemaQualified === entityKey
    ? exact
    : knowledgeByColumn.get(`${schemaQualified}${suffix}`);
}

/** Rows the profiling pass counted for an entity — `COUNT(*)`, so exact. */
function entityRowCount(columns: DatasetColumnSnapshot[]): number | undefined {
  for (const column of columns) {
    if (column.profile) return column.profile.sampledRows;
  }
  return undefined;
}

/**
 * One card for one entity: header line (`key (≈N rows)`, plus an
 * entity-level knowledge note when `knowledgeByColumn` has one under the
 * bare entity key) followed by one indented line per informative column.
 * `null` when the entity has nothing to show — no profile on any column, no
 * entity note, no column earns a line — so the block never emits an
 * all-blank card.
 */
function buildSchemaCard(
  entity: { key: string; columns: DatasetColumnSnapshot[] },
  knowledgeByColumn?: SchemaCardKnowledgeMap,
): string | null {
  const rows = entityRowCount(entity.columns ?? []);
  const headerNotes = knowledgeNotes(knowledgeByColumn, entity.key, '');
  const columnLines = (entity.columns ?? [])
    .map((column) =>
      schemaCardColumnLine(entity.key, column, knowledgeByColumn),
    )
    .filter((line): line is string => line !== null);

  if (rows === undefined && !headerNotes?.length && !columnLines.length) {
    return null;
  }

  let header =
    rows === undefined
      ? entity.key
      : `${entity.key} (≈${formatNumber(rows)} rows)`;
  if (headerNotes?.length) header += ` — note: "${renderNotes(headerNotes)}"`;

  return [header, ...columnLines.map((line) => `  ${line}`)].join('\n');
}

/**
 * L2 `columnProfiles`: one compact card per entity —
 * `entity (≈N rows)` then one line per informative column (enum values,
 * constant flag, null rate, numeric magnitude + range, join target with
 * cardinality) — richer than `schemaSnapshotBlock`'s sample-value listing
 * because it carries the full save-time `ColumnProfile` (U1-C), plus, when
 * `knowledgeByColumn` is given, the Knowledge snippet that describes that
 * exact column (or, keyed by the bare entity, the whole entity) inline next
 * to the fact it explains (§9.7 "context localised next to the definition")
 * instead of only in the separate Knowledge block.
 *
 * A column with nothing beyond name/type is left off its card; an entity
 * with nothing beyond name/type on every column and no note is left off the
 * block entirely — a card never renders with no information in it. Budget is
 * spent one whole card at a time: a card that would not fit ends the block
 * rather than being cut mid-card. Returns `''` when no dataset carries a
 * profile and no knowledge applies, so a turn with none of that data omits
 * the block rather than sending an empty header.
 */
export function schemaCardBlock(
  datasets: DatasetSnapshot[],
  opts?: {
    budgetChars?: number;
    knowledgeByColumn?: Map<
      string,
      { kind: string; title: string; body: string }[]
    >;
  },
): string {
  const budgetChars = opts?.budgetChars ?? DEFAULT_SCHEMA_CARD_CHARS;
  const knowledgeByColumn = opts?.knowledgeByColumn;
  const cards: string[] = [];
  let budget = budgetChars - SCHEMA_CARD_HEADER.length;
  for (const dataset of datasets) {
    for (const entity of dataset.entities ?? []) {
      const card = buildSchemaCard(entity, knowledgeByColumn);
      if (!card) continue;
      if (card.length > budget) return schemaCardOutput(cards);
      budget -= card.length;
      cards.push(card);
    }
  }
  return schemaCardOutput(cards);
}

function schemaCardOutput(cards: string[]): string {
  if (!cards.length) return '';
  return [SCHEMA_CARD_HEADER, '', cards.join('\n\n')].join('\n');
}
