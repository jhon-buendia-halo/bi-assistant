/**
 * Compare two eval run logs — the "before → after" of one lever pull.
 *
 *   npm run eval:diff -- <fileA> <fileB> [--markdown] [--draft "lever|change|why"]
 *
 * `fileA` is the before run, `fileB` the after run. Each is a bare run-log
 * filename (`2026-09-22-health-insurance-9a8d7567.json`, looked up under
 * `evals/` in every candidate log directory — `EVAL_LOG_DIR`, the checkout's
 * `logs/`, `<APP_DATA_DIR>/logs`, `<cwd>/data/logs`) or a path. v1 and v2
 * logs both work: every record is read through `normalizeRunLog`.
 *
 * Default output is a compact console diff: the pass^k headline, category
 * deltas worst first, verdict flips, flaky changes, the token/cost delta and
 * a warning when the model, engine config, suite or repeat differ (a diff
 * across any of those is not like-for-like). `--markdown` prints
 * `renderRunLogDiffMarkdown` instead (what History → Compare shows);
 * `--draft` prints a `docs/evals/change-log.md` entry with the measured half
 * filled in — the verdict stays for a person to write.
 *
 * Pure apart from reading the two files: no Nest boot, no database, no model.
 * Exits 1 when either input cannot be read.
 */
import { existsSync, readFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import {
  diffRunLogs,
  draftChangeLogEntry,
  renderRunLogDiffMarkdown,
  type RunLogDiff,
} from '../src/modules/agents/eval-diff';
import {
  candidateLogDirs,
  readRunLogByFile,
  safeRunLogFilename,
} from '../src/modules/agents/eval-run-log';
import {
  normalizeRunLog,
  type EvalRunLogRecord,
  type EvalRunLogRecordV2,
  type EvalVerdict,
} from '../src/modules/agents/eval-telemetry';

/** An input the operator must fix — printed without a stack trace. */
class DiffInputError extends Error {}

interface DiffOptions {
  /** Before. */
  a: string;
  /** After. */
  b: string;
  markdown: boolean;
  draft?: { lever: string; change: string; why: string };
}

function printUsage(): void {
  console.log(
    [
      'Usage: npm run eval:diff -- <before.json> <after.json> [options]',
      '',
      '  <before> <after>          run-log filenames (searched under evals/ in every',
      '                            log directory) or paths; v1 and v2 logs both work',
      '      --markdown            print the Markdown report (History → Compare)',
      '      --draft "l|c|w"       print a docs/evals/change-log.md entry:',
      '                            lever | what changed | why',
      '  -h, --help                show this message',
      '',
      'Env: EVAL_LOG_DIR (searched first), APP_DATA_DIR (its logs/ is searched too).',
    ].join('\n'),
  );
}

function parseDiffArgs(argv: string[]): DiffOptions {
  const files: string[] = [];
  let markdown = false;
  let draft: DiffOptions['draft'];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--markdown' || arg === '--md') {
      markdown = true;
    } else if (arg === '--draft') {
      const text = argv[++i];
      if (!text || !text.trim()) {
        throw new DiffInputError(
          '--draft needs "lever|change|why", e.g. --draft "fixer-off|SQL fixer off|fixer rewrote filters"',
        );
      }
      draft = parseDraft(text);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new DiffInputError(`Unknown argument "${arg}" (try --help)`);
    } else {
      files.push(arg);
    }
  }
  if (files.length !== 2) {
    throw new DiffInputError(
      `eval:diff needs exactly two run logs (before, after) — got ${files.length}. Try --help.`,
    );
  }
  return { a: files[0], b: files[1], markdown, ...(draft ? { draft } : {}) };
}

/**
 * `lever|change|why`. Only the lever is required: an empty change or why is
 * left as a placeholder for the person finishing the entry. A `|` inside the
 * why is kept — only the first two separate fields.
 */
