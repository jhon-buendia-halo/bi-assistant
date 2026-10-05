import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EvalLogsService, insertChangeLogEntry } from './eval-logs.service';
import { buildLogCase, buildRunLogRecordV2 } from './eval-run-record';
import { findRepoRoot, writeRunLog } from './eval-run-log';
import type {
  EvalHarness,
  EvalRunLogAttempt,
  EvalRunStatus,
  EvalVerdict,
} from './eval-telemetry';
import { resolveEngineOptions } from '../engine/engine-options';

function attempt(verdict: EvalVerdict, index: number): EvalRunLogAttempt {
  return {
    attempt: index + 1,
    verdict,
    checks: [{ id: 'result-set-match', passed: verdict === 'PASS' }],
    sql: [{ sql: 'SELECT 1', ok: true }],
    finalSql: 'SELECT 1',
    answer: 'an answer',
    steps: 1,
    calledTools: ['run_readonly_sql'],
    repairs: [],
    warnings: [],
    durationMs: 5,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      calls: 1,
    },
  };
}

/** Write one v2 run into `dir` and return its filename. */
function logRun(
  dir: string,
  options: {
    runId: string;
    startedAt: string;
    suite?: string;
    arm?: string;
    label?: string;
    harness?: EvalHarness;
    status?: EvalRunStatus;
    cases: Record<string, EvalVerdict[]>;
  },
): string {
  const record = buildRunLogRecordV2({
    runId: options.runId,
    ...(options.label ? { label: options.label } : {}),
    harness: options.harness ?? 'in-app',
    suite: options.suite ?? 'world-cup',
    datasets: ['World Cup'],
    model: 'openai/gpt-4o-mini',
    repeat: 3,
    ...(options.arm ? { arm: options.arm } : {}),
    engine: resolveEngineOptions(),
    configHash: 'hash-abc',
    startedAt: options.startedAt,
    finishedAt: options.startedAt,
    cases: Object.entries(options.cases).map(([id, verdicts]) =>
      buildLogCase({ id, category: 'control' }, verdicts.map(attempt)),
    ),
    pricing: {},
    status: options.status ?? 'completed',
    environment: {},
  });
  const written = writeRunLog(record, dir);
  if (!written) throw new Error('could not write the fixture log');
  return written.file.split('/').pop()!;
}

