import type {
  DatasetColumnSnapshot,
  DatasetSnapshot,
} from '../../mastra/tool-services';
import {
  closestNames,
  nameSimilarity,
  precheckSql,
  predicateColumns,
  scanSql,
  tokenizeSql,
  type PrecheckContext,
} from './sql-precheck';

/* A health-insurance-like snapshot, shaped like `fixtures:register` saves it. */

const DB = 'questions_to_insights.health_insurance';

function entity(
  table: string,
  columns: (string | [string, string, string?])[],
): { key: string; columns: DatasetColumnSnapshot[] } {
  return {
    key: `${DB}.${table}`,
    columns: columns.map((column) => {
      if (typeof column === 'string') {
        return {
          name: column,
          type:
            column.endsWith('_cents') ||
            column.endsWith('_id') ||
            column === 'id'
              ? 'bigint'
              : 'text',
          nullable: false,
        };
      }
      const [name, type, ref] = column;
      return {
        name,
        type,
        nullable: false,
        ...(ref
          ? {
              references: {
                entity: `${DB}.${ref.split('.')[0]}`,
                column: ref.split('.')[1],
                source: 'declared' as const,
              },
            }
          : {}),
      };
    }),
  };
}

const ENTITIES = [
  entity('countries', [['code', 'character(3)'], 'name']),
  entity('states', [
    'id',
    ['country_code', 'character(3)', 'countries.code'],
    'code',
    'name',
  ]),
  entity('regions', [
    'id',
    ['state_id', 'bigint', 'states.id'],
    'code',
    'name',
  ]),
  entity('plans', ['id', 'plan_code', 'name', 'tier', 'monthly_premium_cents']),
  entity('members', [
    'id',
    'member_number',
    'full_name',
    ['date_of_birth', 'date'],
    'sex',
    ['plan_id', 'bigint', 'plans.id'],
    ['region_id', 'bigint', 'regions.id'],
    ['enrolled_on', 'date'],
    ['terminated_on', 'date'],
  ]),
  entity('providers', [
    'id',
    'npi',
    'name',
    'specialty',
    'network_status',
    ['credentialed_on', 'date'],
  ]),
  entity('claims', [
    'id',
    'claim_number',
    ['member_id', 'bigint', 'members.id'],
    ['provider_id', 'bigint', 'providers.id'],
    ['plan_id', 'bigint', 'plans.id'],
    'claim_type',
    'place_of_service',
    ['service_date', 'date'],
    ['received_on', 'date'],
    ['adjudicated_on', 'date'],
    'status',
    'currency',
    'billed_amount_cents',
    'allowed_amount_cents',
    'paid_amount_cents',
    'member_responsibility_cents',
    'preauth_code',
    ['is_test', 'boolean'],
  ]),
  entity('claim_lines', [
    'id',
    ['claim_id', 'bigint', 'claims.id'],
    ['line_number', 'integer'],
    'procedure_code',
    'procedure_description',
    ['units_billed', 'integer'],
    ['units_allowed', 'integer'],
    'line_billed_amount_cents',
  ]),
  entity('v_claim_financials', [
    'claim_id',
    'status',
    ['is_test', 'boolean'],
    'member_id',
    'provider_id',
    'region_name',
    'paid_amount_cents',
  ]),
];

const SNAPSHOTS: DatasetSnapshot[] = [
  {
    name: 'Health Insurance',
    datasourceId: 'pg',
    datasourceKind: 'postgres',
    tables: ENTITIES.map((e) => e.key),
    entities: ENTITIES,
  },
];

const CONTEXT: PrecheckContext = {
  defaultFilters: [
    {
      entity: `${DB}.claims`,
      title: 'Exclude test claims',
      predicate:
        'Unless the question explicitly asks about test data, exclude claims where is_test = true from every claims aggregate.',
    },
  ],
  metrics: [
    {
      entity: `${DB}.claims`,
      name: 'net_paid',
      label: 'Net paid',
      expression:
        "SUM(paid_amount_cents) FILTER (WHERE status='PAID') - SUM(paid_amount_cents) FILTER (WHERE status='REVERSED')",
    },
  ],
};

const NONE: PrecheckContext = { defaultFilters: [], metrics: [] };

/**
 * Correct queries the precheck must stay silent on. The first block is
 * copied verbatim from `evals/suites/health-insurance.json` `expectedSql`
 * (hand-verified against the fixture), the second is realistic model output
 * exercising CTEs, window functions, EXTRACT, INTERVAL, subqueries, UNION,
 * implicit aliases and quoting.
 */
