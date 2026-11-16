// Pure logic for scripts/qa.mjs (delivery.md 13, roadmap 0.4.5): argument
// parsing, the build up-to-date decision, the step-6 list and its draft, test
// selection, report counting, tests.md and the QA locks. No process spawning
// here, so `node --test` covers it.
import fs from 'node:fs';
import path from 'node:path';

export const DEMO_MAX_BYTES = 5 * 1024 * 1024;
export const DECISIONS = ['add', 'update', 'delete', 're-run'];

export class UsageError extends Error {}

export const USAGE = [
  'Usage: node scripts/qa.mjs <roadmap-id> --fast|--gate [--base <ref>] [--rebuild] [--no-demo] [--dry-run]',
  '       node scripts/qa.mjs <roadmap-id> --draft-impact [--base <ref>] [--dry-run]',
  '       node scripts/qa.mjs --wave <id>,<id>,... [--base <ref>] [--no-demo] [--demo <id>] [--rebuild] [--dry-run]',
  '       node scripts/qa.mjs --free [--base <ref>] [--rebuild] [--dry-run]',
  '  --free          free style checks with no story: build, full unit suites, backend lint, check-specs, the --fast',
  '                  Playwright selection; reports in .qa-reports/free/, nothing under evidence/, no demo',
  '  --wave <ids>    one verification for several stories: build, related unit tests of the union of changed files,',
  '                  check-specs, the union of the touched Playwright specs, optionally one demo (--demo <id>);',
  '                  writes evidence/<id>/tests.md per story and evidence/waves/<first>...<last>.md',
  '  --fast         fast loop: build, related unit tests, check-specs, selected Playwright specs, demo',
  '  --gate          acceptance gate: build, full unit suites, lint, check-specs, the step-6 specs, tests.md',
  '  --draft-impact  write a draft evidence/<id>/e2e-impact.md from the diff (never overwrites)',
  '  --base <ref>    epic base for the diff (default: git merge-base HEAD origin/main)',
  '  --rebuild       build even when backend/dist and backend/public are up to date',
  '  --no-demo       S change: --fast writes demo.txt instead of recording; --gate skips the demo check',
  '  --dry-run       print the plan and the build decision, run nothing, write nothing',
].join('\n');

const MODES = ['fast', 'gate', 'draft-impact', 'free'];
const CHOOSE_ONE = 'Choose one of --fast, --gate, --draft-impact, --wave and --free';

/**
 * `<roadmap-id> --fast|--gate|--draft-impact [--base <ref>] [--rebuild]
 * [--no-demo] [--dry-run]` → { id, mode, base, rebuild, noDemo, dryRun }.
 */
export function parseArgs(argv) {
  let id;
  let mode;
  let base;
  let rebuild = false;
  let noDemo = false;
  let dryRun = false;
  let wave;
  let demo;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && MODES.includes(arg.slice(2))) {
      if (mode) throw new UsageError(CHOOSE_ONE);
      mode = arg.slice(2);
    } else if (arg === '--wave') {
      if (mode) throw new UsageError(CHOOSE_ONE);
      mode = 'wave';
      wave = parseWaveIds(argv[++i]);
    } else if (arg === '--demo') {
      demo = argv[++i];
      if (!demo || !/^\d+(\.\d+)+[a-z]?$/.test(demo)) throw new UsageError('--demo needs a roadmap id like 1.23.29');
    } else if (arg === '--base') {
      base = argv[++i];
      if (!base) throw new UsageError('--base needs a git ref');
    } else if (arg === '--rebuild') {
      rebuild = true;
    } else if (arg === '--no-demo') {
      noDemo = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--')) {
      throw new UsageError(`Unknown option ${arg}`);
    } else if (!id) {
      id = arg;
    } else {
      throw new UsageError(`Unexpected argument ${arg}`);
    }
  }
  if (mode === 'free') {
    if (id) throw new UsageError('--free takes no roadmap id');
    if (demo || noDemo) throw new UsageError('--free records no demo: --demo and --no-demo do not go with it');
    return { id: 'free', mode, base, rebuild, noDemo: true, dryRun };
  }
  if (mode === 'wave') {
    if (id) throw new UsageError(`--wave takes the ids as its value, not "${id}"`);
    if (demo && noDemo) throw new UsageError('--demo and --no-demo exclude each other');
    if (demo && !wave.includes(demo)) throw new UsageError(`--demo ${demo} is not one of the wave's stories`);
    return { id: waveName(wave), ids: wave, mode, base, rebuild, noDemo: !demo, demo, dryRun };
  }
  if (demo) throw new UsageError('--demo goes with --wave');
  if (!id) throw new UsageError('Missing the roadmap id');
  if (!/^\d+(\.\d+)+[a-z]?$/.test(id)) {
    throw new UsageError(`"${id}" is not a roadmap id like 1.21.6`);
  }
  if (!mode) throw new UsageError('Choose --fast, --gate, --draft-impact or --wave');
  if (mode === 'draft-impact' && (rebuild || noDemo)) {
    throw new UsageError('--rebuild and --no-demo go with --fast or --gate');
  }
  return { id, mode, base, rebuild, noDemo, dryRun };
}

