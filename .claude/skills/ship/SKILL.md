---
name: ship
description: Use when recording what shipped, opening the PR, or cleaning up after it merges, in either workflow. Green checks first, Conventional Commits, the PR rules, and the post-merge cleanup; in Strict also evidence, changelog and retrospective.
---

# Ship

Record what shipped, open the PR and clean up after it merges. The steps marked *(Strict)* run only in Strict.

1. **Green first.** `node scripts/qa.mjs --free` in Free style, `node scripts/qa.mjs <roadmap-id> --gate` in Strict ([`verify`](../verify/SKILL.md)).
2. *(Strict)* **Record per story:** roadmap `✅ Done` and the evidence folder; **per epic:** the changelog entry and the demo artifact ([`workflow-gate`](../workflow-gate/SKILL.md), step 10).
3. **Commit** with Conventional Commit subjects: they drive the version bump. Never edit `version` by hand.
4. **Open the PR.** Free style: when the user asks for one. Strict: the epic PR, once every story of the epic has passed the acceptance gate ([`workflow-gate`](../workflow-gate/SKILL.md), *The epic PR*). Never a silent push to `main`.
5. **After the merge:** the mandatory cleanup ([`workflow-gate`](../workflow-gate/SKILL.md), *Cleanup*).
6. *(Strict)* **Retrospective and lessons**, once per epic ([`workflow-gate`](../workflow-gate/SKILL.md), step 11).

**Reply:** the PR link, what it contains, and the checks that ran.
