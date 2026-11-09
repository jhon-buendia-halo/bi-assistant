import type { DatasetSnapshot } from '../tool-services';
import type { EvalCustomCheck, EvalRawToolCall } from './assistant.evals';

/**
 * The schema-notes case (BA-318, agents.md Schema notes): the same World Cup
 * tables are offered in a Landing schema that does not exist in the database
 * and in the real Consumption schema. The notes are the owner's only hint, so
 * the case passes only when the assistant read the Consumption schema.
 */
export const LANDING_SCHEMA = 'world_cup_raw';

/** The owner's notes for the two schemas (keys are catalog.schema). */
export const SCHEMA_NOTES_EVAL_NOTES: NonNullable<DatasetSnapshot['schemas']> =
  [
    {
      key: 'world_cup.world_cup_raw',
      layer: 'landing',
      description: 'Raw ingest copy, not cleaned',
    },
    {
      key: 'world_cup.world_cup',
      layer: 'consumption',
      description: 'Curated tournament facts for analysis',
    },
  ];

/**
 * The snapshots the orientation block is built from: each dataset also lists
 * every table of its `world_cup` schema under the Landing schema, and carries
 * the two notes. Tools keep the real snapshots.
 */
export function withLandingCopy(
  snapshots: DatasetSnapshot[],
): DatasetSnapshot[] {
  return snapshots.map((dataset) => ({
    ...dataset,
    tables: [
      ...dataset.tables,
      ...dataset.tables
        .filter((table) => table.split('.').slice(-2, -1)[0] === 'world_cup')
        .map((table) => {
          const parts = table.split('.');
          parts[parts.length - 2] = LANDING_SCHEMA;
          return parts.join('.');
        }),
    ],
    schemas: SCHEMA_NOTES_EVAL_NOTES,
  }));
}

function sqlOf(call: EvalRawToolCall): string {
  const input = call.input;
  if (input && typeof input === 'object' && 'sql' in input) {
    const sql = input.sql;
    return typeof sql === 'string' ? sql : '';
  }
  return '';
}

/**
 * Passes when the assistant ran SQL, and none of it, failed or not, read the
 * Landing schema. With the result-set check (the Consumption figure) this is
 * what makes the case "use the Consumption schema".
 */
export const usesConsumptionSchema: EvalCustomCheck = {
  id: 'uses-consumption-schema',
  description:
    'Reads the Consumption schema: runs SQL, and no run_readonly_sql statement touches the Landing schema (world_cup_raw)',
  run({ toolCalls }) {
    const runs = toolCalls.filter((call) => call.name === 'run_readonly_sql');
    if (runs.length === 0) return 'The assistant ran no run_readonly_sql.';
    const landing = runs.find((call) =>
      new RegExp(LANDING_SCHEMA, 'i').test(sqlOf(call)),
    );
    if (landing) {
      return `A query read the Landing schema: ${sqlOf(landing).slice(0, 200)}`;
    }
    if (runs.every((call) => call.failed)) {
      return 'Every run_readonly_sql call failed.';
    }
    return undefined;
  },
};
