/**
 * The data contract of the Consumption Gap Analysis workflow (agents.md
 * 5.20): the Zod schema of the workflow's input and of every step's input
 * and output. The one source of truth: the Mastra workflow
 * (./consumption-gap-analysis.workflow.ts) builds its steps from it, and the
 * step catalogue (./consumption-gap-analysis.steps.ts) derives each step's
 * field names and JSON Schema from it. Zod only, no framework import.
 *
 * The flow: Read dashboards → Resolve layers → Load layer catalogs → Infer
 * lineage → Derive requirements → Confirm requirements (waits) → Map
 * requirements → Trace gaps → Probe evidence → Recommend fixes → Render
 * report. A step passes on what the steps after it read, since the engine
 * hands a step only its previous step's output.
 */
import { z } from 'zod';
import { dashboardBlueprintSchema } from './recreate-dashboard.schemas';

/** A medallion layer, as a dataset's schema notes name it (datasets R41). */
export const layerSchema = z.enum(['landing', 'normalized', 'consumption']);

/** One column of one entity. */
export const columnRefSchema = z.object({
  entity: z.string().describe('The entity key (catalog.schema.table).'),
  column: z.string().describe('The column name, as the catalog spells it.'),
});

// ---------------------------------------------------------------------------
// Input

/** The run's input (the workflow's input schema). */
export const gapRunInputSchema = z.object({
  question: z
    .string()
    .describe('The business questions, one per line (at least one).'),
  datasets: z
    .array(z.string())
    .describe('The datasets whose schemas are tagged by layer.'),
  artifact: z
    .string()
    .default('')
    .describe("A saved dashboard's id; '' when none was picked."),
  images: z
    .array(z.string())
    .optional()
    .describe('Reference dashboard images: their stored paths.'),
});

// ---------------------------------------------------------------------------
// Read dashboards

/** One reference dashboard, read from an image or loaded from an artifact. */
export const referenceDashboardSchema = z.object({
  id: z.string().describe("'D1', 'D2', … in reading order."),
  source: z.enum(['image', 'artifact']),
  name: z.string().describe("The dashboard's title, or the artifact's name."),
  blueprint: dashboardBlueprintSchema,
});

/** What Read dashboards hands on. */
export const dashboardsReadSchema = z.object({
  questions: z
    .array(z.string())
    .describe('The business questions, parsed from the input lines.'),
  datasets: z.array(z.string()),
  dashboards: z.array(referenceDashboardSchema),
  stopped: z.boolean(),
});

// ---------------------------------------------------------------------------
// Resolve layers

/** One tagged schema of the run's datasets. */
export const layerSchemaNoteSchema = z.object({
  schemaKey: z.string().describe('catalog.schema'),
  layer: layerSchema,
  dataset: z.string(),
  description: z.string(),
});

export const layersResolvedSchema = dashboardsReadSchema
  .omit({ stopped: true })
  .extend({
    layers: z
      .array(layerSchemaNoteSchema)
      .describe(
        'Every tagged schema, Landing first, then Normalized, then Consumption.',
      ),
  });

// ---------------------------------------------------------------------------
// Load layer catalogs

/** One entity of a tagged schema, with its columns. */
export const layerTableSchema = z.object({
  entity: z.string().describe('catalog.schema.table'),
  layer: layerSchema,
  dataset: z.string(),
  datasourceId: z.string().nullable(),
  datasourceKind: z
    .string()
    .nullable()
    .describe('postgres, databricks or rest.'),
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  more: z.number().describe('Columns left out by the cap.'),
});

export const catalogsLoadedSchema = layersResolvedSchema.extend({
  tables: z
    .array(layerTableSchema)
    .describe(
      'The entities of the tagged schemas: at most 80, 60 columns each.',
    ),
});

// ---------------------------------------------------------------------------
// Infer lineage

/** How an edge was found. */
export const lineageMethodSchema = z.enum([
  /** The normalised names are equal. */
  'name',
  /** The normalised names share most tokens. */
  'similar-name',
  /** A query found the target's values in the source. */
  'values',
  /** The mapper named the same field in both layers (Trace gaps). */
  'mapped',
]);

/** One inferred column-to-column edge, from a lower layer to a higher one. */
export const lineageEdgeSchema = z.object({
  from: columnRefSchema,
  to: columnRefSchema,
  method: lineageMethodSchema,
  confidence: z.number().describe('0 to 1.'),
  overlap: z
    .number()
    .nullable()
    .describe(
      "Share of the target's distinct values found in the source; null when not checked.",
    ),
  expression: z
    .string()
    .describe(
      "How the target is computed from the source ('mapped' edges); '' otherwise.",
    ),
});

