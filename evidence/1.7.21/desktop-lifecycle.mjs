// Scripted check of roadmap 1.7.21 against the real (unpackaged) desktop app.
// Needs `npm --prefix backend run build` first. Output: desktop-lifecycle.txt.
//   node evidence/1.7.21/desktop-lifecycle.mjs <repo-root>
// Isolated profiles in a temp folder, ports 3310/3311, INTELLIFY_API=off.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(process.argv[2]);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-1.7.21-'));
const electronBin = createRequire(path.join(root, 'frontend', 'package.json'))('electron');
const backendMain = path.join(root, 'backend', 'dist', 'main.js');
const PORT = '3310';
const FOREIGN_PORT = '3311';
const results = [];
const started = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 500 }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, instance: res.headers['x-backend-instance'] ?? null });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
async function until(fn, timeoutMs, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(stepMs);
  }
  return null;
}
function launchApp(userData, port, label) {
  const log = fs.openSync(path.join(work, `${label}.log`), 'w');
  const child = spawn(electronBin, ['.'], {
    cwd: path.join(root, 'frontend'),
    env: { ...process.env, QUESTIONS_TO_INSIGHTS_USER_DATA_DIR: userData, BACKEND_PORT: port, INTELLIFY_API: 'off' },
    stdio: ['ignore', log, log],
  });
  started.push(child.pid);
  return child;
}
const readPid = (dir) => { try { return Number(fs.readFileSync(path.join(dir, 'backend.pid'), 'utf8').trim()); } catch { return null; } };
const diag = (dir) => { try { return fs.readFileSync(path.join(dir, 'logs', 'system.ndjson'), 'utf8'); } catch { return ''; } };

try {
  // A. A backend "left running by an earlier launch": no parent watch, recorded in backend.pid.
  const ud1 = path.join(work, 'profile-1');
  fs.mkdirSync(ud1, { recursive: true });
  const stale = spawn(electronBin, [backendMain], {
    cwd: path.dirname(backendMain),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT, APP_DATA_DIR: path.join(work, 'stale-data'), INTELLIFY_API: 'off' },
    stdio: 'ignore',
  });
  started.push(stale.pid);
  const staleUp = await until(async () => (await probe(PORT))?.status === 200, 60000);
  check('stale backend answers on the port before the app starts', !!staleUp, `pid ${stale.pid}`);
  fs.writeFileSync(path.join(ud1, 'backend.pid'), `${stale.pid}\n`);

  // B. First launch stops it and becomes ready on its own backend.
  const app1 = launchApp(ud1, PORT, 'app-1');
  const staleGone = await until(() => !alive(stale.pid), 30000);
  check('startup stops the recorded stale backend', !!staleGone);
  const own = await until(async () => {
    const p = await probe(PORT);
    return p?.status === 200 && p.instance ? p : null;
  }, 60000);
  check('the app\'s own backend answers with an X-Backend-Instance header', !!own, own?.instance ?? '');
  const backendPid = readPid(ud1);
  check('backend.pid records the new backend', !!backendPid && backendPid !== stale.pid && alive(backendPid), String(backendPid));
  check('diagnostics record the stop', diag(ud1).includes('Stopped a backend left running by an earlier launch'));

  // C. Second launch with the same profile exits; no second backend.
  const app2 = launchApp(ud1, PORT, 'app-2');
  const exit2 = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('still running'), 15000);
    app2.on('exit', (code) => { clearTimeout(t); resolve(code); });
  });
  check('a second launch exits at once (single-instance lock)', exit2 === 0, `exit ${exit2}`);
  check('the first backend is untouched', readPid(ud1) === backendPid && alive(backendPid));

  // D. Kill the window process hard: the backend must follow.
  process.kill(app1.pid, 'SIGKILL');
  const t0 = Date.now();
  const orphanGone = await until(() => !alive(backendPid), 10000, 100);
  check('the backend exits once its desktop shell is killed', !!orphanGone, `${Date.now() - t0} ms`);
  const portFree = await until(async () => (await probe(PORT)) === null, 5000);
  check('the port is free afterwards', !!portFree);

  // E. Another server on the port: never ready, one error diagnostic.
  const foreign = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"sessions":[]}'); });
  await new Promise((r) => foreign.listen(Number(FOREIGN_PORT), '127.0.0.1', r));
  const ud3 = path.join(work, 'profile-3');
  const app3 = launchApp(ud3, FOREIGN_PORT, 'app-3');
  const foreignNoted = await until(() => diag(ud3).includes(`Port ${FOREIGN_PORT} is answered by another process`), 60000, 500);
  check('a foreign server on the port is reported, not accepted', !!foreignNoted);
  check('no "Backend has been stable" or ready is claimed for it', !diag(ud3).includes('restart budget reset'));
  process.kill(app3.pid, 'SIGTERM');
  await sleep(3000);
  foreign.close();
} catch (error) {
  check('script ran to completion', false, String(error?.stack ?? error));
} finally {
  for (const pid of started) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
