import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  readEngineOptions,
  type EngineOptions,
} from '../../modules/engine/engine-options';
import {
  inspectResult,
  type DataWarning,
} from '../../modules/sessions/result-guards';
import {
  describeSqlError,
  emptyResultHint,
} from '../../modules/sessions/sql-errors';
import { classifyRepair } from '../../modules/sessions/sql-repair-guard';
import {
  getDatasetToolServices,
  ColumnProfile,
  DatasetColumnSnapshot,
  DatasetSnapshot,
  DatasetToolServices,
  KnowledgeLookupResult,
  SqlRunResult,
} from '../tool-services';

/** requestContext key carrying the session's dataset names. */
export const DATASETS_CONTEXT_KEY = 'datasets';

// Every tool reads the turn's engine levers off requestContext
// (`readEngineOptions`, key `ENGINE_OPTIONS_CONTEXT_KEY`). With the defaults
// — today's engine — every output below is byte-identical to what the tools
// returned before the levers existed (`dataset.tools.spec.ts` pins it), so
// the Iteration 0 baseline measures the engine as it was.

export interface EntityAccess {
  entity: string;
  columns?: DatasetColumnSnapshot[];
  datasourceId?: string;
  datasourceKind?: string;
  dataset: string;
}

export function datasetNames(requestContext: {
  get: (key: string) => unknown;
}): string[] {
  const value = requestContext.get(DATASETS_CONTEXT_KEY);
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

export async function sessionDatasets(requestContext: {
  get: (key: string) => unknown;
}): Promise<DatasetSnapshot[]> {
  return getDatasetToolServices().getDatasets(datasetNames(requestContext));
}

export function allowedEntities(datasets: DatasetSnapshot[]): EntityAccess[] {
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
export function resolveEntity(
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

/**
 * Every data-gathering call states, in the assistant's own words, why it is
 * being made — so an answer can show the route it took, not just the SQL.
 */
export const RATIONALE_DESCRIPTION = [
  'One or two sentences of plain business English saying what this step',
  "checks and why it moves toward answering the user's question. No SQL",
  'jargon, no restating the statement.',
].join(' ');

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
    const engine = readEngineOptions(requestContext);
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
    const knowledge = inlineKnowledgeOn(engine)
      ? await entityKnowledge(datasetNames(requestContext), entity)
      : undefined;
    return {
      entity,
      datasourceId: access.datasourceId ?? null,
      datasourceKind: access.datasourceKind ?? null,
      columns: describeColumns(access.columns, engine, knowledge),
      ...entityLevelKnowledge(access.columns, knowledge),
    };
  },
});

/**
 * Knowledge beside the column it describes (§9.7: context is most effective
 * "localised next to the definition it refers to"). Lever `inlineKnowledge`;
 * never in the `bare` arm, which measures the schema alone.
 */
function inlineKnowledgeOn(engine: EngineOptions): boolean {
  return engine.inlineKnowledge && engine.context !== 'bare';
}

async function entityKnowledge(
  datasets: string[],
  entity: string,
): Promise<KnowledgeLookupResult | undefined> {
  const bridge = getDatasetToolServices();
  if (!bridge.knowledgeFor) return undefined;
  try {
    return await bridge.knowledgeFor(datasets, { entity });
  } catch {
    // Knowledge enriches the schema; a failed lookup must not cost the schema.
    return undefined;
  }
}

function knowledgeLine(
  snippet: KnowledgeLookupResult['snippets'][number],
): string {
  return `[${snippet.kind}] ${snippet.title}: ${snippet.body}`;
}

function snippetColumn(
  snippet: KnowledgeLookupResult['snippets'][number],
  columns: DatasetColumnSnapshot[],
): string | undefined {
  if (!snippet.column) return undefined;
  const wanted = snippet.column.toLowerCase().split('.').pop();
  return columns.find((column) => column.name.toLowerCase() === wanted)?.name;
}

