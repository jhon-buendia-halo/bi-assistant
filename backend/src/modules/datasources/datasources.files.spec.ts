// The other kinds' drivers are not needed here and pull in heavy packages.
jest.mock('./connectors/databricks.connector', () => ({
  DatabricksConnector: class {},
}));
jest.mock('./connectors/postgres.connector', () => ({
  PostgresConnector: class {},
}));
jest.mock('./connectors/rest.connector', () => ({
  RestConnector: class {},
}));

import {
  PayloadTooLargeException,
  type INestApplication,
} from '@nestjs/common';
import { Readable } from 'stream';
import { Test } from '@nestjs/testing';
import { DuckDBInstance } from '@duckdb/node-api';
import { Workbook } from 'exceljs';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import type { Server } from 'http';
import { DatabricksConnector } from './connectors/databricks.connector';
import { FileConnector } from './connectors/file.connector';
import { FILE_UPLOAD_MAX_BYTES } from './connectors/file-storage';
import { PostgresConnector } from './connectors/postgres.connector';
import { RestConnector } from './connectors/rest.connector';
import { DatasourcesController } from './datasources.controller';
import { DatasourcesService } from './datasources.service';
import type {
  Datasource,
  FileDatasourceConfig,
  SourceFile,
} from './entities/datasource.entity';
import { DatasourcesRepository } from './repositories/datasources.repository';
import { InventoryCacheRepository } from './repositories/inventory-cache.repository';

/** The cap the tests inject instead of 200 MB. */
const CAP = 64 * 1024;
const PLAYERS = 'player,goals\nPelé,12\nMüller,14\nEusébio,9\n';

let dataDir: string;
const previousDataDir = process.env.APP_DATA_DIR;
let app: INestApplication;
let server: Server;
let service: DatasourcesService;
let docs: Map<string, Datasource>;
let snapshots: Map<string, unknown>;

/**
 * "Teams": two text rows on top (row 1 a group header, row 2 the column
 * names the user means), then 12 data rows. Detection proposes row 1.
 */
