/**
 * The step catalogue of the Dashboard Image to Artifact workflow (agents.md 5.17):
 * its id and name, the steps and edges the workflow page shows and the
 * runtime a run hands its steps. It also holds the dashboard's own pure
 * code, shared with Map a Dashboard to Data (5.18): the lenient readers of
 * the two model replies, the check of a mapping against the catalog, the
 * drawn dashboard and the explanation of the mapping. No framework import,
 * so the catalogue and Jest can read it without loading Mastra;
 * ./recreate-dashboard.workflow.ts builds the Mastra steps from it.
 */
import type { z } from 'zod';
import {
  BLUEPRINT_AGGREGATIONS,
  BLUEPRINT_COLUMN_TYPES,
  BLUEPRINT_FILTER_KINDS,
  BLUEPRINT_FORMATS,
  BLUEPRINT_WIDGET_KINDS,
  RECREATE_DASHBOARD_STEP_SCHEMAS,
  dashboardBlueprintSchema,
  dataMappingSchema,
} from './recreate-dashboard.schemas';
import type {
  fieldMappingSchema,
  loadedImageSchema,
  savedDashboardSchema,
} from './recreate-dashboard.schemas';
import {
  DASHBOARD_MOCK_CSS,
  DASHBOARD_MOCK_ROOT_ID,
  DASHBOARD_MOCK_RUNTIME,
} from './recreate-dashboard.runtime';
import {
  contractStepEntry,
  jsonObjectOf,
  type CatalogEntity,
  type ContractStepEntry,
  type EntityColumns,
} from './answer-business-question.steps';
import type { WorkflowEdge } from './workflow-contract';

/** The workflow's registry key and id. */
export const RECREATE_DASHBOARD_WORKFLOW_ID = 'recreate-dashboard';

/** The name the app shows for the workflow (workflows R1). */
export const RECREATE_DASHBOARD_WORKFLOW_NAME = 'Dashboard Image to Artifact';

/** What the catalogue says the workflow does. */
export const RECREATE_DASHBOARD_DESCRIPTION =
  'Turns a dashboard screenshot into a reusable artifact: an interactive mock on invented data that you can later map to your datasets.';

/** What a run asks when its instructions are left empty. */
export const RECREATE_DASHBOARD_DEFAULT_QUESTION =
  'Recreate this dashboard as an interactive mock';

/** The RequestContext key of a run's runtime. */
export const RECREATE_DASHBOARD_RUNTIME_KEY = 'recreate-dashboard-runtime';

const SCHEMAS = RECREATE_DASHBOARD_STEP_SCHEMAS;

/**
 * The steps, in catalogue order. Their field names and JSON Schemas come
 * from ./recreate-dashboard.schemas.ts; how they connect is
 * `RECREATE_DASHBOARD_EDGES`.
 */
export const RECREATE_DASHBOARD_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'load-image',
      title: 'Load image',
      kind: 'code',
      summary:
        "Finds the uploaded image in the run's workspace and checks its format and size. No LLM.",
      exits: [{ label: 'Image missing', outcome: 'fails' }],
    },
    SCHEMAS['load-image'],
  ),
  contractStepEntry(
    {
      id: 'read-dashboard',
      title: 'Read dashboard',
      kind: 'agent',
      summary:
        'The Dashboard Reader looks at the image and returns the dashboard as data: its filters, its widgets with their measures and breakdowns, and the columns of one mock dataset behind them.',
      exits: [
        { label: 'Model error', outcome: 'fails' },
        { label: 'Stop', outcome: 'stops' },
        { label: 'No dashboard in the image', outcome: 'fails' },
      ],
      modelOnly: true,
    },
    SCHEMAS['read-dashboard'],
  ),
  contractStepEntry(
    {
      id: 'save-dashboard',
      title: 'Save dashboard',
      kind: 'code',
      summary:
        'Draws the dashboard with the fixed runtime on invented data, stores it as an interactive visual of the run and saves it in Artifacts with its image. No LLM.',
      exits: [],
    },
    SCHEMAS['save-dashboard'],
  ),
];

