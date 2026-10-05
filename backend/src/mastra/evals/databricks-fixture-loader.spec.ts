// `load-fixtures-databricks.ts` statically imports `@databricks/sql` (and,
// transitively via `AppModule` → `DatabricksConnector`, imports it a second
// way) for its live-connection code paths. That package pulls in `thrift`,
// whose transitive `uuid` dependency is ESM-only and breaks Jest's
// CommonJS transform for node_modules. Jest hoists `jest.mock` above the
// imports below, so the real package — and its `thrift`/`uuid` chain — is
// never evaluated here; this spec only exercises the loader's pure
// functions, none of which touch `DBSQLClient`.
jest.mock('@databricks/sql', () => ({ DBSQLClient: jest.fn() }));

import {
  DEFAULT_DECIMAL,
  emitCreateSchemaDdl,
  emitCreateTableDdl,
  emitInsertBatches,
  flagsDateArithmetic,
  formatLiteral,
  mapPgTypeToDatabricks,
  quoteFqTable,
  quoteIdent,
  requoteIdentifiers,
  translateCasts,
  translateFilterClauses,
  translateViewDefinition,
  type ColumnDef,
} from '../../../scripts/load-fixtures-databricks';

// jest `rootDir` is `src` (backend/package.json); this spec reaches into
// `scripts/` with a relative import, same pattern as fixture-semantics.spec.ts.
//
// Only the loader's PURE parts are exercised here — type mapping, DDL/literal
// emission, and view translation. Nothing here opens a Postgres connection or
// a Databricks session; `main()` is guarded by `require.main === module` so
// importing the module for its exports has no side effects.

// -------------------------------------------------------- type mapping

describe('mapPgTypeToDatabricks', () => {
  it.each([
    ['smallint', 'INT'],
    ['integer', 'INT'],
    ['bigint', 'BIGINT'],
    ['real', 'DOUBLE'],
    ['double precision', 'DOUBLE'],
    ['boolean', 'BOOLEAN'],
    ['date', 'DATE'],
    ['timestamp without time zone', 'TIMESTAMP'],
    ['timestamp with time zone', 'TIMESTAMP'],
    ['text', 'STRING'],
    ['character varying', 'STRING'],
    ['character', 'STRING'],
    ['char', 'STRING'],
    ['uuid', 'STRING'],
    ['json', 'STRING'],
    ['jsonb', 'STRING'],
  ])('%s → %s', (dataType, expected) => {
    expect(mapPgTypeToDatabricks({ dataType })).toBe(expected);
  });

  it('numeric with precision/scale → DECIMAL(p,s)', () => {
    expect(
      mapPgTypeToDatabricks({
        dataType: 'numeric',
        numericPrecision: 5,
        numericScale: 2,
      }),
    ).toBe('DECIMAL(5,2)');
    expect(
      mapPgTypeToDatabricks({
        dataType: 'numeric',
        numericPrecision: 4,
        numericScale: 3,
      }),
    ).toBe('DECIMAL(4,3)');
  });

  it('bare numeric (no precision/scale) → default DECIMAL(38,6)', () => {
    expect(mapPgTypeToDatabricks({ dataType: 'numeric' })).toBe(
      DEFAULT_DECIMAL,
    );
    expect(DEFAULT_DECIMAL).toBe('DECIMAL(38,6)');
  });

  it('array types (data_type ARRAY or udt_name prefixed _) → STRING', () => {
    expect(mapPgTypeToDatabricks({ dataType: 'ARRAY', udtName: '_text' })).toBe(
      'STRING',
    );
    expect(mapPgTypeToDatabricks({ dataType: 'ARRAY' })).toBe('STRING');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(mapPgTypeToDatabricks({ dataType: '  BIGINT  ' })).toBe('BIGINT');
    expect(mapPgTypeToDatabricks({ dataType: 'Boolean' })).toBe('BOOLEAN');
  });

  it('falls back to STRING for anything unrecognised', () => {
    expect(mapPgTypeToDatabricks({ dataType: 'some_exotic_type' })).toBe(
      'STRING',
    );
  });
});

// -------------------------------------------------------------- DDL emission

