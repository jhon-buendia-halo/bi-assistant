import { INSERT_BATCH_ROWS } from '../limits';
import type { SampledColumn, SampledRelationship } from '../types';
import type {
  DialectWriter,
  SyntheticValue,
  WriterColumn,
  WriterTable,
} from './writer';

const SIMPLE_TYPES = new Set([
  'tinyint',
  'byte',
  'smallint',
  'short',
  'int',
  'integer',
  'bigint',
  'long',
  'float',
  'real',
  'double',
  'boolean',
  'string',
  'date',
  'timestamp',
  'timestamp_ntz',
  'binary',
]);

function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '<' || ch === '(') depth++;
    if (ch === '>' || ch === ')') depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** True when `type` (lower-cased) is in the allow-list, recursively for complex types. */
function allowedType(type: string): boolean {
  const t = type.trim();
  if (SIMPLE_TYPES.has(t)) return true;
  if (/^(varchar|char)\(\d+\)$/.test(t)) return true;
  if (/^decimal\(\d+,\s*\d+\)$/.test(t)) return true;
  const inner = /^(array|map|struct)<([\s\S]*)>$/.exec(t);
  if (!inner) return false;
  const body = inner[2];
  if (inner[1] === 'array') return allowedType(body);
  if (inner[1] === 'map') {
    const kv = splitTop(body, ',');
    return kv.length === 2 && kv.every(allowedType);
  }
  return splitTop(body, ',').every((field) => {
    const m = /^\s*(`(?:[^`]|``)+`|\w+)\s*:\s*([\s\S]+)$/.exec(field);
    return !!m && allowedType(m[2]);
  });
}

function escapeString(text: string): string {
  if (text.includes('\0'))
    throw new Error('String literal contains a NUL character');
  return (
    "'" +
    text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t') +
    "'"
  );
}

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

function qualifyTarget(target: string): string {
  return target.split('.').map(quoteIdent).join('.');
}

function isStruct(col: WriterColumn): boolean {
  return /^struct</i.test(col.ddlType.trim());
}

function neutral(ddl: string): string {
  const t = ddl.trim().toLowerCase();
  if (t.startsWith('array<')) return 'array()';
  if (t.startsWith('map<')) return 'map()';
  if (t.startsWith('struct<')) return 'NULL';
  if (t === 'binary') return "X''";
  if (t === 'interval') return 'INTERVAL 0 SECONDS';
  if (t === 'boolean') return 'FALSE';
  if (t === 'date') return "DATE'1970-01-01'";
  if (t === 'timestamp') return "TIMESTAMP'1970-01-01 00:00:00'";
  if (t === 'timestamp_ntz') return "TIMESTAMP_NTZ'1970-01-01 00:00:00'";
  if (
    /^(tinyint|byte|smallint|short|int|integer|bigint|long|float|real|double|decimal\(.*\))$/.test(
      t,
    )
  )
    return '0';
  return "''";
}

function literal(value: SyntheticValue, column: WriterColumn): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return escapeString(value);
  switch (value.kind) {
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(value.text))
        throw new Error(`Invalid number literal: ${value.text}`);
      return value.text;
    case 'date':
      return 'DATE' + escapeString(value.text);
    case 'timestamp':
      return (
        (value.zoned ? 'TIMESTAMP' : 'TIMESTAMP_NTZ') + escapeString(value.text)
      );
    case 'neutral':
      return neutral(column.ddlType);
  }
}

function ddlType(column: SampledColumn): { ddl: string; note?: string } {
  const raw = column.type.trim();
  if (allowedType(raw.toLowerCase())) return { ddl: raw };
  return {
    ddl: 'string',
    note: `column ${column.name}: type ${raw} is not supported, written as string`,
  };
}

function columnDef(
  col: WriterColumn,
  pk: Set<string>,
  includeConstraints: boolean,
): string {
  const forceNotNull = includeConstraints && pk.has(col.name);
  const notNull = (col.notNull || forceNotNull) && !isStruct(col);
  return `  ${quoteIdent(col.name)} ${col.ddlType}${notNull ? ' NOT NULL' : ''}`;
}

export const databricksWriter: DialectWriter = {
  dialect: 'databricks',
  quoteIdent,
  qualify: (targetSchema, table) =>
    `${qualifyTarget(targetSchema)}.${quoteIdent(table)}`,
  ddlType,
  literal,
  begin: () => [],
  end: () => [],
  createSchema: (targetSchema) =>
    `CREATE SCHEMA IF NOT EXISTS ${qualifyTarget(targetSchema)};`,
  createTable(targetSchema, table, includeConstraints) {
    const pk = new Set(table.primaryKey);
    const lines = table.columns.map((c) =>
      columnDef(c, pk, includeConstraints),
    );
    if (includeConstraints && table.primaryKey.length > 0) {
      lines.push(
        `  CONSTRAINT ${quoteIdent(`${table.targetName}_pk`)} PRIMARY KEY (${table.primaryKey.map(quoteIdent).join(', ')})`,
      );
    }
    return `CREATE TABLE ${this.qualify(targetSchema, table.targetName)} (\n${lines.join(',\n')}\n) USING DELTA;`;
  },
  insert(targetSchema, table, rows) {
    if (rows.length > INSERT_BATCH_ROWS) {
      throw new Error(
        `INSERT batch of ${rows.length} rows exceeds ${INSERT_BATCH_ROWS}`,
      );
    }
    const cols = table.columns.map((c) => quoteIdent(c.name)).join(', ');
    const tuples = rows.map((row) => {
      if (row.length !== table.columns.length)
        throw new Error('Row width does not match the column count');
      return `(${row.map((v, i) => literal(v, table.columns[i])).join(', ')})`;
    });
    return `INSERT INTO ${this.qualify(targetSchema, table.targetName)} (${cols}) VALUES ${tuples.join(',\n')};`;
  },
  addForeignKey(
    targetSchema,
    rel: SampledRelationship,
    from: WriterTable,
    to: WriterTable,
  ) {
    const name = `${from.targetName}_${rel.fromColumns.join('_')}_fk`;
    return (
      `ALTER TABLE ${this.qualify(targetSchema, from.targetName)} ADD CONSTRAINT ${quoteIdent(name)} ` +
      `FOREIGN KEY (${rel.fromColumns.map(quoteIdent).join(', ')}) ` +
      `REFERENCES ${this.qualify(targetSchema, to.targetName)} (${rel.toColumns.map(quoteIdent).join(', ')});`
    );
  },
  headerNotes: () => [
    'Databricks has no multi-statement transaction: a failed run may leave partial tables.',
    'PRIMARY KEY and FOREIGN KEY constraints are informational and need Unity Catalog; switch constraints off if your workspace does not use it.',
    'UNIQUE keys are not emitted (Databricks has no enforced UNIQUE).',
    'NOT NULL struct columns are created nullable and filled with NULL.',
  ],
};
