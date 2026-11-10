// Pure logic for scripts/qa.mjs (delivery.md 13, roadmap 0.4.5): argument
// parsing, the step-6 list, test selection, report counting, tests.md and the
// single QA lane lock. No process spawning here, so `node --test` covers it.
import fs from 'node:fs';
import path from 'node:path';

export const DEMO_MAX_BYTES = 5 * 1024 * 1024;
export const DECISIONS = ['add', 'update', 'delete', 're-run'];

export class UsageError extends Error {}

export const USAGE =
  'Usage: node scripts/qa.mjs <roadmap-id> --fast|--gate [--base <ref>]';

/** `<roadmap-id> --fast|--gate [--base <ref>]` → { id, mode, base }. */
export function parseArgs(argv) {
  let id;
  let mode;
  let base;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fast' || arg === '--gate') {
      if (mode) throw new UsageError('Choose one of --fast and --gate');
      mode = arg.slice(2);
    } else if (arg === '--base') {
      base = argv[++i];
      if (!base) throw new UsageError('--base needs a git ref');
    } else if (arg.startsWith('--')) {
      throw new UsageError(`Unknown option ${arg}`);
    } else if (!id) {
      id = arg;
    } else {
      throw new UsageError(`Unexpected argument ${arg}`);
    }
  }
  if (!id) throw new UsageError('Missing the roadmap id');
  if (!/^\d+(\.\d+)+$/.test(id)) {
    throw new UsageError(`"${id}" is not a roadmap id like 1.21.6`);
  }
  if (!mode) throw new UsageError('Choose --fast or --gate');
  return { id, mode, base };
}

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
}) {
  const ok = steps.every((s) => s.status === 'passed') && missing.length === 0;
  const n = (v) => (v === undefined ? '—' : String(v));
  const out = [
    `# Tests — ${id}`,
    '',
    `Written by \`node scripts/qa.mjs ${id} --gate\` on ${date}, epic base \`${base}\`. **Result: ${ok ? 'passed' : 'failed'}.**`,
    '',
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
export function renderDemoTxt(id, title, steps) {
  const out = [`Demo — ${id}${title ? ` ${title}` : ''}`, '', 'No UI scenario carries this story\'s tag, so the demo is this transcript of the checks scripts/qa.mjs ran.', ''];
  for (const s of steps) {
    out.push(`$ ${s.command}`, `  exit ${s.exitCode} (${s.status})`);
    for (const line of s.summary ?? []) out.push(`  ${line}`);
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
 * Takes the single QA lane. The lock file is created exclusively; while
 * another live run holds it, waits and polls. A lock whose pid is gone is
 * stale and removed. Returns a release function.
 */
export async function acquireLock(lockPath, info, {
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
      log(`Waiting for the QA lane (held by ${held.story}, pid ${held.pid})`);
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

export function toPosix(p) {
  return p.replace(/\\/g, '/');
}
