import { BadRequestException } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { SourceFile } from '../entities/datasource.entity';
import {
  FileConnector,
  withFileDatabase,
  type FileConnectorConfig,
} from './file.connector';
import type { PagedStatement } from './paged-sql.types';

let dir: string;
let config: FileConnectorConfig;
/** A real file the sandbox must not read. */
let outsidePath: string;

const sheet = (name: string, table: string, include = true) => ({
  sheet: name,
  table,
  include,
  headerRow: 1,
  range: 'A1:C4',
  excludeLastRow: false,
  allText: false,
});

const files: SourceFile[] = [
  {
    id: 'f1',
    name: 'Sales 2026.xlsx',
    format: 'xlsx',
    sizeBytes: 1,
    sha256: 'x',
    uploadedAt: '2026-11-17T00:00:00.000Z',
    schema: 'sales_2026',
    sheets: [
      sheet('Region Sales', 'region_sales'),
      sheet('Notes', 'notes', false),
    ],
  },
  {
    id: 'f2',
    name: 'players.csv',
    format: 'csv',
    sizeBytes: 1,
    sha256: 'y',
    uploadedAt: '2026-11-17T00:00:00.000Z',
    schema: 'players',
    sheets: [sheet('players', 'players')],
  },
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'file-connector-spec-'));
  const databasePath = join(dir, 'data.duckdb');
  outsidePath = join(dir, 'outside.csv');
  writeFileSync(outsidePath, 'secret\n42\n');
  const instance = await DuckDBInstance.create(databasePath);
  const connection = await instance.connect();
  await connection.run(`
    CREATE SCHEMA sales_2026;
    CREATE TABLE sales_2026.region_sales AS
      SELECT * FROM (VALUES
        ('North', 10.0, 25.0), ('South', 4.0, 12.0), ('East', 6.0, 9.0),
        ('north-west', 1.0, 2.5)
      ) v("Region", "Units", "Revenue");
    CREATE SCHEMA players;
    CREATE TABLE players.players AS
      SELECT * FROM (VALUES ('Pelé', 12::BIGINT), ('Müller', 14::BIGINT)) v(player, goals);
    CHECKPOINT;
  `);
  connection.closeSync();
  instance.closeSync();
  config = { files, databasePath };
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const connector = new FileConnector();

describe('FileConnector summary and mask', () => {
  it('counts files and included tables', () => {
    expect(connector.summary(config)).toBe('2 files · 2 tables');
    expect(connector.summary({ ...config, files: [files[1]] })).toBe(
      '1 file · 1 table',
    );
  });

  it('masks nothing: a file config has no secret', () => {
    expect(connector.mask(config)).toBe(config);
  });
});

