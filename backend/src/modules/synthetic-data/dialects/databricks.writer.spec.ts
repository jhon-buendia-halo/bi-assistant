import { databricksWriter as w } from './databricks.writer';
import { smokeCheckStatements } from './smoke';
import type { WriterColumn, WriterTable } from './writer';

const src = (name: string, type: string) => ({ name, type }) as never;
const col = (name: string, ddlType: string, notNull = false): WriterColumn => ({
  name,
  ddlType,
  notNull,
  source: src(name, ddlType),
});
const table = (over: Partial<WriterTable> = {}): WriterTable => ({
  key: 'main.orders',
  targetName: 'orders',
  columns: [col('id', 'bigint', true), col('note', 'string')],
  primaryKey: ['id'],
  uniqueKeys: [['note']],
  ...over,
});

describe('databricksWriter', () => {
  it('quotes identifiers with backticks and doubles them', () => {
    expect(w.quoteIdent('a`b')).toBe('`a``b`');
    expect(w.qualify('synthetic', 'orders')).toBe('`synthetic`.`orders`');
    expect(w.qualify('main.synthetic', 'o`x')).toBe(
      '`main`.`synthetic`.`o``x`',
    );
  });

  it('creates the schema for schema and catalog.schema targets', () => {
    expect(w.createSchema('synthetic')).toBe(
      'CREATE SCHEMA IF NOT EXISTS `synthetic`;',
    );
    expect(w.createSchema('main.synthetic')).toBe(
      'CREATE SCHEMA IF NOT EXISTS `main`.`synthetic`;',
    );
  });

  it('has no transaction statements and notes partial runs', () => {
    expect(w.begin()).toEqual([]);
    expect(w.end()).toEqual([]);
    expect(w.headerNotes().join('\n')).toMatch(/partial tables/);
    expect(w.headerNotes().join('\n')).toMatch(/Unity Catalog/);
  });

  it('escapes string literals', () => {
    const c = col('s', 'string');
    expect(w.literal("O'Brien", c)).toBe("'O\\'Brien'");
    expect(w.literal('C:\\path', c)).toBe("'C:\\\\path'");
    expect(w.literal("a\\'b", c)).toBe("'a\\\\\\'b'");
    expect(w.literal('a/b', c)).toBe("'a/b'");
    expect(w.literal('l1\nl2\r', c)).toBe("'l1\\nl2\\r'");
    expect(() => w.literal('a\0b', c)).toThrow(/NUL/);
  });

  it('writes typed literals', () => {
    const c = col('x', 'string');
    expect(w.literal(null, c)).toBe('NULL');
    expect(w.literal(true, c)).toBe('TRUE');
    expect(w.literal(false, c)).toBe('FALSE');
    expect(w.literal({ kind: 'number', text: '-12.50' }, c)).toBe('-12.50');
    expect(w.literal({ kind: 'date', text: '2024-01-31' }, c)).toBe(
      "DATE'2024-01-31'",
    );
    expect(
      w.literal(
        { kind: 'timestamp', text: '2024-01-31 10:00:00', zoned: true },
        c,
      ),
    ).toBe("TIMESTAMP'2024-01-31 10:00:00'");
    expect(
      w.literal(
        { kind: 'timestamp', text: '2024-01-31 10:00:00', zoned: false },
        c,
      ),
    ).toBe("TIMESTAMP_NTZ'2024-01-31 10:00:00'");
    expect(() => w.literal({ kind: 'number', text: '1e5' }, c)).toThrow();
  });

  it('writes neutral literals per type', () => {
    const n = { kind: 'neutral' } as const;
    expect(w.literal(n, col('a', 'array<int>'))).toBe('array()');
    expect(w.literal(n, col('a', 'map<string,int>'))).toBe('map()');
    expect(w.literal(n, col('a', 'binary'))).toBe("X''");
    expect(w.literal(n, col('a', 'interval'))).toBe('INTERVAL 0 SECONDS');
    expect(w.literal(n, col('a', 'struct<a:int>', true))).toBe('NULL');
    expect(w.literal(n, col('a', 'string'))).toBe("''");
  });

  it('allow-lists types and falls back to string with a note', () => {
    for (const t of [
      'bigint',
      'decimal(10,2)',
      'varchar(20)',
      'array<int>',
      'map<string,array<int>>',
      'struct<a:int,b:array<string>>',
      'timestamp_ntz',
    ]) {
      expect(w.ddlType(src('c', t))).toEqual({ ddl: t });
    }
    for (const t of [
      'interval day',
      'variant',
      'array<variant>',
      'struct<a:foo>',
    ]) {
      const r = w.ddlType(src('c', t));
      expect(r.ddl).toBe('string');
      expect(r.note).toContain(t);
    }
  });

  it('creates a Delta table with an inline primary key and no UNIQUE', () => {
    expect(w.createTable('main.syn', table(), true)).toBe(
      'CREATE TABLE `main`.`syn`.`orders` (\n  `id` bigint NOT NULL,\n  `note` string,\n  CONSTRAINT `orders_pk` PRIMARY KEY (`id`)\n) USING DELTA;',
    );
  });

  it('omits constraints when switched off but keeps declared NOT NULL', () => {
    const t = table({ columns: [col('id', 'bigint'), col('n', 'int', true)] });
    expect(w.createTable('syn', t, false)).toBe(
      'CREATE TABLE `syn`.`orders` (\n  `id` bigint,\n  `n` int NOT NULL\n) USING DELTA;',
    );
  });

  it('forces PK columns NOT NULL with constraints on', () => {
    const t = table({ columns: [col('id', 'bigint')] });
    expect(w.createTable('syn', t, true)).toContain('`id` bigint NOT NULL');
  });

  it('emits a NOT NULL struct column nullable', () => {
    const t = table({
      columns: [col('s', 'struct<a:int>', true)],
      primaryKey: [],
    });
    expect(w.createTable('syn', t, true)).toBe(
      'CREATE TABLE `syn`.`orders` (\n  `s` struct<a:int>\n) USING DELTA;',
    );
  });

  it('adds informational foreign keys', () => {
    const child = table({ targetName: 'items' });
    const rel = {
      fromTable: 'a',
      fromColumns: ['order_id'],
      toTable: 'b',
      toColumns: ['id'],
      origin: 'declared' as const,
    };
    expect(w.addForeignKey('syn', rel, child, table())).toBe(
      'ALTER TABLE `syn`.`items` ADD CONSTRAINT `items_order_id_fk` FOREIGN KEY (`order_id`) REFERENCES `syn`.`orders` (`id`);',
    );
  });

  it('batches inserts at 500 rows and throws above', () => {
    const t = table();
    const row = [{ kind: 'number', text: '1' } as const, "x'y"];
    expect(w.insert('syn', t, [row, row])).toBe(
      "INSERT INTO `syn`.`orders` (`id`, `note`) VALUES (1, 'x\\'y'),\n(1, 'x\\'y');",
    );
    expect(() =>
      w.insert(
        'syn',
        t,
        Array.from({ length: 500 }, () => row),
      ),
    ).not.toThrow();
    expect(() =>
      w.insert(
        'syn',
        t,
        Array.from({ length: 501 }, () => row),
      ),
    ).toThrow(/500/);
  });

  it('writes a full script that passes the smoke check, with LF only', () => {
    const t = table();
    const child = table({ targetName: 'items', primaryKey: [] });
    const rel = {
      fromTable: 'a',
      fromColumns: ['id'],
      toTable: 'b',
      toColumns: ['id'],
      origin: 'declared' as const,
    };
    const script =
      [
        "-- header; with a semicolon and a ' quote",
        w.createSchema('main.syn'),
        w.createTable('main.syn', t, true),
        w.createTable('main.syn', child, true),
        w.insert('main.syn', t, [
          [{ kind: 'number', text: '1' }, "O'Brien; (x"],
          [{ kind: 'number', text: '2' }, 'C:\\path\\'],
        ]),
        w.addForeignKey('main.syn', rel, child, t),
      ].join('\n') + '\n';
    expect(script).not.toContain('\r');
    expect(smokeCheckStatements(script)).toEqual([]);
  });
});