function parseDraft(text: string): NonNullable<DiffOptions['draft']> {
  const [lever, change, ...why] = text.split('|');
  if (!lever?.trim()) {
    throw new DiffInputError('--draft needs a lever before the first "|"');
  }
  return {
    lever: lever.trim(),
    change: change?.trim() || '<what was edited>',
    why:
      why.join('|').trim() ||
      '<the failure the report showed, and why this lever>',
  };
}

function readRecordPath(path: string): EvalRunLogRecordV2 | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as EvalRunLogRecord;
    if (!parsed || typeof parsed !== 'object' || !parsed.runId)
      return undefined;
    return normalizeRunLog(parsed);
  } catch {
    return undefined;
  }
}

/**
 * One side of the diff. A bare `*.json` name is looked up in every candidate
 * log directory first (that is how History names runs); anything else — or a
 * bare name found nowhere there — is read as a path relative to the working
 * directory.
 */
function loadRunLog(
  input: string,
  dirs: string[] = candidateLogDirs(),
): { record: EvalRunLogRecordV2; name: string } {
  const bare = safeRunLogFilename(input);
  if (bare) {
    const record = readRunLogByFile(bare, dirs);
    if (record) return { record, name: bare };
  }
  const path = resolve(process.cwd(), input);
  if (existsSync(path)) {
    const record = readRecordPath(path);
    if (record) return { record, name: basename(path) };
    throw new DiffInputError(`${path} is not a readable eval run log`);
  }
  const searched = dirs.map((dir) => join(dir, 'evals'));
  throw new DiffInputError(
    `Could not find run log "${input}". ` +
      (bare
        ? `Looked in ${searched.length ? searched.join(', ') : '(no log directory exists)'} and ${path}.`
        : `No file at ${path}.`),
  );
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function signed(value: number, digits = 0): string {
  const text = Math.abs(value).toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

function runName(side: RunLogDiff['runBefore']): string {
  return [
    side.label ?? side.runId.slice(0, 8),
    ...(side.arm ? [`arm ${side.arm}`] : []),
    ...(side.model ? [side.model] : []),
  ].join(' · ');
}

/** Why the two runs are not like-for-like, if they are not. */
function comparabilityWarnings(diff: RunLogDiff): string[] {
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

function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [
    line(header),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(line),
  ];
}

function isFailure(verdict: EvalVerdict): boolean {
  return verdict === 'FAIL' || verdict === 'ERROR';
}

/** The compact console diff, as lines. */
function formatDiffConsole(
  diff: RunLogDiff,
  names: { a?: string; b?: string } = {},
): string[] {
  const { summaryBefore: x, summaryAfter: y } = diff;
  const k = diff.runAfter.repeat;
  const lines: string[] = [
    `${diff.runAfter.suite}: ${runName(diff.runBefore)} → ${runName(diff.runAfter)}`,
    `  before: ${names.a ?? diff.runBefore.runId} (${diff.runBefore.startedAt})`,
    `  after:  ${names.b ?? diff.runAfter.runId} (${diff.runAfter.startedAt})`,
  ];
  const warnings = comparabilityWarnings(diff);
  if (warnings.length) {
    lines.push('', `⚠ Not like-for-like: ${warnings.join('; ')}.`);
  }
  const cost = (value: number | undefined) =>
    value !== undefined ? `$${value.toFixed(4)}` : 'not priced';
  lines.push(
    '',
    `pass^${k}    ${x.passK}/${x.scored} (${percent(x.passKRate)}) → ${y.passK}/${y.scored} (${percent(y.passKRate)})  ${signed(y.passK - x.passK)}`,
    `mean      ${percent(x.meanPassRate)} → ${percent(y.meanPassRate)}`,
    `flaky     ${x.flaky} → ${y.flaky} · GAP ${x.gaps} → ${y.gaps}`,
    diff.tokensComparable
      ? `tokens    ${signed(diff.tokensDelta)} total` +
          (x.tokensPerCase !== undefined && y.tokensPerCase !== undefined
            ? ` (${x.tokensPerCase.toLocaleString('en-US')} → ${y.tokensPerCase.toLocaleString('en-US')} per case)`
            : '') +
          (diff.costDelta !== undefined
            ? ` · cost ${diff.costDelta < 0 ? '-' : '+'}$${Math.abs(diff.costDelta).toFixed(4)}`
            : ' · cost not priced')
      : 'tokens    not comparable — one side reported no usage',
    `$/correct ${cost(x.costPerCorrectUsd)} → ${cost(y.costPerCorrectUsd)}`,
  );

  const categories = Object.keys(diff.categoryDeltas).sort((m, n) => {
    const a = diff.categoryDeltas[m];
    const b = diff.categoryDeltas[n];
    return (
      a.after - b.after ||
      Math.abs(b.after - b.before) - Math.abs(a.after - a.before) ||
      m.localeCompare(n)
    );
  });
  if (categories.length) {
    lines.push(
      '',
      `By category, pass^${k} (worst first):`,
      ...table(
        ['CATEGORY', 'BEFORE', 'AFTER', ''],
        categories.map((category) => {
          const c = diff.categoryDeltas[category];
          return [
            category,
            `${c.passKBefore}/${c.totalBefore}`,
            `${c.passKAfter}/${c.totalAfter}`,
            c.after > c.before ? '▲' : c.after < c.before ? '▼' : '',
          ];
        }),
      ).map((line) => `  ${line}`),
    );
  }

  const flips = diff.perCase.filter(
    (row) =>
      row.runsBefore > 0 &&
      row.runsAfter > 0 &&
      (row.before !== row.after || row.passesBefore !== row.passesAfter),
  );
  lines.push('', `Verdict changes (${flips.length}):`);
  if (!flips.length) lines.push('  none');
  for (const row of flips) {
    const mark =
      row.before === 'PASS' && isFailure(row.after)
        ? '▼ regression '
        : isFailure(row.before) && row.after === 'PASS'
          ? '▲ improvement'
          : '· changed    ';
    lines.push(
      `  ${mark} ${row.id}${row.category ? ` (${row.category})` : ''}: ` +
        `${row.before} ${row.passesBefore}/${row.runsBefore} → ${row.after} ${row.passesAfter}/${row.runsAfter}`,
    );
    for (const delta of row.checkDeltas) {
      const show = (value: boolean | undefined) =>
        value === undefined ? 'absent' : value ? 'pass' : 'fail';
      lines.push(
        `      ${delta.id}: ${show(delta.before)} → ${show(delta.after)}`,
      );
    }
  }
  lines.push(
    '',
    `Regressions: ${diff.regressions.join(', ') || 'none'}`,
    `Improvements: ${diff.improvements.join(', ') || 'none'}`,
    `Flaky changes: ${diff.flakyChanges.join(', ') || 'none'}`,
  );
  if (diff.onlyBefore.length || diff.onlyAfter.length) {
    lines.push(
      `Only before: ${diff.onlyBefore.join(', ') || 'none'} · only after: ${diff.onlyAfter.join(', ') || 'none'}`,
    );
  }
  return lines;
}

function main(argv: string[] = process.argv.slice(2)): number {
  const options = parseDiffArgs(argv);
  const before = loadRunLog(options.a);
  const after = loadRunLog(options.b);
  const diff = diffRunLogs(before.record, after.record);
  const out: string[] = [];
  if (options.markdown) {
    out.push(renderRunLogDiffMarkdown(diff).trimEnd());
  } else if (!options.draft) {
    out.push(...formatDiffConsole(diff, { a: before.name, b: after.name }));
  }
  if (options.draft) {
    if (out.length) out.push('');
    out.push(
      draftChangeLogEntry(diff, {
        ...options.draft,
        runA: before.name,
        runB: after.name,
      }).trimEnd(),
    );
  }
  console.log(out.join('\n'));
  return 0;
}

export {
  parseDiffArgs,
  parseDraft,
  loadRunLog,
  formatDiffConsole,
  comparabilityWarnings,
  DiffInputError,
};
export type { DiffOptions };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    if (error instanceof DiffInputError) {
      console.error(`\n✖ ${error.message}\n`);
    } else {
      console.error('\n✖ eval:diff crashed:');
      console.error(error);
    }
    process.exit(1);
  }
}