describe('DDL emission', () => {
  it('quoteIdent backtick-escapes embedded backticks', () => {
    expect(quoteIdent('plain')).toBe('`plain`');
    expect(quoteIdent('weird`name')).toBe('`weird``name`');
  });

  it('quoteFqTable joins catalog.schema.table, each backtick-quoted', () => {
    expect(quoteFqTable('eval_fixtures', 'health_insurance', 'claims')).toBe(
      '`eval_fixtures`.`health_insurance`.`claims`',
    );
  });

  it('emitCreateSchemaDdl', () => {
    expect(emitCreateSchemaDdl('eval_fixtures', 'genomics')).toBe(
      'CREATE SCHEMA IF NOT EXISTS `eval_fixtures`.`genomics`;',
    );
  });

  it('emitCreateTableDdl orders by ordinal and marks NOT NULL', () => {
    const columns: ColumnDef[] = [
      {
        name: 'status',
        pgType: 'text',
        databricksType: 'STRING',
        nullable: false,
        ordinal: 2,
      },
      {
        name: 'id',
        pgType: 'bigint',
        databricksType: 'BIGINT',
        nullable: false,
        ordinal: 1,
      },
      {
        name: 'preauth_code',
        pgType: 'text',
        databricksType: 'STRING',
        nullable: true,
        ordinal: 3,
      },
    ];
    const ddl = emitCreateTableDdl('`c`.`s`.`claims`', columns);
    expect(ddl).toBe(
      [
        'CREATE OR REPLACE TABLE `c`.`s`.`claims` (',
        '  `id` BIGINT NOT NULL,',
        '  `status` STRING NOT NULL,',
        '  `preauth_code` STRING',
        ');',
      ].join('\n'),
    );
  });
});

// --------------------------------------------------------- literal escaping

describe('formatLiteral', () => {
  it('null/undefined → NULL regardless of type', () => {
    expect(formatLiteral(null, 'STRING')).toBe('NULL');
    expect(formatLiteral(undefined, 'BIGINT')).toBe('NULL');
  });

  it('BOOLEAN from a JS boolean or a pg-style flag string', () => {
    expect(formatLiteral(true, 'BOOLEAN')).toBe('TRUE');
    expect(formatLiteral(false, 'BOOLEAN')).toBe('FALSE');
    expect(formatLiteral('t', 'BOOLEAN')).toBe('TRUE');
    expect(formatLiteral('f', 'BOOLEAN')).toBe('FALSE');
  });

  it("DATE formats a JS Date as DATE'YYYY-MM-DD'", () => {
    expect(formatLiteral(new Date('2024-03-15T00:00:00.000Z'), 'DATE')).toBe(
      "DATE'2024-03-15'",
    );
  });

  it("TIMESTAMP formats a JS Date as TIMESTAMP'YYYY-MM-DD HH:MI:SS.sss'", () => {
    expect(
      formatLiteral(new Date('2024-03-15T08:30:00.000Z'), 'TIMESTAMP'),
    ).toBe("TIMESTAMP'2024-03-15 08:30:00.000'");
  });

  it("numeric-typed columns emit pg's string-encoded bigint/numeric unquoted", () => {
    // node-pg returns bigint/numeric columns as strings to avoid precision loss.
    expect(formatLiteral('123456789012345', 'BIGINT')).toBe('123456789012345');
    expect(formatLiteral('19.83', 'DECIMAL(5,2)')).toBe('19.83');
    expect(formatLiteral(42, 'INT')).toBe('42');
  });

  it('a non-numeric string in a numeric column is quoted defensively, not emitted raw', () => {
    expect(formatLiteral('not-a-number', 'BIGINT')).toBe("'not-a-number'");
  });

  it('STRING escapes single quotes and backslashes', () => {
    expect(formatLiteral("O'Brien", 'STRING')).toBe("'O\\'Brien'");
    expect(formatLiteral('back\\slash', 'STRING')).toBe("'back\\\\slash'");
  });
});

