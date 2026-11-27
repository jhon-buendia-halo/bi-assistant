import type { InventoryEntity } from './inventory';
import {
  countRowsSql,
  dailyVolumeSql,
  grainCountSql,
  nullCountsSql,
  orphansSql,
  tableRef,
} from './sql';

const entity = (
  kind: InventoryEntity['kind'],
  datasetKey: string,
): InventoryEntity => ({
  key: datasetKey,
  datasetKey,
  dataset: 'D',
  datasourceId: 'ds',
  kind,
  found: true,
  columnsKnown: true,
  columns: [],
});

describe('readiness SQL', () => {
  it('quotes per dialect: Postgres drops the database part, Databricks keeps three backticked parts', () => {
    expect(tableRef(entity('postgres', 'shop.sales.orders'))).toBe(
      '"sales"."orders"',
    );
    expect(tableRef(entity('databricks', 'main.sales.orders'))).toBe(
      '`main`.`sales`.`orders`',
    );
    expect(tableRef(entity('file', 'file.uploads.orders'))).toBe(
      '"file"."uploads"."orders"',
    );
  });

  it('escapes a quote inside an identifier instead of breaking out of it', () => {
    expect(tableRef(entity('postgres', 'db.s.we"ird'))).toBe('"s"."we""ird"');
    expect(tableRef(entity('databricks', 'c.s.we`ird'))).toBe(
      '`c`.`s`.`we``ird`',
    );
  });

  it('builds only aggregates, with a date literal window', () => {
    const e = entity('databricks', 'main.sales.orders');
    const since = new Date('2026-10-27T00:00:00Z');
    expect(countRowsSql(e)).toBe(
      'SELECT COUNT(*) AS row_count FROM `main`.`sales`.`orders`',
    );
    expect(dailyVolumeSql(e, 'order_date', since)).toContain(
      "WHERE `order_date` >= DATE '2026-10-27' GROUP BY CAST(`order_date` AS DATE)",
    );
    expect(
      nullCountsSql(e, [{ name: 'email', text: true }], {
        column: 'order_date',
        since,
      }),
    ).toBe(
      "SELECT COUNT(*) AS row_count, COUNT(`email`) AS nn_0, SUM(CASE WHEN TRIM(`email`) = '' THEN 1 ELSE 0 END) AS blank_0 FROM `main`.`sales`.`orders` WHERE `order_date` >= DATE '2026-10-27'",
    );
    expect(grainCountSql(e, ['a', 'b'])).toBe(
      'SELECT COUNT(*) AS key_count, SUM(n) AS row_count FROM (SELECT `a`, `b`, COUNT(*) AS n FROM `main`.`sales`.`orders` GROUP BY `a`, `b`) g',
    );
    const parent = { kind: e.kind, datasetKey: 'main.sales.customers' };
    expect(orphansSql(e, 'customer_id', parent, 'id')).toContain(
      'LEFT JOIN (SELECT DISTINCT `id` AS parent_key FROM `main`.`sales`.`customers`) p ON c.`customer_id` = p.parent_key',
    );
  });
});