/** The edges of the workflow (api.md 117), from Start to End. */
export const RECREATE_DASHBOARD_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'load-image', kind: 'next' },
  { from: 'load-image', to: 'read-dashboard', kind: 'next' },
  { from: 'read-dashboard', to: 'save-dashboard', kind: 'next' },
  { from: 'save-dashboard', to: 'end', kind: 'next' },
];

export type DashboardBlueprint = z.output<typeof dashboardBlueprintSchema>;
export type DataMapping = z.output<typeof dataMappingSchema>;
export type FieldMapping = z.output<typeof fieldMappingSchema>;
export type MappingStatus = DataMapping['widgets'][number]['status'];
export type LoadedImage = Pick<
  z.output<typeof loadedImageSchema>,
  'mediaType' | 'sizeBytes'
>;
export type SavedDashboard = z.output<typeof savedDashboardSchema>;

/** A drawn dashboard: an interactive visual's freeform bundle. */
export interface MockBundle {
  title: string;
  description: string;
  html: string;
  css: string;
  javascript: string;
}

/**
 * What a run hands its steps on the RequestContext: the run's image, the
 * model call and the store of the dashboard. A step throws when it is
 * missing.
 */
export interface RecreateDashboardRuntime {
  /** Load image: the image's type and size; throws when it is missing. */
  loadImage(input: { image: string }): Promise<LoadedImage>;
  /** Read dashboard: the model's description of the image. */
  readDashboard(input: {
    question: string;
    image: string;
  }): Promise<{ blueprint: DashboardBlueprint; stopped: boolean }>;
  /**
   * Save dashboard: stores the drawn dashboard as a visual of the run and
   * the blueprint, with the run's image, as an artifact.
   */
  saveDashboard(input: {
    blueprint: DashboardBlueprint;
    bundle: MockBundle;
    /** The run's answer, given the artifact's name once it is stored. */
    answer: (artifactName: string) => string;
  }): Promise<{ visualId: string; artifactId: string; artifactName: string }>;
}

/** The instructions a run follows: its own, else the default. */
export function recreateDashboardQuestion(question: string): string {
  return question.trim() || RECREATE_DASHBOARD_DEFAULT_QUESTION;
}

/** A blueprint with nothing in it: what a stopped Read dashboard passes on. */
export function emptyBlueprint(): DashboardBlueprint {
  return {
    title: '',
    summary: '',
    theme: { mode: 'light', accent: '', palette: [] },
    layout: '',
    filters: [],
    widgets: [],
    columns: [],
  };
}

/** A mapping with nothing in it: what a stopped Map data passes on. */
export function emptyMapping(): DataMapping {
  return { approach: '', widgets: [], filters: [], gaps: [] };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'number' ? String(item) : text(item)))
        .filter(Boolean)
    : [];
}

function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `value` when it is one of `allowed`, else `fallback`. */
function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T {
  const found = allowed.find((item) => item === text(value).toLowerCase());
  return found ?? fallback;
}