describe('emitInsertBatches', () => {
  const columns: ColumnDef[] = [
    {
      name: 'id',
      pgType: 'bigint',
      databricksType: 'BIGINT',
      nullable: false,
      ordinal: 1,
    },
    {
      name: 'name',
      pgType: 'text',
      databricksType: 'STRING',
      nullable: false,
      ordinal: 2,
    },
  ];

  it('empty rows → no statements', () => {
    expect(emitInsertBatches('`c`.`s`.`t`', columns, [])).toEqual([]);
  });

  it('one statement for rows at or under the batch size', () => {
    const rows = [
      { id: '1', name: 'Alpha' },
      { id: '2', name: "O'Brien" },
    ];
    const statements = emitInsertBatches('`c`.`s`.`t`', columns, rows, 500);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "INSERT INTO `c`.`s`.`t` (`id`, `name`) VALUES\n  (1, 'Alpha'),\n  (2, 'O\\'Brien');",
    );
  });

  it('batches at the given size (≤ 500 rows/statement by default)', () => {
    const rows = Array.from({ length: 1201 }, (_, i) => ({
      id: String(i),
      name: `n${i}`,
    }));
    const statements = emitInsertBatches('`c`.`s`.`t`', columns, rows);
    // 1201 rows / 500 per batch → 3 statements (500, 500, 201).
    expect(statements).toHaveLength(3);
    const rowsInStatement = (sql: string) => sql.split('\n  (').length; // rough row count via row-prefix count
    expect(rowsInStatement(statements[0])).toBeGreaterThan(1);
    expect(statements[2]).toContain('(1200,');
  });

  it('respects a custom batch size', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      name: `n${i}`,
    }));
    const statements = emitInsertBatches('`c`.`s`.`t`', columns, rows, 2);
    expect(statements).toHaveLength(3); // 2, 2, 1
  });
});

// ------------------------------------------------------- view translation

describe('translateCasts', () => {
  it("quoted-literal cast: 'PASS'::text → CAST('PASS' AS STRING)", () => {
    expect(translateCasts("'PASS'::text")).toBe("CAST('PASS' AS STRING)");
  });

  it('parenthesized-expr cast: (0)::numeric → CAST(0 AS DECIMAL(38,6))', () => {
    expect(translateCasts('(0)::numeric')).toBe(
      `CAST(0 AS ${DEFAULT_DECIMAL})`,
    );
  });

  it('unrecognised cast target types are upper-cased rather than dropped', () => {
    expect(translateCasts("'x'::jsonb")).toBe("CAST('x' AS JSONB)");
  });
});

describe('requoteIdentifiers', () => {
  it('double-quoted reserved-word identifiers become backtick-quoted', () => {
    expect(requoteIdentifiers('variant."position"')).toBe('variant.`position`');
  });
});

describe('translateFilterClauses', () => {
  it('count(col) FILTER (WHERE p) → count(CASE WHEN p THEN col END)', () => {
    const { sql, flagged } = translateFilterClauses(
      "count(call.id) FILTER (WHERE (call.filter_status = 'PASS'::text)) AS pass_call_count",
    );
    expect(flagged).toBe(false);
    expect(sql).toBe(
      "count(CASE WHEN (call.filter_status = 'PASS'::text) THEN call.id END) AS pass_call_count",
    );
  });

  it('count(*) FILTER (WHERE p) uses 1 in place of * (CASE cannot hold a bare *)', () => {
    const { sql, flagged } = translateFilterClauses(
      "count(*) FILTER (WHERE (goal.goal_type <> 'own_goal'::text)) AS goals",
    );
    expect(flagged).toBe(false);
    expect(sql).toBe(
      "count(CASE WHEN (goal.goal_type <> 'own_goal'::text) THEN 1 END) AS goals",
    );
  });

  it('min(col) FILTER (WHERE p) → min(CASE WHEN p THEN col END)', () => {
    const { sql, flagged } = translateFilterClauses(
      "min(goal.minute) FILTER (WHERE (goal.goal_type <> 'own_goal'::text)) AS first_goal_minute",
    );
    expect(flagged).toBe(false);
    expect(sql).toBe(
      "min(CASE WHEN (goal.goal_type <> 'own_goal'::text) THEN goal.minute END) AS first_goal_minute",
    );
  });

  it('translates every FILTER occurrence, in order, in a multi-FILTER expression', () => {
    const { sql, flagged } = translateFilterClauses(
      'count(*) FILTER (WHERE (a = 1)) AS x, count(*) FILTER (WHERE (b = 2)) AS y',
    );
    expect(flagged).toBe(false);
    expect(sql).toBe(
      'count(CASE WHEN (a = 1) THEN 1 END) AS x, count(CASE WHEN (b = 2) THEN 1 END) AS y',
    );
    expect(sql).not.toContain('FILTER');
  });

  it('flags (and leaves untouched) a FILTER it cannot match to a preceding function call', () => {
    const input = 'not a real filter FILTER (WHERE x = 1)';
    const { sql, flagged } = translateFilterClauses(input);
    expect(flagged).toBe(true);
    expect(sql).toBe(input);
  });

  it('leaves SQL with no FILTER clause unchanged', () => {
    const input = 'SELECT a, b FROM t WHERE a = 1';
    expect(translateFilterClauses(input)).toEqual({
      sql: input,
      flagged: false,
    });
  });
});

