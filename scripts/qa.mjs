#!/usr/bin/env node
// Deterministic QA for one roadmap story (delivery.md 13, roadmap 0.4.5).
//   node scripts/qa.mjs <roadmap-id> --fast|--gate [--base <ref>] [--rebuild] [--no-demo] [--dry-run]
//   node scripts/qa.mjs <roadmap-id> --draft-impact [--base <ref>] [--dry-run]
// --fast: builds, then related unit tests and check-specs in parallel, the
//         selected Playwright specs, then the demo (evidence/<id>/demo.webm,
//         or demo.txt with no UI or with --no-demo).
// --gate: builds, then the full unit suites, backend lint and check-specs in
//         parallel, the step-6 Playwright list with JSON/HTML reporters, then
//         evidence/<id>/tests.md (--no-demo skips the demo evidence check).
// --draft-impact: writes a draft evidence/<id>/e2e-impact.md from the diff,
//         with the --fast spec selection; never overwrites.
// The build is skipped when backend/dist and backend/public are newer than
// every input and the last qa.mjs build succeeded (--rebuild forces it).
// --dry-run prints the plan and the build decision and runs nothing.
// Locks: one run per checkout (qa-checkout.lock in the worktree's git dir,
// whole run); one Playwright phase across worktrees (qa.lock in git's common
// dir), because every worktree's E2E shares the Postgres on 55432.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  BUILD_INPUTS,
  BUILD_OUTPUTS,
  DEMO_MAX_BYTES,
  DEMO_SKIPPED_LINE,
  PW_REPORTERS,
  USAGE,
  UsageError,
  acquireLock,
  backendRelated,
  buildDecision,
  demoEvidenceStep,
  frontendRelated,
  impactSpecs,
  jestCounts,
  karmaCounts,
  listedSpecFiles,
  missingSpecs,
  newestMtime,
  parseArgs,
  parseImpact,
  playwrightCounts,
  playwrightFailures,
  playwrightReportEnv,
  renderDemoTxt,
  renderDraftImpact,
  renderTestsMd,
  renderWavePlan,
  renderWaveReport,
  renderWaveStoryTests,
  selectedSpecs,
  storyTitle,
  toPosix,
  waveReportPath,
  waveSpecUnion,
} from './qa-lib.mjs';
import { ARCHIVE_FILE, BACKLOG_FILE, joinRoadmaps } from './roadmap-archive-lib.mjs';

// roadmap.md and roadmap-archive.md together: an archived story is still found (roadmap 1.23.30).
const readRoadmaps = (root) =>
  joinRoadmaps(...['roadmap.md', ARCHIVE_FILE, BACKLOG_FILE].map((f) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : null)));

const IS_WIN = process.platform === 'win32';

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function pythonCommand() {
  for (const candidate of IS_WIN ? ['py -3', 'python', 'python3'] : ['python3', 'python']) {
    const [exe, ...args] = candidate.split(' ');
    const r = spawnSync(exe, [...args, '--version'], { encoding: 'utf8' });
    if (r.status === 0) return candidate;
  }
  return 'python3';
}

/** Child processes still running, killed (with their trees) on Ctrl+C. */
const children = new Set();

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

