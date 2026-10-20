/**
 * `eval:diff`: what a change did to the eval pass rates (agents-evals R225 to
 * R227). It compares a before and an after side, each one or more saved runs,
 * row by row: per split (dev, then held-out) and category, the two pass rates
 * with their Wilson intervals, the change in points with Newcombe's interval
 * of the change, and a flag, `up` or `down` only when that interval excludes 0.
 * Then the questions that flipped, those on one side only, the cost per
 * question, warnings when the sides are not alike, a draft change-log line, a
 * draft `results.tsv` row, and the accept rule.
 *
 * With about ten questions per category one flip moves a rate by ten points,
 * and a flag is the only honest call; most changes read `within` (open
 * question in the agents-evals spec).
 *
 * No Nest, no Mastra, no model.
 */
import { EVAL_CATEGORIES } from '../eval-set-files';
import type { EvalSplit } from '../eval-set-files';
import {
  formatPercentRange,
  formatPointsRange,
  newcombeDiff95,
  wilson95,
} from '../eval-stats';
import type { Interval } from '../eval-stats';
import {
  CONSOLE_IO,
  dataDirFrom,
  LoopInputError,
  parseFlags,
  runCommand,
} from './cli-args';
import type { CommandIo } from './cli-args';
import {
  costOfRuns,
  describeJudge,
  loadRuns,
  UNCATEGORISED,
} from './run-source';
import type { LoopCost, LoopResult, LoopRun } from './run-source';

export type DiffFlag = 'up' | 'down' | 'within';
export type SideName = 'before' | 'after';

/** The row of every category of a split together. */
export const ALL = 'all';

const SPLITS: readonly EvalSplit[] = ['dev', 'held-out'];

/** The accept rule's cost limit (R227 condition 5). */
export const COST_RISE_LIMIT_PERCENT = 10;

export interface SideCounts {
  passed: number;
  failed: number;
  notScored: number;
  /** Passed plus failed: the trials of the rate. */
  scored: number;
  interval?: Interval;
}

export interface DiffRow {
  split: EvalSplit;
  /** A category, or `all`. */
  category: string;
  before: SideCounts;
  after: SideCounts;
  /** After rate minus before rate, 0..1; absent when a side has none scored. */
  change?: number;
  changeInterval?: Interval;
  flag?: DiffFlag;
}

export interface DiffSide {
  name: SideName;
  runs: LoopRun[];
  /** Every question of the side's runs, by case id, in run order. */
  results: Map<string, LoopResult>;
}

export interface SideCost {
  cost: LoopCost;
  questions: number;
  /** The cost over the finished questions, when priced and any finished. */
  perQuestion?: number;
}

export interface EvalDiff {
  before: DiffSide;
  after: DiffSide;
  rows: DiffRow[];
  flips: {
    split: EvalSplit;
    nowPassing: LoopResult[];
    nowFailing: LoopResult[];
  }[];
  onlyBefore: LoopResult[];
  onlyAfter: LoopResult[];
  cost: { before: SideCost; after: SideCost; changePercent?: number };
  warnings: string[];
}

export interface AcceptCheck {
  met: boolean;
  reasons: string[];
}

export interface DraftOptions {
  round?: string;
  lever?: string;
  hypothesis?: string;
  targets?: readonly string[];
  /** `YYYY-MM-DD`; today when absent. */
  date?: string;
}

/**
 * Combine the runs of one side. A question may be in one run of a side only:
 * a full round is one run per set, and two runs of the same question would be
 * counted twice.
 */
export function combineSide(
  name: SideName,
  runs: readonly LoopRun[],
): DiffSide {
  const results = new Map<string, LoopResult>();
  const owner = new Map<string, LoopRun>();
  for (const run of runs) {
    for (const result of run.results) {
      const other = owner.get(result.id);
      if (other) {
        throw new LoopInputError(
          `Question "${result.id}" is in two runs of the ${name} side (${other.label}, ${run.label})`,
        );
      }
      owner.set(result.id, run);
      results.set(result.id, result);
    }
  }
  return { name, runs: [...runs], results };
}

