#!/usr/bin/env node
// Live smoke test of the "Custom endpoint" LLM provider (BA-281, story BA-299).
//
// Starts an isolated app instance (`node dist/cli.js`) on APP_PORT with a
// throwaway data dir and, for each API style that has a base URL, drives the
// real HTTP API: POST /llm/models, POST /llm/test-connection, PUT and GET
// /llm/settings, and one data-free assistant turn on the stream endpoint.
// Finally it scans every response, the data dir and the app log for the raw
// key (llm-settings R54). No dependencies beyond Node 18+.
//
// See README.md next to this file for the environment variables.

import { spawn } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(SCRIPT_DIR, '..', '..', 'dist', 'cli.js');

/** Ports other apps and sessions use; never start the app on them. */
const RESERVED_PORTS = new Set([3000, 3100, 3200, 4200, 55432, 8317]);
const PLACEHOLDER_DATASET = 'custom-endpoint-smoke';
const PROMPT = 'Reply with exactly: pong';

const env = process.env;
const APP_PORT = Number(env.APP_PORT);
const KEY = env.CUSTOM_API_KEY ?? '';
const MODEL = env.MODEL || 'claude-sonnet-4-6';
const OUT_DIR = env.OUT_DIR ? resolve(env.OUT_DIR) : '';
const READY_TIMEOUT_MS = Number(env.READY_TIMEOUT_MS) || 120_000;
const REQUEST_TIMEOUT_MS = Number(env.REQUEST_TIMEOUT_MS) || 60_000;
const STREAM_TIMEOUT_MS = Number(env.STREAM_TIMEOUT_MS) || 180_000;
const STYLES = [
  { style: 'openai', baseUrl: env.CUSTOM_BASE_URL_OPENAI ?? '' },
  { style: 'anthropic', baseUrl: env.CUSTOM_BASE_URL_ANTHROPIC ?? '' },
].filter((s) => s.baseUrl.trim() !== '');

const BASE = `http://127.0.0.1:${APP_PORT}`;

// ---------------------------------------------------------------- reporting

/** Never print the raw key, even when the app leaks it. */
function redact(text) {
  const s = String(text);
  return KEY ? s.split(KEY).join('[REDACTED-KEY]') : s;
}

const checks = [];
function record(scope, name, status, detail = '') {
  checks.push({ scope, name, status, detail: redact(detail) });
  const tag = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' }[status];
  const line = `[${tag}] ${scope} · ${name}${detail ? ` — ${redact(detail)}` : ''}`;
  (status === 'fail' ? console.error : console.log)(line);
}
const pass = (scope, name, detail) => record(scope, name, 'pass', detail);
const fail = (scope, name, detail) => record(scope, name, 'fail', detail);
const warn = (scope, name, detail) => record(scope, name, 'warn', detail);

/** Every raw response body the app sent, for the final key scan. */
const responses = [];

// ---------------------------------------------------------------- config

function configError(message) {
  console.error(`custom-endpoint-smoke: ${message}`);
  process.exit(2);
}

if (!Number.isInteger(APP_PORT) || APP_PORT < 1 || APP_PORT > 65535) {
  configError('APP_PORT must be a port number (1-65535)');
}
if (RESERVED_PORTS.has(APP_PORT)) {
  configError(
    `APP_PORT ${APP_PORT} is reserved (${[...RESERVED_PORTS].join(', ')}); pick another`,
  );
}
if (STYLES.length === 0) {
  configError(
    'set CUSTOM_BASE_URL_OPENAI and/or CUSTOM_BASE_URL_ANTHROPIC (at least one)',
  );
}
try {
  statSync(CLI_PATH);
} catch {
  configError(`${CLI_PATH} not found — run "npm run build" in backend/ first`);
}

// ---------------------------------------------------------------- app process

const tmpRoot = mkdtempSync(join(tmpdir(), 'custom-endpoint-smoke-'));
const dataDir = join(tmpRoot, 'data');
const appLogPath = join(tmpRoot, 'app.log');
mkdirSync(dataDir, { recursive: true });

let app = null;
let appExited = false;
/** Resolves once every app output line is on disk (after the child closes). */
let logFlushed = Promise.resolve();
let cleanedUp = false;