describe('flagsDateArithmetic', () => {
  it.each([
    "service_date + INTERVAL '1 day'",
    "date_trunc('month', service_date)",
    'now()',
    'CURRENT_DATE',
    'CURRENT_TIMESTAMP',
  ])('flags %s', (snippet) => {
    expect(flagsDateArithmetic(snippet)).toBe(true);
  });

  it('does not flag ordinary SQL with no date arithmetic', () => {
    expect(
      flagsDateArithmetic('SELECT a, b FROM t JOIN u ON u.id = t.id'),
    ).toBe(false);
  });
});

// --------------------------- real view definitions, pasted as fixtures ---
// Captured verbatim from `SELECT definition FROM pg_views WHERE schemaname
// IN ('world_cup','health_insurance','genomics')` against the live fixture
// (localhost:55432, db world_cup) on 2026-09-23 — see fixture-semantics.ts's
// module doc for the same verification convention.

const REAL_VIEWS: { schema: string; name: string; definition: string }[] = [
  {
    schema: 'genomics',
    name: 'v_sample_qc',
    definition:
      " SELECT sample.sample_code,\n    sample.assay,\n    sample.mean_coverage,\n    sample.is_control,\n    count(call.id) FILTER (WHERE (call.filter_status = 'PASS'::text)) AS pass_call_count,\n    count(call.id) FILTER (WHERE (call.genotype <> '0/0'::text)) AS non_reference_call_count\n   FROM (genomics.samples sample\n     LEFT JOIN genomics.variant_calls call ON ((call.sample_id = sample.id)))\n  GROUP BY sample.id, sample.sample_code, sample.assay, sample.mean_coverage, sample.is_control;",
  },
  {
    schema: 'genomics',
    name: 'v_variant_calls',
    definition:
      ' SELECT sample.sample_code,\n    subject.subject_code,\n    gene.hgnc_symbol AS gene_symbol,\n    variant.chromosome,\n    variant."position",\n    variant.reference_allele,\n    variant.alternate_allele,\n    variant.clinical_significance,\n    call.genotype,\n    call.alt_read_count,\n    call.total_read_count,\n    call.filter_status\n   FROM ((((genomics.variant_calls call\n     JOIN genomics.samples sample ON ((sample.id = call.sample_id)))\n     JOIN genomics.subjects subject ON ((subject.id = sample.subject_id)))\n     JOIN genomics.variants variant ON ((variant.id = call.variant_id)))\n     JOIN genomics.genes gene ON ((gene.id = variant.gene_id)));',
  },
  {
    schema: 'health_insurance',
    name: 'v_claim_financials',
    definition:
      ' SELECT claim.id AS claim_id,\n    claim.claim_number,\n    claim.service_date,\n    claim.received_on,\n    claim.adjudicated_on,\n    claim.status,\n    claim.claim_type,\n    claim.place_of_service,\n    claim.currency,\n    claim.preauth_code,\n    claim.is_test,\n    member.id AS member_id,\n    member.member_number,\n    member.full_name AS member_name,\n    provider.id AS provider_id,\n    provider.name AS provider_name,\n    provider.specialty,\n    provider.network_status,\n    plan.name AS plan_name,\n    plan.tier AS plan_tier,\n    region.name AS region_name,\n    state.name AS state_name,\n    country.name AS country_name,\n    claim.billed_amount_cents,\n    claim.allowed_amount_cents,\n    claim.paid_amount_cents,\n    claim.member_responsibility_cents\n   FROM ((((((health_insurance.claims claim\n     JOIN health_insurance.members member ON ((member.id = claim.member_id)))\n     JOIN health_insurance.providers provider ON ((provider.id = claim.provider_id)))\n     JOIN health_insurance.plans plan ON ((plan.id = claim.plan_id)))\n     JOIN health_insurance.regions region ON ((region.id = member.region_id)))\n     JOIN health_insurance.states state ON ((state.id = region.state_id)))\n     JOIN health_insurance.countries country ON ((country.code = state.country_code)));',
  },
  {
    schema: 'health_insurance',
    name: 'v_member_claim_totals',
    definition:
      ' SELECT member.id AS member_id,\n    member.member_number,\n    member.full_name AS member_name,\n    plan.name AS plan_name,\n    region.name AS region_name,\n    member.terminated_on,\n    count(claim.id) AS claim_count,\n    COALESCE(sum(claim.billed_amount_cents), (0)::numeric) AS billed_amount_cents,\n    COALESCE(sum(claim.allowed_amount_cents), (0)::numeric) AS allowed_amount_cents,\n    COALESCE(sum(claim.paid_amount_cents), (0)::numeric) AS paid_amount_cents,\n    COALESCE(sum(claim.member_responsibility_cents), (0)::numeric) AS member_responsibility_cents\n   FROM (((health_insurance.members member\n     JOIN health_insurance.plans plan ON ((plan.id = member.plan_id)))\n     JOIN health_insurance.regions region ON ((region.id = member.region_id)))\n     LEFT JOIN health_insurance.claims claim ON ((claim.member_id = member.id)))\n  GROUP BY member.id, member.member_number, member.full_name, plan.name, region.name, member.terminated_on;',
  },
  {
    schema: 'world_cup',
    name: 'v_match_results',
    definition:
      ' SELECT tournament.tournament_year,\n    match.match_number,\n    match.stage,\n    match.kicked_off_at,\n    venue.name AS venue,\n    venue.city,\n    home.common_name AS home_team,\n    away.common_name AS away_team,\n    match.home_goals,\n    match.away_goals,\n    match.home_penalties,\n    match.away_penalties,\n    winner.common_name AS winner,\n    match.attendance\n   FROM (((((matches match\n     JOIN tournaments tournament ON ((tournament.id = match.tournament_id)))\n     JOIN venues venue ON ((venue.id = match.venue_id)))\n     JOIN teams home ON ((home.id = match.home_team_id)))\n     JOIN teams away ON ((away.id = match.away_team_id)))\n     LEFT JOIN teams winner ON ((winner.id = match.winner_team_id)));',
  },
  {
    schema: 'world_cup',
    name: 'v_player_goal_totals',
    definition:
      " SELECT tournament.tournament_year,\n    player.full_name AS player,\n    player_team.common_name AS national_team,\n    count(*) FILTER (WHERE (goal.goal_type <> 'own_goal'::text)) AS goals,\n    count(*) FILTER (WHERE (goal.goal_type = 'penalty'::text)) AS penalties,\n    count(*) FILTER (WHERE (goal.goal_type = 'own_goal'::text)) AS own_goals,\n    min(goal.minute) FILTER (WHERE (goal.goal_type <> 'own_goal'::text)) AS first_goal_minute\n   FROM ((((goals goal\n     JOIN matches match ON ((match.id = goal.match_id)))\n     JOIN tournaments tournament ON ((tournament.id = match.tournament_id)))\n     JOIN players player ON ((player.id = goal.scorer_player_id)))\n     JOIN teams player_team ON ((player_team.id = player.national_team_id)))\n  GROUP BY tournament.tournament_year, player.full_name, player_team.common_name;",
  },
  {
    schema: 'world_cup',
    name: 'v_seeded_team_performance',
    definition:
      ' WITH team_matches AS (\n         SELECT matches.tournament_id,\n            matches.id AS match_id,\n            matches.home_team_id AS team_id,\n            matches.home_goals AS goals_for,\n            matches.away_goals AS goals_against,\n            matches.winner_team_id,\n            matches.attendance\n           FROM matches\n        UNION ALL\n         SELECT matches.tournament_id,\n            matches.id,\n            matches.away_team_id,\n            matches.away_goals,\n            matches.home_goals,\n            matches.winner_team_id,\n            matches.attendance\n           FROM matches\n        )\n SELECT tournament.tournament_year,\n    team.common_name AS team,\n    confederation.code AS confederation,\n    count(*) AS matches_played,\n    count(*) FILTER (WHERE (team_matches.winner_team_id = team_matches.team_id)) AS wins,\n    count(*) FILTER (WHERE (team_matches.goals_for = team_matches.goals_against)) AS draws_after_extra_time,\n    sum(team_matches.goals_for) AS goals_for,\n    sum(team_matches.goals_against) AS goals_against,\n    round(avg(stat.possession_pct), 2) AS average_possession_pct,\n    sum(stat.shots) AS total_shots,\n    sum(stat.shots_on_target) AS shots_on_target,\n    round(sum(stat.expected_goals), 2) AS total_expected_goals,\n    round(avg(team_matches.attendance), 0) AS average_attendance\n   FROM (((((team_matches\n     JOIN tournaments tournament ON ((tournament.id = team_matches.tournament_id)))\n     JOIN teams team ON ((team.id = team_matches.team_id)))\n     JOIN countries country ON ((country.code = team.country_code)))\n     JOIN confederations confederation ON ((confederation.code = country.confederation_code)))\n     JOIN match_team_statistics stat ON (((stat.match_id = team_matches.match_id) AND (stat.team_id = team_matches.team_id))))\n  GROUP BY tournament.tournament_year, team.common_name, confederation.code;',
  },
];

