/**
 * The data contract of the turn workflow of Insights Analyst
 * (agents.md 5.11, 5.12): the Zod schema of the workflow's input and of every
 * step's input and output. The one source of truth: the Mastra workflow
 * (./answer-business-question.workflow.ts) builds its steps from it, and the step
 * catalogue (./answer-business-question.steps.ts) derives each step's field names and
 * JSON Schema from it. Zod only, no framework import, so Jest and the
 * catalogue can load it without Mastra.
 *
 * The flow (agents.md 5.11): Read images when the run has reference images
 * (its schemas are ./read-images.schemas.ts), Receive question → Load catalog
 * → Interpret follow-up, then either Page result → Page answer (a follow-up
 * over an earlier result, roadmap 1.28.8) or Plan, then a branch: Clarify
 * (the run waits for the user's answer, then goes back to
 * Plan with it), or the analysis loop (Analyse → Validate, retried once;
 * Analyse can wait for an answer too) → Write answer → Wrap up. A step
 * passes on what the steps after it read, so each carries the question, the
 * catalog, the plan and Read images' notes forward: the engine hands a step
 * only its previous step's output.
 */
import { z } from 'zod';
import { FILTER_OPS } from '../../modules/datasources/connectors/paged-sql.types';

/** A turn's question and datasets (the eval target's input, agents.md 8). */
export const turnInputSchema = z.object({
  question: z.string().describe("The user's question."),
  datasets: z.array(z.string()).describe("The run's dataset names."),
});

/**
 * Read images' notes (agents.md 2.15, 5.11; workflows R35), as every step
 * after Receive question carries them in its data, so they survive a
 * Clarify wait and a resume; `''` when the run has no images.
 */
const imageNotesSchema = z
  .string()
  .describe(
    "Read images' notes on the run's reference images; '' when it has none.",
  );

/**
 * The notes as a step that can be (re)entered on a resume reads them: a run
 * that began waiting at Clarify or Analyse before Read images existed has no
 * notes in its stored step data, and resumes with `''` (workflows R35).
 */
const resumableImageNotesSchema = imageNotesSchema.default('');

/**
 * The workflow's input: the turn's, and the reference images' stored paths,
 * which only Read images reads (kept out of Receive question's input, so
 * `usedBy(images)` names Read images alone).
 */
export const answerBusinessQuestionInputSchema = turnInputSchema.extend({
  images: z
    .array(z.string())
    .optional()
    .describe("The run's reference images: their stored paths."),
});

/**
 * What Receive question receives: the input with Read images' notes, `''`
 * by default (Read images is a branch from Start: no path through it is
 * certain).
 */
export const receiveQuestionInputSchema = turnInputSchema.extend({
  imageNotes: z
    .string()
    .default('')
    .describe(
      "Read images' notes on the run's reference images; '' when it has none.",
    ),
});

/** What Receive question passes on, and what Load catalog receives. */
export const receivedQuestionSchema = turnInputSchema.extend({
  imageNotes: imageNotesSchema,
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
  imageNotes: imageNotesSchema,
});

const filterValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** One condition on one result column (paged-sql.types `FilterSpec`). */
export const filterSpecSchema = z.object({
  column: z.string().describe('The result column.'),
  op: z.enum(FILTER_OPS).describe('The operator.'),
  value: filterValueSchema.optional().describe('Its value.'),
  valueTo: filterValueSchema.optional().describe('The upper bound of between.'),
  values: z
    .array(filterValueSchema)
    .optional()
    .describe('The values of in and not_in.'),
});

/** One sort key (paged-sql.types `SortSpec`). */
export const sortSpecSchema = z.object({
  column: z.string().describe('The result column.'),
  direction: z.enum(['asc', 'desc']).describe('Its direction.'),
});

/** A page of a stored result, as asked for (paged-sql.types `PageRequest`). */
export const pageRequestSchema = z.object({
  page: z.number().optional().describe('1-based; default 1.'),
  pageSize: z.number().optional().describe('Rows a page; default 50.'),
  filters: z
    .array(filterSpecSchema)
    .optional()
    .describe('The filters, AND-ed.'),
  sort: z
    .array(sortSpecSchema)
    .optional()
    .describe('The sort keys; none is the default order.'),
});

/** The view a page was read with (paged-sql.types `ResultView`). */
export const resultViewSchema = z.object({
  filters: z.array(filterSpecSchema).describe('The filters, AND-ed.'),
  sort: z.array(sortSpecSchema).describe('The sort keys.'),
  page: z.number().describe('The page, 1-based.'),
  pageSize: z.number().describe('Rows a page.'),
  matchedRows: z.number().optional().describe('Rows matching the filters.'),
  capped: z.boolean().optional().describe('More rows matched than paged.'),
});

/**
 * What Interpret follow-up read in a follow-up's words (roadmap 1.28.8):
 * another page, a filter or an order over one of the run's earlier
 * queries. A new question is no follow-up (`followUp: null`).
 */
export const followUpSchema = z.object({
  action: z
    .literal('explore')
    .describe('The words ask for the earlier rows paged, filtered or sorted.'),
  query: z
    .number()
    .describe("The 0-based index of the earlier query in the run's queries."),
  ref: z.string().describe('Its label: Q1, Q2, …'),
  request: pageRequestSchema.describe('The page, filters and sort to read.'),
  understood: z.string().describe('The request in one line of words.'),
});

/**
 * What Interpret follow-up passes on: Load catalog's output with the
 * follow-up it read, or null when the run plans a new analysis.
 */