function counts(results: Iterable<LoopResult>): SideCounts {
  let passed = 0;
  let failed = 0;
  let notScored = 0;
  for (const result of results) {
    if (result.status === 'passed') passed += 1;
    else if (result.status === 'failed') failed += 1;
    else notScored += 1;
  }
  const scored = passed + failed;
  const interval = wilson95(passed, scored);
  return {
    passed,
    failed,
    notScored,
    scored,
    ...(interval ? { interval } : {}),
  };
}

function row(
  split: EvalSplit,
  category: string,
  before: LoopResult[],
  after: LoopResult[],
): DiffRow {
  const b = counts(before);
  const a = counts(after);
  if (b.scored === 0 || a.scored === 0) {
    return { split, category, before: b, after: a };
  }
  const change = a.passed / a.scored - b.passed / b.scored;
  const changeInterval = newcombeDiff95(
    { passes: b.passed, trials: b.scored },
    { passes: a.passed, trials: a.scored },
  )!;
  const flag: DiffFlag =
    changeInterval.low > 0 ? 'up' : changeInterval.high < 0 ? 'down' : 'within';
  return { split, category, before: b, after: a, change, changeInterval, flag };
}

/**
 * The categories in the order of the category list (data-model 4.9), then
 * any other in order of first appearance, `uncategorised` last (R148).
 */
function orderCategories(categories: Iterable<string>): string[] {
  const seen = [...new Set(categories)];
  const listed = EVAL_CATEGORIES.filter((c) => seen.includes(c));
  const others = seen.filter(
    (c) =>
      !(EVAL_CATEGORIES as readonly string[]).includes(c) &&
      c !== UNCATEGORISED,
  );
  return [
    ...listed,
    ...others,
    ...(seen.includes(UNCATEGORISED) ? [UNCATEGORISED] : []),
  ];
}

function isScored(result: LoopResult): boolean {
  return result.status !== 'not-scored';
}