function startApp() {
  const childEnv = { ...env, INTELLIFY_API_PORT: '0' };
  // Keep the instance isolated from the developer's own data and secret.
  delete childEnv.APP_SECRET;
  delete childEnv.APP_DATA_DIR;
  delete childEnv.QTI_DATA_DIR;
  const log = createWriteStream(appLogPath);
  app = spawn(
    process.execPath,
    [CLI_PATH, '--no-open', '--port', String(APP_PORT), '--data-dir', dataDir],
    { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Two sources share one file: never let the first to end close it.
  app.stdout.pipe(log, { end: false });
  app.stderr.pipe(log, { end: false });
  logFlushed = new Promise((r) => {
    log.once('finish', r);
    log.once('error', r);
  });
  // 'close' fires after both pipes have drained, unlike 'exit'.
  app.once('close', () => log.end());
  app.on('exit', () => {
    appExited = true;
  });
  console.log(`App started (PID ${app.pid}) on ${BASE}, data dir ${dataDir}`);
}

function appLogTail(lines = 30) {
  try {
    return redact(
      readFileSync(appLogPath, 'utf8').split('\n').slice(-lines).join('\n'),
    );
  } catch {
    return '(no app log)';
  }
}

/**
 * True when something already listens on APP_PORT. Checked before the app
 * starts: otherwise the first readiness probe can reach that other server
 * (the CLI only refuses a busy port after it has loaded) and the smoke would
 * PUT the raw key into someone else's settings.
 */
function portInUse(port) {
  const answers = new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
  const bindable = new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.once('listening', () => probe.close(() => done(true)));
    probe.listen(port, '127.0.0.1');
  });
  return Promise.all([answers, bindable]).then(([a, b]) => a || !b);
}

async function waitReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (appExited) {
      throw new Error(`the app exited before it was ready:\n${appLogTail()}`);
    }
    try {
      const res = await fetch(`${BASE}/llm/settings`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        if (appExited) {
          throw new Error(
            `the app exited and another server answered on ${BASE}:\n${appLogTail()}`,
          );
        }
        responses.push({
          label: 'ready GET /llm/settings',
          body: await res.text(),
        });
        return;
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `the app was not ready within ${READY_TIMEOUT_MS}ms:\n${appLogTail()}`,
  );
}

/** Wait (bounded) until the app log holds every line the app wrote. */
async function awaitLog() {
  await Promise.race([logFlushed, new Promise((r) => setTimeout(r, 5000))]);
}

/** Stop the app by its PID (SIGTERM, then SIGKILL after 8s). */
async function stopApp() {
  if (!app) return;
  if (appExited) return awaitLog();
  const pid = app.pid;
  const exited = new Promise((r) => app.once('exit', r));
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return awaitLog();
  }
  const timer = new Promise((r) => setTimeout(r, 8000, 'timeout'));
  if ((await Promise.race([exited, timer])) === 'timeout' && !appExited) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
  }
  await awaitLog();
  console.log(`App stopped (PID ${pid})`);
}

async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  await stopApp();
  rmSync(tmpRoot, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.error(`\nInterrupted (${signal}); stopping the app`);
    cleanup().finally(() => process.exit(130));
  });
}

// ---------------------------------------------------------------- HTTP

async function call(method, path, body) {
  const label = `${method} ${path}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  responses.push({ label, status: res.status, body: text });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep null; callers report the raw text
  }
  return { status: res.status, json, text };
}

const ASSISTANT_RUN = '/workflows/agent%3Aassistant/runs/stream';

/** POST an Assistant run and read the SSE stream to its end. */
async function streamTurn(content) {
  const label = `POST ${ASSISTANT_RUN}`;
  const res = await fetch(`${BASE}${ASSISTANT_RUN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { question: content, datasets: [PLACEHOLDER_DATASET] },
    }),
    signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
  });
  const decoder = new TextDecoder();
  let raw = '';
  try {
    for await (const chunk of res.body)
      raw += decoder.decode(chunk, { stream: true });
    raw += decoder.decode();
  } finally {
    responses.push({ label, status: res.status, body: raw });
  }
  const events = [];
  for (const block of raw.split('\n\n')) {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      events.push({ type: 'unparsed', content: data });
    }
  }
  return { status: res.status, events };
}

// ---------------------------------------------------------------- per style

function dtoFor(style, baseUrl) {
  const dto = { provider: 'custom', apiStyle: style, baseUrl, model: MODEL };
  if (KEY) dto.apiKey = KEY;
  return dto;
}