describe('translateViewDefinition on real fixture views', () => {
  it('covers all 7 views the fixture schemas define', () => {
    expect(REAL_VIEWS).toHaveLength(7);
  });

  it.each(
    REAL_VIEWS.map((v): [string, string] => [
      `${v.schema}.${v.name}`,
      v.definition,
    ]),
  )(
    '%s translates cleanly (no leftover FILTER, no leftover ::cast, no stray trailing semicolon)',
    (_label, definition) => {
      const { sql, flags } = translateViewDefinition(definition);
      expect(sql).not.toContain('FILTER');
      expect(sql).not.toMatch(/::/);
      expect(sql.trim().endsWith(';')).toBe(false); // caller appends its own
      expect(flags).toEqual([]); // none of the 7 use ILIKE or date arithmetic
    },
  );

  it('v_sample_qc: FILTER aggregates become CASE WHEN, count(*) semantics preserved (0/0 excluded via non-reference)', () => {
    const view = REAL_VIEWS.find((v) => v.name === 'v_sample_qc');
    const { sql } = translateViewDefinition(view!.definition);
    expect(sql).toContain(
      "count(CASE WHEN (call.filter_status = CAST('PASS' AS STRING)) THEN call.id END) AS pass_call_count",
    );
    expect(sql).toContain(
      "count(CASE WHEN (call.genotype <> CAST('0/0' AS STRING)) THEN call.id END) AS non_reference_call_count",
    );
  });

  it('v_variant_calls: the reserved-word "position" column is backtick-quoted', () => {
    const view = REAL_VIEWS.find((v) => v.name === 'v_variant_calls');
    const { sql } = translateViewDefinition(view!.definition);
    expect(sql).toContain('variant.`position`');
    expect(sql).not.toContain('"position"');
  });

  it('v_member_claim_totals: (0)::numeric becomes CAST(0 AS DECIMAL(38,6))', () => {
    const view = REAL_VIEWS.find((v) => v.name === 'v_member_claim_totals');
    const { sql } = translateViewDefinition(view!.definition);
    expect(sql).toContain(`CAST(0 AS ${DEFAULT_DECIMAL})`);
  });

  it('v_seeded_team_performance: a CTE (WITH ...) and multiple FILTER aggregates both translate', () => {
    const view = REAL_VIEWS.find((v) => v.name === 'v_seeded_team_performance');
    const { sql } = translateViewDefinition(view!.definition);
    expect(sql.trim().startsWith('WITH team_matches AS (')).toBe(true);
    expect(sql).toContain(
      'count(CASE WHEN (team_matches.winner_team_id = team_matches.team_id) THEN 1 END) AS wins',
    );
    expect(sql).toContain(
      'count(CASE WHEN (team_matches.goals_for = team_matches.goals_against) THEN 1 END) AS draws_after_extra_time',
    );
  });

  it('v_match_results: no FILTER/cast — passes through unchanged apart from trim', () => {
    const view = REAL_VIEWS.find((v) => v.name === 'v_match_results');
    const { sql, flags } = translateViewDefinition(view!.definition);
    expect(flags).toEqual([]);
    expect(sql.trim().startsWith('SELECT tournament.tournament_year')).toBe(
      true,
    );
  });
});
