/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped JSON */
/**
 * RFP records survive a reseed of the Intellify sample (rfp R10, roadmap
 * 1.14.14 acceptance; data-model 7). Runs the BUILT backend (`npm run build`
 * first) with its embedded Intellify RFP API pointed at a database of its own,
 * seeds the `intellify` schema through Testing Data, saves an RFP, seeds the
 * schema again and reads the RFP back. The database is dropped afterwards, so
 * the shared `intellify_mercer_demo` is never touched.
 *
 * Skipped, visibly, when the compose PostgreSQL on 55432 is not reachable.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import request from 'supertest';
import { type Backend, boot, freePort, stop } from './backend-process';

const SERVER = {
  host: process.env.INTELLIFY_DB_HOST ?? '127.0.0.1',
  port: Number(
    process.env.INTELLIFY_DB_PORT ?? process.env.WORLD_CUP_DB_PORT ?? 55432,
  ),
  user: process.env.INTELLIFY_DB_USER ?? 'world_cup',
  password: process.env.INTELLIFY_DB_PASSWORD ?? 'world_cup_dev',
};
const DATABASE = `intellify_reseed_e2e_${Date.now().toString(36)}`;
const API_KEY = 'e2e-reseed-key';

/** Same trick as intellify-api.e2e-spec.ts: decide the skip while collecting. */
function serverIsUp(): boolean {
  const probe = `
    const { Client } = require(${JSON.stringify(require.resolve('pg'))});
    const c = new Client({ ...${JSON.stringify(SERVER)}, database: 'postgres', connectionTimeoutMillis: 3000 });
    c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
  `;
  try {
    execFileSync(process.execPath, ['-e', probe], {
      stdio: 'ignore',
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function onServer(sql: string): Promise<void> {
  const client = new Client({ ...SERVER, database: 'postgres' });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

jest.setTimeout(240_000);

const describeLive = serverIsUp() ? describe : describe.skip;

describeLive('Intellify RFP API: RFP records survive a reseed', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'qti-intellify-reseed-'));
  let backend: Backend | undefined;
  let apiUrl = '';

  const api = () => request(apiUrl);
  const loadSample = async () => {
    const res = await request(backend!.url)
      .post('/testing-data/intellify/load')
      .send({ ...SERVER, database: DATABASE, ssl: false })
      .expect(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(res.body.message).toContain(
      'loaded 49 entities into dataset "Intellify"',
    );
  };

  beforeAll(async () => {
    // The database exists before the app starts, so the API applies its
    // `rfp` migrations at start (they are not retried later).
    await onServer(`CREATE DATABASE "${DATABASE}"`);
    const apiPort = await freePort();
    backend = await boot(dataDir, {
      env: {
        INTELLIFY_DB_NAME: DATABASE,
        INTELLIFY_API_PORT: String(apiPort),
        INTELLIFY_API_KEY: API_KEY,
      },
    });
    apiUrl = `http://127.0.0.1:${apiPort}`;
    // The API starts after the app listens, and migrates as it starts.
    let health: request.Response | undefined;
    for (let tries = 0; tries < 80; tries += 1) {
      health = await api()
        .get('/health')
        .catch(() => undefined);
      if (health?.body?.rfpSchemaVersion === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(health?.body).toMatchObject({ database: 'up', rfpSchemaVersion: 1 });
  });

  afterAll(async () => {
    await stop(backend);
    await onServer(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps a draft and its lists when the intellify schema is seeded again', async () => {
    await loadSample();
    const created = await api()
      .post('/v1/rfps')
      .set('X-API-Key', API_KEY)
      .send({ clientOneCode: 'IC100100', planYear: 2027, createdBy: 'e2e' })
      .expect(201);
    const id = created.body.id as string;
    await api()
      .put(`/v1/rfps/${id}/lines`)
      .set('X-API-Key', API_KEY)
      .send([{ line: 'Medical', marketBasis: 'as-is', planDesignIds: [] }])
      .expect(200);
    await api()
      .put(`/v1/rfps/${id}/carriers`)
      .set('X-API-Key', API_KEY)
      .send([{ insurer: 'Aetna', lines: ['Medical'], incumbent: true }])
      .expect(200);

    // Recreate: drops and replays schema `intellify` (testing-data R12).
    await loadSample();

    const after = await api()
      .get(`/v1/rfps/${id}`)
      .set('X-API-Key', API_KEY)
      .expect(200);
    expect(after.body).toMatchObject({
      id,
      clientOneCode: 'IC100100',
      clientName: created.body.clientName,
      planYear: 2027,
      status: 'draft',
    });
    expect(after.body.clientMissing).toBeUndefined();
    expect(after.body.lines.map((l: { line: string }) => l.line)).toEqual([
      'Medical',
    ]);
    expect(
      after.body.carriers.map((c: { insurerName: string }) => c.insurerName),
    ).toEqual(['Aetna']);
    const md = await api()
      .get(`/v1/rfps/${id}/document.md`)
      .set('X-API-Key', API_KEY)
      .expect(200);
    expect(md.text).toContain(`# ${created.body.title}`);
    expect(md.text).toContain('## 3. Scope of this RFP');
  });
});
