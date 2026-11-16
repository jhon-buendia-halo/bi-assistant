import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { inspectResult } from '../../modules/sessions/result-guards';
import type { QueryFacts } from '../../modules/sessions/query-evidence/query-evidence.types';
import {
  getDatasetToolServices,
  DatasetColumnSnapshot,
  DatasetSnapshot,
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
} from '../tool-services';
import {
  DATASETS_CONTEXT_KEY,
  RATIONALE_DESCRIPTION,
} from './dataset-tool-context';
import { exploreResultTool } from './explore-result.tool';

export { DATASETS_CONTEXT_KEY, RATIONALE_DESCRIPTION };

/**
 * Take `totalRows` off a result before the model sees it, and write what the
 * tool knew into the turn's facts map (plan m1-25 1.25.1), keyed by the tool
 * call id and by the statement that ran. The model's input stays exactly as
 * it was before the query inspector existed.
 */
function withoutFacts<T extends object>(
  result: T,
  facts: {
    tool: string;
    input: string;
    datasourceId: string;
    rowLimit: number;
  },
  context: {
    requestContext: { get: (key: string) => unknown };
    agent?: { toolCallId?: string };
  },
): Omit<T, 'totalRows'> {
  const { totalRows, ...rest } = result as T & { totalRows?: unknown };
  const map = context.requestContext.get(QUERY_FACTS_CONTEXT_KEY);
  if (map instanceof Map) {
    const known: QueryFacts = {
      datasourceId: facts.datasourceId,
      ...(typeof totalRows === 'number' ? { totalRows } : {}),
      rowLimit: facts.rowLimit,
    };
    const callId = context.agent?.toolCallId;
    if (callId) map.set(callId, known);
    map.set(queryFactsKey(facts.tool, facts.input), known);
  }
  return rest;
}

interface EntityAccess {
  entity: string;
  columns?: DatasetColumnSnapshot[];
  datasourceId?: string;
  datasourceKind?: string;
  dataset: string;
}

