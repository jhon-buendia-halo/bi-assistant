import { countStatement, tablesOfQuery } from './query-tables';

const CATALOG = [
  'shop.public.returns',
  'shop.public.products',
  'shop.public.orders',
];

describe('tablesOfQuery (plan 3d)', () => {
  it('finds each catalog entity the SQL names, once, in catalog order', () => {
    expect(
      tablesOfQuery(
        'SELECT p.name FROM shop.public.products p JOIN SHOP.PUBLIC.RETURNS r ON r.p = p.id JOIN shop.public.returns r2 ON true',
        CATALOG,
      ),
    ).toEqual(['shop.public.returns', 'shop.public.products']);
  });

  it('accepts quoted parts and, on PostgreSQL, schema.table', () => {
    expect(
      tablesOfQuery('SELECT * FROM "public"."orders"', CATALOG, 'postgres'),
    ).toEqual(['shop.public.orders']);
    expect(
      tablesOfQuery(
        'SELECT * FROM `shop`.`public`.`orders`',
        CATALOG,
        'databricks',
      ),
    ).toEqual(['shop.public.orders']);
    expect(
      tablesOfQuery('SELECT * FROM public.orders', CATALOG, 'databricks'),
    ).toEqual([]);
  });

  it('ignores a name inside a string literal', () => {
    expect(
      tablesOfQuery(
        "SELECT 'shop.public.orders' AS label FROM shop.public.returns",
        CATALOG,
      ),
    ).toEqual(['shop.public.returns']);
  });
});

describe('countStatement (plan 3d)', () => {
  it('counts one table in the dialect of its datasource', () => {
    expect(countStatement('shop.public.returns', 'postgres')).toBe(
      'SELECT COUNT(*) AS n FROM "public"."returns"',
    );
    expect(countStatement('main.sales.returns', 'databricks')).toBe(
      'SELECT COUNT(*) AS n FROM `main`.`sales`.`returns`',
    );
    expect(countStatement('api.v1.users', 'rest')).toBe(
      'SELECT COUNT(*) AS n FROM api.v1.users',
    );
  });
});
