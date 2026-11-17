import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import { Workbook } from 'exceljs';
import type { SourceFile } from '../entities/datasource.entity';
import {
  assignEntityKeys,
  detectSheets,
  importFiles,
  slugSegment,
  withoutLastLine,
  type FileImportOptions,
} from './file-import';

/** The host's own `excel` extension (the shipped one is story 1.31.2). */
const options: FileImportOptions = { excelExtension: 'installed' };

let dir: string;
let workbookPath: string;
let csvPath: string;

/**
 * "Region Sales": a title row above the header on row 3 (columns B to E;
 * exceljs puts a contiguous array's element 0 in column A), a formula column
 * and a trailing Total row. "Notes": one cell, no table. "region-sales": a
 * small table whose key collides with the first sheet's, with a duplicate
 * and an empty column name.
 */
async function writeWorkbook(path: string): Promise<void> {
  const wb = new Workbook();
  const sales = wb.addWorksheet('Region Sales');
  sales.getCell('B1').value = 'Quarterly sales report';
  const rows: [string, number, number][] = [
    ['North', 10, 2.5],
    ['South', 4, 3],
    ['East', 6, 1.5],
  ];
  sales.getRow(3).values = [null, 'Region', 'Units', 'Price', 'Revenue'];
  rows.forEach(([region, units, price], i) => {
    const r = 4 + i;
    sales.getRow(r).values = [
      null,
      region,
      units,
      price,
      { formula: `C${r}*D${r}`, result: units * price },
    ];
  });
  sales.getRow(7).values = [
    null,
    'Total',
    { formula: 'SUM(C4:C6)', result: 20 },
    null,
    { formula: 'SUM(E4:E6)', result: 46 },
  ];
  wb.addWorksheet('Notes').getCell('A1').value = 'Just a note';
  const other = wb.addWorksheet('region-sales');
  other.getRow(1).values = ['Name', 'name', null, 'Score'];
  other.getRow(2).values = ['a', 'b', 'c', 1];
  other.getRow(3).values = ['d', 'e', 'f', 2];
  await wb.xlsx.writeFile(path);
}

