// node --test scripts/qa-wave.test.mjs (roadmap 1.23.31, delivery.md 13)
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  PW_REPORTERS,
  UsageError,
  parseArgs,
  parseWaveIds,
  playwrightReportEnv,
  renderWavePlan,
  renderWaveReport,
  renderWaveStoryTests,
  waveName,
  waveReportPath,
  waveSpecUnion,
} from './qa-lib.mjs';

test('--wave parses ids, base and the demo choice', () => {
  const a = parseArgs(['--wave', '1.23.29,1.23.30', '--base', 'feat/x', '--no-demo']);
  assert.deepEqual(a, { id: '1.23.29…1.23.30', ids: ['1.23.29', '1.23.30'], mode: 'wave', base: 'feat/x', rebuild: false, noDemo: true, demo: undefined, dryRun: false });
  const b = parseArgs(['--wave', '1.1.1,1.1.2,1.1.3', '--demo', '1.1.2', '--dry-run']);
  assert.equal(b.demo, '1.1.2');
  assert.equal(b.noDemo, false);
  assert.equal(b.dryRun, true);
  assert.equal(parseArgs(['--wave', '1.1.1']).id, '1.1.1');
});

test('--wave rejects bad input', () => {
  assert.throws(() => parseArgs(['--wave']), UsageError);
  assert.throws(() => parseArgs(['--wave', '1.2.x']), UsageError);
  assert.throws(() => parseArgs(['--wave', '1.1.1', '--fast']), UsageError);
  assert.throws(() => parseArgs(['--fast', '--wave', '1.1.1']), UsageError);
  assert.throws(() => parseArgs(['--wave', '1.1.1,1.1.2', '--demo', '1.1.9']), UsageError);
  assert.throws(() => parseArgs(['--wave', '1.1.1', '--demo', '1.1.1', '--no-demo']), UsageError);
  assert.throws(() => parseArgs(['1.1.1', '--fast', '--demo', '1.1.1']), UsageError);
  assert.throws(() => parseArgs(['1.1.1', '--wave', '1.1.2']), UsageError);
});

test('wave ids are unique and keep their order', () => {
  assert.deepEqual(parseWaveIds('1.1.2,1.1.1,1.1.2'), ['1.1.2', '1.1.1']);
  assert.equal(waveName(['1.23.29', '1.23.30', '1.23.31']), '1.23.29…1.23.31');
  assert.equal(waveReportPath(['1.23.29', '1.23.31']), 'evidence/waves/1.23.29…1.23.31.md');
});

test('the spec union is sorted and unique across stories', () => {
  assert.deepEqual(
    waveSpecUnion({ '1.1.1': ['frontend/e2e/b.spec.ts', 'frontend/e2e/a.spec.ts'], '1.1.2': ['frontend/e2e/b.spec.ts'], '1.1.3': [] }),
    ['frontend/e2e/a.spec.ts', 'frontend/e2e/b.spec.ts'],
  );
});

test('every Playwright run reports dot plus json and html into the report dir', () => {
  assert.equal(PW_REPORTERS, '--reporter=dot,json,html');
  const env = playwrightReportEnv('/r/wave');
  assert.equal(env.PLAYWRIGHT_JSON_OUTPUT_NAME, path.join('/r/wave', 'results.json'));
  assert.equal(env.PLAYWRIGHT_HTML_OUTPUT_DIR, path.join('/r/wave', 'html'));
  assert.equal(env.PLAYWRIGHT_HTML_OPEN, 'never');
});

test('the dry-run plan names the steps, the specs, the demo and the evidence files', () => {
  const lines = renderWavePlan({
    ids: ['1.1.1', '1.1.2'],
    base: 'abc1234',
    changedCount: 4,
    buildLine: 'build: up to date, skipped',
    parallel: [{ name: 'check-specs', command: 'python3 scripts/check-specs.py' }, { name: 'frontend unit (related)', command: 'ng test', solo: true }],
    specs: ['frontend/e2e/a.spec.ts'],
    demo: null,
    reportPath: waveReportPath(['1.1.1', '1.1.2']),
    lane: '/g/qa.lock',
  });
  const text = lines.join('\n');
  assert.match(text, /qa wave 1\.1\.1…1\.1\.2 \(dry run\): stories 1\.1\.1, 1\.1\.2, base abc1234, 4 changed/);
  assert.match(text, /frontend unit \(related\) \(alone, after the others\): ng test/);
  assert.match(text, /frontend\/e2e\/a\.spec\.ts/);
  assert.match(text, /demo: none \(--no-demo\)/);
  assert.match(text, /evidence\/1\.1\.1\/tests\.md, evidence\/1\.1\.2\/tests\.md -> evidence\/waves\/1\.1\.1…1\.1\.2\.md/);
});

test('the wave report and each story tests.md point at each other', () => {
  const ids = ['1.1.1', '1.1.2'];
  const report = renderWaveReport({
    ids,
    date: '2026-11-11',
    base: 'abc1234',
    steps: [{ name: 'build', command: 'npm run build', status: 'passed' }, { name: 'playwright (selected)', command: 'npx playwright test', status: 'failed', counts: { passed: 1, failed: 1, skipped: 0 } }],
    specs: ['frontend/e2e/a.spec.ts'],
    ran: [],
    failures: [{ file: 'a.spec.ts', title: 'does x' }],
  });
  assert.match(report, /# Wave report — 1\.1\.1…1\.1\.2/);
  assert.match(report, /\*\*Result: failed\.\*\*/);
  assert.match(report, /\| `frontend\/e2e\/a\.spec\.ts` \| \*\*no\*\* \|/);
  assert.match(report, /a\.spec\.ts` › does x/);
  const story = renderWaveStoryTests({ id: '1.1.2', ids, date: '2026-11-11', base: 'abc1234', ok: false });
  assert.match(story, /# Tests — 1\.1\.2/);
  assert.match(story, /\[evidence\/waves\/1\.1\.1…1\.1\.2\.md\]\(\.\.\/waves\/1\.1\.1…1\.1\.2\.md\)/);
  assert.match(story, /Result: failed/);
});
