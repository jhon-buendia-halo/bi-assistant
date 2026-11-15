/**
 * The step catalogue of the Recreate a Dashboard workflow (agents.md 5.17):
 * its id and name, the steps and edges the workflow page shows, the runtime
 * a run hands its steps, and the pure code of its deterministic parts. No
 * framework import, so the catalogue and Jest can read it without loading
 * Mastra; ./recreate-dashboard.workflow.ts builds the Mastra steps from it.
 */
import type { z } from 'zod';
import {
  BLUEPRINT_FILTER_KINDS,
  BLUEPRINT_WIDGET_KINDS,
  RECREATE_DASHBOARD_STEP_SCHEMAS,
  dashboardBlueprintSchema,
} from './recreate-dashboard.schemas';
import type {
  builtMockSchema,
  loadedImageSchema,
  savedMockSchema,
} from './recreate-dashboard.schemas';
import {
  contractStepEntry,
  jsonObjectOf,
  type ContractStepEntry,
  type WorkflowStepExit,
} from './answer-business-question.steps';
import type { WorkflowEdge } from './workflow-contract';

/** The workflow's registry key and id. */
export const RECREATE_DASHBOARD_WORKFLOW_ID = 'recreate-dashboard';

/** The name the app shows for the workflow (workflows R1). */
export const RECREATE_DASHBOARD_WORKFLOW_NAME = 'Recreate a Dashboard';

/** What the catalogue says the workflow does. */
export const RECREATE_DASHBOARD_DESCRIPTION =
  'Reads the image of a dashboard, describes its widgets and filters, and builds an interactive mock of it on invented data.';

/** What a run asks when its instructions are left empty. */
export const RECREATE_DASHBOARD_DEFAULT_QUESTION =
  'Recreate this dashboard as an interactive mock';

/** The RequestContext key of a run's runtime. */
export const RECREATE_DASHBOARD_RUNTIME_KEY = 'recreate-dashboard-runtime';

/** The folder of a run's workspace that holds its input image. */
export const RUN_INPUT_IMAGE_DIR = 'inputs';

const SCHEMAS = RECREATE_DASHBOARD_STEP_SCHEMAS;

const MODEL_EXITS: readonly WorkflowStepExit[] = [
  { label: 'Model error', outcome: 'fails' },
  { label: 'Stop', outcome: 'stops' },
];

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
        'The Dashboard Reader looks at the image and describes the dashboard: its layout, filters, widgets and the columns of one mock dataset behind them.',
      exits: [
        ...MODEL_EXITS,
        { label: 'No dashboard in the image', outcome: 'fails' },
      ],
      modelOnly: true,
    },
    SCHEMAS['read-dashboard'],
  ),
  contractStepEntry(
    {
      id: 'build-mock',
      title: 'Build mock',
      kind: 'agent',
      summary:
        'The Mock Builder writes the HTML, CSS and JavaScript of an interactive mock from that description and the image, on invented data.',
      exits: [...MODEL_EXITS, { label: 'Unusable code', outcome: 'fails' }],
      modelOnly: true,
    },
    SCHEMAS['build-mock'],
  ),
  contractStepEntry(
    {
      id: 'save-mock',
      title: 'Save mock',
      kind: 'code',
      summary:
        "Stores the mock as an interactive visual of the run and returns it as the run's result. No LLM.",
      exits: [],
    },
    SCHEMAS['save-mock'],
  ),
];

/** The edges of the workflow (api.md 117), from Start to End. */
export const RECREATE_DASHBOARD_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'load-image', kind: 'next' },
  { from: 'load-image', to: 'read-dashboard', kind: 'next' },
  { from: 'read-dashboard', to: 'build-mock', kind: 'next' },
  { from: 'build-mock', to: 'save-mock', kind: 'next' },
  { from: 'save-mock', to: 'end', kind: 'next' },
];

export type DashboardBlueprint = z.output<typeof dashboardBlueprintSchema>;
export type LoadedImage = Pick<
  z.output<typeof loadedImageSchema>,
  'mediaType' | 'sizeBytes'
>;
export type BuiltMock = z.output<typeof builtMockSchema>;
export type SavedMock = z.output<typeof savedMockSchema>;

/** The mock a model wrote: an interactive visual's freeform bundle. */
export interface MockBundle {
  title: string;
  description: string;
  html: string;
  css: string;
  javascript: string;
}

/**
 * What a run hands its steps on the RequestContext: the run's image and
 * the mock built from it, phase by phase. A step throws when it is missing.
 */
