import { ineffectiveLeftJoinFilters } from './left-join-filter';

describe('ineffectiveLeftJoinFilters (agents.md 5.4)', () => {
  it('finds a filter in the ON clause of a LEFT JOIN nothing else reads', () => {
    const found = ineffectiveLeftJoinFilters(`
      SELECT r.name, SUM(f.amount_cents) AS revenue
      FROM sales.regions r
      LEFT JOIN sales.fees f ON f.region_id = r.id
      LEFT JOIN sales.periods fp
        ON fp.id = f.period_id
       AND fp.fiscal_year = 2025
      GROUP BY r.name`);

    expect(found).toEqual([
      {
        join: 'LEFT JOIN sales.periods fp',
        alias: 'fp',
        conditions: ['fp.fiscal_year = 2025'],
      },
    ]);
  });

  it('keeps BETWEEN … AND … as one condition', () => {
    const found = ineffectiveLeftJoinFilters(
      'SELECT s.id, COUNT(o.id) FROM shop.stores s LEFT JOIN shop.orders o ON o.store_id = s.id LEFT JOIN shop.days d ON d.id = o.day_id AND d.year BETWEEN 2024 AND 2025 GROUP BY s.id',
    );

    expect(found.map((f) => f.conditions)).toEqual([
      ['d.year BETWEEN 2024 AND 2025'],
    ]);
  });

  it('says nothing when the query reads the joined table', () => {
    // The filter keeps stores with no paid order, with an empty count.
    expect(
      ineffectiveLeftJoinFilters(
        "SELECT s.id, COUNT(o.id) FROM shop.stores s LEFT JOIN shop.orders o ON o.store_id = s.id AND o.status = 'PAID' GROUP BY s.id",
      ),
    ).toEqual([]);
  });

  it('counts a bare column the joined table owns as reading it', () => {
    const sql =
      'SELECT s.id, quarter, COUNT(o.id) FROM shop.stores s LEFT JOIN shop.orders o ON o.store_id = s.id LEFT JOIN shop.days d ON d.id = o.day_id AND d.year = 2025 GROUP BY s.id, quarter';

    expect(ineffectiveLeftJoinFilters(sql)).toHaveLength(1);
    expect(
      ineffectiveLeftJoinFilters(sql, (table) =>
        table === 'shop.days' ? ['id', 'year', 'quarter'] : [],
      ),
    ).toEqual([]);
  });

  it('says nothing beside a SELECT *, an OR at the top of ON, or a subquery', () => {
    expect(
      ineffectiveLeftJoinFilters(
        'SELECT * FROM shop.stores s LEFT JOIN shop.days d ON d.store_id = s.id AND d.year = 2025',
      ),
    ).toEqual([]);
    expect(
      ineffectiveLeftJoinFilters(
        'SELECT s.id FROM shop.stores s LEFT JOIN shop.days d ON d.store_id = s.id OR d.year = 2025',
      ),
    ).toEqual([]);
    expect(
      ineffectiveLeftJoinFilters(
        'SELECT s.id FROM shop.stores s LEFT JOIN (SELECT * FROM shop.days) d ON d.store_id = s.id AND d.year = 2025',
      ),
    ).toEqual([]);
  });

  it('says nothing for an ON clause with no join condition', () => {
    expect(
      ineffectiveLeftJoinFilters(
        'SELECT s.id FROM shop.stores s LEFT JOIN shop.days d ON d.year = 2025',
      ),
    ).toEqual([]);
  });

  it('reads LEFT( as a function, not as the next join', () => {
    const found = ineffectiveLeftJoinFilters(
      "SELECT s.id FROM shop.stores s LEFT JOIN shop.days d ON d.store_id = s.id AND LEFT(d.code, 2) = 'Q4' GROUP BY s.id",
    );

    expect(found.map((f) => f.conditions)).toEqual([
      ["LEFT(d.code, 2) = 'Q4'"],
    ]);
  });

  it('never throws on input it cannot read', () => {
    expect(ineffectiveLeftJoinFilters("SELECT 'unterminated")).toEqual([]);
    expect(ineffectiveLeftJoinFilters('LEFT JOIN')).toEqual([]);
  });
});
