# Ids renumbered ahead of merging `main` (v0.38.0) — 2026-11-04

`main` took **ADR-0031** for BA-251 (a deterministic DMBOK readiness engine owns every score) and **ADR-0032** for BA-281 (custom LLM endpoints). The cross-session memory ADR that BA-124 (PR #61) adds, and that the BA-9 and BA-4 branches cite, was also numbered ADR-0031. It moves to **ADR-0033**, the next number free on every branch (no ref on origin or locally names ADR-0033 or higher).

| Old | New | Why |
|---|---|---|
| ADR-0031 (cross-session memory: Mastra's own memory first, behind a `LearningStore` port; Hindsight only if a three-arm eval shows it is better) | ADR-0033 | `main` took 0031 and 0032 |

## How it was applied

One script (`renumber_adr.py`, in the session scratchpad) per branch, before that branch merged `main`:

- Only lines the branch added since the branch point `ea78278` are touched. At `ea78278` no ADR-0031 existed, so every ADR-0031 on those lines is the memory ADR.
- `retrospective.md` and `evidence/` keep the id they were written with, as the 2026-10-15 renumbering did.
- The script refuses to write unless the count of lines matches the count reviewed in a dry run.
- The ADR's `Date` line and the plan's "The ADR number" note now say it was numbered ADR-0031 until 2026-11-04.

| Branch | PR | Commit | Lines | Files |
|---|---|---|---|---|
| `docs/BA-123-knowledge-store-research` | #60 | `496fb93` | 2 | `changelog.md`, `docs/research/BA-4.md` |
| `docs/BA-124-knowledge-store-execution-plan` | #61 | `846295f` | 13 | `changelog.md`, `docs/plans/BA-4.md`, `docs/plans/BA-4-technical.md`, `docs/research/BA-4.md`, `roadmap.md`, `specs/epics/BA-4/spec.md`, `specs/system/architecture.md` |
| `feat/BA-9-golden-dataset-evals` | #81 | `36fd26f` | 14 | `backend/src/mastra/evals/loop/eval-diff.ts`, `backend/src/modules/memory/learning-store.port.ts`, `changelog.md`, `roadmap.md`, `specs/capabilities/agents-evals/spec.md`, `specs/system/agents.md` (and the epic spec's ADR-0015 re-check) |
| `feat/BA-4-knowledge-store` | none | `38b1297` | 38 | 16 files: the 13 lines of #61 with the same edit, plus BA-81's specs, code comments and `frontend/e2e/memory.spec.ts` |

The 13 lines #61 shares with BA-4, and the 2 that #60 shares with #61, got the identical edit, so merging those branches into each other does not conflict on them. `backend/src/modules/memory/learning-store.port.ts` is byte-identical on BA-9 and BA-4 again.

Kept as written (by the rule above): the 2026-10-29 retrospective heading "1.3.5 and 1.3.6 closed: research and plan merged, ADR-0031 (BA-123, BA-124)", `evidence/1.3.6/source.md`, and BA-4's `evidence/1.3.7/`.

## Checked and not renumbered

- **ADR-0015** (BA-9's golden dataset ADR): `main` has ADR-0001 to ADR-0012 and ADR-0018 to ADR-0032, so it is still free (recorded in `specs/epics/BA-9/spec.md`).
- **Rule numbers** (every capability spec), **roadmap ids** (`main` 1.16.x and 1.17.x, BA-9 1.1.x) and **evidence folders**: no clash between `main` and BA-9. After the merge no capability spec defines a rule number twice.
- **Still open on `feat/BA-4-knowledge-store`** (not merged with `main` in this change): `main` added endpoints **108 to 110** to `api.md` and section **3.15** to `data-model.md`, and BA-81 uses the same numbers for the memory settings and signals. Renumber them on that branch before it merges `main`.
