// D3 Freshness: the age of the newest value of the entity's date columns
// (SQL MAX) and the days with rows over the last 30 days, a proxy for loads
// (the app sees no pipeline runs).
import { dateColumns, type InventoryEntity } from './inventory';
import {
  attempt,
  field,
  round,
  toDate,
  toNum,
  type MeasureContext,
} from './ledger';
import type { FreshnessMeasure } from './measures';
import { MAX_CADENCE_DAYS_FOR_SHARE, VOLUME_WINDOW_DAYS } from './rubric';
import { dailyVolumeSql, maxDatesSql } from './sql';

const DAY_MS = 86_400_000;
/** A date column whose newest value is about one person is not a load clock. */
const PERSONAL_DATE = /birth|nacimiento|dob/i;

export const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function measureFreshness(
  ctx: MeasureContext,
  entity: InventoryEntity,
): Promise<FreshnessMeasure> {
  const dated = dateColumns(entity).filter((c) => !PERSONAL_DATE.test(c.name));
  const columns = dated.map((c) => c.name);
  // A DATE (no time) covers its whole day: its data is as new as that day's end.
  const dayOnly = new Set(
    dated.filter((c) => /^date$/i.test(c.type.trim())).map((c) => c.name),
  );
  if (!columns.length || !entity.datasourceId) {
    return { entity: entity.key, reason: 'it has no date or timestamp column' };
  }
  const datasourceId = entity.datasourceId;
  const sql = maxDatesSql(entity, columns);
  const run = await attempt(ctx, () =>
    ctx.port.runSql(datasourceId, sql, ctx.signal),
  );
  if (!run.ok) return { entity: entity.key, reason: run.reason };
  const row = run.value.rows[0] ?? {};
  // A value in the future (a sentinel such as 9999-12-31) is no load clock.
  const limit = ctx.now.getTime() + DAY_MS;
  const newestPerColumn = columns
    .map((column, i) => {
      const at = toDate(field(row, `max_${i}`));
      const end =
        at && dayOnly.has(column)
          ? new Date(
              Math.min(startOfDay(at).getTime() + DAY_MS, ctx.now.getTime()),
            )
          : at;
      return { column, at: end };
    })
    .filter((c): c is { column: string; at: Date } => !!c.at)
    .filter((c) => c.at.getTime() <= limit)
    .sort(
      (a, b) =>
        b.at.getTime() - a.at.getTime() || a.column.localeCompare(b.column),
    );
  const newest = newestPerColumn[0];
  if (!newest) {
    return {
      entity: entity.key,
      reason: 'its date columns hold no past value',
    };
  }
  const ageHours = round(
    Math.max(0, ctx.now.getTime() - newest.at.getTime()) / 3_600_000,
    1,
  );
  const maxEvidenceId = ctx.ledger.addEvidence({
    dimension: 'D3',
    description: `Age of the newest \`${newest.column}\` in ${entity.key}`,
    source: 'sql',
    sql,
    datasourceId,
    entity: entity.key,
    coverage: 'whole-table',
    result: {
      column: newest.column,
      newest: newest.at.toISOString(),
      age_hours: ageHours,
    },
  });
  const measure: FreshnessMeasure = {
    entity: entity.key,
    dateColumn: newest.column,
    newest: newest.at.toISOString(),
    ageHours,
    maxEvidenceId,
  };
  const today = startOfDay(ctx.now);
  const since = new Date(today.getTime() - VOLUME_WINDOW_DAYS * DAY_MS);
  const volumeSql = dailyVolumeSql(entity, newest.column, since);
  const volume = await attempt(ctx, () =>
    ctx.port.runSql(datasourceId, volumeSql, ctx.signal),
  );
  if (!volume.ok) {
    ctx.ledger.addNotEvaluated(
      `D3 daily volume of ${entity.key}`,
      volume.reason,
    );
    return measure;
  }
  const days = volume.value.rows
    .filter((r) => (toNum(field(r, 'row_count')) ?? 0) > 0)
    .map((r) => toDate(field(r, 'load_day')))
    .filter((d): d is Date => !!d)
    .map(startOfDay)
    .filter((d) => d >= since && d < today);
  const keys = [...new Set(days.map(dayKey))].sort();
  const stats = loadStats(keys, today, ctx.scope.requiredFreshnessHours);
  measure.volume = {
    ...stats,
    evidenceId: ctx.ledger.addEvidence({
      dimension: 'D3',
      description: `Days with rows in \`${newest.column}\` of ${entity.key} over the last ${VOLUME_WINDOW_DAYS} days (a proxy for loads)`,
      source: 'sql',
      sql: volumeSql,
      datasourceId,
      entity: entity.key,
      coverage: 'whole-table',
      result: {
        column: newest.column,
        window_days: stats.windowDays,
        days_with_rows: stats.daysWithRows,
        median_gap_days: stats.medianGapDays,
        cadence_days: stats.cadenceDays,
        on_time_share:
          stats.onTimeShare === null ? null : round(stats.onTimeShare),
      },
    }),
  };
  return measure;
}

/**
 * The load proxy over the window (the `VOLUME_WINDOW_DAYS` days before
 * today): the median gap between days with rows, and the share of periods of
 * the required cadence (else the observed one) that got rows.
 */
export function loadStats(
  dayKeys: string[],
  today: Date,
  requiredHours?: number,
): Omit<NonNullable<FreshnessMeasure['volume']>, 'evidenceId'> {
  const times = dayKeys.map((k) => new Date(`${k}T00:00:00Z`).getTime());
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY_MS);
  const sorted = [...gaps].sort((a, b) => a - b);
  const medianGapDays = sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : null;
  const cadenceDays = requiredHours
    ? Math.max(1, Math.ceil(requiredHours / 24))
    : Math.max(1, Math.round(medianGapDays ?? 1));
  let onTimeShare: number | null = null;
  if (cadenceDays <= MAX_CADENCE_DAYS_FOR_SHARE) {
    const periods = Math.floor(VOLUME_WINDOW_DAYS / cadenceDays);
    const end = today.getTime();
    let hit = 0;
    for (let p = 0; p < periods; p++) {
      const hi = end - p * cadenceDays * DAY_MS;
      const lo = hi - cadenceDays * DAY_MS;
      if (times.some((t) => t >= lo && t < hi)) hit++;
    }
    onTimeShare = periods ? hit / periods : null;
  }
  return {
    daysWithRows: dayKeys.length,
    windowDays: VOLUME_WINDOW_DAYS,
    cadenceDays,
    medianGapDays,
    onTimeShare,
  };
}
