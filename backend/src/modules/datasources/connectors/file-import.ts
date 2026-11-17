/**
 * The `file` kind's importer (ADR-0052, plan m1-31 4, 5 and 8): the
 * detection that proposes a header row, a range and warnings for each sheet,
 * the entity keys, and the import of the included sheets into the
 * datasource's `data.duckdb`. Separate from the connector: it opens the
 * database read-write with external access on, which the connector never does.
 */
import type { DuckDBConnection } from '@duckdb/node-api';
import { existsSync } from 'fs';
import { copyFile, mkdir, open, rename, rm, truncate } from 'fs/promises';
import { dirname } from 'path';
import type {
  SheetImport,
  SheetWarning,
  SourceFile,
} from '../entities/datasource.entity';
import {
  asText,
  duckDbMessage,
  quoteIdent,
  sqlString,
  withDuckDb,
} from './duckdb';
import { readSheetNames } from './xlsx-sheets';

export interface FileImportOptions {
  /**
   * The `excel` extension: an absolute path to `excel.duckdb_extension`
   * (the one shipped with the app, story 1.31.2), or `'installed'` for
   * `LOAD excel` from DuckDB's own extension directory. Never installed
   * on the fly: auto-install is off.
   */
  excelExtension: string;
}

export type FileFormat = SourceFile['format'];

/** The longest identifier the keys keep (Postgres's limit, for symmetry). */
const KEY_MAX = 63;
/** The rows from the first non-empty one where the header is looked for. */
const HEADER_SCAN_ROWS = 20;
/** The widest sheet the detection looks across (column ZZ). */
const SCAN_COLUMNS = 702;
const TOTAL_ROW = /^(grand )?(total|totals|sum|subtotal)\b/i;
const RANGE = /^([A-Z]{1,3})([1-9]\d*):([A-Z]{1,3})([1-9]\d*)$/;

// ---------------------------------------------------------------- names

/** `.xlsx` or `.csv` by extension, else undefined. */
export function fileFormatOf(name: string): FileFormat | undefined {
  const ext = /\.([^.]+)$/.exec(name ?? '')?.[1]?.toLowerCase();
  return ext === 'xlsx' || ext === 'csv' ? ext : undefined;
}

/** The file name without its extension. */
export function baseName(name: string): string {
  return (name ?? '').replace(/\.[^.]*$/, '');
}

/**
 * One entity key segment (plan m1-31 4): lower-cased, every run outside
 * `[a-z0-9_]` one `_`, no leading or trailing `_`, a leading digit
 * prefixed with `_`, at most 63 characters, `fallback` when empty.
 */
export function slugSegment(raw: string, fallback: 'file' | 'sheet'): string {
  let slug = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (/^[0-9]/.test(slug)) slug = `_${slug}`;
  return slug.slice(0, KEY_MAX) || fallback;
}

/** `base`, else `base_2`, `base_3`, … not in `taken`, cut to 63 characters. */
function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const key = base.slice(0, KEY_MAX - suffix.length) + suffix;
    if (!taken.has(key)) return key;
  }
}

/**
 * Give every file its `<schema>` and every sheet its `<table>` (plan m1-31
 * 4). Keys a file or sheet already has are kept when unique, so datasets
 * keep working; a new key is the slug, deduped with `_2`, `_3`. A CSV's
 * table equals its schema.
 */
export function assignEntityKeys(files: SourceFile[]): SourceFile[] {
  const schemas = new Set<string>();
  const keptSchema = files.map((f) => {
    const keep = !!f.schema && !schemas.has(f.schema);
    if (keep) schemas.add(f.schema);
    return keep;
  });
  return files.map((file, i) => {
    const schema = keptSchema[i]
      ? file.schema
      : uniqueKey(slugSegment(baseName(file.name), 'file'), schemas);
    schemas.add(schema);
    if (file.format === 'csv') {
      return {
        ...file,
        schema,
        sheets: file.sheets.map((s) => ({ ...s, table: schema })),
      };
    }
    return { ...file, schema, sheets: withTableKeys(file.sheets) };
  });
}

function withTableKeys(sheets: SheetImport[]): SheetImport[] {
  const tables = new Set<string>();
  const kept = sheets.map((s) => {
    const keep = !!s.table && !tables.has(s.table);
    if (keep) tables.add(s.table);
    return keep;
  });
  return sheets.map((s, i) => {
    const table = kept[i]
      ? s.table
      : uniqueKey(slugSegment(s.sheet, 'sheet'), tables);
    tables.add(table);
    return { ...s, table };
  });
}

