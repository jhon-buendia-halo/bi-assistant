/**
 * Business-semantics document, per eval fixture (`world_cup`, `health_insurance`,
 * `genomics`) — the L2 lever from `docs/plans/improvement-loop-engineering.md`
 * §5 ("A business-semantics document per fixture ... the largest measured
 * lever in 2026 studies"). Pure data: no NestJS, no Nest DI, no CLI — so it is
 * importable both by `bootstrap-fixtures.ts` (seeds it into the app's
 * knowledge/metrics stores) and by `load-fixtures-databricks.ts`, and is
 * unit-tested directly by `../src/mastra/evals/fixture-semantics.spec.ts`
 * without booting a Nest application context.
 *
 * **Overfitting guard (mandatory — see the engineering plan's L2 section and
 * this unit's brief).** Every snippet below states a rule about the DATA —
 * a column's vocabulary, a join path, a coverage boundary, a unit, a default
 * filter — never a hint about how to answer a specific eval question, and
 * none names or paraphrases the expected answer of any case in
 * `src/mastra/evals/suites/*.json`. `fixture-semantics.spec.ts` checks this
 * mechanically (no snippet body contains a case id or copies a case's
 * `question` text verbatim); the semantic check ("does this paraphrase an
 * *answer*?") was done by hand while writing these, case by case, against
 * the three suite files as they stood on 2026-09-23. A dataset rule that
 * also happens to help a case answer correctly is fine and expected — that
 * is the whole point of a semantics document — the line is a rule about the
 * data vs. a hint about a question.
 *
 * One class is never allowed, even phrased as a rule: a snippet that resolves
 * an ambiguity a `clarification` or `out-of-scope` case asks the assistant to
 * *notice* ("'most expensive' has no single definition — ask"). Those cases
 * measure whether the assistant spots the ambiguity unaided; a snippet that
 * spots it for them turns the case into a reading test. Two such snippets
 * were drafted and removed on 2026-09-23.
 *
 * **Verification.** Every non-obvious fact below (row counts, percentages,
 * enum values, the own-goal encoding, the shoot-out encoding, coverage
 * years) was checked against the live fixture — Docker Postgres at
 * `localhost:55432`, db `world_cup`, user `world_cup`, password
 * `world_cup_dev` — on 2026-09-23, via `psql`/`node -e` with the `pg`
 * package already in `backend/node_modules`. The exact query is recorded in
 * a comment next to the fact it verifies, so a future regeneration of a
 * fixture can be checked the same way (`docker/postgres/README.md` §
 * "Regenerating a fixture" already requires re-running `eval:validate`;
 * re-running these queries is the equivalent check for this file).
 *
 * `entities` on every knowledge snippet and every metric are **two-segment**
 * `schema.table` names — the dataset key's *last two* segments — never the
 * catalog-qualified `catalog.schema.table` form the app's knowledge/metrics
 * services store. `bootstrap-fixtures.ts` prefixes the Postgres database
 * name (the catalog segment, always `world_cup` — one Postgres database,
 * three schemas) before calling `KnowledgeService.create` /
 * `MetricsService.create`, exactly as the pre-U2-D version of that script
 * already did for its four hand-written entries. Keeping this file
 * catalog-agnostic is also what lets `load-fixtures-databricks.ts` reuse the
 * same two-segment names under a different catalog (the `--catalog` the
 * operator names for the Databricks load) without editing this file.
 *
 * `column` is only ever set on a snippet whose `entities` has exactly one
 * member — `KnowledgeService`'s `validateCreate`/`validateUpdate` reject a
 * `column` on a multi-entity snippet (`requireSingleEntity`,
 * `knowledge.service.ts`), so every single-column snippet below is scoped to
 * one table on purpose, not by omission.
 */

import { SUPPLY_CHAIN } from './semantics/supply-chain';
import { BANKING } from './semantics/banking';

export type SemanticKnowledgeKind = 'term' | 'instruction' | 'default_filter';

