# Merge of `main` (v0.36.0) into the BA-9 branch — 2026-10-16

`origin/main` at `ea78278` (16 commits since the last merge, `48d7d23`: the US Health demo BA-233/BA-235, the CLAUDE.md split into skills BA-236, the Jira MCP tool BA-237) merged into `feat/BA-9-golden-dataset-evals`.

## Ids renumbered first (commit `85b6f40`)

main took agents-evals **R106** for its showcase agents, the first id of the branch's own rules. Before the merge the branch's rules moved up by one, only on lines the branch added: **R106–R207 → R107–R208** (298 lines in 79 files). Changelog, retrospective and evidence entries of BA-9 written before 2026-10-16 keep the old ids: read them one lower (R146 then is R147 now). `docs/research/BA-9.md` keeps BA-2's own "Rule R106". No other id collided (rules, sections, endpoint numbers, ADRs and roadmap features compared file by file).

## Conflicts and resolution

| File | Resolution |
|---|---|
| `specs/capabilities/agents-evals/spec.md` | main's *Showcase agents* section (R106) placed before the branch's *Question bank files* section (R107 on); in the references, the branch's question-bank bullet and main's "eleven registered agents" line. |
| `agent-detail.html` | The branch's Evals tab (judge select, categories, run summary); main's only change there was a prettier reformat. main's showcase reason in the header merged cleanly. The file is prettier-clean. |
| `specs/product/glossary.md` | The branch's *Not scored* entry and main's new *Official agent* text. |
| `retrospective.md` | Both sides, newest first. |

main deleted `.claude/skills/jira/scripts/jira.sh`; the branch mentions it only in the plan's historical record (`docs/plans/BA-9.md`).

## Verification

| Check | Result | File |
|---|---|---|
| Backend `npx jest` | 115 suites, 1773 tests passed | [backend-checks.txt](backend-checks.txt) |
| Backend type check (`tsc -p tsconfig.build.json --noEmit`) | passed | [backend-checks.txt](backend-checks.txt) |
| Frontend `ng build` | passed | [frontend-checks.txt](frontend-checks.txt) |
| Frontend `ng test` | 344 of 345 passed. `PromptEditor inserts the chosen link` failed on a headless selection error (`collapseToEnd`), code identical to `main`; run alone it failed 1 of 3 times, the flake recorded on 2026-10-15 | [frontend-checks.txt](frontend-checks.txt) |
| `python3 scripts/check-specs.py` | all checks passed | — |