/** `1.23.29,1.23.30` becomes ['1.23.29', '1.23.30'] (unique, in order). */
export function parseWaveIds(value) {
  if (!value || value.startsWith('--')) throw new UsageError('--wave needs ids like 1.23.29,1.23.30');
  const ids = value.split(',').map((x) => x.trim()).filter(Boolean);
  const bad = ids.find((x) => !/^\d+(\.\d+)+[a-z]?$/.test(x));
  if (!ids.length || bad) throw new UsageError(`"${bad ?? value}" is not a roadmap id like 1.21.6`);
  return [...new Set(ids)];
}

/** The wave's name: `<first>…<last>` (just the id for one story). */
export function waveName(ids) {
  return ids.length === 1 ? ids[0] : `${ids[0]}…${ids[ids.length - 1]}`;
}

/** Repo-relative path of the shared wave report. */
export function waveReportPath(ids) {
  return `evidence/waves/${waveName(ids)}.md`;
}

/** Every Playwright run: dot on the console, JSON and HTML reports beside the logs. */
export const PW_REPORTERS = '--reporter=dot,json,html';

/** The env that points the json and html reporters at `reportDir` (a command-line `--reporter` replaces the config's). */
export function playwrightReportEnv(reportDir) {
  return {
    QA_REPORT_DIR: reportDir,
    PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(reportDir, 'results.json'),
    PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(reportDir, 'html'),
    PLAYWRIGHT_HTML_OPEN: 'never',
  };
}

/** The union of the step-6 specs of the wave's stories (sorted, unique). */
export function waveSpecUnion(listsByStory) {
  return [...new Set(Object.values(listsByStory).flat())].sort();
}

/** The lines `--wave --dry-run` prints. */
export function renderWavePlan({ ids, base, changedCount, buildLine, parallel, specs, demo, reportPath, lane }) {
  return [
    `qa wave ${waveName(ids)} (dry run): stories ${ids.join(', ')}, base ${base}, ${changedCount} changed file(s)`,
    buildLine,
    'parallel:',
    ...parallel.map((s) => `  ${s.name}${s.solo ? ' (alone, after the others)' : ''}: ${s.command}`),
    `playwright (Postgres lane ${lane}): ${specs.length ? specs.join(' ') : '(none)'}`,
    demo ? `demo: ${demo}` : 'demo: none (--no-demo)',
    `evidence: ${ids.map((i) => `evidence/${i}/tests.md`).join(', ')} -> ${reportPath}`,
  ];
}

