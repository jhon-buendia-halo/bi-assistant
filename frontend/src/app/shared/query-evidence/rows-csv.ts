/** A CSV from the rows an answer stored, and saving a blob (plan m1-25 3c). */

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180: a header row of the columns, then one line per row, CRLF between lines. */
export function rowsToCsv(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => cell(row[column])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function csvBlob(columns: string[], rows: Record<string, unknown>[]): Blob {
  return new Blob([rowsToCsv(columns, rows)], {
    type: 'text/csv;charset=utf-8',
  });
}

/** Offer a blob as a download. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
