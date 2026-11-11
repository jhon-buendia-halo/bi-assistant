import {
  SampledColumn,
  SampledRelationship,
  SampledTable,
  SampleMethod,
} from './synthetic-data.model';

const nf = new Intl.NumberFormat('en-US');

export function formatCount(n: number): string {
  return nf.format(n);
}

/** 2_300_000 -> "2.3M", 15_000 -> "15K"; small numbers stay exact. */
export function abbreviateCount(n: number): string {
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e4) return `${trim(n / 1e3)}K`;
  return formatCount(n);
}

export function methodChipText(table: SampledTable): string {
  const rows = formatCount(table.sampledRows);
  switch (table.method) {
    case 'full':
      return `Read all ${rows} rows`;
    case 'limit':
      return `First ${rows} rows (sampling not supported here)`;
    default:
      return table.rowCountEstimate === null
        ? `Sampled ${rows} rows`
        : `Sampled ${rows} of ~${abbreviateCount(table.rowCountEstimate)} rows`;
  }
}

const METHOD_TOOLTIP: Record<SampleMethod, string> = {
  tablesample: 'TABLESAMPLE',
  full: 'full read',
  limit: 'LIMIT',
};

export function methodTooltip(method: SampleMethod): string {
  return METHOD_TOOLTIP[method];
}

const FORMAT_LABEL: Record<string, string> = {
  email: 'Example emails',
  phone: 'Example phone numbers',
  url: 'Example URLs',
  uuid: 'Example UUIDs',
  'date-string': 'Example dates',
};

/** The "Generated as" chip text of a column (plan 3.4). */
export function strategyChipText(
  column: SampledColumn,
  table: SampledTable,
  relationships: SampledRelationship[],
  tables: SampledTable[],
): string {
  switch (column.strategy) {
    case 'sequence':
      return 'Sequence 1…n';
    case 'uuid':
      return 'Random UUIDs';
    case 'unique-pattern':
      return 'Unique values like the pattern';
    case 'foreign-key': {
      const rel = relationships.find(
        (r) => r.fromTable === table.key && r.fromColumns.includes(column.name),
      );
      const parent = rel ? tables.find((t) => t.key === rel.toTable) : undefined;
      return `Keys of ${parent?.name ?? rel?.toTable ?? 'the parent table'}`;
    }
    case 'categorical':
      return `Reuses ${column.topValues?.length ?? 0} values`;
    case 'numeric-range':
      return 'Numbers in the observed range';
    case 'temporal-range':
      return 'Dates in the observed range';
    case 'boolean-rate':
      return `True ${Math.round((column.boolean?.trueFraction ?? 0) * 100)} %`;
    case 'format-template':
      return column.formatRule
        ? (FORMAT_LABEL[column.formatRule] ?? 'Example formatted values')
        : 'Example emails, phones, URLs, UUIDs or dates';
    case 'pattern':
      return 'Text like the pattern';
    case 'words':
      return 'Placeholder words';
    case 'null-only':
      return 'NULL (type not synthesized)';
    case 'constant':
      return 'Empty value (type not synthesized)';
  }
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10} %`;
}

/** Range (numeric, temporal), true share or length (text); '' when none. */
export function rangeText(column: SampledColumn): string {
  if (column.numeric) {
    return `${column.numeric.min} to ${column.numeric.max}`;
  }
  const temporal = column.temporal;
  if (temporal) {
    const cut = (s: string) =>
      temporal.granularity === 'date' ? s.slice(0, 10) : s;
    return `${cut(temporal.min)} to ${cut(temporal.max)}`;
  }
  if (column.boolean) {
    return `${percent(column.boolean.trueFraction)} true`;
  }
  if (column.length) {
    return `${column.length.min} to ${column.length.max} chars`;
  }
  return '';
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} min ago`;
}

export function minutesLeft(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60000));
}
