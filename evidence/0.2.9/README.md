# 0.2.9 — Changelog and retrospective fragments (BA-173)

Process and CI change only: no application code, so no E2E run; desktop not run.

| Artifact | Shows |
|---|---|
| [collect-run.txt](collect-run.txt) | A real `python3 scripts/fragments.py collect --version 0.30.0 --date 2026-10-12` on this branch: the `## 2026-10-12 — v0.30.0` section with the BA-172 and BA-173 entries at the top of `changelog.md`, both retrospective entries under the `---` line, and only the READMEs left in the two folders. The files were restored afterwards; the merge runs the same command for real. |
| [check-specs-results.txt](check-specs-results.txt) | `check-specs.py --base origin/main` passing on this branch, and failing in three cases: a branch that adds no fragments, a direct edit to `changelog.md`, and malformed fragments (wrong name/story, roadmap ID, type, evidence path, link, missing retrospective subsections). |
| [mod-tests.txt](mod-tests.txt) | `claude plugin test` for `workflow-steps` 0.2.1: 17 pass, including fragment paths mapping to steps 10 and 11. |

Changed: [scripts/fragments.py](../../scripts/fragments.py), check 10 in [scripts/check-specs.py](../../scripts/check-specs.py), `.github/workflows/version-on-merge.yml` and `spec-checks.yml`, [changelog.d/](../../changelog.d/README.md), [retrospective.d/](../../retrospective.d/README.md), *Logging* and *Retrospective* conventions and steps 10–11 in [CLAUDE.md](../../CLAUDE.md), [specs/system/delivery.md](../../specs/system/delivery.md), the BA-89 epic spec, and the `workflow-steps` mod rules.

Branch: `docs/BA-89-delivery-process`.