export const followedUpQuestionSchema = catalogedQuestionSchema.extend({
  followUp: followUpSchema
    .nullable()
    .describe(
      'The page of an earlier result the words ask for; null: a new question, planned.',
    ),
  stopped: z
    .boolean()
    .optional()
    .describe(
      'Set when the turn was stopped while the words were read: nothing after runs.',
    ),
});

/** What Page result passes on: one page of the earlier query's full result. */
export const pagedResultSchema = z.object({
  title: z.string().describe('The earlier query, in words.'),
  columns: z.array(z.string()).describe("The result's columns."),
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .describe("The page's rows, at most 100."),
  page: z.number().describe('The page read, 1-based.'),
  pageCount: z.number().describe('Pages the matching rows fill.'),
  matchedRows: z.number().describe('Rows matching the filters.'),
  capped: z.boolean().describe('More rows matched than can be paged.'),
  view: resultViewSchema.describe('The view the page was read with.'),
  understood: z.string().describe('The view in one line of words.'),
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
  // Clarify re-parses the plan round's input on resume (see above).
  imageNotes: resumableImageNotesSchema,
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
  imageNotes: imageNotesSchema,
});

/** What Clarify receives: Plan's output, which a resumed run may hold without notes. */
export const clarifyInputSchema = plannedQuestionSchema.extend({
  imageNotes: resumableImageNotesSchema,
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
  // Analyse can be resumed from a run stored before Read images existed.
  imageNotes: resumableImageNotesSchema,
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
  imageNotes: imageNotesSchema,
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
  imageNotes: imageNotesSchema,
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
  imageNotes: imageNotesSchema,
});

/**
 * What Check data quality receives (agents.md 5.11; the run's optional
 * quality check): Write answer's input, and the catalog its tables are
 * looked up in.
 */
export const dataQualityInputSchema = writeAnswerInputSchema.extend({
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
});

/** What Check data quality measured: the scope, the reports and the issues. */
export const dataQualitySummarySchema = z.object({
  tables: z
    .array(z.string())
    .describe('The tables the queries read that were assessed.'),
  reportIds: z
    .array(z.string())
    .describe('The readiness reports stored for them, one per datasource.'),
  findingCount: z
    .number()
    .describe('Engine findings on those tables, of any severity.'),
  issues: z
    .number()
    .describe('Of those, the ones Sarah judged to affect this answer.'),
  skipped: z
    .array(z.string())
    .describe(
      'Tables read that could not be assessed (not PostgreSQL or Databricks).',
    ),
  error: z
    .string()
    .optional()
    .describe('Why the check could not run; the answer is still written.'),
});

/**
 * What Check data quality passes on: Write answer's input, its findings
 * ending with the data-quality ones, and what it measured.
 */
export const qualityCheckedSchema = writeAnswerInputSchema.extend({
  dataQuality: dataQualitySummarySchema.describe('What the check measured.'),
});

/**
 * Sarah's reply in Check data quality: the engine findings (by their number
 * in the request) that could change or limit this answer, each with how.
 */
export const dataQualityReplySchema = z.object({
  issues: z
    .array(
      z.object({
        finding: z.number().describe('The finding number from the request.'),
        impact: z
          .string()
          .describe('One sentence: how it could change or limit this answer.'),
      }),
    )
    .describe('Only the findings that affect this answer; empty when none.'),
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
 * The run's result (the workflow's output): the branch taken after
 * Interpret follow-up, keyed by its nested workflow id. `explore-result`
 * holds Page answer's summary (a follow-up over an earlier result,
 * roadmap 1.28.8); `question-path` holds the branch taken after the plan
 * loop: `analysis-path` with `answer-path`'s Wrap up summary (absent when
 * the turn was stopped). A run waiting for an answer has no result until
 * it is resumed.
 */
export const answerBusinessQuestionResultSchema = z.object({
  'explore-result': turnSummarySchema.optional(),
  'question-path': z
    .object({
      'analysis-path': z
        .object({ 'answer-path': turnSummarySchema.optional() })
        .optional(),
    })
    .optional(),
});

/** Every step's input and output schema, by step id, in catalogue order. */
export const ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS = {
  'receive-question': {
    input: receiveQuestionInputSchema,
    output: receivedQuestionSchema,
  },
  'load-catalog': {
    input: receivedQuestionSchema,
    output: catalogedQuestionSchema,
  },
  // A follow-up over an earlier result (roadmap 1.28.8): no model call on
  // a run without earlier queries.
  'interpret-follow-up': {
    input: catalogedQuestionSchema,
    output: followedUpQuestionSchema,
  },
  plan: { input: planInputSchema, output: plannedQuestionSchema },
  // Clarify and Analyse can wait for the user (api.md 138): what they
  // suspend with, and what resumes them.
  clarify: {
    input: clarifyInputSchema,
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
  // Optional (the input's `checkDataQuality`): Sarah's review of the data
  // the analysis read.
  'check-data-quality': {
    input: dataQualityInputSchema,
    output: qualityCheckedSchema,
  },
  'write-answer': {
    input: writeAnswerInputSchema,
    output: writtenAnswerSchema,
  },
  'wrap-up': { input: wrapUpInputSchema, output: turnSummarySchema },
  // The follow-up branch: the earlier query's page, then the answer.
  'page-result': { input: followedUpQuestionSchema, output: pagedResultSchema },
  'page-answer': { input: pagedResultSchema, output: turnSummarySchema },
} as const;