export interface RecreateDashboardRuntime {
  /** Load image: the image's type and size; throws when it is missing. */
  loadImage(input: { image: string }): Promise<LoadedImage>;
  /** Read dashboard: the model's description of the image. */
  readDashboard(input: {
    question: string;
    image: string;
  }): Promise<{ blueprint: DashboardBlueprint; stopped: boolean }>;
  /** Build mock: the mock, kept by the run; `stopped` when it was stopped. */
  buildMock(input: {
    question: string;
    image: string;
    blueprint: DashboardBlueprint;
  }): Promise<{
    title: string;
    description: string;
    codeBytes: number;
    stopped: boolean;
  }>;
  /** Save mock: stores the built mock as a visual of the run. */
  saveMock(input: {
    blueprint: DashboardBlueprint;
  }): Promise<{ visualId: string; title: string }>;
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
    theme: '',
    layout: '',
    filters: [],
    widgets: [],
    columns: [],
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
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

/**
 * The Read dashboard step's blueprint from its model's reply (agents.md
 * 5.17), read leniently: a missing text is empty, an unknown kind is
 * `other`, ids are made unique, and a widget's `filteredBy` keeps only the
 * ids of the blueprint's filters. Undefined when the reply is no JSON
 * object or names no widget: there is no dashboard to recreate.
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
      options: strings(filter['options']),
    };
  });
  const widgetIds = new Set<string>();
  const widgets = objects(raw['widgets']).map((widget, index) => {
    const title = text(widget['title']) || `Widget ${index + 1}`;
    return {
      id: uniqueId(text(widget['id']) || title, 'widget', widgetIds),
      title,
      kind: oneOf(BLUEPRINT_WIDGET_KINDS, widget['kind'], 'other'),
      position: text(widget['position']),
      description: text(widget['description']),
      fields: strings(widget['fields']),
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
      type: oneOf(
        ['string', 'number', 'date', 'boolean'] as const,
        column['type'],
        'string',
      ),
      description: text(column['description']),
    }));
  return dashboardBlueprintSchema.parse({
    title: text(raw['title']) || 'Dashboard',
    summary: text(raw['summary']),
    theme: text(raw['theme']),
    layout: text(raw['layout']),
    filters,
    widgets,
    columns,
  });
}

/** The body of the first fenced block of one of `languages`, if any. */
function fencedBlock(reply: string, languages: readonly string[]): string {
  for (const language of languages) {
    const open = new RegExp(`(^|\\n)\`\`\`${language}[ \\t]*\\r?\\n`, 'i').exec(
      reply,
    );
    if (!open) continue;
    const start = open.index + open[0].length;
    const close = reply.indexOf('\n```', start - 1);
    return (close < 0 ? reply.slice(start) : reply.slice(start, close)).trim();
  }
  return '';
}

/** The text after `LABEL:` on the first line that starts with it. */
function labelledLine(reply: string, label: string): string {
  const found = new RegExp(`^${label}:[ \\t]*(.+)$`, 'im').exec(reply);
  return found ? found[1].trim() : '';
}

/**
 * The Build mock step's mock from its model's reply (agents.md 5.17): a
 * `TITLE:` line, a `DESCRIPTION:` line and three fenced blocks (`html`,
 * `css`, `javascript`). The code travels in fenced blocks, not in JSON,
 * so a long script needs no escaping. A missing title is the blueprint's;
 * a missing style sheet is empty. Undefined when there is no HTML or no
 * JavaScript: the reply is no mock.
 */
export function mockBundleOf(
  reply: string,
  blueprint: Pick<DashboardBlueprint, 'title' | 'summary'>,
): MockBundle | undefined {
  const html = fencedBlock(reply, ['html']);
  const javascript = fencedBlock(reply, ['javascript', 'js']);
  if (!html || !javascript) return undefined;
  return {
    title: labelledLine(reply, 'TITLE') || blueprint.title || 'Dashboard',
    description:
      labelledLine(reply, 'DESCRIPTION') ||
      blueprint.summary ||
      'An interactive mock of the dashboard, on invented data.',
    html,
    css: fencedBlock(reply, ['css']),
    javascript,
  };
}

/** The size of a mock's code, in bytes of UTF-8. */
export function mockCodeBytes(bundle: MockBundle): number {
  return Buffer.byteLength(
    `${bundle.html}${bundle.css}${bundle.javascript}`,
    'utf8',
  );
}

/** `1 widget`, `3 widgets`. */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The run's answer: what the mock recreates, and that its data is invented. */
export function savedMockAnswer(input: {
  title: string;
  blueprint: DashboardBlueprint;
}): string {
  const { blueprint } = input;
  const parts = [counted(blueprint.widgets.length, 'widget')];
  if (blueprint.filters.length) {
    parts.push(counted(blueprint.filters.length, 'filter'));
  }
  return [
    `Recreated **${input.title}** as an interactive mock with ${parts.join(' and ')}.`,
    '',
    ...blueprint.widgets.map(
      (widget) => `- **${widget.title}** (${widget.kind})`,
    ),
    '',
    'Every value in the mock is invented: nothing is connected to a datasource.',
  ].join('\n');
}

/** Save mock's output: the run's result. */
export function savedMock(input: {
  visualId: string;
  title: string;
  blueprint: DashboardBlueprint;
}): SavedMock {
  return {
    visualId: input.visualId,
    title: input.title,
    widgetCount: input.blueprint.widgets.length,
    filterCount: input.blueprint.filters.length,
    answer: savedMockAnswer(input),
    blueprint: input.blueprint,
  };
}
