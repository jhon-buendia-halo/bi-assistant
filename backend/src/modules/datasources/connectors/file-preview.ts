/**
 * The preview of one sheet under given import options (plan m1-31 3 and 7,
 * api.md 157): the rows the review dialog shows, the column names and the
 * types DuckDB reads them as, with the warnings that hold for those options.
 * Options left out come from the detection (`detectSheets`).
 */
import type { DuckDBConnection } from '@duckdb/node-api';
import type {
  SheetImport,
  SheetPreview,
  SheetWarning,
} from '../entities/datasource.entity';
import { asText, withDuckDb } from './duckdb';
import {
  columnLetter,
  detectSheets,
  fileFormatOf,
  headerNames,
  loadExcel,
  looksLikeTotal,
  parseRange,
  rangeText,
  readCsv,
  readXlsx,
  rows,
  type Cell,
  type CellRange,
  type FileImportOptions,
} from './file-import';

/** The rows shown from the top of the range, and from its bottom. */
const HEAD_ROWS = 7;
const TAIL_ROWS = 2;

export interface SheetPreviewOptions {
  sheet: string;
  headerRow?: number;
  range?: string;
  excludeLastRow?: boolean;
  allText?: boolean;
}

/**
 * The sheet rows the grid shows: the first 7 rows of the sheet (from its
 * first non-empty row, so rows above the header show), widened to the header
 * row and the row under it when the header sits lower, and the range's last 2.
 */
function shownRows(
  sheetFirst: number,
  headerRow: number,
  range: CellRange,
): number[][] {
  const headEnd = Math.min(
    Math.max(sheetFirst + HEAD_ROWS - 1, headerRow + 1),
    range.lastRow,
  );
  const tailStart = Math.max(headEnd + 1, range.lastRow - TAIL_ROWS + 1);
  const blocks = [[sheetFirst, headEnd]];
  if (tailStart <= range.lastRow) blocks.push([tailStart, range.lastRow]);
  return blocks;
}

/** The first row DuckDB finds a cell on; 1 for a CSV or an unreadable sheet. */
async function sheetFirstRow(
  connection: DuckDBConnection,
  path: string,
  sheet: string,
): Promise<number> {
  try {
    const start = (
      await connection.runAndReadAll(
        `SELECT * FROM ${readXlsx(path, sheet, { header: false, allText: true })} LIMIT 0`,
      )
    ).columnNames()[0];
    return Number(/^[A-Z]+(\d+)$/.exec(start ?? '')?.[1] ?? 1);
  } catch {
    return 1;
  }
}

/**
 * An Excel serial number (days since 1899-12-30) in a DATE or TIMESTAMP
 * column as `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`; any other cell as it is.
 */
export function excelSerialAsDate<T extends Cell | number | boolean>(
  cell: T,
  type: string | undefined,
): T | string {
  if (cell === null || !type || !/^(DATE|TIMESTAMP)/.test(type)) return cell;
  const serial = Number(cell);
  if (!Number.isFinite(serial) || String(cell).trim() === '') return cell;
  const ms = Math.round((serial - 25569) * 86_400_000);
  const iso = new Date(ms).toISOString();
  return type === 'DATE'
    ? iso.slice(0, 10)
    : iso.slice(0, 19).replace('T', ' ');
}

function fit(cells: Cell[] | undefined, width: number): Cell[] {
  return Array.from({ length: width }, (_, i) => cells?.[i] ?? null);
}

/** The range and header row the options name, checked as the import does. */
function chosenRange(
  proposal: SheetImport,
  options: SheetPreviewOptions,
  csv: boolean,
): { range: CellRange; headerRow: number } {
  const given = options.range ? parseRange(options.range) : undefined;
  const detected = parseRange(proposal.range);
  const headerRow =
    options.headerRow ?? (given && !csv ? given.firstRow : proposal.headerRow);
  // A CSV is read whole from its header row: its range is not editable.
  const range: CellRange =
    given && !csv
      ? given
      : { ...detected, firstRow: options.headerRow ?? detected.firstRow };
  if (
    !Number.isInteger(headerRow) ||
    headerRow < range.firstRow ||
    headerRow >= range.lastRow
  ) {
    throw new Error('The header row must be in the range, above its last row');
  }
  return { range, headerRow };
}

async function xlsxCells(
  connection: DuckDBConnection,
  path: string,
  sheet: string,
  range: CellRange,
  from: number,
  to: number,
): Promise<Cell[][]> {
  const columns = [range.firstColumn, range.lastColumn].map(columnLetter);
  return rows(
    connection,
    `SELECT * FROM ${readXlsx(path, sheet, {
      header: false,
      allText: true,
      range: `${columns[0]}${from}:${columns[1]}${to}`,
    })}`,
  );
}

async function csvCells(
  connection: DuckDBConnection,
  path: string,
  blocks: number[][],
): Promise<Map<number, Cell[]>> {
  const where = blocks
    .map(([from, to]) => `ordinality BETWEEN ${from} AND ${to}`)
    .join(' OR ');
  const found = await rows(
    connection,
    `SELECT * FROM ${readCsv(path, { header: false, allText: true })}
     WITH ORDINALITY WHERE ${where} ORDER BY ordinality`,
  );
  return new Map(
    found.map((r) => [Number(r[r.length - 1]), r.slice(0, -1)] as const),
  );
}

