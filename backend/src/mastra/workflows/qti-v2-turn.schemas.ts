/**
 * The data contract of the turn workflow of Questions to Insights v2
 * (agents.md 5.11, 5.12): the Zod schema of the workflow's input and of every
 * step's input and output. The one source of truth: the Mastra workflow
 * (./qti-v2-turn.workflow.ts) builds its steps from it, and the step
 * catalogue (./qti-v2-turn.steps.ts) derives each step's field names and
 * JSON Schema from it. Zod only, no framework import, so Jest and the
 * catalogue can load it without Mastra.
 */
import { z } from 'zod';

/** The workflow's input, and what Receive question passes on. */
export const turnInputSchema = z.object({
  question: z.string().describe("The user's question."),
  datasets: z.array(z.string()).describe("The run's dataset names."),
});

/** One entity of the run's datasets, as Load catalog lists it. */
export const catalogEntitySchema = z.object({
  entity: z.string().describe('The entity (table) key.'),
  dataset: z.string().describe('The dataset it belongs to.'),
  datasourceId: z.string().nullable().describe("The dataset's datasource id."),
  datasourceKind: z
    .string()
    .nullable()
    .describe('postgres, databricks or rest.'),
  columnCount: z.number().nullable().describe('Its column count, when known.'),
});

/** What Load catalog passes on, and what Analyse receives. */
export const catalogedQuestionSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
});

/** One tool call of the turn, as Analyse reports it. */
export const analyseCallSchema = z.object({
  tool: z.string().describe('The tool name.'),
  rowCount: z.number().optional().describe('Rows a SQL call returned.'),
  failed: z.boolean().describe('Whether the call failed.'),
});

/** What Analyse returns, and what Wrap up receives. */
export const analyseOutcomeSchema = z.object({
  calls: z
    .array(analyseCallSchema)
    .describe("The turn's tool calls, in order."),
  stopped: z
    .boolean()
    .describe(
      'The turn ended early: the user stopped it or the agent asked a clarifying question.',
    ),
});

/** The Wrap up summary: the run's result. */
export const turnSummarySchema = z.object({
  sqlQueries: z.number().describe('SQL queries the turn ran.'),
  failedQueries: z.number().describe('Of those, the ones that failed.'),
  rows: z.number().describe('Rows the successful queries returned.'),
});

/** Every step's input and output schema, by step id, in run order. */
export const QTI_V2_TURN_STEP_SCHEMAS = {
  'receive-question': { input: turnInputSchema, output: turnInputSchema },
  'load-catalog': { input: turnInputSchema, output: catalogedQuestionSchema },
  analyse: { input: catalogedQuestionSchema, output: analyseOutcomeSchema },
  'wrap-up': { input: analyseOutcomeSchema, output: turnSummarySchema },
} as const;