function costView(side: DiffSide): SideCost {
  const cost = costOfRuns(side.runs);
  const questions = side.results.size;
  return {
    cost,
    questions,
    ...(cost.kind === 'usd' && questions > 0
      ? { perQuestion: cost.usd / questions }
      : {}),
  };
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function setsOf(side: DiffSide): string[] {
  return distinct(
    [...side.results.values()].map(
      (r) => r.setId ?? 'cases not in the question bank',
    ),
  ).sort();
}

function sideWarnings(
  before: DiffSide,
  after: DiffSide,
  words: { mixes: string; differ: string },
  valueOf: (run: LoopRun) => string,
  suffix = '',
): string[] {
  const warnings: string[] = [];
  const b = distinct(before.runs.map(valueOf));
  const a = distinct(after.runs.map(valueOf));
  for (const side of [
    { name: 'before', values: b },
    { name: 'after', values: a },
  ]) {
    if (side.values.length > 1) {
      warnings.push(
        `the ${side.name} side mixes ${words.mixes} (${side.values.join(', ')})${suffix}`,
      );
    }
  }
  if (b.length === 1 && a.length === 1 && b[0] !== a[0]) {
    warnings.push(`${words.differ} (before: ${b[0]}; after: ${a[0]})${suffix}`);
  }
  return warnings;
}

/** Compare the two sides (R225, R226). */
export function computeDiff(
  beforeRuns: readonly LoopRun[],
  afterRuns: readonly LoopRun[],
): EvalDiff {
  const before = combineSide('before', beforeRuns);
  const after = combineSide('after', afterRuns);
  const rows: DiffRow[] = [];
  const flips: EvalDiff['flips'] = [];
  for (const split of SPLITS) {
    const b = [...before.results.values()].filter((r) => r.split === split);
    const a = [...after.results.values()].filter((r) => r.split === split);
    const categories = orderCategories(
      [...b, ...a].filter(isScored).map((r) => r.category),
    );
    for (const category of categories) {
      rows.push(
        row(
          split,
          category,
          b.filter((r) => r.category === category),
          a.filter((r) => r.category === category),
        ),
      );
    }
    rows.push(row(split, ALL, b, a));
    const nowPassing: LoopResult[] = [];
    const nowFailing: LoopResult[] = [];
    for (const old of b) {
      const now = after.results.get(old.id);
      if (!now) continue;
      if (old.status === 'failed' && now.status === 'passed') {
        nowPassing.push(now);
      }
      if (old.status === 'passed' && now.status === 'failed') {
        nowFailing.push(now);
      }
    }
    flips.push({ split, nowPassing, nowFailing });
  }
  const onlyBefore = [...before.results.values()].filter(
    (r) => !after.results.has(r.id),
  );
  const onlyAfter = [...after.results.values()].filter(
    (r) => !before.results.has(r.id),
  );
  const costBefore = costView(before);
  const costAfter = costView(after);
  let changePercent: number | undefined;
  if (
    costBefore.perQuestion !== undefined &&
    costAfter.perQuestion !== undefined
  ) {
    if (costBefore.perQuestion > 0) {
      changePercent =
        ((costAfter.perQuestion - costBefore.perQuestion) /
          costBefore.perQuestion) *
        100;
    } else if (costAfter.perQuestion === 0) {
      changePercent = 0;
    }
  }
  const warnings: string[] = [];
  const setsBefore = setsOf(before);
  const setsAfter = setsOf(after);
  if (setsBefore.join(',') !== setsAfter.join(',')) {
    warnings.push(
      `the sides cover different sets (before: ${setsBefore.join(', ') || 'none'}; after: ${setsAfter.join(', ') || 'none'})`,
    );
  }
  warnings.push(
    ...sideWarnings(
      before,
      after,
      { mixes: 'models', differ: 'the model differs' },
      (r) => r.model ?? 'not recorded',
    ),
    ...sideWarnings(
      before,
      after,
      { mixes: 'repeats', differ: 'the repeats differ' },
      (r) => String(r.repeats),
      '; pass^k is not comparable across repeats',
    ),
    ...sideWarnings(
      before,
      after,
      { mixes: 'judge options', differ: 'the judge option differs' },
      (r) => describeJudge(r.judge),
    ),
  );
  return {
    before,
    after,
    rows,
    flips,
    onlyBefore,
    onlyAfter,
    cost: {
      before: costBefore,
      after: costAfter,
      ...(changePercent !== undefined ? { changePercent } : {}),
    },
    warnings,
  };
}

/** The row of `category` on `split`, when there is one. */
export function findRow(
  diff: EvalDiff,
  split: EvalSplit,
  category: string,
): DiffRow | undefined {
  return diff.rows.find((r) => r.split === split && r.category === category);
}

/** `4/8`, or `0/0` when nothing was scored. */
export function formatCount(counts: SideCounts): string {
  return `${counts.passed}/${counts.scored}`;
}

/** `4/8 (22–78%)`, or `—` when nothing was scored (R212). */
export function formatRate(counts: SideCounts): string {
  if (counts.scored === 0) return '—';
  return `${formatCount(counts)} (${formatPercentRange(counts.interval)})`;
}

/** A change in whole points: `+12 pts`, `−5 pts`, `0 pts`, or `—`. */
export function formatChange(change?: number): string {
  if (change === undefined) return '—';
  const points = Math.round(change * 100);
  if (points === 0) return '0 pts';
  return points > 0 ? `+${points} pts` : `−${-points} pts`;
}

/** A percent with at most one decimal: `14%`, `10.4%`. */
function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function formatSignedPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return '0%';
  return rounded > 0 ? `+${rounded}%` : `−${-rounded}%`;
}

