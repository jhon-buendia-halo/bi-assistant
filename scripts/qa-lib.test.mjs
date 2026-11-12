// node --test scripts/qa-lib.test.mjs (delivery.md 13, roadmap 0.4.5)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  BUILD_INPUTS,
  DEMO_SKIPPED_LINE,
  UsageError,
  acquireLock,
  backendRelated,
  buildDecision,
  demoEvidenceProblems,
  demoEvidenceStep,
  newestMtime,
  renderDraftImpact,
  selectedSpecs,
  storiesWithoutDemo,
  frontendRelated,
  impactSpecs,
  jestCounts,
  karmaCounts,
  listedSpecFiles,
  missingSpecs,
  parseArgs,
  parseImpact,
  playwrightCounts,
  playwrightFailures,
  renderDemoTxt,
  renderTestsMd,
  storyTitle,
} from './qa-lib.mjs';

test('parseArgs reads the story, the mode, an optional base and the flags', () => {
  const flags = { rebuild: false, noDemo: false, dryRun: false };
  assert.deepEqual(parseArgs(['1.21.6', '--fast']), { id: '1.21.6', mode: 'fast', base: undefined, ...flags });
  assert.deepEqual(parseArgs(['--gate', '0.4.5', '--base', 'abc123']), { id: '0.4.5', mode: 'gate', base: 'abc123', ...flags });
  assert.deepEqual(parseArgs(['1.21.6', '--gate', '--rebuild', '--no-demo', '--dry-run']), {
    id: '1.21.6',
    mode: 'gate',
    base: undefined,
    rebuild: true,
    noDemo: true,
    dryRun: true,
  });
  assert.deepEqual(parseArgs(['1.21.6', '--draft-impact', '--base', 'HEAD', '--dry-run']), {
    id: '1.21.6',
    mode: 'draft-impact',
    base: 'HEAD',
    rebuild: false,
    noDemo: false,
    dryRun: true,
  });
  for (const bad of [
    [],
    ['1.21.6'],
    ['nope', '--fast'],
    ['zz-test', '--draft-impact'],
    ['1.21.6', '--fast', '--gate'],
    ['1.21.6', '--gate', '--draft-impact'],
    ['1.21.6', '--fast', '--x'],
    ['1.21.6', '--base'],
    ['1.21.6', '--draft-impact', '--rebuild'],
    ['1.21.6', '--draft-impact', '--no-demo'],
  ]) {
    assert.throws(() => parseArgs(bad), UsageError, JSON.stringify(bad));
  }
});

test('parseArgs --free takes no roadmap id and no demo flags', () => {
  assert.deepEqual(parseArgs(['--free']), { id: 'free', mode: 'free', base: undefined, rebuild: false, noDemo: true, dryRun: false });
  assert.deepEqual(parseArgs(['--free', '--base', 'abc', '--rebuild', '--dry-run']), {
    id: 'free',
    mode: 'free',
    base: 'abc',
    rebuild: true,
    noDemo: true,
    dryRun: true,
  });
  assert.throws(() => parseArgs(['1.2.3', '--free']), /--free takes no roadmap id/);
  assert.throws(() => parseArgs(['--free', '1.2.3']), /--free takes no roadmap id/);
  for (const bad of [['--free', '--no-demo'], ['--free', '--demo', '1.2.3'], ['--free', '--fast'], ['--gate', '--free'], ['--free', '--wave', '1.2.3']]) {
    assert.throws(() => parseArgs(bad), UsageError, JSON.stringify(bad));
  }
  assert.throws(() => parseArgs(['--fast', '--gate', '1.2.3']), /Choose one of --fast, --gate, --draft-impact, --wave and --free/);
});

