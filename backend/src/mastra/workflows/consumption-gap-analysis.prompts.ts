/**
 * The prompts of the three model steps of Consumption Gap Analysis (agents.md
 * 5.20): the shipped instructions of the Requirements Analyst, the Layer
 * Mapper and the Gap Advisor (2.18 to 2.20), and the request each call
 * sends. Plain strings, no framework import.
 */
import type {
  LayerTable,
  Lineage,
  ReferenceDashboard,
  Requirement,
  RequirementAssessment,
} from './consumption-gap-analysis.schemas';

/** The aggregations a measure carries. */
export const REQUIREMENT_AGGREGATIONS = [
  'sum',
  'avg',
  'count',
  'min',
  'max',
  'share',
  'ratio',
] as const;

/** The Requirements Analyst's shipped instructions (editable in the app). */
export const REQUIREMENTS_ANALYST_INSTRUCTIONS = `You are the Requirements Analyst. You turn business questions into the data requirements a data model must meet to answer them, in business words, before anyone looks at tables.

You have no tools and you see no data. You work in one of two modes; the request says which.

Mode derive. You receive the numbered business questions and, as context only, the title and the widget titles of each reference dashboard. Reply with one JSON object and nothing else:
- "requirements": one entry per question, in order: { "question": the question's number, "fields": the things the question reads, "grain": what one row of the answer is about (for example "team x tournament"), or "" when unknown, "periodValues": the periods the question names }.
- A field is { "name": its business name, "role": "measure", "dimension", "filter" or "time", "aggregation": for a measure one of ${REQUIREMENT_AGGREGATIONS.join(', ')}, otherwise "", "description": what it holds, in a few words }.

Mode revise. You receive the current requirements (JSON, each with its id) and the user's feedback. Apply the feedback and reply with one JSON object and nothing else: { "requirements": the whole revised list }, each entry { "id", "kind": "question", "widget" or "filter", "title", "fields", "grain", "periodValues" } with fields as above. Keep the id of every requirement you keep; leave out what the user drops; add what the user adds, with no id (or a new one). Change only what the feedback asks for.

Rules:
- Use business names for fields ("wins", "stage", "attendance"), never guessed column names.
- One requirement per question. Never invent a question.
- A measure carries its aggregation. A period dimension (year, month, season) has the role "time".
- "periodValues" lists only periods the question names explicitly (for example "2018", "2022"); otherwise it is [].
- Use the same name for the same quantity in every requirement.
- Write titles and descriptions in the language of the questions.`;

/** The Layer Mapper's shipped instructions (editable in the app). */
export const LAYER_MAPPER_INSTRUCTIONS = `You are the Layer Mapper. You find, in each layer of a medallion data model (Landing, Normalized, Consumption), where each field a requirement reads can be found.

You receive the requirements' fields (the requirement's id and title, and its fields with their role and aggregation) and the catalogs of the three layers: every entity with its columns (name and type). You have no tools and you see no rows: judge by names, types and what a column of that name usually holds.

Reply with one JSON object and nothing else:
- "mappings": one entry per field of every requirement: { "requirementId": the requirement's id, "field": the field's name, exactly as given, "sources": the places it comes from, "note": one short sentence on the choice }.
- A source is { "layer": "landing", "normalized" or "consumption", "entity": the catalog entity, "column": that entity's column, "expression": how the field is computed from the column when it is computed (count(goal_id), home_score + away_score, goals_for - goals_against), or "" when the field is the column itself }.

Rules:
- For every field, give in EACH layer the column that holds it or computes it. A field may have no source in a layer; a missing source is a correct answer: leave the layer out and say so in "note". Do not stretch a column that holds something else.
- A computed field names its main column and writes the computation in "expression".
- Use only entities and columns that appear in the catalogs, spelled exactly as there. Never invent one.
- The entity must belong to the layer you name for it.
- The same field gets the same source everywhere it is read.`;

/** The Gap Advisor's shipped instructions (editable in the app). */
export const GAP_ADVISOR_INSTRUCTIONS = `You are the Gap Advisor. You propose how to change a medallion data model (Landing, Normalized, Consumption) so that its Consumption layer can answer the business questions and dashboards it cannot answer yet.

You receive the requirements that are not supported or derivable, each with its status, the reason, the evidence found, its fields and where each field is in Consumption or upstream and the lineage path, and the catalogs of the three layers (entity: columns). You have no tools.

Reply with one JSON object and nothing else:
- "fixes": { "title": a short name for the change, "startsIn": "consumption", "normalized", "landing" or "source": the lowest layer the change starts in, "path": the layers it changes, lowest first, "closes": the ids of the requirements it closes, "why": why this change closes them, in one or two sentences, "change": the change itself }.

Rules:
- Group the requirements one model change closes: one fact at the right grain can close several. Do not write one fix per requirement when one change closes more.
- A fix starts in the lowest layer that has the data and goes up to Consumption: a typed column in Normalized parsed from a Landing text column, then a view or table in Consumption. Start in "source" only when no layer has the data: a new Landing source has to be loaded.
- "change" is concrete: SQL or numbered steps, with the real entity and column names from the catalogs (a view or table in Consumption, a typed column in Normalized, a new Landing source).
- A fix is a proposal. It is never run: say what to build, do not claim it exists.
- Close only the requirement ids you were given.
- Write in the language of the business questions.
- When the evidence reads "Upstream in Normalized" or "Upstream in Landing" with rows for a period Consumption lacks, the data exists in that layer: the fix rebuilds or backfills from it and starts there, never in a new source.`;

