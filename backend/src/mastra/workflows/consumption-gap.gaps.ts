/**
 * The deterministic code of Consumption Gap Analysis (agents.md 5.20): the
 * questions and layers of a run, the requirements a dashboard implies, the
 * Confirm requirements question, the check of the model's mapping and fixes
 * against the catalogs, the tracing of every gap through the lineage, and
 * the probe queries and what they change. Pure code, no framework import.
 */
import type {
  ColumnRef,
  FieldAssessment,
  FieldMapping,
  FieldSource,
  GapFix,
  GapStatus,
  Layer,
  LayerSchemaNote,
  LayerTable,
  Lineage,
  LineageEdge,
  ReferenceDashboard,
  Requirement,
  RequirementAssessment,
  RequirementField,
  StatusCounts,
} from './consumption-gap-analysis.schemas';
import {
  CONFIRM_REQUIREMENTS_OPTION,
  GAP_MAX_QUESTIONS,
  type ConsumptionGapRuntime,
  type GapQuery,
  type GapQueryResult,
} from './consumption-gap-analysis.steps';
import {
  countOf,
  gapDialectOf,
  quoteIdentifier,
  rowValue,
  shortEntity,
  tableReference,
  textType,
  type GapDialect,
} from './consumption-gap.lineage';

/** Best first. A requirement's status is the worst of its fields'. */
export const GAP_STATUS_ORDER: readonly GapStatus[] = [
  'supported',
  'derivable',
  'grain',
  'normalized-only',
  'landing-only',
  'missing',
];

/** The most entities and columns per entity Load layer catalogs keeps. */
export const LAYER_TABLES_MAX = 80;
export const LAYER_COLUMNS_MAX = 60;

/** The most probe queries per requirement, and per run. */
export const PROBES_PER_REQUIREMENT = 2;
export const PROBES_MAX = 40;

/** The result column of a coverage probe that counts the rows. */
export const PROBE_TOTAL_COLUMN = 'total_rows';

const LAYERS: readonly Layer[] = ['landing', 'normalized', 'consumption'];
const LAYER_RANK: Record<Layer, number> = {
  landing: 0,
  normalized: 1,
  consumption: 2,
};

function rank(status: GapStatus): number {
  return GAP_STATUS_ORDER.indexOf(status);
}

function worst(statuses: readonly GapStatus[]): GapStatus {
  return statuses.reduce<GapStatus>(
    (acc, status) => (rank(status) > rank(acc) ? status : acc),
    'supported',
  );
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(values: readonly string[]): string {
  return values.join(', ');
}

// ---------------------------------------------------------------------------
// Questions and layers

/**
 * The business questions of the input: one per non-empty line, list
 * markers (`-`, `*`, `1.`, `1)`) removed, duplicates dropped, at most
 * `GAP_MAX_QUESTIONS`. Throws `Write at least one business question` when
 * none is left.
 */
export function parseQuestions(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const question = line
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s*/, '')
      .trim();
    if (!question) continue;
    const key = question.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
    if (out.length >= GAP_MAX_QUESTIONS) break;
  }
  if (out.length === 0) throw new Error('Write at least one business question');
  return out;
}

type DatasetLayers = Awaited<
  ReturnType<ConsumptionGapRuntime['datasetLayers']>
>;

function layerOf(value: string | undefined): Layer | undefined {
  const layer = (value ?? '').trim().toLowerCase();
  return (LAYERS as readonly string[]).includes(layer)
    ? (layer as Layer)
    : undefined;
}

/**
 * Every tagged schema of the datasets, Landing first, then Normalized,
 * then Consumption (by key within a layer). Throws `No schema of the
 * datasets <names> is tagged Consumption. Tag one in the dataset's schema
 * notes (Datasets → schema → Layer).` when none is.
 */
export function resolveLayers(datasets: DatasetLayers): LayerSchemaNote[] {
  const notes: LayerSchemaNote[] = [];
  const seen = new Set<string>();
  for (const dataset of datasets) {
    for (const schema of dataset.schemas) {
      const layer = layerOf(schema.layer);
      const key = schema.key.trim();
      if (!layer || !key || seen.has(key.toLowerCase())) continue;
      seen.add(key.toLowerCase());
      notes.push({
        schemaKey: key,
        layer,
        dataset: dataset.dataset,
        description: schema.description ?? '',
      });
    }
  }
  if (!notes.some((note) => note.layer === 'consumption')) {
    const names = list(datasets.map((d) => d.dataset));
    throw new Error(
      `No schema of the datasets ${names} is tagged Consumption. Tag one in the dataset's schema notes (Datasets → schema → Layer).`,
    );
  }
  return notes.sort(
    (a, b) =>
      LAYER_RANK[a.layer] - LAYER_RANK[b.layer] ||
      a.schemaKey.localeCompare(b.schemaKey),
  );
}

/**
 * The entities under the tagged schemas (an entity `c.s.t` is under the
 * note `c.s`), with their layer and columns, capped at `LAYER_TABLES_MAX`
 * entities and `LAYER_COLUMNS_MAX` columns each. Consumption first, then
 * Normalized, then Landing, by key within a layer.
 */