/** evidence/waves/<first>…<last>.md: the shared report of one wave run. */
export function renderWaveReport({ ids, date, base, steps, specs, ran, failures = [], links = [] }) {
  const ok = steps.every((s) => s.status === 'passed');
  const n = (v) => (v === undefined ? '—' : String(v));
  const out = [
    `# Wave report — ${waveName(ids)}`,
    '',
    `Written by \`node scripts/qa.mjs --wave ${ids.join(',')}\` on ${date}, base \`${base}\`. Stories: ${ids.join(', ')}. **Result: ${ok ? 'passed' : 'failed'}.**`,
    '',
    '| Step | Command | Result | Passed | Failed | Skipped |',
    '|---|---|---|---|---|---|',
    ...steps.map(
      (s) =>
        `| ${s.name} | \`${s.command.replace(/\|/g, '\\|')}\` | ${s.status} | ${n(s.counts?.passed)} | ${n(s.counts?.failed)} | ${n(s.counts?.skipped)} |`,
    ),
    '',
    '## Playwright specs (union of the stories)',
    '',
    '| Spec | Ran |',
    '|---|---|',
    ...[...new Set([...specs, ...ran])].sort().map((spec) => `| \`${spec}\` | ${ran.includes(spec) ? 'yes' : '**no**'} |`),
  ];
  if (failures.length) {
    out.push('', '## Failed tests', '');
    for (const f of failures) out.push(`- \`${f.file}\` › ${f.title}${f.video ? ` — video: \`${f.video}\`` : ''}`);
  }
  if (links.length) out.push('', '## Artifacts', '', ...links.map((l) => `- ${l}`));
  return `${out.join('\n')}\n`;
}

/** evidence/<id>/tests.md of one story of a wave: the result and a pointer to the shared report. */
export function renderWaveStoryTests({ id, ids, date, base, ok }) {
  return [
    `# Tests — ${id}`,
    '',
    `Verified in a wave on ${date}, base \`${base}\`, by \`node scripts/qa.mjs --wave ${ids.join(',')}\`. **Result: ${ok ? 'passed' : 'failed'}.**`,
    '',
    `The steps, the Playwright specs and the failures are in the shared wave report: [${waveReportPath(ids)}](../waves/${waveName(ids)}.md).`,
    '',
  ].join('\n');
}

/**
 * What `build:all` reads, relative to the repo root. Directories are walked
 * (their own mtimes count too, so a deleted or renamed file is a change).
 * The installed-dependency stamps (`node_modules/.package-lock.json`, rewritten
 * by every npm install) count as inputs. Paths that do not exist are ignored.
 */
export const BUILD_INPUTS = [
  'backend/src',
  'backend/package.json',
  'backend/package-lock.json',
  'backend/nest-cli.json',
  'backend/tsconfig.json',
  'backend/tsconfig.build.json',
  'backend/scripts/copy-web.js',
  'backend/node_modules/.package-lock.json',
  'frontend/src',
  'frontend/public',
  'frontend/package.json',
  'frontend/package-lock.json',
  'frontend/angular.json',
  'frontend/tsconfig.json',
  'frontend/tsconfig.app.json',
  'frontend/.postcssrc.json',
  'frontend/node_modules/.package-lock.json',
];

/** What `build:all` writes: the CLI the Playwright fixture starts and the web UI it serves. */
export const BUILD_OUTPUTS = ['backend/dist/cli.js', 'backend/public/index.html'];

/**
 * The newest mtime under `entries` (files, or directories walked
 * recursively, directories' own mtimes included). Returns { path, mtimeMs }
 * of the newest, or null when none exists.
 */
export function newestMtime(root, entries, fsImpl = fs) {
  let newest = null;
  const visit = (rel) => {
    let st;
    try {
      st = fsImpl.statSync(path.join(root, rel));
    } catch {
      return;
    }
    if (!newest || st.mtimeMs > newest.mtimeMs) newest = { path: toPosix(rel), mtimeMs: st.mtimeMs };
    if (st.isDirectory()) {
      for (const name of fsImpl.readdirSync(path.join(root, rel))) visit(path.join(rel, name));
    }
  };
  for (const entry of entries) visit(entry);
  return newest;
}

