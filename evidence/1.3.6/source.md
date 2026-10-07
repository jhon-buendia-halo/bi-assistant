# Evidence for 1.3.6 — Knowledge Store — Execution plan (BA-124), partial

- **Deliverables in this change:** `docs/plans/BA-4.md` (functional plan) and `docs/plans/BA-4-technical.md` (technical plan).
- **Source:** Part 3 (execution) and Part 4 (how it should work after) of the *Knowledge Store Ontology* artifact, https://claude.ai/artifact/Q4DtSwSqv7yi8VBqjrn9BN, version 3 of 2026-10-07. The research half is `docs/research/BA-4.md` (1.3.5).
- **Written against:** `main` at commit 3012e34 (v0.24.2), checked 2026-10-07. Branch-only work (the Data Model DSL on `origin/ba-2-epic-kickoff`; the ranking, the categorised suite and the harness on local `feat/engine-eval-loop`; the feedback learner on local `feat/business-expert-learning`; Hindsight memory on local `feat/hindsight-memory`) is listed as a prerequisite with the merge-or-rebuild decision open. No branch was merged.
- **Still open for BA-124:** the epic spec `specs/epics/BA-4/spec.md` set to `Status: Confirmed` by the user; the ADR "knowledge as code in packs" with a fresh number; the roadmap texts of 1.3.2 to 1.3.4 aligned with the plan; the BA-78 decision.
- **Checks:** `check-specs.txt` (spec check) and `link-check.txt` (relative links, fences, tables, Mermaid labels in the two files). No code or UI change: the E2E suite was not run.
