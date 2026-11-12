/**
 * Roadmap 1.7.21 (api.md 4.3, app-shell R55): what the backend does for the
 * desktop shell. It echoes `BACKEND_INSTANCE_ID` as `X-Backend-Instance` so
 * the shell's readiness probe can tell its own backend from another server,
 * and it exits once the process named by `DESKTOP_PARENT_PID` is gone.
 * Run `npm run build` first; see `backend-process.ts`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { type Backend, boot, stop } from './backend-process';

jest.setTimeout(120_000);

function exitOf(child: ChildProcess, timeoutMs: number) {
  return new Promise<number | null | 'timeout'>((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('Backend for the desktop shell (e2e)', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'qti-desktop-shell-'));
  let backend: Backend | undefined;
  let parent: ChildProcess | undefined;

  afterEach(async () => {
    await stop(backend);
    backend = undefined;
    parent?.kill();
    parent = undefined;
  });

  afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

  it('answers with the X-Backend-Instance it was given', async () => {
    backend = await boot(dataDir, {
      env: { BACKEND_INSTANCE_ID: 'instance-1721' },
    });
    const res = await request(backend.url).get('/health').expect(200);
    expect(res.headers['x-backend-instance']).toBe('instance-1721');
  });

  it('sends no X-Backend-Instance without BACKEND_INSTANCE_ID', async () => {
    backend = await boot(dataDir);
    const res = await request(backend.url).get('/health').expect(200);
    expect(res.headers['x-backend-instance']).toBeUndefined();
  });

  it('exits once its desktop parent process is gone', async () => {
    parent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
      stdio: 'ignore',
    });
    backend = await boot(dataDir, {
      env: { DESKTOP_PARENT_PID: String(parent.pid) },
    });
    // Still up while the parent lives (two check intervals).
    await new Promise((r) => setTimeout(r, 4500));
    expect(backend.process.exitCode).toBeNull();

    parent.kill();
    expect(await exitOf(backend.process, 8000)).toBe(0);
  });
});
