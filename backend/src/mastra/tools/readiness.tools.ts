import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { assessReadiness } from '../../modules/readiness-assessor/assess-readiness';
import type {
  ReadinessAssessment,
  ReadinessPort,
  ReadinessScope,
} from '../../modules/readiness-assessor/readiness.types';
import type { QueryFacts } from '../../modules/sessions/query-evidence/query-evidence.types';
import { QUERY_RECORDS_RESULT_KEY } from '../../modules/sessions/turn-data';
import { getReadinessToolServices } from '../readiness-tool-services';
import {
  getDatasetToolServices,
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
  type DatasetSnapshot,
} from '../tool-services';
import {
  DATASETS_CONTEXT_KEY,
  RATIONALE_DESCRIPTION,
} from './dataset-tool-context';
import { SESSION_ID_CONTEXT_KEY } from './turn-context';

/**
 * Dana's `assess_readiness` (plan data-readiness-assessor 1, 3): the
 * scoping card she built with the requester goes to the readiness engine
 * (`assessReadiness`), which measures D1..D6 over the conversation's
 * datasets, decides the gates, the levels and the verdict in code, and
 * stores the assessment as the next one's baseline. The model sees a
 * compact projection of it (no rows); the SQL the engine ran rides beside
 * it under `queryRecords` for the query inspector, never to the model.
 */

/** Row cap of one engine statement: its aggregates return a few rows (a 30-day series at most). */
export const READINESS_SQL_ROW_LIMIT = 100;

/** A request context, as the tool reads it. */
interface ContextLike {
  get(key: string): unknown;
}

const criticalFieldSchema = z.object({
  entity: z
    .string()
    .describe('The entity as list_entities names it (schema.table)'),
  column: z.string(),
  indispensable: z
    .boolean()
    .describe('The use case cannot do without it: level <= 1 fails G5'),
  maxNullRate: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Tolerated share of null or empty values, 0..1 (default 0.05)'),
});

/** The scoping card (skill readiness-scoping), as `ReadinessScope`. */
export const readinessScopeSchema = z.object({
  useCase: z
    .string()
    .trim()
    .min(1)
    .describe("What the data will be used for, in the requester's words"),
  useType: z
    .enum(['analytics', 'dashboard', 'ml', 'rag-agent'])
    .describe(
      'analytics: ad hoc analysis; dashboard: a recurring report; ml: a model; rag-agent: an AI agent or RAG over the data',
    ),
  risk: z
    .enum(['low', 'medium', 'high'])
    .describe(
      'low: exploratory, internal, reversible; medium: recurring report, operational decision; high: regulatory, financial, automated decisions about people, customer-facing',
    ),
  consumer: z.string().optional().describe('Who or what consumes the data'),
  decision: z.string().optional().describe('The decisions taken with it'),
  entities: z
    .array(z.string())
    .describe(
      'The critical entities (schema.table); empty for every entity of the datasets',
    ),
  criticalFields: z.array(criticalFieldSchema),
  grainKeys: z
    .array(
      z.object({ entity: z.string(), columns: z.array(z.string()).min(1) }),
    )
    .optional()
    .describe("Each entity's grain key, for the duplicates check"),
  requiredFreshnessHours: z
    .number()
    .positive()
    .optional()
    .describe(
      'Maximum tolerated age of the newest row, in hours; omit when unknown (G6 is then not evaluated)',
    ),
  maxDuplicateRate: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Tolerated share of duplicate grain keys, 0..1 (default 0.02)'),
  personalDataNeeded: z
    .boolean()
    .describe('Whether the use case needs personal data at all'),
  legalBasis: z
    .string()
    .optional()
    .describe('The legal basis or purpose the requester documented, if any'),
  owners: z
    .array(z.object({ dataset: z.string(), owner: z.string() }))
    .optional()
    .describe('The owner of each dataset, when the requester named one'),
  assumptions: z
    .array(z.string())
    .describe('Every assumption you made instead of asking'),
});

const inputSchema = z.object({
  scope: readinessScopeSchema,
  rationale: z.string().describe(RATIONALE_DESCRIPTION),
});

/** One statement the engine ran, as the query inspector gets it. */
interface ReadinessQueryRun {
  asked: string;
  sql: string;
  datasourceId: string;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  totalRows?: number;
}