/**
 * The stored columns as the model sees them. Default levers: exactly as
 * stored, minus the column profile — profiles are a lever
 * (`columnProfiles`), so a dataset that has been profiled must not change
 * what the default engine shows.
 */
function describeColumns(
  columns: DatasetColumnSnapshot[],
  engine: EngineOptions,
  knowledge: KnowledgeLookupResult | undefined,
): unknown[] {
  const byColumn = new Map<string, string[]>();
  for (const snippet of knowledge?.snippets ?? []) {
    const name = snippetColumn(snippet, columns);
    if (name)
      byColumn.set(name, [
        ...(byColumn.get(name) ?? []),
        knowledgeLine(snippet),
      ]);
  }
  const touched =
    byColumn.size > 0 || columns.some((column) => column.profile !== undefined);
  if (!touched) return columns;
  return columns.map((column) => {
    const { profile, ...rest } = column;
    const notes = byColumn.get(column.name);
    return {
      ...rest,
      ...(engine.columnProfiles && profile
        ? { profile: compactProfile(profile) }
        : {}),
      ...(notes ? { knowledge: notes } : {}),
    };
  });
}

/** Snippets about the entity as a whole, and the governed Metrics defined on it. */
function entityLevelKnowledge(
  columns: DatasetColumnSnapshot[],
  knowledge: KnowledgeLookupResult | undefined,
): { knowledge?: string[]; metrics?: KnowledgeLookupResult['metrics'] } {
  if (!knowledge) return {};
  const general = knowledge.snippets
    .filter((snippet) => !snippetColumn(snippet, columns))
    .map(knowledgeLine);
  return {
    ...(general.length ? { knowledge: general } : {}),
    ...(knowledge.metrics.length ? { metrics: knowledge.metrics } : {}),
  };
}

const MAGNITUDE_NOTES: Record<
  NonNullable<ColumnProfile['magnitude']>,
  string
> = {
  'cents-like': 'looks like cents (divide by 100 for currency units)',
  fraction: 'fractions between 0 and 1',
  count: 'whole-number counts',
  'large-integer': 'large integers (likely identifiers or codes)',
};

/** Values listed per column profile — the profile keeps at most 25. */
const PROFILE_VALUES = 25;

/**
 * One line per column instead of the profile object: the model reads it
 * beside the column, and a sentence costs a fraction of the JSON.
 */
