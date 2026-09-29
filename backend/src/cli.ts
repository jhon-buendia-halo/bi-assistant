#!/usr/bin/env node
/**
 * `questions-to-insights` CLI: starts the NestJS API, serves the bundled web
 * UI from the same origin and opens the browser.
 *
 * Environment (APP_DATA_DIR, APP_SECRET) must be settled BEFORE any app module
 * is loaded — the database and Mastra storage read APP_DATA_DIR at import
 * time — so the app is pulled in with a dynamic import after setup.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const APP_SECRET_FILE_NAME = '.app-secret';

const HELP = `Usage: questions-to-insights [options]

Start the Questions to Insights server and open it in your browser.

Options:
  --port <n>         Port to listen on (default ${DEFAULT_PORT}; falls back to a
                     free port when the default is busy)
  --host <h>         Interface to bind (default ${DEFAULT_HOST})
  --data-dir <path>  Where app data is stored (default: $QTI_DATA_DIR,
                     $APP_DATA_DIR, or ~/.questions-to-insights)
  --no-open          Do not open the browser
  -h, --help         Show this help
  -v, --version      Show the version
`;

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function fail(message: string): never {
  console.error(`questions-to-insights: ${message}`);
  process.exit(1);
}

/** Same semantics as resolveAppSecret in frontend/electron/main.cjs. */
function resolveAppSecret(dataDir: string): string {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const secretPath = join(dataDir, APP_SECRET_FILE_NAME);
  try {
    if (existsSync(secretPath)) {
      const existing = readFileSync(secretPath, 'utf8').trim();
      if (existing) return existing;
    }
  } catch (error) {
    console.warn(
      `Could not read ${secretPath}; generating a new secret (${(error as Error).message})`,
    );
  }
  const secret = randomBytes(32).toString('hex');
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(secretPath, secret, { mode: 0o600 });
  } catch (error) {
    console.warn(
      `Could not persist ${secretPath}; stored API keys will not decrypt after a restart (${(error as Error).message})`,
    );
  }
  return secret;
}

function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.once('listening', () => probe.close(() => done(true)));
    probe.listen(port, host);
  });
}

function openBrowser(url: string): void {
  try {
    const [cmd, args] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '""', url]]
          : ['xdg-open', [url]];
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: process.platform === 'win32',
    });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Opening the browser is best effort.
  }
}

async function main(): Promise<void> {
  let values: {
    port?: string;
    host?: string;
    'data-dir'?: string;
    open?: boolean;
    help?: boolean;
    version?: boolean;
  };
  try {
    ({ values } = parseArgs({
      options: {
        port: { type: 'string' },
        host: { type: 'string' },
        'data-dir': { type: 'string' },
        // `--no-open` via allowNegative.
        open: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      allowNegative: true,
      strict: true,
    }));
  } catch (error) {
    fail(`${(error as Error).message}\n\n${HELP}`);
  }

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    console.log(readVersion());
    return;
  }

  const host = values.host ?? DEFAULT_HOST;
  const portExplicit = values.port !== undefined;
  let port = DEFAULT_PORT;
  if (portExplicit) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      fail(`invalid --port "${values.port}" (expected 0-65535)`);
    }
  }
  if (port !== 0 && !(await isPortFree(port, host))) {
    if (portExplicit) fail(`port ${port} on ${host} is already in use`);
    console.log(`Port ${port} is busy; using a free port instead.`);
    port = 0;
  }
  const shouldOpen = values.open !== false;

  const dataDir = resolve(
    values['data-dir'] ??
      process.env.QTI_DATA_DIR ??
      process.env.APP_DATA_DIR ??
      join(homedir(), '.questions-to-insights'),
  );
  mkdirSync(dataDir, { recursive: true });
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_SECRET = resolveAppSecret(dataDir);

  const { createApp, hasWebUi, resolveWebRoot } =
    await import('./app-bootstrap.js');
  const webRoot = resolveWebRoot();
  if (!hasWebUi(webRoot)) {
    console.warn(
      `Warning: no web UI build found at ${webRoot} — only the API is available.\n` +
        `         Run "npm run build:web" in backend/ to bundle it.`,
    );
  }

  const { app, url } = await createApp({ port, host, webRoot });

  console.log('');
  console.log(`  Questions to Insights ${readVersion()}`);
  console.log(`  URL:      ${url}`);
  console.log(`  Data dir: ${dataDir}`);
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  if (shouldOpen) openBrowser(url);

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    app
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
    // Don't hang forever on a stuck close.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
