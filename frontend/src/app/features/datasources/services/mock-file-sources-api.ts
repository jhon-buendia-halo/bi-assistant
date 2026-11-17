import { Injectable } from '@angular/core';
import {
  FileDatasourceConfig,
  PreviewCell,
  SheetImport,
  SheetPreview,
  SheetWarning,
  SourceFile,
} from '../models/datasource.model';
import { FileSourcesApi, SheetPreviewRequest } from './file-sources-api';

const DELAY_MS = 300;
const wait = () => new Promise<void>((r) => setTimeout(r, DELAY_MS));

const REGION_ROWS = 12480;
const REGION_HEADER = 3;
/** The Region sheet's last row: a total line below its REGION_ROWS data rows. */
const REGION_LAST = REGION_HEADER + REGION_ROWS + 1;
const CSV_LAST = 5211;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const REGION_COLUMNS = [
  ['Region', 'VARCHAR'],
  ['Country', 'VARCHAR'],
  ['Month', 'DATE'],
  ['Units', 'DOUBLE'],
  ['Revenue', 'DOUBLE'],
  ['Channel', 'VARCHAR'],
] as const;

/** The sheet rows a preview shows: the first 7 and the last 2 of the used range. */
const xlsxShown = [1, 2, 3, 4, 5, 6, 7, REGION_LAST - 1, REGION_LAST];
const csvShown = [1, 2, 3, 4, 5, 6, 7, CSV_LAST - 1, CSV_LAST];

function regionCells(row: number): PreviewCell[] {
  if (row === 1) return ['Sales report 2026', null, null, null, null, null];
  if (row === 2) return [null, null, null, null, null, null];
  if (row === REGION_HEADER) return REGION_COLUMNS.map(([n]) => n);
  if (row === REGION_LAST) {
    return ['Total', null, null, '214,906', '9,872,415.60', null];
  }
  const n = row - REGION_HEADER;
  const units = 600 + ((n * 37) % 1200);
  return [
    n <= 2 ? 'North' : n <= 4 ? 'South' : 'West',
    ['Norway', 'Sweden', 'Spain', 'Italy', 'Ireland'][n % 5],
    `2026-${String((n % 12) + 1).padStart(2, '0')}`,
    units.toLocaleString('en-US'),
    `${(units * 46).toLocaleString('en-US')}.00`,
    ['Retail', 'Online', 'Partner'][n % 3],
  ];
}

function csvCells(row: number): PreviewCell[] {
  if (row === 1) return ['id', 'name', 'country', 'segment', 'orders', 'spend'];
  return [
    row - 1,
    `Customer ${row - 1}`,
    'Norway',
    'Retail',
    12 + row,
    `${row * 10}.00`,
  ];
}

/** Parses `A3:H12482` into 1-based first and last rows, or null. */
export function parseRange(
  range: string,
): { first: number; last: number } | null {
  const m = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(range.trim());
  if (!m) return null;
  const first = Number(m[2]);
  const last = Number(m[4]);
  return first >= 1 && last >= first ? { first, last } : null;
}

/**
 * Which of the shown sheet rows are not imported: those above the header,
 * outside the range, and the last row of the range when `excludeLastRow` is set.
 */
export function excludedRows(
  rows: number[],
  headerRow: number,
  range: string,
  excludeLastRow: boolean,
): Set<number> {
  const bounds = parseRange(range);
  const last = bounds?.last ?? Math.max(...rows);
  const out = new Set<number>();
  for (const r of rows) {
    if (r < headerRow) out.add(r);
    else if (bounds && (r < bounds.first || r > bounds.last)) out.add(r);
    else if (excludeLastRow && r === last) out.add(r);
  }
  return out;
}

function csvSheet(name: string): SheetImport {
  return {
    sheet: name,
    table: name,
    include: true,
    headerRow: 1,
    range: `A1:F${CSV_LAST}`,
    excludeLastRow: false,
    allText: false,
    rowCount: CSV_LAST - 1,
    warnings: [],
  };
}