test('buildDecision skips the build only when every output is newer than every input', () => {
  const outputs = [
    { path: 'backend/dist/cli.js', mtimeMs: 2000 },
    { path: 'backend/public/index.html', mtimeMs: 2100 },
  ];
  const stamp = { startedAt: 1500 };
  const input = (mtimeMs) => ({ path: 'frontend/src/app/app.ts', mtimeMs });
  assert.deepEqual(buildDecision({ rebuild: false, stamp, newestInput: input(1000), outputs }), { build: false, reason: 'up to date' });
  // --rebuild forces it.
  assert.equal(buildDecision({ rebuild: true, stamp, newestInput: input(1000), outputs }).build, true);
  // An input edited after the outputs were written, or during the last build.
  assert.match(buildDecision({ rebuild: false, stamp, newestInput: input(1600), outputs }).reason, /changed since the last successful build/);
  assert.equal(buildDecision({ rebuild: false, stamp: { startedAt: 3000 }, newestInput: input(2050), outputs }).reason,
    'frontend/src/app/app.ts is newer than backend/dist/cli.js');
  // Equal mtimes are not "older": build.
  assert.equal(buildDecision({ rebuild: false, stamp: { startedAt: 3000 }, newestInput: input(2000), outputs }).build, true);
  // A missing output, no successful-build record or no input: build.
  assert.match(
    buildDecision({ rebuild: false, stamp, newestInput: input(1000), outputs: [outputs[0], { path: 'backend/public/index.html', mtimeMs: null }] }).reason,
    /backend\/public\/index\.html is missing/,
  );
  assert.match(buildDecision({ rebuild: false, stamp: null, newestInput: input(1000), outputs }).reason, /no record of a successful/);
  assert.equal(buildDecision({ rebuild: false, stamp: {}, newestInput: input(1000), outputs }).build, true);
  assert.equal(buildDecision({ rebuild: false, stamp, newestInput: null, outputs }).build, true);
});

