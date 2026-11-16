/**
 * The step catalogue of the Map a Dashboard to Data workflow (agents.md
 * 5.18): its id and name, the steps and edges the workflow page shows and
 * the runtime a run hands its steps. The dashboard's own code (the readers
 * of the model replies, the check of a mapping against the catalog, the
 * drawn dashboard and the explanation) is in ./recreate-dashboard.steps.ts.
 * No framework import, so the catalogue and Jest can read it without
 * loading Mastra; ./map-dashboard-data.workflow.ts builds the Mastra steps
 * from it.
 */
import type { z } from 'zod';
import {
  contractStepEntry,
  type CatalogEntity,
  type ContractStepEntry,
  type EntityColumns,
} from './answer-business-question.steps';
import { MAP_DASHBOARD_DATA_STEP_SCHEMAS } from './map-dashboard-data.schemas';
import type { renderedDashboardSchema } from './map-dashboard-data.schemas';
import {
  mappingCounts,
  type DashboardBlueprint,
  type DataMapping,
  type MockBundle,
} from './recreate-dashboard.steps';
import type { WorkflowEdge } from './workflow-contract';

/** The workflow's registry key and id. */
export const MAP_DASHBOARD_DATA_WORKFLOW_ID = 'map-dashboard-data';

/** The name the app shows for the workflow (workflows R1). */
export const MAP_DASHBOARD_DATA_WORKFLOW_NAME = 'Map a Dashboard to Data';

/** What the catalogue says the workflow does. */
export const MAP_DASHBOARD_DATA_DESCRIPTION =
  'Maps the widgets and filters of a dashboard saved in Artifacts to the columns of the datasets you pick, and draws the dashboard with a mark on everything the data cannot feed.';

/** What a run asks when its instructions are left empty. */
export const MAP_DASHBOARD_DATA_DEFAULT_QUESTION =
  'Map this dashboard to the datasets';

/** The RequestContext key of a run's runtime. */
export const MAP_DASHBOARD_DATA_RUNTIME_KEY = 'map-dashboard-data-runtime';

const SCHEMAS = MAP_DASHBOARD_DATA_STEP_SCHEMAS;

/**
 * The steps, in catalogue order. Their field names and JSON Schemas come
 * from ./map-dashboard-data.schemas.ts; how they connect is
 * `MAP_DASHBOARD_DATA_EDGES`.
 */
export const MAP_DASHBOARD_DATA_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'load-dashboard',
      title: 'Load dashboard',
      kind: 'code',
      summary:
        'Reads the saved dashboard of the artifact the run names: its filters, its widgets and the columns they read. No LLM.',
      exits: [
        { label: 'the saved dashboard no longer exists', outcome: 'fails' },
      ],
    },
    SCHEMAS['load-dashboard'],
  ),
  contractStepEntry(
    {
      id: 'load-dashboard-catalog',
      title: 'Load catalog',
      kind: 'code',
      summary:
        'Lists the entities of the datasets you picked and the columns of each. No LLM.',
      exits: [],
    },
    SCHEMAS['load-dashboard-catalog'],
  ),
  contractStepEntry(
    {
      id: 'map-data',
      title: 'Map data',
      kind: 'agent',
      summary:
        'The Data Mapper ties every column the dashboard reads to a column of the datasets, or says what is missing. Each proposed source is then checked against the catalog.',
      exits: [
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
      ],
      modelOnly: true,
    },
    SCHEMAS['map-data'],
  ),
  contractStepEntry(
    {
      id: 'render-dashboard',
      title: 'Render dashboard',
      kind: 'code',
      summary:
        "Draws the dashboard with the fixed runtime, each widget marked mapped, partly mapped or with no data, stores it as an interactive visual of the run and writes the mapping's explanation. No LLM.",
      exits: [],
    },
    SCHEMAS['render-dashboard'],
  ),
];

/** The edges of the workflow (api.md 117), from Start to End. */
export const MAP_DASHBOARD_DATA_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'load-dashboard', kind: 'next' },
  { from: 'load-dashboard', to: 'load-dashboard-catalog', kind: 'next' },
  { from: 'load-dashboard-catalog', to: 'map-data', kind: 'next' },
  { from: 'map-data', to: 'render-dashboard', kind: 'next' },
  { from: 'render-dashboard', to: 'end', kind: 'next' },
];

export type RenderedDashboard = z.output<typeof renderedDashboardSchema>;

/**
 * What a run hands its steps on the RequestContext: the saved dashboard,
 * the model call and the store of the drawn dashboard. A step throws when
 * it is missing.
 */
export interface MapDashboardDataRuntime {
  /** Load dashboard: the artifact's name and blueprint; throws when gone. */
  loadDashboard(input: {
    artifact: string;
  }): Promise<{ name: string; blueprint: DashboardBlueprint }>;
  /** Map data: the model's mapping, checked against the catalog. */
  mapData(input: {
    question: string;
    blueprint: DashboardBlueprint;
    catalog: CatalogEntity[];
    columns: EntityColumns[];
  }): Promise<{ mapping: DataMapping; stopped: boolean }>;
  /** Render dashboard: stores the drawn dashboard as a visual of the run. */
  saveMappedDashboard(input: {
    bundle: MockBundle;
    answer: string;
  }): Promise<{ visualId: string; title: string }>;
}

/** The instructions a run follows: its own, else the default. */
export function mapDashboardQuestion(question: string): string {
  return question.trim() || MAP_DASHBOARD_DATA_DEFAULT_QUESTION;
}

/** Render dashboard's output: the run's result. */
export function renderedDashboard(input: {
  visualId: string;
  title: string;
  answer: string;
  blueprint: DashboardBlueprint;
  mapping: DataMapping;
}): RenderedDashboard {
  const counts = mappingCounts(input.mapping);
  return {
    visualId: input.visualId,
    title: input.title,
    widgetCount: input.blueprint.widgets.length,
    filterCount: input.blueprint.filters.length,
    mappedCount: counts.mapped,
    partialCount: counts.partial,
    unmappedCount: counts.unmapped,
    answer: input.answer,
    blueprint: input.blueprint,
    mapping: input.mapping,
  };
}
