import {
  analyzeSql,
  joinIsGrounded,
  locateVerbatim,
  resolveEntityKey,
  type GroundingEntity,
} from './sql-grounding';

const ref = (entity: string, column: string, source = 'declared') => ({
  entity,
  column,
  source,
});

/** The HR fixture's shape, as a Postgres dataset snapshot keys it. */
const HR: GroundingEntity[] = [
  {
    key: 'world_cup.hr.employees',
    columns: [
      { name: 'id' },
      { name: 'full_name' },
      {
        name: 'department_id',
        references: ref('world_cup.hr.departments', 'id'),
      },
      {
        name: 'location_id',
        references: ref('world_cup.hr.locations', 'id'),
      },
      { name: 'manager_id', references: ref('world_cup.hr.employees', 'id') },
      { name: 'employment_type' },
      { name: 'hired_on' },
      { name: 'terminated_on' },
    ],
  },
  {
    key: 'world_cup.hr.departments',
    columns: [{ name: 'id' }, { name: 'name' }, { name: 'division' }],
  },
  {
    key: 'world_cup.hr.locations',
    columns: [{ name: 'id' }, { name: 'city' }, { name: 'currency' }],
  },
  {
    key: 'world_cup.hr.salary_history',
    columns: [
      { name: 'id' },
      {
        name: 'employee_id',
        references: ref('world_cup.hr.employees', 'id'),
      },
      { name: 'effective_from' },
      { name: 'effective_to' },
      { name: 'annual_base_amount' },
      { name: 'currency' },
    ],
  },
  {
    key: 'world_cup.hr.exchange_rates',
    columns: [{ name: 'currency' }, { name: 'year' }, { name: 'rate_to_usd' }],
  },
];

const FOOTBALL: GroundingEntity[] = [
  {
    key: 'main.football.matches',
    columns: [
      { name: 'id' },
      { name: 'played_on' },
      {
        name: 'winner_team_id',
        references: ref('main.football.teams', 'id', 'inferred'),
      },
    ],
  },
  {
    key: 'main.football.teams',
    columns: [{ name: 'id' }, { name: 'name' }],
  },
];

const HEALTH: GroundingEntity[] = [
  {
    key: 'main.health.claims',
    columns: [
      { name: 'claim_id' },
      { name: 'status' },
      { name: 'plan_id', references: ref('main.health.plans', 'plan_id') },
    ],
  },
  {
    key: 'main.health.plans',
    columns: [{ name: 'plan_id' }, { name: 'plan_name' }],
  },
];

