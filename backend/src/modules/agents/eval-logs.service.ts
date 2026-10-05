import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  candidateLogDirs,
  findRepoRoot,
  listRunLogs,
  readRunLogByFile,
  safeRunLogFilename,
} from './eval-run-log';
import type { LogDirSources, RunLogSummary } from './eval-run-log';
import {
  diffRunLogs,
  draftChangeLogEntry,
  renderRunLogDiffMarkdown,
} from './eval-diff';
import type { RunLogDiff } from './eval-diff';
import type {
  EvalHarness,
  EvalRunLogRecordV2,
  EvalRunStatus,
} from './eval-telemetry';

/**
 * Where the logs service looks, when not the real process. Nest injects
 * nothing (the token has no provider), so production reads `EVAL_LOG_DIR`,
 * the checkout's `logs/`, `<APP_DATA_DIR>/logs` and `<cwd>/data/logs`
 * (`candidateLogDirs`); tests pass a temp directory and `repoRoot: null`.
 */
export const EVAL_LOG_SOURCES = 'EVAL_LOG_SOURCES';

/** The change log the loop's "why" lives in, relative to the repo root. */
const CHANGE_LOG_PATH = join('docs', 'evals', 'change-log.md');

const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 2000;

/** One point of `GET …/evals/trend`, oldest first. */
export interface TrendPoint {
  runId: string;
  file: string;
  startedAt: string;
  suite: string;
  label?: string;
  arm?: string;
  model?: string;
  harness?: EvalHarness;
  repeat: number;
  configHash: string;
  passK: number;
  passKRate: number;
  meanPassRate: number;
  gaps: number;
  flaky: number;
  costUsd?: number;
  costPerCorrectUsd?: number;
  status: EvalRunStatus;
}

export interface ChangeLogDraftRequest {
  a: string;
  b: string;
  lever: string;
  change: string;
  why: string;
  /** Also insert the entry into `docs/evals/change-log.md` (checkout only). */
  append?: boolean;
}

type ReadResult =
  { ok: true; record: EvalRunLogRecordV2 } | { ok: false; message: string };

/**
 * Insert a change-log entry newest-first: directly under the first `---`
 * rule after the `## Template` section (the file's own convention — the
 * template, then a rule, then entries newest at the top). Fenced blocks are
 * skipped so a `---` inside the template's example can never be the anchor.
 * Without that structure the entry goes above the first dated heading, or
 * at the end of the file.
 */
export function insertChangeLogEntry(content: string, entry: string): string {
  const lines = content.split('\n');
  const block = entry.replace(/\s+$/, '').split('\n');
  let inFence = false;
  let afterTemplate = false;
  let rule = -1;
  let firstDated = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^##\s+Template\b/i.test(line)) {
      afterTemplate = true;
      continue;
    }
    if (firstDated < 0 && /^##\s+\d{4}-\d{2}-\d{2}\b/.test(line)) {
      firstDated = index;
    }
    if (afterTemplate && /^-{3,}\s*$/.test(line)) {
      rule = index;
      break;
    }
  }
  if (rule >= 0) {
    let next = rule + 1;
    while (next < lines.length && lines[next].trim() === '') next++;
    const rest = lines.slice(next);
    return [
      ...lines.slice(0, rule + 1),
      '',
      ...block,
      ...(rest.length ? ['', ...rest] : ['']),
    ].join('\n');
  }
  if (firstDated >= 0) {
    return [
      ...lines.slice(0, firstDated),
      ...block,
      '',
      ...lines.slice(firstDated),
    ].join('\n');
  }
  const body = content.replace(/\s+$/, '');
  return `${body}${body ? '\n\n' : ''}${block.join('\n')}\n`;
}

/**
 * The run-log history as the Evals tab reads it: History (list + read),
 * Compare (diff of two runs), Trend (pass^k over time) and the change-log
 * drafter. Reads files only — never the eval-runs table — so a CLI run and
 * an in-app run show up side by side, and a run survives a wiped datastore.
 */
@Injectable()
export class EvalLogsService {
  private readonly logger = new Logger(EvalLogsService.name);

  constructor(
    @Optional()
    @Inject(EVAL_LOG_SOURCES)
    private readonly sources?: LogDirSources,
  ) {}

  /** Every log directory that exists, preferred first. */
  dirs(): string[] {
    return candidateLogDirs(this.sources);
  }

  private repoRoot(): string | undefined {
    const configured = this.sources?.repoRoot;
    if (configured === null) return undefined;
    return configured ?? findRepoRoot();
  }

