# Conflicts expected when PR #91 merges — simulated 2026-11-10

Simulation, read-only: `git merge-tree --write-tree origin/main origin/feat/BA-159-github-copilot-provider` (head `c4e3e8d6`), committed with `git commit-tree` to an unreferenced commit, then `git merge-tree --write-tree <branch> <that commit>` for each branch. #91 itself was not merged into any branch: it is not reviewed, and its commits would enter the three PRs.

| PR | Result | File |
|---|---|---|
| #60 | clean | — |
| #61 | 1 conflict | `specs/system/architecture.md` |
| #81 | 1 conflict | `specs/system/agents.md` |

## #61: `specs/system/architecture.md`

#91 adds ADR-0037 (GitHub Copilot through the official Copilot SDK) and #61 adds ADR-0038 (cross-session memory) at the same place, after ADR-0036. Resolution: keep both, ADR-0037 first, then ADR-0038. No renumber: ADR-0038 was chosen on 2026-11-10 because #91 claimed ADR-0037.

## #81: `specs/system/agents.md`, section 8 (command-line runs)

#91 adds one sentence to the paragraph that starts "The model is the saved LLM configuration (1.3)": "`EVAL_LLM_PROVIDER` takes only `custom`; GitHub Copilot is reached through the saved settings (a saved `copilot` configuration runs the evals on the machine's Copilot seat)." BA-9 rewrote the lines around it (the `EVAL_SET` errors, the repeats, split and memory settings) and removed the golden-set harness bullet with `backend/eval/`. Resolution: BA-9's side, with #91's sentence inserted after "`EVAL_LLM_API_KEY` is optional (unset → no credential)." in BA-9's copy of that paragraph.

After either resolution: `check-specs`, and for #81 the full backend suite, `tsc -p tsconfig.json --noEmit` and the production `ng build`, since #91 adds a backend dependency (`@github/copilot-sdk`) that a clean merge of the code does not prove.
