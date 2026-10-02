/**
 * The logical query layer's tools (ADR-0007, roadmap 1.2.2): replace
 * `datasetTools` on the current assistant. Every tool here speaks the
 * session's composed `SessionModel` vocabulary — logical entity/attribute/
 * metric names — and never a physical `catalog.schema.table` key, a
 * datasource id/kind or a SQL dialect word. `assistant-legacy.agent.ts`
 * keeps the old `datasetTools` so the eval harness can still run the
 * pre-change path for comparison (ADR-0007 §7).
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { LogicalQueryError } from '../../modules/data-models/query/compile-sql';
import {
  logicalQuerySchema,
  type LogicalQuery,
} from '../../modules/data-models/query/logical-query';
import type { SessionModel } from '../../modules/data-models/session-model';
import {
  DATASETS_CONTEXT_KEY,
  RATIONALE_DESCRIPTION,
  datasetNames,
} from './dataset.tools';
import {
  getDatasetToolServices,
  queryEntitiesProvenance,
} from '../tool-services';

export { DATASETS_CONTEXT_KEY };

/**
 * A raw engine error can quote the physical table/column it choked on
 * (ADR-0007 §4: no physical name is allowed back into the model's own
 * context) — mapped back to logical names where the session model can, a
 * generic "rejected the query" otherwise. A dotted `word.word.word` token
 * surviving substitution is the telltale a `catalog.schema.table` key (or
 * similar) leaked through unmapped.
 */
const PHYSICAL_KEY_PATTERN = /\b[\w-]+\.[\w-]+\.[\w-]+\b/;

function errorClassOf(message: string): string {
  const bracketed = message.match(/^\[([A-Z][A-Z0-9_]*)\]/)?.[1];
  if (bracketed) return bracketed;
  const prefixed = message.match(/^([A-Za-z][A-Za-z0-9_]*Error)\b/)?.[1];
  if (prefixed) return prefixed;
  return 'engine error';
}

function sanitizeExecutionError(message: string, model: SessionModel): string {
  let sanitized = message;
  for (const entity of model.entities) {
    if (entity.table && sanitized.includes(entity.table)) {
      sanitized = sanitized.split(entity.table).join(entity.name);
    }
    for (const attribute of entity.attributes) {
      const column = entity.columns[attribute.name.toLowerCase()];
      if (column && column !== attribute.name && sanitized.includes(column)) {
        sanitized = sanitized.split(column).join(attribute.name);
      }
    }
  }
  if (PHYSICAL_KEY_PATTERN.test(sanitized)) {
    return `the data source rejected the query (${errorClassOf(message)})`;
  }
  return sanitized;
}

async function sessionModelFor(requestContext: {
  get: (key: string) => unknown;
}): Promise<SessionModel> {
  return getDatasetToolServices().getSessionModel(datasetNames(requestContext));
}

function findEntity(model: SessionModel, name: string) {
  const wanted = name.toLowerCase();
  return model.entities.find((e) => e.name.toLowerCase() === wanted);
}

/** The model-visible shape of a `runLogicalQuery` result: `sql`/
 * `correctedSql` dropped (ADR-0007 §4), everything else kept. A `delete`
 * on a shallow copy rather than a destructure-and-discard, so there is no
 * `const unused = ...` for `no-unused-vars` to flag. */
function withoutSql<T extends { sql?: unknown; correctedSql?: unknown }>(
  full: T,
): Omit<T, 'sql' | 'correctedSql'> {
  const copy: Partial<T> = { ...full };
  delete copy.sql;
  delete copy.correctedSql;
  return copy as Omit<T, 'sql' | 'correctedSql'>;
}

export const listEntitiesTool = createTool({
  id: 'list_entities',
  description:
    'List the logical entities available in this session, with a short description and how many attributes each one has.',
  inputSchema: z.object({}),
  execute: async (_input, { requestContext }) => {
    const model = await sessionModelFor(requestContext);
    return {
      entities: model.entities.map((e) => ({
        entity: e.name,
        label: e.label ?? null,
        description: e.description ?? null,
        attributeCount: e.attributes.length,
        // The entity's own datasets (plural: a deduped entity can span more
        // than one) — a dataset *name*, never a datasource id/kind.
        dataset: e.datasets.join(', '),
      })),
    };
  },
});

