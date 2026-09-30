import type { DatasetSnapshot } from '../tool-services';
import {
  findFixture,
  requiredEntities,
  type SampleFixture,
} from '../../modules/testing-data/fixtures/registry';

/**
 * Resolve the sample a question set is bound to. Throws rather than returning
 * undefined: a set pointing at a fixture that no longer exists must fail the
 * run loudly, not quietly validate the datasets against nothing.
 */
export function evalFixture(fixtureId: string): SampleFixture {
  const fixture = findFixture(fixtureId);
  if (!fixture) {
    throw new Error(
      `Unknown sample fixture "${fixtureId}" — the question set is bound to a ` +
        'sample that is not in the fixture registry, so its data scope cannot be checked.',
    );
  }
  return fixture;
}

/**
 * Validate the suite's data scope before creating a run or spending model
 * tokens. Names are user-defined; match schema-qualified tables instead.
 * This checks saved scope, not whether the live fixture's rows have drifted.
 *
 * The required entities come from the fixture registry — the same list the
 * Testing Data loader provisions — so a new sample needs no change here.
 */
export function assistantEvalDatasetError(
  names: string[],
  snapshots: DatasetSnapshot[],
  fixture: SampleFixture | string,
): string | undefined {
  const sample = typeof fixture === 'string' ? evalFixture(fixture) : fixture;
  const kind = sample.datasourceKind ?? 'postgres';
  const kindLabel = kind === 'rest' ? 'REST API' : 'PostgreSQL';
  const setupDoc =
    kind === 'rest'
      ? 'scripts/setup-worldcup-rest.ts'
      : 'docker/postgres/README.md';
  const setup =
    `These evals require the bundled ${sample.name} sample: ${sample.description} ` +
    `Select its ${kindLabel} datasource and save a dataset containing the ` +
    `${sample.schema} tables and views. Setup: ${setupDoc}.`;
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
    selected.some((dataset) => dataset.datasourceKind !== kind)
  ) {
    return `${setup} The selected datasets must belong to one ${kindLabel} datasource.`;
  }
  // Inventory keys are catalog.schema.table (`api.schema.table` for REST);
  // older snapshots may have schema.table. Never accept a similarly named
  // table in another schema.
  const entities = new Set(
    selected.flatMap((dataset) =>
      dataset.tables.map((table) =>
        table.toLowerCase().split('.').slice(-2).join('.'),
      ),
    ),
  );
  const missing = requiredEntities(sample).filter(
    (entity) => !entities.has(entity.toLowerCase()),
  );
  if (missing.length > 0) {
    return `${setup} Selected datasets: ${names.join(', ')}. Missing entities: ${missing.join(', ')}.`;
  }
  return undefined;
}
