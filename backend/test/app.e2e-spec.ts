/**
 * Smoke test: the built backend starts and serves its API. It replaces the
 * Nest scaffold, which imported `AppModule` into Jest (impossible: Mastra and
 * the Databricks driver are ESM-only) and expected a `GET /` the app never had.
 * Run `npm run build` first; see `backend-process.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { type Backend, boot, stop } from './backend-process';

jest.setTimeout(120_000);

describe('Backend (e2e)', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'qti-app-'));
  let backend: Backend | undefined;

  beforeAll(async () => {
    backend = await boot(dataDir);
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('serves the sessions list on a fresh data dir', async () => {
    const res = await request(backend!.url).get('/sessions').expect(200);
    expect(res.body).toBeDefined();
  });
});