export const lineageSchema = z.object({
  edges: z.array(lineageEdgeSchema),
  checkedPairs: z.number().describe('Candidate pairs checked by a query.'),
  failedChecks: z.number().describe('Checks whose query failed.'),
});

export const lineageInferredSchema = catalogsLoadedSchema.extend({
  lineage: lineageSchema,
  stopped: z.boolean(),
});

// ---------------------------------------------------------------------------
// Derive requirements

/** One thing a requirement reads. */
export const requirementFieldSchema = z.object({
  name: z
    .string()
    .describe("Business name, e.g. 'wins', 'stage', 'attendance'."),
  role: z.enum(['measure', 'dimension', 'filter', 'time']),
  aggregation: z
    .string()
    .describe("For a measure: sum, avg, count, min, max, share, ratio or ''."),
  description: z.string(),
});

/** What the consumption model must support for one question or widget. */
export const requirementSchema = z.object({
  id: z.string().describe("'Q1'… for questions, 'W1'… widgets, 'F1'… filters."),
  kind: z.enum(['question', 'widget', 'filter']),
  title: z.string().describe('The question, or the widget / filter title.'),
  source: z
    .string()
    .describe("'Question 3', or '<dashboard name> · <widget kind>'."),
  dashboardId: z.string().describe("'D1'…; '' for a question."),
  ref: z
    .string()
    .describe(
      "The widget's or filter's id in its blueprint; '' for a question.",
    ),
  fields: z.array(requirementFieldSchema),
  grain: z.string().describe("e.g. 'team × tournament'; '' when unknown."),
  periodValues: z
    .array(z.string())
    .describe(
      "Periods the requirement names explicitly, e.g. ['2018', '2022'].",
    ),
});

export const requirementsDerivedSchema = lineageInferredSchema
  .omit({ stopped: true })
  .extend({
    requirements: z.array(requirementSchema),
    stopped: z.boolean(),
  });

// ---------------------------------------------------------------------------
// Confirm requirements (waits for the user)

export const confirmSuspendSchema = z.object({
  question: z
    .string()
    .describe('The requirements as Markdown, and what to answer.'),
  options: z.array(z.string()),
});

export const confirmResumeSchema = z.object({
  answer: z.string(),
});

export const requirementsConfirmedSchema = requirementsDerivedSchema
  .omit({ stopped: true })
  .extend({
    feedback: z.string().describe("The user's edits; '' when confirmed as is."),
    stopped: z.boolean(),
  });

// ---------------------------------------------------------------------------
// Map requirements

/** Where one requirement field can come from, in one layer. */
export const fieldSourceSchema = z.object({
  layer: layerSchema,
  entity: z.string(),
  column: z.string(),
  expression: z
    .string()
    .describe(
      "How the field is computed from the column ('count(goal_id)'); '' when it is the column.",
    ),
});

/** One requirement field and its checked sources (every source exists). */
export const fieldMappingSchema = z.object({
  requirementId: z.string(),
  field: z.string(),
  sources: z.array(fieldSourceSchema),
  note: z.string(),
});

export const requirementsMappedSchema = requirementsConfirmedSchema
  .omit({ stopped: true })
  .extend({
    mappings: z.array(fieldMappingSchema),
    stopped: z.boolean(),
  });

// ---------------------------------------------------------------------------
// Trace gaps

/** Worst first is `none`; see `GAP_STATUS_ORDER` in ./consumption-gap.gaps.ts. */
export const gapStatusSchema = z.enum([
  /** Every field is a Consumption column. */
  'supported',
  /** Every field is computable from Consumption columns. */
  'derivable',
  /** The fields exist in Consumption, but grain, join or coverage do not answer. */
  'grain',
  /** A field exists in Normalized, not in Consumption. */
  'normalized-only',
  /** A field exists in Landing only. */
  'landing-only',
  /** A field exists in no layer. */
  'missing',
]);

export const fieldAssessmentSchema = z.object({
  field: z.string(),
  status: gapStatusSchema,
  consumption: fieldSourceSchema
    .nullable()
    .describe('Its Consumption source, if any.'),
  upstream: fieldSourceSchema
    .nullable()
    .describe(
      'The highest layer below Consumption that has it, when Consumption has not.',
    ),
  path: z
    .array(columnRefSchema)
    .describe('The lineage path from the lowest layer up to the source used.'),
});

export const requirementAssessmentSchema = z.object({
  requirementId: z.string(),
  status: gapStatusSchema,
  fields: z.array(fieldAssessmentSchema),
  reason: z.string().describe('One sentence, built in code.'),
  evidence: z
    .string()
    .describe("What the probe queries found; '' until Probe evidence."),
});