/** A kebab-case id from a label, unique among `taken`. */
function uniqueId(raw: string, fallback: string, taken: Set<string>): string {
  const base =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** `#rrggbb` (or `#rgb`) in lower case, else ''. */
function hexColour(value: unknown): string {
  const colour = text(value).toLowerCase();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(colour) ? colour : '';
}

/** The widest and narrowest a widget is in the 12-column grid. */
const SPAN = { min: 2, max: 12, fallback: 4 };

/**
 * The Read dashboard step's blueprint from its model's reply (agents.md
 * 5.17), read leniently: a missing text is empty, an unknown kind is
 * `other`, ids are made unique, a span is kept within 2 to 12, a colour
 * that is no hex value is dropped, a measure without a column is dropped,
 * and a widget's `filteredBy` keeps only the ids of the blueprint's
 * filters. A column a widget or a filter reads that the reply did not
 * list is added, and a column a measure folds is a number, so the mock
 * dataset always holds what the dashboard reads. Undefined when the reply is no JSON object or names no widget:
 * there is no dashboard to recreate.
 */
export function blueprintOf(reply: unknown): DashboardBlueprint | undefined {
  const raw = jsonObjectOf(reply) as Record<string, unknown> | undefined;
  if (!raw) return undefined;
  const filterIds = new Set<string>();
  // A widget names a filter by the id the model gave it.
  const renamed = new Map<string, string>();
  const filters = objects(raw['filters']).map((filter, index) => {
    const label = text(filter['label']) || `Filter ${index + 1}`;
    const id = uniqueId(text(filter['id']) || label, 'filter', filterIds);
    if (text(filter['id'])) renamed.set(text(filter['id']), id);
    return {
      id,
      label,
      kind: oneOf(BLUEPRINT_FILTER_KINDS, filter['kind'], 'other'),
      column: text(filter['column']),
      options: strings(filter['options']),
    };
  });
  const widgetIds = new Set<string>();
  const widgets = objects(raw['widgets']).map((widget, index) => {
    const title = text(widget['title']) || `Widget ${index + 1}`;
    const span = numberOrNull(widget['span']);
    return {
      id: uniqueId(text(widget['id']) || title, 'widget', widgetIds),
      title,
      kind: oneOf(BLUEPRINT_WIDGET_KINDS, widget['kind'], 'other'),
      span:
        span === null
          ? SPAN.fallback
          : Math.min(SPAN.max, Math.max(SPAN.min, Math.round(span))),
      measures: objects(widget['measures'])
        .filter((measure) => text(measure['column']))
        .map((measure) => ({
          label: text(measure['label']) || text(measure['column']),
          column: text(measure['column']),
          aggregation: oneOf(
            BLUEPRINT_AGGREGATIONS,
            measure['aggregation'],
            'sum',
          ),
          format: oneOf(BLUEPRINT_FORMATS, measure['format'], 'number'),
          unit: text(measure['unit']),
          total: numberOrNull(measure['total']),
        })),
      dimension: text(widget['dimension']),
      description: text(widget['description']),
      observed: text(widget['observed']),
      filteredBy: [
        ...new Set(
          strings(widget['filteredBy'])
            .map((id) => renamed.get(id) ?? id)
            .filter((id) => filterIds.has(id)),
        ),
      ],
    };
  });
  if (!widgets.length) return undefined;
  const columns = objects(raw['columns'])
    .filter((column) => text(column['name']))
    .map((column) => ({
      name: text(column['name']),
      type: oneOf(BLUEPRINT_COLUMN_TYPES, column['type'], 'string'),
      description: text(column['description']),
      values: strings(column['values']),
      min: numberOrNull(column['min']),
      max: numberOrNull(column['max']),
    }));
  const listed = new Set(columns.map((column) => column.name));
  const add = (name: string, type: 'string' | 'number') => {
    if (!name || listed.has(name)) return;
    listed.add(name);
    columns.push({
      name,
      type,
      description: '',
      values: [],
      min: null,
      max: null,
    });
  };
  for (const widget of widgets) {
    for (const measure of widget.measures) {
      add(measure.column, 'number');
      // A column a measure folds is a number, whatever the reply called it.
      const read = columns.find((column) => column.name === measure.column);
      if (read) read.type = 'number';
    }
    add(widget.dimension, 'string');
  }
  for (const filter of filters) add(filter.column, 'string');
  const theme = (raw['theme'] ?? {}) as Record<string, unknown>;
  return dashboardBlueprintSchema.parse({
    title: text(raw['title']) || 'Dashboard',
    summary: text(raw['summary']),
    theme: {
      mode: oneOf(['light', 'dark'] as const, theme['mode'], 'light'),
      accent: hexColour(theme['accent']),
      palette: (Array.isArray(theme['palette']) ? theme['palette'] : [])
        .map(hexColour)
        .filter(Boolean),
    },
    layout: text(raw['layout']),
    filters,
    widgets,
    columns,
  });
}

/** The columns of the mock dataset a widget reads, each once, in order. */
export function widgetFields(
  widget: DashboardBlueprint['widgets'][number],
): string[] {
  return [
    ...new Set(
      [
        ...widget.measures.map((measure) => measure.column),
        widget.dimension,
      ].filter(Boolean),
    ),
  ];
}

/** What a mapping is checked against: each entity's dataset and columns. */
interface CatalogIndex {
  /** By entity key in lower case. */
  entities: Map<
    string,
    { entity: string; dataset: string; columns: Map<string, string> }
  >;
}

function catalogIndex(
  catalog: readonly CatalogEntity[],
  columns: readonly EntityColumns[],
): CatalogIndex {
  const entities: CatalogIndex['entities'] = new Map();
  for (const entry of catalog) {
    entities.set(entry.entity.toLowerCase(), {
      entity: entry.entity,
      dataset: entry.dataset,
      columns: new Map(),
    });
  }
  for (const entry of columns) {
    const found = entities.get(entry.entity.toLowerCase());
    if (!found) continue;
    for (const column of entry.columns) {
      found.columns.set(column.name.toLowerCase(), column.name);
    }
  }
  return { entities };
}

/** What the mapping says of a field with no source. */
export const NO_SOURCE_NOTE = 'No column of the selected datasets matches.';

/**
 * One field's source from what the model proposed, kept only when the
 * entity and the column exist in the catalog (with the catalog's own
 * spelling); else the field has no source, and the note says so.
 */
function checkedField(
  field: string,
  proposed: Record<string, unknown> | undefined,
  index: CatalogIndex,
): FieldMapping {
  const note = text(proposed?.['note']);
  const entity = index.entities.get(text(proposed?.['entity']).toLowerCase());
  const column = entity?.columns.get(text(proposed?.['column']).toLowerCase());
  if (entity && column) {
    return {
      field,
      dataset: entity.dataset,
      entity: entity.entity,
      column,
      note,
    };
  }
  const named = text(proposed?.['entity']) && text(proposed?.['column']);
  return {
    field,
    dataset: '',
    entity: '',
    column: '',
    note: named
      ? `Proposed ${text(proposed?.['entity'])}.${text(proposed?.['column'])} is not in the catalog.`
      : note || NO_SOURCE_NOTE,
  };
}

/** A widget's status from its fields: all, some or none have a source. */
function statusOf(fields: readonly FieldMapping[]): MappingStatus {
  const sourced = fields.filter((field) => field.column).length;
  if (sourced === fields.length) return 'mapped';
  return sourced ? 'partial' : 'unmapped';
}

/**
 * The Map data step's mapping from its model's reply (agents.md 5.17),
 * rebuilt from the blueprint so it is complete and true to the catalog:
 * one entry per widget with one field per column the widget reads, one
 * entry per filter, each source kept only when its entity and column
 * exist in the catalog. A status is never the model's: it is counted from
 * the checked fields (a widget that reads no column is `mapped`). A reply
 * that is no JSON object maps nothing.
 */
export function mappingOf(
  reply: unknown,
  blueprint: DashboardBlueprint,
  catalog: readonly CatalogEntity[],
  columns: readonly EntityColumns[],
): DataMapping {
  const raw = (jsonObjectOf(reply) ?? {}) as Record<string, unknown>;
  const index = catalogIndex(catalog, columns);
  const proposedWidgets = new Map(
    objects(raw['widgets']).map((entry) => [text(entry['widgetId']), entry]),
  );
  const proposedFilters = new Map(
    objects(raw['filters']).map((entry) => [text(entry['filterId']), entry]),
  );
  const widgets = blueprint.widgets.map((widget) => {
    const proposed = proposedWidgets.get(widget.id);
    const byField = new Map(
      objects(proposed?.['fields']).map((field) => [
        text(field['field']),
        field,
      ]),
    );
    const fields = widgetFields(widget).map((field) =>
      checkedField(field, byField.get(field), index),
    );
    const status = statusOf(fields);
    const missing = fields
      .filter((field) => !field.column)
      .map((field) => field.field);
    return {
      widgetId: widget.id,
      status,
      fields,
      reason:
        text(proposed?.['reason']) ||
        (!fields.length
          ? 'It reads no data.'
          : status === 'mapped'
            ? 'Every column it reads has a source.'
            : `No source for ${missing.join(', ')}.`),
    };
  });
  const filters = blueprint.filters.map((filter) => {
    const proposed = proposedFilters.get(filter.id);
    const field = filter.column
      ? checkedField(
          filter.column,
          proposed?.['field'] as Record<string, unknown> | undefined,
          index,
        )
      : {
          field: '',
          dataset: '',
          entity: '',
          column: '',
          note: 'The filter narrows no column of the dashboard.',
        };
    return {
      filterId: filter.id,
      status: field.column ? ('mapped' as const) : ('unmapped' as const),
      field,
    };
  });
  return dataMappingSchema.parse({
    approach: text(raw['approach']),
    widgets,
    filters,
    gaps: strings(raw['gaps']),
  });
}

/** How many widgets have each status. */
export function mappingCounts(
  mapping: DataMapping,
): Record<MappingStatus, number> {
  const counts = { mapped: 0, partial: 0, unmapped: 0 };
  for (const widget of mapping.widgets) counts[widget.status] += 1;
  return counts;
}

/** JSON that is safe inside a `<script>`: no `<`, no line separators. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
}

/**
 * The drawn dashboard (agents.md 5.17): the fixed runtime and style sheet
 * with the blueprint and its mapping embedded as data. No model output is
 * markup or code here: the titles and notes reach the page as text.
 */
export function renderDashboardBundle(
  blueprint: DashboardBlueprint,
  /** Null draws the dashboard alone: no status, no sources (an artifact). */
  mapping: DataMapping | null,
): MockBundle {
  const counts = mapping ? mappingCounts(mapping) : undefined;
  return {
    title: blueprint.title,
    description: [
      blueprint.summary ||
        'An interactive mock of the dashboard, on invented data.',
      ...(counts
        ? [
            `Of its ${blueprint.widgets.length} widgets, ${counts.mapped} can be fed by the selected datasets, ${counts.partial} in part and ${counts.unmapped} not at all; each widget's badge and its Data source section say which.`,
          ]
        : []),
      'Every value shown is invented. The filters recompute the widgets they filter.',
    ].join(' '),
    html: `<div id="${DASHBOARD_MOCK_ROOT_ID}" class="dmk"></div>`,
    css: DASHBOARD_MOCK_CSS,
    javascript: [
      DASHBOARD_MOCK_RUNTIME,
      `window.dashMock.mount(document.getElementById(${JSON.stringify(DASHBOARD_MOCK_ROOT_ID)}), ${scriptJson({ blueprint, mapping })});`,
    ].join('\n'),
  };
}

/** `1 widget`, `3 widgets`, `2 entities`. */
function counted(count: number, noun: string): string {
  const plural = noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`;
  return `${count} ${count === 1 ? noun : plural}`;
}

/** A value as one Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';
}

const STATUS_LABEL: Record<MappingStatus, string> = {
  mapped: 'Mapped',
  partial: 'Partly mapped',
  unmapped: 'No data',
};

function sourceOf(field: FieldMapping): string {
  return field.column
    ? `\`${field.field}\` → \`${field.entity}.${field.column}\``
    : `\`${field.field}\` → none`;
}

/**
 * The run's answer (agents.md 5.17): the data mapping explained, built
 * from the checked mapping so it never names a source the catalog lacks.
 * The result, how the mapping was done step by step, every widget and
 * filter with its sources and the reason, and what the datasets lack.
 */
export function mappingExplanation(input: {
  blueprint: DashboardBlueprint;
  mapping: DataMapping;
  datasets: readonly string[];
  entityCount: number;
  /** The saved dashboard's name. */
  artifactName: string;
}): string {
  const { blueprint, mapping } = input;
  const counts = mappingCounts(mapping);
  const titles = new Map(
    blueprint.widgets.map((widget) => [widget.id, widget]),
  );
  const fields = mapping.widgets.flatMap((widget) => widget.fields);
  const sourced = fields.filter((field) => field.column).length;
  const entities = [
    ...new Set(
      fields.filter((field) => field.column).map((field) => field.entity),
    ),
  ];
  const lines = [
    `Recreated **${blueprint.title}** with ${counted(blueprint.widgets.length, 'widget')} and ${counted(blueprint.filters.length, 'filter')}, and mapped it to ${input.datasets.map((name) => `**${name}**`).join(', ') || 'no dataset'}.`,
    '',
    `**Result:** ${counts.mapped} mapped, ${counts.partial} partly mapped, ${counts.unmapped} with no data. Each widget of the dashboard carries its status as a badge.`,
    '',
    '### How the mapping was done',
    '',
    `1. **Load dashboard.** The saved dashboard **${input.artifactName}** was read from Artifacts: ${counted(blueprint.widgets.length, 'widget')}, ${counted(blueprint.filters.length, 'filter')} and the ${counted(blueprint.columns.length, 'column')} of data they read (${
      blueprint.columns.map((column) => `\`${column.name}\``).join(', ') ||
      'none'
    }).`,
    `2. **Load catalog.** ${counted(input.entityCount, 'entity')} of the selected datasets ${input.entityCount === 1 ? 'was' : 'were'} listed with ${input.entityCount === 1 ? 'its' : 'their'} columns (names and types only; no row was read).`,
    `3. **Map data.** ${mapping.approach || 'Each column the dashboard reads was compared with the catalog by name, type and meaning.'}`,
    `4. **Check.** Every proposed source was checked against the catalog; a source that names an entity or a column the catalog lacks counts as missing. ${sourced} of ${counted(fields.length, 'column reading')} ended with a source${
      entities.length
        ? `, from ${entities.map((entity) => `\`${entity}\``).join(', ')}`
        : ''
    }.`,
    '',
    '### Widget by widget',
    '',
    '| Widget | Type | Status | Sources | Why |',
    '|---|---|---|---|---|',
    ...mapping.widgets.map((widget) => {
      const source = titles.get(widget.widgetId);
      return `| ${cell(source?.title ?? widget.widgetId)} | ${source?.kind ?? ''} | ${STATUS_LABEL[widget.status]} | ${cell(widget.fields.map(sourceOf).join('; '))} | ${cell(
        [
          widget.reason,
          ...widget.fields
            .filter((field) => !field.column && field.note)
            .map((field) => `${field.field}: ${field.note}`),
        ].join(' '),
      )} |`;
    }),
  ];
  if (mapping.filters.length) {
    const labels = new Map(
      blueprint.filters.map((filter) => [filter.id, filter.label]),
    );
    lines.push(
      '',
      '### Filters',
      '',
      '| Filter | Status | Source | Note |',
      '|---|---|---|---|',
      ...mapping.filters.map(
        (filter) =>
          `| ${cell(labels.get(filter.filterId) ?? filter.filterId)} | ${STATUS_LABEL[filter.status]} | ${cell(filter.field.field ? sourceOf(filter.field) : '')} | ${cell(filter.field.note)} |`,
      ),
    );
  }
  if (mapping.gaps.length) {
    lines.push(
      '',
      '### What the datasets lack',
      '',
      ...mapping.gaps.map((gap) => `- ${gap}`),
    );
  }
  lines.push(
    '',
    'Every value in the dashboard is invented: the mapping says where real data would come from, and no query was run.',
  );
  return lines.join('\n');
}

