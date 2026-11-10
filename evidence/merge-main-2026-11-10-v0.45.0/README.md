# Merge of `main` (v0.45.0) into the BA-9, BA-123 and BA-124 branches — 2026-11-10

`origin/main` at `89bdf5ce` (v0.45.0, 6 commits since the merge of v0.44.0 earlier the same day) merged into the three open PRs. v0.45.0 is BA-320's visuals library on the Context page (roadmap 1.21.12, PR #92).

| PR | Branch | Merge | Conflicted files |
|---|---|---|---|
| #60 | `docs/BA-123-knowledge-store-research` | `ac8231dd` (of `main`) | 0 |
| #61 | `docs/BA-124-knowledge-store-execution-plan` | `31ad818f` (of the updated #60, so `main` comes through it; #61 stays stacked on #60) | 0 |
| #81 | `feat/BA-9-golden-dataset-evals` | `386fe55d` (of `main`) | 0 |

## Ids

v0.45.0 adds api.md section 2.8b and endpoints 49e to 49h, data-model.md 3.9b and ui.md 4.8c. None of the three branches adds any of them. The merged api.md repeats endpoint numbers 53 to 57 and ui.md repeats section 4.12; both repeats are on `main` already and on the branch before the merge, so this merge leaves them as they are.

## What reaches the assistant

Nothing. v0.45.0 adds the `visuals` backend module and the Context page's library; no agent, session, context block or eval run reads it ([visuals-library](../../specs/capabilities/visuals-library/spec.md) R15). The eval sets and checks are unchanged, so no eval was run.

## Checks

[checks.txt](checks.txt): backend 194 suites, 3336 tests; frontend 567 of 567; production build 1.00 MB initial, within the 1.1 MB error budget; `check-specs` on all three branches. E2E was not run: no file that BA-9's E2E specs cover changed, and starting the app and Postgres from a worktree needs the user's go-ahead.

## Once PR #91 merges

PR #91 (BA-159, GitHub Copilot as an LLM provider) is open. A simulated merge of `main` plus #91 into each branch shows two conflicts; [pr91-preview.md](pr91-preview.md) has the resolution of each.
