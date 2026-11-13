/**
 * The turn workflow of Questions to Insights v2 (ADR-0034; agents.md 5.11):
 * its step ids and titles, the contract between its Analyse step and the
 * session code, and the pure code of its deterministic steps. Plain data and
 * functions (its schemas are ./qti-v2-turn.schemas.ts), no framework import,
 * so the session code and the tests can read it without loading Mastra; the
 * workflow itself is built in ./qti-v2-turn.workflow.ts.
 */
import type { z } from 'zod';
import { getDatasetToolServices } from '../tool-services';
import {
  QTI_V2_TURN_STEP_SCHEMAS,
  type analyseCallSchema,
  type analyseOutcomeSchema,
  type catalogEntitySchema,
  type turnInputSchema,
  type turnSummarySchema,
} from './qti-v2-turn.schemas';
import {
  contractJsonSchema,
  schemaFieldNames,
  type JsonSchema,
} from './workflow-contract';

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
 * fields of the step's schemas, in schema order: a catalogued workflow's
 * steps derive them from their declared schemas (`inputSchema`,
 * `outputSchema`; agents.md 5.12).
 */
export interface WorkflowStepEntry {
  id: string;
  title: string;
  kind: 'code' | 'agent';
  summary: string;
  input: readonly string[];
  output: readonly string[];
  exits: readonly WorkflowStepExit[];
  /** The step's declared input, as JSON Schema (catalogued workflows). */
  inputSchema?: JsonSchema;
  /** The step's declared output, as JSON Schema (catalogued workflows). */
  outputSchema?: JsonSchema;
}

/** A catalogued step: its field names and JSON Schemas derived from its Zod schemas. */
export type ContractStepEntry = WorkflowStepEntry & {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
};

/** A step's catalogue entry from its description and its declared schemas. */
export function contractStepEntry(
  step: Omit<
    WorkflowStepEntry,
    'input' | 'output' | 'inputSchema' | 'outputSchema'
  >,
  schemas: { input: z.ZodType; output: z.ZodType },
): ContractStepEntry {
  const inputSchema = contractJsonSchema(schemas.input, 'input');
  const outputSchema = contractJsonSchema(schemas.output, 'output');
  return {
    ...step,
    input: schemaFieldNames(inputSchema),
    output: schemaFieldNames(outputSchema),
    inputSchema,
    outputSchema,
  };
}

const SCHEMAS = QTI_V2_TURN_STEP_SCHEMAS;

/**
 * The steps, in the order they run: the session's workflow bar shows them.
 * Their field names and JSON Schemas come from ./qti-v2-turn.schemas.ts.
 */
export const QTI_V2_TURN_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'receive-question',
      title: 'Receive question',
      kind: 'code',
      summary:
        'Trims the question. The input node has checked it before the run.',
      exits: [],
    },
    SCHEMAS['receive-question'],
  ),
  contractStepEntry(
    {
      id: 'load-catalog',
      title: 'Load catalog',
      kind: 'code',
      summary: "Lists the entities of the session's datasets. No LLM.",
      exits: [],
    },
    SCHEMAS['load-catalog'],
  ),
  contractStepEntry(
    {
      id: 'analyse',
      title: 'Analyse',
      kind: 'agent',
      summary:
        'The agent answers with its tools and the catalog as context, streamed to the chat.',
      exits: [
        { label: 'Model error', outcome: 'fails' },
        { label: 'Stop', outcome: 'stops' },
      ],
    },
    SCHEMAS.analyse,
  ),
  contractStepEntry(
    {
      id: 'wrap-up',
      title: 'Wrap up',
      kind: 'code',
      summary:
        "Counts the turn's SQL queries, failed queries and rows, and logs the summary.",
      exits: [],
    },
    SCHEMAS['wrap-up'],
  ),
];

/** The run's RequestContext key holding the per-run `QtiV2TurnRuntime`. */
export const QTI_V2_TURN_RUNTIME_KEY = 'qti-v2-turn-runtime';

/** The workflow's input: the question and the session's dataset names. */
export type QtiV2TurnInput = z.output<typeof turnInputSchema>;

/** One entity of the session's datasets, as the Load catalog step lists it. */
export type CatalogEntity = z.output<typeof catalogEntitySchema>;

/** One tool call of the turn, as the Analyse step reports it. */
export type AnalyseCall = z.output<typeof analyseCallSchema>;

/** What the Analyse step returns; `stopped`: the run ends after Analyse. */
export type AnalyseOutcome = z.output<typeof analyseOutcomeSchema>;

/** The Wrap up step's summary: the run's result. */
export type QtiV2TurnSummary = z.output<typeof turnSummarySchema>;

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

/**
 * Step 1: the trimmed question. It never fails: the run's input was checked
 * as a whole before the run (api.md 118, 119), so a blank question never
 * reaches it.
 */
export function receiveQuestion(question: string): string {
  return (question ?? '').trim();
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