/** Runs a shell command, resolving with its exit code and combined output. */
function exec(command, cwd, env) {
  return new Promise((resolve) => {
    // POSIX: its own process group, so Ctrl+C can stop the whole tree.
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !IS_WIN,
      windowsHide: true,
    });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.once('error', (err) => {
      stderr += String(err);
    });
    child.once('close', (code) => {
      children.delete(child);
      resolve({ status: code, output: `${stdout}${stderr}` });
    });
  });
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n${USAGE}`);
      process.exit(2);
    }
    throw err;
  }
  const { id, mode, rebuild, noDemo, dryRun } = opts;
  const wave = mode === 'wave';
  const ids = opts.ids ?? [id];
  // A wave runs the fast loop's steps once for several stories; its one demo is `--demo <id>`.
  const demoId = wave ? opts.demo : id;
  const fastLike = mode === 'fast' || wave;
  const root = git(['rev-parse', '--show-toplevel']);
  const commonDir = path.resolve(root, git(['rev-parse', '--git-common-dir'], root));
  const gitDir = git(['rev-parse', '--absolute-git-dir'], root);
  const base = opts.base ?? git(['merge-base', 'HEAD', 'origin/main'], root);
  const evidenceDir = path.join(root, 'evidence', wave ? 'waves' : id);
  // Outside frontend/test-results, which Playwright empties at the start of
  // every run (it is its outputDir); git-ignored (delivery.md 13).
  const reportsRoot = path.join(root, '.qa-reports');
  const reportDir = path.join(reportsRoot, wave ? `wave-${ids[0]}-${ids[ids.length - 1]}` : id);
  const buildStampPath = path.join(reportsRoot, 'build-stamp.json');
  const impactPath = path.join(evidenceDir, 'e2e-impact.md');
  const frontend = path.join(root, 'frontend');
  const backend = path.join(root, 'backend');
  const pw = 'npx playwright test --project=web';
  const relPw = (spec) => spec.replace(/^frontend\//, '');
  const rel = (p) => toPosix(path.relative(root, p));

  // --draft-impact never overwrites a reviewed (or drafted) list.
  if (mode === 'draft-impact' && fs.existsSync(impactPath)) {
    console.log(`${rel(impactPath)} already exists; not overwritten. Edit it, or delete it to draft again.`);
    process.exit(0);
  }

  const env = { ...process.env };
  delete env.DEMO;
  if (await portOpen(55432)) env.E2E_SKIP_DOCKER = '1';

  const changed = [
    ...new Set(
      [
        ...git(['diff', '--name-only', base], root).split('\n'),
        ...git(['ls-files', '--others', '--exclude-standard'], root).split('\n'),
      ]
        .map((f) => toPosix(f.trim()))
        .filter(Boolean),
    ),
  ];
  const impactRows = fs.existsSync(impactPath) ? parseImpact(fs.readFileSync(impactPath, 'utf8')) : null;
  const storyList = (storyId) => {
    const file = path.join(root, 'evidence', storyId, 'e2e-impact.md');
    return fs.existsSync(file) ? impactSpecs(parseImpact(fs.readFileSync(file, 'utf8'))) : [];
  };
  // A wave unites the step-6 lists of its stories.
  const listed = wave ? waveSpecUnion(Object.fromEntries(ids.map((i) => [i, storyList(i)]))) : impactRows ? impactSpecs(impactRows) : [];

  // `playwright test --list` runs no global setup and starts no app: no lock needed.
  const pwList = (args) =>
    listedSpecFiles(spawnSync(`${pw} --list ${args}`, { cwd: frontend, env, shell: true, encoding: 'utf8' }).stdout ?? '');
  // The story's demo test, if a UI scenario carries its tag.
  const demoSpecs = demoId ? pwList(`--grep "@story-${demoId}"`) : [];
  const fastSelection = () =>
    selectedSpecs({ onlyChanged: pwList(`--only-changed=${base}`), listed, changed, demo: demoSpecs });

  if (mode === 'draft-impact') {
    const specs = fastSelection();
    const draft = renderDraftImpact(id, specs, {
      base: git(['rev-parse', '--short=7', base], root),
      exists: (spec) => fs.existsSync(path.join(root, spec)),
    });
    if (dryRun) {
      console.log(`Would write ${rel(impactPath)}:\n\n${draft}`);
    } else {
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(impactPath, draft);
      console.log(`Drafted ${rel(impactPath)} (${specs.length} spec${specs.length === 1 ? '' : 's'}): review it before the gate.`);
    }
    process.exit(0);
  }

  const decideBuild = () => {
    let stamp = null;
    try {
      stamp = JSON.parse(fs.readFileSync(buildStampPath, 'utf8'));
    } catch {
      stamp = null;
    }
    return buildDecision({
      rebuild,
      stamp,
      newestInput: newestMtime(root, BUILD_INPUTS),
      outputs: BUILD_OUTPUTS.map((p) => {
        try {
          return { path: p, mtimeMs: fs.statSync(path.join(root, p)).mtimeMs };
        } catch {
          return { path: p, mtimeMs: null };
        }
      }),
    });
  };
  const buildLine = (d) => (d.build ? `build: will run (${d.reason})` : 'build: up to date, skipped (pass --rebuild to force)');

  const jest = 'npx jest';
  const ngTest = 'npx ng test --watch=false --browsers=ChromeHeadless';
  /**
   * The steps between the build and Playwright. They run in parallel, except
   * the `solo` ones: Karma's browser tests are timing-sensitive and leaked
   * HTTP requests under the CPU load of Jest and ESLint (3 of 5 gate runs on
   * 2026-11-11, 0 of 4 alone), so they run alone after the others.
   */
  const parallelPlan = () => {
    if (fastLike) {
      const plan = [];
      const backendFiles = backendRelated(changed);
      if (backendFiles.length) {
        plan.push({ name: 'backend unit (related)', command: `${jest} --findRelatedTests ${backendFiles.join(' ')} --passWithNoTests`, cwd: backend });
      }
      const frontendSpecs = frontendRelated(changed, fs.existsSync, root);
      if (frontendSpecs.length) {
        plan.push({
          name: 'frontend unit (related)',
          command: `${ngTest} ${frontendSpecs.map((s) => `--include=${s}`).join(' ')}`,
          cwd: frontend,
          counts: karmaCounts,
          solo: true,
        });
      }
      plan.push({ name: 'check-specs', command: `${pythonCommand()} scripts/check-specs.py`, cwd: root });
      return plan;
    }
    return [
      {
        name: 'backend unit',
        command: `${jest} --json --outputFile=${JSON.stringify(path.join(reportDir, 'jest.json'))}`,
        cwd: backend,
        counts: () => readJson(path.join(reportDir, 'jest.json'), jestCounts),
      },
      { name: 'frontend unit', command: ngTest, cwd: frontend, counts: karmaCounts, solo: true },
      {
        name: 'backend lint',
        command: 'npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\\"prettier/prettier\\": [\\"error\\", {\\"endOfLine\\": \\"auto\\"}]}"',
        cwd: backend,
      },
      { name: 'check-specs', command: `${pythonCommand()} scripts/check-specs.py`, cwd: root },
    ];
  };

  if (dryRun) {
    const decision = decideBuild();
    if (wave) {
      const lines = renderWavePlan({
        ids,
        base: git(['rev-parse', '--short=7', base], root),
        changedCount: changed.length,
        buildLine: [buildLine(decision), ...(decision.build ? ['  npm --prefix backend run build:all'] : [])].join('\n'),
        parallel: parallelPlan(),
        specs: fastSelection(),
        demo: demoId ? (demoSpecs.length ? `demo.webm of ${demoId} from ${demoSpecs.join(' ')}` : `demo.txt of ${demoId} (no UI scenario tagged)`) : null,
        reportPath: waveReportPath(ids),
        lane: path.join(commonDir, 'qa.lock'),
      });
      console.log(lines.join('\n'));
      process.exit(0);
    }
    console.log(`qa ${mode} ${id} (dry run): base ${git(['rev-parse', '--short=7', base], root)}, ${changed.length} changed file(s)`);
    console.log(buildLine(decision));
    if (decision.build) console.log('  npm --prefix backend run build:all');
    console.log('parallel:');
    for (const s of parallelPlan()) console.log(`  ${s.name}${s.solo ? ' (alone, after the others)' : ''}: ${s.command}`);
    const specs = fastLike ? fastSelection() : listed;
    console.log(`playwright (Postgres lane ${path.join(commonDir, 'qa.lock')}): ${specs.length ? specs.join(' ') : '(none)'}`);
    if (fastLike) {
      console.log(`demo: ${noDemo ? `demo.txt (--no-demo)` : demoSpecs.length ? `demo.webm from ${demoSpecs.join(' ')}` : 'demo.txt (no UI scenario tagged)'}`);
    } else {
      if (!impactRows) console.log(`step-6 list missing: ${rel(impactPath)}`);
      console.log(noDemo ? DEMO_SKIPPED_LINE : 'demo evidence: checked');
    }
    process.exit(0);
  }

  // One run per checkout: runs in the same worktree share its backend/dist,
  // backend/public, frontend/test-results and .qa-reports.
  const releaseCheckout = await acquireLock(
    path.join(gitDir, 'qa-checkout.lock'),
    { pid: process.pid, story: id, mode, startedAt: new Date().toISOString() },
    { label: "this checkout's QA run" },
  );
  let releaseLane = () => {};
  const releaseAll = () => {
    releaseLane();
    releaseCheckout();
  };
  const onSignal = () => {
    for (const child of children) killTree(child);
    releaseAll();
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('exit', releaseAll);
  // Only once the checkout is ours: a waiting run must not touch its folders.
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(reportDir, { recursive: true });

  const steps = [];
  let logIndex = 0;
  /**
   * Runs one command, logs its output to the report dir and returns its
   * step. Log numbers follow the order the steps are declared in.
   */
  const runStep = async ({ name, command, cwd, extraEnv = {}, counts }, { quiet = false } = {}) => {
    const logPath = path.join(reportDir, `${++logIndex}-${name.replace(/\W+/g, '-')}.log`);
    const started = Date.now();
    const r = await exec(command, cwd, { ...env, ...extraEnv });
    fs.writeFileSync(logPath, r.output);
    const step = {
      name,
      command,
      exitCode: r.status ?? 1,
      status: r.status === 0 ? 'passed' : 'failed',
      output: r.output,
      seconds: Math.round((Date.now() - started) / 1000),
      summary: r.output.split(/\r?\n/).filter((l) => l.trim()).slice(-3),
    };
    if (counts) step.counts = counts(r.output) ?? undefined;
    // One line per step (the child's output is in its log); only a failure prints the log's last lines.
    // `quiet` steps run in parallel, so each prints once, when it finishes.
    const tail = step.status === 'failed' ? `\n${r.output.split(/\r?\n/).slice(-30).join('\n')}` : '';
    console.log(`${step.status === 'passed' ? '✔' : '✖'} ${name}: ${step.status} (exit ${step.exitCode}, ${step.seconds}s), log ${rel(logPath)}${tail}`);
    return step;
  };
  const run = async (spec) => {
    const step = await runStep(spec);
    steps.push(step);
    return step;
  };
  /**
   * Runs independent steps concurrently, then the `solo` ones one at a time;
   * records them in declared order.
   */
  const runParallel = async (plan) => {
    const together = plan.filter((s) => !s.solo);
    const results = new Map();
    if (together.length) {
      const done = await Promise.all(together.map((s) => runStep(s, { quiet: true })));
      together.forEach((s, i) => results.set(s, done[i]));
    }
    for (const s of plan.filter((p) => p.solo)) results.set(s, await runStep(s, { quiet: true }));
    const done = plan.map((s) => results.get(s));
    steps.push(...done);
    return done;
  };
  /**
   * Takes the cross-worktree Playwright lane: the E2E global setup may start
   * the one compose Postgres on 55432 and the specs create and drop
   * databases on it.
   */
  const takeLane = async () => {
    releaseLane = await acquireLock(path.join(commonDir, 'qa.lock'), {
      pid: process.pid,
      story: id,
      mode,
      startedAt: new Date().toISOString(),
    });
    // Another run may have started Postgres while this one waited.
    if (await portOpen(55432)) env.E2E_SKIP_DOCKER = '1';
  };
  const leaveLane = () => {
    releaseLane();
    releaseLane = () => {};
  };

  const decision = decideBuild();
  console.log(`\n${buildLine(decision)}`);
  if (decision.build) {
    fs.rmSync(buildStampPath, { force: true });
    const startedAt = Date.now();
    const build = await run({ name: 'build', command: 'npm --prefix backend run build:all', cwd: root });
    if (build.status === 'passed') fs.writeFileSync(buildStampPath, JSON.stringify({ startedAt, base }));
  } else {
    // Recorded so tests.md and demo.txt show the build was checked, not forgotten.
    steps.push({
      name: 'build',
      command: 'npm --prefix backend run build:all (up to date, skipped)',
      exitCode: 0,
      status: 'passed',
      summary: ['build: up to date, skipped (pass --rebuild to force)'],
    });
  }

  if (fastLike) {
    await runParallel(parallelPlan());
    const selected = fastSelection();
    if (selected.length || (!noDemo && demoSpecs.length)) await takeLane();
    if (selected.length) {
      await run({
        name: 'playwright (selected)',
        command: `${pw} ${selected.map(relPw).join(' ')} ${PW_REPORTERS}`,
        cwd: frontend,
        extraEnv: playwrightReportEnv(reportDir),
        counts: () => readPlaywright(reportDir)?.counts,
      });
    }

    // The demo, recorded after the checks so it shows passing behaviour.
    const failedBeforeDemo = steps.some((s) => s.status === 'failed');
    const demoDir = path.join(root, 'evidence', demoId ?? id);
    fs.mkdirSync(demoDir, { recursive: true });
    if (wave && !demoId) {
      leaveLane();
    } else if (noDemo) {
      leaveLane();
      const roadmap = readRoadmaps(root);
      fs.writeFileSync(path.join(demoDir, 'demo.txt'), renderDemoTxt(demoId, storyTitle(roadmap, demoId), steps, { noDemo: true }));
      console.log(`  demo: ${rel(path.join(demoDir, 'demo.txt'))} (--no-demo, no video recorded)`);
    } else if (demoSpecs.length) {
      const videoDir = path.join(reportDir, 'demo-video');
      const demo = await run({
        name: 'demo',
        command: `${pw} --grep "@story-${demoId}" --workers=1 --reporter=dot`,
        cwd: frontend,
        extraEnv: { DEMO: '1', DEMO_VIDEO_DIR: videoDir },
      });
      leaveLane();
      const video = newestFile(videoDir, '.webm');
      if (demo.status === 'passed' && video) {
        const dest = path.join(demoDir, 'demo.webm');
        fs.copyFileSync(video, dest);
        const size = fs.statSync(dest).size;
        if (size > DEMO_MAX_BYTES) {
          steps.push({ name: 'demo size', command: 'size check', status: 'failed', exitCode: 1, summary: [`${(size / 1048576).toFixed(1)} MB is over the 5 MB limit`] });
          console.log(`  demo.webm is ${(size / 1048576).toFixed(1)} MB, over the 5 MB limit`);
        } else {
          console.log(`  demo: ${rel(dest)} (${(size / 1048576).toFixed(2)} MB)`);
        }
      } else if (!video) {
        demo.status = 'failed';
        console.log('  no demo video was recorded');
      }
    } else {
      leaveLane();
      const roadmap = readRoadmaps(root);
      fs.writeFileSync(path.join(demoDir, 'demo.txt'), renderDemoTxt(demoId, storyTitle(roadmap, demoId), steps));
      console.log(`  demo: ${rel(path.join(demoDir, 'demo.txt'))} (no UI scenario tagged @story-${demoId})`);
    }
    if (failedBeforeDemo && !(wave && !demoId)) console.log('\nThe demo was recorded, but a check above failed.');
    if (wave) {
      // One shared report; each story's tests.md points to it.
      const pwReport = readPlaywright(reportDir);
      const date = new Date().toISOString().slice(0, 10);
      const shortBase = base.slice(0, 7);
      const ok = steps.every((s) => s.status === 'passed');
      const reportFile = path.join(root, waveReportPath(ids));
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(
        reportFile,
        renderWaveReport({
          ids,
          date,
          base: shortBase,
          steps,
          specs: selected,
          ran: pwReport?.counts.files ?? [],
          failures: (pwReport?.failures ?? []).map((f) => ({ ...f, video: f.video ? rel(f.video) : undefined })),
          links: [`Playwright report (local): \`.qa-reports/${path.basename(reportDir)}/html/index.html\``, `Command logs and reports (local): \`.qa-reports/${path.basename(reportDir)}/\``],
        }),
      );
      for (const storyId of ids) {
        fs.mkdirSync(path.join(root, 'evidence', storyId), { recursive: true });
        fs.writeFileSync(path.join(root, 'evidence', storyId, 'tests.md'), renderWaveStoryTests({ id: storyId, ids, date, base: shortBase, ok }));
      }
      console.log(`\nwave report: ${waveReportPath(ids)}`);
    }
  } else {
    if (!impactRows) {
      console.log(`\nNo step-6 list at ${rel(impactPath)}: the gate cannot check which specs ran.`);
    }
    await runParallel(parallelPlan());
    let ran = [];
    let failures = [];
    if (listed.length) {
      await takeLane();
      await run({
        name: 'playwright (step 6)',
        command: `${pw} ${listed.map(relPw).join(' ')} ${PW_REPORTERS}`,
        cwd: frontend,
        extraEnv: playwrightReportEnv(reportDir),
        counts: () => readPlaywright(reportDir)?.counts,
      });
      leaveLane();
      const pwReport = readPlaywright(reportDir);
      ran = pwReport?.counts.files ?? [];
      failures = pwReport?.failures ?? [];
    }
    const missing = impactRows ? missingSpecs(listed, ran) : ['(no step-6 list: evidence/' + id + '/e2e-impact.md)'];
    // The demo is part of the story's evidence: no video or artifact link, no
    // pass, unless --no-demo marks an S change with no demo.
    const readmePath = path.join(evidenceDir, 'README.md');
    const demoStep = demoEvidenceStep(
      id,
      {
        hasWebm: fs.existsSync(path.join(evidenceDir, 'demo.webm')),
        hasTxt: fs.existsSync(path.join(evidenceDir, 'demo.txt')),
        uiDemo: demoSpecs.length > 0,
        readme: fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '',
      },
      { noDemo },
    );
    if (demoStep) {
      steps.push(demoStep);
      console.log(`▶ demo evidence\n  ${demoStep.summary.length ? demoStep.summary.join('\n  ') : 'passed'}`);
    } else {
      console.log(`▶ ${DEMO_SKIPPED_LINE}`);
    }
    const links = [];
    for (const name of ['demo.webm', 'demo.txt']) {
      if (fs.existsSync(path.join(evidenceDir, name))) links.push(`[${name}](${name})`);
    }
    links.push(`Playwright report (local): \`.qa-reports/${id}/html/index.html\``);
    links.push(`Command logs and reports (local): \`.qa-reports/${id}/\``);
    fs.writeFileSync(
      path.join(evidenceDir, 'tests.md'),
      renderTestsMd({
        id,
        date: new Date().toISOString().slice(0, 10),
        base: base.slice(0, 7),
        steps,
        listed,
        ran,
        missing,
        links,
        failures: failures.map((f) => ({ ...f, video: f.video ? rel(f.video) : undefined })),
        demoSkipped: noDemo,
      }),
    );
    for (const spec of missing) console.log(`\n✖ Listed in step 6 but not run: ${spec}`);
    console.log(`\ntests.md: ${rel(path.join(evidenceDir, 'tests.md'))}`);
    if (missing.length) steps.push({ name: 'step-6 coverage', status: 'failed' });
  }

  const failed = steps.filter((s) => s.status === 'failed');
  console.log(`\n${failed.length ? '✖' : '✔'} qa ${mode} ${id}: ${steps.length - failed.length}/${steps.length} steps passed`);
  releaseAll();
  process.exit(failed.length ? 1 : 0);
}

function readJson(file, map) {
  try {
    return map(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}

function readPlaywright(dir) {
  return readJson(path.join(dir, 'results.json'), (report) => ({
    counts: playwrightCounts(report),
    failures: playwrightFailures(report),
  }));
}

function newestFile(dir, ext) {
  if (!fs.existsSync(dir)) return undefined;
  const files = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith(ext)) files.push({ p, t: fs.statSync(p).mtimeMs });
    }
  };
  walk(dir);
  return files.sort((a, b) => b.t - a.t)[0]?.p;
}

main().catch((err) => {
  for (const child of children) killTree(child);
  console.error(err);
  process.exit(1);
});
