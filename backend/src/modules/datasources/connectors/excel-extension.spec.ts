import * as fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { version as duckdbVersion } from '@duckdb/node-api';
import { Workbook } from 'exceljs';
import { duckdbPlatform, excelExtension } from './excel-extension';
import { detectSheets } from './file-import';

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: jest.fn(actual.existsSync) };
});
const existsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const realExists = jest.requireActual<typeof import('fs')>('fs').existsSync;

describe('duckdbPlatform (ADR-0052)', () => {
  it.each([
    ['win32', 'x64', 'windows_amd64'],
    ['darwin', 'arm64', 'osx_arm64'],
    ['darwin', 'x64', 'osx_amd64'],
    ['linux', 'x64', 'linux_amd64'],
  ])('%s/%s is %s', (platform, arch, expected) => {
    expect(duckdbPlatform(platform, arch)).toBe(expected);
  });
});

describe('excelExtension (ADR-0052, plan m1-31 section 9)', () => {
  afterEach(() => existsSync.mockImplementation(realExists));

  it('builds the vendor path from the loaded DuckDB version and this platform', () => {
    existsSync.mockReturnValue(true);
    const path = excelExtension();
    const tail = [
      'vendor',
      'duckdb-extensions',
      duckdbVersion(),
      duckdbPlatform(),
      'excel.duckdb_extension',
    ].join(sep);
    expect(path.endsWith(`${sep}${tail}`)).toBe(true);
    expect(path).toContain(`${sep}backend${sep}vendor${sep}`);
  });

  it('names the version and platform when the file is missing', () => {
    existsSync.mockReturnValue(false);
    expect(() => excelExtension()).toThrow(
      `Excel support is missing from this installation (DuckDB ${duckdbVersion()}, ${duckdbPlatform()})`,
    );
  });

  it('expects the DuckDB version the lockfile pins, which is the one the fetch script downloads', () => {
    const lock = JSON.parse(
      fs.readFileSync(
        join(__dirname, '..', '..', '..', '..', 'package-lock.json'),
        'utf8',
      ),
    ) as { packages: Record<string, { version: string }> };
    const pinned = lock.packages['node_modules/@duckdb/node-bindings'].version;
    expect(`v${pinned.replace(/-r\.\d+$/, '')}`).toBe(duckdbVersion());
  });

  it('reads a workbook with the shipped extension and no INSTALL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'excel-ext-'));
    try {
      const file = join(dir, 'book.xlsx');
      const wb = new Workbook();
      const ws = wb.addWorksheet('Sales');
      ws.getRow(1).values = ['Region', 'Units'];
      ws.getRow(2).values = ['North', 10];
      await wb.xlsx.writeFile(file);
      const sheets = await detectSheets(file, 'book.xlsx', {
        excelExtension: excelExtension(),
      });
      expect(sheets.map((s) => s.sheet)).toEqual(['Sales']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