/**
 * Whether `build:all` must run. Conservative: it is skipped only when it is
 * not forced, the last build qa.mjs ran succeeded (`stamp`, written only on
 * success, `{ startedAt }` in ms), every output exists, and every input is
 * older than both that build's start and every output. Anything unknown
 * builds. `newestInput`: { path, mtimeMs } or null; `outputs`:
 * [{ path, mtimeMs | null }].
 */
export function buildDecision({ rebuild, stamp, newestInput, outputs }) {
  if (rebuild) return { build: true, reason: '--rebuild' };
  const missing = outputs.find((o) => o.mtimeMs == null);
  if (missing) return { build: true, reason: `${missing.path} is missing` };
  if (!stamp || !Number.isFinite(stamp.startedAt)) {
    return { build: true, reason: 'no record of a successful qa.mjs build' };
  }
  if (!newestInput) return { build: true, reason: 'no build input found' };
  const oldestOutput = outputs.reduce((a, o) => (o.mtimeMs < a.mtimeMs ? o : a));
  if (newestInput.mtimeMs >= stamp.startedAt) {
    return { build: true, reason: `${newestInput.path} changed since the last successful build` };
  }
  if (newestInput.mtimeMs >= oldestOutput.mtimeMs) {
    return { build: true, reason: `${newestInput.path} is newer than ${oldestOutput.path}` };
  }
  return { build: false, reason: 'up to date' };
}

/**
 * The Playwright specs `--fast` runs and `--draft-impact` lists: the
 * `--only-changed=<base>` list, the step-6 list, every changed
 * `frontend/e2e/*.spec.ts` and the story's demo spec.
 */
export function selectedSpecs({ onlyChanged = [], listed = [], changed = [], demo = [] }) {
  return [
    ...new Set([
      ...onlyChanged,
      ...listed,
      ...changed.map(toPosix).filter((f) => /^frontend\/e2e\/[^/]+\.spec\.ts$/.test(f)),
      ...demo,
    ]),
  ].sort();
}

/**
 * A draft evidence/<id>/e2e-impact.md (step 6), in the table format
 * parseImpact reads: every selected spec as `re-run` (or `delete` when the
 * diff removed it), scenarios `TODO: review`.
 */
export function renderDraftImpact(id, specs, { base, exists = () => true } = {}) {
  const out = [
    `# ${id} — E2E impact (step 6)`,
    '',
    `> **Draft to review.** Written by \`node scripts/qa.mjs ${id} --draft-impact\` from the diff against \`${base ?? 'the epic base'}\`. Check every decision, fill in the scenarios and add the specs the diff mapping missed (shared helpers, fixtures) before the gate.`,
    '',
    '| Spec | Decision | Scenarios |',
    '|---|---|---|',
    ...specs.map((spec) => `| \`${spec}\` | ${exists(spec) ? 're-run' : 'delete'} | TODO: review |`),
  ];
  if (!specs.length) out.push('', 'TODO: review — no related Playwright spec was found from the diff.');
  return `${out.join('\n')}\n`;
}

/**
 * The gate's demo evidence step (delivery.md 13), or null when `--no-demo`
 * skips the check (an S change; tests.md then says so).
 */
export function demoEvidenceStep(id, evidence, { noDemo = false } = {}) {
  if (noDemo) return null;
  const problems = demoEvidenceProblems(id, evidence);
  return {
    name: 'demo evidence',
    command: 'demo.webm / demo.txt and the demo artifact link',
    status: problems.length ? 'failed' : 'passed',
    exitCode: problems.length ? 1 : 0,
    summary: problems,
  };
}

export const DEMO_SKIPPED_LINE = 'Demo: skipped (--no-demo, small change)';