const SUITE_CORPUS = [
  'SELECT provider.specialty, ROUND(SUM(claim.paid_amount_cents)::numeric / SUM(claim.billed_amount_cents), 4) AS paid_share_of_billed FROM health_insurance.claims claim JOIN health_insurance.providers provider ON provider.id = claim.provider_id WHERE claim.is_test = false GROUP BY provider.specialty ORDER BY paid_share_of_billed DESC, provider.specialty',
  "SELECT plan.tier, ROUND(SUM(claim.paid_amount_cents)::numeric / SUM(claim.allowed_amount_cents), 4) AS plan_share_of_allowed FROM health_insurance.claims claim JOIN health_insurance.plans plan ON plan.id = claim.plan_id WHERE claim.status = 'PAID' AND claim.is_test = false GROUP BY plan.tier ORDER BY plan_share_of_allowed DESC, plan.tier",
  'SELECT claim.currency, COUNT(*) AS claims FROM health_insurance.claims claim WHERE claim.is_test = false GROUP BY claim.currency ORDER BY claim.currency',
  'SELECT COUNT(*) AS claims_with_preauth FROM health_insurance.claims claim WHERE claim.preauth_code IS NOT NULL AND claim.is_test = false',
  'SELECT provider.specialty, COUNT(*) AS claims FROM health_insurance.claims claim JOIN health_insurance.providers provider ON provider.id = claim.provider_id WHERE claim.is_test = false GROUP BY provider.specialty HAVING COUNT(*) = 48 ORDER BY provider.specialty',
  "SELECT COUNT(*) AS approved_claims FROM health_insurance.claims claim WHERE claim.status = 'PAID' AND claim.is_test = false AND claim.service_date >= DATE '2024-01-01' AND claim.service_date < DATE '2025-01-01'",
  'SELECT member.full_name AS member, COUNT(*) AS claims FROM health_insurance.claims claim JOIN health_insurance.members member ON member.id = claim.member_id WHERE claim.is_test = false GROUP BY member.full_name ORDER BY claims DESC, member.full_name LIMIT 1',
  "SELECT region.name AS region, SUM(CASE WHEN claim.status = 'REVERSED' THEN -claim.paid_amount_cents ELSE claim.paid_amount_cents END) AS net_paid_cents FROM health_insurance.claims claim JOIN health_insurance.members member ON member.id = claim.member_id JOIN health_insurance.regions region ON region.id = member.region_id WHERE claim.is_test = false AND claim.service_date >= DATE '2024-01-01' AND claim.service_date < DATE '2025-01-01' GROUP BY region.name ORDER BY net_paid_cents DESC, region.name",
  "SELECT SUM(CASE WHEN claim.status = 'REVERSED' THEN -claim.paid_amount_cents ELSE claim.paid_amount_cents END) AS net_paid_cents FROM health_insurance.claims claim WHERE claim.is_test = false AND claim.service_date >= DATE '2024-01-01' AND claim.service_date < DATE '2025-01-01'",
  'SELECT country.name AS country, SUM(claim.paid_amount_cents) AS paid_cents FROM health_insurance.claims claim JOIN health_insurance.members member ON member.id = claim.member_id JOIN health_insurance.regions region ON region.id = member.region_id JOIN health_insurance.states state ON state.id = region.state_id JOIN health_insurance.countries country ON country.code = state.country_code WHERE claim.is_test = false GROUP BY country.name ORDER BY paid_cents DESC, country.name',
  'SELECT ROUND(AVG(claim.paid_amount_cents) / 100.0, 2) AS avg_paid_dollars FROM health_insurance.claims claim WHERE claim.is_test = false',
  'SELECT claim_line.procedure_code, SUM(claim_line.units_billed - claim_line.units_allowed) AS units_cut FROM health_insurance.claim_lines claim_line JOIN health_insurance.claims claim ON claim.id = claim_line.claim_id WHERE claim.is_test = false GROUP BY claim_line.procedure_code ORDER BY units_cut DESC, claim_line.procedure_code LIMIT 5',
  "SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE claim.status = 'DENIED') / COUNT(*), 2) AS denial_rate_pct FROM health_insurance.claims claim WHERE claim.status <> 'PENDING' AND claim.is_test = false",
  'SELECT region.name AS region, COUNT(*) AS active_members FROM health_insurance.members member JOIN health_insurance.regions region ON region.id = member.region_id WHERE member.terminated_on IS NULL GROUP BY region.name ORDER BY active_members DESC, region.name',
  'SELECT plan.tier, COUNT(*) AS members FROM health_insurance.members member JOIN health_insurance.plans plan ON plan.id = member.plan_id GROUP BY plan.tier ORDER BY members DESC, plan.tier',
  'SELECT provider.specialty, COUNT(*) AS providers FROM health_insurance.providers provider GROUP BY provider.specialty ORDER BY providers DESC, provider.specialty',
];

