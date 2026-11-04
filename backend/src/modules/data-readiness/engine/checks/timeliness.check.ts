import type { CheckContext, CheckResult, EntityProfile } from '../types';

const MS_PER_DAY = 86_400_000;
const none = (): CheckResult => ({
  dimension: 'timeliness',
  checksRun: 0,
  findings: [],
});

/**
 * Timeliness (DMBOK): whether data is available/current when needed. Until a
 * dedicated Currency dimension exists, stale-value findings fold into Timeliness
 * (per the specs). Pure function over the newest temporal field's `max`: if the
 * most recent record is older than the staleness threshold, the table is stale.
 * Denominator (F1.6.8): one check per entity that has a parseable temporal
 * field (entities without one are not freshness-checkable).
 */
export function timelinessCheck(
  entity: EntityProfile,
  ctx: CheckContext,
): CheckResult {
  let newestMs = -Infinity;
  let newestField = '';
  let newestValue = '';

  for (const field of entity.fields) {
    if (field.semanticType !== 'temporal' || !field.max) continue;
    const ms = Date.parse(field.max);
    if (Number.isNaN(ms)) continue;
    if (ms > newestMs) {
      newestMs = ms;
      newestField = field.name;
      newestValue = field.max;
    }
  }

  // F1.20.5a — schemas that model time as integers (`SurveyYear int`): a
  // numeric column named like a year with a plausible max is a freshness
  // signal too. The newest year is treated as Dec 31 of that year so the
  // staleness math below is shared.
  if (newestMs === -Infinity) {
    for (const field of entity.fields) {
      if (field.semanticType !== 'numeric' || !field.max) continue;
      // Ends-with match so snake_case (`survey_year`) AND camelCase
      // (`SurveyYear`) both register as year signals.
      if (!/(year|yr)$/i.test(field.name)) continue;
      const year = Number.parseInt(field.max, 10);
      if (!Number.isInteger(year) || year < 1900 || year > 2100) continue;
      const ms = Date.parse(`${year}-12-31T23:59:59Z`);
      if (ms > newestMs) {
        newestMs = ms;
        newestField = field.name;
        newestValue = String(year);
      }
    }
  }

  // F1.20.5b — entities with NO temporal/year column fall back to the
  // catalog's table-modification timestamp when the adapter captured one
  // (Databricks `information_schema.tables.last_altered`).
  if (newestMs === -Infinity && entity.lastModifiedAt) {
    const ms = Date.parse(entity.lastModifiedAt);
    if (!Number.isNaN(ms)) {
      newestMs = ms;
      newestField = '(table last altered)';
      newestValue = entity.lastModifiedAt;
    }
  }

  if (newestMs === -Infinity) return none();

  const ageDays = Math.floor((ctx.now.getTime() - newestMs) / MS_PER_DAY);
  if (ageDays <= ctx.thresholds.timeliness.staleDays) {
    return { dimension: 'timeliness', checksRun: 1, findings: [] };
  }

  const severity: 'low' | 'medium' =
    ageDays > ctx.thresholds.timeliness.staleDays * 2 ? 'medium' : 'low';
  return {
    dimension: 'timeliness',
    checksRun: 1,
    findings: [
      {
        dimension: 'timeliness',
        level: 'entity',
        namespace: entity.namespace,
        entity: entity.name,
        field: newestField,
        severity,
        measured: `newest "${newestField}" = ${newestValue} (${ageDays}d ago)`,
        description: `The most recent record in "${entity.name}" is ${ageDays} days old (by "${newestField}").`,
        recommendation:
          'Confirm the table is still being loaded — stale data often signals a broken or paused pipeline.',
      },
    ],
  };
}
