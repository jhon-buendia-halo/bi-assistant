import { INSERT_BATCH_ROWS } from '../limits';
import type { SampledColumn, SampledRelationship } from '../types';
import type {
  DialectWriter,
  SyntheticValue,
  WriterColumn,
  WriterTable,
} from './writer';

const TIME_SUFFIX = '(?:\\(\\d{1,2}\\))?(?: with(?:out)? time zone)?';
const BASE_TYPES: RegExp[] = [
  /^(?:smallint|integer|bigint|int|int2|int4|int8)$/,
  /^(?:numeric|decimal)(?:\(\d{1,4}(?:,\s?-?\d{1,4})?\))?$/,
  /^(?:real|double precision|money|text|boolean|date|uuid|json|jsonb|bytea)$/,
  /^(?:varchar|character varying|char|character|bpchar)(?:\(\d{1,6}\))?$/,
  new RegExp(`^(?:time|timestamp)${TIME_SUFFIX}$`),
  /^interval(?:\(\d{1,2}\))?$/,
];

function isAllowed(type: string): boolean {
  let base = type.trim().toLowerCase().replace(/\s+/g, ' ');
  base = base.replace(/(?:\[\d*\])+$/, '');
  return BASE_TYPES.some((re) => re.test(base));
}

function quote(text: string): string {
  if (text.includes('\0'))
    throw new Error(
      'A string value contains a NUL character, which PostgreSQL cannot store.',
    );
  return `'${text.replace(/'/g, "''")}'`;
}

function quoteIdent(name: string): string {
  if (name.includes('\0'))
    throw new Error('An identifier contains a NUL character.');
  return `"${name.replace(/"/g, '""')}"`;
}

function qualify(targetSchema: string, table: string): string {
  return `${quoteIdent(targetSchema)}.${quoteIdent(table)}`;
}

function neutral(ddlType: string): string {
  const t = ddlType.trim().toLowerCase();
  if (/\[\d*\]$/.test(t)) return "'{}'";
  if (t === 'json' || t === 'jsonb') return "'{}'";
  if (t === 'bytea') return "'\\x'";
  if (t.startsWith('interval')) return "'0'";
  return "''";
}

const SAFE_NUMBER = /^-?\d+(?:\.\d+)?$/;
const colList = (names: string[]): string => names.map(quoteIdent).join(', ');

export const postgresWriter: DialectWriter = {
  dialect: 'postgres',
  quoteIdent,
  qualify,

  ddlType(column: SampledColumn): { ddl: string; note?: string } {
    const declared = column.type.trim();
    if (isAllowed(declared)) return { ddl: declared };
    return {
      ddl: 'text',
      note: `Column "${column.name}": type ${declared} is not supported and was replaced with text.`,
    };
  },

  literal(value: SyntheticValue, column: WriterColumn): string {
    if (value === null) return 'NULL';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'string') {
      const q = quote(value);
      return column.ddlType.trim().toLowerCase() === 'uuid' ? `${q}::uuid` : q;
    }
    switch (value.kind) {
      case 'number':
        return SAFE_NUMBER.test(value.text) ? value.text : quote(value.text);
      case 'date':
        return `DATE ${quote(value.text)}`;
      case 'timestamp':
        return `${value.zoned ? 'TIMESTAMPTZ' : 'TIMESTAMP'} ${quote(value.text)}`;
      case 'neutral':
        return neutral(column.ddlType);
    }
  },

  begin: () => ['BEGIN;'],
  end: () => ['COMMIT;'],

  createSchema(targetSchema: string): string {
    return `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(targetSchema)};`;
  },

  createTable(
    targetSchema: string,
    table: WriterTable,
    includeConstraints: boolean,
  ): string {
    const lines = table.columns.map(
      (c) =>
        `  ${quoteIdent(c.name)} ${c.ddlType}${c.notNull ? ' NOT NULL' : ''}`,
    );
    if (includeConstraints) {
      if (table.primaryKey.length > 0)
        lines.push(`  PRIMARY KEY (${colList(table.primaryKey)})`);
      for (const key of table.uniqueKeys)
        lines.push(`  UNIQUE (${colList(key)})`);
    }
    return `CREATE TABLE ${qualify(targetSchema, table.targetName)} (\n${lines.join(',\n')}\n);`;
  },

  insert(
    targetSchema: string,
    table: WriterTable,
    rows: SyntheticValue[][],
  ): string {
    if (rows.length === 0) throw new Error('An INSERT needs at least one row.');
    if (rows.length > INSERT_BATCH_ROWS)
      throw new Error(
        `An INSERT holds at most ${INSERT_BATCH_ROWS} rows, got ${rows.length}.`,
      );
    const values = rows.map(
      (row) =>
        `(${row.map((v, i) => this.literal(v, table.columns[i])).join(', ')})`,
    );
    return `INSERT INTO ${qualify(targetSchema, table.targetName)} (${colList(table.columns.map((c) => c.name))}) VALUES ${values.join(',\n')};`;
  },

  addForeignKey(
    targetSchema: string,
    rel: SampledRelationship,
    from: WriterTable,
    to: WriterTable,
  ): string {
    const name = `${from.targetName}_${rel.fromColumns.join('_')}_fk`;
    return `ALTER TABLE ${qualify(targetSchema, from.targetName)} ADD CONSTRAINT ${quoteIdent(name)} FOREIGN KEY (${colList(rel.fromColumns)}) REFERENCES ${qualify(targetSchema, to.targetName)} (${colList(rel.toColumns)});`;
  },

  headerNotes(): string[] {
    return [
      'Assumes standard_conforming_strings is on (the PostgreSQL default since 9.1).',
    ];
  },
};
