import {
  inferJoinCandidates,
  JoinTableShape,
  MAX_INFERRED_JOIN_CANDIDATES,
} from './infer-joins';

function table(
  name: string,
  columns: string[],
  namespace = 'main.sales',
): JoinTableShape {
  return { namespace, name, columns };
}

describe('inferJoinCandidates (F1.20.3)', () => {
  it('matches snake_case `<base>_id` to the plural/singular sibling on `id`', () => {
    const customers = table('customers', ['id', 'name']);
    const orders = table('orders', ['id', 'customer_id', 'amount']);
    const out = inferJoinCandidates([orders], [orders, customers], new Set());
    expect(out).toEqual([
      {
        schema: 'main.sales',
        table: 'orders',
        column: 'customer_id',
        refSchema: 'main.sales',
        refTable: 'customers',
        refColumn: 'id',
      },
    ]);
  });

  it('matches camelCase `<Base>Id` to a dim_ table on the same column name', () => {
    const dim = table('dim_metriccategory', [
      'MetricCategoryId',
      'MetricCategoryName',
    ]);
    const fact = table('fact_participation', ['MetricCategoryId', 'Value']);
    const out = inferJoinCandidates([fact], [fact, dim], new Set());
    expect(out).toHaveLength(1);
    expect(out[0].refTable).toBe('dim_metriccategory');
    expect(out[0].refColumn).toBe('MetricCategoryId');
  });

  it('skips columns already covered by a declared FK', () => {
    const customers = table('customers', ['id']);
    const orders = table('orders', ['customer_id']);
    const declared = new Set(['main.sales orders customer_id']);
    expect(
      inferJoinCandidates([orders], [orders, customers], declared),
    ).toHaveLength(0);
  });

  it('never matches a table to itself and never crosses namespaces', () => {
    const selfRef = table('order', ['order_id']);
    const otherNs = table('customers', ['id'], 'other.ns');
    const orders = table('orders', ['customer_id']);
    expect(inferJoinCandidates([selfRef], [selfRef], new Set())).toHaveLength(
      0,
    );
    expect(
      inferJoinCandidates([orders], [orders, otherNs], new Set()),
    ).toHaveLength(0);
  });

  it('returns nothing when the target lacks both `id` and the column', () => {
    const customers = table('customers', ['customer_key', 'name']);
    const orders = table('orders', ['customer_id']);
    expect(
      inferJoinCandidates([orders], [orders, customers], new Set()),
    ).toHaveLength(0);
  });

  it('caps the candidate list', () => {
    const children: JoinTableShape[] = [];
    const all: JoinTableShape[] = [];
    for (let i = 0; i < 30; i++) {
      const parent = table(`thing${i}`, ['id']);
      const child = table(`child${i}`, [`thing${i}_id`]);
      all.push(parent, child);
      children.push(child);
    }
    expect(inferJoinCandidates(children, all, new Set()).length).toBe(
      MAX_INFERRED_JOIN_CANDIDATES,
    );
  });
});
