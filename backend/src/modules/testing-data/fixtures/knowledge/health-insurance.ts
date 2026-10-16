/**
 * Knowledge seed of the Health Insurance sample (schema `health_insurance`,
 * seed `004_health_insurance.sql`), testing-data R26.
 *
 * Ported from `feat/engine-eval-loop` (`backend/scripts/fixture-semantics.ts`,
 * written 2026-09-23). Every non-obvious fact was checked again on 2026-10-16
 * against the seed loaded into its own database (`health_insurance` on an
 * isolated PostgreSQL server, `psql`); the query and its result sit in a
 * `Verified:` comment next to the fact. Rules from types.ts.
 *
 * Nothing here settles the "most expensive member/provider" or "best
 * provider" ambiguity the question bank asks the assistant to notice, and no
 * entry names a diagnosis or a length of stay (out-of-scope questions).
 */
import type { KnowledgeSeed } from './types';

export const HEALTH_INSURANCE_KNOWLEDGE: KnowledgeSeed = {
  knowledge: [
    {
      kind: 'term',
      title: 'Claim status vocabulary',
      // Verified: `SELECT status, count(*) FROM health_insurance.claims GROUP
      // BY 1` → DENIED 207, PAID 812, PENDING 130, REVERSED 51 (1200). CHECK
      // (status IN ('PAID','DENIED','PENDING','REVERSED')) and CHECK ((status =
      // 'PENDING') = (adjudicated_on IS NULL)); `SELECT status, min(paid_amount_
      // cents) FROM health_insurance.claims GROUP BY 1` → REVERSED min 5339
      // (every reversed claim carries a positive paid amount).
      body:
        "claims.status is one of PAID, DENIED, PENDING, REVERSED. 'approved' " +
        "or 'paid out' means status = PAID. REVERSED rows carry a POSITIVE " +
        'paid_amount_cents that must be SUBTRACTED, not summed, when ' +
        'reporting money actually paid out — see the net_paid metric. ' +
        'PENDING claims have not been adjudicated (adjudicated_on is null by ' +
        'CHECK constraint) and should be excluded from any rate or amount ' +
        'that describes a decision, not silently counted as either outcome.',
      synonyms: ['approved', 'paid out', 'denied', 'pending', 'reversed'],
      entities: ['health_insurance.claims'],
    },
    {
      kind: 'term',
      title: 'Amounts are stored in cents',
      // Verified: `SELECT table_name, column_name, data_type FROM
      // information_schema.columns WHERE table_schema = 'health_insurance' AND
      // column_name LIKE '%cents'` → all eight base-table columns named below
      // are bigint (the v_member_claim_totals sums are numeric cents).
      body:
        'billed_amount_cents, allowed_amount_cents, paid_amount_cents and ' +
        'member_responsibility_cents on claims, line_billed_amount_cents and ' +
        'line_allowed_amount_cents on claim_lines, and ' +
        'monthly_premium_cents/annual_deductible_cents on plans are all ' +
        'integer cents, not dollars — divide by 100 to report a dollar ' +
        'figure.',
      synonyms: ['cents', 'dollars'],
      entities: [
        'health_insurance.claims',
        'health_insurance.claim_lines',
        'health_insurance.plans',
      ],
    },
    {
      kind: 'default_filter',
      title: 'Exclude test claims',
      // Verified: `SELECT count(*) FILTER (WHERE is_test), count(*) FROM
      // health_insurance.claims` → 36 of 1200 (3.0%).
      body:
        'Unless the question explicitly asks about test data, exclude claims ' +
        'where is_test = true from every claims aggregate — is_test flags ' +
        'synthetic end-to-end test traffic mixed into the claim volume on ' +
        'purpose (about 3% of rows).',
      entities: ['health_insurance.claims'],
    },
    {
      kind: 'term',
      title: 'Currency is always USD',
      // Verified: `SELECT DISTINCT currency FROM health_insurance.claims` →
      // USD; CHECK (currency = 'USD').
      body:
        "claims.currency is always 'USD' (CHECK constraint) — do not group " +
        'or filter by it; it carries no information and every amount is ' +
        'already in one currency.',
      entities: ['health_insurance.claims'],
    },
    {
      kind: 'term',
      title: 'Prior authorization is rare, not a compliance signal',
      // Verified: `SELECT count(*) FILTER (WHERE preauth_code IS NOT NULL),
      // count(*) FROM health_insurance.claims` → 60 of 1200 (5.0%) non-null.
      body:
        'claims.preauth_code is null on the large majority of claims (about ' +
        '95%) — most services in this plan do not require prior ' +
        'authorization. Counting non-null preauth_code values measures how ' +
        'many claims happened to need authorization, not authorization ' +
        'compliance, and grouping by preauth_code puts almost every claim in ' +
        'one null bucket.',
      entities: ['health_insurance.claims'],
    },
    {
      kind: 'instruction',
      title: 'Join claims to member location',
      // Verified: `SELECT obj_description('health_insurance.v_claim_financials'
      // ::regclass)` → "One row per claim. region/state/country are the MEMBER
      // location."; `pg_get_viewdef` joins claim → members (member_id) →
      // regions (members.region_id) → states (regions.state_id) → countries
      // (states.country_code = countries.code). providers has no location
      // column.
      body:
        'To break claims down by region, state, or country, join claims → ' +
        'members (claims.member_id = members.id) → regions ' +
        '(members.region_id = regions.id) → states (regions.state_id = ' +
        'states.id) → countries (states.country_code = countries.code). This ' +
        'is the MEMBER location, not the provider location — v_claim_financials ' +
        'already performs this join.',
      entities: [
        'health_insurance.claims',
        'health_insurance.members',
        'health_insurance.regions',
        'health_insurance.states',
        'health_insurance.countries',
      ],
    },
    {
      kind: 'instruction',
      title: 'Claims reference members and providers by id',
      // Verified: information_schema.columns — claims has member_id and
      // provider_id and no name column; members.full_name and providers.name
      // exist.
      body:
        'claims carries member_id and provider_id, not names. Report a ' +
        'member or provider by NAME by joining to members.full_name or ' +
        'providers.name — do not surface the numeric id as the answer.',
      entities: [
        'health_insurance.claims',
        'health_insurance.members',
        'health_insurance.providers',
      ],
    },
    {
      kind: 'term',
      title: 'Coverage: 2024 and 2025 claims only',
      // Verified: `SELECT min(service_date), max(service_date) FROM
      // health_insurance.claims` → 2024-01-01 .. 2025-12-31; CHECK
      // (service_date BETWEEN '2024-01-01' AND '2025-12-31').
      body:
        'claims.service_date only covers 2024-01-01 through 2025-12-31 ' +
        '(CHECK constraint) — there is no earlier or later claims data in ' +
        'this dataset.',
      entities: ['health_insurance.claims'],
    },
    {
      kind: 'term',
      title: 'Units billed vs. units allowed on claim lines',
      // Verified: CHECK (units_allowed <= units_billed) on claim_lines;
      // `SELECT count(*) FILTER (WHERE units_allowed < units_billed), count(*)
      // FROM health_insurance.claim_lines` → 1006 of 2602 lines lost units.
      // Rewritten 2026-10-16: the branch's body quoted the wording of a
      // question in the bank ("units cut on review"), which R27 rules out.
      body:
        'claim_lines.units_billed is what the provider submitted; ' +
        'units_allowed is what was approved on review, and is always less ' +
        'than or equal to units_billed (CHECK constraint). The units a review ' +
        'took off a line are units_billed - units_allowed, a difference — ' +
        'not a ratio of a column to itself.',
      entities: ['health_insurance.claim_lines'],
    },
  ],
  metrics: [
    {
      // Verified: `SELECT <expression> FROM health_insurance.claims WHERE NOT
      // is_test` → 56033136.
      name: 'net_paid',
      label: 'Net paid',
      description:
        'Gross paid minus reversed claims. REVERSED rows carry a positive ' +
        'paid_amount_cents that must be subtracted, not summed.',
      entity: 'health_insurance.claims',
      expression:
        "SUM(paid_amount_cents) FILTER (WHERE status='PAID') - SUM(paid_amount_cents) FILTER (WHERE status='REVERSED')",
    },
    {
      // Verified: `SELECT <expression> FROM health_insurance.claims WHERE NOT
      // is_test` → 19.83. The denominator is adjudicated (non-PENDING)
      // claims, written with FILTER so the metric is self-contained.
      name: 'denial_rate',
      label: 'Denial rate',
      description:
        'Share of adjudicated (non-pending) claims that were denied, as a ' +
        'percentage. Pending claims (not yet decided) belong in neither the ' +
        'numerator nor the denominator. Combine with the "Exclude test ' +
        'claims" filter for a reported rate.',
      entity: 'health_insurance.claims',
      expression:
        "ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'DENIED') / NULLIF(COUNT(*) FILTER (WHERE status <> 'PENDING'), 0), 2)",
    },
    {
      // Verified: `SELECT <expression> FROM health_insurance.claims WHERE NOT
      // is_test` → 0.2651.
      name: 'paid_share_of_billed',
      label: 'Paid share of billed',
      description:
        'Share of the billed amount actually paid out, as a fraction of 1 ' +
        '(multiply by 100 for a percentage). Combine with the "Exclude test ' +
        'claims" filter for a reported rate.',
      entity: 'health_insurance.claims',
      expression:
        'SUM(paid_amount_cents) * 1.0 / NULLIF(SUM(billed_amount_cents), 0)',
    },
  ],
};