export function layerTables(
  datasets: DatasetLayers,
  layers: readonly LayerSchemaNote[],
): LayerTable[] {
  const out: LayerTable[] = [];
  const seen = new Set<string>();
  for (const dataset of datasets) {
    for (const entity of dataset.entities) {
      const cut = entity.key.lastIndexOf('.');
      if (cut <= 0) continue;
      const schemaKey = entity.key.slice(0, cut);
      const note = layers.find((n) => same(n.schemaKey, schemaKey));
      if (!note || seen.has(entity.key.toLowerCase())) continue;
      seen.add(entity.key.toLowerCase());
      const columns = entity.columns ?? [];
      out.push({
        entity: entity.key,
        layer: note.layer,
        dataset: dataset.dataset,
        datasourceId: dataset.datasourceId,
        datasourceKind: dataset.datasourceKind,
        columns: columns
          .slice(0, LAYER_COLUMNS_MAX)
          .map((c) => ({ name: c.name, type: c.type })),
        more: Math.max(0, columns.length - LAYER_COLUMNS_MAX),
      });
    }
  }
  return out
    .sort(
      (a, b) =>
        LAYER_RANK[b.layer] - LAYER_RANK[a.layer] ||
        a.entity.localeCompare(b.entity),
    )
    .slice(0, LAYER_TABLES_MAX);
}

// ---------------------------------------------------------------------------
// Dashboard requirements

const PERIOD_NAME =
  /(^|_)(year|years|date|month|quarter|week|day|period|time|season|anio|ano|fecha|mes|periodo)(_|$)/i;
const PERIOD_VALUE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/**
 * The requirements a dashboard implies, from its blueprint alone: one per
 * widget that reads data (`W1`… across all dashboards, in order) and one
 * per filter (`F1`…). A widget's fields are its measures (role `measure`,
 * the measure's aggregation) and its dimension (role `time` when the
 * blueprint column is a date or its name is a period, else `dimension`);
 * its grain is its dimension. A filter's field is its column (role
 * `filter`); its period values are its options that read as a year or a
 * date, when its column is a period.
 */
export function dashboardRequirements(
  dashboards: readonly ReferenceDashboard[],
): Requirement[] {
  const widgets: Requirement[] = [];
  const filters: Requirement[] = [];
  for (const dashboard of dashboards) {
    const { blueprint } = dashboard;
    const columnOf = (name: string) =>
      blueprint.columns.find((c) => same(c.name, name));
    for (const widget of blueprint.widgets) {
      const fields: RequirementField[] = [];
      const add = (field: RequirementField) => {
        if (field.name && !fields.some((f) => same(f.name, field.name))) {
          fields.push(field);
        }
      };
      for (const measure of widget.measures) {
        add({
          name: measure.column.trim() || measure.label.trim(),
          role: 'measure',
          aggregation: measure.aggregation,
          description: measure.label,
        });
      }
      const dimension = widget.dimension.trim();
      if (dimension) {
        const column = columnOf(dimension);
        add({
          name: dimension,
          role:
            column?.type === 'date' || PERIOD_NAME.test(dimension)
              ? 'time'
              : 'dimension',
          aggregation: '',
          description: column?.description || `What ${widget.title} is by`,
        });
      }
      if (fields.length === 0) continue;
      widgets.push({
        id: `W${widgets.length + 1}`,
        kind: 'widget',
        title: widget.title || `${widget.kind} widget`,
        source: `${dashboard.name} · ${widget.kind}`,
        dashboardId: dashboard.id,
        ref: widget.id,
        fields,
        grain: dimension,
        periodValues: [],
      });
    }
    for (const filter of blueprint.filters) {
      const name = filter.column.trim() || filter.label.trim();
      const column = columnOf(name);
      const isPeriod = column?.type === 'date' || PERIOD_NAME.test(name);
      filters.push({
        id: `F${filters.length + 1}`,
        kind: 'filter',
        title: filter.label || name,
        source: `${dashboard.name} · ${filter.kind} filter`,
        dashboardId: dashboard.id,
        ref: filter.id,
        fields: name
          ? [
              {
                name,
                role: 'filter',
                aggregation: '',
                description:
                  column?.description || `The ${filter.label} filter`,
              },
            ]
          : [],
        grain: '',
        periodValues: isPeriod
          ? filter.options.filter((o) => PERIOD_VALUE.test(o.trim()))
          : [],
      });
    }
  }
  return [...widgets, ...filters];
}

// ---------------------------------------------------------------------------
// Confirm requirements

function requirementLine(requirement: Requirement): string {
  const of = (role: RequirementField['role']) =>
    requirement.fields.filter((f) => f.role === role);
  const parts: string[] = [];
  const measures = of('measure').map((f) =>
    f.aggregation ? `${f.name} (${f.aggregation})` : f.name,
  );
  if (measures.length) parts.push(`measures ${list(measures)}`);
  const by = [...of('dimension'), ...of('time')].map((f) => f.name);
  if (by.length) parts.push(`by ${list(by)}`);
  const filters = of('filter').map((f) => f.name);
  if (filters.length) parts.push(`filters ${list(filters)}`);
  if (requirement.grain) parts.push(`grain ${requirement.grain}`);
  if (requirement.periodValues.length) {
    parts.push(`periods ${list(requirement.periodValues)}`);
  }
  const detail = parts.length ? ` — ${parts.join('; ')}` : '';
  return `- **${requirement.id}** ${requirement.title}${detail}`;
}

/** The Confirm requirements question (Markdown) and its one option. */
export function confirmQuestion(requirements: readonly Requirement[]): {
  question: string;
  options: string[];
} {
  const groups: Array<[string, Requirement['kind']]> = [
    ['Questions', 'question'],
    ['Dashboard widgets', 'widget'],
    ['Filters', 'filter'],
  ];
  const lines = [
    'These are the requirements I will check against the Consumption layer:',
  ];
  for (const [heading, kind] of groups) {
    const items = requirements.filter((r) => r.kind === kind);
    if (!items.length) continue;
    lines.push('', `**${heading}**`, '', ...items.map(requirementLine));
  }
  lines.push(
    '',
    `Answer **${CONFIRM_REQUIREMENTS_OPTION}** to check them as they are, or say what to drop, add or change.`,
  );
  return { question: lines.join('\n'), options: [CONFIRM_REQUIREMENTS_OPTION] };
}