export interface SemanticKnowledgeSnippet {
  kind: SemanticKnowledgeKind;
  /** Idempotency key for `bootstrap-fixtures.ts` (unique per fixture). */
  title: string;
  body: string;
  synonyms?: string[];
  /** `schema.table` — see the module doc for why this is two segments, not three. */
  entities: string[];
  /** Only valid when `entities` has exactly one member. */
  column?: string;
}

export interface SemanticMetric {
  /** Slug handle, e.g. `denial_rate` — must match `MetricsService`'s `NAME_PATTERN`. */
  name: string;
  label: string;
  description: string;
  /** `schema.table` — see the module doc. */
  entity: string;
  /** Single SQL aggregation expression — no semicolons (`MetricsService.validate`). */
  expression: string;
  dimensions?: string[];
}

export interface FixtureSemantics {
  /** Matches `FixtureDataset.name` in `bootstrap-fixtures.ts` (the saved dataset name). */
  datasetName: string;
  /** Matches `FixtureDataset.schema` in `bootstrap-fixtures.ts` (the Postgres schema). */
  schema: string;
  /** One paragraph: what questions this dataset answers, table grain, coverage years. */
  description: string;
  knowledge: SemanticKnowledgeSnippet[];
  metrics: SemanticMetric[];
}

// =============================================================================
// World Cup (schema `world_cup`) — hand-written, real 2018/2022 results.
// =============================================================================