/**
 * The step-6 list from `evidence/<id>/e2e-impact.md`: every table row whose
 * first cell holds a backticked `frontend/e2e/*.spec.ts` path and whose second
 * cell is a decision. Other rows and text are ignored.
 */
export function parseImpact(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const spec = /`(frontend\/e2e\/[^`]+\.spec\.ts)`/.exec(cells[0])?.[1];
    const decision = cells[1].replace(/\*/g, '').trim().toLowerCase();
    if (spec && DECISIONS.includes(decision)) rows.push({ spec, decision });
  }
  return rows;
}

/** The specs the gate must run: every listed spec not marked `delete`. */
export function impactSpecs(rows) {
  return [...new Set(rows.filter((r) => r.decision !== 'delete').map((r) => r.spec))];
}

/** Changed `backend/src/**.ts` files, relative to `backend/` for Jest. */
export function backendRelated(changed) {
  return changed
    .map(toPosix)
    .filter((f) => f.startsWith('backend/src/') && f.endsWith('.ts'))
    .map((f) => f.slice('backend/'.length));
}

/**
 * Frontend unit specs to run, relative to `frontend/`: each changed
 * `frontend/src/**.spec.ts`, and the spec beside each changed source file
 * when it exists.
 */
export function frontendRelated(changed, exists = fs.existsSync, root = '.') {
  const specs = new Set();
  for (const raw of changed) {
    const f = toPosix(raw);
    if (!f.startsWith('frontend/src/')) continue;
    if (f.endsWith('.spec.ts')) {
      specs.add(f.slice('frontend/'.length));
      continue;
    }
    const sibling = f.replace(/\.(ts|html|scss)$/, '.spec.ts');
    if (sibling !== f && exists(path.join(root, sibling))) {
      specs.add(sibling.slice('frontend/'.length));
    }
  }
  return [...specs].sort();
}

/** Spec files from `playwright test --list` output (`[web] › x.spec.ts:12:5 › …`). */
export function listedSpecFiles(listOutput) {
  const files = new Set();
  for (const line of listOutput.split(/\r?\n/)) {
    const m = /›\s+([^\s:›]+\.spec\.ts):\d+:\d+/.exec(line);
    if (m) files.add(`frontend/e2e/${toPosix(m[1]).replace(/^.*e2e\//, '')}`);
  }
  return [...files].sort();
}

/** Passed / failed / skipped / flaky and the spec files run, from Playwright's JSON report. */
export function playwrightCounts(report) {
  const stats = report?.stats ?? {};
  const files = new Set();
  const walk = (suite) => {
    if (suite.file && (suite.specs?.length || suite.suites?.length)) {
      files.add(`frontend/e2e/${toPosix(suite.file).replace(/^.*e2e\//, '')}`);
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report?.suites ?? []) walk(suite);
  return {
    passed: stats.expected ?? 0,
    failed: stats.unexpected ?? 0,
    skipped: stats.skipped ?? 0,
    flaky: stats.flaky ?? 0,
    files: [...files].sort(),
  };
}

/** The failed tests of a Playwright JSON report, with the video each kept. */
export function playwrightFailures(report) {
  const failures = [];
  const walk = (suite, file) => {
    const here = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status !== 'unexpected') continue;
        const last = t.results?.[t.results.length - 1];
        const video = last?.attachments?.find((a) => a.name === 'video')?.path;
        failures.push({ file: toPosix(here ?? ''), title: spec.title, video });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report?.suites ?? []) walk(suite);
  return failures;
}

/** Passed / failed / skipped from Jest's `--json` report. */
export function jestCounts(report) {
  return {
    passed: report?.numPassedTests ?? 0,
    failed: report?.numFailedTests ?? 0,
    skipped: (report?.numPendingTests ?? 0) + (report?.numTodoTests ?? 0),
  };
}

