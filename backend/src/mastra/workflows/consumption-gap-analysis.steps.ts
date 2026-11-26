/**
 * The step catalogue of the Consumption Gap Analysis workflow (agents.md
 * 5.20): its id and name, the steps and edges the workflow page shows, and
 * the runtime a run hands its steps. The pure code lives beside it:
 * ./consumption-gap.lineage.ts (lineage inference), ./consumption-gap.gaps.ts
 * (layers, requirements from dashboards, tracing, probes, fallback fixes) and
 * ./consumption-gap.report.ts (the drawn report and the answer). No
 * framework import, so the catalogue and Jest can read it without loading
 * Mastra; ./consumption-gap-analysis.workflow.ts builds the Mastra steps.
 */
import {
  contractStepEntry,
  type ContractStepEntry,
  type WorkflowEdge,
  type WorkflowStepExit,
} from './workflow-contract';
import { CONSUMPTION_GAP_STEP_SCHEMAS } from './consumption-gap-analysis.schemas';
import type {
  FieldMapping,
  GapFix,
  LayerTable,
  Lineage,
  Requirement,
  RequirementAssessment,
  ReferenceDashboard,
} from './consumption-gap-analysis.schemas';
import type { DashboardBlueprint } from './dashboard-blueprint.schemas';
import type { MockBundle } from './live-dashboard';

/** The workflow's registry key and id. */
export const CONSUMPTION_GAP_WORKFLOW_ID = 'consumption-gap-analysis';

/** The name the app shows for the workflow (workflows R1). */
export const CONSUMPTION_GAP_WORKFLOW_NAME = 'Consumption Gap Analysis';

/** What the catalogue says the workflow does. */
export const CONSUMPTION_GAP_DESCRIPTION =
  'Checks whether the Consumption layer of a medallion model (Landing, Normalized, Consumption) can answer your questions and feed your reference dashboards, traces every gap through inferred lineage, and recommends where to fix it.';

/** The RequestContext key of a run's runtime. */
export const CONSUMPTION_GAP_RUNTIME_KEY = 'consumption-gap-analysis-runtime';

/** The most business questions a run takes (one per line). */
export const GAP_MAX_QUESTIONS = 20;

/** The option that confirms the requirements as they are. */
export const CONFIRM_REQUIREMENTS_OPTION = 'Confirm the requirements';

const SCHEMAS = CONSUMPTION_GAP_STEP_SCHEMAS;

const MODEL_EXITS: readonly WorkflowStepExit[] = [
  { label: 'the model returns an error', outcome: 'fails' },
  { label: 'you stop it', outcome: 'stops' },
];

/**
 * The steps, in catalogue order: the order they run in. Resolve layers
 * comes first, so a dataset with no Consumption schema is refused before
 * any model call; the lineage checks start at Load layer catalogs and run
 * while the requirements are derived, and Infer
 * lineage takes them (agents.md 5.20).
 */
export const CONSUMPTION_GAP_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'resolve-layers',
      title: 'Resolve layers',
      kind: 'code',
      summary:
        "Reads the datasets' schema notes: which schemas are Landing, Normalized and Consumption. No LLM.",
      exits: [{ label: 'no schema is tagged Consumption', outcome: 'fails' }],
    },
    SCHEMAS['resolve-layers'],
  ),
  contractStepEntry(
    {
      id: 'load-layer-catalogs',
      title: 'Load layer catalogs',
      kind: 'code',
      summary:
        'Lists the entities of every tagged schema and their columns, and starts the lineage checks, which run while the next steps do. No row is read. No LLM.',
      exits: [],
    },
    SCHEMAS['load-layer-catalogs'],
  ),
  contractStepEntry(
    {
      id: 'derive-requirements',
      title: 'Derive requirements',
      kind: 'agent',
      summary:
        'The Requirements Analyst turns each business question into the measures, dimensions, filters, grain and periods it needs; the saved dashboard, when the run has one, is loaded from Artifacts and each of its widgets and filters becomes a requirement in code, from its blueprint.',
      exits: [
        ...MODEL_EXITS,
        { label: 'the saved dashboard no longer exists', outcome: 'fails' },
      ],
      modelOnly: true,
    },
    SCHEMAS['derive-requirements'],
  ),
  contractStepEntry(
    {
      id: 'infer-lineage',
      title: 'Infer lineage',
      kind: 'code',
      summary:
        'Finds which columns feed which, layer to layer, without declared lineage: candidates by normalised name and type, then a read-only query per candidate that checks how many values match (started at Load layer catalogs). No LLM.',
      exits: [{ label: 'you stop it', outcome: 'stops' }],
    },
    SCHEMAS['infer-lineage'],
  ),
  contractStepEntry(
    {
      id: 'confirm-requirements',
      title: 'Confirm requirements',
      kind: 'code',
      summary:
        'Waits for you to confirm the requirements or say what to change; a change is applied by the Requirements Analyst before the run goes on.',
      exits: [{ label: 'until you answer', outcome: 'waits' }, ...MODEL_EXITS],
    },
    SCHEMAS['confirm-requirements'],
  ),
  contractStepEntry(
    {
      id: 'map-requirements',
      title: 'Map requirements',
      kind: 'agent',
      summary:
        'The Layer Mapper names, for every field of every requirement, the column of each layer that holds it. Each proposed source is then checked against the catalogs.',
      exits: [...MODEL_EXITS],
      modelOnly: true,
    },
    SCHEMAS['map-requirements'],
  ),
  contractStepEntry(
    {
      id: 'trace-gaps',
      title: 'Trace gaps',
      kind: 'code',
      summary:
        'Gives every requirement a status from its fields and the lineage: supported, derivable, grain, in Normalized only, in Landing only, or missing. No LLM.',
      exits: [],
    },
    SCHEMAS['trace-gaps'],
  ),
  contractStepEntry(
    {
      id: 'probe-evidence',
      title: 'Probe evidence',
      kind: 'code',
      summary:
        'Runs at most two read-only queries per requirement (rows, nulls, the periods it names) and marks one whose data does not answer it. Each query is a source of the answer. No LLM.',
      exits: [{ label: 'you stop it', outcome: 'stops' }],
    },
    SCHEMAS['probe-evidence'],
  ),
  contractStepEntry(
    {
      id: 'recommend-fixes',
      title: 'Recommend fixes',
      kind: 'agent',
      summary:
        'The Gap Advisor groups the gaps into fixes, each starting in the layer that has the data, with a proposed change that is never run.',
      exits: [...MODEL_EXITS],
      modelOnly: true,
    },
    SCHEMAS['recommend-fixes'],
  ),
  contractStepEntry(
    {
      id: 'render-report',
      title: 'Render report',
      kind: 'code',
      summary:
        'Draws the report (matrix, lineage graph, dashboards with badges, fixes) as an interactive visual of the run and writes the answer. No LLM.',
      exits: [],
    },
    SCHEMAS['render-report'],
  ),
];