describe('analyzeSql', () => {
  it('reads a multi-join Postgres statement: entities, aliases, columns, joins', () => {
    const sql = `
      SELECT AVG(s.annual_base_amount * x.rate_to_usd) AS avg_salary_usd
      FROM world_cup.hr.salary_history s
      JOIN world_cup.hr.employees e ON e.id = s.employee_id
      JOIN world_cup.hr.departments d ON d.id = e.department_id
      JOIN world_cup.hr.exchange_rates AS x
        ON x.currency = s.currency AND x.year = 2025
      WHERE d.division = 'Technology'
        AND e.employment_type = 'employee'
        AND s.effective_from <= DATE '2025-12-31'
        AND (s.effective_to IS NULL OR s.effective_to > DATE '2025-12-31')
        AND e.salary_band = 'x'`;

    const grounding = analyzeSql(sql, HR);

    expect(grounding.entities).toEqual([
      'world_cup.hr.salary_history',
      'world_cup.hr.employees',
      'world_cup.hr.departments',
      'world_cup.hr.exchange_rates',
    ]);
    expect(grounding.unknownTables).toEqual([]);
    expect(grounding.joins).toEqual([
      {
        from: 'world_cup.hr.employees',
        fromColumn: 'id',
        to: 'world_cup.hr.salary_history',
        toColumn: 'employee_id',
        grounded: true,
      },
      {
        from: 'world_cup.hr.departments',
        fromColumn: 'id',
        to: 'world_cup.hr.employees',
        toColumn: 'department_id',
        grounded: true,
      },
      // Currency codes match by value, not by a declared relationship.
      {
        from: 'world_cup.hr.exchange_rates',
        fromColumn: 'currency',
        to: 'world_cup.hr.salary_history',
        toColumn: 'currency',
        grounded: false,
      },
    ]);
    // `e.salary_band` is not in the snapshot; everything else is.
    expect(grounding.columns.filter((c) => !c.exists)).toEqual([
      {
        entity: 'world_cup.hr.employees',
        column: 'salary_band',
        exists: false,
      },
    ]);
    expect(grounding.columns.filter((c) => c.exists)).toHaveLength(13);
    // In the order the statement mentions them.
    expect(grounding.columnsByEntity['world_cup.hr.departments']).toEqual([
      'id',
      'division',
    ]);
  });

  it('skips CTE names, EXTRACT(… FROM …) and CTE-qualified columns', () => {
    const sql = `
      WITH ranked AS (
        SELECT t.name AS team, COUNT(*) AS wins,
               RANK() OVER (ORDER BY COUNT(*) DESC) AS rnk
        FROM main.football.matches m
        JOIN main.football.teams t ON t.id = m.winner_team_id
        WHERE EXTRACT(YEAR FROM m.played_on) = 2022
        GROUP BY t.name
      ), top AS (SELECT * FROM ranked WHERE rnk = 1)
      SELECT r.team, r.wins FROM top r`;

    const grounding = analyzeSql(sql, FOOTBALL);

    expect(grounding.ctes).toEqual(['ranked', 'top']);
    expect(grounding.entities).toEqual([
      'main.football.matches',
      'main.football.teams',
    ]);
    // Neither `m.played_on` (inside EXTRACT) nor the CTEs count as tables.
    expect(grounding.unknownTables).toEqual([]);
    expect(grounding.joins).toEqual([
      expect.objectContaining({
        from: 'main.football.teams',
        to: 'main.football.matches',
        toColumn: 'winner_team_id',
        grounded: true,
      }),
    ]);
    // `r.team` points at a CTE — unverifiable, so not measured at all.
    expect(grounding.columns.map((c) => c.column).sort()).toEqual([
      'id',
      'name',
      'played_on',
      'winner_team_id',
    ]);
  });

  it('treats derived tables as unverifiable and resolves schema.table by suffix', () => {
    const sql = `
      SELECT d.name, sub.headcount
      FROM (
        SELECT e.department_id, COUNT(*) AS headcount
        FROM hr.employees e
        WHERE e.terminated_on IS NULL
        GROUP BY e.department_id
      ) sub
      JOIN hr.departments d ON d.id = sub.department_id
      WHERE d.id IN (SELECT department_id FROM hr.employees WHERE employment_type = 'employee')
        AND d.name IS DISTINCT FROM 'Legal'
      ORDER BY sub.headcount DESC`;

    const grounding = analyzeSql(sql, HR);

    expect(grounding.entities).toEqual([
      'world_cup.hr.employees',
      'world_cup.hr.departments',
    ]);
    expect(grounding.unknownTables).toEqual([]);
    expect(grounding.joins).toEqual([]);
    expect(grounding.unverifiableJoins).toBe(1);
  });

  it('reads backtick names, USING joins and tables outside the datasets', () => {
    const sql = `-- denied claims with their plan
      SELECT c.claim_id, p.plan_name
      FROM \`main\`.\`health\`.\`claims\` AS c
      LEFT JOIN main.health.plans p USING (plan_id)
      JOIN main.other.audit a ON a.claim_id = c.claim_id /* not bound */
      WHERE c.status = 'denied FROM x JOIN y ON q.a = r.b'`;

    const grounding = analyzeSql(sql, HEALTH);

    expect(grounding.entities).toEqual([
      'main.health.claims',
      'main.health.plans',
    ]);
    expect(grounding.unknownTables).toEqual(['main.other.audit']);
    expect(grounding.joins).toEqual([
      {
        from: 'main.health.claims',
        fromColumn: 'plan_id',
        to: 'main.health.plans',
        toColumn: 'plan_id',
        grounded: true,
      },
    ]);
    // The audit join cannot be checked; the string literal is ignored.
    expect(grounding.unverifiableJoins).toBe(1);
    expect(grounding.columnsByEntity['main.health.claims']).toEqual(
      expect.arrayContaining(['claim_id', 'plan_id', 'status']),
    );
  });

  it('ignores DISTINCT ON and counts a self-join through a declared key', () => {
    const sql = `
      SELECT DISTINCT ON (m.id) m.full_name, e.full_name AS report
      FROM world_cup.hr.employees e
      JOIN world_cup.hr.employees m ON m.id = e.manager_id`;

    const grounding = analyzeSql(sql, HR);

    expect(grounding.entities).toEqual(['world_cup.hr.employees']);
    expect(grounding.joins).toEqual([
      expect.objectContaining({
        fromColumn: 'id',
        toColumn: 'manager_id',
        grounded: true,
      }),
    ]);
  });

  it('never throws on garbage and returns an empty reading', () => {
    for (const input of [
      '',
      'not sql at all ((( FROM',
      'SELECT FROM JOIN ON = . , ))',
      "SELECT 'unterminated",
      undefined as unknown as string,
    ]) {
      expect(() => analyzeSql(input, HR)).not.toThrow();
    }
    expect(analyzeSql('select 1', HR)).toEqual(
      expect.objectContaining({ entities: [], joins: [], columns: [] }),
    );
  });
});

