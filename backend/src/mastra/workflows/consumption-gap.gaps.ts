/**
 * The deterministic code of Consumption Gap Analysis (agents.md 5.20): the
 * questions and layers of a run, the requirements a dashboard implies, the
 * Confirm requirements question, the check of the model's mapping and fixes
 * against the catalogs, the tracing of every gap through the lineage, and
 * the probe queries and what they change. Pure code, no framework import.
 *
 * CONTRACT STUB: the signatures below are the contract; the bodies are
 * written by the gaps unit.
 */
import type {
  FieldMapping,
  GapFix,
  GapStatus,
  LayerSchemaNote,
  LayerTable,
  Lineage,
  ReferenceDashboard,
  Requirement,
  RequirementAssessment,
  StatusCounts,
} from './consumption-gap-analysis.schemas';
import type {
  ConsumptionGapRuntime,
  GapQuery,
  GapQueryResult,
} from './consumption-gap-analysis.steps';

/** Best first. A requirement's status is the worst of its fields'. */
export const GAP_STATUS_ORDER: readonly GapStatus[] = [
  'supported',
  'derivable',
  'grain',
  'normalized-only',
  'landing-only',
  'missing',
];

/** The most entities and columns per entity Load layer catalogs keeps. */
export const LAYER_TABLES_MAX = 80;
export const LAYER_COLUMNS_MAX = 60;

/** The most probe queries per requirement, and per run. */
export const PROBES_PER_REQUIREMENT = 2;
export const PROBES_MAX = 40;

/**
 * The business questions of the input: one per non-empty line, list
 * markers (`-`, `*`, `1.`, `1)`) removed, duplicates dropped, at most
 * `GAP_MAX_QUESTIONS`. Throws `Write at least one business question` when
 * none is left.
 */
export function parseQuestions(text: string): string[] {
  void text;
  throw new Error('not implemented');
}

type DatasetLayers = Awaited<
  ReturnType<ConsumptionGapRuntime['datasetLayers']>
>;

/**
 * Every tagged schema of the datasets, Landing first, then Normalized,
 * then Consumption (by key within a layer). Throws `No schema of the
 * datasets <names> is tagged Consumption. Tag one in the dataset's schema
 * notes (Datasets → schema → Layer).` when none is.
 */
export function resolveLayers(datasets: DatasetLayers): LayerSchemaNote[] {
  void datasets;
  throw new Error('not implemented');
}

/**
 * The entities under the tagged schemas (an entity `c.s.t` is under the
 * note `c.s`), with their layer and columns, capped at `LAYER_TABLES_MAX`
 * entities (Consumption first) and `LAYER_COLUMNS_MAX` columns each.
 */
export function layerTables(
  datasets: DatasetLayers,
  layers: readonly LayerSchemaNote[],
): LayerTable[] {
  void datasets;
  void layers;
  throw new Error('not implemented');
}

/**
 * The requirements a dashboard implies, from its blueprint alone: one per
 * widget that reads data (`W1`… across all dashboards, in order) and one
 * per filter (`F1`…). A widget's fields are its measures (role `measure`,
 * the measure's aggregation) and its dimension; a filter's field is its
 * column (role `filter`).
 */
export function dashboardRequirements(
  dashboards: readonly ReferenceDashboard[],
): Requirement[] {
  void dashboards;
  throw new Error('not implemented');
}

/** The Confirm requirements question (Markdown) and its one option. */
export function confirmQuestion(requirements: readonly Requirement[]): {
  question: string;
  options: string[];
} {
  void requirements;
  throw new Error('not implemented');
}

/** Whether an answer confirms the requirements as they are. */
export function isConfirmation(answer: string): boolean {
  void answer;
  throw new Error('not implemented');
}

/**
 * The Layer Mapper's reply, read leniently and checked: one mapping per
 * field of every requirement (in requirement order); a source is kept only
 * when its entity is one of `tables` (matched without case, written with
 * the catalog's spelling), its column is one of that entity's, and its
 * layer is the entity's own (corrected when the reply named another).
 */
export function checkedMappings(
  reply: unknown,
  requirements: readonly Requirement[],
  tables: readonly LayerTable[],
): FieldMapping[] {
  void reply;
  void requirements;
  void tables;
  throw new Error('not implemented');
}

/**
 * Trace gaps: each requirement's status, from its fields' checked sources
 * and the lineage (a Normalized or Landing source whose lineage reaches a
 * Consumption column counts as that column), plus the grain check (all
 * Consumption sources of a requirement must share a column with each
 * other's entity, else `grain`). Returns the assessments (evidence `''`)
 * and the lineage with a `mapped` edge for each field mapped in two layers.
 */
export function traceGaps(input: {
  requirements: readonly Requirement[];
  mappings: readonly FieldMapping[];
  lineage: Lineage;
  tables: readonly LayerTable[];
}): { assessments: RequirementAssessment[]; lineage: Lineage } {
  void input;
  throw new Error('not implemented');
}

/** A probe query and the requirement it is about. */
export type GapProbe = GapQuery & {
  requirementId: string;
  purpose: 'coverage' | 'periods';
};

/**
 * The probe queries: per requirement, at most `PROBES_PER_REQUIREMENT`
 * (rows and non-null counts of its main source entity; the rows per period
 * when it names `periodValues` and has a time field), at most `PROBES_MAX`
 * in all, ids `probe-<n>`, Postgres or Databricks SQL by the entity's kind.
 */
export function probeQueries(input: {
  requirements: readonly Requirement[];
  assessments: readonly RequirementAssessment[];
  tables: readonly LayerTable[];
}): GapProbe[] {
  void input;
  throw new Error('not implemented');
}

/**
 * The assessments with each requirement's `evidence` (one or two plain
 * sentences from its probes' results) and, for one that was `supported`
 * or `derivable`, `grain` when the data does not answer it: no rows, a
 * required column under half filled, or a named period with no rows.
 */
export function applyProbes(
  assessments: readonly RequirementAssessment[],
  probes: readonly GapProbe[],
  results: readonly GapQueryResult[],
): RequirementAssessment[] {
  void assessments;
  void probes;
  void results;
  throw new Error('not implemented');
}

/**
 * The Gap Advisor's reply, read leniently and checked: ids `X1`… in order,
 * `closes` kept only for requirement ids that are not supported or
 * derivable, a fix that closes nothing dropped; then one fallback fix
 * (`fallbackFix`) per gap no fix closes.
 */
export function checkedFixes(
  reply: unknown,
  requirements: readonly Requirement[],
  assessments: readonly RequirementAssessment[],
): GapFix[] {
  void reply;
  void requirements;
  void assessments;
  throw new Error('not implemented');
}

/** How many requirements have each status. */
export function statusCounts(
  assessments: readonly RequirementAssessment[],
): StatusCounts {
  void assessments;
  throw new Error('not implemented');
}