async function runStyle({ style, baseUrl }) {
  const scope = `${style}`;
  console.log(`\n=== API style ${style} — ${baseUrl} — model ${MODEL}`);

  // 1. POST /llm/models
  try {
    const body = { provider: 'custom', apiStyle: style, baseUrl };
    if (KEY) body.apiKey = KEY;
    const { status, json, text } = await call('POST', '/llm/models', body);
    if (json?.ok === true && Array.isArray(json.models)) {
      pass(scope, 'POST /llm/models', `${json.models.length} model(s) listed`);
      if (json.models.includes(MODEL)) pass(scope, 'model listed', MODEL);
      else
        warn(
          scope,
          'model listed',
          `${MODEL} is not in the list (first: ${json.models.slice(0, 5).join(', ') || 'none'})`,
        );
    } else {
      fail(
        scope,
        'POST /llm/models',
        `HTTP ${status}: ${json?.message ?? text.slice(0, 300)}`,
      );
    }
  } catch (err) {
    fail(scope, 'POST /llm/models', err.message);
  }

  // 2. POST /llm/test-connection
  try {
    const { status, json, text } = await call(
      'POST',
      '/llm/test-connection',
      dtoFor(style, baseUrl),
    );
    if (json?.ok === true) {
      pass(scope, 'POST /llm/test-connection', json.message);
      if (String(json.message).includes(`custom/${MODEL}`))
        pass(scope, 'test route custom/<model>', `custom/${MODEL}`);
      else
        fail(
          scope,
          'test route custom/<model>',
          `expected "custom/${MODEL}" in the message (R49)`,
        );
    } else {
      fail(
        scope,
        'POST /llm/test-connection',
        `HTTP ${status}: ${json?.message ?? text.slice(0, 300)}`,
      );
    }
  } catch (err) {
    fail(scope, 'POST /llm/test-connection', err.message);
  }

  // 3. PUT /llm/settings
  let saved = false;
  try {
    const { status, json, text } = await call(
      'PUT',
      '/llm/settings',
      dtoFor(style, baseUrl),
    );
    if (json?.ok === true) {
      saved = true;
      pass(scope, 'PUT /llm/settings', json.message);
    } else {
      fail(
        scope,
        'PUT /llm/settings',
        `HTTP ${status}: ${json?.message ?? text.slice(0, 300)}`,
      );
    }
  } catch (err) {
    fail(scope, 'PUT /llm/settings', err.message);
  }

  // 4. GET /llm/settings: configured, custom, this style, masked key only.
  try {
    const { status, json, text } = await call('GET', '/llm/settings');
    if (status !== 200 || !json) {
      fail(scope, 'GET /llm/settings', `HTTP ${status}: ${text.slice(0, 300)}`);
    } else {
      const problems = [];
      if (json.configured !== true)
        problems.push(`configured=${json.configured}`);
      if (json.provider !== 'custom')
        problems.push(`provider=${json.provider}`);
      if (json.apiStyle !== style) problems.push(`apiStyle=${json.apiStyle}`);
      if (json.model !== MODEL) problems.push(`model=${json.model}`);
      if (KEY) {
        if (!json.apiKeyMasked) problems.push('apiKeyMasked missing');
        else if (json.apiKeyMasked === KEY)
          problems.push('apiKeyMasked is the raw key');
      } else if (json.apiKeyMasked) {
        problems.push('keyless config shows a masked key (R47)');
      }
      if (KEY && text.includes(KEY)) problems.push('raw key in the response');
      if (problems.length === 0)
        pass(
          scope,
          'GET /llm/settings',
          `configured, custom/${style}, key ${json.apiKeyMasked ?? '(none)'}`,
        );
      else fail(scope, 'GET /llm/settings', problems.join('; '));
    }
  } catch (err) {
    fail(scope, 'GET /llm/settings', err.message);
  }

  // 5. One data-free assistant turn on the stream endpoint.
  if (!saved) {
    fail(scope, 'assistant turn', 'skipped: settings were not saved');
    return;
  }
  let datasourceId;
  try {
    // A run needs a dataset that exists; this one points at a closed port and
    // is never queried (the turn is data-free).
    const source = await call('POST', '/datasources', {
      kind: 'postgres',
      name: PLACEHOLDER_DATASET,
      config: {
        host: '127.0.0.1',
        port: 1,
        database: 'none',
        user: 'none',
        password: 'none',
        ssl: false,
      },
    });
    datasourceId = source.json?.datasource?.id;
    const dataset = datasourceId
      ? await call('POST', '/datasets', {
          name: PLACEHOLDER_DATASET,
          tables: ['smoke.smoke.placeholder'],
          entities: [
            {
              key: 'smoke.smoke.placeholder',
              columns: [{ name: 'id', type: 'integer', nullable: false }],
            },
          ],
          datasourceId,
          datasourceKind: 'postgres',
        })
      : undefined;
    if (dataset?.json?.ok !== true) {
      fail(
        scope,
        'placeholder dataset',
        `HTTP ${dataset?.status ?? source.status}: ${dataset?.json?.message ?? source.json?.message ?? 'not created'}`,
      );
      return;
    }
    const started = Date.now();
    const { status, events } = await streamTurn(PROMPT);
    const errors = events.filter((e) => e.type === 'error');
    const done = events.find((e) => e.type === 'done');
    const streamed = events
      .filter((e) => e.type === 'text')
      .map((e) => e.content ?? '')
      .join('');
    const answer = (done?.run?.answer?.content ?? streamed).trim();
    const ms = Date.now() - started;
    if (status !== 200) fail(scope, 'assistant turn', `HTTP ${status}`);
    else if (errors.length > 0)
      fail(
        scope,
        'assistant turn',
        `error event: ${errors.map((e) => e.content).join(' | ')}`,
      );
    else if (!done)
      fail(
        scope,
        'assistant turn',
        `no done event (${events.length} event(s))`,
      );
    else if (/\bpong\b/i.test(answer))
      pass(scope, 'assistant turn', `"${answer.slice(0, 80)}" in ${ms}ms`);
    else
      fail(
        scope,
        'assistant turn',
        `no "pong" in the answer: "${answer.slice(0, 200)}"`,
      );
  } catch (err) {
    fail(scope, 'assistant turn', err.message);
  } finally {
    // Leave no placeholder behind: its dataset and its datasource.
    await call(
      'DELETE',
      `/datasets/${encodeURIComponent(PLACEHOLDER_DATASET)}`,
    ).catch(() => undefined);
    if (datasourceId)
      await call('DELETE', `/datasources/${datasourceId}`).catch(
        () => undefined,
      );
  }
}

