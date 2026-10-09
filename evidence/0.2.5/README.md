# 0.2.5 — One branch and one PR per epic (BA-149)

Process-only change: no code, UI or test changes, so no E2E run and no screenshots.

| Artifact | Shows |
|---|---|
| [claude-md-branching.diff](claude-md-branching.diff) | The CLAUDE.md change: *Branching convention* rewritten for one branch, worktree and PR per epic; workflow step 3 and the Epic gate updated to match. |
| [spec-checks.txt](spec-checks.txt) | `python3 scripts/check-specs.py` passing on the branch. |

Jira: [BA-149](https://halo-powered.atlassian.net/browse/BA-149), child of epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89) (checked with `jira.sh issue BA-149`: `type: Story`, `parent: BA-89`).
Branch: `docs/BA-89-delivery-process`, the first branch named after an epic under the new rule.
