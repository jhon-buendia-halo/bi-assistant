/**
 * Compare two eval runs — the "before → after" of one lever pull.
 *
 * The improvement loop keeps a change only if pass^k went up where it was
 * aimed and did not go down anywhere else, so a diff is per case (which
 * verdicts flipped, which checks moved, what SQL each side ran) and per
 * category (the unit the loop is steered by), plus the two warnings that make
 * a comparison meaningless: a different model or a different engine config.
 *
 * `draftChangeLogEntry` turns a diff into the `docs/evals/change-log.md`
 * template with the numbers filled in and the judgement left to a person —
 * a tool can say what moved, not whether that is worth keeping.
 *
 * Pure module: both sides are v2 records (`normalizeRunLog` first).
 */
import {
  representativeAttempt,
  type EvalRunLogCaseV2,
  type EvalRunLogRecordV2,
  type EvalRunSummary,
  type EvalVerdict,
} from './eval-telemetry';

export interface RunLogCheckDelta {
  id: string;
  /** Passed on every attempt of that side; `undefined` = the check was absent. */
  before?: boolean;
  after?: boolean;
}

export interface RunLogCaseDiff {
  id: string;
  category?: string;
  /** `SKIP` on a side the case did not run in (the suite changed). */
  before: EvalVerdict;
  after: EvalVerdict;
  passesBefore: number;
  passesAfter: number;
  runsBefore: number;
  runsAfter: number;
  flakyBefore: boolean;
  flakyAfter: boolean;
  /** Final SQL of each side's representative attempt (first non-PASS, else first). */
  sqlBefore?: string;
  sqlAfter?: string;
  /** Checks whose outcome changed. */
  checkDeltas: RunLogCheckDelta[];
  /** after − before total tokens, when both sides observed usage. */
  tokensDelta?: number;
}

/** Enough about a run to title a comparison. */
export interface RunLogDiffSide {
  runId: string;
  label?: string;
  suite: string;
  arm?: string;
  model?: string;
  reasoningEffort?: string;
  configHash: string;
  repeat: number;
  startedAt: string;
}

export interface RunLogDiff {
  runBefore: RunLogDiffSide;
  runAfter: RunLogDiffSide;
  perCase: RunLogCaseDiff[];
  /** PASS → FAIL/ERROR. */
  regressions: string[];
  /** FAIL/ERROR → PASS. GAP on either side is neither: it was not measured. */
  improvements: string[];
  /** Cases whose flakiness changed either way. */
  flakyChanges: string[];
  /** Case ids present on one side only. */
  onlyBefore: string[];
  onlyAfter: string[];
  summaryBefore: EvalRunSummary;
  summaryAfter: EvalRunSummary;
  /** pass^k rate per category (0..1), with the counts behind it. */
  categoryDeltas: Record<
    string,
    {
      before: number;
      after: number;
      passKBefore: number;
      passKAfter: number;
      totalBefore: number;
      totalAfter: number;
    }
  >;
  /** after − before total tokens. */
  tokensDelta: number;
  /** False when either side reported no usage: the delta is then not a saving. */
  tokensComparable: boolean;
  /** after − before estimated cost, when both sides were priced. */
  costDelta?: number;
  sameModel: boolean;
  sameConfig: boolean;
  sameSuite: boolean;
}

function side(record: EvalRunLogRecordV2): RunLogDiffSide {
  return {
    runId: record.runId,
    ...(record.label ? { label: record.label } : {}),
    suite: record.suite,
    ...(record.arm ? { arm: record.arm } : {}),
    ...(record.model ? { model: record.model } : {}),
    ...(record.reasoningEffort
      ? { reasoningEffort: record.reasoningEffort }
      : {}),
    configHash: record.configHash,
    repeat: record.repeat,
    startedAt: record.startedAt,
  };
}

/** Per check id: did it pass on every attempt that ran it? */
function checkOutcomes(
  item: EvalRunLogCaseV2 | undefined,
): Map<string, boolean> {
  const outcomes = new Map<string, boolean>();
  for (const attempt of item?.attempts ?? []) {
    for (const check of attempt.checks ?? []) {
      outcomes.set(check.id, (outcomes.get(check.id) ?? true) && check.passed);
    }
  }
  return outcomes;
}

function isFailure(verdict: EvalVerdict): boolean {
  return verdict === 'FAIL' || verdict === 'ERROR';
}

function observedTokens(
  item: EvalRunLogCaseV2 | undefined,
): number | undefined {
  if (item?.usage && item.usage.calls > 0) return item.usage.totalTokens;
  const attempts = (item?.attempts ?? []).filter(
    (attempt) => attempt.usage && attempt.usage.calls > 0,
  );
  return attempts.length
    ? attempts.reduce(
        (sum, attempt) => sum + (attempt.usage?.totalTokens ?? 0),
        0,
      )
    : undefined;
}

