import type { SampleMethod } from '../../synthetic-data/types';
import type { ProfilingConnector, ScopedProfiler } from './profiling';

export interface SampleOutcome {
  namespace: string; table: string;
  rowCountEstimate: number | null;
  method: SampleMethod;
  columns: string[];
  rows: Record<string, string | null>[];   // raw text values; never leaves the service
  durationMs: number;
  error?: string;
}
export interface RowSampler<TConfig> {
  sampleTable(config: TConfig, namespace: string, table: string,
              opts: { sampleSize: number; repeatableSeed: number /* 7 */ }): Promise<SampleOutcome>;
}

/** Oversampling factor for the TABLESAMPLE percentage (plan 2.1). */
export const OVERSAMPLE_FACTOR = 1.5;

/**
 * `p = min(100, ceil(1.5 x sampleSize / estimate x 100 x 10^4) / 10^4)` percent,
 * four decimals. An unusable estimate reads everything (100).
 */
export function samplePercent(sampleSize: number, estimate: number): number {
  if (!(estimate > 0)) return 100;
  const p =
    Math.ceil(((OVERSAMPLE_FACTOR * sampleSize) / estimate) * 100 * 1e4) / 1e4;
  return Math.min(100, p);
}

/** A tablesample read that returned fewer than half of what it should is retried once with p x 4. */
export function isShortRead(
  returned: number,
  sampleSize: number,
  estimate: number,
): boolean {
  return returned < Math.min(sampleSize, estimate) / 2;
}

/** The percentage of the one retry. */
export function retryPercent(p: number): number {
  return Math.min(100, Math.round(p * 4 * 1e4) / 1e4);
}

/**
 * A `LIMIT` read that returned fewer rows than it asked for read the whole
 * table, so it is `full`; otherwise it is the plain `limit` fallback.
 */
export function limitMethod(returned: number, limit: number): SampleMethod {
  return returned < limit ? 'full' : 'limit';
}

/** Error text for an outcome: the connector message only, never row data. */
export function outcomeError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'sampling failed';
}

/** An aborted statement is not a table error: the caller stops the whole run. */
export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * `withSessions` with the scope typed as a profiler that can also sample. The
 * scoped copy is `Object.create(profiler)`, so `sampleTable` runs on the
 * scope's pooled sessions, abort handling and statement timeout.
 */
export function withSamplingSessions<TConfig, T>(
  profiler: ProfilingConnector<TConfig> & RowSampler<TConfig>,
  config: TConfig,
  size: number,
  signal: AbortSignal | undefined,
  fn: (scoped: ScopedProfiler<TConfig> & RowSampler<TConfig>) => Promise<T>,
): Promise<T> {
  return profiler.withSessions(config, size, signal, (scoped) =>
    fn(scoped as ScopedProfiler<TConfig> & RowSampler<TConfig>),
  );
}