export const describeEntityTool = createTool({
  id: 'describe_entity',
  description:
    'Describe one logical entity: its attributes (name, type, role, description, real sample values), the relationships declared in/out of it, and the metrics defined on it.',
  inputSchema: z.object({
    entity: z
      .string()
      .describe('Logical entity name, as shown in the session model'),
  }),
  execute: async ({ entity }, { requestContext }) => {
    const model = await sessionModelFor(requestContext);
    const found = findEntity(model, entity);
    if (!found) {
      return {
        error: `Entity "${entity}" is not part of this session's model`,
      };
    }
    const wanted = found.name.toLowerCase();
    const relationships = model.relationships.filter(
      (r) =>
        r.from.split('.')[0].toLowerCase() === wanted ||
        r.to.split('.')[0].toLowerCase() === wanted,
    );
    const metrics = model.metrics.filter((m) => m.entity === found.name);
    return {
      entity: found.name,
      label: found.label ?? null,
      description: found.description ?? null,
      key: found.key ?? null,
      attributes: found.attributes,
      // `via` is the exact string `joins[].via` (query_entities) accepts —
      // reading this back and pasting it in is the whole point of showing
      // it, rather than a `{from, to}` pair the model has to reassemble.
      relationships: relationships.map((r) => ({
        via: `${r.from}->${r.to}`,
        ...(r.name ? { name: r.name } : {}),
        cardinality: r.cardinality,
        description: r.description ?? null,
      })),
      metrics: metrics.map((m) => ({
        name: m.name,
        label: m.label,
        description: m.description ?? null,
      })),
    };
  },
});

export const sampleRecordsTool = createTool({
  id: 'sample_records',
  description:
    'Fetch up to 50 real sample rows from one logical entity — useful for checking value formats (dates, enum casing) before filtering on them.',
  inputSchema: z.object({
    entity: z.string().describe('Logical entity name'),
    limit: z.number().int().min(1).max(50).optional(),
    rationale: z.string().describe(RATIONALE_DESCRIPTION),
  }),
  execute: async ({ entity, limit }, { requestContext }) => {
    const model = await sessionModelFor(requestContext);
    const found = findEntity(model, entity);
    if (!found) {
      return {
        error: `Entity "${entity}" is not part of this session's model`,
      };
    }
    // A compiled select over the entity's own declared attributes — not the
    // connector's raw `sampleRows` — so a sample never surfaces a physical
    // column the model was never told about (ADR-0007 §4) and goes through
    // the same dialect/repair path as every other query.
    const query: LogicalQuery = {
      from: found.name,
      select: found.attributes.map((a) => ({ attr: a.name })),
      limit: limit ?? 10,
    };
    try {
      const full = await getDatasetToolServices().runLogicalQuery(model, query);
      const modelVisible = withoutSql(full);
      queryEntitiesProvenance.set(modelVisible, full);
      return modelVisible;
    } catch (err) {
      if (err instanceof LogicalQueryError) {
        const [first] = err.issues;
        return {
          error: first ?? {
            code: 'invalid_select',
            message: err.message,
            path: '',
          },
        };
      }
      return {
        error: {
          code: 'execution_error',
          message: sanitizeExecutionError(
            err instanceof Error ? err.message : String(err),
            model,
          ),
          path: '',
        },
      };
    }
  },
});