async function columnTypes(
  connection: DuckDBConnection,
  source: string,
): Promise<string[]> {
  const described = await connection.runAndReadAll(
    `DESCRIBE SELECT * FROM ${source}`,
  );
  return described.getRowObjectsJS().map((c) => asText(c.column_type));
}

/**
 * The preview of `options.sheet` of the file at `path` (`fileName` gives
 * its format). Throws `Range must look like A1:H200`, `The header row must
 * be in the range, above its last row` or `Sheet "<name>" not found`.
 */
export async function previewSheet(
  path: string,
  fileName: string,
  options: SheetPreviewOptions,
  importOptions: FileImportOptions,
): Promise<SheetPreview> {
  const csv = fileFormatOf(fileName) === 'csv';
  if (options.range) parseRange(options.range);
  const proposal = (await detectSheets(path, fileName, importOptions)).find(
    (s) => s.sheet === options.sheet,
  );
  if (!proposal) throw new Error(`Sheet "${options.sheet}" not found`);
  const noTable = proposal.warnings?.some((w) => w.code === 'no-table');
  if (noTable && !options.range && options.headerRow === undefined) {
    return {
      sheet: proposal.sheet,
      headerRow: proposal.headerRow,
      range: proposal.range,
      totalRows: 0,
      columns: [],
      rows: [],
      warnings: proposal.warnings ?? [],
    };
  }

  const { range, headerRow } = chosenRange(proposal, options, csv);
  const width = range.lastColumn - range.firstColumn + 1;
  const detectedLast = parseRange(proposal.range).lastRow;
  const excludeLastRow =
    options.excludeLastRow ??
    (range.lastRow === detectedLast && proposal.excludeLastRow);
  const allText = options.allText ?? proposal.allText;
  // Types as the import reads them: the excluded last row is not data.
  const typesTo =
    excludeLastRow && range.lastRow - 1 > headerRow
      ? range.lastRow - 1
      : range.lastRow;

  return withDuckDb(':memory:', async (connection) => {
    const shown: SheetPreview['rows'] = [];
    let blocks: number[][];
    let headerCells: Cell[];
    let lastCells: Cell[];
    let types: string[];
    if (csv) {
      blocks = shownRows(1, headerRow, range);
      const byRow = await csvCells(connection, path, [
        ...blocks,
        [headerRow, headerRow],
      ]);
      for (const [from, to] of blocks) {
        for (let row = from; row <= to; row++) {
          shown.push({ row, cells: fit(byRow.get(row), width) });
        }
      }
      headerCells = fit(byRow.get(headerRow), width);
      lastCells = fit(byRow.get(range.lastRow), width);
      types = await columnTypes(
        connection,
        readCsv(path, { header: true, allText, skip: headerRow - 1 }),
      );
    } else {
      await loadExcel(connection, importOptions);
      blocks = shownRows(
        Math.min(
          await sheetFirstRow(connection, path, proposal.sheet),
          headerRow,
        ),
        headerRow,
        range,
      );
      for (const [from, to] of blocks) {
        const cells = await xlsxCells(
          connection,
          path,
          proposal.sheet,
          range,
          from,
          to,
        );
        for (let row = from; row <= to; row++) {
          shown.push({ row, cells: fit(cells[row - from], width) });
        }
      }
      const oneRow = async (row: number) =>
        fit(
          (
            await xlsxCells(connection, path, proposal.sheet, range, row, row)
          )[0],
          width,
        );
      headerCells = await oneRow(headerRow);
      lastCells = await oneRow(range.lastRow);
      const columns = [range.firstColumn, range.lastColumn].map(columnLetter);
      types = await columnTypes(
        connection,
        readXlsx(path, proposal.sheet, {
          header: true,
          allText,
          range: `${columns[0]}${headerRow}:${columns[1]}${typesTo}`,
        }),
      );
    }

    // The grid is read as text, so an .xlsx date cell arrives as its serial
    // number; show it as the date the import stores.
    for (const shownRow of shown) {
      if (shownRow.row <= headerRow) continue;
      shownRow.cells = shownRow.cells.map((cell, i) =>
        excelSerialAsDate(cell, types[i]),
      );
    }
    const { names, duplicates } = headerNames(headerCells, range.firstColumn);
    const warnings: SheetWarning[] = [];
    const guessed = proposal.warnings?.find((w) => w.code === 'header-guessed');
    if (guessed && headerRow === proposal.headerRow) warnings.push(guessed);
    if (range.lastRow - headerRow >= 2 && looksLikeTotal(lastCells)) {
      warnings.push({ code: 'total-row', row: range.lastRow });
    }
    if (duplicates.length) {
      warnings.push({ code: 'duplicate-columns', names: duplicates });
    }
    return {
      sheet: proposal.sheet,
      headerRow,
      range: rangeText(range),
      totalRows: range.lastRow - headerRow,
      columns: names.map((name, i) => ({
        letter: columnLetter(range.firstColumn + i),
        name,
        type: types[i] ?? 'VARCHAR',
      })),
      rows: shown,
      warnings,
    };
  });
}