const MODEL_CORPUS = [
  // CTE + window function + EXTRACT + ::cast
  `WITH monthly AS (
     SELECT EXTRACT(YEAR FROM c.service_date)::int AS yr,
            EXTRACT(MONTH FROM c.service_date) AS mon,
            SUM(c.paid_amount_cents) / 100.0 AS paid
     FROM questions_to_insights.health_insurance.claims c
     WHERE NOT c.is_test AND c.status = 'PAID'
     GROUP BY 1, 2
   )
   SELECT yr, mon, paid,
          SUM(paid) OVER (PARTITION BY yr ORDER BY mon ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_paid,
          RANK() OVER w AS paid_rank
   FROM monthly
   WINDOW w AS (PARTITION BY yr ORDER BY paid DESC)
   ORDER BY yr, mon`,
  // Subquery in FROM, implicit aliases, INTERVAL, IS FALSE
  `SELECT sub.specialty, sub.claim_count
   FROM (
     SELECT p.specialty, COUNT(*) claim_count
     FROM health_insurance.claims c JOIN health_insurance.providers p ON c.provider_id = p.id
     WHERE c.is_test IS FALSE AND c.received_on >= CURRENT_DATE - INTERVAL '90 days'
     GROUP BY p.specialty
   ) sub
   WHERE sub.claim_count > 10
   ORDER BY sub.claim_count DESC`,
  // Correlated EXISTS, DATE_TRUNC, bare columns in a flat query
  `SELECT DATE_TRUNC('month', service_date) AS month_start, COUNT(*) AS claims
   FROM health_insurance.claims
   WHERE is_test = false AND status = 'DENIED'
   GROUP BY month_start ORDER BY month_start`,
  `SELECT m.full_name FROM health_insurance.members m
   WHERE EXISTS (SELECT 1 FROM health_insurance.claims c WHERE c.member_id = m.id AND c.is_test = false AND c.status = 'PAID')
   ORDER BY m.full_name LIMIT 20`,
  // UNION ALL of two scopes, quoted identifiers, a comment with SQL in it
  `SELECT 'in network' AS network, COUNT(*) AS "Claims" -- FROM nowhere JOIN nothing
   FROM health_insurance.claims c JOIN health_insurance.providers p ON p.id = c.provider_id
   WHERE p.network_status = 'IN_NETWORK' AND c.is_test = false
   UNION ALL
   SELECT 'out of network', COUNT(*) FROM health_insurance.claims c JOIN health_insurance.providers p ON p.id = c.provider_id
   WHERE p.network_status = 'OUT_OF_NETWORK' AND c.is_test = false`,
  // Governed metric spelled exactly as defined
  `SELECT SUM(c.paid_amount_cents) FILTER (WHERE c.status='PAID') - SUM(c.paid_amount_cents) FILTER (WHERE c.status='REVERSED') AS net_paid
   FROM health_insurance.claims c WHERE COALESCE(c.is_test, false) = false`,
  // View join on the <table>_id convention, CAST(... AS ...), percentile WITHIN GROUP
  `SELECT v.region_name, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(v.paid_amount_cents AS numeric)) AS median_paid
   FROM health_insurance.v_claim_financials v JOIN health_insurance.claims c ON c.id = v.claim_id
   WHERE c.is_test = false GROUP BY v.region_name`,
  // Comma join with WHERE predicate, IS DISTINCT FROM, SUBSTRING(... FROM ...)
  `SELECT SUBSTRING(cl.procedure_code FROM 1 FOR 3) AS code_family, COUNT(*) AS lines
   FROM health_insurance.claim_lines cl, health_insurance.claims c
   WHERE cl.claim_id = c.id AND c.is_test = false AND c.preauth_code IS DISTINCT FROM NULL
   GROUP BY 1`,
  // Recursive-looking CTE chain with a column list
  `WITH paid(member_id, total) AS (
     SELECT c.member_id, SUM(c.paid_amount_cents) FROM health_insurance.claims c WHERE c.is_test = false GROUP BY c.member_id
   ), ranked AS (
     SELECT paid.member_id, paid.total, DENSE_RANK() OVER (ORDER BY paid.total DESC) AS rnk FROM paid
   )
   SELECT m.full_name, r.total FROM ranked r JOIN health_insurance.members m ON m.id = r.member_id WHERE r.rnk <= 3`,
];