test('newestMtime walks files and directories, a deletion included', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-mtime-'));
  try {
    fs.mkdirSync(path.join(dir, 'frontend/src/app'), { recursive: true });
    const at = (rel, s) => fs.utimesSync(path.join(dir, rel), s, s);
    fs.writeFileSync(path.join(dir, 'frontend/src/app/a.ts'), '');
    fs.writeFileSync(path.join(dir, 'frontend/package.json'), '{}');
    for (const rel of ['frontend/src/app/a.ts', 'frontend/src/app', 'frontend/src']) at(rel, 1000);
    at('frontend/package.json', 1200);
    assert.deepEqual(newestMtime(dir, ['frontend/src', 'frontend/package.json', 'frontend/missing.json']), {
      path: 'frontend/package.json',
      mtimeMs: 1200 * 1000,
    });
    at('frontend/src/app/a.ts', 1300);
    assert.equal(newestMtime(dir, ['frontend/src', 'frontend/package.json']).path, 'frontend/src/app/a.ts');
    // Deleting a file bumps its directory's mtime, which counts as a change.
    fs.rmSync(path.join(dir, 'frontend/src/app/a.ts'));
    assert.equal(newestMtime(dir, ['frontend/src', 'frontend/package.json']).path, 'frontend/src/app');
    assert.equal(newestMtime(dir, ['nothing']), null);
    assert.ok(BUILD_INPUTS.includes('backend/src') && BUILD_INPUTS.includes('frontend/src'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selectedSpecs and renderDraftImpact draft a step-6 list parseImpact reads back', () => {
  const specs = selectedSpecs({
    onlyChanged: ['frontend/e2e/navigation.spec.ts'],
    listed: [],
    changed: ['frontend/e2e/old.spec.ts', 'frontend/e2e/helpers/api.ts', 'frontend\\e2e\\navigation.spec.ts', 'backend/src/x.ts'],
    demo: ['frontend/e2e/synthetic-data.spec.ts'],
  });
  assert.deepEqual(specs, ['frontend/e2e/navigation.spec.ts', 'frontend/e2e/old.spec.ts', 'frontend/e2e/synthetic-data.spec.ts']);
  const md = renderDraftImpact('1.22.9', specs, { base: 'abc1234', exists: (s) => !s.endsWith('old.spec.ts') });
  assert.match(md, /^# 1\.22\.9 — E2E impact \(step 6\)\n/);
  assert.match(md, /\*\*Draft to review\.\*\* Written by `node scripts\/qa\.mjs 1\.22\.9 --draft-impact` from the diff against `abc1234`/);
  assert.match(md, /\| `frontend\/e2e\/navigation\.spec\.ts` \| re-run \| TODO: review \|/);
  assert.deepEqual(parseImpact(md), [
    { spec: 'frontend/e2e/navigation.spec.ts', decision: 're-run' },
    { spec: 'frontend/e2e/old.spec.ts', decision: 'delete' },
    { spec: 'frontend/e2e/synthetic-data.spec.ts', decision: 're-run' },
  ]);
  assert.deepEqual(impactSpecs(parseImpact(md)), ['frontend/e2e/navigation.spec.ts', 'frontend/e2e/synthetic-data.spec.ts']);
  const empty = renderDraftImpact('1.22.9', [], { base: 'abc1234' });
  assert.deepEqual(parseImpact(empty), []);
  assert.match(empty, /TODO: review — no related Playwright spec/);
});

test('--gate --no-demo skips the demo evidence check and says so in tests.md', () => {
  const missingAll = { hasWebm: false, hasTxt: false, uiDemo: true, readme: '' };
  // Without the flag the check runs and fails a story with no demo.
  const step = demoEvidenceStep('1.2.3', missingAll);
  assert.equal(step.name, 'demo evidence');
  assert.equal(step.status, 'failed');
  assert.equal(step.exitCode, 1);
  assert.equal(step.summary.length, 2);
  assert.equal(demoEvidenceStep('1.2.3', { hasWebm: true, hasTxt: false, uiDemo: true, readme: 'https://claude.ai/artifact/abc' }).status, 'passed');
  // With it there is no step to fail.
  assert.equal(demoEvidenceStep('1.2.3', missingAll, { noDemo: true }), null);
  const args = {
    id: '1.2.3',
    date: '2026-11-11',
    base: 'abc1234',
    steps: [{ name: 'backend unit', command: 'npx jest', status: 'passed' }],
    listed: [],
    ran: [],
    missing: [],
  };
  const skipped = renderTestsMd({ ...args, demoSkipped: true });
  assert.match(skipped, /`node scripts\/qa\.mjs 1\.2\.3 --gate --no-demo`/);
  assert.match(skipped, /\*\*Result: passed\.\*\*/);
  assert.ok(skipped.includes(`\n${DEMO_SKIPPED_LINE}.\n`));
  assert.equal(DEMO_SKIPPED_LINE, 'Demo: skipped (--no-demo, small change)');
  const normal = renderTestsMd(args);
  assert.doesNotMatch(normal, /Demo: skipped/);
  assert.match(normal, /`node scripts\/qa\.mjs 1\.2\.3 --gate`/);
});

test('parseImpact keeps table rows with a backticked spec and a decision', () => {
  const md = [
    '# E2E impact',
    '',
    '| Spec | Decision | Scenarios |',
    '|---|---|---|',
    '| `frontend/e2e/user-personas.spec.ts` | **add** | all |',
    '| `frontend/e2e/navigation.spec.ts` | update | Context cards |',
    '| `frontend/e2e/old.spec.ts` | delete | gone |',
    '| `frontend/e2e/layout-accessibility.spec.ts` | re-run | as is |',
    '| backend/test/app.e2e-spec.ts | add | API |',
    '| `frontend/e2e/x.spec.ts` | maybe | ignored |',
  ].join('\n');
  const rows = parseImpact(md);
  assert.deepEqual(rows.map((r) => [r.spec, r.decision]), [
    ['frontend/e2e/user-personas.spec.ts', 'add'],
    ['frontend/e2e/navigation.spec.ts', 'update'],
    ['frontend/e2e/old.spec.ts', 'delete'],
    ['frontend/e2e/layout-accessibility.spec.ts', 're-run'],
  ]);
  assert.deepEqual(impactSpecs(rows), [
    'frontend/e2e/user-personas.spec.ts',
    'frontend/e2e/navigation.spec.ts',
    'frontend/e2e/layout-accessibility.spec.ts',
  ]);
});

test('backendRelated and frontendRelated select the related unit tests', () => {
  const changed = [
    'backend/src/modules/personas/personas.service.ts',
    'backend\\src\\app.module.ts',
    'backend/test/app.e2e-spec.ts',
    'frontend/src/app/app.spec.ts',
    'frontend/src/app/features/x/x.ts',
    'frontend/src/app/features/x/x.html',
    'frontend/src/app/features/y/y.ts',
    'specs/system/delivery.md',
  ];
  assert.deepEqual(backendRelated(changed), ['src/modules/personas/personas.service.ts', 'src/app.module.ts']);
  const exists = (p) => p.replace(/\\/g, '/').endsWith('features/x/x.spec.ts');
  assert.deepEqual(frontendRelated(changed, exists), ['src/app/app.spec.ts', 'src/app/features/x/x.spec.ts']);
});

test('listedSpecFiles reads spec files from playwright --list output', () => {
  const out = [
    'Listing tests:',
    '  [web] › user-personas.spec.ts:83:3 › Feature: User personas › A new install starts with the demo persona',
    '  [web] › e2e\\navigation.spec.ts:24:5 › moves between areas from the rail',
    '  [web] › user-personas.spec.ts:115:3 › Feature: User personas › A deleted demo persona does not come back',
    'Total: 3 tests in 2 files',
  ].join('\n');
  assert.deepEqual(listedSpecFiles(out), ['frontend/e2e/navigation.spec.ts', 'frontend/e2e/user-personas.spec.ts']);
});

const PW_REPORT = {
  stats: { expected: 7, unexpected: 1, skipped: 2, flaky: 0 },
  suites: [
    {
      title: 'user-personas.spec.ts',
      file: 'user-personas.spec.ts',
      specs: [],
      suites: [
        {
          title: 'Feature: User personas',
          file: 'user-personas.spec.ts',
          specs: [
            { title: 'ok', tests: [{ status: 'expected', results: [{}] }] },
            {
              title: 'A duplicate name is refused',
              tests: [{ status: 'unexpected', results: [{ attachments: [{ name: 'video', path: 'C:\\r\\video.webm' }] }] }],
            },
          ],
        },
      ],
    },
    { title: 'navigation.spec.ts', file: 'navigation.spec.ts', specs: [{ title: 'x', tests: [{ status: 'expected' }] }] },
  ],
};

test('playwrightCounts and playwrightFailures read the JSON report', () => {
  assert.deepEqual(playwrightCounts(PW_REPORT), {
    passed: 7,
    failed: 1,
    skipped: 2,
    flaky: 0,
    files: ['frontend/e2e/navigation.spec.ts', 'frontend/e2e/user-personas.spec.ts'],
  });
  assert.deepEqual(playwrightFailures(PW_REPORT), [
    { file: 'user-personas.spec.ts', title: 'A duplicate name is refused', video: 'C:\\r\\video.webm' },
  ]);
});

test('jestCounts and karmaCounts read the unit test results', () => {
  assert.deepEqual(jestCounts({ numPassedTests: 2256, numFailedTests: 35, numPendingTests: 3, numTodoTests: 1 }), {
    passed: 2256,
    failed: 35,
    skipped: 4,
  });
  assert.deepEqual(karmaCounts('\u001b[32mTOTAL: 487 SUCCESS\u001b[39m'), { passed: 487, failed: 0, skipped: 0 });
  assert.deepEqual(
    karmaCounts('Executed 488 of 490 (1 FAILED) (skipped 2)\nTOTAL: 1 FAILED, 487 SUCCESS'),
    { passed: 487, failed: 1, skipped: 2 },
  );
  assert.equal(karmaCounts('no total here'), null);
});

test('the gate names every listed spec that did not run', () => {
  const listed = ['frontend/e2e/user-personas.spec.ts', 'frontend/e2e/navigation.spec.ts'];
  assert.deepEqual(missingSpecs(listed, ['frontend/e2e/user-personas.spec.ts']), ['frontend/e2e/navigation.spec.ts']);
  assert.deepEqual(missingSpecs(listed, listed), []);
});

test('renderTestsMd writes counts per step, the spec comparison and links', () => {
  const md = renderTestsMd({
    id: '1.21.6',
    date: '2026-11-10',
    base: 'abc1234',
    steps: [
      { name: 'backend unit', command: 'npx jest --json', status: 'passed', counts: { passed: 10, failed: 0, skipped: 1 } },
      { name: 'playwright (step 6)', command: 'npx playwright test', status: 'failed', counts: { passed: 7, failed: 1, skipped: 2 } },
      { name: 'check-specs', command: 'py -3 scripts/check-specs.py', status: 'passed' },
    ],
    listed: ['frontend/e2e/user-personas.spec.ts', 'frontend/e2e/navigation.spec.ts'],
    ran: ['frontend/e2e/user-personas.spec.ts'],
    missing: ['frontend/e2e/navigation.spec.ts'],
    links: ['[demo.webm](demo.webm)'],
    failures: [{ file: 'user-personas.spec.ts', title: 'A duplicate name is refused', video: 'frontend/test-results/v.webm' }],
  });
  assert.match(md, /\*\*Result: failed\.\*\*/);
  assert.match(md, /\| backend unit \| `npx jest --json` \| passed \| 10 \| 0 \| 1 \|/);
  assert.match(md, /\| playwright \(step 6\) \| `npx playwright test` \| failed \| 7 \| 1 \| 2 \|/);
  assert.match(md, /\| check-specs \| `py -3 scripts\/check-specs\.py` \| passed \| — \| — \| — \|/);
  assert.match(md, /\| `frontend\/e2e\/navigation\.spec\.ts` \| yes \| \*\*no\*\* \|/);
  assert.match(md, /Listed in step 6 but not run: `frontend\/e2e\/navigation\.spec\.ts`/);
  assert.match(md, /A duplicate name is refused — video: `frontend\/test-results\/v\.webm`/);
  assert.match(md, /\[demo\.webm\]\(demo\.webm\)/);
});

test('renderDemoTxt and storyTitle describe a story with no UI', () => {
  const roadmap = '#### 0.4.5 — Deterministic QA: impacted tests, demo video, test-run evidence  `🚧 In progress`\n';
  assert.equal(storyTitle(roadmap, '0.4.5'), 'Deterministic QA: impacted tests, demo video, test-run evidence');
  assert.equal(
    storyTitle('#### 1.21.1 — Empty Questions to Insights v2 agent ([BA-321](https://x/BA-321))  `✅ Done`', '1.21.1'),
    'Empty Questions to Insights v2 agent',
  );
  const txt = renderDemoTxt('0.4.5', 'Deterministic QA', [
    { command: 'node --test scripts/qa-lib.test.mjs', exitCode: 0, status: 'passed', summary: ['# pass 9'] },
  ]);
  assert.match(txt, /\$ node --test scripts\/qa-lib\.test\.mjs\n {2}exit 0 \(passed\)\n {2}# pass 9/);
  // Terminal colour codes are stripped from the transcript.
  const colored = renderDemoTxt('0.4.5', 'x', [
    { command: 'npm run build', exitCode: 0, status: 'passed', summary: ['\u001b[33m▲ \u001b[1mWARNING\u001b[0m budget'] },
  ]);
  assert.match(colored, / {2}▲ WARNING budget/);
  assert.doesNotMatch(colored, /\u001b/);
  // --fast --no-demo: the transcript says why there is no video.
  assert.match(renderDemoTxt('0.4.5', 'x', [], { noDemo: true }), /Run with --no-demo \(a small change\)/);
});

test('acquireLock makes runs wait their turn and clears a stale lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-lock-'));
  const lock = path.join(dir, 'qa.lock');
  try {
    // A live holder: the second run waits, then gets the lane once it is released.
    const releaseFirst = await acquireLock(lock, { pid: 111, story: '1.21.6' }, { isAlive: () => true, log: () => {} });
    const messages = [];
    let sleeps = 0;
    const second = acquireLock(lock, { pid: 222, story: '0.4.5' }, {
      isAlive: () => true,
      log: (m) => messages.push(m),
      sleep: async () => {
        sleeps++;
        if (sleeps === 2) releaseFirst();
      },
      pollMs: 1,
    });
    const releaseSecond = await second;
    assert.deepEqual(messages, ['Waiting for the QA lane (held by 1.21.6, pid 111)']);
    assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).pid, 222);
    releaseSecond();
    assert.equal(fs.existsSync(lock), false);

    // A dead holder's lock is stale and taken over at once.
    fs.writeFileSync(lock, JSON.stringify({ pid: 999999, story: 'old' }));
    const release = await acquireLock(lock, { pid: 333, story: '1.21.6' }, { isAlive: (pid) => pid !== 999999, log: () => {} });
    assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).pid, 333);
    release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('demoEvidenceProblems fails a story without its demo or artifact link', () => {
  const link = 'Demo artifact: https://claude.ai/artifact/SPwXiaHjCn6NQL92pzbN1d';
  assert.deepEqual(demoEvidenceProblems('1.2.3', { hasWebm: true, hasTxt: false, uiDemo: true, readme: link }), []);
  assert.deepEqual(demoEvidenceProblems('1.2.3', { hasWebm: false, hasTxt: true, uiDemo: false, readme: link }), []);
  const noVideo = demoEvidenceProblems('1.2.3', { hasWebm: false, hasTxt: true, uiDemo: true, readme: link });
  assert.equal(noVideo.length, 1);
  assert.match(noVideo[0], /No demo video: a test is tagged @story-1\.2\.3/);
  const nothing = demoEvidenceProblems('1.2.3', { hasWebm: false, hasTxt: false, uiDemo: false, readme: '' });
  assert.equal(nothing.length, 2);
  assert.match(nothing[0], /^No demo: /);
  assert.match(nothing[1], /No demo artifact link in evidence\/1\.2\.3\/README\.md/);
  assert.equal(demoEvidenceProblems('1.2.3', { hasWebm: true, hasTxt: false, uiDemo: true, readme: 'Demo artifact: <TBD>' }).length, 1);
});

test('storiesWithoutDemo lists in-progress stories that have no demo yet', () => {
  const roadmap = [
    '#### 1.21.11 — Ontologies on the Context page  `✅ Done`',
    '#### 1.21.12 — Visuals library on the Context page  `🚧 In progress`',
    '#### 1.21.13 — Something else  `🚧 In progress`',
    '#### 0.4.6 — A tool story  `🚧 In progress`',
  ].join('\n');
  const files = new Set(['evidence/1.21.12/demo.webm', 'evidence/0.4.6/demo.txt']);
  assert.deepEqual(storiesWithoutDemo(roadmap, (f) => files.has(f)), ['1.21.13']);
  assert.deepEqual(storiesWithoutDemo(roadmap, () => false), ['1.21.12', '1.21.13', '0.4.6']);
});
