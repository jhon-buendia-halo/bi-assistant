/**
 * The turn workflow of Questions to Insights v2 (ADR-0034; agents.md 5.11):
 * its step ids and titles, the contract between its Analyse step and the
 * session code, and the pure code of its deterministic steps. Plain data and
 * functions, no framework import, so the session code and the tests can read
 * it without loading Mastra; the workflow itself is built in
 * ./qti-v2-turn.workflow.ts.
 */
import { getDatasetToolServices } from '../tool-services';

/** The workflow's registry key and id. */
export const QTI_V2_TURN_WORKFLOW_ID = 'qti-v2-turn';

/** How a step can end other than by passing its output on. */
export interface WorkflowStepExit {
  label: string;
  /** `fails`: the run stops with an error; `stops`: it ends early. */
  outcome: 'fails' | 'stops';
}

/**
 * One step of a code-defined turn workflow, as the step catalogue describes
 * it (agents.md 5.11): the workflow bar reads `id` and `title`, the agent's
 * Graph tab all of it (agents-evals R108). `input` and `output` name the
 * fields of the step's schemas, in schema order; a unit test of the built
 * workflow checks them.
 */
export interface WorkflowStepEntry {
  id: string;
  title: string;
  kind: 'code' | 'agent';
  summary: string;
  input: readonly string[];
  output: readonly string[];
  exits: readonly WorkflowStepExit[];
}

/** The steps, in the order they run: the session's workflow bar shows them. */
export const QTI_V2_TURN_STEPS = [
  {
    id: 'receive-question',
    title: 'Receive question',
    kind: 'code',
    summary: 'Trims the question. An empty one fails the step.',
    input: ['question', 'datasets'],
    output: ['question', 'datasets'],
    exits: [{ label: 'Empty question', outcome: 'fails' }],
  },
  {
    id: 'load-catalog',
    title: 'Load catalog',
    kind: 'code',
    summary: "Lists the entities of the session's datasets. No LLM.",
    input: ['question', 'datasets'],
    output: ['question', 'catalog'],
    exits: [],
  },
  {
    id: 'analyse',
    title: 'Analyse',
    kind: 'agent',
    summary:
      'The agent answers with its tools and the catalog as context, streamed to the chat.',
    input: ['question', 'catalog'],
    output: ['calls', 'stopped'],
    exits: [
      { label: 'Model error', outcome: 'fails' },
      { label: 'Stop', outcome: 'stops' },
    ],
  },
  {
    id: 'wrap-up',
    title: 'Wrap up',
    kind: 'code',
    summary:
      "Counts the turn's SQL queries, failed queries and rows, and logs the summary.",
    input: ['calls', 'stopped'],
    output: ['sqlQueries', 'failedQueries', 'rows'],
    exits: [],
  },
] as const satisfies readonly WorkflowStepEntry[];

/** The run's RequestContext key holding the per-run `QtiV2TurnRuntime`. */
export const QTI_V2_TURN_RUNTIME_KEY = 'qti-v2-turn-runtime';

/** The workflow's input. */
export interface QtiV2TurnInput {
  question: string;
  /** The session's dataset names. */
  datasets: string[];
}

/** One entity of the session's datasets, as the Load catalog step lists it. */
export interface CatalogEntity {
  entity: string;
  dataset: string;
  datasourceId: string | null;
  datasourceKind: string | null;
  columnCount: number | null;
}

/** One tool call of the turn, as the Analyse step reports it. */
export interface AnalyseCall {
  tool: string;
  rowCount?: number;
  failed: boolean;
}

/** What the Analyse step returns. */
export interface AnalyseOutcome {
  calls: AnalyseCall[];
  /** The user stopped the turn: the run ends after Analyse. */
  stopped: boolean;
}

/** The Wrap up step's summary: the run's result. */
export interface QtiV2TurnSummary {
  sqlQueries: number;
  failedQueries: number;
  rows: number;
}

/**
 * What the session code hands the run (on its RequestContext): the Analyse
 * step streams the agent through it, so the chat sees the turn as today.
 */
export interface QtiV2TurnRuntime {
  analyse(input: {
    question: string;
    catalog: CatalogEntity[];
    catalogBlock: string;
  }): Promise<AnalyseOutcome>;
}

/** Step 1: the trimmed question; an empty one fails the step. */
export function receiveQuestion(question: string): string {
  const trimmed = (question ?? '').trim();
  if (!trimmed) throw new Error('The question is empty');
  return trimmed;
}

/**
 * Step 2: the entities of the session's datasets, read through the dataset
 * tools' own services, in dataset then table order. No LLM.
 */
export async function loadCatalog(
  datasets: readonly string[],
): Promise<CatalogEntity[]> {
  const snapshots = await getDatasetToolServices().getDatasets([...datasets]);
  return snapshots.flatMap((dataset) =>
    dataset.tables.map((entity) => ({
      entity,
      dataset: dataset.name,
      datasourceId: dataset.datasourceId ?? null,
      datasourceKind: dataset.datasourceKind ?? null,
      columnCount:
        dataset.entities?.find((e) => e.key === entity)?.columns.length ?? null,
    })),
  );
}

/** The catalog as the Analyse step's extra system message (agents.md 5.11). */
export function catalogBlock(catalog: readonly CatalogEntity[]): string {
  if (!catalog.length) return 'Catalog loaded for this turn: no entities.';
  return [
    `Catalog loaded for this turn: ${catalog.length} ${catalog.length === 1 ? 'entity' : 'entities'}.`,
    ...catalog.map(
      (e) =>
        `- ${e.entity} (dataset: ${e.dataset}; ${e.columnCount ?? '?'} columns)`,
    ),
  ].join('\n');
}

/** Step 4: the turn's `run_readonly_sql` calls and the rows they returned. */
export function wrapUp(calls: readonly AnalyseCall[]): QtiV2TurnSummary {
  const sql = calls.filter((call) => call.tool === 'run_readonly_sql');
  const failed = sql.filter((call) => call.failed);
  return {
    sqlQueries: sql.length,
    failedQueries: failed.length,
    rows: sql
      .filter((call) => !call.failed)
      .reduce((sum, call) => sum + (call.rowCount ?? 0), 0),
  };
}