describe('EvalLogsService', () => {
  let dir: string;
  let service: EvalLogsService;
  let before: string;
  let after: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eval-logs-'));
    service = new EvalLogsService({
      env: { EVAL_LOG_DIR: dir },
      repoRoot: null,
      cwd: mkdtempSync(join(tmpdir(), 'eval-logs-cwd-')),
    });
    before = logRun(dir, {
      runId: 'aaaaaaaa-before',
      startedAt: '2026-09-20T10:00:00.000Z',
      label: 'baseline',
      cases: { a: ['PASS', 'PASS', 'PASS'], b: ['PASS', 'PASS', 'PASS'] },
    });
    after = logRun(dir, {
      runId: 'bbbbbbbb-after',
      startedAt: '2026-09-21T10:00:00.000Z',
      arm: 'fixer-off',
      cases: { a: ['PASS', 'FAIL', 'PASS'], b: ['PASS', 'PASS', 'PASS'] },
    });
    logRun(dir, {
      runId: 'cccccccc-other-suite',
      startedAt: '2026-09-22T10:00:00.000Z',
      suite: 'genomics',
      cases: { g: ['FAIL', 'FAIL', 'FAIL'] },
    });
    logRun(dir, {
      runId: 'dddddddd-aborted',
      startedAt: '2026-09-23T10:00:00.000Z',
      status: 'aborted',
      cases: { a: ['FAIL', 'FAIL', 'FAIL'] },
    });
    logRun(dir, {
      runId: 'eeeeeeee-validate',
      startedAt: '2026-09-23T11:00:00.000Z',
      harness: 'validate',
      cases: { a: ['PASS'] },
    });
  });

  it('lists every run newest first, per suite, with the dirs it read', () => {
    const all = service.list();
    expect(all.dirs).toEqual([dir]);
    expect(all.logs.map((log) => log.runId)).toEqual([
      'eeeeeeee-validate',
      'dddddddd-aborted',
      'cccccccc-other-suite',
      'bbbbbbbb-after',
      'aaaaaaaa-before',
    ]);
    expect(all.logs[3]).toMatchObject({
      file: after,
      exists: true,
      schemaVersion: 2,
      repeat: 3,
      arm: 'fixer-off',
      passK: 1,
      passKRate: 0.5,
      flaky: 1,
      status: 'completed',
    });

    const genomics = service.list({ suite: 'genomics' });
    expect(genomics.logs.map((log) => log.runId)).toEqual(['cccccccc-other-suite']);
    expect(service.list({ limit: 2 }).logs).toHaveLength(2);
  });

  it('reads one run as v2, and refuses anything that is not a bare log name', () => {
    const read = service.read(before);
    expect(read).toMatchObject({
      ok: true,
      record: { schemaVersion: 2, runId: 'aaaaaaaa-before', repeat: 3 },
    });
    expect(service.read('nope.json')).toEqual({
      ok: false,
      message: 'Run log "nope.json" not found',
    });
    // A file outside logs/evals must never be reachable through the API.
    writeFileSync(join(dir, 'secret.json'), '{"runId":"x"}');
    for (const bad of ['../secret.json', 'evals/../../secret.json', '..', 'x.txt', '']) {
      expect(service.read(bad)).toEqual({
        ok: false,
        message: expect.stringContaining('is not a run-log file name'),
      });
    }
  });

  it('compares two runs: regressions, flaky changes and the Markdown', () => {
    const compared = service.compare(before, after);
    if (!compared.ok) throw new Error(compared.message);
    expect(compared.diff.regressions).toEqual(['a']);
    expect(compared.diff.flakyChanges).toEqual(['a']);
    expect(compared.diff.runBefore.runId).toBe('aaaaaaaa-before');
    expect(compared.markdown).toContain('## Regressions');
    expect(service.compare(before, 'missing.json')).toEqual({
      ok: false,
      message: 'Run log "missing.json" not found',
    });
  });

  it('trends completed agent runs oldest first, per suite and arm', () => {
    const { points } = service.trend({ suite: 'world-cup' });
    // The aborted run and the validate run would put false dips in the line.
    expect(points.map((point) => point.runId)).toEqual([
      'aaaaaaaa-before',
      'bbbbbbbb-after',
    ]);
    expect(points[1]).toMatchObject({
      file: after,
      arm: 'fixer-off',
      passKRate: 0.5,
      meanPassRate: 5 / 6,
      flaky: 1,
      gaps: 0,
      repeat: 3,
      model: 'openai/gpt-4o-mini',
      harness: 'in-app',
    });
    // A run logged without an arm ran the production defaults.
    expect(
      service.trend({ suite: 'world-cup', arm: 'baseline' }).points.map((p) => p.runId),
    ).toEqual(['aaaaaaaa-before']);
    expect(
      service.trend({ arm: 'fixer-off' }).points.map((p) => p.runId),
    ).toEqual(['bbbbbbbb-after']);
  });

  describe('change-log draft', () => {
    const body = () => ({
      a: before,
      b: after,
      lever: 'tools & guards',
      change: 'Turned the SQL fixer off.',
      why: 'The fixer rewrote filters it could not see the reason for.',
    });

    it('drafts without writing anything, and omits appendedTo', () => {
      const result = service.changelogDraft({ ...body(), append: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.markdown).toContain('- **Lever:** tools & guards');
      expect(result.markdown).toContain(`logs/evals/${before}`);
      expect('appendedTo' in result).toBe(false);
    });

    it('does not append without a checkout, and says so', () => {
      const result = service.changelogDraft({ ...body(), append: true });
      expect(result).toMatchObject({ ok: true, message: expect.stringContaining('No checkout') });
      expect('appendedTo' in result).toBe(false);
    });

    it('refuses to append a draft with placeholders', () => {
      expect(
        service.changelogDraft({ ...body(), why: ' ', append: true }),
      ).toEqual({ ok: false, message: expect.stringContaining('Fill in') });
    });

    it('inserts the entry newest-first under the rule after the template', () => {
      const root = mkdtempSync(join(tmpdir(), 'eval-logs-repo-'));
      mkdirSync(join(root, 'docs', 'evals'), { recursive: true });
      const target = join(root, 'docs', 'evals', 'change-log.md');
      // A copy of the real file, so the anchor is tested against its actual
      // structure rather than an idealised one.
      copyFileSync(join(findRepoRoot()!, 'docs', 'evals', 'change-log.md'), target);
      const original = readFileSync(target, 'utf8');

      const withCheckout = new EvalLogsService({
        env: { EVAL_LOG_DIR: dir },
        repoRoot: root,
      });
      const result = withCheckout.changelogDraft({ ...body(), append: true });
      expect(result).toMatchObject({ ok: true, appendedTo: target });
      if (!result.ok) return;

      const updated = readFileSync(target, 'utf8');
      const lines = updated.split('\n');
      const template = lines.findIndex((line) => line.startsWith('## Template'));
      const rule = lines.findIndex((line, i) => i > template && line === '---');
      const entry = lines.findIndex((line) => line === result.markdown.split('\n')[0]);
      expect(entry).toBe(rule + 2);
      // The previous newest entry now follows the new one, untouched.
      const previousTop = original
        .split('\n')
        .slice(original.split('\n').indexOf('---') + 1)
        .find((line) => line.startsWith('## '))!;
      expect(updated.indexOf(previousTop)).toBeGreaterThan(
        updated.indexOf(result.markdown.split('\n')[0]),
      );
      // Nothing above the rule moved.
      expect(updated.slice(0, updated.indexOf('\n---\n'))).toBe(
        original.slice(0, original.indexOf('\n---\n')),
      );
      expect(updated.length).toBeGreaterThan(original.length);
    });
  });
});

describe('insertChangeLogEntry', () => {
  const entry = '## 2026-09-24 — new\n\n- **Lever:** x\n';

  it('never anchors on a rule inside a fenced block', () => {
    const content = [
      '# Log',
      '',
      '## Template',
      '',
      '```markdown',
      '---',
      '## YYYY-MM-DD — example',
      '```',
      '',
      '---',
      '',
      '## 2026-09-23 — older',
      '',
    ].join('\n');
    const updated = insertChangeLogEntry(content, entry);
    expect(updated).toBe(
      [
        '# Log',
        '',
        '## Template',
        '',
        '```markdown',
        '---',
        '## YYYY-MM-DD — example',
        '```',
        '',
        '---',
        '',
        '## 2026-09-24 — new',
        '',
        '- **Lever:** x',
        '',
        '## 2026-09-23 — older',
        '',
      ].join('\n'),
    );
  });

  it('falls back to above the newest dated entry, then to the end', () => {
    expect(insertChangeLogEntry('# Log\n\n## 2026-01-01 — old\n', entry)).toBe(
      '# Log\n\n## 2026-09-24 — new\n\n- **Lever:** x\n\n## 2026-01-01 — old\n',
    );
    expect(insertChangeLogEntry('# Log\n', entry)).toBe(
      '# Log\n\n## 2026-09-24 — new\n\n- **Lever:** x\n',
    );
  });
});