/**
 * Dashboard Image to Artifact's answer (agents.md 5.17): fixed text, not model
 * output. What was read, where it was saved and what to do with it next.
 */
export function savedDashboardAnswer(input: {
  blueprint: DashboardBlueprint;
  artifactName: string;
}): string {
  const { blueprint } = input;
  return [
    `Read **${blueprint.title}** from the image: ${counted(blueprint.widgets.length, 'widget')}, ${counted(blueprint.filters.length, 'filter')} and the ${counted(blueprint.columns.length, 'column')} of data they read.`,
    '',
    ...blueprint.widgets.map(
      (widget) => `- **${widget.title}** (${widget.kind})`,
    ),
    '',
    `Saved in Artifacts as **${input.artifactName}**. Run **Map a Dashboard to Data** on it to see which of your datasets can feed each widget.`,
    '',
    'Every value in the dashboard is invented: nothing is connected to a datasource.',
  ].join('\n');
}

/** Save dashboard's output: the run's result. */
export function savedDashboard(input: {
  visualId: string;
  artifactId: string;
  artifactName: string;
  answer: string;
  blueprint: DashboardBlueprint;
}): SavedDashboard {
  return {
    artifactId: input.artifactId,
    artifactName: input.artifactName,
    visualId: input.visualId,
    title: input.blueprint.title,
    widgetCount: input.blueprint.widgets.length,
    filterCount: input.blueprint.filters.length,
    answer: input.answer,
    blueprint: input.blueprint,
  };
}
