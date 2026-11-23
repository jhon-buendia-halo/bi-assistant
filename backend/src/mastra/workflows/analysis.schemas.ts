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
 * (its schemas are ./read-images.schemas.ts), then one line since
 * 2026-11-19: Receive question → Load catalog → Plan (which may wait for the
 * user's answer to its own question) → the analysis loop (Analyse →
 * Validate, retried once; Analyse can wait for an answer too) → Write answer
 * → Build visual when the run builds one → Wrap up. A step passes on what
 * the steps after it read, so each carries the question, the catalog, the
 * plan and Read images' notes forward: the engine hands a step only its
 * previous step's output.
 */
import { z } from 'zod';

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
export const questionInputSchema = turnInputSchema.extend({
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
 * one clarifying question and its options. In an interactive run
 * (answer-business-question.review.ts) a step also waits on its approval
 * gate: `kind: 'review'`, the outcome in words (`review`), the step's output
 * passed on once approved (`outcome`) and the agent's reply (`reply`).
 * Mastra keeps only the fields this schema names.
 */
export const clarifyingQuestionSchema = z.object({
  kind: z
    .enum(['clarify', 'review'])
    .optional()
    .describe("'review': an approval gate; else a clarifying question."),
  question: z.string().describe('The clarifying question the run waits on.'),
  options: z.array(z.string()).describe('Its 2-4 answer options.'),
  review: z
    .string()
    .optional()
    .describe("An approval gate's outcome, in the user's words (Markdown)."),
  outcome: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("An approval gate's step output, passed on once approved."),
  reply: z
    .string()
    .optional()
    .describe("An approval gate's agent reply, shown again on a revision."),
  visualId: z
    .string()
    .optional()
    .describe("Build visual's approval gate: the visual Ryan built."),
});

/** What resumes a waiting step (api.md 138): the user's answer. */
export const clarificationAnswerSchema = z.object({
  answer: z
    .string()
    .describe("The user's answer: one of the options or their own words."),
  images: z
    .array(z.string())
    .optional()
    .describe(
      "On Build visual's approval gate (workflows R44): reference images for the change, as their paths in the run's workspace.",
    ),
});

/** A clarifying question with the user's answer to it. */
export const answeredClarificationSchema = z.object({
  question: z.string().describe('The clarifying question the run asked.'),
  options: z.array(z.string()).describe('Its answer options.'),
  answer: z.string().describe("The user's answer."),
});

/**
 * What Plan receives: Load catalog's output. Its own clarifying question and
 * the user's answer come back on resume, not in its input (agents.md 5.11).
 */
export const planInputSchema = catalogedQuestionSchema.extend({
  // A resumed Plan re-reads its input from a snapshot that may hold no notes.
  imageNotes: resumableImageNotesSchema,
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

/** What Plan passes on: the question and catalog, with the plan. */
export const plannedQuestionSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  columns: carriedColumnsSchema,
  plan: planSchema.describe('The analysis plan.'),
  stopped: z
    .boolean()
    .optional()
    .describe(
      'Set when the turn was stopped while Plan ran: nothing after Plan runs.',
    ),
  imageNotes: imageNotesSchema,
});

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

/**
 * What Analyse receives: the plan, and on a retry the failed validation
 * with the earlier attempt's calls and queries (Validate's output), which
 * the retry is shown and Validate merges with its own (agents.md 5.11).
 */
export const analyseInputSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  columns: carriedColumnsSchema,
  plan: planSchema.describe('The analysis plan.'),
  attempt: z
    .number()
    .optional()
    .describe('On a retry: the attempt Validate checked.'),
  findings: z
    .array(validationFindingSchema)
    .optional()
    .describe("On a retry: the previous attempt's validation findings."),
  calls: z
    .array(analyseCallSchema)
    .optional()
    .describe("On a retry: the earlier attempt's tool calls."),
  queries: z
    .array(analyseQuerySchema)
    .optional()
    .describe(
      "On a retry: the earlier attempt's SQL queries, with their rows.",
    ),
  // Analyse can be resumed from a run stored before Read images existed.
  imageNotes: resumableImageNotesSchema,
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
    .describe('Each check of the kept queries, passed or not.'),
  question: z.string().describe('The trimmed question.'),
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
  columns: carriedColumnsSchema,
  plan: planSchema.describe('The analysis plan.'),
  calls: z.array(analyseCallSchema).describe("The kept queries' tool calls."),
  queries: z
    .array(analyseQuerySchema)
    .describe(
      "The kept SQL queries: the attempt's, or on a retry the merged set or attempt 1's.",
    ),
  kept: z
    .enum(['merged', 'first'])
    .optional()
    .describe(
      "On a retry: the merged set (attempt 2's queries first), or attempt 1's alone.",
    ),
  imageNotes: imageNotesSchema,
});