  /** Logged runs, newest first, optionally one suite only. */
  list(options: { suite?: string; limit?: number } = {}): {
    logs: RunLogSummary[];
    dirs: string[];
  } {
    const dirs = this.dirs();
    const suite = options.suite?.trim();
    const limit =
      options.limit !== undefined &&
      Number.isFinite(options.limit) &&
      options.limit > 0
        ? Math.min(Math.floor(options.limit), MAX_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT;
    const logs = listRunLogs(dirs)
      .filter((log) => !suite || log.suite === suite)
      .slice(0, limit);
    return { logs, dirs };
  }

  /** One run, as v2 whatever version it was written in. */
  read(file: string): ReadResult {
    const name = safeRunLogFilename(file);
    if (!name) {
      return { ok: false, message: `"${file}" is not a run-log file name` };
    }
    const record = readRunLogByFile(name, this.dirs());
    if (!record) return { ok: false, message: `Run log "${name}" not found` };
    return { ok: true, record };
  }

  /** `a` is the before run, `b` the after run. */
  compare(
    a: string,
    b: string,
  ):
    | { ok: true; diff: RunLogDiff; markdown: string }
    | { ok: false; message: string } {
    const before = this.read(a);
    if (!before.ok) return before;
    const after = this.read(b);
    if (!after.ok) return after;
    const diff = diffRunLogs(before.record, after.record);
    return { ok: true, diff, markdown: renderRunLogDiffMarkdown(diff) };
  }

  /**
   * pass^k over time, oldest first. Only completed agent runs: a failed or
   * stopped run's rate is over the cases it reached, and a `validate` run
   * checks references, not the engine — either would put a false dip in the
   * line. A run logged without an arm ran the production defaults, so it
   * matches `arm=baseline`.
   */
  trend(options: { suite?: string; arm?: string } = {}): {
    points: TrendPoint[];
  } {
    const suite = options.suite?.trim();
    const arm = options.arm?.trim();
    const points = listRunLogs(this.dirs())
      .filter((log) => log.harness !== 'validate')
      .filter((log) => log.status === 'completed')
      .filter((log) => !suite || log.suite === suite)
      .filter((log) => !arm || (log.arm ?? 'baseline') === arm)
      .map((log): TrendPoint => ({
        runId: log.runId,
        file: log.file,
        startedAt: log.startedAt,
        suite: log.suite,
        ...(log.label ? { label: log.label } : {}),
        ...(log.arm ? { arm: log.arm } : {}),
        ...(log.model ? { model: log.model } : {}),
        ...(log.harness ? { harness: log.harness } : {}),
        repeat: log.repeat,
        configHash: log.configHash,
        passK: log.passK,
        passKRate: log.passKRate,
        meanPassRate: log.meanPassRate,
        gaps: log.gaps,
        flaky: log.flaky,
        ...(log.estimatedCostUsd !== undefined
          ? { costUsd: log.estimatedCostUsd }
          : {}),
        ...(log.costPerCorrectUsd !== undefined
          ? { costPerCorrectUsd: log.costPerCorrectUsd }
          : {}),
        status: log.status,
      }))
      .sort(
        (x, y) =>
          String(x.startedAt).localeCompare(String(y.startedAt)) ||
          x.file.localeCompare(y.file),
      );
    return { points };
  }

  /**
   * A change-log entry with the measured half filled in from the diff of
   * `a` → `b`. With `append`, it is also written into the checkout's
   * `docs/evals/change-log.md`; `appendedTo` (absolute path) is present only
   * when that happened, so a packaged app — no checkout — returns the draft
   * for the operator to paste.
   */
  changelogDraft(
    request: ChangeLogDraftRequest,
  ):
    | { ok: true; markdown: string; appendedTo?: string; message?: string }
    | { ok: false; message: string } {
    const lever = (request?.lever ?? '').trim();
    const change = (request?.change ?? '').trim();
    const why = (request?.why ?? '').trim();
    const compared = this.compare(request?.a ?? '', request?.b ?? '');
    if (!compared.ok) return compared;
    if (request.append && (!lever || !change || !why)) {
      return {
        ok: false,
        message:
          'Fill in the lever, the change and the why before appending to the change log',
      };
    }
    const markdown = draftChangeLogEntry(compared.diff, {
      lever: lever || '<lever>',
      change: change || '<what was edited, in one or two sentences>',
      why: why || '<the failure the report showed, and why this lever>',
      runA: safeRunLogFilename(request.a),
      runB: safeRunLogFilename(request.b),
    });
    if (!request.append) return { ok: true, markdown };

    const root = this.repoRoot();
    if (!root) {
      return {
        ok: true,
        markdown,
        message:
          'No checkout found — paste the entry into docs/evals/change-log.md by hand.',
      };
    }
    const file = join(root, CHANGE_LOG_PATH);
    try {
      if (!existsSync(file)) {
        return {
          ok: true,
          markdown,
          message: `${CHANGE_LOG_PATH} not found in the checkout — paste the entry by hand.`,
        };
      }
      const updated = insertChangeLogEntry(
        readFileSync(file, 'utf8'),
        markdown,
      );
      writeFileSync(file, updated, 'utf8');
      return { ok: true, markdown, appendedTo: file };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not append to ${file}: ${reason}`);
      return {
        ok: true,
        markdown,
        message: `Could not write ${CHANGE_LOG_PATH} (${reason}) — paste the entry by hand.`,
      };
    }
  }
}
