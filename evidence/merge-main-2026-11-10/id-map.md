# Ids renumbered ahead of merging `main` (v0.44.0) — 2026-11-10

`main` took **ADR-0033** for BA-323 (tool progress, readiness profiling) and **ADR-0034 to ADR-0036** for BA-320 (the v2 workflow, the Data Readiness drill-down, Knowledge as each dataset's ontology). Open PR #91 (BA-159, GitHub Copilot) claims **ADR-0037**. `main` also took **agents-evals R107** for Questions to Insights v2.

| Old | New | Why |
|---|---|---|
| ADR-0033 (cross-session memory: Mastra's own memory first, behind a `LearningStore` port; Hindsight only if a three-arm eval shows it is better; ADR-0031 until 2026-11-04) | ADR-0038 | `main` took 0033 to 0036; PR #91 claims 0037. No ref on origin or locally names ADR-0038 or higher. |
| agents-evals R107 on BA-9 (the assistant's eval sets are read from question bank files) | R247 | `main`'s R107 is Questions to Insights v2, cited by its frontend and E2E. BA-9's rules run to R246; no branch on origin defines an agents-evals rule above it. |

## How it was applied

One script (`renumber.py`, in the session scratchpad) per branch and id, before that branch merged `main`:

- Every occurrence on the branch tip, since `main` at `b2b44558` (the last merge) named neither id: ADR-0033 and agents-evals R107 there are all this work's.
- `retrospective.md` and `evidence/` keep the ids they were written with, and so do the changelog bullets of 2026-11-04 that record the previous renumbering (their subject is that number).
- The ADR's `Date` line and the plan's "The ADR number" note now give both old numbers.
- Two R107 ranges were written out: "R107-R111 and R134" is "R108-R111, R134 and R247", "R107 and R108" is "R247 and R108".
- The script refuses to write unless the count of lines matches the count reviewed in a dry run.

| Branch | PR | Commit | Id | Lines | Files |
|---|---|---|---|---|---|
| `docs/BA-123-knowledge-store-research` | #60 | `e96e2531` | ADR | 2 | `changelog.md`, `docs/research/BA-4.md` |
| `docs/BA-124-knowledge-store-execution-plan` | #61 | `d706cc46` | ADR | 13, and the ADR's Date line | `changelog.md`, `docs/plans/BA-4.md`, `docs/plans/BA-4-technical.md`, `docs/research/BA-4.md`, `roadmap.md`, `specs/epics/BA-4/spec.md`, `specs/system/architecture.md` |
| `feat/BA-9-golden-dataset-evals` | #81 | `599d5f19` | ADR | 14 | `backend/src/mastra/evals/loop/eval-diff.ts`, `backend/src/modules/memory/learning-store.port.ts`, `changelog.md`, `roadmap.md`, `specs/capabilities/agents-evals/spec.md`, `specs/system/agents.md` |
| `feat/BA-9-golden-dataset-evals` | #81 | `599d5f19` | R107 | 15 | `backend/src/mastra/evals/checks/check.ts`, `changelog.md`, `docs/evals/domains/README.md`, `frontend/e2e/agents.spec.ts`, `specs/capabilities/agents-evals/spec.md`, `specs/system/agents.md`, `specs/system/data-model.md` |

The two lines #60 shares with #61 got the identical edit, so the merge of #60 into #61 does not conflict on them.

## Not renumbered

- **`feat/BA-4-knowledge-store`** (no PR) still names ADR-0033 on the lines it shares with #61, and its `learning-store.port.ts` now differs from BA-9's by that comment. Give it the same edit before it merges #61 or `main`.
- **ADR-0015** (BA-9's golden dataset ADR): `main` has no ADR-0013 to ADR-0017, so it is still free.
- **Roadmap ids** (`main` 0.4.x, 1.20.x, 1.21.x; BA-9 1.1.x), **evidence folders**, and the other capability specs' rule numbers: no clash.
