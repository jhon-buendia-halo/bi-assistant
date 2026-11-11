import { PassThrough } from 'stream';
import { Workbook } from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import type { GeneratedTable } from '../generator/contract';
import type { SampledColumn, SampledProfile } from '../types';
import { csvField } from './csv';
import { exportFileName } from './file-names';
import { profileCsv, writeProfileXlsx } from './profile-export';
import { sampleToTable } from './raw-values';
import { writeXlsx } from './xlsx';
import { writeCsvZip } from './zip';

function col(name: string, over: Partial<SampledColumn> = {}): SampledColumn {
  return {
    name,
    type: 'text',
    semanticType: 'text',
    nullable: true,
    kind: 'text',
    strategy: 'words',
    nullFraction: 0,
    distinctCount: 0,
    distinctRatio: 0,
    ...over,
  };
}

async function collect(
  run: (out: PassThrough) => Promise<unknown>,
): Promise<Buffer> {
  const out = new PassThrough();
  const parts: Buffer[] = [];
  out.on('data', (c: Buffer) => parts.push(c));
  await run(out);
  return Buffer.concat(parts);
}

const tableA: GeneratedTable = {
  key: 'db.public.a',
  targetName: 'a',
  columns: [
    col('id'),
    col('note'),
    col('n'),
    col('d'),
    col('ts'),
    col('ok'),
    col('x'),
  ],
  rows: [
    [
      { kind: 'number', text: '1' },
      'plain',
      { kind: 'number', text: '1.50' },
      { kind: 'date', text: '2024-03-05' },
      { kind: 'timestamp', text: '2024-03-05 10:20:30.5', zoned: false },
      true,
      { kind: 'neutral' },
    ],
    [
      { kind: 'number', text: '2' },
      'a,b "q"\nline',
      { kind: 'number', text: '12345678901234567890' },
      null,
      null,
      false,
      null,
    ],
    [
      { kind: 'number', text: '3' },
      '=SUM(A1)',
      null,
      null,
      null,
      null,
      ' pad ü€',
    ],
  ],
  primaryKey: ['id'],
  uniqueKeys: [],
};
const tableB: GeneratedTable = {
  key: 'b',
  targetName: 'a',
  columns: [col('v')],
  rows: [['é']],
  primaryKey: [],
  uniqueKeys: [],
};
const README = ['Synthetic data for dataset "x"', 'second line'];

describe('csv', () => {
  it('quotes per RFC 4180', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('l1\nl2')).toBe('"l1\nl2"');
    expect(csvField(' x')).toBe('" x"');
    expect(csvField('')).toBe('');
  });
});

describe('writeCsvZip', () => {
  it('writes one csv per table plus README.txt', async () => {
    let result: { rows: number } | undefined;
    const buf = await collect(async (out) => {
      result = await writeCsvZip(
        [tableA, { ...tableB, targetName: 'b' }],
        README,
        out,
      );
    });
    expect(result).toEqual({ rows: 4 });
    const files = unzipSync(new Uint8Array(buf));
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'a.csv', 'b.csv']);
    expect(strFromU8(files['b.csv'])).toBe('v\r\né\r\n');
    expect(strFromU8(files['README.txt'])).toBe(
      'Synthetic data for dataset "x"\r\nsecond line\r\n',
    );
    const csv = strFromU8(files['a.csv']);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv).toBe(
      'id,note,n,d,ts,ok,x\r\n' +
        '1,plain,1.50,2024-03-05,2024-03-05 10:20:30.5,true,\r\n' +
        '2,"a,b ""q""\nline",12345678901234567890,,,false,\r\n' +
        '3,=SUM(A1),,,,,'.concat('" pad ü€"', '\r\n'),
    );
  });
});