export const gapsTracedSchema = requirementsMappedSchema
  .omit({ stopped: true })
  .extend({
    assessments: z.array(requirementAssessmentSchema),
  });

// ---------------------------------------------------------------------------
// Probe evidence

export const evidenceProbedSchema = gapsTracedSchema.extend({
  probeCount: z.number(),
  failedProbeCount: z.number(),
  stopped: z.boolean(),
});

// ---------------------------------------------------------------------------
// Recommend fixes

/** Where a fix starts. */
export const fixLayerSchema = z.enum([
  'consumption',
  'normalized',
  'landing',
  'source',
]);

export const gapFixSchema = z.object({
  id: z.string().describe("'X1', 'X2', …"),
  title: z.string(),
  startsIn: fixLayerSchema,
  path: z
    .array(fixLayerSchema)
    .describe('The layers it changes, lowest first.'),
  closes: z.array(z.string()).describe('Requirement ids; every one exists.'),
  why: z.string(),
  change: z.string().describe('Proposed SQL or steps. Never run.'),
});

export const fixesRecommendedSchema = evidenceProbedSchema
  .omit({ stopped: true, probeCount: true, failedProbeCount: true })
  .extend({
    probeCount: z.number(),
    fixes: z.array(gapFixSchema),
    stopped: z.boolean(),
  });

// ---------------------------------------------------------------------------
// Render report

export const statusCountsSchema = z.object({
  supported: z.number(),
  derivable: z.number(),
  grain: z.number(),
  'normalized-only': z.number(),
  'landing-only': z.number(),
  missing: z.number(),
});

/** The run's result. */
export const gapReportRenderedSchema = z.object({
  visualId: z.string(),
  title: z.string(),
  requirementCount: z.number(),
  counts: statusCountsSchema,
  fixCount: z.number(),
  edgeCount: z.number(),
  answer: z.string().describe("The run's answer, Markdown, built in code."),
});

/** The workflow's output: Render report's, or a stopped step's output. */
export const gapResultSchema = gapReportRenderedSchema
  .partial()
  .extend({ stopped: z.boolean().optional() })
  .passthrough();

/** Every step's input and output schema, by step id, in catalogue order. */
export const CONSUMPTION_GAP_STEP_SCHEMAS = {
  'read-dashboards': { input: gapRunInputSchema, output: dashboardsReadSchema },
  'resolve-layers': {
    input: dashboardsReadSchema,
    output: layersResolvedSchema,
  },
  'load-layer-catalogs': {
    input: layersResolvedSchema,
    output: catalogsLoadedSchema,
  },
  'infer-lineage': {
    input: catalogsLoadedSchema,
    output: lineageInferredSchema,
  },
  'derive-requirements': {
    input: lineageInferredSchema,
    output: requirementsDerivedSchema,
  },
  'confirm-requirements': {
    input: requirementsDerivedSchema,
    output: requirementsConfirmedSchema,
    suspend: confirmSuspendSchema,
    resume: confirmResumeSchema,
  },
  'map-requirements': {
    input: requirementsConfirmedSchema,
    output: requirementsMappedSchema,
  },
  'trace-gaps': { input: requirementsMappedSchema, output: gapsTracedSchema },
  'probe-evidence': { input: gapsTracedSchema, output: evidenceProbedSchema },
  'recommend-fixes': {
    input: evidenceProbedSchema,
    output: fixesRecommendedSchema,
  },
  'render-report': {
    input: fixesRecommendedSchema,
    output: gapReportRenderedSchema,
  },
} as const;

export type Layer = z.output<typeof layerSchema>;
export type ColumnRef = z.output<typeof columnRefSchema>;
export type ReferenceDashboard = z.output<typeof referenceDashboardSchema>;
export type LayerSchemaNote = z.output<typeof layerSchemaNoteSchema>;
export type LayerTable = z.output<typeof layerTableSchema>;
export type LineageEdge = z.output<typeof lineageEdgeSchema>;
export type Lineage = z.output<typeof lineageSchema>;
export type RequirementField = z.output<typeof requirementFieldSchema>;
export type Requirement = z.output<typeof requirementSchema>;
export type FieldSource = z.output<typeof fieldSourceSchema>;
export type FieldMapping = z.output<typeof fieldMappingSchema>;
export type GapStatus = z.output<typeof gapStatusSchema>;
export type FieldAssessment = z.output<typeof fieldAssessmentSchema>;
export type RequirementAssessment = z.output<
  typeof requirementAssessmentSchema
>;
export type GapFix = z.output<typeof gapFixSchema>;
export type StatusCounts = z.output<typeof statusCountsSchema>;
