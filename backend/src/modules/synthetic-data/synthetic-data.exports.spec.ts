/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access -- jest fakes */
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasources/connectors/postgres-profiling', () => ({
  PostgresProfiler: class {},
}));
jest.mock('../datasources/connectors/databricks-profiling', () => ({
  DatabricksProfiler: class {},
}));
jest.mock('../datasets/datasets.service', () => ({
  DatasetsService: class {},
}));

import { Logger } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { EventEmitter } from 'events';
import { strFromU8, unzipSync } from 'fflate';
import { Writable } from 'stream';
import {
  column,
  fkCol,
  idCol,
  profile as makeProfile,
  rel,
  table,
  worldCupProfile,
} from './generator/world-cup-profile.stub';
import { writeChunks } from './http-stream';
import { ProfileCache } from './profile-cache';
import { SyntheticDataController } from './synthetic-data.controller';
import { SyntheticDataService } from './synthetic-data.service';
import type { SampledProfile } from './types';

class FakeRes extends Writable {
  statusCode = 0;
  headers: Record<string, string> = {};
  parts: Buffer[] = [];
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(k: string, v: string) {
    this.headers[k.toLowerCase()] = v;
  }
  _write(chunk: Buffer, _e: string, cb: () => void) {
    this.parts.push(Buffer.from(chunk));
    cb();
  }
  get body(): Buffer {
    return Buffer.concat(this.parts);
  }
  get text(): string {
    return this.body.toString('utf8');
  }
}

const SECRET_NAME = 'Zlatan-Secret-Ibrahimovic';

function smallProfile(
  dialect: 'postgres' | 'databricks' = 'postgres',
): SampledProfile {
  const p = makeProfile(
    [
      table('teams', [idCol(), column('name', 'text')]),
      table('players', [
        idCol(),
        column('name', 'text'),
        fkCol('team_id'),
        column('born', 'date', { semanticType: 'temporal', kind: 'temporal' }),
      ]),
      table('broken', [idCol()]),
    ],
    [rel('players', ['team_id'], 'teams')],
  );
  p.dialect = dialect;
  p.sampleSize = 5;
  return p;
}

const KEY = (n: string) => `world_cup.public.${n}`;

function setup(profile: SampledProfile, sample?: jest.Mock) {
  const cache = new ProfileCache(() => 1_700_000_000_000);
  const cacheSet = jest.spyOn(cache, 'set');
  cache.set(profile);
  cacheSet.mockClear();
  const sampleTable =
    sample ??
    jest.fn(async (_c: unknown, ns: string, name: string) => {
      if (name === 'broken') throw new Error('permission denied');
      return {
        namespace: ns,
        table: name,
        rowCountEstimate: 2,
        method: 'full' as const,
        columns: ['id', 'name', 'team_id', 'born'],
        rows:
          name === 'teams'
            ? [
                { id: '1', name: 'Sweden' },
                { id: '2', name: 'Brazil' },
              ]
            : [
                {
                  id: '10',
                  name: SECRET_NAME,
                  team_id: '1',
                  born: '1981-10-03',
                },
                { id: '11', name: 'Neymar', team_id: '2', born: '1992-02-05' },
              ],
        durationMs: 1,
      };
    });
  const scoped = {
    tables: jest.fn().mockResolvedValue([]),
    keys: jest.fn().mockResolvedValue([]),
    foreignKeys: jest.fn().mockResolvedValue([]),
    sampleTable,
  };
  const profiler = {
    withSessions: jest.fn(
      async (
        _c: unknown,
        _n: number,
        _s: AbortSignal | undefined,
        fn: (s: unknown) => Promise<unknown>,
      ) => fn(scoped),
    ),
  };
  const datasources = {
    get: jest.fn().mockResolvedValue({
      id: profile.datasourceId,
      name: 'DS',
      kind: profile.dialect,
      config: { database: 'world_cup' },
    }),
  };
  const service = new SyntheticDataService(
    { list: jest.fn() } as never,
    datasources as never,
    profiler as never,
    profiler as never,
    cache,
    jest.fn() as never,
  );
  const controller = new SyntheticDataController(service);
  return { service, controller, cache, cacheSet, sampleTable, datasources };
}

const id = (p: SampledProfile) => p.profileId;

async function status(p: () => unknown): Promise<[number, string]> {
  try {
    await p();
  } catch (e) {
    const x = e as { getStatus(): number; message: string };
    return [x.getStatus(), x.message];
  }
  throw new Error('did not throw');
}