/** Dialect corners: Databricks backticks / QUALIFY / LATERAL VIEW, Postgres DISTINCT ON / generate_series / JSON / LATERAL. */
const DIALECT_CORPUS = [
  'SELECT `p`.`specialty`, count(*) AS n FROM `questions_to_insights`.`health_insurance`.`claims` AS `c` JOIN questions_to_insights.health_insurance.providers p ON p.id = c.provider_id WHERE NOT c.is_test GROUP BY ALL QUALIFY row_number() OVER (ORDER BY n DESC) <= 3',
  "SELECT c.id, kind FROM health_insurance.claims c LATERAL VIEW explode(split(c.claim_type, ',')) t AS kind WHERE c.is_test = false",
  'SELECT DISTINCT ON (c.member_id) c.member_id, c.service_date FROM health_insurance.claims c WHERE c.is_test = false ORDER BY c.member_id, c.service_date DESC',
  "SELECT d::date AS day, COUNT(c.id) AS claims FROM generate_series(DATE '2024-01-01', DATE '2024-01-31', INTERVAL '1 day') AS g(d) LEFT JOIN health_insurance.claims c ON c.service_date = g.d AND c.is_test = false GROUP BY 1 ORDER BY 1",
  "SELECT c.place_of_service::jsonb->>'code' AS code, COUNT(*) FROM health_insurance.claims c WHERE c.is_test = false GROUP BY 1",
  'SELECT status, COUNT(*) FILTER (WHERE paid_amount_cents > 0) AS paid_claims, COUNT(*) total FROM health_insurance.claims WHERE is_test = false GROUP BY status HAVING COUNT(*) > 10 ORDER BY total DESC',
  'SELECT m.full_name, x.n FROM health_insurance.members m JOIN LATERAL (SELECT COUNT(*) AS n FROM health_insurance.claims c WHERE c.member_id = m.id AND c.is_test = false) x ON true ORDER BY x.n DESC LIMIT 5',
  "SELECT CAST(service_date AS DATE) AS d, SUM(CAST(paid_amount_cents AS DOUBLE)) / 100 AS paid FROM health_insurance.claims WHERE is_test = false AND service_date BETWEEN '2024-01-01' AND '2024-12-31' GROUP BY 1",
  "SELECT date_trunc('quarter', service_date) AS q, status, COUNT(*) AS n FROM health_insurance.claims WHERE is_test IS NOT TRUE AND status NOT IN ('PENDING') AND service_date >= NOW() - INTERVAL 90 DAY GROUP BY 1, 2",
  "SELECT p.name AS provider FROM health_insurance.providers p WHERE p.id IN (SELECT c.provider_id FROM health_insurance.claims c WHERE c.is_test = false AND c.status = 'DENIED') ORDER BY 1",
  "(SELECT 'a' AS k, COUNT(*) AS n FROM health_insurance.claims WHERE is_test = false) UNION ALL (SELECT 'b', COUNT(*) FROM health_insurance.members)",
];