/** Passed / failed / skipped from Karma's `TOTAL:` line, or null when absent. */
export function karmaCounts(output) {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  const lines = plain.split(/\r?\n/).filter((l) => /TOTAL:/.test(l));
  const line = lines[lines.length - 1];
  if (!line) return null;
  const failed = Number(/(\d+)\s+FAILED/.exec(line)?.[1] ?? 0);
  const passed = Number(/(\d+)\s+SUCCESS/.exec(line)?.[1] ?? 0);
  const skippedMatch = [...plain.matchAll(/skipped\s+(\d+)/gi)].pop();
  return { passed, failed, skipped: Number(skippedMatch?.[1] ?? 0) };
}

/** Listed specs that did not run (the gate fails on any). */
export function missingSpecs(listed, ran) {
  const done = new Set(ran.map(toPosix));
  return listed.filter((spec) => !done.has(toPosix(spec)));
}

/**
 * The stories marked `🚧 In progress` whose evidence folder has no demo.webm
 * or demo.txt yet: the stories a fast-loop hand-off would be missing a demo
 * for (the demo reminder hook, delivery.md 13). `roadmap` is roadmap.md or,
 * as the hook passes it, the branch's diff of it (only added `+####` lines
 * count, so stale entries elsewhere in the roadmap are ignored).
 */