async function teamsWorkbook(sheet = 'Teams'): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.getCell('A1').value = 'Team';
  ws.getCell('B1').value = 'Stats';
  ws.getCell('A2').value = 'Name';
  ws.getCell('B2').value = 'Titles';
  for (let i = 0; i < 12; i++) {
    ws.getCell(`A${3 + i}`).value = `Team ${i + 1}`;
    ws.getCell(`B${3 + i}`).value = i;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function uploads(): string[] {
  const dir = join(dataDir, 'files', 'uploads');
  return existsSync(dir) ? readdirSync(dir) : [];
}

function upload(name: string, body: Buffer | string) {
  return request(server)
    .post('/datasources/files/uploads')
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', encodeURIComponent(name))
    .send(Buffer.isBuffer(body) ? body : Buffer.from(body));
}

async function uploaded(
  name: string,
  body: Buffer | string,
): Promise<SourceFile> {
  const res = await upload(name, body).expect(201);
  return (res.body as { file: SourceFile }).file;
}

async function saveFiles(
  files: SourceFile[],
  id?: string,
): Promise<{ ok: boolean; message: string; datasource?: { id: string } }> {
  const res = await request(server)
    .post('/datasources')
    .send({ id, name: 'Sheets', kind: 'file', config: { files } })
    .expect(201);
  return res.body as {
    ok: boolean;
    message: string;
    datasource?: { id: string };
  };
}

function storedFiles(id: string): SourceFile[] {
  return (docs.get(id)?.config as FileDatasourceConfig).files;
}

async function tableRows(id: string, entity: string): Promise<number> {
  const result = await service.sampleRows(id, entity, 100);
  return result.rows.length;
}

beforeAll(async () => {
  // Network is allowed in dev; a cached extension makes this a no-op.
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await connection.run('INSTALL excel');
  connection.closeSync();
  instance.closeSync();

  dataDir = mkdtempSync(join(tmpdir(), 'datasource-files-spec-'));
  process.env.APP_DATA_DIR = dataDir;
}, 60_000);

beforeEach(async () => {
  docs = new Map();
  snapshots = new Map();
  const repository = {
    list: () => Promise.resolve([...docs.values()]),
    get: (id: string) => Promise.resolve(docs.get(id) ?? null),
    save: (doc: Datasource) => {
      const saved = { ...doc, id: doc.id ?? 'generated' };
      docs.set(saved.id, saved);
      return Promise.resolve(saved);
    },
    delete: (id: string) => Promise.resolve(docs.delete(id) ? 1 : 0),
  };
  const inventoryCache = {
    get: (id: string) => Promise.resolve(snapshots.get(id) ?? null),
    save: (id: string, catalogs: unknown, fetchedAt: string) => {
      snapshots.set(id, { id, catalogs, fetchedAt });
      return Promise.resolve(snapshots.get(id));
    },
    delete: (id: string) => Promise.resolve(snapshots.delete(id) ? 1 : 0),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [DatasourcesController],
    providers: [
      DatasourcesService,
      FileConnector,
      { provide: DatasourcesRepository, useValue: repository },
      { provide: InventoryCacheRepository, useValue: inventoryCache },
      { provide: DatabricksConnector, useValue: {} },
      { provide: PostgresConnector, useValue: {} },
      { provide: RestConnector, useValue: {} },
      { provide: FILE_UPLOAD_MAX_BYTES, useValue: CAP },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  server = app.getHttpServer() as Server;
  service = moduleRef.get(DatasourcesService);
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
  else process.env.APP_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /datasources/files/uploads (api.md 156)', () => {
  it('streams the file to the uploads folder and answers its detected sheets', async () => {
    const res = await upload('Players 2026.csv', PLAYERS).expect(201);
    const { uploadId, file } = res.body as {
      uploadId: string;
      file: SourceFile;
    };

    expect(file).toMatchObject({
      name: 'Players 2026.csv',
      format: 'csv',
      sizeBytes: Buffer.byteLength(PLAYERS),
      schema: 'players_2026',
      uploadId,
      sheets: [
        {
          sheet: 'Players 2026',
          table: 'players_2026',
          include: true,
          headerRow: 1,
          range: 'A1:B4',
        },
      ],
    });
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      existsSync(
        join(dataDir, 'files', 'uploads', uploadId, 'Players 2026.csv'),
      ),
    ).toBe(true);
  });

  it('answers 413 for a body over the cap and leaves no file behind', async () => {
    const before = uploads();

    const res = await upload('big.csv', Buffer.alloc(CAP + 1, 'a')).expect(413);

    expect((res.body as { message: string }).message).toMatch(
      /^File is larger than /,
    );
    expect(uploads()).toEqual(before);
  });

  it('counts a body without a length and deletes the partial file over the cap', async () => {
    const before = uploads();
    const body = Readable.from([Buffer.alloc(CAP, 'a'), Buffer.alloc(8, 'a')]);

    await expect(
      service.uploadFile(body, 'big.csv', undefined, CAP),
    ).rejects.toThrow(PayloadTooLargeException);

    expect(uploads()).toEqual(before);
  });

  it('refuses .xls with the plan message', async () => {
    const res = await upload('old.xls', 'x').expect(400);

    expect((res.body as { message: string }).message).toBe(
      '.xls files are not supported — save the workbook as .xlsx',
    );
  });

  it('refuses any other extension with the plan message', async () => {
    const res = await upload('notes.txt', 'x').expect(400);

    expect((res.body as { message: string }).message).toBe(
      'Only .xlsx and .csv files can be imported',
    );
  });
});

describe('POST /datasources/files/preview (api.md 157)', () => {
  it('previews the sheet with a new header row in the plan shape', async () => {
    const file = await uploaded('teams.xlsx', await teamsWorkbook());
    expect(file.sheets[0]).toMatchObject({ headerRow: 1, range: 'A1:B14' });

    const res = await request(server)
      .post('/datasources/files/preview')
      .send({
        uploadId: file.uploadId,
        fileId: file.id,
        sheet: 'Teams',
        headerRow: 2,
      })
      .expect(200);

    const preview = res.body as Record<string, unknown> & {
      rows: { row: number; cells: unknown[] }[];
    };
    expect(preview).toMatchObject({
      sheet: 'Teams',
      headerRow: 2,
      range: 'A2:B14',
      totalRows: 12,
      columns: [
        { letter: 'A', name: 'Name', type: 'VARCHAR' },
        { letter: 'B', name: 'Titles', type: 'DOUBLE' },
      ],
      warnings: [],
    });
    // The grid starts at the sheet's first row, so the rows above the header show.
    expect(preview.rows.map((r) => r.row)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 13, 14,
    ]);
    expect(preview.rows[0].cells).toEqual(['Team', 'Stats']);
    expect(preview.rows[1].cells).toEqual(['Name', 'Titles']);
    expect(preview.rows[8].cells).toEqual(['Team 12', '11']);
  });

  it('answers 400 for a bad range', async () => {
    const file = await uploaded('teams.xlsx', await teamsWorkbook());

    const res = await request(server)
      .post('/datasources/files/preview')
      .send({
        uploadId: file.uploadId,
        fileId: file.id,
        sheet: 'Teams',
        range: 'B',
      })
      .expect(400);

    expect((res.body as { message: string }).message).toBe(
      'Range must look like A1:H200',
    );
  });
});

describe('DELETE /datasources/files/uploads/:uploadId (api.md 158)', () => {
  it('drops the unsaved upload', async () => {
    const file = await uploaded('players.csv', PLAYERS);

    await request(server)
      .delete(`/datasources/files/uploads/${file.uploadId}`)
      .expect(204);

    expect(uploads()).not.toContain(file.uploadId);
  });
});

describe('Test (16) of a file config', () => {
  it('imports into a throwaway database and counts tables and rows', async () => {
    const file = await uploaded('players.csv', PLAYERS);
    const before = uploads();

    const res = await request(server)
      .post('/datasources/test-connection')
      .send({ kind: 'file', config: { files: [file] } })
      .expect(201);

    expect(res.body).toEqual({
      ok: true,
      message: 'Imported 1 table · 3 rows',
    });
    expect(uploads()).toEqual(before);
  });

  it('answers the first failure as <file> · <sheet>: <cause>', async () => {
    const file = await uploaded('teams.xlsx', await teamsWorkbook());
    file.sheets[0].range = 'A1:B1';

    const res = await request(server)
      .post('/datasources/test-connection')
      .send({ kind: 'file', config: { files: [file] } })
      .expect(201);

    expect(res.body).toEqual({
      ok: false,
      message:
        'teams.xlsx · Teams: The header row must be in the range, above its last row',
    });
  });
});

describe('Save (18), replace and delete (19) of a file datasource', () => {
  it('moves the uploads, builds data.duckdb and stores the import facts', async () => {
    const file = await uploaded('players.csv', PLAYERS);

    const saved = await saveFiles([file]);

    expect(saved.ok).toBe(true);
    const id = saved.datasource!.id;
    const folder = join(dataDir, 'files', id);
    expect(existsSync(join(folder, 'originals', `${file.id}.csv`))).toBe(true);
    expect(existsSync(join(folder, 'data.duckdb'))).toBe(true);
    expect(uploads()).not.toContain(file.uploadId);
    const [stored] = storedFiles(id);
    expect(stored.uploadId).toBeUndefined();
    expect(stored.sheets[0]).toMatchObject({
      rowCount: 3,
      columns: [
        { name: 'player', type: 'VARCHAR' },
        { name: 'goals', type: 'BIGINT' },
      ],
    });
    expect(snapshots.has(id)).toBe(true);
    expect(await tableRows(id, 'file.players.players')).toBe(3);
  });

  it('keeps the previous database and stores nothing when the import fails', async () => {
    const file = await uploaded('teams.xlsx', await teamsWorkbook());
    const id = (await saveFiles([file])).datasource!.id;
    const before = JSON.stringify(docs.get(id));
    const [stored] = storedFiles(id);
    const broken = {
      ...stored,
      sheets: [{ ...stored.sheets[0], range: 'A1:B1' }],
    };

    const res = await saveFiles([broken], id);

    expect(res).toEqual({
      ok: false,
      message:
        'teams.xlsx · Teams: The header row must be in the range, above its last row',
    });
    expect(JSON.stringify(docs.get(id))).toBe(before);
    expect(await tableRows(id, 'file.teams.teams')).toBe(13);
  });

  it('keeps the entity keys when a file is replaced with the same sheet names', async () => {
    const first = await uploaded('teams.xlsx', await teamsWorkbook());
    const id = (await saveFiles([first])).datasource!.id;
    const replacement = await uploaded('Teams v2.xlsx', await teamsWorkbook());
    expect(replacement.schema).toBe('teams_v2');

    const res = await saveFiles([{ ...replacement, id: first.id }], id);

    expect(res.ok).toBe(true);
    const [stored] = storedFiles(id);
    expect(stored).toMatchObject({
      id: first.id,
      name: 'Teams v2.xlsx',
      schema: 'teams',
      sheets: [{ sheet: 'Teams', table: 'teams' }],
    });
    expect(await tableRows(id, 'file.teams.teams')).toBe(13);
  });

  it('deleting the datasource removes its folder', async () => {
    const file = await uploaded('players.csv', PLAYERS);
    const id = (await saveFiles([file])).datasource!.id;
    expect(existsSync(join(dataDir, 'files', id))).toBe(true);

    await request(server).delete(`/datasources/${id}`).expect(200);

    expect(existsSync(join(dataDir, 'files', id))).toBe(false);
  });
});

describe('The stale-upload sweep at backend start', () => {
  it('removes uploads older than 24 hours and keeps newer ones', async () => {
    const root = join(dataDir, 'files', 'uploads');
    const stale = join(root, 'stale-upload');
    const fresh = join(root, 'fresh-upload');
    for (const dir of [stale, fresh]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'a.csv'), 'a\n1\n');
    }
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(stale, old, old);

    await service.onApplicationBootstrap();

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});
