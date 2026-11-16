/**
 * The data contract of the Assess Data Readiness workflow (agents.md 5.13;
 * data-readiness R2): the Zod schema of the workflow's input and of every
 * step's input and output. The one source of truth: the Mastra workflow
 * (./data-readiness-assessment.workflow.ts) builds its steps from it, and
 * the step catalogue (./data-readiness-assessment.steps.ts) derives each
 * step's field names and JSON Schema from it. Zod only, no framework
 * import, so Jest and the catalogue can load it without Mastra.
 *
 * The flow: Resolve dataset → Profile source → Score readiness → Save
 * report → Rows behind findings → Explain report → Wrap up. The deterministic engine owns every
 * number (data-readiness R4): the code steps profile, score and store; the
 * Data Readiness Agent only explains the stored report. A step passes on
 * what the steps after it read, since the engine hands a step only its
 * previous step's output; the profile and the full report stay with the
 * run's runtime, never in a step's output.
 */
import { z } from 'zod';

/** The workflow's input: the run's question and its one dataset. */
export const assessmentInputSchema = z.object({
  question: z
    .string()
    .describe("The user's question; by default, assess the dataset."),
  dataset: z.string().describe('The dataset to assess.'),
  imageNotes: z
    .string()
    .default('')
    .describe("Read images' notes; '' when the run has no images."),
});

/**
 * The run's own input (the workflow's input schema): the first step's input
 * plus the reference images' stored paths, which only Read images reads.
 * Kept out of `assessmentInputSchema` so `images` is used by Read images
 * alone (agents.md 5.11, 5.13).
 */
export const assessmentRunInputSchema = assessmentInputSchema.extend({
  images: z
    .array(z.string())
    .optional()
    .describe('Reference images: their stored paths.'),
});

/** What Resolve dataset finds: the dataset's datasource and scope. */
export const assessmentTargetSchema = z.object({
  question: z.string().describe("The user's question."),
  dataset: z.string().describe('The dataset to assess.'),
  datasourceName: z.string().describe("The dataset's datasource."),
  datasourceKind: z
    .enum(['postgres', 'databricks'])
    .describe('postgres or databricks.'),
  tableCount: z.number().describe("The dataset's tables: the scope."),
  imageNotes: z
    .string()
    .describe("Read images' notes; '' when the run has no images."),
});

/** What Profile source measured (no row values, R6). */
export const profiledSourceSchema = assessmentTargetSchema.extend({
  entityCount: z.number().describe('Entities in the profile.'),
  relationshipCount: z
    .number()
    .describe('Declared and inferred relationships profiled.'),
  notProfiledCount: z
    .number()
    .describe('Entities not column-profiled (too large or timed out).'),
  stopped: z.boolean().describe('Whether the run was stopped.'),
});

/** One dimension's score, as Score readiness passes it on. */
export const dimensionScoreSchema = z.object({
  dimension: z.string().describe('The DMBOK dimension.'),
  score: z.number().describe('0 to 100.'),
  assessed: z.boolean().describe('False for accuracy and currency.'),
  findingCount: z.number().describe('Its findings.'),
});

/** What Score readiness computed with the deterministic engine. */
export const scoredSourceSchema = assessmentTargetSchema.extend({
  overallScore: z.number().describe('The overall score, 0 to 100.'),
  maturity: z.string().describe('The maturity band.'),
  findingCount: z.number().describe('All findings.'),
  dimensionScores: z
    .array(dimensionScoreSchema)
    .describe('The ten dimension scores.'),
});

/** What Save report stored. */
export const savedReportSchema = scoredSourceSchema.extend({
  reportId: z.string().describe("The stored report's id."),
});

/**
 * What Rows behind findings added (roadmap 1.28.11): the stored report, and
 * how many of its top findings became a source of the answer.
 */
export const findingRowsSchema = savedReportSchema.extend({
  sourceCount: z
    .number()
    .describe('Findings whose rows were looked up: one source each.'),
  failedSourceCount: z
    .number()
    .describe('Of those, the queries that failed (kept as failed sources).'),
  stopped: z.boolean().describe('Whether the run was stopped.'),
});

/** What Explain report hands Wrap up. */
export const explainedReportSchema = z.object({
  reportId: z.string().describe("The stored report's id."),
  overallScore: z.number().describe('The overall score, 0 to 100.'),
  maturity: z.string().describe('The maturity band.'),
  findingCount: z.number().describe('All findings.'),
  answer: z.string().describe("The agent's explanation."),
  stopped: z.boolean().describe('Whether the run was stopped.'),
});

/** The Wrap up summary: the run's result. */
export const assessmentSummarySchema = z.object({
  reportId: z.string().describe("The stored report's id."),
  overallScore: z.number().describe('The overall score, 0 to 100.'),
  maturity: z.string().describe('The maturity band.'),
  findingCount: z.number().describe('All findings.'),
  answer: z.string().describe("The run's answer."),
});

/**
 * The run's result (the workflow's output): Wrap up's summary, or, for a
 * run stopped before it, the output of the step that stopped (`stopped`).
 */
export const assessmentResultSchema = assessmentSummarySchema
  .partial()
  .extend({ stopped: z.boolean().optional() })
  .passthrough();

/** Every step's input and output schema, by step id, in catalogue order. */
export const DATA_READINESS_ASSESSMENT_STEP_SCHEMAS = {
  'resolve-dataset': {
    input: assessmentInputSchema,
    output: assessmentTargetSchema,
  },
  'profile-source': {
    input: assessmentTargetSchema,
    output: profiledSourceSchema,
  },
  'score-readiness': {
    input: profiledSourceSchema,
    output: scoredSourceSchema,
  },
  'save-report': { input: scoredSourceSchema, output: savedReportSchema },
  'finding-rows': { input: savedReportSchema, output: findingRowsSchema },
  'explain-report': {
    input: savedReportSchema,
    output: explainedReportSchema,
  },
  'wrap-up': { input: explainedReportSchema, output: assessmentSummarySchema },
} as const;
