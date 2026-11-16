import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type {
  SampledColumn,
  SampledProfile,
} from '../../modules/synthetic-data/types';
import {
  getSyntheticDataToolServices,
  type SyntheticScriptResult,
} from '../synthetic-data-tool-services';
import { SESSION_ID_CONTEXT_KEY } from './visual.tools';

/**
 * The Data Readiness Agent's synthetic-data tools (story 1.22.4, agents.md
 * 3.14, ADR-0039). They call the synthetic-data tool-services bridge, which
 * samples the dataset's tables and runs the deterministic generator on the
 * server; neither runs SQL against the datasource for the model, neither
 * writes to it, and neither throws to the model: every failure comes back as
 * `{ error }`, its text the bridge's Error message. Every input is a scalar.
 */

type Failure = { error: string };
type Context = { get: (key: string) => unknown };

/** Columns per table the model sees of a sampled profile (agents.md 3.14). */
export const PROJECTION_COLUMNS_MAX = 40;
/** Categorical values per column the model sees. */
export const PROJECTION_TOP_VALUES_MAX = 5;

/** One column as the model sees it. Every number is approximate. */
export interface ProjectedColumn {
  name: string;
  type: string;
  /** Percentage of sampled rows that are NULL, one decimal. */
  nullPct: number;
  distinct: number;
  kind: SampledColumn['kind'];
  generatedAs: SampledColumn['strategy'];
  range?: { min: number | string; max: number | string };
  topValues?: { value: string; pct: number }[];
  pattern?: string;
}

/** What `profile_data_sample` returns to the model (agents.md 3.14). */
export interface SampleProfileProjection {
  profileId: string;
  datasetName: string;
  dialect: SampledProfile['dialect'];
  expiresAt: string;
  tables: {
    table: string;
    method: string;
    sampledRows: number;
    rowCountEstimate: number | null;
    error?: string;
    columns: ProjectedColumn[];
    columnsOmitted?: number;
  }[];
  relationships: { from: string; to: string; origin: string }[];
}

const pct = (fraction: number): number => Math.round(fraction * 1000) / 10;

function projectColumn(column: SampledColumn): ProjectedColumn {
  const range = column.numeric
    ? { min: column.numeric.min, max: column.numeric.max }
    : column.temporal
      ? { min: column.temporal.min, max: column.temporal.max }
      : undefined;
  const top = column.topValues?.slice(0, PROJECTION_TOP_VALUES_MAX);
  const pattern = column.patterns?.[0]?.shape;
  return {
    name: column.name,
    type: column.type,
    nullPct: pct(column.nullFraction),
    distinct: column.distinctCount,
    kind: column.kind,
    generatedAs: column.strategy,
    ...(range ? { range } : {}),
    ...(top?.length
      ? {
          topValues: top.map((t) => ({ value: t.value, pct: pct(t.fraction) })),
        }
      : {}),
    ...(pattern ? { pattern } : {}),
  };
}

/** `table(col, col)` of one side of a relationship. */
function relationshipEnd(table: string, columns: string[]): string {
  return `${table}(${columns.join(', ')})`;
}

/**
 * The model-facing projection of a sampled profile (agents.md 3.14): at most
 * 40 columns per table (`columnsOmitted` counts the rest) and at most five
 * categorical values per column.
 */
export function sampleProfileProjection(
  profile: SampledProfile,
): SampleProfileProjection {
  return {
    profileId: profile.profileId,
    datasetName: profile.datasetName,
    dialect: profile.dialect,
    expiresAt: profile.expiresAt,
    tables: profile.tables.map((table) => {
      const shown = table.columns.slice(0, PROJECTION_COLUMNS_MAX);
      const omitted = table.columns.length - shown.length;
      return {
        table: table.key,
        method: table.method,
        sampledRows: table.sampledRows,
        rowCountEstimate: table.rowCountEstimate,
        ...(table.error ? { error: table.error } : {}),
        columns: shown.map(projectColumn),
        ...(omitted > 0 ? { columnsOmitted: omitted } : {}),
      };
    }),
    relationships: profile.relationships.map((r) => ({
      from: relationshipEnd(r.fromTable, r.fromColumns),
      to: relationshipEnd(r.toTable, r.toColumns),
      origin: r.origin,
    })),
  };
}