function dollars(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** A side's cost line: `$0.4210 · $0.0084 per question`, or why not. */
export function formatSideCost(side: SideCost): string {
  if (side.cost.kind === 'not-recorded') return 'not recorded';
  if (side.cost.kind === 'not-priced') {
    return side.cost.models.length > 0
      ? `not priced (${side.cost.models.join(', ')})`
      : 'not priced';
  }
  if (side.perQuestion === undefined) return dollars(side.cost.usd);
  return `${dollars(side.cost.usd)} · ${dollars(side.perQuestion)} per question`;
}

function perQuestionText(side: SideCost): string {
  if (side.cost.kind === 'not-recorded') return 'not recorded';
  if (side.cost.kind === 'not-priced') return 'not priced';
  return side.perQuestion === undefined ? '—' : dollars(side.perQuestion);
}

/** The categories of `--target`, each one of the eighteen (data-model 4.9). */
export function parseTargets(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const targets = distinct(
    value
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  );
  if (targets.length === 0) {
    throw new LoopInputError('--target needs at least one category');
  }
  for (const target of targets) {
    if (!(EVAL_CATEGORIES as readonly string[]).includes(target)) {
      throw new LoopInputError(
        `Unknown category "${target}" in --target. Known categories: ${EVAL_CATEGORIES.join(', ')}.`,
      );
    }
  }
  return targets;
}

/**
 * The accept rule (R227, decision D2 of 2026-10-20, the default the user may
 * still change). Every reason names the condition and the row at fault.
 */
export function checkAcceptRule(
  diff: EvalDiff,
  targets: readonly string[],
): AcceptCheck {
  const reasons: string[] = [];
  const add = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const noScored = (r: DiffRow | undefined, split: EvalSplit, c: string) => {
    if (!r || (r.before.scored === 0 && r.after.scored === 0)) {
      return `${split} ${c} has no scored question`;
    }
    if (r.before.scored === 0)
      return `${split} ${c} has no scored question before`;
    if (r.after.scored === 0)
      return `${split} ${c} has no scored question after`;
    return undefined;
  };
  // 1. On dev, every target category is up.
  for (const category of targets) {
    const r = findRow(diff, 'dev', category);
    const missing = noScored(r, 'dev', category);
    if (missing) add(missing);
    else if (r?.flag !== 'up') add(`dev ${category} is ${r?.flag}, not up`);
  }
  // 2. On held-out, no target category fell or is down; none scored fails.
  for (const category of targets) {
    const r = findRow(diff, 'held-out', category);
    const missing = noScored(r, 'held-out', category);
    if (missing) {
      add(missing);
      continue;
    }
    const { before, after } = r!;
    if (after.passed * before.scored < before.passed * after.scored) {
      add(
        `held-out ${category} fell from ${formatCount(before)} to ${formatCount(after)}`,
      );
    } else if (r!.flag === 'down') {
      add(`held-out ${category} is down`);
    }
  }
  // 3. The held-out all row is not down; 4. no row is down on either split.
  const heldOutAll = findRow(diff, 'held-out', ALL);
  if (heldOutAll?.flag === 'down') add(`held-out ${ALL} is down`);
  for (const r of diff.rows) {
    if (r.flag !== 'down') continue;
    // A target row already named by condition 1 or 2 is not named again.
    const named = `${r.split} ${r.category} `;
    if (!reasons.some((reason) => reason.startsWith(named))) {
      add(`${r.split} ${r.category} is down`);
    }
  }
  // 5. The cost per question rose by at most 10%.
  const { before, after, changePercent } = diff.cost;
  const unpriced = [
    { name: 'before', side: before },
    { name: 'after', side: after },
  ].filter(({ side }) => side.cost.kind !== 'usd');
  if (unpriced.length > 0) {
    for (const { name, side } of unpriced) {
      add(`cost per question is ${perQuestionText(side)} ${name}`);
    }
  } else if (
    before.perQuestion === undefined ||
    after.perQuestion === undefined
  ) {
    add('cost per question is unknown: a side has no finished question');
  } else if (changePercent === undefined) {
    add(
      `cost per question rose from ${dollars(before.perQuestion)} to ${dollars(after.perQuestion)} (limit ${COST_RISE_LIMIT_PERCENT}%)`,
    );
  } else if (changePercent > COST_RISE_LIMIT_PERCENT) {
    add(
      `cost per question rose ${formatPercent(changePercent)} (limit ${COST_RISE_LIMIT_PERCENT}%)`,
    );
  }
  return { met: reasons.length === 0, reasons };
}

const MISSING = '<…>';

function labels(side: DiffSide): string[] {
  return side.runs.map((run) => run.label);
}

function allCount(diff: EvalDiff, split: EvalSplit, side: SideName): string {
  const r = findRow(diff, split, ALL)!;
  const counts = r[side];
  return counts.scored === 0 ? '—' : formatCount(counts);
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The draft change-log line (R226). */
export function draftChangeLogLine(
  diff: EvalDiff,
  options: DraftOptions = {},
): string {
  const lever = options.lever ? sentence(options.lever) : `${MISSING}.`;
  const hypothesis = options.hypothesis
    ? sentence(options.hypothesis)
    : MISSING;
  const targets =
    options.targets && options.targets.length > 0
      ? `dev ${options.targets
          .map((c) => `${c} ${findRow(diff, 'dev', c)?.flag ?? '—'}`)
          .join(', ')}`
      : MISSING;
  return (
    `Round ${options.round ?? MISSING}: ${lever} ${hypothesis} ` +
    `Dev ${allCount(diff, 'dev', 'before')} → ${allCount(diff, 'dev', 'after')}, ` +
    `held-out ${allCount(diff, 'held-out', 'before')} → ${allCount(diff, 'held-out', 'after')}; ` +
    `${targets}; cost per question ${perQuestionText(diff.cost.before)} → ${perQuestionText(diff.cost.after)}. ` +
    `Runs ${labels(diff.before).join(', ')} → ${labels(diff.after).join(', ')}.`
  );
}

/** The columns of `docs/evals/loop/results.tsv`, as program.md lists them. */
export const RESULTS_TSV_COLUMNS = [
  'round',
  'date',
  'hypothesis',
  'lever',
  'files',
  'target_categories',
  'dev_before',
  'dev_after',
  'heldout_before',
  'heldout_after',
  'categories_down',
  'cost_per_question_before',
  'cost_per_question_after',
  'round_cost_usd',
  'decision',
  'reason',
  'run_ids_before',
  'run_ids_after',
] as const;

function tsvCell(value: string | undefined): string {
  return (value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

function countsCell(
  diff: EvalDiff,
  split: EvalSplit,
  side: SideName,
  targets: readonly string[],
): string {
  return [...targets, ALL]
    .map((category) => {
      const r = findRow(diff, split, category);
      return `${category}:${r ? formatCount(r[side]) : '0/0'}`;
    })
    .join(';');
}

function tsvCost(side: SideCost): string {
  if (side.cost.kind === 'not-recorded') return 'not recorded';
  if (side.cost.kind === 'not-priced') return 'not priced';
  return side.perQuestion === undefined ? '' : side.perQuestion.toFixed(4);
}

/**
 * A draft row of `results.tsv` (R226): held-out cells hold counts only, and
 * the decision and reason are left to the supervisor. The round cost is the
 * after side's; the supervisor adds the runs of the round that are not in it.
 */
export function draftTsvRow(
  diff: EvalDiff,
  options: DraftOptions = {},
): string {
  const targets = options.targets ?? [];
  const down = distinct(
    diff.rows.filter((r) => r.flag === 'down').map((r) => r.category),
  );
  const after = diff.cost.after;
  const values: Record<(typeof RESULTS_TSV_COLUMNS)[number], string> = {
    round: tsvCell(options.round),
    date: options.date ?? new Date().toISOString().slice(0, 10),
    hypothesis: tsvCell(options.hypothesis),
    lever: tsvCell(options.lever),
    files: '',
    target_categories: targets.join(';'),
    dev_before: countsCell(diff, 'dev', 'before', targets),
    dev_after: countsCell(diff, 'dev', 'after', targets),
    heldout_before: countsCell(diff, 'held-out', 'before', targets),
    heldout_after: countsCell(diff, 'held-out', 'after', targets),
    categories_down: down.join(';'),
    cost_per_question_before: tsvCost(diff.cost.before),
    cost_per_question_after: tsvCost(after),
    round_cost_usd: after.cost.kind === 'usd' ? after.cost.usd.toFixed(4) : '',
    decision: '',
    reason: '',
    run_ids_before: labels(diff.before).join(';'),
    run_ids_after: labels(diff.after).join(';'),
  };
  return RESULTS_TSV_COLUMNS.map((column) => values[column]).join('\t');
}

function table(rows: readonly string[][]): string[] {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((r) => [...r[i]].length)),
  );
  return rows.map((r) =>
    r
      .map((cell, i) =>
        i === r.length - 1
          ? cell
          : cell + ' '.repeat(widths[i] - [...cell].length),
      )
      .join('  ')
      .trimEnd(),
  );
}

function describeRun(run: LoopRun): string {
  const parts = [
    `${run.results.length} questions`,
    run.model ?? 'model not recorded',
    `repeats ${run.repeats}`,
    `judge ${describeJudge(run.judge)}`,
  ];
  return `${run.label} (${parts.join(', ')})`;
}

function listResults(results: readonly LoopResult[]): string {
  return results.length === 0
    ? 'none'
    : results.map((r) => `${r.id} (${r.category})`).join(', ');
}

/** Everything `eval:diff` prints, in order (R225, R226, R227). */
export function renderDiff(
  diff: EvalDiff,
  options: DraftOptions & { tsv?: boolean; accept?: AcceptCheck } = {},
): string[] {
  const lines: string[] = [];
  lines.push(`Before: ${diff.before.runs.map(describeRun).join('; ')}`);
  lines.push(`After:  ${diff.after.runs.map(describeRun).join('; ')}`);
  lines.push('');
  lines.push(
    ...table([
      [
        'Split',
        'Category',
        'Before',
        'After',
        'Change',
        '95% interval of change',
        'Flag',
      ],
      ...diff.rows.map((r) => [
        r.split,
        r.category,
        formatRate(r.before),
        formatRate(r.after),
        formatChange(r.change),
        formatPointsRange(r.changeInterval),
        r.flag ?? '—',
      ]),
    ]),
  );
  lines.push('');
  for (const flip of diff.flips) {
    lines.push(`Flips, ${flip.split}:`);
    lines.push(`  Now passing: ${listResults(flip.nowPassing)}`);
    lines.push(`  Now failing: ${listResults(flip.nowFailing)}`);
  }
  lines.push(`Only before: ${listResults(diff.onlyBefore)}`);
  lines.push(`Only after: ${listResults(diff.onlyAfter)}`);
  lines.push('');
  lines.push(`Cost before: ${formatSideCost(diff.cost.before)}`);
  lines.push(`Cost after: ${formatSideCost(diff.cost.after)}`);
  lines.push(
    `Cost per question: ${
      diff.cost.changePercent === undefined
        ? '—'
        : formatSignedPercent(diff.cost.changePercent)
    }`,
  );
  for (const warning of diff.warnings) lines.push(`Warning: ${warning}`);
  lines.push('');
  lines.push(`Draft change log: ${draftChangeLogLine(diff, options)}`);
  if (options.tsv) {
    lines.push('Draft results.tsv row:');
    lines.push(draftTsvRow(diff, options));
  }
  if (options.accept) {
    lines.push(
      options.accept.met
        ? 'Accept rule: met'
        : `Accept rule: not met (${options.accept.reasons.join('; ')})`,
    );
  }
  return lines;
}

export const EVAL_DIFF_USAGE =
  'npm --prefix backend run eval:diff -- --before <runs> --after <runs> [--data-dir <dir>] [--target <categories>] [--round <n>] [--lever "<text>"] [--hypothesis "<text>"] [--tsv]';

const FLAGS = {
  before: 'string',
  after: 'string',
  'data-dir': 'string',
  target: 'string',
  round: 'string',
  lever: 'string',
  hypothesis: 'string',
  tsv: 'boolean',
} as const;

/**
 * The command: exit 0 (no target, or the accept rule met), 1 (not met) or 2
 * (a bad argument, file or run id).
 */
export function evalDiffMain(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  io: CommandIo = CONSOLE_IO,
  today?: string,
): Promise<number> {
  return runCommand(io, () => {
    const flags = parseFlags(argv, FLAGS, EVAL_DIFF_USAGE);
    if (!flags.before || !flags.after) {
      throw new LoopInputError(
        `--before and --after are required\nUsage: ${EVAL_DIFF_USAGE}`,
      );
    }
    const targets = parseTargets(flags.target);
    const dataDir = dataDirFrom(flags['data-dir'], env);
    const diff = computeDiff(
      loadRuns(flags.before, dataDir, env),
      loadRuns(flags.after, dataDir, env),
    );
    const accept = targets ? checkAcceptRule(diff, targets) : undefined;
    const lines = renderDiff(diff, {
      round: flags.round,
      lever: flags.lever,
      hypothesis: flags.hypothesis,
      targets,
      date: today,
      tsv: flags.tsv,
      accept,
    });
    for (const line of lines) io.out(line);
    return accept && !accept.met ? 1 : 0;
  });
}