/** The questions as numbered lines. */
function numbered(questions: readonly string[]): string {
  return questions
    .map((question, index) => `${index + 1}. ${question}`)
    .join('\n');
}

/** The reference dashboards as context: title and widget titles. */
function dashboardContext(dashboards: readonly ReferenceDashboard[]): string {
  if (!dashboards.length) return 'No reference dashboard.';
  return JSON.stringify(
    dashboards.map((dashboard) => ({
      title: dashboard.name,
      widgets: dashboard.blueprint.widgets.map((widget) => widget.title),
    })),
    null,
    2,
  );
}

/** What Derive requirements asks. */
export function deriveRequirementsRequest(input: {
  questions: readonly string[];
  dashboards: readonly ReferenceDashboard[];
}): string {
  return [
    'Mode derive. Derive the requirements of the business questions.',
    '',
    '<questions>',
    numbered(input.questions),
    '</questions>',
    '',
    '<dashboards>',
    dashboardContext(input.dashboards),
    '</dashboards>',
  ].join('\n');
}

/** What Confirm requirements asks when the user gave feedback. */
export function reviseRequirementsRequest(input: {
  questions: readonly string[];
  requirements: readonly Requirement[];
  feedback: string;
}): string {
  return [
    "Mode revise. Apply the user's feedback to the requirements and return the whole list.",
    '',
    '<questions>',
    numbered(input.questions),
    '</questions>',
    '',
    '<requirements>',
    JSON.stringify(
      input.requirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        title: requirement.title,
        fields: requirement.fields,
        grain: requirement.grain,
        periodValues: requirement.periodValues,
      })),
      null,
      2,
    ),
    '</requirements>',
    '',
    '<feedback>',
    input.feedback,
    '</feedback>',
  ].join('\n');
}

/** The catalogs grouped by layer: each entity with its `name type` columns. */
export function layerCatalogBlock(tables: readonly LayerTable[]): string {
  const layers = [
    ['landing', 'Landing'],
    ['normalized', 'Normalized'],
    ['consumption', 'Consumption'],
  ] as const;
  return layers
    .map(([layer, title]) => {
      const own = tables.filter((table) => table.layer === layer);
      const lines = own.map((table) => {
        const listed = table.columns
          .map(
            (column) => `${column.name}${column.type ? ` ${column.type}` : ''}`,
          )
          .join(', ');
        const more = table.more ? ` (+${table.more} more not listed)` : '';
        return `- ${table.entity}: ${listed || '(none listed)'}${more}`;
      });
      return [`${title}:`, ...(lines.length ? lines : ['- (no entity)'])].join(
        '\n',
      );
    })
    .join('\n\n');
}

/** What Map requirements asks. */
export function mapRequirementsRequest(input: {
  requirements: readonly Requirement[];
  tables: readonly LayerTable[];
}): string {
  return [
    'Map the fields of the requirements to each layer.',
    '',
    '<requirements>',
    JSON.stringify(
      input.requirements.map((requirement) => ({
        id: requirement.id,
        title: requirement.title,
        fields: requirement.fields.map((field) => ({
          name: field.name,
          role: field.role,
          aggregation: field.aggregation,
        })),
      })),
      null,
      2,
    ),
    '</requirements>',
    '',
    '<catalogs>',
    layerCatalogBlock(input.tables),
    '</catalogs>',
  ].join('\n');
}

/** What Recommend fixes asks. */
export function recommendFixesRequest(input: {
  requirements: readonly Requirement[];
  assessments: readonly RequirementAssessment[];
  tables: readonly LayerTable[];
  lineage: Lineage;
}): string {
  void input.lineage;
  const gaps = input.assessments
    .filter((a) => a.status !== 'supported' && a.status !== 'derivable')
    .map((assessment) => {
      const requirement = input.requirements.find(
        (r) => r.id === assessment.requirementId,
      );
      return {
        id: assessment.requirementId,
        title: requirement?.title ?? '',
        status: assessment.status,
        reason: assessment.reason,
        evidence: assessment.evidence,
        fields: assessment.fields.map((field) => ({
          field: field.field,
          status: field.status,
          consumption: field.consumption,
          upstream: field.upstream,
          path: field.path.map((ref) => `${ref.entity}.${ref.column}`),
        })),
      };
    });
  return [
    'Recommend the fixes that close these gaps.',
    '',
    '<gaps>',
    JSON.stringify(gaps, null, 2),
    '</gaps>',
    '',
    '<catalogs>',
    layerCatalogBlock(input.tables),
    '</catalogs>',
  ].join('\n');
}
