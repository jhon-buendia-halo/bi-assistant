/**
 * The data contract of the Assess Data Readiness workflow (agents.md 5.13;
 * data-readiness R2): the Zod schema of the workflow's input and of every
 * step's input and output. The one source of truth: the Mastra workflow
 * (./data-readiness-assessment.workflow.ts) builds its steps from it, and
 * the step catalogue (./data-readiness-assessment.steps.ts) derives each
 * step's field names and JSON Schema from it. Zod only, no framework
 * import, so Jest and the catalogue can load it without Mastra.
 *
 * The flow: Resolve dataset → Profile source → Score readiness → Read
 * images (only with images) → Save report → Explain report → Rows behind
 * findings → Wrap up. Resolve dataset starts Zoe's reading of the images,
 * which Read images awaits; Save report starts the rows behind findings,
 * which Rows behind findings takes (agents.md 5.13). The deterministic
 * engine owns every number (data-readiness R4): the code steps profile,
 * score and store; the Data Readiness Agent only explains the stored
 * report. A step passes on what the steps after it read, since the engine
 * hands a step only its previous step's output; the profile and the full
 * report stay with the run's runtime, never in a step's output.
 */
import { z } from 'zod';
import { readImagesOutputSchema } from './read-images.schemas';

/**
 * The workflow's input and Resolve dataset's: the run's question, its one
 * dataset and the reference images' stored paths, whose reading Resolve
 * dataset starts (agents.md 5.13).
 */
export const assessmentInputSchema = z.object({
  question: z
    .string()
    .describe("The user's question; by default, assess the dataset."),
  dataset: z.string().describe('The dataset to assess.'),
  images: z
    .array(z.string())
    .optional()
    .describe('Reference images: their stored paths.'),
});

/** The run's own input (the workflow's input schema). */
export const assessmentRunInputSchema = assessmentInputSchema;

/** What Resolve dataset finds: the dataset's datasource and scope. */
export const assessmentTargetSchema = z.object({
  question: z.string().describe("The user's question."),
  dataset: z.string().describe('The dataset to assess.'),
  datasourceName: z.string().describe("The dataset's datasource."),
  datasourceKind: z
    .enum(['postgres', 'databricks'])
    .describe('postgres or databricks.'),
  tableCount: z.number().describe("The dataset's tables: the scope."),
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

/**
 * What Read images hands on in this workflow (agents.md 2.15, 5.13): Zoe's
 * notes, read since Resolve dataset, and whether the run was stopped while
 * the step waited for them. It reads nothing of the step before it.
 */
export const readinessImagesInputSchema = z.object({});
export const readinessImagesOutputSchema = readImagesOutputSchema.extend({
  stopped: z.boolean().describe('Whether the run was stopped.'),
});

/**
 * What Save report reads: the scores, with Read images' notes and stop
 * when the run has images (Read images is a branch, so both default).
 */
export const scoredWithNotesSchema = scoredSourceSchema.extend({
  imageNotes: z
    .string()
    .default('')
    .describe("Read images' notes; '' when the run has no images."),
  stopped: z
    .boolean()
    .default(false)
    .describe('Whether the run was stopped at Read images.'),
});

/** What Save report stored. */
export const savedReportSchema = scoredSourceSchema.extend({
  imageNotes: z
    .string()
    .describe("Read images' notes; '' when the run has no images."),
  reportId: z.string().describe("The stored report's id; '' when stopped."),
  stopped: z
    .boolean()
    .describe('Whether the run was stopped at Read images (nothing stored).'),
});

/** What Explain report hands on. */
export const explainedReportSchema = z.object({
  reportId: z.string().describe("The stored report's id."),
  overallScore: z.number().describe('The overall score, 0 to 100.'),
  maturity: z.string().describe('The maturity band.'),
  findingCount: z.number().describe('All findings.'),
  answer: z.string().describe("The agent's explanation."),
  stopped: z.boolean().describe('Whether the run was stopped.'),
});

/**
 * What Rows behind findings added (roadmap 1.28.11): the explained report,
 * and how many of its top findings became a source of the answer. Their
 * queries ran while the agent explained the report.
 */
export const findingRowsSchema = explainedReportSchema.extend({
  sourceCount: z
    .number()
    .describe('Findings whose rows were looked up: one source each.'),
  failedSourceCount: z
    .number()
    .describe('Of those, the queries that failed (kept as failed sources).'),
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
  'read-images': {
    input: readinessImagesInputSchema,
    output: readinessImagesOutputSchema,
  },
  'save-report': { input: scoredWithNotesSchema, output: savedReportSchema },
  'explain-report': {
    input: savedReportSchema,
    output: explainedReportSchema,
  },
  'finding-rows': { input: explainedReportSchema, output: findingRowsSchema },
  'wrap-up': { input: explainedReportSchema, output: assessmentSummarySchema },
} as const;
