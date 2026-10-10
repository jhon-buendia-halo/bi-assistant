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

/** Start the built backend and wait until `GET /agents` answers. */
export async function boot(dataDir: string): Promise<Backend> {
  if (!existsSync(MAIN)) {
    throw new Error(`${MAIN} is missing: run "npm run build" first`);
  }
  const port = await freePort();
  const output: string[] = [];
  const child = spawn(process.execPath, [MAIN], {
    env: { ...process.env, APP_DATA_DIR: dataDir, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk: Buffer) => output.push(String(chunk)));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${url}/agents`);
      if (res.ok) return { url, process: child, output };
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
