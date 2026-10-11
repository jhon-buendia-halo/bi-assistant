/**
 * Runs the BUILT backend (`node dist/main.js`, so run `npm run build` first)
 * as a child process on a free port with its own `APP_DATA_DIR`. Booting
 * `AppModule` inside Jest is not possible: Mastra and the Databricks driver
 * pull in ESM-only packages that Jest's CommonJS runtime cannot require. A
 * real process also makes "the backend restarts" literal.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const MAIN = join(__dirname, '..', 'dist', 'main.js');

/** A port nothing is listening on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface Backend {
  url: string;
  process: ChildProcess;
  output: string[];
}

export interface BootOptions {
  /** Extra environment, e.g. the `ORG_*` configuration of an org server. */
  env?: Record<string, string>;
  /** Port to listen on; default a free one. */
  port?: number;
}

/** Start the built backend and wait until `GET /me` answers (200 or 401). */
export async function boot(
  dataDir: string,
  options: BootOptions = {},
): Promise<Backend> {
  if (!existsSync(MAIN)) {
    throw new Error(`${MAIN} is missing: run "npm run build" first`);
  }
  const port = options.port ?? (await freePort());
  const output: string[] = [];
  const child = spawn(process.execPath, [MAIN], {
    env: {
      ...process.env,
      ...options.env,
      APP_DATA_DIR: dataDir,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk: Buffer) => output.push(String(chunk)));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      // Local mode answers 200, org server mode 401 without a session.
      const res = await fetch(`${url}/me`);
      if (res.status === 200 || res.status === 401) {
        return { url, process: child, output };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGKILL');
  throw new Error(`Backend did not start:\n${output.join('')}`);
}

export async function stop(backend: Backend | undefined): Promise<void> {
  const child = backend?.process;
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(timer);
}

/**
 * Start the built backend expecting it to refuse to start (for example on a
 * partial org server configuration). Resolves with its exit code and output.
 */
export async function bootFailure(
  dataDir: string,
  env: Record<string, string>,
): Promise<{ code: number | null; output: string }> {
  const port = await freePort();
  const output: string[] = [];
  const child = spawn(process.execPath, [MAIN], {
    env: { ...process.env, ...env, APP_DATA_DIR: dataDir, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk: Buffer) => output.push(String(chunk)));
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
  const code = await new Promise<number | null>((resolve) =>
    child.once('exit', (exitCode) => resolve(exitCode)),
  );
  clearTimeout(timer);
  return { code, output: output.join('') };
}

/**
 * Local mode sign-in (api.md 92): signs `userId` in (default Demo User,
 * id `local`) and resolves to the auth session token, sent as
 * `Authorization: Bearer <token>` (admin R71).
 */
export async function signInLocally(
  url: string,
  userId = 'local',
): Promise<string> {
  const res = await fetch(`${url}/auth/local/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const text = await res.text();
  if (res.status !== 200) {
    throw new Error(
      `Local sign-in as ${userId} failed: POST /auth/local/sign-in answered ${res.status}: ${text}`,
    );
  }
  const body = JSON.parse(text) as { ok?: boolean; token?: unknown };
  if (body.ok !== true || typeof body.token !== 'string' || !body.token) {
    throw new Error(`Local sign-in as ${userId} answered no token: ${text}`);
  }
  return body.token;
}

/** The `Authorization` header of a local auth session. */
export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
