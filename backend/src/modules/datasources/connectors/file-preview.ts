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

/** The sheet rows the grid shows: the first 7 of the range and its last 2. */
function shownRows(range: CellRange): number[][] {
  const headEnd = Math.min(range.firstRow + HEAD_ROWS - 1, range.lastRow);
  const tailStart = Math.max(headEnd + 1, range.lastRow - TAIL_ROWS + 1);
  const blocks = [[range.firstRow, headEnd]];
  if (tailStart <= range.lastRow) blocks.push([tailStart, range.lastRow]);
  return blocks;
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
  const blocks = shownRows(range);
  // Types as the import reads them: the excluded last row is not data.
  const typesTo =
    excludeLastRow && range.lastRow - 1 > headerRow
      ? range.lastRow - 1
      : range.lastRow;

  return withDuckDb(':memory:', async (connection) => {
    const shown: SheetPreview['rows'] = [];
    let headerCells: Cell[];
    let lastCells: Cell[];
    let types: string[];
    if (csv) {
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