/** The edges of the workflow (api.md 117), from Start to End. */
export const CONSUMPTION_GAP_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'resolve-layers', kind: 'next' },
  { from: 'resolve-layers', to: 'load-layer-catalogs', kind: 'next' },
  { from: 'load-layer-catalogs', to: 'derive-requirements', kind: 'next' },
  { from: 'derive-requirements', to: 'infer-lineage', kind: 'next' },
  { from: 'infer-lineage', to: 'confirm-requirements', kind: 'next' },
  { from: 'confirm-requirements', to: 'map-requirements', kind: 'next' },
  { from: 'map-requirements', to: 'trace-gaps', kind: 'next' },
  { from: 'trace-gaps', to: 'probe-evidence', kind: 'next' },
  { from: 'probe-evidence', to: 'recommend-fixes', kind: 'next' },
  { from: 'recommend-fixes', to: 'render-report', kind: 'next' },
  { from: 'render-report', to: 'end', kind: 'next' },
];

/** One read-only query a step asks the run to run and record as a source. */
export interface GapQuery {
  /** Unique within the step: the result comes back under it. */
  id: string;
  datasourceId: string;
  sql: string;
  /** One business sentence: what the query checks (the inspector shows it). */
  rationale: string;
}

/** One query's result, or its error. */
export interface GapQueryResult {
  id: string;
  columns: string[];
  rows: Record<string, unknown>[];
  /** Set when the query failed; then `rows` is empty. */
  error: string | null;
}

/**
 * What a run hands its steps on the RequestContext (built in
 * modules/sessions/turn/turn-engine.ts). A step throws when it is missing.
 */
export interface ConsumptionGapRuntime {
  /** Derive requirements: the saved dashboard; throws when it is gone. */
  loadDashboard(input: {
    artifact: string;
  }): Promise<{ name: string; blueprint: DashboardBlueprint }>;
  /**
   * Resolve layers and Load layer catalogs: the run's datasets' schema
   * notes and entities, fetched once per run (both steps ask).
   */
  datasetLayers(input: { datasets: string[] }): Promise<
    Array<{
      dataset: string;
      datasourceId: string | null;
      datasourceKind: string | null;
      schemas: Array<{ key: string; layer?: string; description?: string }>;
      entities: Array<{
        key: string;
        columns: Array<{ name: string; type: string }> | null;
      }>;
    }>
  >;
  /**
   * Probe evidence: run read-only queries, each recorded in query order as
   * a `run_readonly_sql` source of the answer (the query inspector). A
   * failed query is a result with `error`, never a thrown error. Stops
   * before the next query once the run is stopped.
   */
  runQueries(input: {
    queries: GapQuery[];
  }): Promise<{ results: GapQueryResult[]; stopped: boolean }>;
  /**
   * Load layer catalogs: start the lineage checks as `runQueries` runs
   * them, while the next steps run. Their sources reach the answer, in
   * query order, when Infer lineage takes them.
   */
  startLineage(input: { queries: GapQuery[] }): void;
  /** Infer lineage: the checks started at Load layer catalogs; rethrows. */
  takeLineage(): Promise<{ results: GapQueryResult[]; stopped: boolean }>;
  /** Derive requirements: the Requirements Analyst over the questions. */
  deriveRequirements(input: {
    questions: string[];
    dashboards: ReferenceDashboard[];
  }): Promise<{ requirements: Requirement[]; stopped: boolean }>;
  /** Confirm requirements: the Requirements Analyst applies the user's edits. */
  reviseRequirements(input: {
    questions: string[];
    requirements: Requirement[];
    feedback: string;
  }): Promise<{ requirements: Requirement[]; stopped: boolean }>;
  /** Map requirements: the Layer Mapper, checked against the catalogs. */
  mapRequirements(input: {
    requirements: Requirement[];
    tables: LayerTable[];
  }): Promise<{ mappings: FieldMapping[]; stopped: boolean }>;
  /** Recommend fixes: the Gap Advisor, checked against the requirements. */
  recommendFixes(input: {
    requirements: Requirement[];
    assessments: RequirementAssessment[];
    tables: LayerTable[];
    lineage: Lineage;
  }): Promise<{ fixes: GapFix[]; stopped: boolean }>;
  /** Render report: stores the drawn report as a visual and shows the answer. */
  saveReport(input: {
    bundle: MockBundle;
    answer: string;
    title: string;
  }): Promise<{ visualId: string; title: string }>;
}