function xlsxSheets(): SheetImport[] {
  return [
    {
      sheet: 'Region',
      table: 'region',
      include: true,
      headerRow: REGION_HEADER,
      range: `A${REGION_HEADER}:F${REGION_LAST}`,
      excludeLastRow: true,
      allText: false,
      rowCount: REGION_ROWS,
      warnings: [
        { code: 'header-guessed', row: REGION_HEADER },
        { code: 'total-row', row: REGION_LAST },
      ],
    },
    {
      sheet: 'Targets',
      table: 'targets',
      include: true,
      headerRow: 1,
      range: 'A1:D49',
      excludeLastRow: false,
      allText: false,
      rowCount: 48,
      warnings: [],
    },
    {
      sheet: 'Notes',
      table: 'notes',
      include: false,
      headerRow: 1,
      range: 'A1:A1',
      excludeLastRow: false,
      allText: false,
      warnings: [{ code: 'no-table' }],
    },
  ];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'file';

/** Answers from fixtures so the form can be tried before the backend exists. */
@Injectable()
export class MockFileSourcesApi implements FileSourcesApi {
  private seq = 0;
  private readonly formats = new Map<string, 'xlsx' | 'csv'>();

  async upload(file: File): Promise<{ uploadId: string; file: SourceFile }> {
    await wait();
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.xls')) {
      throw new Error(
        '.xls files are not supported — save the workbook as .xlsx',
      );
    }
    const format = lower.endsWith('.xlsx')
      ? 'xlsx'
      : lower.endsWith('.csv')
        ? 'csv'
        : null;
    if (!format) throw new Error('Only .xlsx and .csv files can be imported');
    if (file.size > 200 * 1024 * 1024) {
      throw new Error('File is larger than 200 MB');
    }
    const schema = slug(file.name.replace(/\.[^.]+$/, ''));
    const id = `mock-file-${++this.seq}`;
    const uploadId = `mock-upload-${this.seq}`;
    this.formats.set(id, format);
    return {
      uploadId,
      file: {
        id,
        name: file.name,
        format,
        sizeBytes: file.size,
        sha256: '0'.repeat(64),
        uploadedAt: new Date().toISOString(),
        schema,
        sheets: format === 'xlsx' ? xlsxSheets() : [csvSheet(schema)],
        uploadId,
      },
    };
  }

  async preview(req: SheetPreviewRequest): Promise<SheetPreview> {
    await wait();
    const csv = this.formats.get(req.fileId) === 'csv';
    const headerRow = req.headerRow ?? (csv ? 1 : REGION_HEADER);
    const lastSheetRow = csv ? CSV_LAST : REGION_LAST;
    const excludeLast = req.excludeLastRow ?? !csv;
    const range = req.range ?? `A${headerRow}:F${lastSheetRow}`;
    const bounds = parseRange(range);
    const first = bounds?.first ?? headerRow;
    const last = bounds?.last ?? lastSheetRow;
    const warnings: SheetWarning[] = [];
    if (!csv && excludeLast) warnings.push({ code: 'total-row', row: last });
    if (!csv && headerRow === REGION_HEADER) {
      warnings.push({ code: 'header-guessed', row: REGION_HEADER });
    }
    const shown = csv ? csvShown : xlsxShown;
    return {
      sheet: req.sheet,
      headerRow,
      range,
      totalRows: Math.max(
        0,
        last - Math.max(first, headerRow) - (excludeLast ? 1 : 0),
      ),
      columns: REGION_COLUMNS.map(([name, type], i) => ({
        letter: LETTERS[i],
        name: csv ? csvCells(1)[i]!.toString() : name,
        type: req.allText
          ? 'VARCHAR'
          : csv
            ? i === 0 || i === 4
              ? 'BIGINT'
              : 'VARCHAR'
            : type,
      })),
      rows: shown.map((row) => ({
        row,
        cells: csv ? csvCells(row) : regionCells(row),
      })),
      warnings,
    };
  }

  async discard(): Promise<void> {
    await wait();
  }

  async importAndCheck(
    config: FileDatasourceConfig,
  ): Promise<{ ok: boolean; message: string }> {
    await wait();
    let tables = 0;
    let rows = 0;
    for (const f of config.files) {
      for (const s of f.sheets) {
        if (!s.include) continue;
        tables++;
        rows += s.rowCount ?? 0;
      }
    }
    if (tables === 0) {
      return { ok: false, message: 'Include at least one sheet to import' };
    }
    return {
      ok: true,
      message: `Imported ${tables} tables · ${rows.toLocaleString('en-US')} rows`,
    };
  }
}
