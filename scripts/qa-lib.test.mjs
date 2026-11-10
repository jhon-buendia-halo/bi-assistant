// node --test scripts/qa-lib.test.mjs (delivery.md 13, roadmap 0.4.5)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  UsageError,
  acquireLock,
  backendRelated,
  demoEvidenceProblems,
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

test('parseArgs reads the story, the mode and an optional base', () => {
  assert.deepEqual(parseArgs(['1.21.6', '--fast']), { id: '1.21.6', mode: 'fast', base: undefined });
  assert.deepEqual(parseArgs(['--gate', '0.4.5', '--base', 'abc123']), { id: '0.4.5', mode: 'gate', base: 'abc123' });
  for (const bad of [[], ['1.21.6'], ['nope', '--fast'], ['1.21.6', '--fast', '--gate'], ['1.21.6', '--fast', '--x'], ['1.21.6', '--base']]) {
    assert.throws(() => parseArgs(bad), UsageError);
  }
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
