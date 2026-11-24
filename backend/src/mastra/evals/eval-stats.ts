/**
 * The 95% intervals behind every pass rate the evals report (agents-evals
 * R212, R225). With ten questions a category's rate moves by ten points when
 * one question flips, so a rate is only read next to its interval:
 *
 * - `wilson95`: Wilson's score interval of one proportion (passes over
 *   scored trials). It stays inside 0..1 and behaves at 0 and at n passes,
 *   where the plain normal interval collapses to a point.
 * - `newcombeDiff95`: Newcombe's hybrid score interval of the difference of
 *   two independent proportions (method 10 of Newcombe 1998), built from the
 *   two Wilson intervals. A change is called up or down only when this
 *   interval excludes 0.
 *
 * Pure module: no Nest, no Mastra, no model.
 */

/** A closed interval of proportions (0..1), or of a difference (-1..1). */
export interface Interval {
  low: number;
  high: number;
}

/** Passes out of scored trials (passed + failed; not-scored excluded). */
export interface Proportion {
  passes: number;
  trials: number;
}

/** The two-sided 95% normal quantile. */
export const Z95 = 1.959963984540054;

function checkProportion(passes: number, trials: number): void {
  if (
    !Number.isInteger(passes) ||
    !Number.isInteger(trials) ||
    passes < 0 ||
    passes > trials
  ) {
    throw new RangeError(
      `A proportion needs whole numbers with 0 <= passes <= trials (got ${passes}/${trials})`,
    );
  }
}

/**
 * Wilson's 95% score interval for `passes` out of `trials`, or undefined when
 * there is no trial. 0 passes has a low of exactly 0 and every trial passing
 * a high of exactly 1. 9/10 gives 0.596 to 0.982.
 */
export function wilson95(passes: number, trials: number): Interval | undefined {
  checkProportion(passes, trials);
  if (trials === 0) return undefined;
  const z2 = Z95 * Z95;
  const p = passes / trials;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const margin =
    (Z95 / denominator) *
    Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return {
    low: passes === 0 ? 0 : Math.max(0, centre - margin),
    high: passes === trials ? 1 : Math.min(1, centre + margin),
  };
}

/**
 * Newcombe's hybrid score 95% interval of `after` minus `before`, or
 * undefined when either has no trial. Newcombe's own example, 56/70 after
 * against 48/80 before, is a difference of 0.200 with the interval 0.0524 to
 * 0.3339.
 */
export function newcombeDiff95(
  before: Proportion,
  after: Proportion,
): Interval | undefined {
  const a = wilson95(after.passes, after.trials);
  const b = wilson95(before.passes, before.trials);
  if (!a || !b) return undefined;
  const pa = after.passes / after.trials;
  const pb = before.passes / before.trials;
  const difference = pa - pb;
  return {
    low: difference - Math.sqrt((pa - a.low) ** 2 + (b.high - pb) ** 2),
    high: difference + Math.sqrt((a.high - pa) ** 2 + (pb - b.low) ** 2),
  };
}

/** A proportion's interval as whole percents, `56–92%`, or `—` for none. */
export function formatPercentRange(interval?: Interval): string {
  if (!interval) return '—';
  const low = Math.round(interval.low * 100);
  const high = Math.round(interval.high * 100);
  return `${low}–${high}%`;
}

function signedPoints(value: number): string {
  const points = Math.round(value * 100);
  if (points === 0) return '0';
  return points > 0 ? `+${points}` : `−${-points}`;
}

/**
 * A difference's interval in whole percentage points, signed, as `eval:diff`
 * prints it (agents-evals R225): `+5 to +33 pts`, `−12 to +30 pts`, or `—`.
 */
export function formatPointsRange(interval?: Interval): string {
  if (!interval) return '—';
  return `${signedPoints(interval.low)} to ${signedPoints(interval.high)} pts`;
}
