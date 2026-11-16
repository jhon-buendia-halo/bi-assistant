// Checks the pruned staged backend still works (roadmap 1.7.22).
// Run after `npm --prefix frontend run stage:backend`:
//   node evidence/1.7.22/pruned-backend-check.mjs <repo-root>
// 1. Imports every production dependency under Electron-as-Node, as the app runs it.
// 2. Starts backend/release-staging/dist/main.js on port 3320 with a temp data dir
//    and requires 200 from every parameterless GET endpoint in api.md.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(process.argv[2]);
const staging = path.join(root, 'backend', 'release-staging');
const electronBin = createRequire(path.join(root, 'frontend', 'package.json'))('electron');
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const fileCount = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n += 1;
    }
  };
  walk(dir);
  return n;
};
console.log(`staged node_modules: ${fileCount(path.join(staging, 'node_modules'))} files`);

// 1. Every production dependency loads (a loader file inside the staging dir
// resolves packages exactly as the backend does; removed afterwards).
const deps = Object.keys(JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8')).dependencies ?? {});
const loader = path.join(staging, '.qa-load-deps.mjs');
fs.writeFileSync(
  loader,
  `const deps = ${JSON.stringify(deps)};\nconst failed = [];\n` +
    `for (const d of deps) { try { await import(d); } catch (e) {\n` +
    `  if (e && e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') continue; failed.push(d + ': ' + String(e && e.message).split('\\n')[0]); } }\n` +
    `console.log(JSON.stringify({ total: deps.length, failed }));\nprocess.exit(0);\n`,
);
try {
  const run = spawnSync(electronBin, [loader], { cwd: staging, env, encoding: 'utf8', timeout: 180000 });
  const line = (run.stdout || '').trim().split('\n').pop() || '{}';
  const out = JSON.parse(line);
  check(`all ${out.total} production dependencies import`, out.failed?.length === 0, (out.failed || []).join('; '));
} catch (error) {
  check('dependency import run', false, String(error));
} finally {
  fs.rmSync(loader, { force: true });
}

// 2. The staged backend answers its API.
const PORT = 3320;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-1.7.22-'));
const logPath = path.join(dataDir, 'backend.log');
const log = fs.openSync(logPath, 'w');
const backend = spawn(electronBin, [path.join(staging, 'dist', 'main.js')], {
  cwd: path.join(staging, 'dist'),
  env: { ...env, PORT: String(PORT), APP_DATA_DIR: dataDir, INTELLIFY_API_PORT: '0' },
  stdio: ['ignore', log, log],
});
const get = (p) =>
  new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
try {
  const deadline = Date.now() + 90000;
  let up = false;
  while (Date.now() < deadline && !(up = (await get('/sessions')) === 200)) await new Promise((r) => setTimeout(r, 300));
  check('staged backend starts and answers /sessions', up);
  const endpoints = [
    '/agents', '/data-readiness/assessments?datasourceId=none', '/datasets', '/datasources', '/developer-settings',
    '/llm/settings', '/metrics', '/metrics/candidates', '/monitoring/llm-calls', '/monitoring/sessions',
    '/sessions', '/skills', '/skills/built-in', '/testing-data', '/ui-preferences',
  ];
  for (const p of endpoints) {
    const status = await get(p);
    check(`GET ${p}`, status === 200, String(status));
  }
  const text = fs.readFileSync(logPath, 'utf8');
  const missing = text.split('\n').filter((l) => /Cannot find module|ENOENT|MODULE_NOT_FOUND/.test(l));
  check('no missing-module or missing-file errors in the backend log', missing.length === 0, missing.slice(0, 3).join(' | '));
} finally {
  backend.kill();
  await new Promise((r) => setTimeout(r, 1000));
  fs.rmSync(dataDir, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