// ---------------------------------------------------------------- key scan

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function scanForKey() {
  const scope = 'key scan';
  if (!KEY) {
    warn(scope, 'raw key', 'CUSTOM_API_KEY is empty; nothing to scan for');
    return;
  }
  const needle = Buffer.from(KEY, 'utf8');
  const leakedResponses = responses
    .filter((r) => r.body.includes(KEY))
    .map((r) => r.label);
  if (leakedResponses.length)
    fail(scope, 'API responses', `raw key in: ${leakedResponses.join(', ')}`);
  else pass(scope, 'API responses', `${responses.length} response(s) clean`);

  const files = walk(dataDir);
  const leakedFiles = files.filter((f) => {
    try {
      return readFileSync(f).includes(needle);
    } catch {
      return false;
    }
  });
  if (leakedFiles.length)
    fail(
      scope,
      'data dir',
      `raw key in: ${leakedFiles.map((f) => f.slice(dataDir.length + 1)).join(', ')}`,
    );
  else pass(scope, 'data dir', `${files.length} file(s) clean`);

  let log = '';
  try {
    log = readFileSync(appLogPath, 'utf8');
  } catch {
    // empty log
  }
  if (log.includes(KEY)) fail(scope, 'app log', 'raw key in the app log');
  else pass(scope, 'app log', `${log.split('\n').length} line(s) clean`);
}

// ---------------------------------------------------------------- report

function writeOutDir() {
  if (!OUT_DIR) return;
  mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    at: new Date().toISOString(),
    model: MODEL,
    styles: STYLES,
    keyProvided: Boolean(KEY),
    checks,
    responses: responses.map((r) => ({ ...r, body: redact(r.body) })),
  };
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  let log = '';
  try {
    log = readFileSync(appLogPath, 'utf8');
  } catch {
    // no log
  }
  writeFileSync(join(OUT_DIR, 'app.log'), redact(log));
  console.log(`Report written to ${OUT_DIR}`);
}

// ---------------------------------------------------------------- main

async function main() {
  if (await portInUse(APP_PORT)) {
    rmSync(tmpRoot, { recursive: true, force: true });
    configError(
      `APP_PORT ${APP_PORT} is already in use; stop that server (by PID) or pick a free port`,
    );
  }
  startApp();
  try {
    await waitReady();
    pass('app', 'ready', BASE);
    for (const target of STYLES) await runStyle(target);
  } catch (err) {
    fail('app', 'run', err.message);
  }
  // Stop first so the log and data dir are final before the scan.
  await stopApp();
  scanForKey();
  writeOutDir();
  await cleanup();

  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const passed = checks.filter((c) => c.status === 'pass').length;
  console.log(`\n${passed} passed, ${warned} warning(s), ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(redact(err?.stack ?? err));
  await cleanup();
  process.exit(1);
});
