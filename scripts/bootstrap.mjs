#!/usr/bin/env node
// Make a fresh checkout or worktree ready to build, test and run (roadmap 0.5.5,
// delivery.md 2). No dependencies: Node 22+ only.
//
//   node scripts/bootstrap.mjs [--force] [--no-build] [--no-playwright]
//
// 1. Installs backend/ and frontend/ from their lockfiles (`npm ci`, both at
//    once), skipped for a package whose node_modules is newer than its lockfile
//    unless --force.
// 2. Installs Playwright's Chromium (cached per machine), unless --no-playwright.
// 3. Builds the backend and the web UI (`npm --prefix backend run build:all`),
//    unless --no-build.
// 4. Reports whether the shared Postgres answers on 55432 and whether Docker
//    runs. It never starts the app or the compose stack: that needs the user's
//    choice of target (workflow-implement, Worktree deploy convention).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const known = new Set(['--force', '--no-build', '--no-playwright', '--help', '-h']);
for (const a of args) {
  if (!known.has(a)) {
    console.error(`Unknown option ${a}. Usage: node scripts/bootstrap.mjs [--force] [--no-build] [--no-playwright]`);
    process.exit(2);
  }
}
if (args.has('--help') || args.has('-h')) {
  console.log('Usage: node scripts/bootstrap.mjs [--force] [--no-build] [--no-playwright]');
  process.exit(0);
}

const logDir = path.join(root, '.qa-reports', 'bootstrap');
fs.mkdirSync(logDir, { recursive: true });

/** Run a shell command in `cwd`, output to a log file; resolves to { ok, ms, log }. */
function run(name, command, cwd) {
  const log = path.join(logDir, `${name}.log`);
  const out = fs.openSync(log, 'w');
  const started = Date.now();
  console.log(`… ${name}: ${command}`);
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', out, out], windowsHide: true });
    child.on('close', (code) => {
      fs.closeSync(out);
      const ms = Date.now() - started;
      const ok = code === 0;
      console.log(`${ok ? '✓' : '✗'} ${name} (${(ms / 1000).toFixed(1)} s)${ok ? '' : ` — exit ${code}, log: ${path.relative(root, log)}`}`);
      if (!ok) {
        const tail = fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).slice(-15).join('\n');
        console.log(tail.replace(/^/gm, '    '));
      }
      resolve({ ok, ms, log });
    });
  });
}

/** True when `pkg`'s node_modules was installed after its lockfile last changed. */
function installUpToDate(pkg) {
  const lock = path.join(root, pkg, 'package-lock.json');
  const marker = path.join(root, pkg, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(lock) || !fs.existsSync(marker)) return false;
  return fs.statSync(marker).mtimeMs >= fs.statSync(lock).mtimeMs;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`Node ${process.versions.node} is too old: the backend needs Node 22.13 or later.`);
  process.exit(1);
}

let failed = false;

// 1. Install. --legacy-peer-deps matches CI (build-desktop.yml, publish-npm.yml);
// every peer the build needs is a direct dependency, so nothing is skipped.
const installs = [];
for (const pkg of ['backend', 'frontend']) {
  if (!args.has('--force') && installUpToDate(pkg)) {
    console.log(`✓ ${pkg} install: up to date, skipped (pass --force to reinstall)`);
    continue;
  }
  installs.push(run(`${pkg}-install`, 'npm ci --legacy-peer-deps --no-audit --no-fund', path.join(root, pkg)));
}
for (const r of await Promise.all(installs)) failed ||= !r.ok;

// 2. Playwright browsers (no-op when already cached), alongside the build.
const tail = [];
if (!failed && !args.has('--no-playwright')) {
  tail.push(run('playwright-browsers', 'npx playwright install chromium chromium-headless-shell', path.join(root, 'frontend')));
}
// 3. Build the backend and the web UI into backend/public.
if (!failed && !args.has('--no-build')) {
  tail.push(run('build', 'npm --prefix backend run build:all', root));
}
for (const r of await Promise.all(tail)) failed ||= !r.ok;

// 4. Shared services.
const postgres = await portOpen(55432);
const docker = await new Promise((resolve) => {
  const child = spawn('docker info', { shell: true, stdio: 'ignore', windowsHide: true });
  child.on('close', (code) => resolve(code === 0));
  child.on('error', () => resolve(false));
});
console.log('');
console.log(`Postgres on 55432: ${postgres ? 'up (shared World Cup stack, reuse it)' : 'not running'}`);
console.log(`Docker: ${docker ? 'running' : 'not running'}`);
if (!postgres) {
  console.log(`  The Testing Data fixtures and the E2E global setup need it. Start it with the user's OK:`);
  console.log(`  docker compose up -d --wait postgres   (from ${root})`);
}
console.log('');
if (failed) {
  console.log('Bootstrap failed: see the log above.');
  process.exit(1);
}
console.log('Ready. Run the web app on a free port with an isolated data dir, for example:');
console.log('  node backend/dist/cli.js --no-open --port 3400 --intellify-api-port 3420 --data-dir .qa-reports/app-data');
console.log('  node scripts/setup-local.mjs http://127.0.0.1:3400');
