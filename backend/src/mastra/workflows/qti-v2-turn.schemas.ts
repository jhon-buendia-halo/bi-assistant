/**
 * The data contract of the turn workflow of Questions to Insights v2
 * (agents.md 5.11, 5.12): the Zod schema of the workflow's input and of every
 * step's input and output. The one source of truth: the Mastra workflow
 * (./qti-v2-turn.workflow.ts) builds its steps from it, and the step
 * catalogue (./qti-v2-turn.steps.ts) derives each step's field names and
 * JSON Schema from it. Zod only, no framework import, so Jest and the
 * catalogue can load it without Mastra.
 *
 * The flow (agents.md 5.11): Receive question → Load catalog → Plan, then a
 * branch: Clarify (the run waits for the user's answer, then goes back to
 * Plan with it), or the analysis loop (Analyse → Validate, retried once;
 * Analyse can wait for an answer too) → Write answer → Wrap up. A step
 * passes on what the steps after it read, so each carries the question, the
 * catalog and the plan forward: the engine hands a step only its previous
 * step's output.
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

/** One entity's columns, as Load catalog hands them to Plan. */
export const entityColumnsSchema = z.object({
  entity: z.string().describe('The entity (table) key.'),
  columns: z
    .array(
      z.object({
        name: z.string().describe('The column name.'),
        type: z.string().describe('Its type, as the dataset records it.'),
      }),
    )
    .describe('Its columns, in dataset order (capped).'),
  more: z
    .number()
    .describe('How many more columns it has that are not listed.'),
});

/** What Load catalog passes on, and what Plan receives. */
export const catalogedQuestionSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  columns: z
    .array(entityColumnsSchema)
    .describe(
      'The columns of each entity, for Plan only: at most 40 per entity and 400 in all.',
    ),
});

/** The clarifying question a plan asks instead of analysing. */
export const planClarificationSchema = z.object({
  question: z.string().describe('One short clarifying question.'),
  options: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe(
      '2-4 answer options, each a short title, optionally followed by " — " and one line explaining it.',
    ),
});

/**
 * What a waiting step suspends with (the run's `waitingFor`, api.md 138):
 * one clarifying question and its options.
 */
export const clarifyingQuestionSchema = z.object({
  question: z.string().describe('The clarifying question the run waits on.'),
  options: z.array(z.string()).describe('Its 2-4 answer options.'),
});

/** What resumes a waiting step (api.md 138): the user's answer. */
export const clarificationAnswerSchema = z.object({
  answer: z
    .string()
    .describe("The user's answer: one of the options or their own words."),
});

/** A clarifying question with the user's answer to it. */
export const answeredClarificationSchema = z.object({
  question: z.string().describe('The clarifying question the run asked.'),
  options: z.array(z.string()).describe('Its answer options.'),
  answer: z.string().describe("The user's answer."),
});

/** What Plan receives: Load catalog's output, or Clarify's with the answer. */
export const planInputSchema = catalogedQuestionSchema.extend({
  clarification: answeredClarificationSchema
    .optional()
    .describe(
      'After Clarify: its question and the answer. Plan plans with them and never asks again.',
    ),
});

/** What Clarify passes back to Plan: Plan's input with the answer. */
export const clarifiedQuestionSchema = catalogedQuestionSchema.extend({
  clarification: answeredClarificationSchema.describe(
    'The clarifying question and the answer Plan plans with.',
  ),
});

/** The plan the Plan step's model writes (PlanOutput). */
export const planSchema = z.object({
  question: z
    .string()
    .describe('The question restated in one sentence, its defaults explicit.'),
  measures: z.array(z.string()).describe('The figures the answer needs.'),
  entities: z
    .array(z.string())
    .describe('The catalog entities the analysis will likely read.'),
  scope: z.string().describe('The slice of the data the answer covers.'),
  assumptions: z
    .array(z.string())
    .describe('Each default chosen for something the question leaves open.'),
  needsClarification: z
    .boolean()
    .describe(
      'The metric or meaning is undefined and the choice changes the analysis.',
    ),
  clarification: planClarificationSchema
    .nullable()
    .describe(
      'The question to ask when needsClarification is true, else null.',
    ),
});

/** What Plan passes on: the question and catalog, with the plan. */
export const plannedQuestionSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  plan: planSchema.describe('The analysis plan.'),
  stopped: z
    .boolean()
    .optional()
    .describe(
      'Set when the turn was stopped while Plan ran: nothing after Plan runs.',
    ),
});

/** One check Validate ran over an analysis attempt. */
export const validationFindingSchema = z.object({
  check: z.string().describe('What was checked.'),
  passed: z.boolean().describe('Whether the check passed.'),
  detail: z.string().describe('What the check found.'),
});

/** What Analyse receives: the plan, and on a retry the failed validation. */
export const analyseInputSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  plan: planSchema.describe('The analysis plan.'),
  attempt: z
    .number()
    .optional()
    .describe('On a retry: the attempt Validate checked.'),
  findings: z
    .array(validationFindingSchema)
    .optional()
    .describe("On a retry: the previous attempt's validation findings."),
});