/** Diff run `a` (before) against run `b` (after), case by case. */
export function diffRunLogs(
  a: EvalRunLogRecordV2,
  b: EvalRunLogRecordV2,
): RunLogDiff {
  const before = new Map(a.cases.map((item) => [item.id, item]));
  const after = new Map(b.cases.map((item) => [item.id, item]));
  // Case order: the after run's, then anything only the before run had.
  const ids = [
    ...b.cases.map((item) => item.id),
    ...a.cases.map((item) => item.id).filter((id) => !after.has(id)),
  ];

  const perCase: RunLogCaseDiff[] = [];
  const regressions: string[] = [];
  const improvements: string[] = [];
  const flakyChanges: string[] = [];
  for (const id of ids) {
    const x = before.get(id);
    const y = after.get(id);
    const xVerdict: EvalVerdict = x?.verdict ?? 'SKIP';
    const yVerdict: EvalVerdict = y?.verdict ?? 'SKIP';
    const xChecks = checkOutcomes(x);
    const yChecks = checkOutcomes(y);
    const checkDeltas: RunLogCheckDelta[] = [];
    for (const checkId of new Set([...xChecks.keys(), ...yChecks.keys()])) {
      const was = xChecks.get(checkId);
      const is = yChecks.get(checkId);
      if (was !== is) checkDeltas.push({ id: checkId, before: was, after: is });
    }
    const xTokens = observedTokens(x);
    const yTokens = observedTokens(y);
    const sqlBefore = x
      ? representativeAttempt(x.attempts)?.finalSql
      : undefined;
    const sqlAfter = y
      ? representativeAttempt(y.attempts)?.finalSql
      : undefined;
    const row: RunLogCaseDiff = {
      id,
      ...((y?.category ?? x?.category)
        ? { category: y?.category ?? x?.category }
        : {}),
      before: xVerdict,
      after: yVerdict,
      passesBefore: x?.passes ?? 0,
      passesAfter: y?.passes ?? 0,
      runsBefore: x?.runs ?? 0,
      runsAfter: y?.runs ?? 0,
      flakyBefore: x?.flaky ?? false,
      flakyAfter: y?.flaky ?? false,
      ...(sqlBefore ? { sqlBefore } : {}),
      ...(sqlAfter ? { sqlAfter } : {}),
      checkDeltas,
      ...(xTokens !== undefined && yTokens !== undefined
        ? { tokensDelta: yTokens - xTokens }
        : {}),
    };
    perCase.push(row);
    if (x && y) {
      if (xVerdict === 'PASS' && isFailure(yVerdict)) regressions.push(id);
      if (isFailure(xVerdict) && yVerdict === 'PASS') improvements.push(id);
      if (row.flakyBefore !== row.flakyAfter) flakyChanges.push(id);
    }
  }

  const categoryDeltas: RunLogDiff['categoryDeltas'] = {};
  const categories = new Set([
    ...Object.keys(a.summary.byCategory),
    ...Object.keys(b.summary.byCategory),
  ]);
  for (const category of categories) {
    const x = a.summary.byCategory[category];
    const y = b.summary.byCategory[category];
    categoryDeltas[category] = {
      before: x && x.total ? x.passK / x.total : 0,
      after: y && y.total ? y.passK / y.total : 0,
      passKBefore: x?.passK ?? 0,
      passKAfter: y?.passK ?? 0,
      totalBefore: x?.total ?? 0,
      totalAfter: y?.total ?? 0,
    };
  }

  return {
    runBefore: side(a),
    runAfter: side(b),
    perCase,
    regressions,
    improvements,
    flakyChanges,
    onlyBefore: a.cases.map((item) => item.id).filter((id) => !after.has(id)),
    onlyAfter: b.cases.map((item) => item.id).filter((id) => !before.has(id)),
    summaryBefore: a.summary,
    summaryAfter: b.summary,
    categoryDeltas,
    tokensDelta: (b.usage?.totalTokens ?? 0) - (a.usage?.totalTokens ?? 0),
    tokensComparable: (a.usage?.calls ?? 0) > 0 && (b.usage?.calls ?? 0) > 0,
    ...(a.estimatedCostUsd !== undefined && b.estimatedCostUsd !== undefined
      ? {
          costDelta: Number(
            (b.estimatedCostUsd - a.estimatedCostUsd).toFixed(6),
          ),
        }
      : {}),
    sameModel: (a.model ?? '') === (b.model ?? ''),
    sameConfig: a.configHash === b.configHash,
    sameSuite: a.suite === b.suite,
  };
}

/* ----------------------------------------------------------- rendering */

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function passKText(summary: EvalRunSummary): string {
  return `${summary.passK}/${summary.scored}`;
}

