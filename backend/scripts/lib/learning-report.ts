/**
 * Pure helpers for `scripts/learning-demo.ts` — the scripted end-to-end
 * check for learning-from-feedback + answer pinning (plan §3 "F"). Kept
 * dependency-free (no HTTP, no fs) so they can be unit tested without
 * standing up a backend; the script itself only formats and asserts with
 * what it reads off the wire.
 *
 * WHY the spec lives under `src/`: jest's `rootDir` is `src`
 * (`backend/package.json`), so a spec next to this file would never be
 * collected — see `src/modules/agents/run-eval.spec.ts` for the same
 * arrangement with `scripts/run-eval.ts`.
 */
import type { ConfidenceBand } from '../../src/modules/expert-mode/entities/reasoning-trace.entity';

export type { ConfidenceBand };

/* ------------------------------------------------------------ band compare */

/** low < medium < high — the only ordering a band ever needs. */
export const BAND_ORDER: ConfidenceBand[] = ['low', 'medium', 'high'];

/** -1 for an absent/unknown band, otherwise its position in `BAND_ORDER`. */
export function bandRank(band: ConfidenceBand | undefined): number {
  if (!band) return -1;
  const rank = BAND_ORDER.indexOf(band);
  return rank;
}

/** True when `actual` is at least as high as `min` on the low/medium/high scale. */
export function bandAtLeast(
  actual: ConfidenceBand | undefined,
  min: ConfidenceBand,
): boolean {
  return bandRank(actual) >= bandRank(min);
}

/** Negative/zero/positive the way `Array.prototype.sort` wants it. */
export function compareBands(
  a: ConfidenceBand | undefined,
  b: ConfidenceBand | undefined,
): number {
  return bandRank(a) - bandRank(b);
}

/* -------------------------------------------------------------- pattern check */

/** The one shape this script needs out of a suite case's `checks` entries. */
export interface CheckLike {
  type: string;
  pattern?: string;
  flags?: string;
}

export interface MatchSpec {
  pattern: string;
  flags?: string;
}

/**
 * Pull the `matches` check out of a case's checks. A suite case may use each
 * check type at most once (the suite loader rejects a duplicate at load
 * time — `suite-loader.ts`), so the first one found is the only one there
 * is.
 */
export function findMatchesCheck(
  checks: CheckLike[] | undefined,
): MatchSpec | undefined {
  const check = checks?.find(
    (c) => c.type === 'matches' && typeof c.pattern === 'string',
  );
  return check ? { pattern: check.pattern as string, flags: check.flags } : undefined;
}

/**
 * Test text against a `matches` check exactly the way the eval harness
 * grades it (`@mastra/evals/checks`'s `matches`): compile the pattern and
 * test it, nothing more. Suites already write patterns tolerant of a
 * thousands separator where it matters (e.g. `"88[,.]?966"` in
 * `world-cup.json`) — this never renormalizes the text itself, since doing
 * so would silently grade against a different rule than the suite author
 * verified with `eval:validate`.
 */
export function patternMatches(spec: MatchSpec, text: string): boolean {
  return new RegExp(spec.pattern, spec.flags).test(text);
}

/** Find-and-test in one call; throws when the case carries no `matches` check. */
export function caseMatches(
  checks: CheckLike[] | undefined,
  text: string,
): boolean {
  const spec = findMatchesCheck(checks);
  if (!spec) {
    throw new Error('case has no "matches" check to grade its answer against');
  }
  return patternMatches(spec, text);
}

/* -------------------------------------------------------------- byte equality */

/**
 * Exact byte-for-byte equality, the same rule a replay is held to (§2.7: the
 * replayed message's `content` must be byte-identical to the pinned
 * answer's). Deliberately not `a === b`'s string comparison read as "the
 * same" informally — comparing UTF-8 bytes is the literal claim the demo
 * makes and the one worth naming in a failure message.
 */
export function bytesEqual(a: string, b: string): boolean {
  return Buffer.from(a, 'utf8').equals(Buffer.from(b, 'utf8'));
}

/* -------------------------------------------------------------- model-call estimate */

export type StepKind = 'ask-fresh' | 'ask-replay' | 'feedback';

/**
 * Rough model-call count per step, printed so the operator knows what a run
 * costs before scaling it up. A fresh business-expert ask is the main turn
 * plus its cross-check plus the trace explainer (`expert-status` goes
 * `cross-check` → `explaining`); a replay never calls the agent at all
 * (§2.7); one learning comment is one `feedback-learner` call.
 */
export function estimateModelCalls(kind: StepKind): number {
  switch (kind) {
    case 'ask-fresh':
      return 3;
    case 'ask-replay':
      return 0;
    case 'feedback':
      return 1;
  }
}

/* -------------------------------------------------------------- table + summary */

export interface ReportRow {
  step: string;
  session: string;
  question: string;
  /** Pre-formatted, e.g. "medium (0.68)" or "-". */
  band: string;
  /** "yes" | "no" | "-". */
  correct: string;
  /** "replay" | "kept" | "updated" | "-". */
  consistency: string;
  /** "agree" | "disagree" | "error" | "-". */
  crossCheck: string;
  /** Pre-formatted model-call estimate, e.g. "3" or "0 (replay)". */
  modelCalls: string;
}

const TABLE_HEADER = [
  'step',
  'session',
  'question',
  'band',
  'correct',
  'consistency',
  'cross-check',
  'calls',
];

/** Longest a question cell may render before it is ellipsized. */
const QUESTION_WIDTH = 42;

export function formatBand(
  score: number | undefined,
  band: ConfidenceBand | undefined,
): string {
  if (!band) return '-';
  return score === undefined ? band : `${band} (${score.toFixed(2)})`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/** Fixed-width rows, same left-align + trailing-space-trim convention as `run-eval.ts`. */
export function formatReportTable(rows: ReportRow[]): string[] {
  const dataRows = rows.map((r) => [
    r.step,
    r.session,
    truncate(r.question, QUESTION_WIDTH),
    r.band,
    r.correct,
    r.consistency,
    r.crossCheck,
    r.modelCalls,
  ]);
  const widths = TABLE_HEADER.map((label, i) =>
    Math.max(label.length, ...dataRows.map((row) => row[i].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [
    line(TABLE_HEADER),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...dataRows.map(line),
  ];
}

export interface SummaryInput {
  /** Learning-scenario cases that flipped FAIL→PASS (the trap + its generalisation). */
  liftPassed: number;
  liftTotal: number;
  bandBefore: ConfidenceBand | undefined;
  bandAfter: ConfidenceBand | undefined;
  /** Repeated questions that replayed byte-identically (the trap after learning, and the control). */
  consistencyPassed: number;
  consistencyTotal: number;
}

/** "learning lift x/2 (band before → after) · repeat consistency y/2" */
export function formatSummary(input: SummaryInput): string {
  const before = input.bandBefore ?? '-';
  const after = input.bandAfter ?? '-';
  return (
    `learning lift ${input.liftPassed}/${input.liftTotal} (${before} → ${after}) · ` +
    `repeat consistency ${input.consistencyPassed}/${input.consistencyTotal}`
  );
}