/** One tool call of the turn, as Analyse reports it. */
export const analyseCallSchema = z.object({
  tool: z.string().describe('The tool name.'),
  rowCount: z.number().optional().describe('Rows a SQL call returned.'),
  failed: z.boolean().describe('Whether the call failed.'),
});

/** One `run_readonly_sql` call of an analysis attempt, with its rows. */
export const analyseQuerySchema = z.object({
  sql: z.string().describe('The statement that ran.'),
  rationale: z.string().optional().describe('Why the agent ran it.'),
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .describe('Its result rows, at most 50.'),
  rowCount: z.number().describe('Rows it returned.'),
  truncated: z
    .boolean()
    .describe('The result was cut at its row limit or when stored.'),
  error: z.string().optional().describe('Why it failed.'),
});

/** What Analyse returns, and what Validate receives. */
export const analyseOutcomeSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  plan: planSchema.describe('The analysis plan.'),
  attempt: z.number().describe('This attempt: 1, or 2 on the retry.'),
  calls: z
    .array(analyseCallSchema)
    .describe("The attempt's tool calls, in order."),
  queries: z
    .array(analyseQuerySchema)
    .describe("The attempt's SQL queries, in order."),
  text: z.string().describe("The agent's own notes; never the run's answer."),
  stopped: z.boolean().describe('The turn ended early: the user stopped it.'),
});

/** What Validate passes on: its verdict, with what Write answer reads. */
export const validateOutcomeSchema = z.object({
  ok: z
    .boolean()
    .describe('Every check passed (the measures check is a warning only).'),
  attempt: z.number().describe('The attempt it checked: 1 or 2.'),
  findings: z
    .array(validationFindingSchema)
    .describe('Each check, passed or not.'),
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  plan: planSchema.describe('The analysis plan.'),
  calls: z
    .array(analyseCallSchema)
    .describe("The checked attempt's tool calls."),
  queries: z
    .array(analyseQuerySchema)
    .describe("The checked attempt's SQL queries."),
});

/** What Write answer receives. */
export const writeAnswerInputSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  plan: planSchema.describe('The analysis plan.'),
  queries: z
    .array(analyseQuerySchema)
    .describe('The SQL queries of the last attempt, with their rows.'),
  findings: z
    .array(validationFindingSchema)
    .describe("The last attempt's validation findings."),
  calls: z
    .array(analyseCallSchema)
    .describe("The last attempt's tool calls, for Wrap up."),
});

/** The answer the Write answer step's model writes (AnswerOutput). */
export const answerSchema = z.object({
  headline: z
    .string()
    .describe('One line that answers the question with the key figure.'),
  answer: z
    .string()
    .describe('The whole answer in Markdown, starting with the headline.'),
});

/** What Write answer passes on: the answer, and the calls Wrap up counts. */
export const writtenAnswerSchema = z.object({
  headline: z
    .string()
    .describe('One line that answers the question with the key figure.'),
  answer: z
    .string()
    .describe("The run's answer in Markdown, starting with the headline."),
  calls: z.array(analyseCallSchema).describe("The last attempt's tool calls."),
});

/** What Wrap up receives. */
export const wrapUpInputSchema = z.object({
  answer: z.string().describe("The run's answer."),
  calls: z.array(analyseCallSchema).describe("The last attempt's tool calls."),
});

/** The Wrap up summary: the run's result. */
export const turnSummarySchema = z.object({
  sqlQueries: z.number().describe('SQL queries the last attempt ran.'),
  failedQueries: z.number().describe('Of those, the ones that failed.'),
  rows: z.number().describe('Rows the successful queries returned.'),
  answer: z.string().describe("The run's answer."),
});

/**
 * The run's result (the workflow's output): the branch taken after the plan
 * loop, keyed by its nested workflow id: `analysis-path` holding
 * `answer-path`'s Wrap up summary (absent when the turn was stopped). A run
 * waiting for an answer has no result until it is resumed.
 */
export const qtiV2TurnResultSchema = z.object({
  'analysis-path': z
    .object({ 'answer-path': turnSummarySchema.optional() })
    .optional(),
});

/** Every step's input and output schema, by step id, in catalogue order. */
export const QTI_V2_TURN_STEP_SCHEMAS = {
  'receive-question': { input: turnInputSchema, output: turnInputSchema },
  'load-catalog': { input: turnInputSchema, output: catalogedQuestionSchema },
  plan: { input: planInputSchema, output: plannedQuestionSchema },
  // Clarify and Analyse can wait for the user (api.md 138): what they
  // suspend with, and what resumes them.
  clarify: {
    input: plannedQuestionSchema,
    output: clarifiedQuestionSchema,
    suspend: clarifyingQuestionSchema,
    resume: clarificationAnswerSchema,
  },
  analyse: {
    input: analyseInputSchema,
    output: analyseOutcomeSchema,
    suspend: clarifyingQuestionSchema,
    resume: clarificationAnswerSchema,
  },
  validate: { input: analyseOutcomeSchema, output: validateOutcomeSchema },
  'write-answer': {
    input: writeAnswerInputSchema,
    output: writtenAnswerSchema,
  },
  'wrap-up': { input: wrapUpInputSchema, output: turnSummarySchema },
} as const;
