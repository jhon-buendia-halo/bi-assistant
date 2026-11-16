import { postgresWriter as w } from './postgres.writer';
import type { SampledColumn, SampledRelationship } from '../types';
import type { WriterColumn, WriterTable } from './writer';

const src = (type: string, name = 'c'): SampledColumn =>
  ({ name, type }) as SampledColumn;
const col = (name: string, ddlType: string, notNull = false): WriterColumn => ({
  name,
  ddlType,
  notNull,
  source: src(ddlType, name),
});
const table = (over: Partial<WriterTable> = {}): WriterTable => ({
  key: 's.t',
  targetName: 't',
  columns: [col('id', 'integer', true), col('na"me', 'text')],
  primaryKey: ['id'],
  uniqueKeys: [['na"me']],
  ...over,
});

describe('postgresWriter', () => {
  it('quotes identifiers doubling " and qualifies', () => {
    expect(w.quoteIdent('a"b')).toBe('"a""b"');
    expect(w.qualify('syn', 'T x')).toBe('"syn"."T x"');
  });

  it('writes schema, begin and end', () => {
    expect(w.createSchema('syn')).toBe('CREATE SCHEMA IF NOT EXISTS "syn";');
    expect(w.begin()).toEqual(['BEGIN;']);
    expect(w.end()).toEqual(['COMMIT;']);
  });

  it('allows built-in types, arrays included, and falls back to text with a note', () => {
    for (const t of [
      'integer',
      'bigint',
      'numeric(10,2)',
      'numeric',
      'double precision',
      'money',
      'character varying(20)',
      'character(3)',
      'timestamp with time zone',
      'timestamp(3) without time zone',
      'time without time zone',
      'interval',
      'uuid',
      'jsonb',
      'bytea',
      'integer[]',
      'text[][]',
    ]) {
      expect(w.ddlType(src(t))).toEqual({ ddl: t });
    }
    const e = w.ddlType(src('mood', 'feeling'));
    expect(e.ddl).toBe('text');
    expect(e.note).toContain('mood');
    expect(w.ddlType(src('citext')).ddl).toBe('text');
    expect(w.ddlType(src('public.my_domain')).ddl).toBe('text');
  });

  it('creates tables with and without constraints', () => {
    expect(w.createTable('syn', table(), true)).toBe(
      'CREATE TABLE "syn"."t" (\n  "id" integer NOT NULL,\n  "na""me" text,\n  PRIMARY KEY ("id"),\n  UNIQUE ("na""me")\n);',
    );
    expect(w.createTable('syn', table(), false)).toBe(
      'CREATE TABLE "syn"."t" (\n  "id" integer NOT NULL,\n  "na""me" text\n);',
    );
  });

  it('writes every literal kind', () => {
    const c = col('c', 'text');
    expect(w.literal(null, c)).toBe('NULL');
    expect(w.literal(true, c)).toBe('TRUE');
    expect(w.literal(false, c)).toBe('FALSE');
    expect(w.literal("O'Réilly ✓", c)).toBe("'O''Réilly ✓'");
    expect(w.literal('a\\b', c)).toBe("'a\\b'");
    expect(w.literal('abc', col('u', 'uuid'))).toBe("'abc'::uuid");
    expect(w.literal({ kind: 'number', text: '-12.50' }, c)).toBe('-12.50');
    expect(w.literal({ kind: 'number', text: '1; DROP' }, c)).toBe("'1; DROP'");
    expect(w.literal({ kind: 'date', text: '2024-01-31' }, c)).toBe(
      "DATE '2024-01-31'",
    );
    expect(
      w.literal(
        { kind: 'timestamp', text: '2024-01-31 10:00:00', zoned: false },
        c,
      ),
    ).toBe("TIMESTAMP '2024-01-31 10:00:00'");
    expect(
      w.literal(
        { kind: 'timestamp', text: '2024-01-31 10:00:00+00:00', zoned: true },
        c,
      ),
    ).toBe("TIMESTAMPTZ '2024-01-31 10:00:00+00:00'");
    expect(w.literal('12x', col('n', 'integer'))).toBe("'12x'");
  });

  it('rejects NUL in strings', () => {
    expect(() => w.literal('a\0b', col('c', 'text'))).toThrow(/NUL/);
  });

  it('writes neutral literals per type', () => {
    const n = { kind: 'neutral' } as const;
    expect(w.literal(n, col('c', 'json'))).toBe("'{}'");
    expect(w.literal(n, col('c', 'jsonb'))).toBe("'{}'");
    expect(w.literal(n, col('c', 'integer[]'))).toBe("'{}'");
    expect(w.literal(n, col('c', 'bytea'))).toBe("'\\x'");
    expect(w.literal(n, col('c', 'interval'))).toBe("'0'");
    expect(w.literal(n, col('c', 'text'))).toBe("''");
  });

  it('batches inserts and refuses more than 500 rows', () => {
    const t = table();
    expect(
      w.insert('syn', t, [
        [{ kind: 'number', text: '1' }, "a'b"],
        [{ kind: 'number', text: '2' }, null],
      ]),
    ).toBe(
      `INSERT INTO "syn"."t" ("id", "na""me") VALUES (1, 'a''b'),\n(2, NULL);`,
    );
    const rows = Array.from({ length: 501 }, () => [null, null]);
    expect(() => w.insert('syn', t, rows)).toThrow(/500/);
    expect(() => w.insert('syn', t, rows.slice(0, 500))).not.toThrow();
    expect(() => w.insert('syn', t, [])).toThrow();
  });

  it('adds foreign keys', () => {
    const rel: SampledRelationship = {
      fromTable: 'a',
      fromColumns: ['x', 'y'],
      toTable: 'b',
      toColumns: ['id', 'id2'],
      origin: 'declared',
    };
    expect(
      w.addForeignKey(
        'syn',
        rel,
        table({ targetName: 'a' }),
        table({ targetName: 'b' }),
      ),
    ).toBe(
      'ALTER TABLE "syn"."a" ADD CONSTRAINT "a_x_y_fk" FOREIGN KEY ("x", "y") REFERENCES "syn"."b" ("id", "id2");',
    );
  });

  it('states standard_conforming_strings and never emits CR', () => {
    expect(w.headerNotes().join(' ')).toContain('standard_conforming_strings');
    const all = [
      w.createSchema('s'),
      w.createTable('s', table(), true),
      w.insert('s', table(), [[null, 'x']]),
      ...w.headerNotes(),
    ].join('\n');
    expect(all).not.toContain('\r');
  });
});
