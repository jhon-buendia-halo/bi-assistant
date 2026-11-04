/**
 * `eval:export-failures`: what the improvement loop's fixer may read about one
 * run, and nothing else (agents-evals R228). A README with the run's options,
 * the dev counts per category with their intervals and the held-out counts
 * per category, then one Markdown file per failed dev question: its question,
 * category, tags and attempts, its failed checks with their reasons (each
 * reason once, with the attempts it came from), the tool calls and the final
 * answer of its representative attempt.
 *
 * The split rule: the fixer tunes on dev questions only, and the held-out
 * questions measure the change. So no held-out question's id, question,
 * answer or check reason is ever written, and no case's notes or reference
 * query (they hold the expected answer and the trap). The fixer reads this
 * export from a worktree with every held-out-bearing file deleted
 * (delivery.md section 2, *Improvement loop*).
 *
 * No Nest, no Mastra, no model.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { EVAL_CATEGORIES, loadEvalSets } from '../eval-set-files';
import type { EvalSplit } from '../eval-set-files';
import { formatPercentRange, wilson95 } from '../eval-stats';
import {
  CONSOLE_IO,
  dataDirFrom,
  LoopInputError,
  parseFlags,
  resolveUserPath,
  runCommand,
} from './cli-args';
import type { CommandIo } from './cli-args';
import { describeJudge, loadRun, UNCATEGORISED } from './run-source';
import type { LoopResult, LoopRun, LoopToolCall } from './run-source';

/** The marker an export leaves, so `--force` replaces only an export. */
export const EXPORT_MARKER = '.eval-export';

/** Tool call inputs, outputs and errors are cut to this many characters. */
export const TOOL_TEXT_LIMIT = 800;
/** The final answer is cut to this many characters. */
export const ANSWER_LIMIT = 2000;

const TRUNCATED = '… (truncated)';

export interface ExportFile {
  name: string;
  content: string;
}

/** The tags of every question bank case, by set case id. */
function caseTags(): ReadonlyMap<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const set of loadEvalSets()) {
    for (const evalCase of set.cases) tags.set(evalCase.id, evalCase.tags);
  }
  return tags;
}

function cut(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}${TRUNCATED}` : text;
}

/** A Markdown fence long enough for `text`, whatever backticks it holds. */
function fenced(text: string): string {
  const longest = Math.max(
    2,
    ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = '`'.repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

/** A file name for a case id: ids are lowercase words joined by hyphens. */
export function exportFileName(caseId: string): string {
  return `${caseId.replace(/[^a-z0-9._-]+/gi, '-')}.md`;
}

interface CategoryCounts {
  category: string;
  passed: number;
  failed: number;
  notScored: number;
  flaky: number;
  total: number;
}

function countByCategory(results: readonly LoopResult[]): CategoryCounts[] {
  const byCategory = new Map<string, CategoryCounts>();
  for (const result of results) {
    const entry = byCategory.get(result.category) ?? {
      category: result.category,
      passed: 0,
      failed: 0,
      notScored: 0,
      flaky: 0,
      total: 0,
    };
    if (result.status === 'passed') entry.passed += 1;
    else if (result.status === 'failed') entry.failed += 1;
    else entry.notScored += 1;
    if (result.flaky) entry.flaky += 1;
    entry.total += 1;
    byCategory.set(result.category, entry);
  }
  const listed = (EVAL_CATEGORIES as readonly string[]).filter((c) =>
    byCategory.has(c),
  );
  const others = [...byCategory.keys()].filter(
    (c) => !listed.includes(c) && c !== UNCATEGORISED,
  );
  const order = [
    ...listed,
    ...others,
    ...(byCategory.has(UNCATEGORISED) ? [UNCATEGORISED] : []),
  ];
  return order.map((c) => byCategory.get(c)!);
}

function total(entries: readonly CategoryCounts[]): CategoryCounts {
  return entries.reduce<CategoryCounts>(
    (sum, e) => ({
      category: 'all',
      passed: sum.passed + e.passed,
      failed: sum.failed + e.failed,
      notScored: sum.notScored + e.notScored,
      flaky: sum.flaky + e.flaky,
      total: sum.total + e.total,
    }),
    {
      category: 'all',
      passed: 0,
      failed: 0,
      notScored: 0,
      flaky: 0,
      total: 0,
    },
  );
}

function devCell(entry: CategoryCounts): string {
  const scored = entry.passed + entry.failed;
  if (scored === 0) return '—';
  return `${entry.passed}/${scored} (${formatPercentRange(wilson95(entry.passed, scored))})`;
}