/**
 * The `tables` input: entity keys or bare table names, one per line; blank
 * lines are ignored and a repeated name counts once. Undefined when none.
 */
export function parseTableList(text: string | undefined): string[] | undefined {
  const names = [
    ...new Set(
      (text ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  return names.length ? names : undefined;
}

function sessionIdOf(context: Context | undefined): string | undefined {
  const value = context?.get(SESSION_ID_CONTEXT_KEY);
  return typeof value === 'string' && value ? value : undefined;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function withSession<T>(
  context: Context | undefined,
  call: (sessionId: string) => Promise<T>,
): Promise<T | Failure> {
  const sessionId = sessionIdOf(context);
  if (!sessionId) return { error: 'No session in context' };
  try {
    return await call(sessionId);
  } catch (err) {
    // An aborted turn is not a tool failure: let the abort propagate.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const datasetInput = () =>
  z
    .string()
    .optional()
    .describe(
      "Name of one of this session's datasets; leave it out when the session has only one",
    );

const tablesInput = () =>
  z
    .string()
    .optional()
    .describe(
      'Tables to include, one per line, as entity keys or bare table names; leave it out for every table of the dataset (at most 20)',
    );

export const profileDataSampleTool = createTool({
  id: 'profile_data_sample',
  description:
    "Sample up to 1,000 rows of each table of one of this session's datasets and return an approximate profile: types, null rates, distinct counts, ranges, categorical values and text patterns. Its numbers are approximate sample statistics, never readiness scores; pass its profileId to generate_synthetic_data to reuse it.",
  inputSchema: z.object({ dataset: datasetInput(), tables: tablesInput() }),
  execute: ({ dataset, tables }, ctx) =>
    withSession<SampleProfileProjection>(
      ctx.requestContext,
      async (sessionId) =>
        sampleProfileProjection(
          await getSyntheticDataToolServices().profileSample({
            sessionId,
            datasetName: optional(dataset),
            tables: parseTableList(tables),
            signal: ctx.abortSignal,
          }),
        ),
    ),
});

export const generateSyntheticDataTool = createTool({
  id: 'generate_synthetic_data',
  description:
    "Generate a synthetic copy of one of this session's datasets as a SQL script in its datasource's dialect, save it in the session and show it in the panel for download; it never writes to the datasource. It returns the file name, the rows per table and what could not be synthesized.",
  inputSchema: z.object({
    dataset: datasetInput(),
    tables: tablesInput(),
    rowsPerTable: z
      .number()
      .optional()
      .describe(
        'Rows to generate per table, a whole number from 1 to 1,000; default 100',
      ),
    seed: z
      .number()
      .optional()
      .describe(
        'Seed of the generator; the same seed gives the same script; default 1',
      ),
    targetSchema: z
      .string()
      .optional()
      .describe('Schema the script creates its tables in; default synthetic'),
    profileId: z
      .string()
      .optional()
      .describe(
        'profileId from profile_data_sample to reuse that profile; leave it out to profile now',
      ),
  }),
  execute: (
    { dataset, tables, rowsPerTable, seed, targetSchema, profileId },
    ctx,
  ) =>
    withSession<SyntheticScriptResult>(ctx.requestContext, (sessionId) =>
      getSyntheticDataToolServices().generateScript({
        sessionId,
        datasetName: optional(dataset),
        tables: parseTableList(tables),
        rowsPerTable,
        seed,
        targetSchema: optional(targetSchema),
        profileId: optional(profileId),
        signal: ctx.abortSignal,
      }),
    ),
});