function signed(value: number, digits = 0): string {
  const text = Math.abs(value).toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

function runName(run: RunLogDiffSide): string {
  const parts = [run.label ?? run.runId.slice(0, 8)];
  if (run.arm) parts.push(`arm ${run.arm}`);
  if (run.model) parts.push(run.model);
  return parts.join(' · ');
}

/** Categories ordered worst after-rate first, then biggest change. */
function orderedCategories(diff: RunLogDiff): string[] {
  return Object.keys(diff.categoryDeltas).sort((x, y) => {
    const a = diff.categoryDeltas[x];
    const b = diff.categoryDeltas[y];
    return (
      a.after - b.after ||
      Math.abs(b.after - b.before) - Math.abs(a.after - a.before) ||
      x.localeCompare(y)
    );
  });
}

/** Warnings that make the comparison not like-for-like. */
function comparabilityNotes(diff: RunLogDiff): string[] {
  const notes: string[] = [];
  if (!diff.sameSuite) {
    notes.push(
      `different suites (${diff.runBefore.suite} vs ${diff.runAfter.suite})`,
    );
  }
  if (!diff.sameModel) {
    notes.push(
      `different models (${diff.runBefore.model ?? 'unknown'} vs ${diff.runAfter.model ?? 'unknown'})`,
    );
  }
  if (!diff.sameConfig) {
    notes.push(
      `different engine configs (${diff.runBefore.configHash} vs ${diff.runAfter.configHash})`,
    );
  }
  if (diff.runBefore.repeat !== diff.runAfter.repeat) {
    notes.push(
      `different repeat (pass^${diff.runBefore.repeat} vs pass^${diff.runAfter.repeat})`,
    );
  }
  return notes;
}

function oneLine(sql: string | undefined): string {
  return (sql ?? '').replace(/\s+/g, ' ').trim();
}

/** The diff as Markdown, for `eval:diff --markdown` and the Compare view. */
export function renderRunLogDiffMarkdown(diff: RunLogDiff): string {
  const { summaryBefore: x, summaryAfter: y } = diff;
  const k = diff.runAfter.repeat;
  const lines: string[] = [
    `# ${diff.runAfter.suite}: ${runName(diff.runBefore)} → ${runName(diff.runAfter)}`,
    '',
  ];
  const notes = comparabilityNotes(diff);
  if (notes.length) {
    lines.push(`> **Not like-for-like:** ${notes.join('; ')}.`, '');
  }
  lines.push(
    '| Metric | Before | After |',
    '| --- | --- | --- |',
    `| pass^${k} | ${passKText(x)} (${percent(x.passKRate)}) | ${passKText(y)} (${percent(y.passKRate)}) |`,
    `| mean pass rate | ${percent(x.meanPassRate)} | ${percent(y.meanPassRate)} |`,
    `| flaky | ${x.flaky} | ${y.flaky} |`,
    `| GAP | ${x.gaps} | ${y.gaps} |`,
    `| tokens / case | ${x.tokensPerCase ?? '—'} | ${y.tokensPerCase ?? '—'} |`,
    `| $ / correct | ${x.costPerCorrectUsd !== undefined ? `$${x.costPerCorrectUsd.toFixed(4)}` : 'not priced'} | ${y.costPerCorrectUsd !== undefined ? `$${y.costPerCorrectUsd.toFixed(4)}` : 'not priced'} |`,
    '',
    diff.tokensComparable
      ? `Tokens: ${signed(diff.tokensDelta)} total${diff.costDelta !== undefined ? `, cost ${diff.costDelta < 0 ? '−' : '+'}$${Math.abs(diff.costDelta).toFixed(4)}` : ''}.`
      : 'Tokens: not comparable — one side reported no usage.',
    '',
    '## By category (worst first)',
    '',
    '| Category | Before | After |',
    '| --- | --- | --- |',
    ...orderedCategories(diff).map((category) => {
      const c = diff.categoryDeltas[category];
      const moved = c.after > c.before ? ' ▲' : c.after < c.before ? ' ▼' : '';
      return `| ${category} | ${c.passKBefore}/${c.totalBefore} | ${c.passKAfter}/${c.totalAfter}${moved} |`;
    }),
    '',
  );
  const list = (title: string, ids: string[]) => {
    lines.push(
      `## ${title}`,
      '',
      ids.length ? ids.map((id) => `- ${id}`).join('\n') : '- none',
      '',
    );
  };
  list('Regressions', diff.regressions);
  list('Improvements', diff.improvements);
  list('Flaky changes', diff.flakyChanges);
  if (diff.onlyBefore.length || diff.onlyAfter.length) {
    lines.push(
      '## Cases on one side only',
      '',
      `- before only: ${diff.onlyBefore.join(', ') || 'none'}`,
      `- after only: ${diff.onlyAfter.join(', ') || 'none'}`,
      '',
    );
  }
  const flips = diff.perCase.filter(
    (row) => row.before !== row.after || row.passesBefore !== row.passesAfter,
  );
  if (flips.length) {
    lines.push('## Verdict changes', '');
    for (const row of flips) {
      lines.push(
        `### ${row.id}${row.category ? ` (${row.category})` : ''}: ${row.before} ${row.passesBefore}/${row.runsBefore} → ${row.after} ${row.passesAfter}/${row.runsAfter}`,
        '',
      );
      for (const delta of row.checkDeltas) {
        const show = (value: boolean | undefined) =>
          value === undefined ? 'absent' : value ? 'pass' : 'fail';
        lines.push(
          `- ${delta.id}: ${show(delta.before)} → ${show(delta.after)}`,
        );
      }
      if (row.sqlBefore || row.sqlAfter) {
        lines.push(
          '',
          '```sql',
          `-- before`,
          oneLine(row.sqlBefore) || '-- (no successful SQL)',
          `-- after`,
          oneLine(row.sqlAfter) || '-- (no successful SQL)',
          '```',
        );
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export interface ChangeLogDraftOptions {
  /** `prompt rules | tools & guards | context | model & mode`, or an arm name. */
  lever: string;
  /** What was edited, in one or two sentences. */
  change: string;
  /** The failure the report showed, and the reasoning from failure to lever. */
  why: string;
  /** Defaults to the after run's suite. */
  suite?: string;
  /** Run log filenames (or paths) for the Runs line; default: run ids. */
  runA?: string;
  runB?: string;
  /** Entry heading summary; default: lever + the pass^k move. */
  title?: string;
  /** `YYYY-MM-DD`; default today. */
  date?: string;
}

function runPath(file: string | undefined, run: RunLogDiffSide): string {
  if (!file) return `run ${run.runId}`;
  return file.includes('/') ? file : `logs/evals/${file}`;
}

/**
 * A `docs/evals/change-log.md` entry with the measured half filled in:
 * pass^k before → after overall and per changed category, tokens, the runs.
 * Side effects and the verdict are left for the person who pulled the lever.
 */
export function draftChangeLogEntry(
  diff: RunLogDiff,
  options: ChangeLogDraftOptions,
): string {
  const { summaryBefore: x, summaryAfter: y } = diff;
  const k = diff.runAfter.repeat;
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const suite = options.suite ?? diff.runAfter.suite;
  const title =
    options.title ??
    `${options.lever}: ${suite} pass^${k} ${passKText(x)} → ${passKText(y)}`;

  const changed = orderedCategories(diff).filter((category) => {
    const c = diff.categoryDeltas[category];
    return c.passKBefore !== c.passKAfter || c.totalBefore !== c.totalAfter;
  });
  const categoryText = changed.length
    ? changed
        .map((category) => {
          const c = diff.categoryDeltas[category];
          return `\`${category} ${c.passKBefore}/${c.totalBefore} → ${c.passKAfter}/${c.totalAfter}\``;
        })
        .join(', ')
    : 'no category moved';
  const tokens = diff.tokensComparable
    ? `tokens ${signed(diff.tokensDelta)}` +
      (x.tokensPerCase !== undefined && y.tokensPerCase !== undefined
        ? ` (${x.tokensPerCase.toLocaleString('en-US')} → ${y.tokensPerCase.toLocaleString('en-US')} per case)`
        : '')
    : 'tokens not comparable (one side reported no usage)';
  const notes = comparabilityNotes(diff);

  return [
    `## ${date} — ${title}`,
    '',
    `- **Suite:** ${suite}`,
    `- **Lever:** ${options.lever}`,
    `- **Change:** ${options.change.trim()}`,
    `- **Why:** ${options.why.trim()}`,
    `- **Before → after:** \`pass^${k} ${passKText(x)} → ${passKText(y)}\` ` +
      `(${percent(x.passKRate)} → ${percent(y.passKRate)}, mean ${percent(x.meanPassRate)} → ${percent(y.meanPassRate)}, ` +
      `flaky ${x.flaky} → ${y.flaky}, GAP ${x.gaps} → ${y.gaps}); ${categoryText}; ${tokens}.` +
      (notes.length ? ` Not like-for-like: ${notes.join('; ')}.` : ''),
    `- **Side effects:** regressions in this run: ${diff.regressions.join(', ') || 'none'}; ` +
      'other suites: <re-run World Cup and the untouched suites, e.g. `world-cup 9/10 → 9/10`>.',
    '- **Verdict:** keep | revert — <reason>',
    `- **Runs:** \`${runPath(options.runA, diff.runBefore)}\` →`,
    `  \`${runPath(options.runB, diff.runAfter)}\``,
    '',
  ].join('\n');
}
