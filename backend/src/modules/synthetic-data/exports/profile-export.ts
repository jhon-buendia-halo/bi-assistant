import type { Stream } from 'stream';
import { stream } from 'exceljs';
import type { SampledColumn, SampledProfile, SampledTable } from '../types';
import { csvRow } from './csv';

export const PROFILE_COLUMN_HEADERS = [
  'table',
  'method',
  'sampledRows',
  'rowCountEstimate',
  'column',
  'type',
  'kind',
  'strategy',
  'nullPct',
  'distinct',
  'rangeOrLength',
  'topValues',
  'patterns',
];

export const PROFILE_TABLE_HEADERS = [
  'table',
  'namespace',
  'name',
  'method',
  'sampledRows',
  'rowCountEstimate',
  'durationMs',
  'primaryKey',
  'error',
];

function rangeOrLength(c: SampledColumn): string {
  if (c.numeric) return `${c.numeric.min}..${c.numeric.max}`;
  if (c.temporal) return `${c.temporal.min}..${c.temporal.max}`;
  if (c.length) return `length ${c.length.min}..${c.length.max}`;
  return '';
}

function columnRow(t: SampledTable, c: SampledColumn): (string | number)[] {
  return [
    t.key,
    t.method,
    t.sampledRows,
    t.rowCountEstimate ?? '',
    c.name,
    c.type,
    c.kind,
    c.strategy,
    Math.round(c.nullFraction * 10000) / 100,
    c.distinctCount,
    rangeOrLength(c),
    (c.topValues ?? []).map((v) => v.value).join(' | '),
    (c.patterns ?? []).map((p) => p.shape).join(' | '),
  ];
}

function tableRow(t: SampledTable): (string | number)[] {
  return [
    t.key,
    t.namespace,
    t.name,
    t.method,
    t.sampledRows,
    t.rowCountEstimate ?? '',
    t.durationMs,
    t.primaryKey.join(' | '),
    t.error ?? '',
  ];
}

/** The profile as CSV: one row per column of every table. Only what the profile holds. */
export function profileCsv(profile: SampledProfile): string {
  const lines = [csvRow(PROFILE_COLUMN_HEADERS)];
  for (const t of profile.tables) {
    for (const c of t.columns) lines.push(csvRow(columnRow(t, c).map(String)));
  }
  return lines.join('');
}

/** The profile as a workbook: sheets `Tables` and `Columns`. */
export async function writeProfileXlsx(
  profile: SampledProfile,
  out: NodeJS.WritableStream,
): Promise<void> {
  const workbook = new stream.xlsx.WorkbookWriter({
    stream: out as unknown as Stream,
    useStyles: true,
  });
  const add = (
    name: string,
    headers: string[],
    rows: (string | number)[][],
  ) => {
    const sheet = workbook.addWorksheet(name);
    const header = sheet.addRow(headers);
    header.font = { bold: true };
    header.commit();
    for (const r of rows)
      sheet.addRow(r.map((v) => (v === '' ? null : v))).commit();
    sheet.commit();
  };
  add('Tables', PROFILE_TABLE_HEADERS, profile.tables.map(tableRow));
  add(
    'Columns',
    PROFILE_COLUMN_HEADERS,
    profile.tables.flatMap((t) => t.columns.map((c) => columnRow(t, c))),
  );
  await workbook.commit();
}