function sessionDatasetNames(requestContext: ContextLike): string[] {
  const value = requestContext.get(DATASETS_CONTEXT_KEY);
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** The first entity of the scope that is not one of the datasets', or undefined. */
/**
 * The scope with each entity a short name gives (`matches`, `public.orders`)
 * replaced by the one dataset table it ends with; a name that matches no
 * table or several stays as given, for `unknownEntity` to report.
 */
export function withFullEntityNames(
  scope: ReadinessScope,
  datasets: readonly DatasetSnapshot[],
): ReadinessScope {
  const tables = datasets.flatMap((dataset) => dataset.tables);
  const full = (entity: string): string => {
    if (tables.includes(entity)) return entity;
    const matches = tables.filter((table) => table.endsWith(`.${entity}`));
    return matches.length === 1 ? matches[0] : entity;
  };
  return {
    ...scope,
    entities: scope.entities.map(full),
    criticalFields: scope.criticalFields.map((field) => ({
      ...field,
      entity: full(field.entity),
    })),
    ...(scope.grainKeys
      ? {
          grainKeys: scope.grainKeys.map((key) => ({
            ...key,
            entity: full(key.entity),
          })),
        }
      : {}),
  };
}

function unknownEntity(
  scope: ReadinessScope,
  datasets: readonly DatasetSnapshot[],
): string | undefined {
  const known = new Set(datasets.flatMap((dataset) => dataset.tables));
  const named = [
    ...scope.entities,
    ...scope.criticalFields.map((field) => field.entity),
    ...(scope.grainKeys ?? []).map((key) => key.entity),
  ];
  return named.find((entity) => !known.has(entity));
}

/**
 * The engine's port over the conversation's datasets (plan 3): its datasets
 * only, each statement on one of their datasources with a small row cap
 * and the turn's stop, every successful statement kept in `runs`.
 */
export function readinessPort(input: {
  datasets: readonly string[];
  snapshots: readonly DatasetSnapshot[];
  runs: ReadinessQueryRun[];
}): ReadinessPort {
  const services = getDatasetToolServices();
  const readiness = getReadinessToolServices();
  const names = [...input.datasets];
  const datasources = new Set(
    input.snapshots.flatMap((dataset) =>
      dataset.datasourceId ? [dataset.datasourceId] : [],
    ),
  );
  const requireDatasource = (datasourceId: string) => {
    if (!datasources.has(datasourceId)) {
      throw new Error(
        `Datasource "${datasourceId}" is not used by this conversation's datasets`,
      );
    }
  };
  return {
    datasets: (wanted) =>
      services.getDatasets(wanted.filter((name) => names.includes(name))),
    runSql: async (datasourceId, sql, signal) => {
      requireDatasource(datasourceId);
      const result = await (signal
        ? services.runReadOnlySql(
            datasourceId,
            sql,
            READINESS_SQL_ROW_LIMIT,
            names,
            { signal },
          )
        : services.runReadOnlySql(
            datasourceId,
            sql,
            READINESS_SQL_ROW_LIMIT,
            names,
          ));
      input.runs.push({
        asked: sql,
        sql: result.correctedSql ?? sql,
        datasourceId,
        columns: result.columns,
        rows: result.rows,
        ...(result.truncated ? { truncated: true } : {}),
        ...(typeof result.totalRows === 'number'
          ? { totalRows: result.totalRows }
          : {}),
      });
      return { columns: result.columns, rows: result.rows };
    },
    // Samples stay inside the engine: no sampled value is ever recorded.
    sampleRows: (datasourceId, entity, limit, signal) => {
      requireDatasource(datasourceId);
      return signal
        ? services.sampleRows(datasourceId, entity, limit, { signal })
        : services.sampleRows(datasourceId, entity, limit);
    },
    previous: (useCaseKey) => readiness.previous(useCaseKey),
    save: (assessment) => readiness.save(assessment),
  };
}

/**
 * What the model reads of an assessment: the verdict and everything the
 * report quotes, each piece of evidence with its id, description, SQL and
 * aggregate result. No rows, no datasource ids.
 */
export function readinessModelView(assessment: ReadinessAssessment) {
  const { scope } = assessment;
  return {
    assessmentId: assessment.id,
    createdAt: assessment.createdAt,
    rubricVersion: assessment.rubricVersion,
    datasets: assessment.datasets,
    useCase: scope.useCase,
    useType: scope.useType,
    risk: scope.risk,
    verdict: assessment.verdict,
    weightedScore: assessment.weightedScore,
    ...(assessment.weightedScoreNote
      ? { weightedScoreNote: assessment.weightedScoreNote }
      : {}),
    conditions: assessment.conditions,
    gates: assessment.gates,
    dimensions: assessment.dimensions,
    findings: assessment.findings,
    notEvaluated: assessment.notEvaluated,
    escalations: assessment.escalations,
    assumptions: scope.assumptions,
    ...(assessment.previous ? { previous: assessment.previous } : {}),
    evidence: assessment.evidence.map((evidence) => ({
      id: evidence.id,
      dimension: evidence.dimension,
      description: evidence.description,
      source: evidence.source,
      coverage: evidence.coverage,
      ...(evidence.entity ? { entity: evidence.entity } : {}),
      ...(evidence.sampleSize !== undefined
        ? { sampleSize: evidence.sampleSize }
        : {}),
      ...(evidence.sql ? { sql: evidence.sql } : {}),
      result: evidence.result,
    })),
  };
}

/**
 * The engine's statements as query records (turn-data
 * `QUERY_RECORDS_RESULT_KEY`): each with the evidence that cites it as
 * its rationale, in business words.
 */
function queryRecordsOf(
  assessment: ReadinessAssessment,
  runs: readonly ReadinessQueryRun[],
) {
  return runs.map((run) => {
    const cited = assessment.evidence.filter(
      (evidence) => evidence.sql === run.asked || evidence.sql === run.sql,
    );
    const rationale = cited.length
      ? cited
          .map((evidence) => `${evidence.id}: ${evidence.description}`)
          .join(' ')
      : 'A measurement of the readiness assessment.';
    return {
      sql: run.sql,
      columns: run.columns,
      rows: run.rows,
      rationale,
      ...(run.truncated ? { truncated: true } : {}),
    };
  });
}

/** What the engine's statements are known to have run on, beside the result. */
function writeFacts(
  requestContext: ContextLike,
  runs: readonly ReadinessQueryRun[],
): void {
  const map = requestContext.get(QUERY_FACTS_CONTEXT_KEY);
  if (!(map instanceof Map)) return;
  for (const run of runs) {
    const facts: QueryFacts = {
      datasourceId: run.datasourceId,
      rowLimit: READINESS_SQL_ROW_LIMIT,
      ...(run.totalRows !== undefined ? { totalRows: run.totalRows } : {}),
    };
    map.set(queryFactsKey('run_readonly_sql', run.sql), facts);
  }
}

/** The model's view of the tool's output: the projection, or the error. */
export function readinessModelOutput(output: unknown): unknown {
  if (!output || typeof output !== 'object') return output;
  const shown = { ...(output as Record<string, unknown>) };
  delete shown[QUERY_RECORDS_RESULT_KEY];
  return shown;
}

export const assessReadinessTool = createTool({
  id: 'assess_readiness',
  description: [
    "Assess whether the conversation's datasets are ready for one use case, from the scoping card you built with the requester.",
    'It measures the six dimensions over the data in code, decides the gates, the levels and the verdict with the rubric, compares with the previous assessment of the same use case and saves this one as the next baseline.',
    'Quote what it returns: never recompute, round or change the verdict, a level or a gate.',
  ].join(' '),
  inputSchema,
  toModelOutput: (output: unknown) => ({
    type: 'json' as const,
    value: readinessModelOutput(output),
  }),
  execute: async ({ scope: given, rationale: _rationale }, context) => {
    void _rationale;
    const { requestContext, abortSignal } = context;
    const datasets = sessionDatasetNames(requestContext);
    if (!datasets.length) {
      return { error: 'This conversation has no dataset to assess' };
    }
    try {
      const snapshots = await getDatasetToolServices().getDatasets(datasets);
      const scope = withFullEntityNames(given, snapshots);
      const unknown = unknownEntity(scope, snapshots);
      if (unknown !== undefined) {
        const known = snapshots.flatMap((dataset) => dataset.tables);
        return {
          error: `Entity "${unknown}" is not part of this conversation's datasets. Entities: ${known.slice(0, 30).join(', ')}`,
        };
      }
      const runs: ReadinessQueryRun[] = [];
      const port = readinessPort({ datasets, snapshots, runs });
      const sessionId = requestContext.get(SESSION_ID_CONTEXT_KEY);
      const assessment = await assessReadiness(scope, port, {
        datasets,
        ...(typeof sessionId === 'string' ? { sessionId } : {}),
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      writeFacts(requestContext, runs);
      return {
        ...readinessModelView(assessment),
        [QUERY_RECORDS_RESULT_KEY]: queryRecordsOf(assessment, runs),
      };
    } catch (err) {
      // An assessment the stop cut short is no failed one: the call ends.
      if (abortSignal?.aborted) throw err;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});