const WORLD_CUP: FixtureSemantics = {
  datasetName: 'World Cup',
  schema: 'world_cup',
  description:
    'World Cup (schema world_cup): match-by-match results and statistics for ' +
    'the 2018 and 2022 FIFA World Cups only — no other tournament year is ' +
    'present, and only the quarter-finals through the final are included ' +
    '(no group-stage or round-of-16 matches). Answers questions about match ' +
    'scorelines and outcomes, team performance and possession across a ' +
    'tournament, top scorers and assists, goal composition (open play, ' +
    'penalty kicks, free kicks, own goals, headers), penalty shoot-outs, and ' +
    'disciplinary cards. Grain: one row per match (matches), one row per team ' +
    'per match for statistics (match_team_statistics), one row per goal ' +
    '(goals), one row per booking or sending-off (disciplinary_events).',
  knowledge: [
    {
      kind: 'term',
      title: 'Goal type vocabulary and own-goal crediting',
      // Verified: `SELECT goal_type, count(*) FROM world_cup.goals GROUP BY 1`
      // → free_kick 1, header 13, open_play 24, own_goal 2, penalty 7 (47 total).
      // Own-goal crediting verified: `SELECT g.id, m.match_number, t.common_name
      // AS credited_team, p.full_name AS scorer, pt.common_name AS scorer_team
      // FROM world_cup.goals g JOIN world_cup.matches m ON m.id = g.match_id
      // JOIN world_cup.teams t ON t.id = g.scoring_team_id LEFT JOIN
      // world_cup.players p ON p.id = g.scorer_player_id LEFT JOIN
      // world_cup.teams pt ON pt.id = p.national_team_id WHERE g.goal_type =
      // 'own_goal'` → both own-goal rows show the scorer on the OPPOSING team
      // from the credited team (match 58: credited Belgium, scorer Fernandinho
      // of Brazil; match 64: credited France, scorer Mandzukic of Croatia).
      body:
        "goals.goal_type is one of open_play, penalty, free_kick, own_goal, " +
        "header — 'penalty' here means a penalty kick taken in open play, not " +
        "a penalty-SHOOT-OUT kick (shoot-outs are recorded on matches, see " +
        "below). For an own_goal row, scoring_team_id is the team CREDITED " +
        "with the goal on the scoreboard; scorer_player_id (when set) is the " +
        "player who put the ball into his own net and belongs to the " +
        "OPPOSING team, not to scoring_team_id.",
      entities: ['world_cup.goals'],
      column: 'goal_type',
    },
    {
      kind: 'term',
      title: 'Penalty shoot-out encoding',
      // Verified: `SELECT match_number, stage, went_to_extra_time,
      // home_penalties, away_penalties FROM world_cup.matches WHERE
      // home_penalties IS NOT NULL` → 4 rows, all went_to_extra_time = true.
      // `SELECT count(*) FROM world_cup.matches WHERE went_to_extra_time AND
      // home_penalties IS NULL` → 1 (extra time alone can also decide a match).
      body:
        'matches.home_penalties and away_penalties are set only for a ' +
        'knockout match that went to a penalty shoot-out; every match with ' +
        'non-null penalties has went_to_extra_time = true, but the reverse ' +
        'does not hold — some matches with went_to_extra_time = true were ' +
        'decided in extra time itself, without a shoot-out. winner_team_id ' +
        'names the team that advanced from that match, however it was decided.',
      entities: ['world_cup.matches'],
      column: 'home_penalties',
    },
    {
      kind: 'term',
      title: 'Match stage vocabulary',
      body:
        'matches.stage is one of group, round_of_16, quarter_final, ' +
        "semi_final, third_place, final. 'Knockout' matches are every stage " +
        "except group.",
      entities: ['world_cup.matches'],
      column: 'stage',
    },
    {
      kind: 'term',
      title: 'This fixture holds only the quarter-finals onward',
      // Verified: `SELECT stage, count(*) FROM world_cup.matches GROUP BY 1`
      // → final 2, quarter_final 8, semi_final 4, third_place 2 (16 total,
      // no group or round_of_16 rows). Matches the schema's own
      // `COMMENT ON VIEW v_seeded_team_performance`, which says the same.
      body:
        'Despite the CHECK constraint allowing group and round_of_16 values, ' +
        'this fixture contains no matches at those stages — only ' +
        'quarter_final, semi_final, third_place and final matches are loaded, ' +
        '16 matches total across both tournaments. Do not assume group-stage ' +
        'or round-of-16 data exists.',
      entities: ['world_cup.matches'],
    },
    {
      kind: 'instruction',
      title: 'Join goals and team statistics to a tournament year',
      body:
        'goals and match_team_statistics reference matches, not tournaments, ' +
        'directly. To filter or group either by tournament year, join ' +
        'matches → tournaments on matches.tournament_id = tournaments.id and ' +
        'use tournaments.tournament_year.',
      entities: [
        'world_cup.goals',
        'world_cup.matches',
        'world_cup.tournaments',
        'world_cup.match_team_statistics',
      ],
    },
    {
      kind: 'term',
      title: 'Coverage: 2018 and 2022 only',
      // Verified: `SELECT tournament_year FROM world_cup.tournaments ORDER BY 1`
      // → 2018, 2022 (exactly two rows).
      body:
        'tournaments has exactly two rows: tournament_year 2018 and 2022. ' +
        'There is no earlier or later FIFA World Cup in this fixture.',
      entities: ['world_cup.tournaments'],
      column: 'tournament_year',
    },
  ],
  metrics: [],
};

// =============================================================================
// Health Insurance (schema `health_insurance`) — generated, seed 20260922.
// =============================================================================