describe('FileConnector.inventory', () => {
  it('lists file.<schema>.<table> with DuckDB types', async () => {
    const catalogs = await connector.inventory(config);

    expect(catalogs).toEqual([
      {
        name: 'file',
        schemas: [
          {
            name: 'players',
            tables: [
              {
                name: 'players',
                columns: [
                  { name: 'player', type: 'VARCHAR', nullable: true },
                  { name: 'goals', type: 'BIGINT', nullable: true },
                ],
              },
            ],
          },
          {
            name: 'sales_2026',
            tables: [
              {
                name: 'region_sales',
                columns: [
                  { name: 'Region', type: 'VARCHAR', nullable: true },
                  { name: 'Units', type: 'DECIMAL(3,1)', nullable: true },
                  { name: 'Revenue', type: 'DECIMAL(3,1)', nullable: true },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe('FileConnector.sampleRows and runReadOnlySql', () => {
  it('samples file.<schema>.<table>', async () => {
    const result = await connector.sampleRows(
      config,
      'file.players.players',
      1,
    );

    expect(result.columns).toEqual(['player', 'goals']);
    expect(result.rows).toEqual([{ player: 'Pelé', goals: 12 }]);
  });

  it('refuses an entity outside the file catalog', async () => {
    await expect(
      connector.sampleRows(config, 'main.players.players', 1),
    ).rejects.toThrow(BadRequestException);
  });

  it('runs read-only SQL, with the row limit after the count', async () => {
    const result = await connector.runReadOnlySql(
      config,
      'SELECT "Region", "Revenue" FROM file.sales_2026.region_sales ORDER BY "Revenue" DESC',
      2,
    );

    expect(result).toEqual({
      columns: ['Region', 'Revenue'],
      rows: [
        { Region: 'North', Revenue: 25 },
        { Region: 'South', Revenue: 12 },
      ],
      totalRows: 4,
    });
  });

  it('turns BIGINT results into JSON-safe numbers', async () => {
    const result = await connector.runReadOnlySql(
      config,
      'SELECT count(*) AS n, sum(goals) AS g FROM file.players.players',
      10,
    );

    expect(result.rows).toEqual([{ n: 2, g: 26 }]);
  });
});

describe('FileConnector.runPagedSql (datasources R52)', () => {
  const stmt = (overrides: Partial<PagedStatement>): PagedStatement => ({
    sql: 'SELECT "Region", "Units", "Revenue" FROM file.sales_2026.region_sales',
    columns: ['Region', 'Units', 'Revenue'],
    filters: [],
    sort: [],
    limit: 50,
    offset: 0,
    kinds: { Region: 'text', Units: 'number', Revenue: 'number' },
    ...overrides,
  });

  it('filters and sorts with bound parameters', async () => {
    const page = await connector.runPagedSql(
      config,
      stmt({
        filters: [
          { column: 'Region', op: 'contains', value: 'NORTH' },
          { column: 'Units', op: 'gte', value: 1 },
        ],
        sort: [{ column: 'Revenue', direction: 'asc' }],
      }),
    );

    expect(page).toEqual({
      columns: ['Region', 'Units', 'Revenue'],
      rows: [
        { Region: 'north-west', Units: 1, Revenue: 2.5 },
        { Region: 'North', Units: 10, Revenue: 25 },
      ],
      matchedRows: 2,
    });
  });

  it('counts the matches on a page past the end', async () => {
    const page = await connector.runPagedSql(
      config,
      stmt({ limit: 2, offset: 10 }),
    );

    expect(page.rows).toEqual([]);
    expect(page.matchedRows).toBe(4);
  });
});

describe('FileConnector refusals (ADR-0052)', () => {
  it('the engine refuses read_csv on a real path the guard lets through', async () => {
    await expect(
      connector.runReadOnlySql(
        config,
        `SELECT * FROM read_csv('${outsidePath}')`,
        10,
      ),
    ).rejects.toThrow(/file system operations are disabled/);
  });

  it('the guard refuses a CREATE', async () => {
    await expect(
      connector.runReadOnlySql(
        config,
        'CREATE TABLE file.players.x AS SELECT 1',
        10,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it.each([
    [
      'a CREATE on the attached database',
      'CREATE TABLE file.players.x AS SELECT 1',
      /read-only mode/,
    ],
    [
      'a second ATTACH',
      `ATTACH '${'__OTHER__'}' AS other`,
      /disabled by configuration/,
    ],
    [
      'reading another file',
      `SELECT * FROM read_csv('__OUTSIDE__')`,
      /disabled by configuration/,
    ],
    [
      'turning external access back on',
      'SET enable_external_access = true',
      /configuration has been locked/,
    ],
    ['loading an extension', 'LOAD excel', /disabled/],
  ])('the sandbox itself refuses %s', async (_label, raw, error) => {
    const sql = raw
      .replace('__OTHER__', join(dir, 'other.duckdb'))
      .replace('__OUTSIDE__', outsidePath);

    await expect(
      withFileDatabase(config.databasePath, (connection) =>
        connection.run(sql),
      ),
    ).rejects.toThrow(error);
  });

  it('says so when the datasource has nothing imported yet', async () => {
    await expect(
      connector.inventory({
        files: [],
        databasePath: join(dir, 'none.duckdb'),
      }),
    ).rejects.toThrow('No files have been imported into this datasource yet');
  });
});