describe('resolveEntityKey', () => {
  const keys = HR.map((e) => e.key);

  it('matches the full key, a schema.table suffix or a bare table name', () => {
    expect(resolveEntityKey('world_cup.hr.employees', keys)).toBe(
      'world_cup.hr.employees',
    );
    expect(resolveEntityKey('HR.Employees', keys)).toBe(
      'world_cup.hr.employees',
    );
    expect(resolveEntityKey('"hr"."locations"', keys)).toBe(
      'world_cup.hr.locations',
    );
    expect(resolveEntityKey('departments', keys)).toBe(
      'world_cup.hr.departments',
    );
  });

  it('does not match a partial segment or an unknown table', () => {
    expect(resolveEntityKey('ployees', keys)).toBeUndefined();
    expect(resolveEntityKey('other.hr.employees', keys)).toBeUndefined();
    expect(resolveEntityKey('', keys)).toBeUndefined();
  });
});

describe('joinIsGrounded', () => {
  it('accepts a declared edge in either direction and rejects a guess', () => {
    const employees = { entity: 'world_cup.hr.employees', column: 'id' };
    const salary = {
      entity: 'world_cup.hr.salary_history',
      column: 'employee_id',
    };
    expect(joinIsGrounded(employees, salary, HR)).toBe(true);
    expect(joinIsGrounded(salary, employees, HR)).toBe(true);
    expect(
      joinIsGrounded(
        { entity: 'world_cup.hr.locations', column: 'currency' },
        { entity: 'world_cup.hr.salary_history', column: 'currency' },
        HR,
      ),
    ).toBe(false);
  });
});

describe('locateVerbatim', () => {
  const sql = `SELECT AVG(s.annual_base_amount)
FROM world_cup.hr.salary_history s
WHERE s.effective_from <= DATE '2025-12-31'
  AND (s.effective_to IS NULL
       OR s.effective_to > DATE '2025-12-31')`;

  it('returns the exact piece of the SQL despite case and whitespace differences', () => {
    expect(locateVerbatim(sql, 'and (s.effective_to is null or s.effective_to'))
      .toBe(`AND (s.effective_to IS NULL
       OR s.effective_to`);
    expect(locateVerbatim(sql, "s.effective_from<=DATE '2025-12-31'")).toBe(
      "s.effective_from <= DATE '2025-12-31'",
    );
  });

  it('returns undefined for a paraphrase', () => {
    expect(
      locateVerbatim(sql, 'WHERE effective on 31 December'),
    ).toBeUndefined();
    expect(locateVerbatim(sql, '   ')).toBeUndefined();
  });
});
