# BA-305 — US Health testing data

- **Jira:** [BA-305](https://halo-powered.atlassian.net/browse/BA-305) · **Roadmap:** Milestone 1.19 · **Status:** Confirmed (by the user on 2026-11-04). Data model design approved by the user on 2026-11-04 ([review page](https://claude.ai/artifact/4msSW6rkyot8Ai8Zvdr9yc)).

## Goal

A fresh install can load a synthetic Mercer US Health & Benefits world from Settings → Testing Data in one click. The Assistant, the Data Readiness Agent and the US Health showcase agents (Benchmarking, Survey, LAD COE, Strategy, epic [BA-233](../BA-233/spec.md)) then have one coherent dataset to answer from: the consulting firm and its clients, benefit plans and renewals, members and claims, market benchmarks, employee surveys, life/absence/disability, and strategy.

## Scope

- **A fifth sample fixture `us-health`**, "US Health", in the Testing Data catalogue. It is seedable from a bundled gzipped seed `004_us_health.sql.gz` that creates schema `us_health` in database `us_health` on the sample server (same default connection as the other PostgreSQL samples). It registers datasource "US Health PostgreSQL" and dataset "US Health".
- **The model:** 41 tables and 4 reporting views (45 required entities) in 8 domains, as approved on the review page:
  - firm and clients: `offices`, `service_lines`, `colleagues`, `clients`, `engagements`, `revenue`, `deliverables`
  - benefit programs: `carriers`, `plans`, `plan_provisions`, `plan_rates`, `renewals`, `stop_loss_contracts`
  - members and claims: `employees`, `members`, `enrollments`, `medical_claims`, `rx_claims`
  - benchmarking: `benchmark_sources`, `peer_groups`, `benchmark_measures`, `benchmark_values`
  - employee surveys: `surveys`, `survey_questions`, `survey_respondents`, `survey_responses`, `survey_comments`, `survey_norms`
  - life, absence and disability: `lad_programs`, `lad_experience`, `disability_claims`, `leave_cases`, `state_leave_laws`, `client_leave_policies`
  - strategy: `client_goals`, `trend_assumptions`, `strategy_options`, `roadmap_items`, `point_solutions`, `client_point_solutions`
  - data operations: `data_feeds`
  - views: `v_monthly_cost`, `v_large_claimants`, `v_lad_loss_ratio`, `v_client_revenue`
- **Shape:** analytics tables with typed columns and readable text keys. Every foreign key is declared, and every table and column carries a comment with its grain and meaning.
- **Data:** 60 fictional clients over plan years 2023–2027, with census and claims for 8 "deep-data" clients, about 0.6 M rows in total. The dataset's "today" is fixed at 2026-10-31.
  - The national benchmark means follow Mercer's published National Survey headlines. Peer-group splits and everything else are synthetic.
  - The benchmark source is labelled "Mercer National Survey (synthetic)".
  - Benefits administration appears only as a third-party vendor.
- **Planted signals:** market-following cost trend, higher Rx trend with GLP-1 weight-loss coverage, HDHP cost vs satisfaction, a stop-loss-piercing claimant, an LTD loss ratio above 100%, a leave-policy shortfall against state law, and regional cost differences.
- **Planted defects** (about 0.5% of rows): a late feed, duplicate claims, claims outside an enrollment, impossible dates, missing dependent birth years, and a survey subgroup below n = 10.
- **A deterministic generator**, `scripts/generate-us-health-seed.py`: standard library only, fixed RNG seed, gzip `mtime=0`, so the committed seed reproduces byte for byte. Its tests check the planted signals and defects.

## Out of scope

- Letting the showcase agents chat, or giving them tools, datasets, skills or evals (they stay as in BA-233).
- Eval sets that use the new fixture.
- A REST variant of the fixture.
- Changes to the Intellify, World Cup or Formula 1 fixtures, or to how the loader works.
- Real Mercer data of any kind: every client, person, carrier and value outside the published national headlines is invented.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-306](https://halo-powered.atlassian.net/browse/BA-306) | US Health sample as a Testing Data fixture | 1.19.1 |

## Specs touched

- [capabilities/testing-data](../../capabilities/testing-data/spec.md): R2 (the fifth fixture, its row and description), R3 (database `us_health`), R4 (the seed file), the panel order, and the Testing Data Feature's scenarios that list the fixtures.
- [system/data-model.md](../../system/data-model.md): the sample databases on the sample server.
- [system/api.md](../../system/api.md): the fixture ids accepted by the testing-data endpoints, where they are enumerated.
- [system/delivery.md](../../system/delivery.md): the generator script, if scripts are listed there.
- [product/glossary.md](../../product/glossary.md): "US Health sample", only if the glossary lists the samples.

No ADR: a fixture is one seed file plus one catalogue entry (testing-data R1), with no new container, data flow or persisted shape.

## Acceptance

- Settings → Testing Data lists "US Health" with `0/45 entities`. Loading it against the sample server creates the `us_health` database when it is missing, seeds it, and reports `45/45 entities`.
- The "US Health" dataset carries sample values and the declared join references.
- Running the generator again reproduces the committed seed byte for byte.
- The generator's tests confirm every planted signal and defect listed in Scope.
- The catalogue test confirms the seed exposes every required entity.
- The Testing Data Playwright scenarios pass on the web target. `python3 scripts/check-specs.py`, backend unit tests, lint and builds are green.
- No eval gate: no agent's prompt, tools, skills or context changes.

## Dependencies, risks and open questions

- **Depends on** the Testing Data catalogue and loader (testing-data R1–R17) and the sample PostgreSQL server (compose or embedded Postgres on 55432).
- **Risk:** seed size. About 0.6 M rows is roughly 10–15 MB gzipped; loading replays it in batches of 50 statements. If the load takes more than about a minute, cut the claims volume rather than change the loader.
- **Risk:** the name-matching caveat of testing-data R19 (BA-96) applies to "US Health PostgreSQL" as to the other samples.
- **Open question:** none at confirmation time. Volumes, benchmark labelling and the benefits-administration treatment were settled on the review page.