const HEALTH_INSURANCE: FixtureSemantics = {
  datasetName: 'Health Insurance',
  schema: 'health_insurance',
  description:
    'Health Insurance (schema health_insurance): a mid-size regional health ' +
    'plan — members enrolled on benefit plans, claims submitted by ' +
    'in-network and out-of-network providers, and the adjudication outcome ' +
    '(paid, denied, pending, or reversed) of each claim, including per-line ' +
    'billed/allowed/paid amounts and denial reasons. Answers questions about ' +
    'claim volume and money billed, allowed, paid, or owed by members; ' +
    'denial rates and reasons; provider and specialty mix; plan tiers; and ' +
    'member enrollment and activity by region, state, and country. Grain: ' +
    'one row per claim (claims), one row per procedure line on a claim ' +
    '(claim_lines), one row per denial (claim_denials), one row per member ' +
    '(members). All monetary columns are stored as integer cents. Coverage: ' +
    'claims.service_date spans calendar years 2024 and 2025 only, and about ' +
    '3% of claims are synthetic end-to-end test traffic (is_test) mixed into ' +
    'the volume on purpose.',
  knowledge: [
    {
      kind: 'term',
      title: 'Claim status vocabulary',
      // Verified: `SELECT status, count(*) FROM health_insurance.claims
      // GROUP BY 1` → DENIED 207, PAID 812, PENDING 130, REVERSED 51 (1200
      // total). CHECK constraint on claims also pins the four exact values.
      body:
        "claims.status is one of PAID, DENIED, PENDING, REVERSED. 'approved' " +
        "or 'paid out' means status = PAID. REVERSED rows carry a POSITIVE " +
        "paid_amount_cents that must be SUBTRACTED, not summed, when " +
        "reporting money actually paid out — see the net_paid metric. " +
        "PENDING claims have not been adjudicated (adjudicated_on is null by " +
        "CHECK constraint) and should be excluded from any rate or amount " +
        "that describes a decision, not silently counted as either outcome.",
      synonyms: ['approved', 'paid out', 'denied', 'pending', 'reversed'],
      entities: ['health_insurance.claims'],
      column: 'status',
    },
    {
      kind: 'term',
      title: 'Amounts are stored in cents',
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
      column: 'is_test',
    },
    {
      kind: 'term',
      title: 'Currency is always USD',
      // Verified: `SELECT DISTINCT currency FROM health_insurance.claims` → USD.
      body:
        "claims.currency is always 'USD' (CHECK constraint) — do not group " +
        'or filter by it; it carries no information and every amount is ' +
        'already in one currency.',
      entities: ['health_insurance.claims'],
      column: 'currency',
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
      column: 'preauth_code',
    },
    {
      kind: 'instruction',
      title: 'Join claims to member location',
      // Verified: `COMMENT ON VIEW v_claim_financials` in
      // docker/postgres/init/002_health_insurance.sql states region/state/
      // country there are the MEMBER's location.
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
      // health_insurance.claims` → 2024-01-01 .. 2025-12-31 (also pinned by
      // the CHECK constraint on service_date).
      body:
        'claims.service_date only covers 2024-01-01 through 2025-12-31 ' +
        '(CHECK constraint) — there is no earlier or later claims data in ' +
        'this fixture.',
      entities: ['health_insurance.claims'],
      column: 'service_date',
    },
    {
      kind: 'term',
      title: 'Units billed vs. units allowed on claim lines',
      // Verified: CHECK (units_allowed <= units_billed) on claim_lines.
      body:
        'claim_lines.units_billed is what the provider submitted; ' +
        'units_allowed is what was approved on review, and is always less ' +
        'than or equal to units_billed. "Units cut on review" means ' +
        'units_billed - units_allowed, a difference — not a ratio of a ' +
        'column to itself.',
      entities: ['health_insurance.claim_lines'],
      column: 'units_allowed',
    },
  ],
  metrics: [
    {
      // Unchanged from the pre-U2-D script — same name, description and
      // expression, re-hosted here only so bootstrap-fixtures.ts has one
      // source of truth for every metric.
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
      // Definition matches `denial-rate`'s current `expectedSql` exactly
      // (see src/mastra/evals/suites/health-insurance.json): denominator is
      // adjudicated (non-PENDING) claims, expressed with FILTER instead of a
      // WHERE clause so the metric is self-contained wherever it is used.
      // Combine with the "Exclude test claims" default filter for a reported
      // rate — same convention as net_paid, which also leaves is_test to the
      // separate default_filter snippet rather than folding it in here.
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
      name: 'paid_share_of_billed',
      label: 'Paid share of billed',
      description:
        'Share of the billed amount actually paid out, as a fraction of 1 ' +
        '(multiply by 100 for a percentage). Combine with the "Exclude test ' +
        'claims" filter for a reported rate.',
      entity: 'health_insurance.claims',
      expression: 'SUM(paid_amount_cents) * 1.0 / NULLIF(SUM(billed_amount_cents), 0)',
    },
  ],
};

// =============================================================================
// Genomics (schema `genomics`) — generated, seed 20240815.
// =============================================================================