function datasetNames(requestContext: {
  get: (key: string) => unknown;
}): string[] {
  const value = requestContext.get(DATASETS_CONTEXT_KEY);
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

async function sessionDatasets(requestContext: {
  get: (key: string) => unknown;
}): Promise<DatasetSnapshot[]> {
  return getDatasetToolServices().getDatasets(datasetNames(requestContext));
}

function allowedEntities(datasets: DatasetSnapshot[]): EntityAccess[] {
  const entities: EntityAccess[] = [];
  for (const dataset of datasets) {
    for (const key of dataset.tables) {
      entities.push({
        entity: key,
        columns: dataset.entities?.find((e) => e.key === key)?.columns,
        datasourceId: dataset.datasourceId,
        datasourceKind: dataset.datasourceKind,
        dataset: dataset.name,
      });
    }
  }
  return entities;
}

/** Resolve an entity without silently choosing between identical keys on different sources. */
function resolveEntity(
  entities: EntityAccess[],
  entity: string,
  requestedDatasourceId?: string,
): EntityAccess | { error: string } {
  const matches = entities.filter(
    (access) =>
      access.entity === entity &&
      (!requestedDatasourceId || access.datasourceId === requestedDatasourceId),
  );
  if (matches.length === 0) {
    return {
      error: requestedDatasourceId
        ? `Entity "${entity}" is not available from datasource "${requestedDatasourceId}" in this session`
        : `Entity "${entity}" is not part of this session's datasets`,
    };
  }
  const byDatasource = new Map(
    matches.map((access) => [access.datasourceId ?? '', access]),
  );
  if (byDatasource.size === 1) return matches[0];
  return {
    error: `Entity "${entity}" exists in several datasources — pass datasourceId. Options: ${Array.from(
      byDatasource.keys(),
    )
      .filter(Boolean)
      .join(', ')}`,
  };
}

/** Pick the datasource for a SQL call: explicit id, else the only one in scope. */
function resolveDatasource(
  datasets: DatasetSnapshot[],
  requested?: string,
): { id: string } | { error: string } {
  const available = new Map<string, string | undefined>();
  for (const s of datasets) {
    if (s.datasourceId) available.set(s.datasourceId, s.datasourceKind);
  }
  if (requested) {
    if (available.has(requested)) return { id: requested };
    return {
      error: `Datasource "${requested}" is not used by this session's datasets`,
    };
  }
  if (available.size === 1) return { id: Array.from(available.keys())[0] };
  if (available.size === 0) {
    return { error: "No datasource is bound to this session's datasets" };
  }
  return {
    error: `Several datasources are in scope — pass datasourceId. Options: ${Array.from(
      available.entries(),
    )
      .map(([id, kind]) => `${id} (${kind ?? 'unknown'})`)
      .join(', ')}`,
  };
}

export const listEntitiesTool = createTool({
  id: 'list_entities',
  description:
    "List the entities (fully-qualified catalog.schema.table) available in this session's datasets, with the datasource (id and kind: databricks or postgres) each one lives in.",
  inputSchema: z.object({}),
  execute: async (_input, { requestContext }) => {
    const entities = allowedEntities(await sessionDatasets(requestContext));
    return {
      entities: entities.map((access) => ({
        entity: access.entity,
        columnCount: access.columns?.length ?? null,
        datasourceId: access.datasourceId ?? null,
        datasourceKind: access.datasourceKind ?? null,
        dataset: access.dataset,
      })),
    };
  },
});

export const describeEntityTool = createTool({
  id: 'describe_entity',
  description:
    'Describe one dataset entity: its columns with types, nullability, and — when captured at save time — a description and real sample values per column. Pass datasourceId when list_entities shows the same key on multiple datasources.',
  inputSchema: z.object({
    entity: z.string().describe('Fully-qualified catalog.schema.table'),
    datasourceId: z.string().optional().describe('Datasource containing it'),
  }),
  execute: async ({ entity, datasourceId }, { requestContext }) => {
    const entities = allowedEntities(await sessionDatasets(requestContext));
    const access = resolveEntity(entities, entity, datasourceId);
    if ('error' in access) return { error: access.error };
    if (!access.columns || access.columns.length === 0) {
      return {
        entity,
        datasourceId: access.datasourceId ?? null,
        datasourceKind: access.datasourceKind ?? null,
        columns: [],
        note: 'No schema snapshot stored for this entity — use sample_rows to inspect it.',
      };
    }
    return {
      entity,
      datasourceId: access.datasourceId ?? null,
      datasourceKind: access.datasourceKind ?? null,
      columns: access.columns,
    };
  },
});

export const sampleRowsTool = createTool({
  id: 'sample_rows',
  description:
    'Fetch up to 100 sample rows from one dataset entity. Pass datasourceId when the same key exists on multiple datasources.',
  inputSchema: z.object({
    entity: z.string().describe('Fully-qualified catalog.schema.table'),
    datasourceId: z.string().optional().describe('Datasource containing it'),
    limit: z.number().int().min(1).max(100).optional(),
    rationale: z.string().describe(RATIONALE_DESCRIPTION),
  }),
  execute: async ({ entity, datasourceId, limit }, context) => {
    const { requestContext } = context;
    const entities = allowedEntities(await sessionDatasets(requestContext));
    const access = resolveEntity(entities, entity, datasourceId);
    if ('error' in access) return { error: access.error };
    if (!access.datasourceId) {
      return {
        error: `Entity "${entity}" has no datasource bound — re-save its dataset`,
      };
    }
    const rowLimit = limit ?? 10;
    const result = await getDatasetToolServices().sampleRows(
      access.datasourceId,
      entity,
      rowLimit,
    );
    return withoutFacts(
      result,
      {
        tool: 'sample_rows',
        input: entity,
        datasourceId: access.datasourceId,
        rowLimit,
      },
      context,
    );
  },
});

export const runReadOnlySqlTool = createTool({
  id: 'run_readonly_sql',
  description: [
    'Run a single read-only SELECT/WITH statement (live) against one datasource.',
    'Use the SQL dialect of that datasource: Databricks SQL for databricks,',
    'PostgreSQL for postgres, SQLite for rest. Reference entities with fully-qualified',
    'catalog.schema.table names (on Postgres, the catalog is the database',
    'name; you may write schema.table). Only query entities from this',
    "session's datasets. Write/DDL statements are rejected. datasourceId is",
    'optional when the session uses a single datasource.',
  ].join(' '),
  inputSchema: z.object({
    sql: z.string().describe('A single SELECT or WITH statement'),
    datasourceId: z.string().optional().describe('Datasource to run on'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Max rows returned (default 100)'),
    rationale: z.string().describe(RATIONALE_DESCRIPTION),
  }),
  execute: async ({ sql, datasourceId, limit }, context) => {
    const { requestContext } = context;
    const datasets = await sessionDatasets(requestContext);
    const target = resolveDatasource(datasets, datasourceId);
    if ('error' in target) return { error: target.error };
    const rowLimit = limit ?? 100;
    try {
      const result = await getDatasetToolServices().runReadOnlySql(
        target.id,
        sql,
        rowLimit,
        datasetNames(requestContext),
      );
      // Inspect the statement that actually ran — the fixer may have repaired
      // the one the model wrote. Warnings ride back on the tool result so the
      // agent has to face them before it writes an answer, instead of the
      // defect only surfacing if someone reads the SQL.
      const executed =
        typeof (result as { correctedSql?: unknown }).correctedSql === 'string'
          ? (result as { correctedSql: string }).correctedSql
          : sql;
      const rows = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
      // The call's own cap is a reason to warn only when it dropped rows:
      // the connector's count of what the statement produced says so.
      const produced = (result as { totalRows?: unknown }).totalRows;
      const capHeldRows =
        typeof produced !== 'number' || produced > rows.length;
      const warnings = inspectResult(
        executed,
        rows,
        capHeldRows ? rowLimit : undefined,
      ).map((warning) => warning.message);
      const shown = withoutFacts(
        result,
        {
          tool: 'run_readonly_sql',
          input: executed,
          datasourceId: target.id,
          rowLimit,
        },
        context,
      );
      return warnings.length ? { ...shown, warnings } : shown;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const datasetTools = {
  list_entities: listEntitiesTool,
  describe_entity: describeEntityTool,
  sample_rows: sampleRowsTool,
  run_readonly_sql: runReadOnlySqlTool,
  explore_result: exploreResultTool,
};