describe('tokenizeSql', () => {
  it('masks strings and comments', () => {
    const tokens = tokenizeSql(
      "SELECT 'FROM claims' AS label -- JOIN providers\n/* WHERE x */ FROM t",
    );
    expect(tokens.map((t) => `${t.kind}:${t.value}`)).toEqual([
      'keyword:select',
      'string:FROM claims',
      'keyword:as',
      'identifier:label',
      'keyword:from',
      'identifier:t',
    ]);
  });

  it('reads quoted and backticked identifiers, keeps literal case', () => {
    const tokens = tokenizeSql(
      'SELECT "Full Name", `status` FROM x WHERE s = \'PAID\' AND n = 1.0',
    );
    expect(tokens[1]).toMatchObject({
      kind: 'identifier',
      value: 'full name',
      quoted: true,
    });
    expect(tokens[3]).toMatchObject({
      kind: 'identifier',
      value: 'status',
      quoted: true,
    });
    expect(tokens.find((t) => t.kind === 'string')?.value).toBe('PAID');
    expect(tokens.find((t) => t.kind === 'number')?.value).toBe('1');
  });

  it('reads multi-character operators and escaped quotes', () => {
    const tokens = tokenizeSql("SELECT a::int, b <> 'it''s', c->>'k' FROM t");
    expect(
      tokens.filter((t) => t.kind === 'operator').map((t) => t.value),
    ).toEqual(['::', '<>', '->>']);
    expect(tokens.find((t) => t.kind === 'string')?.value).toBe("it's");
  });

  it('never throws on unterminated input', () => {
    expect(() => tokenizeSql("SELECT 'unterminated")).not.toThrow();
    expect(() => tokenizeSql('SELECT /* open')).not.toThrow();
    expect(() => tokenizeSql('SELECT "open')).not.toThrow();
    expect(tokenizeSql(undefined as unknown as string)).toEqual([]);
  });
});

describe('scanSql', () => {
  it('tells CTE names, table aliases and derived aliases apart', () => {
    const scan = scanSql(
      'WITH x AS (SELECT a FROM s.t1 q) SELECT * FROM x JOIN (SELECT 1 AS one) d ON true, s.t2 AS z',
    );
    expect([...scan.ctes]).toEqual(['x']);
    expect(scan.tables.map((t) => [t.parts.join('.'), t.alias])).toEqual([
      ['s.t1', 'q'],
      ['x', undefined],
      ['s.t2', 'z'],
    ]);
    expect([...scan.derivedAliases]).toEqual(['d']);
    expect(scan.hasDerivedFrom).toBe(true);
  });

  it('does not read FROM inside EXTRACT / SUBSTRING as a table', () => {
    const scan = scanSql(
      'SELECT EXTRACT(YEAR FROM c.d), SUBSTRING(c.s FROM 2) FROM a.claims c',
    );
    expect(scan.tables.map((t) => t.parts.join('.'))).toEqual(['a.claims']);
  });

  it('records output aliases, explicit and implicit', () => {
    const scan = scanSql('SELECT COUNT(*) n, SUM(x) AS total, y z FROM t');
    expect([...scan.outputAliases].sort()).toEqual(['n', 'total', 'z']);
  });
});

describe('name similarity', () => {
  it('ranks prefix and suffix matches above unrelated names', () => {
    expect(
      closestNames('amount', [
        'paid_amount_cents',
        'status',
        'billed_amount_cents',
        'allowed_amount_cents',
        'currency',
      ]),
    ).toEqual([
      'paid_amount_cents',
      'billed_amount_cents',
      'allowed_amount_cents',
    ]);
    expect(nameSimilarity('stauts', 'status')).toBeGreaterThan(0.6);
  });
});

describe('predicateColumns', () => {
  it('reads the columns out of a prose default filter', () => {
    const columns = ENTITIES.find((e) => e.key.endsWith('.claims'))!.columns;
    expect(
      predicateColumns(CONTEXT.defaultFilters[0].predicate, columns),
    ).toEqual(['is_test']);
    expect(predicateColumns(CONTEXT.defaultFilters[0].predicate)).toEqual([
      'is_test',
    ]);
    expect(predicateColumns('NOT is_control')).toEqual(['is_control']);
  });
});

describe('precheckSql — false-positive corpus', () => {
  it.each(SUITE_CORPUS.map((sql, i) => [i, sql]))(
    'suite expectedSql #%i raises nothing',
    (_i, sql) => {
      expect(precheckSql(sql as string, SNAPSHOTS, CONTEXT)).toEqual([]);
    },
  );

  it.each(DIALECT_CORPUS.map((sql, i) => [i, sql]))(
    'dialect query #%i raises nothing',
    (_i, sql) => {
      expect(precheckSql(sql as string, SNAPSHOTS, CONTEXT)).toEqual([]);
    },
  );

  it.each(MODEL_CORPUS.map((sql, i) => [i, sql]))(
    'model-style query #%i raises nothing',
    (_i, sql) => {
      expect(precheckSql(sql as string, SNAPSHOTS, CONTEXT)).toEqual([]);
    },
  );
});