export function storiesWithoutDemo(roadmap, exists) {
  const ids = [...roadmap.matchAll(/^\+?#### (\d+(?:\.\d+)+) — .*`🚧 In progress`/gmu)].map((m) => m[1]);
  return ids.filter((id) => !exists(`evidence/${id}/demo.webm`) && !exists(`evidence/${id}/demo.txt`));
}

/** A published Claude artifact link, as the demo page's URL is recorded. */
export const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/;

/**
 * Why a story cannot pass the gate without its demo (delivery.md 13): a UI
 * story (a test tagged @story-<id>) needs demo.webm, any story needs
 * demo.webm or demo.txt, and the evidence README needs the demo artifact link.
 * Returns [] when the demo evidence is complete.
 */
export function demoEvidenceProblems(id, { hasWebm, hasTxt, uiDemo, readme }) {
  const problems = [];
  if (uiDemo && !hasWebm) {
    problems.push(`No demo video: a test is tagged @story-${id} but evidence/${id}/demo.webm is missing. Run node scripts/qa.mjs ${id} --fast.`);
  } else if (!hasWebm && !hasTxt) {
    problems.push(`No demo: evidence/${id}/demo.webm or demo.txt is missing. Run node scripts/qa.mjs ${id} --fast.`);
  }
  if (!ARTIFACT_URL.test(readme ?? '')) {
    problems.push(`No demo artifact link in evidence/${id}/README.md. Run node scripts/demo-page.mjs ${id}, publish it as a Claude artifact and record its URL.`);
  }
  return problems;
}

/**
 * evidence/<id>/tests.md. `steps`: [{ name, command, status: 'passed' |
 * 'failed', counts?: { passed, failed, skipped } }].
 */
export function renderTestsMd({
  id,
  date,
  base,
  steps,
  listed,
  ran,
  missing,
  links = [],
  failures = [],
  demoSkipped = false,
}) {
  const ok = steps.every((s) => s.status === 'passed') && missing.length === 0;
  const n = (v) => (v === undefined ? '—' : String(v));
  const out = [
    `# Tests — ${id}`,
    '',
    `Written by \`node scripts/qa.mjs ${id} --gate${demoSkipped ? ' --no-demo' : ''}\` on ${date}, epic base \`${base}\`. **Result: ${ok ? 'passed' : 'failed'}.**`,
    '',
    ...(demoSkipped ? [`${DEMO_SKIPPED_LINE}.`, ''] : []),
    '| Step | Command | Result | Passed | Failed | Skipped |',
    '|---|---|---|---|---|---|',
    ...steps.map(
      (s) =>
        `| ${s.name} | \`${s.command.replace(/\|/g, '\\|')}\` | ${s.status} | ${n(s.counts?.passed)} | ${n(s.counts?.failed)} | ${n(s.counts?.skipped)} |`,
    ),
    '',
    '## Playwright specs (step 6)',
    '',
    '| Spec | Listed in step 6 | Ran |',
    '|---|---|---|',
    ...[...new Set([...listed, ...ran])].sort().map(
      (spec) =>
        `| \`${spec}\` | ${listed.includes(spec) ? 'yes' : 'no'} | ${ran.includes(spec) ? 'yes' : '**no**'} |`,
    ),
  ];
  if (missing.length) {
    out.push('', ...missing.map((spec) => `- **Listed in step 6 but not run: \`${spec}\`**`));
  }
  if (failures.length) {
    out.push('', '## Failed tests', '');
    for (const f of failures) {
      out.push(`- \`${f.file}\` › ${f.title}${f.video ? ` — video: \`${f.video}\`` : ''}`);
    }
  }
  if (links.length) {
    out.push('', '## Artifacts', '', ...links.map((l) => `- ${l}`));
  }
  return `${out.join('\n')}\n`;
}

/** evidence/<id>/demo.txt for a story with no UI: the commands and their outcome. */
export function renderDemoTxt(id, title, steps, { noDemo = false } = {}) {
  const why = noDemo
    ? 'Run with --no-demo (a small change), so the demo is this transcript of the checks scripts/qa.mjs ran.'
    : 'No UI scenario carries this story\'s tag, so the demo is this transcript of the checks scripts/qa.mjs ran.';
  const out = [`Demo — ${id}${title ? ` ${title}` : ''}`, '', why, ''];
  for (const s of steps) {
    out.push(`$ ${s.command}`, `  exit ${s.exitCode} (${s.status})`);
    for (const line of s.summary ?? []) out.push(`  ${stripAnsi(line).trim()}`);
    out.push('');
  }
  return out.join('\n');
}

/** The story's title from its `#### <id> — <title>` roadmap heading. */
export function storyTitle(roadmap, id) {
  const escaped = id.replace(/\./g, '\\.');
  const m = new RegExp(`^####\\s+${escaped}\\s+—\\s+(.+?)\\s*(?:\`[^\`]*\`)?\\s*$`, 'm').exec(roadmap);
  return m ? m[1].replace(/\s*\(\[[^\]]+\]\([^)]+\)\)\s*$/, '').trim() : undefined;
}

/**
 * Takes a lock: the shared Playwright lane (`qa.lock` in git's common dir) or
 * this checkout's run (`qa-checkout.lock` in the worktree's git dir). The
 * lock file is created exclusively; while another live run holds it, waits
 * and polls. A lock whose pid is gone is stale and removed. Returns a
 * release function.
 */
export async function acquireLock(lockPath, info, {
  label = 'the QA lane',
  isAlive = defaultIsAlive,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = (msg) => console.log(msg),
  pollMs = 2000,
  fsImpl = fs,
} = {}) {
  let announced = false;
  for (;;) {
    try {
      const fd = fsImpl.openSync(lockPath, 'wx');
      fsImpl.writeSync(fd, JSON.stringify(info));
      fsImpl.closeSync(fd);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          const held = JSON.parse(fsImpl.readFileSync(lockPath, 'utf8'));
          if (held.pid === info.pid) fsImpl.unlinkSync(lockPath);
        } catch {
          // Already gone.
        }
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let held;
    try {
      held = JSON.parse(fsImpl.readFileSync(lockPath, 'utf8'));
    } catch {
      held = undefined;
    }
    if (!held || !isAlive(held.pid)) {
      try {
        fsImpl.unlinkSync(lockPath);
      } catch {
        // Another waiter removed it first.
      }
      continue;
    }
    if (!announced) {
      log(`Waiting for ${label} (held by ${held.story}, pid ${held.pid})`);
      announced = true;
    }
    await sleep(pollMs);
  }
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Removes terminal colour codes from command output. */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

export function toPosix(p) {
  return p.replace(/\\/g, '/');
}
