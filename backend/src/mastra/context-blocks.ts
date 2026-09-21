// Pure, DI-free system-context builders shared by `SessionsService` (a real
// chat turn), the assistant eval harness (no session, but the same
// datasets), and `KnowledgeService` (mining drafts from a dataset's schema).
// No Nest DI here, same pattern as `tool-services.ts`.
import type { DatasetColumnSnapshot, DatasetSnapshot } from './tool-services';

/** Join hints shown up front to the assistant — enough for a wide dataset. */
const JOIN_HINT_CHARS = 1_500;
/** Default character budget for `schemaSnapshotBlock` when unspecified. */
const DEFAULT_SCHEMA_BLOCK_CHARS = 6_000;
/** Default sample values shown per column when unspecified. */
const DEFAULT_SCHEMA_BLOCK_SAMPLE_VALUES = 3;

/**
 * ` -> teams.id` for a key column, so a schema line states where it joins.
 * `~>` marks an inferred edge: the model should trust it less than a declared
 * one and can confirm with describe_entity.
 */
export function referenceSuffix(column: DatasetColumnSnapshot): string {
  const reference = column.references;
  if (!reference?.entity || !reference?.column) return '';
  const arrow = reference.source === 'declared' ? '->' : '~>';
  return ` ${arrow} ${reference.entity}.${reference.column}`;
}

/**
 * The join graph, stated up front. Without it the assistant knows which
 * entities exist but not which column joins to which, so it guesses — writing
 * `goals.team_id` where the column is `goals.scoring_team_id`, which fails the
 * query and ends in an answer naming a raw id instead of a team.
 */
export function joinHintBlock(datasets: DatasetSnapshot[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  let budget = JOIN_HINT_CHARS;
  for (const dataset of datasets) {
    for (const entity of dataset.entities ?? []) {
      for (const column of entity.columns ?? []) {
        const suffix = referenceSuffix(column);
        if (!suffix) continue;
        const line = `- ${entity.key}.${column.name}${suffix}`;
        if (seen.has(line)) continue;
        if (line.length > budget) return joinHintHeader(lines);
        budget -= line.length;
        seen.add(line);
        lines.push(line);
      }
    }
  }
  return joinHintHeader(lines);
}

function joinHintHeader(lines: string[]): string {
  if (!lines.length) return '';
  return [
    'How these entities join (-> declared by the datasource, ~> inferred from',
    'naming; join on these columns rather than guessing a key name):',
    ...lines,
  ].join('\n');
}

/**
 * Dataset/entity orientation lines: which datasets are in scope, the
 * fully-qualified entities they expose, and how those entities join. This is
 * the dataset-grounding half of `SessionsService.agentContext`'s first
 * system block — extracted so the assistant eval harness, which has no
 * session, can still ground the model in the same datasets/join-hints a real
 * turn would see.
 */
export function entityOrientationLines(
  datasetNames: string[],
  datasets: DatasetSnapshot[],
): string[] {
  const entityLines = datasets.flatMap((s) =>
    s.tables.map(
      (t) =>
        `- ${t} (dataset: ${s.name}; datasource: ${s.datasourceKind ?? 'unknown'} ${s.datasourceId ?? ''})`,
    ),
  );
  const joinHints = joinHintBlock(datasets);
  return [
    `Datasets for this session: ${datasetNames.join(', ')}.`,
    'Entities available (fully-qualified catalog.schema.table):',
    ...(entityLines.length ? entityLines : ['(none — the datasets are empty)']),
    'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
    ...(joinHints ? ['', joinHints] : []),
  ];
}

/**
 * `entity(column type [e.g. a, b], …)` lines with real sample values —
 * richer than a bare schema listing because sample values let a model match
 * filter literals (or a knowledge-mining pass match enum-like values) to
 * real data. Shared by the SQL verifier (`SessionsService.verifierContext`)
 * and the knowledge-bootstrap agent (`KnowledgeService.bootstrap`) so
 * neither duplicates this formatting.
 */
export function schemaSnapshotBlock(
  datasets: DatasetSnapshot[],
  options: { budgetChars?: number; sampleValues?: number } = {},
): string {
  const budgetChars = options.budgetChars ?? DEFAULT_SCHEMA_BLOCK_CHARS;
  const sampleValues =
    options.sampleValues ?? DEFAULT_SCHEMA_BLOCK_SAMPLE_VALUES;
  const lines: string[] = [];
  let budget = budgetChars;
  for (const dataset of datasets) {
    for (const key of dataset.tables) {
      const columns =
        dataset.entities?.find((e) => e.key === key)?.columns ?? [];
      const described = columns.map((column) => {
        const samples = (column.sampleValues ?? []).slice(0, sampleValues);
        const shown = samples.length ? ` [e.g. ${samples.join(', ')}]` : '';
        return `${column.name} ${column.type}${shown}${referenceSuffix(column)}`;
      });
      const line = `${key}(${described.join(', ')})`;
      if (line.length > budget) return lines.join('\n');
      budget -= line.length;
      lines.push(line);
    }
  }
  return lines.join('\n');
}
