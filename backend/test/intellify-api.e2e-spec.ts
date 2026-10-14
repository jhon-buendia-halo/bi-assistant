/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
/**
 * The Intellify RFP API over the real `intellify_mercer_demo` database
 * (api.md 2.16). Starts the API in-process on a free port with a test key.
 *
 * Runs only under `test:e2e`; without the database (the `Intellify` sample
 * loaded into the compose Postgres) the whole file is skipped, visibly.
 */
// `marked` (the PDF renderer's lexer) ships ESM only; Jest loads its UMD build.
jest.mock('marked', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
  require('../node_modules/marked/lib/marked.umd.js'),
);

import { execFileSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { createIntellifyApi } from '../src/intellify-api/bootstrap';
import type { IntellifyDbConfig } from '../src/intellify-api/config';
import { DbService } from '../src/intellify-api/db/db.service';

const API_KEY = 'e2e-test-key';

export const INTELLIFY_DB: IntellifyDbConfig = {
  host: process.env.INTELLIFY_DB_HOST ?? '127.0.0.1',
  port: Number(
    process.env.INTELLIFY_DB_PORT ?? process.env.WORLD_CUP_DB_PORT ?? 55432,
  ),
  database: process.env.INTELLIFY_DB_NAME ?? 'intellify_mercer_demo',
  user: process.env.INTELLIFY_DB_USER ?? 'world_cup',
  password: process.env.INTELLIFY_DB_PASSWORD ?? 'world_cup_dev',
  ssl: false,
  schema: 'intellify',
};

/**
 * `describe.skip` is decided while jest collects the file, before any async
 * hook can run, so the probe runs in a child process (same trick as
 * answer-guards.e2e-spec.ts).
 */
function databaseIsUp(): boolean {
  const probe = `
    const { Pool } = require(${JSON.stringify(require.resolve('pg'))});
    const pool = new Pool({ ...${JSON.stringify(INTELLIFY_DB)}, max: 1, connectionTimeoutMillis: 3000 });
    pool.query('SELECT 1 FROM ${INTELLIFY_DB.schema}.clients LIMIT 1')
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
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

const describeLive = databaseIsUp() ? describe : describe.skip;

describeLive('Intellify RFP API (live database)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let base: string;
  let nonDeletedClients: number;

  const get = (path: string) =>
    request(base).get(path).set('X-API-Key', API_KEY);

  beforeAll(async () => {
    const api = await createIntellifyApi({
      port: 0,
      host: '127.0.0.1',
      db: INTELLIFY_DB,
      apiKeys: [API_KEY],
      logger: false,
    });
    app = api.app;
    close = () => api.close();
    base = api.url;
    const pool = new Pool({ ...INTELLIFY_DB, max: 1 });
    try {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM ${INTELLIFY_DB.schema}.clients WHERE NOT deleted`,
      );
      nonDeletedClients = (rows[0] as { n: number }).n;
    } finally {
      await pool.end();
    }
  }, 30_000);

  afterAll(async () => {
    await close?.();
  });

  describe('reads', () => {
    it('answers 401 without an API key and with a wrong one', async () => {
      await request(base).get('/v1/clients').expect(401);
      await request(base)
        .get('/v1/clients')
        .set('X-API-Key', 'nope')
        .expect(401);
      const res = await request(base).get('/v1/clients/IC100100/program');
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ message: 'API key required' });
    });

    it('pages /v1/clients and totals the non-deleted clients', async () => {
      const res = await get('/v1/clients?per_page=5').expect(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body).toMatchObject({
        page: 1,
        per_page: 5,
        total: nonDeletedClients,
      });
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          oneCode: expect.any(String),
          name: expect.any(String),
          linesOffered: expect.any(Number),
        }),
      );
      const page2 = await get('/v1/clients?per_page=5&page=2').expect(200);
      expect(page2.body.data[0].oneCode).not.toBe(res.body.data[0].oneCode);
    });

    it('filters clients by name or code and honours includeDeleted', async () => {
      const byCode = await get('/v1/clients?q=ic100100').expect(200);
      expect(
        byCode.body.data.map((c: { oneCode: string }) => c.oneCode),
      ).toContain('IC100100');
      const all = await get(
        '/v1/clients?includeDeleted=true&per_page=500',
      ).expect(200);
      expect(all.body.total).toBeGreaterThanOrEqual(nonDeletedClients);
    });

    it('rejects a page or per_page that is not a positive integer', async () => {
      for (const q of ['page=0', 'per_page=-1', 'per_page=abc', 'page=1.5']) {
        const res = await get(`/v1/clients?${q}`).expect(400);
        expect(res.body.code).toBe('validation');
      }
      const capped = await get('/v1/census?per_page=9999').expect(200);
      expect(capped.body.per_page).toBe(500);
    });

    it('declares page, per_page and a data array for every collection in /openapi.json', async () => {
      const doc = (await request(base).get('/openapi.json').expect(200)).body;
      const collections = [
        '/v1/clients',
        '/v1/products',
        '/v1/funding-types',
        '/v1/plan-types',
        '/v1/carriers',
        '/v1/plan-designs',
        '/v1/policies',
        '/v1/financials',
        '/v1/census',
      ];
      for (const path of collections) {
        const op = doc.paths[path]?.get;
        expect(op).toBeDefined();
        const params = (op.parameters as { name: string }[]).map((p) => p.name);
        expect(params).toEqual(expect.arrayContaining(['page', 'per_page']));
        const schema = op.responses['200'].content['application/json'].schema;
        expect(schema.properties.data.type).toBe('array');
      }
      expect(
        Object.keys(doc.paths).filter((p) => p.includes('{')),
      ).not.toContain('/v1/clients');
    });

    it('lists the reference collections', async () => {
      const products = await get('/v1/products').expect(200);
      expect(products.body.total).toBe(11); // 'Legal Plan' is soft-deleted
      const withDeleted = await get('/v1/products?includeDeleted=true').expect(
        200,
      );
      expect(withDeleted.body.total).toBe(12);
      const types = await get('/v1/plan-types?line=Medical').expect(200);
      expect(
        types.body.data.every((t: { line: string }) => t.line === 'Medical'),
      ).toBe(true);
      expect(types.body.total).toBeGreaterThan(0);
      const funding = await get('/v1/funding-types').expect(200);
      expect(funding.body.data.map((f: { name: string }) => f.name)).toContain(
        'Self-Funded',
      );
    });

    it('fills incumbency and final credits for a client on /v1/carriers', async () => {
      const res = await get(
        '/v1/carriers?clientOneCode=IC100100&per_page=100',
      ).expect(200);
      expect(
        res.body.data.some(
          (c: { incumbentFor: string[] }) => c.incumbentFor.length > 0,
        ),
      ).toBe(true);
      const plain = await get('/v1/carriers').expect(200);
      expect(
        plain.body.data.every(
          (c: { incumbentFor: string[] }) => c.incumbentFor.length === 0,
        ),
      ).toBe(true);
      expect(
        plain.body.data.map((c: { name: string }) => c.name),
      ).not.toContain('Great Western Mutual');
    });

    it('flattens plan financials on /v1/financials and /v1/plan-designs', async () => {
      const fin = await get(
        '/v1/financials?clientOneCode=IC100100&line=Medical&planYear=2026',
      ).expect(200);
      expect(fin.body.data[0]).toMatchObject({
        clientOneCode: 'IC100100',
        line: 'Medical',
        planYear: 2026,
        planType: expect.any(String),
        rateFamily: expect.any(Number),
        ratePer1000: null,
      });
      const designs = await get(
        '/v1/plan-designs?clientOneCode=IC100100',
      ).expect(200);
      expect(designs.body.data.length).toBeGreaterThan(0);
      expect(designs.body.data[0]).toMatchObject({
        clientOneCode: 'IC100100',
        clientName: expect.any(String),
      });
    });

    it('serves policies and census rows', async () => {
      const pol = await get('/v1/policies?clientOneCode=IC100100').expect(200);
      expect(pol.body.data[0]).toMatchObject({
        kickOffDays: expect.any(Number),
        coverages: expect.any(Number),
      });
      const census = await get(
        '/v1/census?clientOneCode=IC100100&year=2026',
      ).expect(200);
      expect(census.body.data).toHaveLength(1);
      expect(census.body.data[0]).toMatchObject({
        effectiveYear: '2026',
        totalEmployees: expect.any(Number),
      });
    });

    it('returns the program with carriers and plan year 2026', async () => {
      const res = await get('/v1/clients/IC100100/program').expect(200);
      expect(res.body.carriers.length).toBeGreaterThan(0);
      const plans = res.body.lines.flatMap(
        (l: { plans: unknown[] }) => l.plans,
      ) as {
        carrier: string;
        financials: { planYear: number } | null;
      }[];
      expect(plans.length).toBeGreaterThan(0);
      expect(plans.every((p) => p.carrier)).toBe(true);
      expect(plans.some((p) => p.financials?.planYear === 2026)).toBe(true);
      const medical = await get(
        '/v1/clients/IC100100/program?line=Medical',
      ).expect(200);
      expect(medical.body.lines.map((l: { line: string }) => l.line)).toEqual([
        'Medical',
      ]);
    });

    it('computes renewal dates from the plan year and the kick-off timing', async () => {
      const res = await get('/v1/clients/IC100100/renewals').expect(200);
      expect(res.body.planYear).toBe(2026);
      const r = res.body.renewals.find(
        (x: { kickOffTiming: unknown }) => x.kickOffTiming,
      );
      expect(r.effectiveDate).toBe('2027-01-01');
      const days = r.kickOffTiming.days as number;
      expect(r.kickOffDate).toBe(
        new Date(Date.UTC(2027, 0, 1 - days)).toISOString().slice(0, 10),
      );
    });

    it('serves client, plan, financials, census, commercials and wizards', async () => {
      const client = await get('/v1/clients/IC100100').expect(200);
      expect(client.body.client).toMatchObject({
        oneCode: 'IC100100',
        deleted: false,
      });
      expect(client.body.lines[0]).toMatchObject({
        line: expect.any(String),
        status: expect.any(String),
      });

      const planId = (await get('/v1/clients/IC100100/program?line=Medical'))
        .body.lines[0].plans[0].planDesignId as string;
      const plan = await get(`/v1/clients/IC100100/plans/${planId}`).expect(
        200,
      );
      expect(plan.body.planFinancial).toMatchObject({ planYear: 2026 });
      expect(Array.isArray(plan.body.eligibilityVersions)).toBe(true);
      const missing = await get(
        '/v1/clients/IC100100/plans/000000000000000000000000',
      ).expect(404);
      expect(missing.body.message).toBe(
        'Plan design "000000000000000000000000" not found for client "IC100100"',
      );

      const fin = await get(
        '/v1/clients/IC100100/financials?planYear=2026',
      ).expect(200);
      expect(fin.body.planYear).toBe(2026);
      expect(fin.body.totals.annualPremium).toBeGreaterThan(0);

      const census = await get('/v1/clients/IC100100/census').expect(200);
      expect(census.body.years[0]).toBe(census.body.selected.effectiveYear);
      expect(census.body.selected.byState.length).toBeGreaterThan(0);

      const commercials = await get('/v1/clients/IC100100/commercials').expect(
        200,
      );
      expect(commercials.body).toEqual(
        expect.objectContaining({
          contributions: expect.any(Array),
          carrierCredits: expect.any(Array),
        }),
      );
      const wizards = await get('/v1/clients/IC100100/wizards').expect(200);
      expect(wizards.body.wizards).toEqual(expect.any(Array));
    });

    it('answers 404 for an unknown client on every per-client route', async () => {
      for (const sub of [
        '',
        '/renewals',
        '/program',
        '/plans/x',
        '/financials',
        '/census',
        '/commercials',
        '/wizards',
      ]) {
        const res = await get(`/v1/clients/NOPE${sub}`).expect(404);
        expect(res.body).toMatchObject({
          statusCode: 404,
          code: 'not_found',
          message: 'Client "NOPE" not found',
        });
      }
    });

    it('cannot write through a read (READ ONLY transaction)', async () => {
      const db = app.get(DbService);
      await expect(
        db.readOnly((c) =>
          c.query(
            `UPDATE ${INTELLIFY_DB.schema}.clients SET name = name WHERE false`,
          ),
        ),
      ).rejects.toMatchObject({ code: '25006' });
      // and nothing a read leaves behind: the transaction is rolled back
      const after = await get('/v1/clients?per_page=1').expect(200);
      expect(after.body.total).toBe(nonDeletedClients);
    });
  });
  describe('rfp records and package', () => {
    const CREATED_BY = 'test:u3';
    const send = (
      method: 'post' | 'put' | 'patch' | 'delete',
      path: string,
      body?: unknown,
    ) => {
      const req = request(base)[method](path).set('X-API-Key', API_KEY);
      return body === undefined ? req : req.send(body as object);
    };

    /** Entries of a stored zip, read from its local headers. */
    const unzipNames = (zip: Buffer): string[] => {
      const names: string[] = [];
      let at = 0;
      while (at + 30 <= zip.length && zip.readUInt32LE(at) === 0x04034b50) {
        const size = zip.readUInt32LE(at + 18);
        const nameLength = zip.readUInt16LE(at + 26);
        const extra = zip.readUInt16LE(at + 28);
        names.push(zip.subarray(at + 30, at + 30 + nameLength).toString());
        at += 30 + nameLength + extra + size;
      }
      return names;
    };
    const binary = (
      res: request.Response,
      cb: (e: Error | null, b: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };

    afterAll(async () => {
      // Every record this block made, drafts or not.
      const pool = new Pool({ ...INTELLIFY_DB, max: 1 });
      try {
        await pool.query('DELETE FROM rfp.rfps WHERE created_by = $1', [
          CREATED_BY,
        ]);
      } finally {
        await pool.end();
      }
    });

    it('creates an RFP, builds it up and exports the package', async () => {
      const created = await send('post', '/v1/rfps', {
        clientOneCode: 'IC100100',
        planYear: 2027,
        createdBy: CREATED_BY,
      }).expect(201);
      const id = created.body.id as string;
      expect(created.body).toMatchObject({
        clientOneCode: 'IC100100',
        planYear: 2027,
        effectiveDate: '2027-01-01',
        status: 'draft',
        stage: 1,
        createdBy: CREATED_BY,
        lines: [],
      });
      expect(created.body.title).toBe(
        `${created.body.clientName} — 2027 benefits RFP`,
      );

      const dental = (
        await get('/v1/plan-designs?clientOneCode=IC100100&line=Dental')
      ).body.data as { id: string }[];
      await send('put', `/v1/rfps/${id}/lines`, [
        { line: 'Medical', marketBasis: 'as-is', planDesignIds: [] },
        {
          line: 'dental',
          marketBasis: 'alternate',
          planDesignIds: [dental[0].id],
          alternateFunding: 'Fully Insured',
        },
      ]).expect(200);
      await send('put', `/v1/rfps/${id}/carriers`, [
        { insurer: 'aetna', lines: ['Medical'], incumbent: true },
        { insurer: 'Delta Dental', lines: ['Dental'] },
      ]).expect(200);
      await send('put', `/v1/rfps/${id}/requirements`, [
        {
          section: 'Network',
          question: 'Describe your network.',
          answerType: 'text',
        },
        {
          section: 'Pricing',
          question: 'Rate guarantee (months)?',
          required: false,
          answerType: 'number',
        },
      ]).expect(200);
      await send('put', `/v1/rfps/${id}/timeline`, [
        { milestone: 'RFP issued', dueDate: '2026-11-02', owner: 'Consultant' },
        { milestone: 'Responses due', dueDate: '2026-11-30' },
      ]).expect(200);

      const rfp = (await get(`/v1/rfps/${id}`).expect(200)).body;
      expect(
        rfp.lines.map((l: { position: number; line: string }) => [
          l.position,
          l.line,
        ]),
      ).toEqual([
        [1, 'Medical'],
        [2, 'Dental'],
      ]);
      expect(rfp.lines[0].productId).toMatch(/^[0-9a-f]{24}$/);
      expect(
        rfp.carriers.map((c: { insurerName: string }) => c.insurerName),
      ).toEqual(['Aetna', 'Delta Dental']);
      expect(
        rfp.requirements.map((r: { position: number }) => r.position),
      ).toEqual([1, 2]);
      expect(rfp.timeline.map((m: { dueDate: string }) => m.dueDate)).toEqual([
        '2026-11-02',
        '2026-11-30',
      ]);

      const patched = await send('patch', `/v1/rfps/${id}`, {
        stage: 6,
        sections: { executiveSummary: 'Orchard seeks quotes.' },
      }).expect(200);
      expect(patched.body.sections).toEqual({
        executiveSummary: 'Orchard seeks quotes.',
      });
      expect(patched.body.updatedAt > created.body.updatedAt).toBe(true);

      const list = await get(`/v1/rfps?createdBy=${CREATED_BY}`).expect(200);
      expect(list.body.data[0]).toMatchObject({
        id,
        lines: 2,
        carriers: 2,
        requirements: 2,
        milestones: 2,
      });

      const md = await get(`/v1/rfps/${id}/document.md`).expect(200);
      expect(md.headers['content-type']).toContain('text/markdown');
      expect(md.text).toContain('## 3. Scope of this RFP');
      expect(md.text).toContain('Aetna');
      expect(md.text).toContain('Delta Dental');

      const pdf = await get(`/v1/rfps/${id}/document.pdf`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

      const exhibits = await get(`/v1/rfps/${id}/exhibits`).expect(200);
      expect(
        exhibits.body.exhibits.map((e: { name: string }) => e.name),
      ).toEqual([
        'exhibit-a-census',
        'exhibit-b-plan-designs',
        'exhibit-c-financials',
        'exhibit-d-carriers',
      ]);
      const csv = await get(
        `/v1/rfps/${id}/exhibits/exhibit-d-carriers.csv`,
      ).expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text.split('\r\n')[0]).toBe(
        'position,insurerName,lines,incumbent,contactEmail,notes',
      );
      await get(`/v1/rfps/${id}/exhibits/exhibit-z.csv`).expect(404);

      const zip = await get(`/v1/rfps/${id}/package.zip`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(zip.headers['content-type']).toBe('application/zip');
      expect(unzipNames(zip.body as Buffer)).toEqual([
        'rfp.md',
        'rfp.pdf',
        'exhibits/exhibit-a-census.csv',
        'exhibits/exhibit-b-plan-designs.csv',
        'exhibits/exhibit-c-financials.csv',
        'exhibits/exhibit-d-carriers.csv',
        'manifest.json',
      ]);
    });

    it('refuses unknown clients, carriers, lines and plan designs', async () => {
      const bad = await send('post', '/v1/rfps', {
        clientOneCode: 'NOPE',
        planYear: 2027,
        createdBy: CREATED_BY,
      }).expect(400);
      expect(bad.body.code).toBe('validation');
      await send('post', '/v1/rfps', {
        clientOneCode: 'IC100100',
        planYear: 2040,
      }).expect(400);

      const id = (
        await send('post', '/v1/rfps', {
          clientOneCode: 'IC100100',
          planYear: 2027,
          createdBy: CREATED_BY,
        }).expect(201)
      ).body.id as string;
      const carrier = await send('put', `/v1/rfps/${id}/carriers`, [
        { insurer: 'Acme Insurance', lines: ['Medical'] },
      ]).expect(400);
      expect(carrier.body.message).toMatch(
        /^Unknown carrier "Acme Insurance"\. Known: Aetna/,
      );
      const lines = await send('put', `/v1/rfps/${id}/lines`, [
        { line: 'Pet', marketBasis: 'as-is' },
        {
          line: 'Medical',
          marketBasis: 'as-is',
          planDesignIds: ['000000000000000000000000'],
        },
      ]).expect(400);
      expect(lines.body.details).toHaveLength(2);
      await send('put', `/v1/rfps/${id}/timeline`, [
        { milestone: 'x', dueDate: 'soon' },
      ]).expect(400);
      await send('patch', `/v1/rfps/${id}`, { stage: 9 }).expect(400);
      await send('patch', `/v1/rfps/${id}`, { sections: { foo: 'x' } }).expect(
        400,
      );
      await get('/v1/rfps/00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('moves status forward only and deletes drafts only', async () => {
      const id = (
        await send('post', '/v1/rfps', {
          clientOneCode: 'IC100100',
          planYear: 2027,
          createdBy: CREATED_BY,
        }).expect(201)
      ).body.id as string;
      await send('patch', `/v1/rfps/${id}`, { status: 'issued' }).expect(200);
      const back = await send('patch', `/v1/rfps/${id}`, {
        status: 'draft',
      }).expect(409);
      expect(back.body.code).toBe('conflict');
      const del = await send('delete', `/v1/rfps/${id}`).expect(409);
      expect(del.body.code).toBe('conflict');
    });

    it('takes createdBy from X-Qti-User and bulk-deletes the drafts', async () => {
      const draft = await send('post', '/v1/rfps', {
        clientOneCode: 'IC100100',
        planYear: 2028,
      })
        .set('X-Qti-User', CREATED_BY)
        .expect(201);
      expect(draft.body.createdBy).toBe(CREATED_BY);
      await send('delete', '/v1/rfps').expect(400);
      const res = await send(
        'delete',
        `/v1/rfps?createdBy=${CREATED_BY}`,
      ).expect(200);
      expect(res.body.deleted).toBeGreaterThanOrEqual(1);
      const left = await get(
        `/v1/rfps?createdBy=${CREATED_BY}&status=draft`,
      ).expect(200);
      expect(left.body.total).toBe(0);
      // The issued one survives the bulk delete (drafts only).
      const all = await get(`/v1/rfps?createdBy=${CREATED_BY}`).expect(200);
      expect(
        all.body.data.every((r: { status: string }) => r.status !== 'draft'),
      ).toBe(true);
      await get(`/v1/rfps/${draft.body.id}`).expect(404);
    });
  });
});