describe('#112 POST /synthetic-data/scripts', () => {
  it('errors, in the spec order and with its texts', async () => {
    const p = smallProfile();
    const { service } = setup(p);
    expect(await status(() => service.synthetic({}))).toEqual([
      400,
      'profileId is required',
    ]);
    expect(await status(() => service.synthetic({ profileId: 'zz' }))).toEqual([
      404,
      'Profile "zz" expired or not found: profile the tables again',
    ]);
    const bad = (extra: object) =>
      status(() => service.synthetic({ profileId: id(p), ...extra }));
    expect(await bad({ format: 'pdf' })).toEqual([
      400,
      'format must be sql, csv or xlsx',
    ]);
    expect(await bad({ defaultRowCount: 0 })).toEqual([
      400,
      'Row counts must be whole numbers from 1 to 10,000',
    ]);
    expect(await bad({ rowCounts: { nope: 3 } })).toEqual([
      400,
      '"nope" is not a table of this profile',
    ]);
    const big = makeProfile(
      Array.from({ length: 21 }, (_, i) => table(`t${i}`, [idCol()])),
      [],
    );
    const c = setup(big);
    expect(
      await status(() =>
        c.service.synthetic({ profileId: id(big), defaultRowCount: 10000 }),
      ),
    ).toEqual([400, 'A script holds at most 200,000 rows']);
  });

  it('refuses a bad seed and targetSchema per dialect before any header', async () => {
    const pg = smallProfile();
    const dbx = smallProfile('databricks');
    const a = setup(pg);
    expect(
      await status(() => a.service.synthetic({ profileId: id(pg), seed: -1 })),
    ).toEqual([400, 'seed must be a whole number from 0 to 2147483647']);
    expect(
      await status(() =>
        a.service.synthetic({ profileId: id(pg), targetSchema: 'a.b' }),
      ),
    ).toEqual([
      400,
      'targetSchema must be a plain identifier (letters, digits, underscores)',
    ]);
    const b = setup(dbx);
    expect(
      await status(() =>
        b.service.synthetic({ profileId: id(dbx), targetSchema: 'a b' }),
      ),
    ).toEqual([
      400,
      'targetSchema must be schema or catalog.schema (letters, digits, underscores)',
    ]);
    const res = new FakeRes();
    await expect(
      b.controller.scripts({ profileId: 'zz' }, res as never),
    ).rejects.toBeDefined();
    expect(res.statusCode).toBe(0);
    expect(res.headers).toEqual({});
  });

  it.each([
    ['postgres', 'world-cup-synthetic-postgresql-seed3.sql'],
    ['databricks', 'world-cup-synthetic-databricks-seed3.sql'],
  ] as const)('sql for a %s profile: headers and body', async (d, file) => {
    const p = smallProfile(d);
    const { controller } = setup(p);
    const res = new FakeRes();
    await controller.scripts(
      { profileId: id(p), seed: 3, defaultRowCount: 4 },
      res as never,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/sql; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="${file}"`,
    );
    expect(res.headers['x-script-rows']).toBe('12');
    expect(res.headers['x-script-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(res.text).toContain('CREATE TABLE');
    expect(res.text).toContain(res.headers['x-script-sha256']);
    expect(res.text.includes('\r')).toBe(false);
  });

  it('the hash is stable for the same request and differs for another seed', async () => {
    const p = worldCupProfile();
    const { controller } = setup(p);
    const hash = async (seed: number) => {
      const res = new FakeRes();
      await controller.scripts(
        { profileId: id(p), seed, defaultRowCount: 5 },
        res as never,
      );
      return res.headers['x-script-sha256'];
    };
    const a = await hash(1);
    expect(await hash(1)).toBe(a);
    expect(await hash(2)).not.toBe(a);
  });

  it('csv: a zip with one csv per table and a README, and X-Export-Rows', async () => {
    const p = smallProfile('databricks');
    const { controller } = setup(p);
    const res = new FakeRes();
    await controller.scripts(
      { profileId: id(p), format: 'csv', defaultRowCount: 3 },
      res as never,
    );
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="world-cup-synthetic-seed1-csv.zip"',
    );
    expect(res.headers['x-export-rows']).toBe('9');
    const files = unzipSync(new Uint8Array(res.body));
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'broken.csv',
      'players.csv',
      'teams.csv',
    ]);
    expect(strFromU8(files['README.txt'])).toContain('Synthetic data');
  });

  it('xlsx: a workbook with About and one sheet per table', async () => {
    const p = smallProfile();
    const { controller } = setup(p);
    const res = new FakeRes();
    await controller.scripts(
      { profileId: id(p), format: 'xlsx', defaultRowCount: 2 },
      res as never,
    );
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="world-cup-synthetic-seed1.xlsx"',
    );
    expect(res.headers['x-export-rows']).toBe('6');
    const wb = new Workbook();
    await wb.xlsx.load(res.body as never);
    expect(wb.worksheets.map((w) => w.name).sort()).toEqual([
      'About',
      'broken',
      'players',
      'teams',
    ]);
  });
});

describe('#113 POST /synthetic-data/profile-exports', () => {
  it('errors with the spec texts', async () => {
    const p = smallProfile();
    const { service } = setup(p);
    expect(await status(() => service.profileExport({}))).toEqual([
      400,
      'profileId is required',
    ]);
    expect(
      await status(() => service.profileExport({ profileId: 'q' })),
    ).toEqual([
      404,
      'Profile "q" expired or not found: profile the tables again',
    ]);
    expect(
      await status(() =>
        service.profileExport({ profileId: id(p), format: 'sql' }),
      ),
    ).toEqual([400, 'format must be csv or xlsx']);
  });

  it('csv and xlsx', async () => {
    const p = smallProfile();
    const { controller } = setup(p);
    const csv = new FakeRes();
    await controller.profileExports(
      { profileId: id(p), format: 'csv' },
      csv as never,
    );
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['content-disposition']).toBe(
      'attachment; filename="world-cup-profile.csv"',
    );
    expect(csv.text).toContain('teams');
    const x = new FakeRes();
    await controller.profileExports(
      { profileId: id(p), format: 'xlsx' },
      x as never,
    );
    expect(x.headers['content-disposition']).toBe(
      'attachment; filename="world-cup-profile.xlsx"',
    );
    const wb = new Workbook();
    await wb.xlsx.load(x.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Tables', 'Columns']);
  });
});

describe('#114 POST /synthetic-data/sample-exports', () => {
  it('errors in the spec order', async () => {
    const p = smallProfile();
    const { service, sampleTable } = setup(p);
    const run = (b: Record<string, unknown>) =>
      status(() => service.sampleExport(b));
    expect(await run({})).toEqual([400, 'profileId is required']);
    expect(await run({ profileId: 'q', confirmRealData: true })).toEqual([
      404,
      'Profile "q" expired or not found: profile the tables again',
    ]);
    expect(await run({ profileId: id(p), format: 'zzz' })).toEqual([
      400,
      'confirmRealData must be true: this export contains real rows',
    ]);
    expect(
      await run({ profileId: id(p), format: 'zzz', confirmRealData: 'yes' }),
    ).toEqual([
      400,
      'confirmRealData must be true: this export contains real rows',
    ]);
    expect(
      await run({ profileId: id(p), format: 'zzz', confirmRealData: true }),
    ).toEqual([400, 'format must be sql, csv or xlsx']);
    expect(
      await run({
        profileId: id(p),
        format: 'sql',
        targetSchema: 'a-b',
        confirmRealData: true,
      }),
    ).toEqual([
      400,
      'targetSchema must be a plain identifier (letters, digits, underscores)',
    ]);
    expect(sampleTable).not.toHaveBeenCalled();
  });

  it('re-reads with the profile keys and sample size, writes real values, no FK, a failed table is a note', async () => {
    const p = smallProfile();
    const { controller, sampleTable } = setup(p);
    const res = new FakeRes();
    await controller.sampleExports(
      { profileId: id(p), format: 'sql', confirmRealData: true },
      res as never,
    );
    expect(sampleTable.mock.calls.map((c) => c[2])).toEqual([
      'teams',
      'players',
      'broken',
    ]);
    for (const c of sampleTable.mock.calls) {
      expect(c[3]).toEqual({ sampleSize: 5, repeatableSeed: 7 });
    }
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="world-cup-sample-postgresql.sql"',
    );
    expect(res.headers['x-script-rows']).toBe('4');
    expect(res.text).toContain(SECRET_NAME);
    expect(res.text).toContain('Neymar');
    expect(res.text).not.toMatch(/ALTER TABLE|REFERENCES|PRIMARY KEY/);
    expect(res.text).toContain('"sample"');
    expect(res.text).toContain(`${KEY('broken')}: permission denied`);
    expect(res.text).toContain(
      'Keys and constraints are not included: the sample',
    );
    expect(res.text).toContain('Sample rows (REAL DATA)');
  });

  it('csv and xlsx hold the real rows; X-Export-Rows is the rows read', async () => {
    const p = smallProfile('databricks');
    const { controller } = setup(p);
    const csv = new FakeRes();
    await controller.sampleExports(
      { profileId: id(p), format: 'csv', confirmRealData: true },
      csv as never,
    );
    expect(csv.headers['content-disposition']).toBe(
      'attachment; filename="world-cup-sample-csv.zip"',
    );
    expect(csv.headers['x-export-rows']).toBe('4');
    const files = unzipSync(new Uint8Array(csv.body));
    expect(strFromU8(files['players.csv'])).toContain(SECRET_NAME);
    expect(strFromU8(files['broken.csv'])).toBe('id\r\n');
    const x = new FakeRes();
    await controller.sampleExports(
      { profileId: id(p), format: 'xlsx', confirmRealData: true },
      x as never,
    );
    expect(x.headers['content-disposition']).toBe(
      'attachment; filename="world-cup-sample.xlsx"',
    );
    const wb = new Workbook();
    await wb.xlsx.load(x.body as never);
    expect(wb.getWorksheet('players')?.getRow(2).getCell(2).value).toBe(
      SECRET_NAME,
    );
  });

  it('never logs or caches a raw value', async () => {
    const p = smallProfile();
    const { controller, cacheSet } = setup(p);
    const seen: string[] = [];
    const spies = (
      ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const
    ).map((m) =>
      jest
        .spyOn(Logger.prototype, m)
        .mockImplementation(
          (...a: unknown[]) => void seen.push(JSON.stringify(a)),
        ),
    );
    const spyStatic = jest
      .spyOn(Logger, 'error')
      .mockImplementation(
        (...a: unknown[]) => void seen.push(JSON.stringify(a)),
      );
    for (const format of ['sql', 'csv', 'xlsx']) {
      await controller.sampleExports(
        { profileId: id(p), format, confirmRealData: true },
        new FakeRes() as never,
      );
    }
    // A failing write logs the error name only.
    const bad = new FakeRes();
    bad._write = () => {
      throw new Error(`boom ${SECRET_NAME}`);
    };
    bad.on('error', () => undefined);
    await controller.sampleExports(
      { profileId: id(p), format: 'sql', confirmRealData: true },
      bad as never,
    );
    spies.forEach((s) => s.mockRestore());
    spyStatic.mockRestore();
    expect(seen.join('')).not.toContain(SECRET_NAME);
    expect(seen.join('')).not.toContain('Neymar');
    expect(cacheSet).not.toHaveBeenCalled();
    expect(JSON.stringify(p)).not.toContain(SECRET_NAME);
  });

  it('a client disconnect aborts the re-read', async () => {
    const p = smallProfile();
    const res = new FakeRes();
    const sample = jest.fn(async (_c: unknown, ns: string, name: string) => {
      // The client goes away while the first table is read.
      res.emit('close');
      return {
        namespace: ns,
        table: name,
        rowCountEstimate: 0,
        method: 'full' as const,
        columns: [],
        rows: [],
        durationMs: 1,
      };
    });
    const { controller } = setup(p, sample);
    await expect(
      controller.sampleExports(
        { profileId: id(p), format: 'sql', confirmRealData: true },
        res as never,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(sample.mock.calls.length).toBeLessThan(3);
    expect(res.statusCode).toBe(0);
  });
});

describe('streaming', () => {
  it('waits for drain when write returns false', async () => {
    const out = new EventEmitter() as EventEmitter & {
      destroyed: boolean;
      write: jest.Mock;
      end: jest.Mock;
    };
    out.destroyed = false;
    const order: string[] = [];
    out.write = jest.fn((c: string) => {
      order.push(`write:${c}`);
      setImmediate(() => {
        order.push('drain');
        out.emit('drain');
      });
      return false;
    });
    out.end = jest.fn((cb: () => void) => {
      order.push('end');
      cb();
    });
    await writeChunks(out as never, ['a', 'b']);
    expect(order).toEqual(['write:a', 'drain', 'write:b', 'drain', 'end']);
  });

  it('destroys the response when the body fails after the headers', async () => {
    const p = smallProfile();
    const { controller } = setup(p);
    const res = new FakeRes();
    res._write = () => {
      throw new Error('disk gone');
    };
    const errors: Error[] = [];
    res.on('error', (e) => errors.push(e));
    await controller.scripts({ profileId: id(p) }, res as never);
    expect(res.destroyed).toBe(true);
    expect(res.headers['content-type']).toContain('application/sql');
  });
});
