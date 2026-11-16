import type { SyntheticValue } from '../dialects/writer';

/** A synthetic value as the text of a CSV field; null and neutral are empty. */
export function valueText(value: SyntheticValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (value.kind === 'neutral') return '';
  return value.text;
}

/** One RFC 4180 field: quoted when it holds a comma, a quote, CR, LF or edge spaces. */
export function csvField(text: string): string {
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** One CSV record, CRLF-terminated. */
export function csvRow(fields: string[]): string {
  return fields.map(csvField).join(',') + '\r\n';
}

export function csvValuesRow(values: SyntheticValue[]): string {
  return csvRow(values.map(valueText));
}
