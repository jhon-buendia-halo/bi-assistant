/**
 * The schemas of Michael's analysis (agents.md 5.11, 5.23): a question
 * workflow's input, the catalog, the plan, his queries and their checks, the
 * clarifying question a waiting step suspends with and the answer that
 * resumes it, and Jessica's answer. Zod only, no framework import, so Jest
 * and the catalogue can load it without Mastra.
 */
import { z } from 'zod';

/**
 * A question workflow's input: the turn's question and datasets. `images`
 * is no longer sent by any run; it stays so Avery + Michael's contract
 * (and its hash, which stored runs carry) is unchanged.
 */
export const questionInputSchema = z.object({
  question: z.string().describe("The user's question."),
  datasets: z.array(z.string()).describe("The run's dataset names."),
  images: z
    .array(z.string())
    .optional()
    .describe("The run's reference images: their stored paths."),
});

/** One entity of the run's datasets, as Load catalog lists it. */
export const catalogEntitySchema = z.object({
  entity: z.string().describe('The entity (table) key.'),
  dataset: z.string().describe('The dataset it belongs to.'),
  datasourceId: z.string().nullable().describe("The dataset's datasource id."),
  datasourceKind: z
    .string()
    .nullable()
    .describe('postgres, databricks, rest or file.'),
  columnCount: z.number().nullable().describe('Its column count, when known.'),
  // Optional: a run stored or waiting before it existed has none.
  dataEndsAt: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Where its dataset's data ends: the latest date of the dataset's date columns (YYYY-MM-DD), from its save; null when none has a range.",
    ),
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
 * Mastra keeps only the fields this schema names.
 */
export const clarifyingQuestionSchema = z.object({
  question: z.string().describe('The clarifying question the run waits on.'),
  options: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe(
      '2-4 answer options, each a short title, optionally followed by " — " and one line explaining it.',
    ),
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

/**
 * The columns of each entity as Analyse carries them (agents.md 5.11): Load
 * catalog's, passed on from Plan so Analyse's catalog block lists them too.
 * A run stored before they were carried reads none.
 */
const carriedColumnsSchema = z
  .array(entityColumnsSchema)
  .default([])
  .describe(
    "The columns of each entity, from Load catalog: Analyse's catalog block lists them.",
  );

/** One check Validate ran over an analysis attempt. */
export const validationFindingSchema = z.object({
  check: z.string().describe('What was checked.'),
  passed: z.boolean().describe('Whether the check passed.'),
  detail: z.string().describe('What the check found.'),
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
    .describe('Its result rows, at most 200.'),
  rowCount: z.number().describe('Rows it returned.'),
  truncated: z
    .boolean()
    .describe('The result was cut at its row limit or when stored.'),
  error: z.string().optional().describe('Why it failed.'),
});

/** The earlier attempt a retry carries forward, for Validate to merge. */
export const earlierAttemptSchema = z.object({
  calls: z
    .array(analyseCallSchema)
    .describe("The earlier attempt's tool calls."),
  queries: z
    .array(analyseQuerySchema)
    .describe("The earlier attempt's SQL queries, with their rows."),
  findings: z
    .array(validationFindingSchema)
    .describe("The earlier attempt's validation findings."),
});

/** What Analyse returns, and what Validate receives. */
export const analyseOutcomeSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  columns: carriedColumnsSchema,
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
  earlier: earlierAttemptSchema
    .optional()
    .describe(
      'On a retry: the earlier attempt, which Validate merges with this one.',
    ),
  retryError: z
    .string()
    .optional()
    .describe(
      'On a retry: the model error it ended on; the earlier attempt is kept.',
    ),
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