/** 1 → A, 27 → AA. */
export function columnLetter(index: number): string {
  let letters = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** A → 1, AA → 27. */
function columnIndex(letters: string): number {
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

export interface CellRange {
  firstColumn: number;
  firstRow: number;
  lastColumn: number;
  lastRow: number;
}

/** `A3:H200` → its corners, 1-based; anything else is refused. */
export function parseRange(range: string): CellRange {
  const m = RANGE.exec((range ?? '').trim().toUpperCase());
  const range_ = m && {
    firstColumn: columnIndex(m[1]),
    firstRow: Number(m[2]),
    lastColumn: columnIndex(m[3]),
    lastRow: Number(m[4]),
  };
  if (
    !range_ ||
    range_.lastColumn < range_.firstColumn ||
    range_.lastRow < range_.firstRow
  ) {
    throw new Error('Range must look like A1:H200');
  }
  return range_;
}

export function rangeText(r: CellRange): string {
  return `${columnLetter(r.firstColumn)}${r.firstRow}:${columnLetter(r.lastColumn)}${r.lastRow}`;
}

export type Cell = string | null;

function present(cell: Cell): boolean {
  return cell !== null && cell !== undefined && String(cell).trim() !== '';
}

/** A cell read as text that does not look like a number, date or boolean. */
function isText(cell: string): boolean {
  const v = cell.trim();
  return !(
    /^[-+]?(\d[\d,]*\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(v) ||
    /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(v) ||
    /^(true|false)$/i.test(v)
  );
}

/**
 * The table's column names from its header cells: a duplicate (DuckDB
 * names are case-insensitive) becomes `<name>_2`, an empty one
 * `column_<letter>`.
 */
export function headerNames(
  cells: Cell[],
  firstColumn: number,
): { names: string[]; duplicates: string[] } {
  const taken = new Set<string>();
  const duplicates = new Set<string>();
  const names = cells.map((cell, i) => {
    const raw = present(cell) ? String(cell).trim() : '';
    const base = raw || `column_${columnLetter(firstColumn + i)}`;
    let name = base;
    if (taken.has(name.toLowerCase())) {
      if (raw) duplicates.add(raw);
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    }
    taken.add(name.toLowerCase());
    return name;
  });
  return { names, duplicates: [...duplicates] };
}

// ------------------------------------------------------------ detection

export async function loadExcel(
  connection: DuckDBConnection,
  options: FileImportOptions,
): Promise<void> {
  await connection.run(
    options.excelExtension === 'installed'
      ? 'LOAD excel'
      : `LOAD ${sqlString(options.excelExtension)}`,
  );
}

export function readXlsx(
  path: string,
  sheet: string,
  args: { header: boolean; allText: boolean; range?: string },
): string {
  const range = args.range ? `, range = ${sqlString(args.range)}` : '';
  return (
    `read_xlsx(${sqlString(path)}, sheet = ${sqlString(sheet)}, ` +
    `header = ${args.header}, all_varchar = ${args.allText}, ` +
    `stop_at_empty = false${range})`
  );
}

export function readCsv(
  path: string,
  args: { header: boolean; allText: boolean; skip?: number },
): string {
  const skip = args.skip ? `, skip = ${args.skip}` : '';
  return `read_csv(${sqlString(path)}, header = ${args.header}, all_varchar = ${args.allText}${skip})`;
}

export async function rows(
  connection: DuckDBConnection,
  sql: string,
): Promise<Cell[][]> {
  const reader = await connection.runAndReadAll(sql);
  return reader.getRowsJS() as Cell[][];
}

/** The last data row's first non-empty cell names a total (plan m1-31 5). */
export function looksLikeTotal(cells: Cell[]): boolean {
  const first = cells.find(present);
  return first !== undefined && TOTAL_ROW.test(String(first).trim());
}

function noTable(sheet: string): SheetImport {
  return {
    sheet,
    table: '',
    include: false,
    headerRow: 1,
    range: 'A1:A1',
    excludeLastRow: false,
    allText: false,
    warnings: [{ code: 'no-table' }],
  };
}

function proposal(
  sheet: string,
  headerRow: number,
  range: CellRange,
  headerCells: Cell[],
  lastCells: Cell[],
  headerGuessed: boolean,
): SheetImport {
  const warnings: SheetWarning[] = [];
  if (headerGuessed) warnings.push({ code: 'header-guessed', row: headerRow });
  // A total is only excluded when a data row stays behind.
  const total = range.lastRow - headerRow >= 2 && looksLikeTotal(lastCells);
  if (total) warnings.push({ code: 'total-row', row: range.lastRow });
  const { duplicates } = headerNames(headerCells, range.firstColumn);
  if (duplicates.length) {
    warnings.push({ code: 'duplicate-columns', names: duplicates });
  }
  return {
    sheet,
    table: '',
    include: true,
    headerRow,
    range: rangeText(range),
    excludeLastRow: total,
    allText: false,
    warnings,
  };
}

/**
 * One sheet (plan m1-31 5): DuckDB finds the sheet's first non-empty cell
 * and its last row; the header is the first of the 20 rows from there
 * whose non-empty cells are all text and number at least half of the
 * widest row's; the range runs from it to the last non-empty row, across
 * the non-empty columns.
 */
async function detectXlsxSheet(
  connection: DuckDBConnection,
  path: string,
  sheet: string,
): Promise<SheetImport> {
  const all = readXlsx(path, sheet, { header: false, allText: true });
  let firstRow: number;
  let lastRow: number;
  try {
    const start = (
      await connection.runAndReadAll(`SELECT * FROM ${all} LIMIT 0`)
    ).columnNames()[0];
    const [[count]] = await rows(connection, `SELECT count(*) FROM ${all}`);
    firstRow = Number(/^[A-Z]+(\d+)$/.exec(start ?? '')?.[1] ?? 1);
    lastRow = firstRow + Number(count) - 1;
  } catch {
    // "No rows found": an empty sheet, or a chart sheet.
    return noTable(sheet);
  }
  if (lastRow < firstRow) return noTable(sheet);

  const scanEnd = Math.min(lastRow, firstRow + HEADER_SCAN_ROWS - 1);
  const scan = await rows(
    connection,
    `SELECT * FROM ${readXlsx(path, sheet, {
      header: false,
      allText: true,
      range: `A${firstRow}:${columnLetter(SCAN_COLUMNS)}${scanEnd}`,
    })}`,
  );
  const widest = Math.max(0, ...scan.map((r) => r.filter(present).length));
  const headerAt = scan.findIndex((r) => {
    const filled = r.filter(present);
    return (
      filled.length > 0 &&
      filled.length * 2 >= widest &&
      filled.every((c) => isText(String(c)))
    );
  });
  if (headerAt < 0) return noTable(sheet);
  let first = Infinity;
  let last = -1;
  for (const r of scan.slice(headerAt)) {
    r.forEach((c, i) => {
      if (!present(c)) return;
      first = Math.min(first, i);
      last = Math.max(last, i);
    });
  }
  const headerRow = firstRow + headerAt;
  const firstColumn = first + 1;
  const lastColumn = last + 1;

  // The last non-empty row of those columns, below the header.
  const width = lastColumn - firstColumn + 1;
  const aliases = Array.from({ length: width }, (_, i) => `c${i}`);
  const filled = aliases.map((a) => `nullif(trim(${a}), '')`).join(', ');
  const [tail] = await rows(
    connection,
    `SELECT ${aliases.join(', ')}, n FROM ${readXlsx(path, sheet, {
      header: false,
      allText: true,
      range: `${columnLetter(firstColumn)}${headerRow}:${columnLetter(lastColumn)}${lastRow}`,
    })} WITH ORDINALITY AS t(${aliases.join(', ')}, n)
     WHERE coalesce(${filled}) IS NOT NULL
     ORDER BY n DESC LIMIT 1`,
  );
  const lastDataRow = headerRow + Number(tail?.[width] ?? 1) - 1;
  if (lastDataRow <= headerRow) return noTable(sheet);

  return proposal(
    sheet,
    headerRow,
    { firstColumn, firstRow: headerRow, lastColumn, lastRow: lastDataRow },
    scan[headerAt].slice(first, last + 1),
    (tail ?? []).slice(0, width),
    headerAt > 0,
  );
}

/** A CSV (plan m1-31 5): header row 1, the whole file, DuckDB's sniffing. */
async function detectCsv(
  connection: DuckDBConnection,
  path: string,
  sheet: string,
): Promise<SheetImport> {
  const [header] = await rows(
    connection,
    `SELECT * FROM ${readCsv(path, { header: false, allText: true })} LIMIT 1`,
  );
  const [tail] = await rows(
    connection,
    `SELECT * FROM ${readCsv(path, { header: true, allText: true })}
     WITH ORDINALITY ORDER BY ordinality DESC LIMIT 1`,
  );
  if (!header?.length || !tail) return noTable(sheet);
  const dataRows = Number(tail[tail.length - 1]);
  return proposal(
    sheet,
    1,
    {
      firstColumn: 1,
      firstRow: 1,
      lastColumn: header.length,
      lastRow: dataRows + 1,
    },
    header,
    tail.slice(0, -1),
    false,
  );
}

/**
 * The proposal for every sheet of one file (a CSV has one, named after the
 * file), each with a table key unique in the file. `fileName` is the
 * original name, which gives the format and a CSV's sheet name.
 */
export async function detectSheets(
  path: string,
  fileName: string,
  options: FileImportOptions,
): Promise<SheetImport[]> {
  const format = fileFormatOf(fileName);
  if (!format) throw new Error('Only .xlsx and .csv files can be imported');
  const detected = await withDuckDb(':memory:', async (connection) => {
    if (format === 'csv') {
      return [await detectCsv(connection, path, baseName(fileName))];
    }
    const names = await readSheetNames(path);
    await loadExcel(connection, options);
    const sheets: SheetImport[] = [];
    for (const name of names) {
      sheets.push(await detectXlsxSheet(connection, path, name));
    }
    return sheets;
  });
  return withTableKeys(detected);
}

// --------------------------------------------------------------- import

/** "Binder Error: Sheet … not found" → "Sheet … not found". */
function cause(err: unknown): string {
  return duckDbMessage(err, true).replace(/^[A-Z][\w ]*? Error: /, '');
}

async function importSheet(
  connection: DuckDBConnection,
  file: SourceFile,
  path: string,
  sheet: SheetImport,
): Promise<SheetImport> {
  let source: string;
  let headerCells: Cell[];
  let firstColumn = 1;
  const cleanup: string[] = [];
  let deleteLast = false;
  if (file.format === 'xlsx') {
    const range = parseRange(sheet.range);
    const headerRow = sheet.headerRow || range.firstRow;
    if (headerRow < range.firstRow || headerRow >= range.lastRow) {
      throw new Error(
        'The header row must be in the range, above its last row',
      );
    }
    firstColumn = range.firstColumn;
    const columns = `${columnLetter(range.firstColumn)}${headerRow}:${columnLetter(range.lastColumn)}`;
    [headerCells] = await rows(
      connection,
      `SELECT * FROM ${readXlsx(path, sheet.sheet, {
        header: false,
        allText: true,
        range: `${columns}${headerRow}`,
      })}`,
    );
    // An excluded last row is left out of the range read, not deleted after
    // it: a "Total" label under a numeric column would otherwise fail the
    // whole read (it does not convert to DOUBLE).
    const trim = sheet.excludeLastRow && range.lastRow - 1 > headerRow;
    const lastRow = trim ? range.lastRow - 1 : range.lastRow;
    // Only the header and the excluded row: read it, then drop that row.
    deleteLast = sheet.excludeLastRow && !trim;
    source = readXlsx(path, sheet.sheet, {
      header: true,
      allText: sheet.allText,
      range: `${columns}${lastRow}`,
    });
  } else {
    const skip = Math.max(0, (sheet.headerRow || 1) - 1);
    [headerCells] = await rows(
      connection,
      `SELECT * FROM ${readCsv(path, { header: false, allText: true, skip })} LIMIT 1`,
    );
    // Same reason for a CSV: read a copy that ends before its last line.
    const csvPath = sheet.excludeLastRow
      ? await withoutLastLine(path, `${path}.without-last-row.csv`)
      : path;
    if (csvPath !== path) cleanup.push(csvPath);
    source = readCsv(csvPath, { header: true, allText: sheet.allText, skip });
  }

  const engineNames = (
    await connection.runAndReadAll(`SELECT * FROM ${source} LIMIT 0`)
  ).columnNames();
  const { names } = headerNames(
    engineNames.map((_, i) => headerCells?.[i] ?? null),
    firstColumn,
  );
  const select = engineNames
    .map((n, i) => `${quoteIdent(n)} AS ${quoteIdent(names[i])}`)
    .join(', ');
  const table = `${quoteIdent(file.schema)}.${quoteIdent(sheet.table)}`;
  try {
    await connection.run(
      `CREATE TABLE ${table} AS SELECT ${select} FROM ${source}`,
    );
  } finally {
    await Promise.all(cleanup.map((p) => rm(p, { force: true })));
  }
  if (deleteLast) {
    await connection.run(
      `DELETE FROM ${table} WHERE rowid = (SELECT max(rowid) FROM ${table})`,
    );
  }
  const [[count]] = await rows(connection, `SELECT count(*) FROM ${table}`);
  const described = await connection.runAndReadAll(`DESCRIBE ${table}`);
  const columns = described.getRowObjectsJS().map((c) => ({
    name: asText(c.column_name),
    type: asText(c.column_type),
  }));
  return { ...sheet, rowCount: Number(count), columns };
}

/**
 * Copy `path` to `to` without its last non-empty line (and the blank lines
 * after it). Reads only the file's tail, so a 200 MB CSV costs one copy.
 */
export async function withoutLastLine(
  path: string,
  to: string,
): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    let end = size;
    // Drop trailing line breaks and spaces first.
    for (let chunk = 64 * 1024; ; chunk *= 2) {
      const start = Math.max(0, end - chunk);
      const buffer = Buffer.alloc(end - start);
      await handle.read(buffer, 0, buffer.length, start);
      let i = buffer.length;
      while (i > 0 && /\s/.test(String.fromCharCode(buffer[i - 1]))) i--;
      const lastBreak = buffer.lastIndexOf(0x0a, i - 1);
      if (lastBreak >= 0) {
        end = start + lastBreak + 1;
        break;
      }
      if (start === 0) {
        end = 0;
        break;
      }
    }
    await copyFile(path, to);
    await truncate(to, end);
    return to;
  } finally {
    await handle.close();
  }
}

async function removeDatabase(path: string): Promise<void> {
  await rm(path, { force: true });
  await rm(`${path}.wal`, { force: true });
}

/** Rename over `to`, retrying while a reader still holds it (Windows). */
async function replaceFile(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const busy = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!busy || attempt >= 9) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * Import every included sheet of `files` into `databasePath` (plan m1-31 6
 * and 8): built in `<databasePath>.tmp`, then renamed over it, so a failed
 * import leaves the previous database in place. Answers the files with each
 * included sheet's `rowCount` and `columns`; a failure names
 * `<file> · <sheet>: <cause>`.
 */
export async function importFiles(
  databasePath: string,
  files: { file: SourceFile; path: string }[],
  options: FileImportOptions,
): Promise<SourceFile[]> {
  const tmp = `${databasePath}.tmp`;
  await mkdir(dirname(databasePath), { recursive: true });
  await removeDatabase(tmp);
  let imported: SourceFile[];
  try {
    imported = await withDuckDb(tmp, async (connection) => {
      if (files.some(({ file }) => file.format === 'xlsx')) {
        await loadExcel(connection, options);
      }
      const out: SourceFile[] = [];
      for (const { file, path } of files) {
        try {
          await connection.run(`CREATE SCHEMA ${quoteIdent(file.schema)}`);
        } catch (err) {
          throw new Error(`${file.name}: ${cause(err)}`);
        }
        const sheets: SheetImport[] = [];
        for (const sheet of file.sheets) {
          if (!sheet.include) {
            // Facts of an earlier import no longer hold.
            const skipped = { ...sheet };
            delete skipped.rowCount;
            delete skipped.columns;
            sheets.push(skipped);
            continue;
          }
          try {
            sheets.push(await importSheet(connection, file, path, sheet));
          } catch (err) {
            throw new Error(`${file.name} · ${sheet.sheet}: ${cause(err)}`);
          }
        }
        out.push({ ...file, sheets });
      }
      await connection.run('CHECKPOINT');
      return out;
    });
  } catch (err) {
    await removeDatabase(tmp);
    throw err;
  }
  await rm(`${databasePath}.wal`, { force: true });
  await replaceFile(tmp, databasePath);
  if (existsSync(`${tmp}.wal`)) await rm(`${tmp}.wal`, { force: true });
  return imported;
}
