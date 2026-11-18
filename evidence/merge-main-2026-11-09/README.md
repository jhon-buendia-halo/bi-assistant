# Merge of `main` (v0.40.0) into the BA-9, BA-123 and BA-124 branches — 2026-11-09

`origin/main` at `b2b44558` (v0.40.0, 20 commits since the merge of 2026-11-04: BA-303 and BA-304, Windows-only installer and product page, PRs #84 and #85; BA-305 and BA-306, the US Health Testing Data sample, PR #86) merged into the three open PRs. `main` took no ADR, roadmap id, rule number or evidence folder that these branches use.

| PR | Branch | Merge | Conflicted files |
|---|---|---|---|
| #60 | `docs/BA-123-knowledge-store-research` | `b3a494af` (of `main`) | 1: `changelog.md` |
| #61 | `docs/BA-124-knowledge-store-execution-plan` | `e6228590` (of the updated #60, so `main` comes through it; #61 stays stacked on #60) | 0 |
| #81 | `feat/BA-9-golden-dataset-evals` | `5bacadbc` (of `main`) | 5 |

`feat/BA-4-knowledge-store` (no PR) was not merged with `main`.

## What conflicted and how it was resolved

| PR | Files | Resolution |
|---|---|---|
| #60, #81 | `changelog.md` | Both sides added entries under 2026-11-04: one section, `main`'s subsections in `main`'s order, the branch's bullets after `main`'s under the same heading. |
| #81 | `retrospective.md` | Both sides added 2026-11-04 entries: `main`'s first, then the branch's. |
| #81 | `testing-data/fixtures/registry.ts` | Both added sample definitions in the same place (the base had none there): `main`'s `US_HEALTH`, then BA-9's synthetic domain samples. The panel list and the service test's expected ids merged without a conflict, in the same order. |
| #81 | `specs/capabilities/testing-data/spec.md` | The R2 table: `main`'s `us-health` row, then BA-9's `world-cup-rest` row (BA-9's has World Cup's 10 tables and the table's indentation). R2's descriptions, R3's databases and R4's seed files: both sides' additions, at different places in each rule. The Gherkin step that lists the samples names US Health, then BA-9's step for the synthetic ones. The sources comment: both sides' files. |
| #81 | `frontend/e2e/testing-data.spec.ts` | `main`'s `us-health` (45 tables) and BA-9's `world-cup-rest` (10). |

### What merged without a conflict and still needed a change (#81)

- **`specs/system/data-model.md` 4.10** lists the seed files of `backend/src/modules/testing-data/fixtures/`. It now lists `004_us_health.sql.gz` (12 MB) and says who writes it, and names `004_health_insurance.sql` in full where it said `004`, because two seed files now start with `004_`. No code reads the number, so the files keep their names.

## Verification

| Check | Result | File |
|---|---|---|
| Backend build type-check (`tsc -p tsconfig.build.json --noEmit`) | passed | [checks.txt](checks.txt) |
| Backend `npx jest` | 180 suites, 3088 tests passed (3083 before the merge; the rest are `main`'s US Health tests) | [checks.txt](checks.txt) |
| eslint and Prettier on the resolved code files | 0 problems, Prettier-clean | [checks.txt](checks.txt) |
| E2E compile (`tsc -p e2e/tsconfig.json`, `playwright test --list`) | passed, 392 tests in 26 files | [checks.txt](checks.txt) |
| `python3 scripts/check-specs.py` | all checks passed on #60, #61 and #81 | [checks.txt](checks.txt) |
| E2E, web: `testing-data.spec.ts` | 4 of 4 passed, `main`'s US Health load among them | [e2e-results.txt](e2e-results.txt) |
| `git merge-tree` of each branch with `origin/main` (and #61 with #60) after the merges | 0 conflicted files | — |

## Not run

- **Desktop**: not run (web target only).
- **Model evals**: not run. `main`'s changes since v0.38.0 touch no agent, prompt, tool or eval set; the PR's eval gate on Claude is still pending ([merge-main-2026-11-04](../merge-main-2026-11-04/README.md)).
- **Rest of the E2E suite**: only the spec the merge touches was run.