const GENOMICS: FixtureSemantics = {
  datasetName: 'Genomics',
  schema: 'genomics',
  description:
    'Genomics (schema genomics): a clinical-genomics cohort study — subjects ' +
    'grouped by ancestry, sequenced samples (including QC control samples), ' +
    'called variants annotated to genes with a clinical-significance call, ' +
    'per-sample gene expression, and phenotype (HPO term) annotations. ' +
    'Answers questions about variant calls and genotypes, allele fraction ' +
    'and read-depth quality, gene expression levels, cohort composition by ' +
    'ancestry and superpopulation, and phenotype associations. Grain: one ' +
    'row per variant call in one sample (variant_calls), one row per gene ' +
    'measured in one sample (gene_expression), one row per subject ' +
    '(subjects), one row per sequenced sample (samples). Coverage: samples ' +
    'were collected and subjects enrolled between 2023-01-01 and ' +
    '2024-12-31 only, every variant is called against genome assembly ' +
    'GRCh38, and about 11% of samples are QC control material (is_control) ' +
    'rather than cohort subjects. This is synthetic data invented by a ' +
    'seeded generator and must never be used for any clinical, diagnostic, ' +
    'or research purpose.',
  knowledge: [
    {
      kind: 'term',
      title: 'Read-count columns on variant_calls',
      // Verified: CHECK (alt_read_count <= total_read_count) on
      // variant_calls; `SELECT count(*) FROM genomics.variant_calls WHERE
      // read_depth <> total_read_count` → 0 (read_depth always duplicates
      // total_read_count in this fixture — also stated in
      // `COMMENT ON COLUMN variant_calls.read_depth`).
      body:
        'variant_calls.alt_read_count counts reads supporting the alternate ' +
        'allele; total_read_count is the total reads at the site, and ' +
        'alt_read_count is always less than or equal to it. read_depth ' +
        'duplicates total_read_count exactly in this fixture. Allele ' +
        'fraction is alt_read_count / total_read_count over PASS calls with ' +
        'at least 20 total reads — see the allele_fraction metric; do not ' +
        'divide either count by itself.',
      entities: ['genomics.variant_calls'],
    },
    {
      kind: 'term',
      title: 'Genome assembly is always GRCh38',
      // Verified: `SELECT DISTINCT assembly FROM genomics.variants` → GRCh38.
      body:
        "variants.assembly is always 'GRCh38' (CHECK constraint) — do not " +
        'group or filter by it.',
      entities: ['genomics.variants'],
      column: 'assembly',
    },
    {
      kind: 'term',
      title: 'dbSNP id (rsid) coverage is low',
      // Verified: `SELECT count(*) FILTER (WHERE rsid IS NOT NULL), count(*)
      // FROM genomics.variants` → 46 of 450 (10.2%) non-null.
      body:
        'variants.rsid (its dbSNP identifier) is null on most variants — ' +
        'about 90% have no rsid in this fixture, because most are too novel ' +
        'or too rare to carry one. Counting non-null rsid measures dbSNP ' +
        'cross-reference coverage, not variant quality or significance.',
      entities: ['genomics.variants'],
      column: 'rsid',
    },
    {
      kind: 'term',
      title: 'Clinical significance vocabulary',
      // Verified: `SELECT clinical_significance, count(*) FROM
      // genomics.variants GROUP BY 1` → BENIGN 68, LIKELY_BENIGN 74,
      // LIKELY_PATHOGENIC 53, PATHOGENIC 96, VUS 159 (450 total).
      body:
        'variants.clinical_significance is one of PATHOGENIC, ' +
        'LIKELY_PATHOGENIC, VUS, LIKELY_BENIGN, BENIGN — five separate ACMG ' +
        "classes. 'Pathogenic' on its own names the PATHOGENIC class; " +
        'LIKELY_PATHOGENIC is a distinct, weaker class that is not part of ' +
        "it. 'Damaging' or 'harmful' variants means PATHOGENIC or " +
        'LIKELY_PATHOGENIC together; ' +
        "VUS ('variant of uncertain significance') is neither damaging nor " +
        'benign and should not be counted as either unless the question ' +
        'explicitly asks about uncertain variants.',
      synonyms: ['damaging', 'harmful', 'pathogenic'],
      entities: ['genomics.variants'],
      column: 'clinical_significance',
    },
    {
      kind: 'term',
      title: 'Coverage: subjects and samples from 2023–2024 only',
      // Verified: `SELECT min(enrolled_on), max(enrolled_on) FROM
      // genomics.subjects` → 2023-01-01 .. 2024-09-19; `SELECT
      // min(collected_on), max(collected_on) FROM genomics.samples` →
      // 2023-02-02 .. 2024-12-11 (both inside the CHECK-constrained
      // 2023-01-01..2024-12-31 window).
      body:
        'subjects.enrolled_on and samples.collected_on only cover ' +
        '2023-01-01 through 2024-12-31 (CHECK constraint on both) — there is ' +
        'no earlier or later subject or sample data in this fixture.',
      entities: ['genomics.subjects', 'genomics.samples'],
    },
    {
      kind: 'instruction',
      title: 'Report genes by symbol, not by id',
      body:
        'variant_calls references variants by id, and variants reference ' +
        'genes by id — variant_calls has no direct gene_id column. Join ' +
        'variant_calls → variants → genes and report genes.hgnc_symbol, not ' +
        'a numeric gene_id or variant_id.',
      entities: [
        'genomics.variant_calls',
        'genomics.variants',
        'genomics.genes',
      ],
    },
    {
      kind: 'default_filter',
      title: 'Exclude control samples',
      // Verified: `SELECT count(*) FILTER (WHERE is_control), count(*) FROM
      // genomics.samples` → 15 of 140 (10.7%). The flag is per sample: all
      // 120 subjects are enrolled cohort members, and 8 of them happen to
      // have only a control sample on record (subjects 4, 7, 12, 13, 69,
      // 70, 83, 120) — which is why a subject count must not be routed
      // through samples to apply this filter.
      body:
        'is_control is a property of a sample, not of a subject. Unless ' +
        'the question explicitly asks about controls, exclude samples where ' +
        'is_control = true from sample counts, variant-call aggregates and ' +
        'expression aggregates — control samples are QC material (about 11% ' +
        'of samples). The filter applies to queries that read samples, ' +
        'variant_calls, gene_expression or the views built on them. Counts ' +
        'of subjects, phenotypes, ancestry groups, variants or genes that do ' +
        'not read sample rows are not affected by it: every subject is an ' +
        'enrolled cohort member, so do not join to samples just to apply ' +
        'this filter.',
      entities: ['genomics.samples'],
      column: 'is_control',
    },
    {
      kind: 'instruction',
      title: 'Join subjects to superpopulation via ancestry group',
      body:
        'There is no direct subjects.superpopulation_id column. The path ' +
        'from a subject to their superpopulation is subjects → ' +
        'ancestry_groups (subjects.ancestry_group_id = ancestry_groups.id) ' +
        '→ superpopulations (ancestry_groups.superpopulation_id = ' +
        'superpopulations.id).',
      entities: [
        'genomics.subjects',
        'genomics.ancestry_groups',
        'genomics.superpopulations',
      ],
    },
    {
      kind: 'term',
      title: 'Genotype 0/0 is not a carrier',
      // Verified: `SELECT genotype, count(*) FROM genomics.variant_calls
      // GROUP BY 1` → 0/0 1838, 0/1 2418, 1/1 1007 (5263 total); also
      // `COMMENT ON COLUMN variant_calls.genotype` states the same.
      body:
        'variant_calls.genotype is one of 0/0 (homozygous reference — the ' +
        'sample does NOT carry the alternate allele), 0/1 (heterozygous — ' +
        'carries one copy), 1/1 (homozygous alternate — carries two copies). ' +
        'Only 0/1 and 1/1 count as "carrying" the variant.',
      synonyms: ['carrier', 'homozygous reference', 'heterozygous'],
      entities: ['genomics.variant_calls'],
      column: 'genotype',
    },
    {
      kind: 'term',
      title: 'A TPM of zero is a real measurement',
      // Verified: `SELECT count(*) FILTER (WHERE tpm = 0), count(*) FROM
      // genomics.gene_expression` → 1172 of 3000 (39.1%); also
      // `COMMENT ON COLUMN gene_expression.tpm` states the same.
      body:
        'gene_expression.tpm (transcripts per million) of 0 is a real ' +
        'measured value — the gene was not expressed in that sample — not a ' +
        'missing or null value. About 39% of gene/sample pairs have tpm = 0. ' +
        'Do not filter out or exclude tpm = 0 rows when computing an average ' +
        'or median expression level; that biases the result upward.',
      entities: ['genomics.gene_expression'],
      column: 'tpm',
    },
    {
      kind: 'term',
      title: 'Expression measures: tpm and raw_count',
      // Verified: gene_expression has exactly two measures, raw_count bigint
      // and tpm numeric(10,3) (003_genomics.sql), one row per gene per
      // sample; raw_count is 0 on exactly the rows where tpm is 0.
      body:
        'gene_expression holds two measures per gene per sample: tpm ' +
        '(transcripts per million — the normalised expression level, ' +
        'comparable across samples and genes) and raw_count (the ' +
        'unnormalised read count, which scales with sequencing depth and is ' +
        'not comparable across samples). Expression level means tpm.',
      synonyms: ['expression level', 'TPM', 'raw count'],
      entities: ['genomics.gene_expression'],
    },
    {
      kind: 'term',
      title: 'Filter status and call confidence',
      // Verified: `SELECT filter_status, count(*) FROM
      // genomics.variant_calls GROUP BY 1` → LOW_QUAL 809, PASS 4454 (5263
      // total; 15.4% LOW_QUAL).
      body:
        "variant_calls.filter_status is PASS or LOW_QUAL. 'High-confidence' " +
        "calls means filter_status = 'PASS'; about 15% of calls are " +
        'LOW_QUAL and should be excluded from a high-confidence count or ' +
        'aggregate unless the question asks about call quality directly. ' +
        'filter_status grades the call, not the genotype: 0/0, 0/1 and 1/1 ' +
        'calls can each be PASS or LOW_QUAL.',
      entities: ['genomics.variant_calls'],
      column: 'filter_status',
    },
  ],
  metrics: [
    {
      // Unchanged from the pre-U2-D script — same name, description and
      // expression.
      name: 'allele_fraction',
      label: 'Allele fraction',
      description:
        'Mean fraction of reads supporting the alternate allele, over calls ' +
        "with filter_status='PASS' and total_read_count >= 20. The 20-read " +
        'floor belongs to this metric only; it is not the definition of a ' +
        "high-confidence call, which is filter_status = 'PASS' alone.",
      entity: 'genomics.variant_calls',
      expression:
        "AVG(alt_read_count::numeric / NULLIF(total_read_count, 0)) FILTER (WHERE filter_status = 'PASS' AND total_read_count >= 20)",
    },
    {
      // New: filter_status is an unambiguous two-value enum (PASS/LOW_QUAL,
      // CHECK-constrained), so "share of calls that passed" has exactly one
      // reading. Verified count: 4454 of 5263 calls PASS (84.6%).
      name: 'high_confidence_call_rate',
      label: 'High-confidence call rate',
      description:
        "Share of variant calls that passed quality filtering " +
        "(filter_status = 'PASS'), as a percentage.",
      entity: 'genomics.variant_calls',
      expression:
        "ROUND(100.0 * COUNT(*) FILTER (WHERE filter_status = 'PASS') / NULLIF(COUNT(*), 0), 2)",
    },
  ],
};

/** One entry per fixture, in the same order `bootstrap-fixtures.ts` registers them. */
export const FIXTURE_SEMANTICS: FixtureSemantics[] = [
  WORLD_CUP,
  HEALTH_INSURANCE,
  GENOMICS,
  SUPPLY_CHAIN,
  BANKING,
];