function readme(
  run: LoopRun,
  failed: readonly LoopResult[],
  bySplit: Record<EvalSplit, LoopResult[]>,
): string {
  const sets = [
    ...new Set(
      run.results.map((r) => r.setId ?? 'cases not in the question bank'),
    ),
  ];
  const lines: string[] = [
    `# Failure export: run ${run.label}`,
    '',
    'What the improvement loop’s fixer may read about this run: the dev',
    'questions it failed, one file each, and only the counts of the held-out',
    'split, which measures the change and is never tuned on',
    '(docs/evals/loop/program.md).',
    '',
    `- Run: ${run.jobId ?? run.label}`,
    `- Sets: ${sets.join(', ') || 'none'}`,
    `- Model: ${run.model ?? 'not recorded'}`,
    `- Repeats: ${run.repeats}`,
    `- Judge: ${describeJudge(run.judge)}`,
    `- Date: ${run.startedAt ?? 'not recorded'}`,
    '',
    '## Dev',
    '',
    'Pass rate over scored questions with its 95% interval; a question passes',
    'only when every attempt passed.',
    '',
    '| Category | Dev | Flaky | Not scored | Total |',
    '|---|---|---|---|---|',
  ];
  const dev = countByCategory(bySplit.dev);
  for (const entry of [...dev, total(dev)]) {
    lines.push(
      `| ${entry.category} | ${devCell(entry)} | ${entry.flaky} | ${entry.notScored} | ${entry.total} |`,
    );
  }
  lines.push(
    '',
    '## Held-out',
    '',
    'Counts only: nothing else of the held-out questions is in this export.',
    '',
    '| Category | Passed | Failed | Not scored | Total |',
    '|---|---|---|---|---|',
  );
  const heldOut = countByCategory(bySplit['held-out']);
  for (const entry of [...heldOut, total(heldOut)]) {
    lines.push(
      `| ${entry.category} | ${entry.passed} | ${entry.failed} | ${entry.notScored} | ${entry.total} |`,
    );
  }
  lines.push('', '## Files', '');
  if (failed.length === 0) {
    lines.push('No dev question failed.');
  } else {
    for (const result of failed) {
      lines.push(
        `- [${exportFileName(result.id)}](${exportFileName(result.id)}): ${result.category}, ${result.passes}/${result.runs} attempts passed`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function attemptList(attempts: readonly number[]): string {
  return attempts.length === 1
    ? `attempt ${attempts[0]}`
    : `attempts ${attempts.join(', ')}`;
}

function toolCallLines(calls: readonly LoopToolCall[]): string[] {
  if (calls.length === 0) return ['No tool call.'];
  const lines: string[] = [];
  calls.forEach((call, i) => {
    lines.push(`### ${i + 1}. \`${call.name}\``, '');
    if (call.input !== undefined) {
      lines.push('Input:', '', fenced(cut(call.input, TOOL_TEXT_LIMIT)), '');
    }
    if (call.error !== undefined) {
      lines.push('Error:', '', fenced(cut(call.error, TOOL_TEXT_LIMIT)), '');
    } else if (call.output !== undefined) {
      lines.push('Output:', '', fenced(cut(call.output, TOOL_TEXT_LIMIT)), '');
    }
  });
  return lines;
}

function failureFile(result: LoopResult, tags: readonly string[]): string {
  // Each failed check's reason once, with the failed attempts it came from.
  const reasons = new Map<
    string,
    { check: string; reason: string; attempts: number[] }
  >();
  for (const attempt of result.attempts.filter((a) => a.status === 'failed')) {
    const failures = attempt.checks
      .filter((check) => check.status === 'failed')
      .map((check) => ({
        check: check.description
          ? `${check.id}: ${check.description}`
          : check.id,
        reason: check.reason ?? 'no reason given',
      }));
    if (attempt.error) {
      failures.push({ check: 'run error', reason: attempt.error });
    }
    for (const failure of failures) {
      const key = `${failure.check}\u0000${failure.reason}`;
      const entry = reasons.get(key) ?? { ...failure, attempts: [] };
      entry.attempts.push(attempt.attempt);
      reasons.set(key, entry);
    }
  }
  const lines: string[] = [
    `# ${result.id}`,
    '',
    `- Question: ${result.question}`,
    `- Category: ${result.category}`,
    `- Tags: ${tags.length > 0 ? tags.join(', ') : 'none'}`,
    `- Attempts: ${result.passes}/${result.runs} passed${result.flaky ? ' (flaky)' : ''}`,
    '',
    '## Failed checks',
    '',
  ];
  if (reasons.size === 0) {
    lines.push('No failed check was recorded.');
  } else {
    for (const entry of reasons.values()) {
      lines.push(
        `- **${entry.check}** (${attemptList(entry.attempts)}): ${entry.reason}`,
      );
    }
  }
  lines.push(
    '',
    `## Tool calls of attempt ${result.representative}`,
    '',
    ...toolCallLines(result.toolCalls),
    `## Final answer of attempt ${result.representative}`,
    '',
    result.answer ? fenced(cut(result.answer, ANSWER_LIMIT)) : 'No answer.',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * The files of the export: the README first, then one per failed dev
 * question in run order. Held-out results are only counted.
 */
export function buildFailureExport(
  run: LoopRun,
  tags: ReadonlyMap<string, string[]> = caseTags(),
): ExportFile[] {
  const bySplit: Record<EvalSplit, LoopResult[]> = {
    dev: run.results.filter((r) => r.split === 'dev'),
    'held-out': run.results.filter((r) => r.split === 'held-out'),
  };
  const failed = bySplit.dev.filter((r) => r.status === 'failed');
  return [
    { name: 'README.md', content: readme(run, failed, bySplit) },
    ...failed.map((result) => ({
      name: exportFileName(result.id),
      content: failureFile(result, tags.get(result.id) ?? []),
    })),
  ];
}

interface Marker {
  run: string;
  files: string[];
}

function readMarker(folder: string): Marker | undefined {
  const path = join(folder, EXPORT_MARKER);
  if (!existsSync(path)) return undefined;
  try {
    const marker = JSON.parse(readFileSync(path, 'utf8')) as Partial<Marker>;
    if (!Array.isArray(marker.files)) return undefined;
    return { run: String(marker.run ?? ''), files: marker.files.map(String) };
  } catch {
    return undefined;
  }
}

/**
 * Write the export into `folder`. A folder that is not empty is refused;
 * with `force`, only an earlier export (its marker file) is replaced, and
 * only the files it lists are removed.
 */
export function writeFailureExport(
  folder: string,
  files: readonly ExportFile[],
  run: LoopRun,
  force = false,
): void {
  if (existsSync(folder)) {
    if (!statSync(folder).isDirectory()) {
      throw new LoopInputError(`${folder} is not a folder`);
    }
    const entries = readdirSync(folder);
    if (entries.length > 0) {
      if (!force) {
        throw new LoopInputError(
          `${folder} is not empty; pass --force to replace an earlier export`,
        );
      }
      const marker = readMarker(folder);
      if (!marker) {
        throw new LoopInputError(
          `${folder} is not empty and holds no earlier export (no ${EXPORT_MARKER} file); refusing to replace it`,
        );
      }
      for (const name of [...marker.files, EXPORT_MARKER]) {
        // Only plain names an export writes, never a path out of the folder.
        if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '..') continue;
        rmSync(join(folder, name), { force: true });
      }
    }
  }
  mkdirSync(folder, { recursive: true });
  for (const file of files) {
    writeFileSync(join(folder, file.name), file.content);
  }
  const marker: Marker = {
    run: run.jobId ?? run.label,
    files: files.map((f) => f.name),
  };
  writeFileSync(
    join(folder, EXPORT_MARKER),
    `${JSON.stringify(marker, null, 2)}\n`,
  );
}

export const EXPORT_FAILURES_USAGE =
  'npm --prefix backend run eval:export-failures -- --run <run> --out <folder> [--data-dir <dir>] [--force]';

const FLAGS = {
  run: 'string',
  out: 'string',
  'data-dir': 'string',
  force: 'boolean',
} as const;

/** The command: exit 0 when written, 2 on a bad argument, run or folder. */
export function exportFailuresMain(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  io: CommandIo = CONSOLE_IO,
): Promise<number> {
  return runCommand(io, () => {
    const flags = parseFlags(argv, FLAGS, EXPORT_FAILURES_USAGE);
    if (!flags.run || !flags.out) {
      throw new LoopInputError(
        `--run and --out are required\nUsage: ${EXPORT_FAILURES_USAGE}`,
      );
    }
    if (flags.run.includes(',')) {
      throw new LoopInputError('--run takes one run');
    }
    const run = loadRun(flags.run, dataDirFrom(flags['data-dir'], env), env);
    const folder = resolveUserPath(flags.out, env);
    const files = buildFailureExport(run);
    writeFailureExport(folder, files, run, flags.force === true);
    const failed = files.length - 1;
    io.out(
      `Wrote ${folder}: README.md and ${failed} failed dev question${failed === 1 ? '' : 's'} of run ${run.label}.`,
    );
    return 0;
  });
}