/** What Write answer receives. */
export const writeAnswerInputSchema = z.object({
  question: z.string().describe('The trimmed question.'),
  plan: planSchema.describe('The analysis plan.'),
  queries: z
    .array(analyseQuerySchema)
    .describe(
      "The kept SQL queries, with their rows: after a retry, attempt 2's first.",
    ),
  findings: z
    .array(validationFindingSchema)
    .describe("The kept queries' validation findings."),
  calls: z
    .array(analyseCallSchema)
    .describe("The kept queries' tool calls, for Wrap up."),
  imageNotes: imageNotesSchema,
});

/**
 * What the answer path receives (agents.md 5.11): Write answer's input, and
 * the catalog of the run's datasets.
 */
export const answerPathInputSchema = writeAnswerInputSchema.extend({
  catalog: z
    .array(catalogEntitySchema)
    .describe("The entities of the run's datasets."),
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

/**
 * What Build visual receives (agents.md 5.11, workflows R41): Write answer's
 * answer, the question, the queries with their rows and Read images' notes,
 * which the designer reads as the reference to follow. Required, as in
 * Write answer's input: the answer path's input always carries them (Analyse
 * passes on `''` after a resume that had none).
 */
export const visualInputSchema = writtenAnswerSchema.extend({
  question: z.string().describe('The trimmed question.'),
  queries: z
    .array(analyseQuerySchema)
    .describe('The SQL queries of the last attempt, with their rows.'),
  imageNotes: imageNotesSchema,
});

/** What Build visual made: the stored visual, or why there is none. */
export const builtVisualSchema = z.object({
  visualId: z
    .string()
    .optional()
    .describe("The run's new visual (absent when none was built)."),
  title: z.string().optional().describe("The visual's title."),
  skipped: z
    .string()
    .optional()
    .describe('Why no visual was built (no rows to chart).'),
  error: z
    .string()
    .optional()
    .describe('Why the design failed; the answer stands without a visual.'),
});

/** What Build visual passes on: Write answer's output and the visual. */
export const visualBuiltSchema = writtenAnswerSchema.extend({
  visual: builtVisualSchema.describe('The visual Ryan built, or why none.'),
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
 * The run's result (the workflow's output), keyed by its nested workflow
 * ids: `question-path` holds `analysis-path` with `answer-path`'s Wrap up
 * summary (absent when the turn was stopped). A run waiting for an answer
 * has no result until it is resumed.
 */
export const answerBusinessQuestionResultSchema = z.object({
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
  // Every step agent can wait for the user (api.md 138): its clarifying
  // question (Plan and Analyse always; the others in an interactive run,
  // workflows R44), or its approval gate.
  plan: {
    input: planInputSchema,
    output: plannedQuestionSchema,
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
    suspend: clarifyingQuestionSchema,
    resume: clarificationAnswerSchema,
  },
  // Optional (the input's `buildVisual`): Ryan's visual of the answer.
  // In an interactive run Ryan's visual waits for approval (workflows R44);
  // a change, with reference images or not, makes a new version of it.
  'build-visual': {
    input: visualInputSchema,
    output: visualBuiltSchema,
    suspend: clarifyingQuestionSchema,
    resume: clarificationAnswerSchema,
  },
  'wrap-up': { input: wrapUpInputSchema, output: turnSummarySchema },
} as const;
