import type { Stream } from 'stream';
import { stream } from 'exceljs';
import type { SyntheticValue } from '../dialects/writer';
import type { GeneratedTable } from '../generator/contract';

type CellValue = string | number | boolean | Date | null;

/** Sheet names: at most 31 characters, `[]:*?/\` replaced by `_`, de-duplicated with `~2`, `~3`. */
export function sheetNamer(): (raw: string) => string {
  const used = new Set<string>();
  return (raw: string) => {
    let base = raw.replace(/[[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '_');
    if (!base) base = '_';
    base = base.slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = `~${n}`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  };
}

/** Significant digits of a decimal text, so a number is numeric only when a double holds it. */
function withinSafePrecision(text: string): boolean {
  const digits = text.replace(/^[+-]/, '').replace('.', '').replace(/^0+/, '');
  return (
    digits.replace(/0+$/, '').length <= 15 && Number.isFinite(Number(text))
  );
}

const TS =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([+-])(\d{2}):?(\d{2})?)?$/;

function parseTimestamp(text: string): Date | null {
  const m = TS.exec(text);
  if (!m) return null;
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
  if (m[8]) {
    const offset = (+m[9] * 60 + +(m[10] ?? 0)) * 60000;
    t -= m[8] === '-' ? -offset : offset;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A synthetic value as an Excel cell value; strings stay plain text (never formulas). */
export function cellValue(value: SyntheticValue): {
  value: CellValue;
  numFmt?: string;
} {
  if (value === null) return { value: null };
  if (typeof value === 'boolean' || typeof value === 'string') return { value };
  switch (value.kind) {
    case 'neutral':
      return { value: null };
    case 'number':
      return withinSafePrecision(value.text)
        ? { value: Number(value.text), numFmt: 'General' }
        : { value: value.text };
    case 'date': {
      const d = parseTimestamp(`${value.text} 00:00:00`);
      return d ? { value: d, numFmt: 'yyyy-mm-dd' } : { value: value.text };
    }
    case 'timestamp': {
      const d = parseTimestamp(value.text);
      return d
        ? { value: d, numFmt: 'yyyy-mm-dd hh:mm:ss' }
        : { value: value.text };
    }
  }
}

/** Streams a workbook: sheet `About` with the readme, then one sheet per table. */
export async function writeXlsx(
  tables: Iterable<GeneratedTable>,
  readme: string[],
  out: NodeJS.WritableStream,
): Promise<{ rows: number }> {
  const workbook = new stream.xlsx.WorkbookWriter({
    stream: out as unknown as Stream,
    useStyles: true,
    useSharedStrings: false,
  });
  const name = sheetNamer();
  let rows = 0;

  const about = workbook.addWorksheet(name('About'));
  for (const line of readme) about.addRow([line]).commit();
  about.commit();

  for (const table of tables) {
    const sheet = workbook.addWorksheet(name(table.targetName));
    const header = sheet.addRow(table.columns.map((c) => c.name));
    header.font = { bold: true };
    header.commit();
    for (const row of table.rows) {
      const r = sheet.addRow([]);
      row.forEach((v, i) => {
        const cell = cellValue(v);
        if (cell.value === null) return;
        const c = r.getCell(i + 1);
        c.value = cell.value;
        if (cell.numFmt && cell.numFmt !== 'General') c.numFmt = cell.numFmt;
      });
      r.commit();
      rows++;
    }
    sheet.commit();
  }
  await workbook.commit();
  return { rows };
}
