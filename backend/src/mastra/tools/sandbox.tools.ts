import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSandboxToolServices, SandboxSnapshot } from '../tool-services';

/** requestContext key carrying the project's sandbox names. */
export const SANDBOXES_CONTEXT_KEY = 'sandboxes';

interface EntityAccess {
  entity: string;
  columns?: { name: string; type: string; nullable: boolean }[];
  datasourceId?: string;
  datasourceKind?: string;
  sandbox: string;
}

function sandboxNames(requestContext: {
  get: (key: string) => unknown;
}): string[] {
  const value = requestContext.get(SANDBOXES_CONTEXT_KEY);
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

async function projectSandboxes(requestContext: {
  get: (key: string) => unknown;
}): Promise<SandboxSnapshot[]> {
  return getSandboxToolServices().getSandboxes(sandboxNames(requestContext));
}

function allowedEntities(sandboxes: SandboxSnapshot[]): EntityAccess[] {
  const entities: EntityAccess[] = [];
  for (const sandbox of sandboxes) {
    for (const key of sandbox.tables) {
      entities.push({
        entity: key,
        columns: sandbox.entities?.find((e) => e.key === key)?.columns,
        datasourceId: sandbox.datasourceId,
        datasourceKind: sandbox.datasourceKind,
        sandbox: sandbox.name,
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
        ? `Entity "${entity}" is not available from datasource "${requestedDatasourceId}" in this project`
        : `Entity "${entity}" is not part of this project's sandboxes`,
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
  sandboxes: SandboxSnapshot[],
  requested?: string,
): { id: string } | { error: string } {
  const available = new Map<string, string | undefined>();
  for (const s of sandboxes) {
    if (s.datasourceId) available.set(s.datasourceId, s.datasourceKind);
  }
  if (requested) {
    if (available.has(requested)) return { id: requested };
    return {
      error: `Datasource "${requested}" is not used by this project's sandboxes`,
    };
  }
  if (available.size === 1) return { id: Array.from(available.keys())[0] };
  if (available.size === 0) {
    return { error: "No datasource is bound to this project's sandboxes" };
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
    "List the entities (fully-qualified catalog.schema.table) available in this project's data sandboxes, with the datasource (id and kind: databricks or postgres) each one lives in.",
  inputSchema: z.object({}),
  execute: async (_input, { requestContext }) => {
    const entities = allowedEntities(await projectSandboxes(requestContext));
    return {
      entities: entities.map((access) => ({
        entity: access.entity,
        columnCount: access.columns?.length ?? null,
        datasourceId: access.datasourceId ?? null,
        datasourceKind: access.datasourceKind ?? null,
        sandbox: access.sandbox,
      })),
    };
  },
});

export const describeEntityTool = createTool({
  id: 'describe_entity',
  description:
    'Describe one sandbox entity: its columns with types and nullability. Pass datasourceId when list_entities shows the same key on multiple datasources.',
  inputSchema: z.object({
    entity: z.string().describe('Fully-qualified catalog.schema.table'),
    datasourceId: z.string().optional().describe('Datasource containing it'),
  }),
  execute: async ({ entity, datasourceId }, { requestContext }) => {
    const entities = allowedEntities(await projectSandboxes(requestContext));
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
    'Fetch up to 100 sample rows from one sandbox entity. Pass datasourceId when the same key exists on multiple datasources.',
  inputSchema: z.object({
    entity: z.string().describe('Fully-qualified catalog.schema.table'),
    datasourceId: z.string().optional().describe('Datasource containing it'),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  execute: async ({ entity, datasourceId, limit }, { requestContext }) => {
    const entities = allowedEntities(await projectSandboxes(requestContext));
    const access = resolveEntity(entities, entity, datasourceId);
    if ('error' in access) return { error: access.error };
    if (!access.datasourceId) {
      return {
        error: `Entity "${entity}" has no datasource bound — re-save its sandbox`,
      };
    }
    return getSandboxToolServices().sampleRows(
      access.datasourceId,
      entity,
      limit ?? 10,
    );
  },
});

export const runReadOnlySqlTool = createTool({
  id: 'run_readonly_sql',
  description: [
    'Run a single read-only SELECT/WITH statement (live) against one datasource.',
    'Use the SQL dialect of that datasource: Databricks SQL for databricks,',
    'PostgreSQL for postgres. Reference entities with fully-qualified',
    'catalog.schema.table names (on Postgres, the catalog is the database',
    'name; you may write schema.table). Only query entities from this',
    "project's sandboxes. Write/DDL statements are rejected. datasourceId is",
    'optional when the project uses a single datasource.',
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
  }),
  execute: async ({ sql, datasourceId, limit }, { requestContext }) => {
    const sandboxes = await projectSandboxes(requestContext);
    const target = resolveDatasource(sandboxes, datasourceId);
    if ('error' in target) return { error: target.error };
    try {
      return await getSandboxToolServices().runReadOnlySql(
        target.id,
        sql,
        limit ?? 100,
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const sandboxTools = {
  list_entities: listEntitiesTool,
  describe_entity: describeEntityTool,
  sample_rows: sampleRowsTool,
  run_readonly_sql: runReadOnlySqlTool,
};