describe('precheckSql — findings', () => {
  it('flags an unknown table and lists the tables in scope', () => {
    const [finding] = precheckSql(
      'SELECT COUNT(*) FROM health_insurance.claim c WHERE c.is_test = false',
      SNAPSHOTS,
      NONE,
    );
    expect(finding).toContain('health_insurance.claim is not a table');
    expect(finding).toContain(`${DB}.claims`);
    // The closest table is listed first.
    expect(finding.indexOf(`${DB}.claims`)).toBeLessThan(
      finding.indexOf(`${DB}.members`),
    );
  });

  it('never calls a CTE an unknown table', () => {
    expect(
      precheckSql(
        'WITH claim AS (SELECT 1 AS x) SELECT x FROM claim',
        SNAPSHOTS,
        NONE,
      ),
    ).toEqual([]);
  });

  it('flags an unknown qualified column with the three closest', () => {
    const findings = precheckSql(
      'SELECT SUM(c.amount) FROM health_insurance.claims c WHERE c.is_test = false',
      SNAPSHOTS,
      NONE,
    );
    expect(findings).toEqual([
      'health_insurance.claims has no column amount — closest: paid_amount_cents, billed_amount_cents, allowed_amount_cents.',
    ]);
  });

  it('flags an unknown bare column in a flat query', () => {
    const findings = precheckSql(
      "SELECT COUNT(*) FROM health_insurance.claims WHERE claim_status = 'PAID' AND is_test = false",
      SNAPSHOTS,
      NONE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(
      /^health_insurance\.claims has no column claim_status — closest: .*status/,
    );
  });

  it('leaves bare names alone once a CTE could define them', () => {
    expect(
      precheckSql(
        'WITH t AS (SELECT c.member_id, COUNT(*) AS n FROM health_insurance.claims c WHERE c.is_test = false GROUP BY 1) SELECT member_id, n, whatever FROM t',
        SNAPSHOTS,
        NONE,
      ),
    ).toEqual([]);
  });

  it('does not check columns through an alias bound to two tables', () => {
    expect(
      precheckSql(
        'SELECT x.nope FROM health_insurance.claims x WHERE x.is_test = false AND EXISTS (SELECT 1 FROM health_insurance.members x WHERE x.id = 1)',
        SNAPSHOTS,
        NONE,
      ),
    ).toEqual([]);
  });

  it('flags a join off the known key and names the right one', () => {
    const findings = precheckSql(
      'SELECT p.name, COUNT(*) FROM health_insurance.claims c JOIN health_insurance.providers p ON c.member_id = p.id WHERE c.is_test = false GROUP BY p.name',
      SNAPSHOTS,
      NONE,
    );
    expect(findings).toEqual([
      'The join c.member_id = p.id does not follow a known key between health_insurance.claims and health_insurance.providers — the known key is health_insurance.claims.provider_id = health_insurance.providers.id.',
    ]);
  });

  it('accepts same-named keys, declared edges and the <table>_id convention', () => {
    for (const sql of [
      'SELECT 1 FROM health_insurance.claims c JOIN health_insurance.members m ON c.plan_id = m.plan_id WHERE c.is_test = false',
      'SELECT 1 FROM health_insurance.states s JOIN health_insurance.countries k ON k.code = s.country_code',
      'SELECT 1 FROM health_insurance.v_claim_financials v JOIN health_insurance.providers p ON p.id = v.provider_id',
    ]) {
      expect(precheckSql(sql, SNAPSHOTS, NONE)).toEqual([]);
    }
  });

  it('flags SELECT * on a wide table only', () => {
    expect(
      precheckSql(
        'SELECT * FROM health_insurance.claims WHERE is_test = false LIMIT 5',
        SNAPSHOTS,
        NONE,
      ),
    ).toEqual([
      'Selecting every column of health_insurance.claims (18 columns) — name only the columns the question needs.',
    ]);
    expect(
      precheckSql(
        'SELECT c.* FROM health_insurance.claims c WHERE c.is_test = false',
        SNAPSHOTS,
        NONE,
      ),
    ).toHaveLength(1);
    expect(
      precheckSql('SELECT * FROM health_insurance.providers', SNAPSHOTS, NONE),
    ).toEqual([]);
    expect(
      precheckSql(
        'SELECT COUNT(*) FROM health_insurance.claims WHERE is_test = false',
        SNAPSHOTS,
        NONE,
      ),
    ).toEqual([]);
    expect(
      precheckSql(
        'WITH t AS (SELECT c.id FROM health_insurance.claims c WHERE c.is_test = false) SELECT * FROM t',
        SNAPSHOTS,
        NONE,
      ),
    ).toEqual([]);
  });

  it('flags a missing default filter and accepts every spelling of it', () => {
    const [finding] = precheckSql(
      "SELECT COUNT(*) FROM health_insurance.claims c WHERE c.status = 'PAID'",
      SNAPSHOTS,
      CONTEXT,
    );
    expect(finding).toContain('default filter "Exclude test claims"');
    expect(finding).toContain('never uses is_test');
    for (const predicate of [
      'c.is_test = false',
      'NOT c.is_test',
      'c.is_test IS FALSE',
      'c.is_test IS NOT TRUE',
      'COALESCE(c.is_test, false) = false',
    ]) {
      expect(
        precheckSql(
          `SELECT COUNT(*) FROM health_insurance.claims c WHERE ${predicate}`,
          SNAPSHOTS,
          CONTEXT,
        ),
      ).toEqual([]);
    }
  });

  it('does not ask for a default filter on an entity the query never reads', () => {
    expect(
      precheckSql(
        'SELECT COUNT(*) FROM health_insurance.members',
        SNAPSHOTS,
        CONTEXT,
      ),
    ).toEqual([]);
  });

  it('flags an aggregate that engages with a governed Metric but misses its shape', () => {
    // The H9 trap: reversals summed instead of subtracted.
    const findings = precheckSql(
      "SELECT SUM(c.paid_amount_cents) AS net_paid FROM health_insurance.claims c WHERE c.status IN ('PAID', 'REVERSED') AND c.is_test = false",
      SNAPSHOTS,
      CONTEXT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('governed Metric net_paid (Net paid)');
    expect(findings[0]).toContain("FILTER (WHERE status='REVERSED')");
  });

  it('stays silent on gross-paid aggregates that do not engage with the Metric', () => {
    expect(
      precheckSql(
        "SELECT SUM(c.paid_amount_cents) AS paid FROM health_insurance.claims c WHERE c.status = 'PAID' AND c.is_test = false",
        SNAPSHOTS,
        CONTEXT,
      ),
    ).toEqual([]);
  });

  it('reads a threshold-filtered Metric (G9 allele fraction) the same way', () => {
    const calls = {
      key: 'db.genomics.variant_calls',
      columns: [
        'id',
        'sample_id',
        'variant_id',
        'genotype',
        'alt_read_count',
        'total_read_count',
        'filter_status',
      ].map((name) => ({
        name,
        type: name.endsWith('_count') ? 'integer' : 'text',
        nullable: false,
      })),
    };
    const genomics: DatasetSnapshot[] = [
      { name: 'Genomics', tables: [calls.key], entities: [calls] },
    ];
    const context: PrecheckContext = {
      defaultFilters: [],
      metrics: [
        {
          entity: calls.key,
          name: 'allele_fraction',
          label: 'Allele fraction',
          expression:
            "AVG(alt_read_count::numeric / NULLIF(total_read_count, 0)) FILTER (WHERE filter_status = 'PASS' AND total_read_count >= 20)",
        },
      ],
    };
    // Suite expectedSql shape (mean-allele-fraction): WHERE instead of FILTER — equivalent.
    expect(
      precheckSql(
        "SELECT ROUND(AVG(call.alt_read_count::numeric / call.total_read_count), 4) AS mean_allele_fraction FROM genomics.variant_calls call WHERE call.filter_status = 'PASS' AND call.total_read_count >= 20",
        genomics,
        context,
      ),
    ).toEqual([]);
    // The trap: the fraction without its quality filter.
    const [finding] = precheckSql(
      'SELECT AVG(call.alt_read_count::numeric / call.total_read_count) AS allele_fraction FROM genomics.variant_calls call',
      genomics,
      context,
    );
    expect(finding).toContain('governed Metric allele_fraction');
  });

  it('never throws on garbage and ignores empty scope', () => {
    expect(() =>
      precheckSql('SELECT ((( FROM', SNAPSHOTS, CONTEXT),
    ).not.toThrow();
    expect(precheckSql('SELECT x FROM nowhere', [], CONTEXT)).toEqual([]);
    expect(precheckSql('', SNAPSHOTS, CONTEXT)).toEqual([]);
    expect(
      precheckSql(
        'SELECT 1',
        SNAPSHOTS,
        undefined as unknown as PrecheckContext,
      ),
    ).toEqual([]);
  });
});
