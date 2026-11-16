import type { SyntheticValue } from '../dialects/writer';
import type { GeneratedTable } from '../generator/contract';
import type { SampledColumn, SampledProfile } from '../types';

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;

function temporalValue(text: string): SyntheticValue {
  const t = text.trim();
  if (DATE.test(t)) return { kind: 'date', text: t };
  const m = TIMESTAMP.exec(t);
  if (!m) return text;
  const zone = m[4];
  let suffix = '';
  if (zone) {
    if (zone === 'Z') suffix = '+00:00';
    else {
      const digits = zone.replace(':', '');
      suffix = `${digits.slice(0, 3)}:${digits.slice(3) || '00'}`;
    }
  }
  return {
    kind: 'timestamp',
    text: `${m[1]} ${m[2]}${m[3] ?? ''}${suffix}`,
    zoned: !!zone,
  };
}

function convert(
  text: string | null | undefined,
  column: SampledColumn,
): SyntheticValue {
  if (text === null || text === undefined) return null;
  switch (column.semanticType) {
    case 'numeric': {
      const t = text.trim();
      return DECIMAL.test(t) ? { kind: 'number', text: t } : text;
    }
    case 'boolean': {
      const t = text.trim().toLowerCase();
      if (t === 't' || t === 'true' || t === '1') return true;
      if (t === 'f' || t === 'false' || t === '0') return false;
      return text;
    }
    case 'temporal':
      return temporalValue(text);
    default:
      return text;
  }
}

/** Raw sampled text to typed values by the profiled semantic type; unparseable stays a string. */
export function sampleToTable(
  profile: SampledProfile,
  tableKey: string,
  targetName: string,
  outcome: { columns: string[]; rows: Record<string, string | null>[] },
): GeneratedTable {
  const table = profile.tables.find((t) => t.key === tableKey);
  if (!table) throw new Error(`Table ${tableKey} is not in the profile`);
  const columns = table.columns;
  return {
    key: table.key,
    targetName,
    columns,
    rows: outcome.rows.map((row) =>
      columns.map((c) => convert(row[c.name], c)),
    ),
    primaryKey: table.primaryKey,
    uniqueKeys: table.uniqueKeys,
  };
}