export const queryEntitiesTool = createTool({
  id: 'query_entities',
  description: [
    'Query the session model: pick the entity to start from, the attributes',
    'and/or metrics to select, optional filters, grouping, ordering and a',
    'row limit, and — when the question needs another entity — a join along',
    "a declared relationship. This compiles to the entity's own storage and",
    'runs it. A reference to an attribute on another entity (e.g.',
    '"teams.name") auto-joins when exactly one relationship path connects',
    'the two entities; pass joins[].via to pick one explicitly when there is',
    'more than one path, or to reach a second hop. Unknown attributes,',
    'metrics or relationship paths are rejected before anything runs, with a',
    'hint — fix the query and try again rather than guessing.',
  ].join(' '),
  inputSchema: z.object({
    query: logicalQuerySchema,
    rationale: z.string().describe(RATIONALE_DESCRIPTION),
  }),
  execute: async ({ query }, { requestContext }) => {
    const model = await sessionModelFor(requestContext);
    try {
      // The entity's own datasource kind decides the dialect (ADR-0007 §4):
      // `sql` bindings compile for the datasource's actual kind, `rest`
      // bindings always compile as sqlite (the materialisation target).
      // Cast: `logicalQuerySchema`'s recursive predicate loses its precise
      // type through `z.infer` (see `logical-query.ts`'s own comment on
      // this); the schema still validated the shape at the tool boundary.
      const full = await getDatasetToolServices().runLogicalQuery(
        model,
        query as unknown as LogicalQuery,
      );
      // `sql`/`correctedSql` never reach the model (ADR-0007 §4) — kept only
      // in `queryEntitiesProvenance`, which `toolDataRecord`
      // (`modules/sessions/turn-data.ts`) reads back for the turn
      // record/visual provenance.
      const modelVisible = withoutSql(full);
      queryEntitiesProvenance.set(modelVisible, full);
      return modelVisible;
    } catch (err) {
      if (err instanceof LogicalQueryError) {
        // Every issue the resolver found, not just the first — a fixer (or
        // the model itself) often needs the whole picture to land a correct
        // rewrite in one try.
        return {
          error: {
            code: err.issues[0]?.code ?? 'invalid_select',
            message: err.issues
              .map((i) => `${i.path}: ${i.message}`)
              .join('; '),
            path: err.issues[0]?.path ?? '',
            issues: err.issues,
          },
          hint: 'Call describe_entity to confirm attribute/relationship names, or set joins[].via to pick a path explicitly.',
        };
      }
      return {
        error: {
          code: 'execution_error',
          message: sanitizeExecutionError(
            err instanceof Error ? err.message : String(err),
            model,
          ),
          path: '',
        },
      };
    }
  },
});

/**
 * The flagged last resort (ADR-0007 §4/§7): the assistant was never shown a
 * physical table name, so reaching for this tool is itself a signal the
 * model could not express the question — `outsideModel: true` on every
 * result lets `SessionsService` mark the turn/answer as outside the data
 * model regardless of whether the statement even succeeds.
 */
export const runRawSqlTool = createTool({
  id: 'run_raw_sql',
  description: [
    'Last resort, only when query_entities reported it cannot express the',
    'question (not for a typo you can just fix): run one read-only SQL',
    'statement directly against the entity you name. The answer will be',
    'marked as outside the data model, so state that plainly if you use',
    'this.',
  ].join(' '),
  inputSchema: z.object({
    entity: z
      .string()
      .describe(
        'Logical entity name whose storage this statement runs against',
      ),
    sql: z.string().describe('A single SELECT or WITH statement'),
    limit: z.number().int().min(1).max(500).optional(),
    rationale: z.string().describe(RATIONALE_DESCRIPTION),
  }),
  execute: async ({ entity, sql, limit }, { requestContext }) => {
    const model = await sessionModelFor(requestContext);
    const found = findEntity(model, entity);
    if (!found) {
      return {
        error: `Entity "${entity}" is not part of this session's model`,
        outsideModel: true,
      };
    }
    try {
      const result = await getDatasetToolServices().runReadOnlySql(
        found.datasourceId,
        sql,
        limit ?? 100,
        datasetNames(requestContext),
      );
      return { ...result, outsideModel: true };
    } catch (err) {
      return {
        error: sanitizeExecutionError(
          err instanceof Error ? err.message : String(err),
          model,
        ),
        outsideModel: true,
      };
    }
  },
});

export const modelTools = {
  list_entities: listEntitiesTool,
  describe_entity: describeEntityTool,
  sample_records: sampleRecordsTool,
  query_entities: queryEntitiesTool,
  run_raw_sql: runRawSqlTool,
};