describe('writeXlsx', () => {
  const tables: GeneratedTable[] = [
    tableA,
    { ...tableB, targetName: 'a' },
    {
      ...tableB,
      targetName: 'bad[name]:*?/\\and_a_very_long_table_name_over_31',
    },
  ];

  it('writes About, de-duplicated and cut sheet names, typed cells', async () => {
    const buf = await collect((out) => writeXlsx(tables, README, out));
    const wb = new Workbook();
    await wb.xlsx.load(
      buf as unknown as Parameters<Workbook['xlsx']['load']>[0],
    );
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe('About');
    expect(names[1]).toBe('a');
    expect(names[2]).toBe('a~2');
    expect(names[3]).toBe('bad_name______and_a_very_long_t');
    expect(names[3].length).toBeLessThanOrEqual(31);
    const about = wb.getWorksheet('About')!;
    expect(about.getRow(1).getCell(1).value).toBe(README[0]);
    expect(about.getRow(2).getCell(1).value).toBe(README[1]);

    const a = wb.getWorksheet('a')!;
    expect(a.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(a.getRow(1).getCell(2).value).toBe('note');
    const r2 = a.getRow(2);
    expect(r2.getCell(1).value).toBe(1);
    expect(r2.getCell(2).value).toBe('plain');
    expect(r2.getCell(3).value).toBe(1.5);
    expect((r2.getCell(4).value as Date).toISOString()).toBe(
      '2024-03-05T00:00:00.000Z',
    );
    expect((r2.getCell(5).value as Date).toISOString()).toBe(
      '2024-03-05T10:20:30.500Z',
    );
    expect(r2.getCell(6).value).toBe(true);
    expect(r2.getCell(7).value).toBeNull();
    const r3 = a.getRow(3);
    expect(r3.getCell(2).value).toBe('a,b "q"\nline');
    expect(r3.getCell(3).value).toBe('12345678901234567890');
    expect(r3.getCell(6).value).toBe(false);
    expect(r3.getCell(4).value).toBeNull();
    const r4 = a.getRow(4);
    expect(r4.getCell(2).value).toBe('=SUM(A1)');
    expect(r4.getCell(7).value).toBe(' pad ü€');
  });

  it('holds the same values as the csv zip', async () => {
    const buf = await collect((out) => writeXlsx([tableA], README, out));
    const wb = new Workbook();
    await wb.xlsx.load(
      buf as unknown as Parameters<Workbook['xlsx']['load']>[0],
    );
    const csv = strFromU8(
      unzipSync(
        new Uint8Array(await collect((o) => writeCsvZip([tableA], README, o))),
      )['a.csv'],
    );
    const lines = csv.split('\r\n');
    const sheet = wb.getWorksheet('a')!;
    // numbers and booleans round-trip as the same text
    expect(String(sheet.getRow(2).getCell(1).value as string | number)).toBe(
      lines[1].split(',')[0],
    );
    expect(String(sheet.getRow(2).getCell(6).value as boolean)).toBe('true');
    expect(sheet.getRow(2).getCell(2).value).toBe(lines[1].split(',')[1]);
  });
});

describe('profile export', () => {
  const profile: SampledProfile = {
    profileId: 'p',
    version: 1,
    datasetName: 'Sales Data',
    datasourceId: 'd',
    datasourceName: 'ds',
    dialect: 'postgres',
    generatedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-01T01:00:00Z',
    sampleSize: 100,
    relationships: [],
    tables: [
      {
        key: 'db.public.t',
        namespace: 'public',
        name: 't',
        rowCountEstimate: 500,
        sampledRows: 100,
        method: 'limit',
        durationMs: 5,
        primaryKey: ['id'],
        uniqueKeys: [],
        columns: [
          col('id', {
            type: 'int4',
            semanticType: 'numeric',
            kind: 'identifier',
            strategy: 'sequence',
            distinctCount: 100,
            numeric: {
              min: 1,
              max: 100,
              mean: 50,
              quantiles: [],
              integer: true,
              scale: 0,
            },
          }),
          col('status', {
            kind: 'categorical',
            strategy: 'categorical',
            nullFraction: 0.1234,
            topValues: [
              { value: 'open', fraction: 0.5 },
              { value: 'a,b', fraction: 0.3 },
            ],
            patterns: [{ shape: 'aaaa', fraction: 1 }],
            length: { min: 3, max: 4, mean: 3.5, quantiles: [] },
          }),
        ],
      },
    ],
  };

  it('writes one csv row per column', () => {
    const lines = profileCsv(profile).split('\r\n');
    expect(lines[0]).toContain(
      'table,method,sampledRows,rowCountEstimate,column,type,kind',
    );
    expect(lines[1]).toBe(
      'db.public.t,limit,100,500,id,int4,identifier,sequence,0,100,1..100,,',
    );
    expect(lines[2]).toBe(
      'db.public.t,limit,100,500,status,text,categorical,categorical,12.34,0,length 3..4,"open | a,b",aaaa',
    );
    expect(lines[3]).toBe('');
  });

  it('writes Tables and Columns sheets', async () => {
    const buf = await collect((out) => writeProfileXlsx(profile, out));
    const wb = new Workbook();
    await wb.xlsx.load(
      buf as unknown as Parameters<Workbook['xlsx']['load']>[0],
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Tables', 'Columns']);
    const cols = wb.getWorksheet('Columns')!;
    expect(cols.rowCount).toBe(3);
    expect(cols.getRow(3).getCell(5).value).toBe('status');
    expect(cols.getRow(3).getCell(12).value).toBe('open | a,b');
    expect(wb.getWorksheet('Tables')!.getRow(2).getCell(1).value).toBe(
      'db.public.t',
    );
  });
});

describe('sampleToTable', () => {
  const profile = {
    tables: [
      {
        key: 'k',
        primaryKey: ['id'],
        uniqueKeys: [['code']],
        columns: [
          col('id', { semanticType: 'numeric' }),
          col('flag', { semanticType: 'boolean' }),
          col('born', { semanticType: 'temporal' }),
          col('seen', { semanticType: 'temporal' }),
          col('name'),
        ],
      },
    ],
  } as unknown as SampledProfile;

  it('converts by semantic type in profile order', () => {
    const t = sampleToTable(profile, 'k', 'out', {
      columns: ['name', 'id'],
      rows: [
        {
          id: '12.5',
          flag: 't',
          born: '2020-01-02',
          seen: '2020-01-02T03:04:05Z',
          name: 'x',
        },
        {
          id: '1e5',
          flag: '0',
          born: 'nope',
          seen: '2020-01-02 03:04:05.12+02',
          name: null,
        },
        { id: 'abc', flag: 'maybe', born: null, seen: 'x', name: 'y' },
      ],
    });
    expect(t.targetName).toBe('out');
    expect(t.columns.map((c) => c.name)).toEqual([
      'id',
      'flag',
      'born',
      'seen',
      'name',
    ]);
    expect(t.primaryKey).toEqual(['id']);
    expect(t.uniqueKeys).toEqual([['code']]);
    expect(t.rows[0]).toEqual([
      { kind: 'number', text: '12.5' },
      true,
      { kind: 'date', text: '2020-01-02' },
      { kind: 'timestamp', text: '2020-01-02 03:04:05+00:00', zoned: true },
      'x',
    ]);
    expect(t.rows[1]).toEqual([
      '1e5',
      false,
      'nope',
      { kind: 'timestamp', text: '2020-01-02 03:04:05.12+02:00', zoned: true },
      null,
    ]);
    expect(t.rows[2]).toEqual(['abc', 'maybe', null, 'x', 'y']);
  });
});

describe('exportFileName', () => {
  it('names every export', () => {
    const n = 'Sales Données!';
    expect(exportFileName(n, 'synthetic', 'sql', 'postgres', 7)).toBe(
      'sales-donnees-synthetic-postgresql-seed7.sql',
    );
    expect(exportFileName(n, 'synthetic', 'sql', 'databricks', 7)).toBe(
      'sales-donnees-synthetic-databricks-seed7.sql',
    );
    expect(exportFileName(n, 'synthetic', 'csv', 'postgres', 7)).toBe(
      'sales-donnees-synthetic-seed7-csv.zip',
    );
    expect(exportFileName(n, 'synthetic', 'xlsx', 'postgres', 7)).toBe(
      'sales-donnees-synthetic-seed7.xlsx',
    );
    expect(exportFileName(n, 'sample', 'sql', 'postgres')).toBe(
      'sales-donnees-sample-postgresql.sql',
    );
    expect(exportFileName(n, 'sample', 'csv', 'postgres')).toBe(
      'sales-donnees-sample-csv.zip',
    );
    expect(exportFileName(n, 'sample', 'xlsx', 'postgres')).toBe(
      'sales-donnees-sample.xlsx',
    );
    expect(exportFileName(n, 'profile', 'csv', 'postgres')).toBe(
      'sales-donnees-profile.csv',
    );
    expect(exportFileName(n, 'profile', 'xlsx', 'postgres')).toBe(
      'sales-donnees-profile.xlsx',
    );
    expect(exportFileName('***', 'profile', 'csv', 'postgres')).toBe(
      'dataset-profile.csv',
    );
  });
});
