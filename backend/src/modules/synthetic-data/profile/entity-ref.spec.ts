import { entityRefFromKey } from './entity-ref';

describe('entityRefFromKey', () => {
  it('maps PostgreSQL database.schema.table to (schema, table)', () => {
    expect(entityRefFromKey('postgres', 'sales.public.orders')).toEqual({
      namespace: 'public',
      name: 'orders',
    });
  });

  it('maps Databricks catalog.schema.table to (catalog.schema, table)', () => {
    expect(entityRefFromKey('databricks', 'main.sales.orders')).toEqual({
      namespace: 'main.sales',
      name: 'orders',
    });
  });

  it('rejects keys with fewer than three parts', () => {
    expect(entityRefFromKey('postgres', 'public.orders')).toBeNull();
    expect(entityRefFromKey('postgres', 'a..b')).toBeNull();
  });

  it('rejects a PostgreSQL key naming another database', () => {
    expect(
      entityRefFromKey('postgres', 'other.public.orders', 'sales'),
    ).toBeNull();
  });
});