beforeAll(async () => {
  // Network is allowed in dev; a cached extension makes this a no-op.
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await connection.run('INSTALL excel');
  connection.closeSync();
  instance.closeSync();

  dir = mkdtempSync(join(tmpdir(), 'file-import-spec-'));
  workbookPath = join(dir, 'Sales 2026.xlsx');
  csvPath = join(dir, 'Sales 2026.csv');
  await writeWorkbook(workbookPath);
  writeFileSync(
    csvPath,
    'player,goals,assists\nPelé,12,3\nMüller,14,5\nEusébio,9,2\n',
  );
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function sourceFile(
  name: string,
  format: 'xlsx' | 'csv',
  sheets: SourceFile['sheets'],
): SourceFile {
  return {
    id: `${name}-id`,
    name,
    format,
    sizeBytes: 1,
    sha256: 'x',
    uploadedAt: '2026-11-17T00:00:00.000Z',
    schema: '',
    sheets,
  };
}

describe('slugSegment (plan m1-31 4)', () => {
  it.each([
    ['Sales 2026', 'sales_2026'],
    ['  Región / Norte!! ', 'regi_n_norte'],
    ['2026 sales', '_2026_sales'],
    ['__keep__under__', 'keep__under'],
  ])('%s → %s', (raw, slug) => {
    expect(slugSegment(raw, 'sheet')).toBe(slug);
  });

  it('falls back when nothing is left, and cuts to 63 characters', () => {
    expect(slugSegment('***', 'file')).toBe('file');
    expect(slugSegment('', 'sheet')).toBe('sheet');
    expect(slugSegment('a'.repeat(80), 'sheet')).toHaveLength(63);
  });
});

describe('assignEntityKeys (plan m1-31 4)', () => {
  it('dedupes schemas and tables with _2, and a CSV table equals its schema', () => {
    const files = assignEntityKeys([
      sourceFile('Sales 2026.xlsx', 'xlsx', [
        sheet('Region Sales'),
        sheet('region-sales'),
        sheet('Region Sales!'),
      ]),
      sourceFile('sales 2026.csv', 'csv', [sheet('sales 2026')]),
    ]);

    expect(files[0].schema).toBe('sales_2026');
    expect(files[0].sheets.map((s) => s.table)).toEqual([
      'region_sales',
      'region_sales_2',
      'region_sales_3',
    ]);
    expect(files[1].schema).toBe('sales_2026_2');
    expect(files[1].sheets[0].table).toBe('sales_2026_2');
  });

  it('keeps keys a file already has', () => {
    const kept = sourceFile('Renamed.xlsx', 'xlsx', [
      { ...sheet('Region Sales'), table: 'old_table' },
    ]);
    kept.schema = 'old_schema';

    const [file] = assignEntityKeys([kept]);

    expect(file.schema).toBe('old_schema');
    expect(file.sheets[0].table).toBe('old_table');
  });
});

function sheet(name: string): SourceFile['sheets'][number] {
  return {
    sheet: name,
    table: '',
    include: true,
    headerRow: 1,
    range: 'A1:A2',
    excludeLastRow: false,
    allText: false,
  };
}

describe('detectSheets (plan m1-31 5)', () => {
  it('finds the header under a title row, the range, and a trailing total', async () => {
    const sheets = await detectSheets(workbookPath, 'Sales 2026.xlsx', options);

    expect(sheets.map((s) => s.sheet)).toEqual([
      'Region Sales',
      'Notes',
      'region-sales',
    ]);
    expect(sheets[0]).toEqual({
      sheet: 'Region Sales',
      table: 'region_sales',
      include: true,
      headerRow: 3,
      range: 'B3:E7',
      excludeLastRow: true,
      allText: false,
      warnings: [
        { code: 'header-guessed', row: 3 },
        { code: 'total-row', row: 7 },
      ],
    });
  });

  it('skips a sheet with no table', async () => {
    const sheets = await detectSheets(workbookPath, 'Sales 2026.xlsx', options);

    expect(sheets[1]).toMatchObject({
      sheet: 'Notes',
      include: false,
      warnings: [{ code: 'no-table' }],
    });
  });

  it('warns about duplicate column names and dedupes the table key in the file', async () => {
    const sheets = await detectSheets(workbookPath, 'Sales 2026.xlsx', options);

    expect(sheets[2]).toEqual({
      sheet: 'region-sales',
      table: 'region_sales_2',
      include: true,
      headerRow: 1,
      range: 'A1:D3',
      excludeLastRow: false,
      allText: false,
      warnings: [{ code: 'duplicate-columns', names: ['name'] }],
    });
  });

  it('proposes header row 1 and the whole file for a CSV', async () => {
    const sheets = await detectSheets(csvPath, 'Sales 2026.csv', options);

    expect(sheets).toEqual([
      {
        sheet: 'Sales 2026',
        table: 'sales_2026',
        include: true,
        headerRow: 1,
        range: 'A1:C4',
        excludeLastRow: false,
        allText: false,
        warnings: [],
      },
    ]);
  });
});

async function query(
  databasePath: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    await connection.run(`ATTACH '${databasePath}' AS db (READ_ONLY)`);
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjectsJson();
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function detectedFiles(): Promise<{ file: SourceFile; path: string }[]> {
  const xlsx = sourceFile(
    'Sales 2026.xlsx',
    'xlsx',
    await detectSheets(workbookPath, 'Sales 2026.xlsx', options),
  );
  const csv = sourceFile(
    'Sales 2026.csv',
    'csv',
    await detectSheets(csvPath, 'Sales 2026.csv', options),
  );
  const [a, b] = assignEntityKeys([xlsx, csv]);
  return [
    { file: a, path: workbookPath },
    { file: b, path: csvPath },
  ];
}

describe('importFiles (plan m1-31 8)', () => {
  it('imports the included sheets, drops the total row and reports rows and types', async () => {
    const databasePath = join(dir, 'import-1', 'data.duckdb');

    const files = await importFiles(
      databasePath,
      await detectedFiles(),
      options,
    );

    const region = files[0].sheets[0];
    expect(region.rowCount).toBe(3);
    expect(region.columns).toEqual([
      { name: 'Region', type: 'VARCHAR' },
      { name: 'Units', type: 'DOUBLE' },
      { name: 'Price', type: 'DOUBLE' },
      { name: 'Revenue', type: 'DOUBLE' },
    ]);
    expect(files[0].sheets[1].rowCount).toBeUndefined();
    expect(files[0].sheets[2].columns?.map((c) => c.name)).toEqual([
      'Name',
      'name_2',
      'column_C',
      'Score',
    ]);
    expect(files[1].schema).toBe('sales_2026_2');
    expect(files[1].sheets[0]).toMatchObject({
      table: 'sales_2026_2',
      rowCount: 3,
      columns: [
        { name: 'player', type: 'VARCHAR' },
        { name: 'goals', type: 'BIGINT' },
        { name: 'assists', type: 'BIGINT' },
      ],
    });
    // Formula cells read their cached values.
    expect(
      await query(
        databasePath,
        'SELECT Region, Revenue FROM db.sales_2026.region_sales ORDER BY Region',
      ),
    ).toEqual([
      { Region: 'East', Revenue: 9 },
      { Region: 'North', Revenue: 25 },
      { Region: 'South', Revenue: 12 },
    ]);
    expect(existsSync(`${databasePath}.tmp`)).toBe(false);
  });

  it('reads every column as text when asked', async () => {
    const databasePath = join(dir, 'import-2', 'data.duckdb');
    const [xlsx] = await detectedFiles();
    xlsx.file.sheets[0].allText = true;

    const [file] = await importFiles(databasePath, [xlsx], options);

    expect(file.sheets[0].columns?.map((c) => c.type)).toEqual([
      'VARCHAR',
      'VARCHAR',
      'VARCHAR',
      'VARCHAR',
    ]);
  });

  it('leaves the previous database in place when an import fails', async () => {
    const databasePath = join(dir, 'import-3', 'data.duckdb');
    const good = await detectedFiles();
    await importFiles(databasePath, good, options);
    const bad = await detectedFiles();
    bad[0].file.sheets[0].sheet = 'Missing sheet';

    await expect(importFiles(databasePath, bad, options)).rejects.toThrow(
      /^Sales 2026\.xlsx · Missing sheet: /,
    );

    expect(existsSync(`${databasePath}.tmp`)).toBe(false);
    expect(
      await query(
        databasePath,
        'SELECT count(*)::INTEGER AS n FROM db.sales_2026.region_sales',
      ),
    ).toEqual([{ n: 3 }]);
  });

  it('refuses a range that does not look like A1:H200', async () => {
    const databasePath = join(dir, 'import-4', 'data.duckdb');
    const [xlsx] = await detectedFiles();
    xlsx.file.sheets[0].range = 'A3-D7';

    await expect(importFiles(databasePath, [xlsx], options)).rejects.toThrow(
      'Sales 2026.xlsx · Region Sales: Range must look like A1:H200',
    );
    expect(existsSync(databasePath)).toBe(false);
  });
});

describe('a total row under a numeric first column (story 1.31.7 finding)', () => {
  it('imports the workbook without the total and keeps the column numeric', async () => {
    const path = join(dir, 'years.xlsx');
    const wb = new Workbook();
    const ws = wb.addWorksheet('Years');
    ws.addRow(['Year', 'Goals']);
    ws.addRow([2018, 169]);
    ws.addRow([2022, 172]);
    ws.addRow(['Total', 341]);
    await wb.xlsx.writeFile(path);
    const sheets = await detectSheets(path, 'years.xlsx', options);
    expect(sheets[0]).toMatchObject({ excludeLastRow: true });
    const [file] = assignEntityKeys([sourceFile('years.xlsx', 'xlsx', sheets)]);
    const databasePath = join(dir, 'import-years', 'data.duckdb');

    const [imported] = await importFiles(
      databasePath,
      [{ file, path }],
      options,
    );

    expect(imported.sheets[0].rowCount).toBe(2);
    expect(imported.sheets[0].columns?.[0]).toEqual({
      name: 'Year',
      type: 'DOUBLE',
    });
    expect(
      await query(databasePath, 'SELECT sum(Goals) AS g FROM db.years.years'),
    ).toEqual([{ g: 341 }]);
  });

  it('imports the CSV without its last line and leaves no copy behind', async () => {
    const path = join(dir, 'years.csv');
    writeFileSync(path, 'year,goals\n2018,169\n2022,172\nTotal,341\n\n');
    const sheets = await detectSheets(path, 'years.csv', options);
    const [file] = assignEntityKeys([
      sourceFile('years.csv', 'csv', [{ ...sheets[0], excludeLastRow: true }]),
    ]);
    const databasePath = join(dir, 'import-years-csv', 'data.duckdb');

    const [imported] = await importFiles(
      databasePath,
      [{ file, path }],
      options,
    );

    expect(imported.sheets[0].rowCount).toBe(2);
    expect(imported.sheets[0].columns?.[0]).toEqual({
      name: 'year',
      type: 'BIGINT',
    });
    expect(existsSync(`${path}.without-last-row.csv`)).toBe(false);
  });
});

describe('withoutLastLine', () => {
  it('drops the last non-empty line and the blank lines after it', async () => {
    const from = join(dir, 'tail.csv');
    const to = join(dir, 'tail-copy.csv');
    writeFileSync(from, 'a,b\n1,2\nTotal,3\r\n\n  \n');

    await withoutLastLine(from, to);

    expect(readFileSync(to, 'utf8')).toBe('a,b\n1,2\n');
  });

  it('gives an empty copy for a one-line file', async () => {
    const from = join(dir, 'one.csv');
    const to = join(dir, 'one-copy.csv');
    writeFileSync(from, 'only line');

    await withoutLastLine(from, to);

    expect(readFileSync(to, 'utf8')).toBe('');
  });
});
