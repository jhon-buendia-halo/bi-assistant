#!/usr/bin/env node
// Deterministic QA for one roadmap story (delivery.md 13, roadmap 0.4.5).
//   node scripts/qa.mjs <roadmap-id> --fast|--gate [--base <ref>]
// --fast: builds, related unit tests, check-specs, selected Playwright specs,
//         then the demo (evidence/<id>/demo.webm, or demo.txt with no UI).
// --gate: builds, full unit suites, backend lint, check-specs, the step-6
//         Playwright list with JSON/HTML reporters, then evidence/<id>/tests.md.
// One run at a time: a lock in git's common dir makes it the single QA lane.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  DEMO_MAX_BYTES,
  USAGE,
  UsageError,
  acquireLock,
  backendRelated,
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
  toPosix,
} from './qa-lib.mjs';

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
  const { id, mode } = opts;
  const root = git(['rev-parse', '--show-toplevel']);
  const commonDir = path.resolve(root, git(['rev-parse', '--git-common-dir'], root));
  const base = opts.base ?? git(['merge-base', 'HEAD', 'origin/main'], root);
  const evidenceDir = path.join(root, 'evidence', id);
  const reportDir = path.join(root, 'frontend', 'test-results', 'qa', id);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(reportDir, { recursive: true });

  const release = await acquireLock(path.join(commonDir, 'qa.lock'), {
    pid: process.pid,
    story: id,
    mode,
    startedAt: new Date().toISOString(),
  });
  const onSignal = () => {
    release();
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('exit', release);

  const env = { ...process.env };
  delete env.DEMO;
  if (await portOpen(55432)) env.E2E_SKIP_DOCKER = '1';

  const steps = [];
  /** Runs one command, logs its output to the report dir, records a step. */
  const run = (name, command, cwd, { extraEnv = {}, counts } = {}) => {
    console.log(`\n▶ ${name}: ${command}`);
    const started = Date.now();
    const r = spawnSync(command, {
      cwd,
      env: { ...env, ...extraEnv },
      shell: true,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    fs.writeFileSync(path.join(reportDir, `${steps.length + 1}-${name.replace(/\W+/g, '-')}.log`), output);
    const status = r.status === 0 ? 'passed' : 'failed';
    const step = {
      name,
      command,
      exitCode: r.status ?? 1,
      status,
      output,
      seconds: Math.round((Date.now() - started) / 1000),
      summary: output.split(/\r?\n/).filter((l) => l.trim()).slice(-3),
    };
    if (counts) step.counts = counts(output) ?? undefined;
    steps.push(step);
    console.log(`  ${status} (exit ${step.exitCode}, ${step.seconds}s)`);
    return step;
  };

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
  const impactPath = path.join(evidenceDir, 'e2e-impact.md');
  const impactRows = fs.existsSync(impactPath) ? parseImpact(fs.readFileSync(impactPath, 'utf8')) : null;
  const listed = impactRows ? impactSpecs(impactRows) : [];
  const frontend = path.join(root, 'frontend');
  const backend = path.join(root, 'backend');
  const pw = 'npx playwright test --project=web';
  const relPw = (spec) => spec.replace(/^frontend\//, '');

  // The story's demo test, if a UI scenario carries its tag.
  const demoList = spawnSync(`${pw} --list --grep "@story-${id}"`, {
    cwd: frontend,
    env,
    shell: true,
    encoding: 'utf8',
  });
  const demoSpecs = listedSpecFiles(`${demoList.stdout ?? ''}`);

  run('build', 'npm --prefix backend run build:all', root);

  if (mode === 'fast') {
    const backendFiles = backendRelated(changed);
    if (backendFiles.length) {
      run('backend unit (related)', `npx jest --findRelatedTests ${backendFiles.join(' ')} --passWithNoTests`, backend);
    }
    const frontendSpecs = frontendRelated(changed, fs.existsSync, root);
    if (frontendSpecs.length) {
      run(
        'frontend unit (related)',
        `npx ng test --watch=false --browsers=ChromeHeadless ${frontendSpecs.map((s) => `--include=${s}`).join(' ')}`,
        frontend,
        { counts: karmaCounts },
      );
    }
    run('check-specs', `${pythonCommand()} scripts/check-specs.py`, root);
    const onlyChanged = spawnSync(`${pw} --list --only-changed=${base}`, {
      cwd: frontend,
      env,
      shell: true,
      encoding: 'utf8',
    });
    const selected = [
      ...new Set([
        ...listedSpecFiles(onlyChanged.stdout ?? ''),
        ...listed,
        ...changed.filter((f) => /^frontend\/e2e\/[^/]+\.spec\.ts$/.test(f)),
        ...demoSpecs,
      ]),
    ].sort();
    if (selected.length) {
      run('playwright (selected)', `${pw} ${selected.map(relPw).join(' ')}`, frontend, {
        extraEnv: { QA_REPORT_DIR: reportDir },
        counts: () => readPlaywright(reportDir)?.counts,
      });
    }

    // The demo, recorded after the checks so it shows passing behaviour.
    const failedBeforeDemo = steps.some((s) => s.status === 'failed');
    if (demoSpecs.length) {
      const videoDir = path.join(reportDir, 'demo-video');
      const demo = run('demo', `${pw} --grep "@story-${id}" --workers=1 --reporter=list`, frontend, {
        extraEnv: { DEMO: '1', DEMO_VIDEO_DIR: videoDir },
      });
      const video = newestFile(videoDir, '.webm');
      if (demo.status === 'passed' && video) {
        const dest = path.join(evidenceDir, 'demo.webm');
        fs.copyFileSync(video, dest);
        const size = fs.statSync(dest).size;
        if (size > DEMO_MAX_BYTES) {
          steps.push({ name: 'demo size', command: 'size check', status: 'failed', exitCode: 1, summary: [`${(size / 1048576).toFixed(1)} MB is over the 5 MB limit`] });
          console.log(`  demo.webm is ${(size / 1048576).toFixed(1)} MB, over the 5 MB limit`);
        } else {
          console.log(`  demo: ${path.relative(root, dest)} (${(size / 1048576).toFixed(2)} MB)`);
        }
      } else if (!video) {
        demo.status = 'failed';
        console.log('  no demo video was recorded');
      }
    } else {
      const roadmap = fs.readFileSync(path.join(root, 'roadmap.md'), 'utf8');
      fs.writeFileSync(path.join(evidenceDir, 'demo.txt'), renderDemoTxt(id, storyTitle(roadmap, id), steps));
      console.log(`  demo: ${path.relative(root, path.join(evidenceDir, 'demo.txt'))} (no UI scenario tagged @story-${id})`);
    }
    if (failedBeforeDemo) console.log('\nThe demo was recorded, but a check above failed.');
  } else {
    if (!impactRows) {
      console.log(`\nNo step-6 list at ${path.relative(root, impactPath)}: the gate cannot check which specs ran.`);
    }
    run('backend unit', `npx jest --json --outputFile=${JSON.stringify(path.join(reportDir, 'jest.json'))}`, backend, {
      counts: () => readJson(path.join(reportDir, 'jest.json'), jestCounts),
    });
    run('frontend unit', 'npx ng test --watch=false --browsers=ChromeHeadless', frontend, { counts: karmaCounts });
    run(
      'backend lint',
      'npx eslint "{src,apps,libs,test}/**/*.ts" --rule "{\\"prettier/prettier\\": [\\"error\\", {\\"endOfLine\\": \\"auto\\"}]}"',
      backend,
    );
    run('check-specs', `${pythonCommand()} scripts/check-specs.py`, root);
    let ran = [];
    let failures = [];
    if (listed.length) {
      run('playwright (step 6)', `${pw} ${listed.map(relPw).join(' ')}`, frontend, {
        extraEnv: { QA_REPORT_DIR: reportDir },
        counts: () => readPlaywright(reportDir)?.counts,
      });
      const pwReport = readPlaywright(reportDir);
      ran = pwReport?.counts.files ?? [];
      failures = pwReport?.failures ?? [];
    }
    const missing = impactRows ? missingSpecs(listed, ran) : ['(no step-6 list: evidence/' + id + '/e2e-impact.md)'];
    const links = [];
    for (const name of ['demo.webm', 'demo.txt']) {
      if (fs.existsSync(path.join(evidenceDir, name))) links.push(`[${name}](${name})`);
    }
    links.push(`Playwright report (local): \`frontend/test-results/qa/${id}/html/index.html\``);
    links.push(`Command logs (local): \`frontend/test-results/qa/${id}/\``);
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
        failures: failures.map((f) => ({ ...f, video: f.video ? toPosix(path.relative(root, f.video)) : undefined })),
      }),
    );
    for (const spec of missing) console.log(`\n✖ Listed in step 6 but not run: ${spec}`);
    console.log(`\ntests.md: ${path.relative(root, path.join(evidenceDir, 'tests.md'))}`);
    if (missing.length) steps.push({ name: 'step-6 coverage', status: 'failed' });
  }

  const failed = steps.filter((s) => s.status === 'failed');
  console.log(`\n${failed.length ? '✖' : '✔'} qa ${mode} ${id}: ${steps.length - failed.length}/${steps.length} steps passed`);
  release();
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
  console.error(err);
  process.exit(1);
});
