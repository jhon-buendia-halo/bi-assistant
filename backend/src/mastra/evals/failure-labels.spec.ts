import { labelFailure, type FailureLabelInput } from './failure-labels';

/** The health_insurance fixture's entities, as a dataset scope lists them. */
const KNOWN = [
  'health_insurance.countries',
  'health_insurance.states',
  'health_insurance.regions',
  'health_insurance.plans',
  'health_insurance.members',
  'health_insurance.providers',
  'health_insurance.claims',
  'health_insurance.claim_lines',
  'health_insurance.v_claim_financials',
];

const DEFAULT_FILTERS = ['claims.is_test = false'];

function input(over: Partial<FailureLabelInput>): FailureLabelInput {
  return {
    verdict: 'FAIL',
    checks: [{ id: 'result-set-match', passed: false }],
    clarified: false,
    toolErrors: [],
    textChecksFailed: false,
    resultMatched: false,
    defaultFilterPredicates: DEFAULT_FILTERS,
    knownEntities: KNOWN,
    ...over,
  };
}

describe('labelFailure', () => {
  it('timeout — an ERROR that ran out of time', () => {
    expect(
      labelFailure(
        input({ verdict: 'ERROR', error: 'Turn timed out after 300000 ms' }),
      ),
    ).toBe('timeout');
    expect(
      labelFailure(
        input({ verdict: 'ERROR', error: 'The operation was aborted' }),
      ),
    ).toBe('timeout');
  });

  it('tool-error — an ERROR where tools failed, or every query failed', () => {
    expect(
      labelFailure(
        input({
          verdict: 'ERROR',
          error: 'boom',
          toolErrors: ['relation does not exist'],
        }),
      ),
    ).toBe('tool-error');
    expect(
      labelFailure(
        input({
          expectedSql:
            'SELECT COUNT(*) FROM health_insurance.claims claim WHERE claim.is_test = false',
          toolErrors: ['column claim.test does not exist'],
        }),
      ),
    ).toBe('tool-error');
  });

  it('no-sql — a figure was expected and no query ran', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            'SELECT COUNT(*) FROM health_insurance.claims claim WHERE claim.is_test = false',
        }),
      ),
    ).toBe('no-sql');
  });

  it('clarified — it asked a question where a figure was expected', () => {
    expect(
      labelFailure(
        input({
          clarified: true,
          expectedSql:
            'SELECT COUNT(*) FROM health_insurance.claims claim WHERE claim.is_test = false',
        }),
      ),
    ).toBe('clarified');
  });

  it('missing-default-filter — test claims leaked into a volume', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            "SELECT COUNT(*) AS claims FROM health_insurance.claims claim WHERE claim.is_test = false AND claim.service_date >= DATE '2024-03-01' AND claim.service_date < DATE '2024-04-01'",
          finalSql:
            "SELECT COUNT(*) FROM health_insurance.claims WHERE service_date >= '2024-03-01' AND service_date < '2024-04-01'",
        }),
      ),
    ).toBe('missing-default-filter');
  });

  it('accepts the default filter however it is written', () => {
    // `NOT is_test` applies the filter: not a missing-default-filter failure.
    expect(
      labelFailure(
        input({
          expectedSql:
            "SELECT COUNT(*) AS claims FROM health_insurance.claims claim WHERE claim.is_test = false AND claim.status = 'PAID'",
          finalSql:
            "SELECT COUNT(*) FROM health_insurance.claims c WHERE NOT c.is_test AND c.status = 'APPROVED'",
        }),
      ),
    ).toBe('wrong-filter');
  });

  it('id-not-name — reports member_id where the reference names the member', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            'SELECT member.full_name AS member, COUNT(*) AS claims FROM health_insurance.claims claim JOIN health_insurance.members member ON member.id = claim.member_id WHERE claim.is_test = false GROUP BY member.full_name ORDER BY claims DESC, member.full_name LIMIT 1',
          finalSql:
            'SELECT claim.member_id, COUNT(*) AS claims FROM health_insurance.claims claim WHERE claim.is_test = false GROUP BY claim.member_id ORDER BY claims DESC LIMIT 1',
        }),
      ),
    ).toBe('id-not-name');
  });

  it('unit — cents reported as dollars', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            'SELECT ROUND(AVG(claim.paid_amount_cents) / 100.0, 2) AS avg_paid_dollars FROM health_insurance.claims claim WHERE claim.is_test = false',
          finalSql:
            'SELECT ROUND(AVG(paid_amount_cents), 2) AS avg_paid FROM health_insurance.claims WHERE is_test = false',
        }),
      ),
    ).toBe('unit');
  });

  it('wrong-table — reads a table the reference does not', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            'SELECT provider.specialty, COUNT(*) AS providers FROM health_insurance.providers provider GROUP BY provider.specialty',
          finalSql:
            'SELECT p.specialty, COUNT(*) FROM health_insurance.claims c JOIN health_insurance.providers p ON p.id = c.provider_id GROUP BY p.specialty',
        }),
      ),
    ).toBe('wrong-table');
  });

  it('missing-join — stops short of the grain the question asked for', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            'SELECT country.name AS country, SUM(claim.paid_amount_cents) AS paid_cents FROM health_insurance.claims claim JOIN health_insurance.members member ON member.id = claim.member_id JOIN health_insurance.regions region ON region.id = member.region_id JOIN health_insurance.states state ON state.id = region.state_id JOIN health_insurance.countries country ON country.code = state.country_code WHERE claim.is_test = false GROUP BY country.name',
          finalSql:
            'SELECT region.name, SUM(claim.paid_amount_cents) FROM health_insurance.claims claim JOIN health_insurance.members member ON member.id = claim.member_id JOIN health_insurance.regions region ON region.id = member.region_id WHERE claim.is_test = false GROUP BY region.name',
        }),
      ),
    ).toBe('missing-join');
  });

  it('wrong-aggregate — COUNT(DISTINCT …) where the reference counts rows', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            'SELECT plan.tier, COUNT(*) AS members FROM health_insurance.members member JOIN health_insurance.plans plan ON plan.id = member.plan_id GROUP BY plan.tier',
          finalSql:
            'SELECT plan.tier, COUNT(DISTINCT member.id) AS members FROM health_insurance.members member JOIN health_insurance.plans plan ON plan.id = member.plan_id GROUP BY plan.tier',
        }),
      ),
    ).toBe('wrong-aggregate');
  });

  it('wrong-filter — reversals filtered out instead of subtracted', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            "SELECT SUM(CASE WHEN claim.status = 'REVERSED' THEN -claim.paid_amount_cents ELSE claim.paid_amount_cents END) AS net_paid_cents FROM health_insurance.claims claim WHERE claim.is_test = false AND claim.service_date >= DATE '2024-01-01' AND claim.service_date < DATE '2025-01-01'",
          finalSql:
            "SELECT SUM(claim.paid_amount_cents) FROM health_insurance.claims claim WHERE claim.is_test = false AND claim.status <> 'REVERSED' AND claim.service_date >= DATE '2024-01-01' AND claim.service_date < DATE '2025-01-01'",
        }),
      ),
    ).toBe('wrong-filter');
  });

  it('format-only — the data was right, the prose failed a text check', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            'SELECT COUNT(*) FROM health_insurance.claims claim WHERE claim.is_test = false',
          finalSql:
            'SELECT COUNT(*) FROM health_insurance.claims WHERE is_test = false',
          resultMatched: true,
          textChecksFailed: true,
          checks: [
            { id: 'result-set-match', passed: true },
            { id: 'check-includes', passed: false },
          ],
        }),
      ),
    ).toBe('format-only');
  });

  it('judge — only the rubric said no', () => {
    expect(
      labelFailure(
        input({
          finalSql: 'SELECT DISTINCT currency FROM health_insurance.claims',
          resultMatched: undefined,
          checks: [
            { id: 'check-called-tool', passed: true },
            {
              id: 'llm-judge',
              passed: false,
              reason: 'did not say every claim is USD',
            },
          ],
        }),
      ),
    ).toBe('judge');
    // Also when the result matched and nothing but the judge failed.
    expect(
      labelFailure(
        input({
          expectedSql: 'SELECT 1',
          finalSql: 'SELECT 1',
          resultMatched: true,
          checks: [{ id: 'llm-judge', passed: false }],
        }),
      ),
    ).toBe('judge');
  });

  it('unknown — nothing recognisable differs', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            'SELECT provider.specialty, COUNT(*) AS providers FROM health_insurance.providers provider GROUP BY provider.specialty',
          finalSql:
            'SELECT p.specialty, COUNT(*) AS n FROM health_insurance.providers p GROUP BY p.specialty',
        }),
      ),
    ).toBe('unknown');
    // A discovery case (no SQL expected) that failed a text check.
    expect(
      labelFailure(
        input({
          checks: [{ id: 'check-matches', passed: false }],
          textChecksFailed: true,
        }),
      ),
    ).toBe('unknown');
  });

  it('labels only failures: PASS, GAP and SKIP are not diagnosed', () => {
    for (const verdict of ['PASS', 'GAP', 'SKIP'] as const) {
      expect(labelFailure(input({ verdict }))).toBe('unknown');
    }
  });

  it('is not fooled by keywords inside strings, EXTRACT(… FROM …) or CTE names', () => {
    expect(
      labelFailure(
        input({
          expectedSql:
            "SELECT COUNT(*) FROM health_insurance.claims claim WHERE claim.is_test = false AND claim.status = 'PAID' AND EXTRACT(YEAR FROM claim.service_date) = 2024",
          finalSql:
            "WITH paid AS (SELECT * FROM health_insurance.claims WHERE is_test = false AND status = 'PAID' AND EXTRACT(YEAR FROM service_date) = 2023) SELECT COUNT(*) FROM paid",
        }),
      ),
    ).toBe('wrong-filter');
  });
});
