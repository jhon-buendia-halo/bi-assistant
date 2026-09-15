import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSandboxToolServices } from '../tool-services';

/** requestContext key carrying the project's sandbox names. */
export const SANDBOXES_CONTEXT_KEY = 'sandboxes';

function sandboxNames(requestContext: {
  get: (key: string) => unknown;
}): string[] {
  const value = requestContext.get(SANDBOXES_CONTEXT_KEY);
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

async function allowedEntities(requestContext: {
  get: (key: string) => unknown;
}) {
  const sandboxes = await getSandboxToolServices().getSandboxes(
    sandboxNames(requestContext),
  );
  const byKey = new Map<
    string,
    { name: string; type: string; nullable: boolean }[] | undefined
  >();
  for (const sandbox of sandboxes) {
    for (const key of sandbox.tables) {
      byKey.set(
        key,
        sandbox.entities?.find((e) => e.key === key)?.columns,
      );
    }
  }
  return byKey;
}

export const listEntitiesTool = createTool({
  id: 'list_entities',
  description:
    'List the Databricks entities (fully-qualified catalog.schema.table) available in this project\'s data sandboxes.',
  inputSchema: z.object({}),
  execute: async (_input, { requestContext }) => {
    const entities = await allowedEntities(requestContext);
    return {
      entities: Array.from(entities.entries()).map(([key, columns]) => ({
        entity: key,
        columnCount: columns?.length ?? null,
      })),
    };
  },
});

export const describeEntityTool = createTool({
  id: 'describe_entity',
  description:
    'Describe one sandbox entity: its columns with types and nullability. Entity must be a fully-qualified catalog.schema.table from list_entities.',
  inputSchema: z.object({
    entity: z.string().describe('Fully-qualified catalog.schema.table'),
  }),
  execute: async ({ entity }, { requestContext }) => {
    const entities = await allowedEntities(requestContext);
    if (!entities.has(entity)) {
      return { error: `Entity "${entity}" is not part of this project's sandboxes` };
    }
    const columns = entities.get(entity);
    if (!columns || columns.length === 0) {
      return {
        entity,
        columns: [],
        note: 'No schema snapshot stored for this entity — use sample_rows to inspect it.',
      };
    }
    return { entity, columns };
  },
});

export const sampleRowsTool = createTool({
  id: 'sample_rows',
  description:
    'Fetch up to 100 sample rows from one sandbox entity (live Databricks query).',
  inputSchema: z.object({
    entity: z.string().describe('Fully-qualified catalog.schema.table'),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  execute: async ({ entity, limit }, { requestContext }) => {
    const entities = await allowedEntities(requestContext);
    if (!entities.has(entity)) {
      return { error: `Entity "${entity}" is not part of this project's sandboxes` };
    }
    return getSandboxToolServices().sampleRows(entity, limit ?? 10);
  },
});

export const runReadOnlySqlTool = createTool({
  id: 'run_readonly_sql',
  description:
    'Run a single read-only SELECT/WITH SQL statement against Databricks (live). Only query entities from this project\'s sandboxes, using fully-qualified catalog.schema.table names. Write/DDL statements are rejected.',
  inputSchema: z.object({
    sql: z.string().describe('A single SELECT or WITH statement'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Max rows returned (default 100)'),
  }),
  execute: async ({ sql, limit }) => {
    try {
      return await getSandboxToolServices().runReadOnlySql(sql, limit ?? 100);
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