export function compactProfile(profile: ColumnProfile): string {
  const parts: string[] = [];
  const top = profile.topValues ?? [];
  if (profile.nullRate >= 1) {
    return 'always null';
  }
  if (profile.constant) {
    parts.push(
      top.length
        ? `constant: every row holds ${top[0].value}`
        : 'constant: one value on every row',
    );
  }
  const percent = profile.nullRate * 100;
  if (percent > 0)
    parts.push(`${percent < 1 ? '<1' : Math.round(percent)}% null`);
  if (!profile.constant) parts.push(`${profile.distinctCount} distinct`);
  if (top.length && !profile.constant) {
    const listed = top
      .slice(0, PROFILE_VALUES)
      .map((entry) => `${entry.value} (${entry.count})`)
      .join(', ');
    const complete = profile.distinctCount <= top.length;
    parts.push(`${complete ? 'values' : 'most common'}: ${listed}`);
  } else if (
    profile.min !== undefined &&
    profile.max !== undefined &&
    !profile.constant
  ) {
    parts.push(`range ${profile.min} … ${profile.max}`);
  }
  if (profile.magnitude) parts.push(MAGNITUDE_NOTES[profile.magnitude]);
  return parts.join('; ');
}

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
  execute: async ({ entity, datasourceId, limit }, { requestContext }) => {
    const entities = allowedEntities(await sessionDatasets(requestContext));
    const access = resolveEntity(entities, entity, datasourceId);
    if ('error' in access) return { error: access.error };
    if (!access.datasourceId) {
      return {
        error: `Entity "${entity}" has no datasource bound — re-save its dataset`,
      };
    }
    return getDatasetToolServices().sampleRows(
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
  execute: async ({ sql, datasourceId, limit }, { requestContext }) => {
    const engine = readEngineOptions(requestContext);
    const datasets = await sessionDatasets(requestContext);
    const target = resolveDatasource(datasets, datasourceId);
    if ('error' in target) return { error: target.error };
    const rowLimit = limit ?? 100;
    const services = getDatasetToolServices();
    const names = datasetNames(requestContext);
    // Hints name tables and columns on the datasource the statement ran on.
    const onTarget = datasets.filter((d) => d.datasourceId === target.id);
    const scope = onTarget.length ? onTarget : datasets;
    try {
      // The bridge owns the fixer, the repair intent guard and the precheck
      // (it knows the levers via `engine`); this tool owns what the model
      // reads back: descriptive errors, empty-result hints, result guards.
      const result = await services.runReadOnlySql(
        target.id,
        sql,
        rowLimit,
        names,
        { engine },
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
      const annotated =
        engine.descriptiveErrors && rows.length === 0
          ? withEmptyResultHint(result, executed, scope)
          : result;
      const guards = inspectResult(
        executed,
        rows,
        rowLimit,
        engine.extendedGuards
          ? {
              extended: true,
              defaultFilters: await defaultFiltersFor(services, names),
            }
          : undefined,
      );
      const warnings = mergeWarnings(annotated, guards);
      return warnings.length ? { ...annotated, warnings } : annotated;
    } catch (err) {
      return {
        error: engine.descriptiveErrors
          ? describeSqlError(err, sql, scope)
          : err instanceof Error
            ? err.message
            : String(err),
      };
    }
  },
});

/** Zero rows on an equality filter: say what the column does hold. */
function withEmptyResultHint(
  result: SqlRunResult,
  executed: string,
  scope: DatasetSnapshot[],
): SqlRunResult {
  const hint = emptyResultHint(executed, scope);
  if (!hint) return result;
  const hints = [...(result.hints ?? [])];
  if (!hints.includes(hint)) hints.push(hint);
  const note = !result.note
    ? hint
    : result.note.includes(hint)
      ? result.note
      : `${result.note}; ${hint}`;
  return { ...result, note, hints };
}

async function defaultFiltersFor(
  services: DatasetToolServices,
  datasets: string[],
): Promise<{ entity: string; predicate: string; title: string }[]> {
  if (!services.defaultFilters) return [];
  try {
    return await services.defaultFilters(datasets);
  } catch {
    // A guard input, not the query: without it the guard simply stays quiet.
    return [];
  }
}

/**
 * One `warnings` list for the model: repairs that changed the question
 * first (the answer may not be the one asked for), then the precheck, then
 * the result guards. A default-filter warning the precheck already raised is
 * not repeated by the guard.
 */
function mergeWarnings(result: SqlRunResult, guards: DataWarning[]): string[] {
  const repairs = (Array.isArray(result.repairs) ? result.repairs : [])
    .filter((repair) => typeof repair?.warning === 'string' && repair.warning)
    .map((repair) => {
      const changed = classifyRepair(
        repair.original,
        repair.repaired,
      ).changed.slice(0, 3);
      return `repair: ${repair.warning}${changed.length ? ` (${changed.join('; ')})` : ''}`;
    });
  const precheck = (Array.isArray(result.precheck) ? result.precheck : [])
    .filter(
      (finding): finding is string => typeof finding === 'string' && !!finding,
    )
    .map((finding) => `precheck: ${finding}`);
  const guardMessages = guards
    .filter((warning) => {
      if (warning.code !== 'default-filter-missing') return true;
      const title = /"([^"]+)"/.exec(warning.message)?.[1];
      return (
        !title || !precheck.some((finding) => finding.includes(`"${title}"`))
      );
    })
    .map((warning) => warning.message);
  return [...new Set([...repairs, ...precheck, ...guardMessages])];
}

export const datasetTools = {
  list_entities: listEntitiesTool,
  describe_entity: describeEntityTool,
  sample_rows: sampleRowsTool,
  run_readonly_sql: runReadOnlySqlTool,
};