function plain(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The phrases that confirm (accents, case and punctuation ignored). */
export const CONFIRMATION_PHRASES: readonly string[] = [
  'yes',
  'y',
  'yeah',
  'yep',
  'yup',
  'ok',
  'okay',
  'okey',
  'sure',
  'confirm',
  'confirmed',
  'i confirm',
  'confirm them',
  'confirm it',
  'confirm all',
  'correct',
  'right',
  'good',
  'looks good',
  'all good',
  'sounds good',
  'fine',
  'lgtm',
  'go',
  'go ahead',
  'go on',
  'proceed',
  'continue',
  'approved',
  'agreed',
  'si',
  'sip',
  'claro',
  'confirmo',
  'confirmar',
  'confirmado',
  'confirmados',
  'de acuerdo',
  'dale',
  'vale',
  'listo',
  'correcto',
  'perfecto',
  'adelante',
  'esta bien',
  'todo bien',
  'bien',
  'sigue',
  'continua',
];

/** Polite words a confirmation may carry; alone they confirm nothing. */
const CONFIRMATION_FILLERS = [
  'please',
  'thanks',
  'thank you',
  'por favor',
  'gracias',
];

/**
 * Whether an answer confirms the requirements as they are: the option, or
 * a short answer made only of confirmation phrases (yes, ok, confirm, sí,
 * confirmo, de acuerdo, dale…) and polite words, at most six words.
 * Anything else is feedback.
 */
export function isConfirmation(answer: string): boolean {
  const value = plain(answer);
  if (!value) return false;
  if (value === plain(CONFIRM_REQUIREMENTS_OPTION)) return true;
  const words = value.split(' ');
  if (words.length > 6) return false;
  const phrases = [
    ...CONFIRMATION_PHRASES.map((p) => ({ words: p.split(' '), yes: true })),
    ...CONFIRMATION_FILLERS.map((p) => ({ words: p.split(' '), yes: false })),
  ].sort((a, b) => b.words.length - a.words.length);
  let i = 0;
  let confirmed = false;
  while (i < words.length) {
    const match = phrases.find((p) =>
      p.words.every((word, k) => words[i + k] === word),
    );
    if (!match) return false;
    confirmed = confirmed || match.yes;
    i += match.words.length;
  }
  return confirmed;
}

// ---------------------------------------------------------------------------
// The Layer Mapper's reply

function itemsOf(reply: unknown, key: string): unknown[] {
  let value = reply;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const inner = (value as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The table an entity names: its key without case, else a unique suffix. */
function findTable(
  tables: readonly LayerTable[],
  entity: string,
): LayerTable | undefined {
  const key = entity.trim().toLowerCase();
  if (!key) return undefined;
  const exact = tables.find((t) => t.entity.toLowerCase() === key);
  if (exact) return exact;
  const suffix = tables.filter((t) =>
    t.entity.toLowerCase().endsWith(`.${key}`),
  );
  return suffix.length === 1 ? suffix[0] : undefined;
}

/**
 * The Layer Mapper's reply, read leniently and checked: one mapping per
 * field of every requirement (in requirement order); a source is kept only
 * when its entity is one of `tables` (matched without case, or by a unique
 * `schema.table` / `table` suffix, written with the catalog's spelling), its
 * column is one of that entity's, and its layer is the entity's own
 * (corrected when the reply named another).
 */
export function checkedMappings(
  reply: unknown,
  requirements: readonly Requirement[],
  tables: readonly LayerTable[],
): FieldMapping[] {
  const items = itemsOf(reply, 'mappings').map(record);
  const out: FieldMapping[] = [];
  for (const requirement of requirements) {
    for (const field of requirement.fields) {
      const item = items.find(
        (m) =>
          same(
            text(m.requirementId ?? m.requirement ?? m.id),
            requirement.id,
          ) && same(text(m.field ?? m.name), field.name),
      );
      const sources: FieldSource[] = [];
      const proposed: unknown = item?.sources;
      for (const raw of Array.isArray(proposed) ? proposed : []) {
        const source = record(raw);
        const table = findTable(tables, text(source.entity));
        const column = table?.columns.find((c) =>
          same(c.name, text(source.column)),
        );
        if (!table || !column) continue;
        if (
          sources.some(
            (s) => s.entity === table.entity && s.column === column.name,
          )
        ) {
          continue;
        }
        sources.push({
          layer: table.layer,
          entity: table.entity,
          column: column.name,
          expression: text(source.expression),
        });
      }
      out.push({
        requirementId: requirement.id,
        field: field.name,
        sources,
        note: text(item?.note),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trace gaps

const METHOD_RANK: Record<LineageEdge['method'], number> = {
  values: 4,
  mapped: 3,
  name: 2,
  'similar-name': 1,
};

function refKey(ref: ColumnRef): string {
  return `${ref.entity.toLowerCase()}|${ref.column.toLowerCase()}`;
}

function layerOfEntity(
  tables: readonly LayerTable[],
  entity: string,
): Layer | undefined {
  return findTable(tables, entity)?.layer;
}

function better(a: LineageEdge, b: LineageEdge): number {
  return (
    METHOD_RANK[b.method] - METHOD_RANK[a.method] || b.confidence - a.confidence
  );
}

/** The path from the lowest layer up to `ref`, through incoming edges. */
function pathTo(
  ref: ColumnRef,
  edges: readonly LineageEdge[],
  tables: readonly LayerTable[],
): ColumnRef[] {
  const path: ColumnRef[] = [{ entity: ref.entity, column: ref.column }];
  const visited = new Set([refKey(ref)]);
  let current = ref;
  for (;;) {
    const here = LAYER_RANK[layerOfEntity(tables, current.entity) ?? 'landing'];
    const incoming = edges
      .filter((e) => refKey(e.to) === refKey(current))
      .filter((e) => !visited.has(refKey(e.from)))
      .filter((e) => {
        const layer = layerOfEntity(tables, e.from.entity);
        return layer !== undefined && LAYER_RANK[layer] < here;
      })
      .sort(better);
    const edge = incoming[0];
    if (!edge) break;
    visited.add(refKey(edge.from));
    path.unshift({ entity: edge.from.entity, column: edge.from.column });
    current = edge.from;
  }
  return path;
}

/** The Consumption column an edge path leads to from `ref`, and the path. */
function reachConsumption(
  ref: ColumnRef,
  edges: readonly LineageEdge[],
  tables: readonly LayerTable[],
): ColumnRef[] | undefined {
  const sorted = [...edges].sort(better);
  const queue: ColumnRef[][] = [[ref]];
  const visited = new Set([refKey(ref)]);
  while (queue.length) {
    const path = queue.shift() as ColumnRef[];
    const last = path[path.length - 1];
    for (const edge of sorted) {
      if (refKey(edge.from) !== refKey(last) || visited.has(refKey(edge.to))) {
        continue;
      }
      const layer = layerOfEntity(tables, edge.to.entity);
      if (!layer) continue;
      visited.add(refKey(edge.to));
      const next = [
        ...path,
        { entity: edge.to.entity, column: edge.to.column },
      ];
      if (layer === 'consumption') return next;
      queue.push(next);
    }
  }
  return undefined;
}

/** The `mapped` edges of one field: each mapped layer to the next one up. */
function mappedEdges(sources: readonly FieldSource[]): LineageEdge[] {
  const byLayer = LAYERS.map((layer) =>
    sources.find((s) => s.layer === layer),
  ).filter((s): s is FieldSource => s !== undefined);
  const out: LineageEdge[] = [];
  for (let i = 0; i + 1 < byLayer.length; i += 1) {
    const from = byLayer[i];
    const to = byLayer[i + 1];
    out.push({
      from: { entity: from.entity, column: from.column },
      to: { entity: to.entity, column: to.column },
      method: 'mapped',
      confidence: 0.8,
      overlap: null,
      expression: from.expression,
    });
  }
  return out;
}

/** A column name that reads as a key: `id`, `<x>_id`, `<x>_key`, `<x>_code`. */
const KEY_COLUMN = /^(id|key|.+_(id|key|code))$/i;

/**
 * Whether the entities are joined, directly or through each other, by a
 * shared column that can carry the join: a key-like column, or one of the
 * requirement's own columns (`usable`, lower case). Sharing only another
 * column (a year both tables carry) would multiply rows, not join them.
 */
function joined(
  entities: readonly string[],
  tables: readonly LayerTable[],
  usable: ReadonlySet<string>,
) {
  if (entities.length < 2) return true;
  const columnsOf = (entity: string) =>
    new Set(
      (findTable(tables, entity)?.columns ?? []).map((c) =>
        c.name.toLowerCase(),
      ),
    );
  const sets = entities.map(columnsOf);
  const reached = new Set([0]);
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < sets.length; i += 1) {
      if (reached.has(i)) continue;
      const shares = [...reached].some((j) =>
        [...sets[i]].some(
          (name) =>
            sets[j].has(name) && (KEY_COLUMN.test(name) || usable.has(name)),
        ),
      );
      if (shares) {
        reached.add(i);
        grew = true;
      }
    }
  }
  return reached.size === entities.length;
}

function sourceLabel(source: FieldSource | null): string {
  return source ? `${shortEntity(source.entity)}.${source.column}` : '';
}

function reasonOf(
  status: GapStatus,
  fields: readonly FieldAssessment[],
  entities: readonly string[],
): string {
  const at = (s: GapStatus) => fields.filter((f) => f.status === s);
  const names = (items: readonly FieldAssessment[]) =>
    list(items.map((f) => f.field));
  const tablesOf = (items: readonly FieldAssessment[], upstream: boolean) =>
    list([
      ...new Set(
        items
          .map((f) => (upstream ? f.upstream : f.consumption))
          .filter((s): s is FieldSource => s !== null)
          .map((s) => shortEntity(s.entity)),
      ),
    ]);
  if (fields.length === 0) {
    return 'No field of this requirement could be named, so nothing can be checked.';
  }
  switch (status) {
    case 'supported':
      return `Every field is a Consumption column (${tablesOf(fields, false)}).`;
    case 'derivable': {
      const computed = at('derivable')
        .map((f) => `${f.field} = ${f.consumption?.expression ?? ''}`)
        .join('; ');
      return `Every field can be computed from Consumption columns: ${computed}.`;
    }
    case 'grain':
      return `The fields are in Consumption, but in entities that share no column to join on (${list(entities.map(shortEntity))}).`;
    case 'normalized-only':
      return `${names(at('normalized-only'))} ${at('normalized-only').length > 1 ? 'are' : 'is'} in Normalized (${list(at('normalized-only').map((f) => sourceLabel(f.upstream)))}) but not in Consumption.`;
    case 'landing-only':
      return `${names(at('landing-only'))} ${at('landing-only').length > 1 ? 'are' : 'is'} only in Landing (${tablesOf(at('landing-only'), true)}).`;
    case 'missing':
      return `No layer has ${names(at('missing'))}.`;
  }
}

/**
 * Trace gaps: each requirement's status, from its fields' checked sources
 * and the lineage, plus the grain check. A field is `supported` when it has
 * a Consumption source with no expression, `derivable` with one; else
 * `normalized-only`, `landing-only` or `missing` by its highest source. A
 * Normalized (else Landing) source whose lineage edges reach a Consumption
 * column counts as that column. The requirement takes its worst field's
 * status (`missing` when it has no field); when every field is in
 * Consumption and their entities are not joined (directly or through each
 * other) by a shared key-like column (`id`, `*_id`, `*_key`, `*_code`) or a
 * shared column the requirement itself reads, it is `grain`. Returns the assessments
 * (evidence `''`) and the lineage with a `mapped` edge from each mapped
 * source to the next mapped layer up (the lower source's expression); an
 * edge that already joins the two columns is kept and gets the expression
 * when it has none.
 */
export function traceGaps(input: {
  requirements: readonly Requirement[];
  mappings: readonly FieldMapping[];
  lineage: Lineage;
  tables: readonly LayerTable[];
}): { assessments: RequirementAssessment[]; lineage: Lineage } {
  const { requirements, mappings, lineage, tables } = input;
  const edges = lineage.edges.map((e) => ({ ...e }));
  const pairOf = (e: { from: ColumnRef; to: ColumnRef }) =>
    `${refKey(e.from)}>${refKey(e.to)}`;
  for (const mapping of mappings) {
    for (const edge of mappedEdges(mapping.sources)) {
      const existing = edges.find((e) => pairOf(e) === pairOf(edge));
      if (!existing) edges.push(edge);
      else if (!existing.expression) existing.expression = edge.expression;
    }
  }
  const assessments = requirements.map((requirement) => {
    const fields = requirement.fields.map((field): FieldAssessment => {
      const mapping = mappings.find(
        (m) => m.requirementId === requirement.id && same(m.field, field.name),
      );
      const sources = mapping?.sources ?? [];
      const inLayer = (layer: Layer) => sources.find((s) => s.layer === layer);
      let consumption = inLayer('consumption') ?? null;
      const upstream = inLayer('normalized') ?? inLayer('landing') ?? null;
      let path: ColumnRef[] = [];
      if (consumption) {
        path = pathTo(consumption, edges, tables);
      } else {
        for (const source of [inLayer('normalized'), inLayer('landing')]) {
          if (!source) continue;
          const reach = reachConsumption(source, lineage.edges, tables);
          if (!reach) continue;
          const top = reach[reach.length - 1];
          const table = findTable(tables, top.entity);
          consumption = {
            layer: 'consumption',
            entity: table?.entity ?? top.entity,
            column: top.column,
            expression: source.expression,
          };
          const below = pathTo(source, edges, tables);
          path = [...below, ...reach.slice(1)];
          break;
        }
      }
      if (consumption) {
        return {
          field: field.name,
          status: consumption.expression ? 'derivable' : 'supported',
          consumption,
          upstream: null,
          path,
        };
      }
      return {
        field: field.name,
        status: !upstream
          ? 'missing'
          : upstream.layer === 'normalized'
            ? 'normalized-only'
            : 'landing-only',
        consumption: null,
        upstream,
        path: upstream ? pathTo(upstream, edges, tables) : [],
      };
    });
    let status: GapStatus =
      fields.length === 0 ? 'missing' : worst(fields.map((f) => f.status));
    const entities = [
      ...new Set(
        fields
          .map((f) => f.consumption?.entity)
          .filter((e): e is string => e !== undefined),
      ),
    ];
    const usable = new Set(
      fields
        .map((f) => f.consumption?.column.toLowerCase())
        .filter((c): c is string => c !== undefined),
    );
    if (
      (status === 'supported' || status === 'derivable') &&
      !joined(entities, tables, usable)
    ) {
      status = 'grain';
    }
    return {
      requirementId: requirement.id,
      status,
      fields,
      reason: reasonOf(status, fields, entities),
      evidence: '',
    };
  });
  return {
    assessments,
    lineage: {
      edges,
      checkedPairs: lineage.checkedPairs,
      failedChecks: lineage.failedChecks,
    },
  };
}

// ---------------------------------------------------------------------------
// Probes

/** A probe query and the requirement it is about. */
export type GapProbe = GapQuery & {
  requirementId: string;
  /**
   * `upstream-periods`: the same period count on the lower-layer column the
   * lineage says feeds the Consumption one, so a coverage gap says whether
   * the data exists below (evidence only, never a status change).
   */
  purpose: 'coverage' | 'periods' | 'upstream-periods';
  /** For `upstream-periods`: the layer of the column it counts. */
  layer?: Layer;
};

/**
 * The lower-layer column the lineage says feeds a Consumption column: the
 * edge into it from the highest layer below (Normalized before Landing),
 * then the best method and confidence.
 */
function upstreamOf(
  source: FieldSource,
  lineage: Lineage | undefined,
  tables: readonly LayerTable[],
): FieldSource | undefined {
  if (!lineage || source.layer !== 'consumption') return undefined;
  const rank = { values: 0, mapped: 1, name: 2, 'similar-name': 3 } as const;
  const into = lineage.edges
    .filter(
      (e) =>
        same(e.to.entity, source.entity) && same(e.to.column, source.column),
    )
    .map((e) => ({ edge: e, table: findTable(tables, e.from.entity) }))
    .filter(
      (x): x is { edge: (typeof lineage.edges)[number]; table: LayerTable } =>
        x.table !== undefined && x.table.layer !== 'consumption',
    )
    .sort(
      (a, b) =>
        (a.table.layer === 'normalized' ? 0 : 1) -
          (b.table.layer === 'normalized' ? 0 : 1) ||
        rank[a.edge.method] - rank[b.edge.method] ||
        b.edge.confidence - a.edge.confidence,
    );
  const best = into[0];
  return best
    ? {
        layer: best.table.layer,
        entity: best.table.entity,
        column: best.edge.from.column,
        expression: '',
      }
    : undefined;
}

/**
 * The entity a requirement's probes read: the one most of its fields'
 * Consumption sources sit in; with none, the one most of its upstream
 * sources sit in. With the columns of its fields there.
 */
export function probeTarget(
  assessment: RequirementAssessment,
): { entity: string; columns: string[] } | undefined {
  const pick = (sources: Array<FieldSource | null>) => {
    const kept = sources.filter((s): s is FieldSource => s !== null);
    const counts = new Map<string, number>();
    for (const s of kept) counts.set(s.entity, (counts.get(s.entity) ?? 0) + 1);
    let best: string | undefined;
    for (const [entity, n] of counts) {
      if (best === undefined || n > (counts.get(best) ?? 0)) best = entity;
    }
    if (best === undefined) return undefined;
    const columns = [
      ...new Set(kept.filter((s) => s.entity === best).map((s) => s.column)),
    ];
    return { entity: best, columns };
  };
  return (
    pick(assessment.fields.map((f) => f.consumption)) ??
    pick(assessment.fields.map((f) => f.upstream))
  );
}

function periodField(
  requirement: Requirement,
  assessment: RequirementAssessment,
): FieldSource | undefined {
  const fields = [
    ...requirement.fields.filter((f) => f.role === 'time'),
    ...requirement.fields.filter(
      (f) => f.role !== 'time' && PERIOD_NAME.test(f.name),
    ),
  ];
  for (const field of fields) {
    const found = assessment.fields.find((f) => same(f.field, field.name));
    const source = found?.consumption ?? found?.upstream;
    if (source) return source;
  }
  return undefined;
}

/** The period values a probe can count: years and ISO dates, no quotes. */
function probePeriods(requirement: Requirement): string[] {
  return [
    ...new Set(
      requirement.periodValues
        .map((v) => v.trim())
        .filter((v) => PERIOD_VALUE.test(v)),
    ),
  ];
}

function coverageSql(
  entity: string,
  columns: readonly string[],
  dialect: GapDialect,
): string {
  const counts = columns.map((c) => {
    const id = quoteIdentifier(c, dialect);
    return `COUNT(${id}) AS ${id}`;
  });
  return `SELECT ${['COUNT(*) AS ' + PROBE_TOTAL_COLUMN, ...counts].join(', ')} FROM ${tableReference(entity, dialect)}`;
}

function periodsSql(
  source: FieldSource,
  periods: readonly string[],
  dialect: GapDialect,
): string {
  const value = `CAST(${quoteIdentifier(source.column, dialect)} AS ${textType(dialect)})`;
  const counts = periods.map(
    (p) =>
      `COUNT(CASE WHEN ${value} LIKE '${p}%' THEN 1 END) AS ${quoteIdentifier(p, dialect)}`,
  );
  return `SELECT ${counts.join(', ')} FROM ${tableReference(source.entity, dialect)}`;
}

/**
 * The probe queries: per requirement, at most `PROBES_PER_REQUIREMENT`:
 * `coverage` (`COUNT(*) AS total_rows` and `COUNT(<col>) AS <col>` per
 * required column of its main entity, see `probeTarget`) and, when it names
 * year or date `periodValues` and has a time field, `periods` (one row,
 * `COUNT(CASE WHEN CAST(<col> AS TEXT) LIKE '<period>%' THEN 1 END) AS
 * <period>` per period). At most `PROBES_MAX` in all, ids `probe-<n>`,
 * Postgres or Databricks SQL by the entity's kind; an entity with no
 * datasource or of another kind is not probed.
 */
export function probeQueries(input: {
  requirements: readonly Requirement[];
  assessments: readonly RequirementAssessment[];
  tables: readonly LayerTable[];
  /** With it, a period probe on Consumption gets its upstream twin. */
  lineage?: Lineage;
}): GapProbe[] {
  const { requirements, assessments, tables, lineage } = input;
  const out: GapProbe[] = [];
  const queryable = (entity: string) => {
    const table = findTable(tables, entity);
    const dialect = gapDialectOf(table?.datasourceKind);
    return table?.datasourceId && dialect
      ? { datasourceId: table.datasourceId, dialect }
      : undefined;
  };
  for (const assessment of assessments) {
    const requirement = requirements.find(
      (r) => r.id === assessment.requirementId,
    );
    if (!requirement) continue;
    const mine: GapProbe[] = [];
    const target = probeTarget(assessment);
    const where = target && queryable(target.entity);
    if (target && where) {
      mine.push({
        id: '',
        requirementId: requirement.id,
        purpose: 'coverage',
        datasourceId: where.datasourceId,
        sql: coverageSql(target.entity, target.columns, where.dialect),
        rationale: `Counts the rows of ${shortEntity(target.entity)} and how many have ${list(target.columns)} filled, for ${requirement.id}`,
      });
    }
    const periods = probePeriods(requirement);
    const period = periods.length
      ? periodField(requirement, assessment)
      : undefined;
    const at = period && queryable(period.entity);
    if (period && at) {
      mine.push({
        id: '',
        requirementId: requirement.id,
        purpose: 'periods',
        datasourceId: at.datasourceId,
        sql: periodsSql(period, periods, at.dialect),
        rationale: `Counts the rows of ${shortEntity(period.entity)} for each period ${requirement.id} names (${list(periods)}) by ${period.column}`,
      });
      const below = upstreamOf(period, lineage, tables);
      const there = below && queryable(below.entity);
      if (below && there) {
        mine.push({
          id: '',
          requirementId: requirement.id,
          purpose: 'upstream-periods',
          layer: below.layer,
          datasourceId: there.datasourceId,
          sql: periodsSql(below, periods, there.dialect),
          rationale: `Counts the rows of ${shortEntity(below.entity)}, which feeds ${shortEntity(period.entity)}.${period.column}, for each period ${requirement.id} names (${list(periods)})`,
        });
      }
    }
    const cap = mine.some((p) => p.purpose === 'upstream-periods')
      ? PROBES_PER_REQUIREMENT + 1
      : PROBES_PER_REQUIREMENT;
    for (const probe of mine.slice(0, cap)) {
      if (out.length >= PROBES_MAX) break;
      out.push({ ...probe, id: `probe-${out.length + 1}` });
    }
  }
  return out;
}

/**
 * The assessments with each requirement's `evidence` (one or two plain
 * sentences from its probes' results) and, for one that was `supported`
 * or `derivable`, `grain` (with a new reason) when the data does not answer
 * it: no rows, a required column under half filled, or a named period with
 * no rows. A failed probe adds `The check query failed: <error>.` and
 * changes no status.
 */
export function applyProbes(
  assessments: readonly RequirementAssessment[],
  probes: readonly GapProbe[],
  results: readonly GapQueryResult[],
): RequirementAssessment[] {
  return assessments.map((assessment) => {
    const sentences: string[] = [];
    const problems: string[] = [];
    for (const probe of probes) {
      if (probe.requirementId !== assessment.requirementId) continue;
      const result = results.find((r) => r.id === probe.id);
      if (!result) continue;
      if (result.error) {
        sentences.push(`The check query failed: ${result.error}.`);
        continue;
      }
      const row = result.rows[0];
      if (probe.purpose === 'coverage') {
        const target = probeTarget(assessment);
        if (!target) continue;
        const name = shortEntity(target.entity);
        const total = countOf(rowValue(row, PROBE_TOTAL_COLUMN)) ?? 0;
        if (total === 0) {
          sentences.push(`${name}: 0 rows.`);
          problems.push(`${name} has no rows`);
          continue;
        }
        const filled = target.columns.map((column) => ({
          column,
          count: countOf(rowValue(row, column)) ?? 0,
        }));
        const parts = filled.map(
          (f) => `${f.column} filled in ${f.count} of ${total}`,
        );
        sentences.push(
          `${name}: ${total} rows${parts.length ? `; ${list(parts)}` : ''}.`,
        );
        for (const f of filled) {
          if (f.count * 2 < total) {
            problems.push(
              `${f.column} is filled in only ${f.count} of ${total} rows`,
            );
          }
        }
      } else {
        const columns = result.columns.length
          ? result.columns
          : Object.keys(row ?? {});
        const counts = columns.map((period) => ({
          period,
          count: countOf(rowValue(row, period)) ?? 0,
        }));
        const column = /CAST\((?:"|`)(.+?)(?:"|`) AS/.exec(probe.sql)?.[1];
        const table = /FROM (.+)$/.exec(probe.sql)?.[1] ?? '';
        const name = table.split('.').pop()?.replace(/["`]/g, '') ?? '';
        const by = `rows by ${column ?? 'period'}: ${counts.map((c) => `${c.period} → ${c.count}`).join(', ')}`;
        if (probe.purpose === 'upstream-periods') {
          // Evidence of where the data is, never a status change.
          const layer = probe.layer === 'landing' ? 'Landing' : 'Normalized';
          sentences.push(`Upstream in ${layer}, ${name}: ${by}.`);
          continue;
        }
        sentences.push(`${name}: ${by}.`);
        const empty = counts.filter((c) => c.count === 0).map((c) => c.period);
        if (empty.length) problems.push(`no rows for ${list(empty)}`);
      }
    }
    const downgrade =
      problems.length > 0 &&
      (assessment.status === 'supported' || assessment.status === 'derivable');
    return {
      ...assessment,
      status: downgrade ? 'grain' : assessment.status,
      reason: downgrade
        ? `The fields are in Consumption, but the data does not answer it: ${problems.join('; ')}.`
        : assessment.reason,
      evidence: sentences.join(' '),
    };
  });
}

// ---------------------------------------------------------------------------
// Fixes

const FIX_LAYERS: readonly GapFix['startsIn'][] = [
  'source',
  'landing',
  'normalized',
  'consumption',
];

/** The layers a fix that starts in a layer changes, lowest first. */
function pathFrom(startsIn: GapFix['startsIn']): GapFix['startsIn'][] {
  return FIX_LAYERS.slice(FIX_LAYERS.indexOf(startsIn));
}

/**
 * The fix code proposes for a gap no fix of the Gap Advisor closes: grain
 * and normalized-only start in `consumption`, landing-only in `normalized`,
 * missing in `source`; the change is text, never run.
 */
export function fallbackFix(
  requirement: Requirement,
  assessment: RequirementAssessment,
  id: string,
): GapFix {
  const gap = assessment.fields.filter((f) => f.status === assessment.status);
  const names = gap.length
    ? list(gap.map((f) => f.field))
    : `the data of ${requirement.id}`;
  const label = (s: FieldSource | null) =>
    s ? `${s.entity}.${s.column}` : 'no column';
  const base = {
    id,
    closes: [requirement.id],
    why: [assessment.reason, assessment.evidence].filter(Boolean).join(' '),
  };
  switch (assessment.status) {
    case 'normalized-only':
      return {
        ...base,
        title: `Expose ${names} in Consumption`,
        startsIn: 'consumption',
        path: ['normalized', 'consumption'],
        change: gap
          .map(
            (f) =>
              `Add ${f.field} to a Consumption entity, built from ${label(f.upstream)}.`,
          )
          .join('\n'),
      };
    case 'landing-only':
      return {
        ...base,
        title: `Model ${names} in Normalized and expose ${gap.length > 1 ? 'them' : 'it'} in Consumption`,
        startsIn: 'normalized',
        path: ['landing', 'normalized', 'consumption'],
        change: gap
          .map(
            (f) =>
              `Type and clean ${label(f.upstream)} into a Normalized entity, then add ${f.field} to a Consumption entity.`,
          )
          .join('\n'),
      };
    case 'missing':
      return {
        ...base,
        title: `Bring ${names} from the source system`,
        startsIn: 'source',
        path: pathFrom('source'),
        change: `Find the source system that records ${names}, load it into Landing, model it in Normalized and expose it in Consumption.`,
      };
    default:
      return {
        ...base,
        title: `Fix the grain or coverage of ${requirement.title}`,
        startsIn: 'consumption',
        path: ['consumption'],
        change: `Backfill or rebuild the Consumption entities of ${requirement.id} (${list(
          [
            ...new Set(
              assessment.fields
                .map((f) => f.consumption?.entity)
                .filter((e): e is string => !!e)
                .map(shortEntity),
            ),
          ],
        )}) at the grain ${requirement.grain || 'it needs'}, joined on a shared key.`,
      };
  }
}

function fixLayerOf(value: unknown): GapFix['startsIn'] | undefined {
  const layer = text(value).toLowerCase();
  return (FIX_LAYERS as readonly string[]).includes(layer)
    ? (layer as GapFix['startsIn'])
    : undefined;
}

/**
 * The Gap Advisor's reply, read leniently (`{ fixes: [...] }`, an array or
 * its JSON) and checked: ids `X1`… in order, `closes` kept only for
 * requirement ids that exist and are not supported or derivable, a fix
 * that closes nothing dropped, `startsIn` and `path` kept only when they
 * name fix layers (else from the gaps it closes); then one fallback fix
 * (`fallbackFix`) per gap no fix closes.
 */
export function checkedFixes(
  reply: unknown,
  requirements: readonly Requirement[],
  assessments: readonly RequirementAssessment[],
): GapFix[] {
  const gaps = new Map(
    assessments
      .filter((a) => a.status !== 'supported' && a.status !== 'derivable')
      .map((a) => [a.requirementId.toLowerCase(), a]),
  );
  const fixes: GapFix[] = [];
  const closed = new Set<string>();
  for (const raw of itemsOf(reply, 'fixes').map(record)) {
    const closes: string[] = [];
    for (const id of Array.isArray(raw.closes) ? raw.closes : []) {
      const gap = gaps.get(text(id).toLowerCase());
      if (gap && !closes.includes(gap.requirementId)) {
        closes.push(gap.requirementId);
      }
    }
    if (!closes.length) continue;
    const first = gaps.get(closes[0].toLowerCase()) as RequirementAssessment;
    const requirement = requirements.find((r) => r.id === first.requirementId);
    const fallback = requirement
      ? fallbackFix(requirement, first, '')
      : undefined;
    const startsIn =
      fixLayerOf(raw.startsIn) ?? fallback?.startsIn ?? 'consumption';
    const path = [
      ...new Set(
        (Array.isArray(raw.path) ? raw.path : [])
          .map(fixLayerOf)
          .filter((l): l is GapFix['startsIn'] => l !== undefined),
      ),
    ].sort((a, b) => FIX_LAYERS.indexOf(a) - FIX_LAYERS.indexOf(b));
    for (const id of closes) closed.add(id);
    fixes.push({
      id: `X${fixes.length + 1}`,
      title: text(raw.title) || fallback?.title || `Close ${list(closes)}`,
      startsIn,
      path: path.length ? path : pathFrom(startsIn),
      closes,
      why: text(raw.why) || fallback?.why || '',
      change: text(raw.change) || fallback?.change || '',
    });
  }
  for (const assessment of assessments) {
    if (!gaps.has(assessment.requirementId.toLowerCase())) continue;
    if (closed.has(assessment.requirementId)) continue;
    const requirement = requirements.find(
      (r) => r.id === assessment.requirementId,
    );
    if (!requirement) continue;
    fixes.push(fallbackFix(requirement, assessment, `X${fixes.length + 1}`));
  }
  return fixes;
}

/** How many requirements have each status. */
export function statusCounts(
  assessments: readonly RequirementAssessment[],
): StatusCounts {
  const counts: StatusCounts = {
    supported: 0,
    derivable: 0,
    grain: 0,
    'normalized-only': 0,
    'landing-only': 0,
    missing: 0,
  };
  for (const assessment of assessments) counts[assessment.status] += 1;
  return counts;
}
