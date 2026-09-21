import type { DatasetSnapshot } from '../tool-services';

/** The shipped suite is tied to docker/postgres/init, including its views. */
const REQUIRED_ENTITIES = [
  'tournaments',
  'teams',
  'matches',
  'venues',
  'players',
  'goals',
  'match_team_statistics',
  'v_match_results',
  'v_player_goal_totals',
].map((table) => `world_cup.${table}`);

/**
 * Validate the suite's data scope before creating a run or spending model
 * tokens. Names are user-defined; match schema-qualified tables instead.
 * This checks saved scope, not whether the live fixture's rows have drifted.
 */
export function assistantEvalDatasetError(
  names: string[],
  snapshots: DatasetSnapshot[],
): string | undefined {
  const setup =
    'These evals require the bundled World Cup sample (2018 and 2022). ' +
    'Select its PostgreSQL datasource and save a dataset containing the ' +
    'world_cup tables and views. Setup: docker/postgres/README.md.';
  const selected = snapshots.filter((dataset) => names.includes(dataset.name));
  const missingNames = names.filter(
    (name) => !selected.some((dataset) => dataset.name === name),
  );
  if (names.length === 0 || missingNames.length > 0) {
    return `${setup} ${missingNames.length ? `Datasets not found: ${missingNames.join(', ')}.` : 'No datasets selected.'}`;
  }
  const datasourceIds = new Set(
    selected.map((dataset) => dataset.datasourceId),
  );
  if (
    datasourceIds.size !== 1 ||
    datasourceIds.has(undefined) ||
    datasourceIds.has('') ||
    selected.some((dataset) => dataset.datasourceKind !== 'postgres')
  ) {
    return `${setup} The selected datasets must belong to one PostgreSQL datasource.`;
  }
  // Postgres inventory keys are catalog.schema.table; older snapshots may
  // have schema.table. Never accept a similarly named table in another schema.
  const entities = new Set(
    selected.flatMap((dataset) =>
      dataset.tables.map((table) => table.split('.').slice(-2).join('.')),
    ),
  );
  const missing = REQUIRED_ENTITIES.filter((entity) => !entities.has(entity));
  if (missing.length > 0) {
    return `${setup} Selected datasets: ${names.join(', ')}. Missing entities: ${missing.join(', ')}.`;
  }
  return undefined;
}
