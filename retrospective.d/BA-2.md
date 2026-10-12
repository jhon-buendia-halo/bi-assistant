---
story: BA-2
roadmap: 1.2.4
title: Port onto main, and the merge with local-mode sign-in (2.1.7)
---
### What went well
- Renumbering before merging main (ADR-0012/0013 → 0013/0014, M13 → M14, endpoints 91-109 → 94-112) on the BA-2 branch alone, where each id could only mean BA-2's item, made the renumbering safe; the endpoint references came from a reviewed list whose every edit had to match an exact count, and that guard caught 6 `404 as 92` references and 3 others a first scan had missed.
- Resolving the conflicts with one rule (2.1.7's "both modes" wording, BA-2's data model content) kept 13 spec hunks consistent; the follow-up sweep of BA-2's own lines for "local mode" found the rules the merge had silently made false.
- Comparing every failing check with the same check on main (lint per file, `app.e2e`, the app.spec keyboard-resize case) separated inherited failures from new ones in minutes.

### What went wrong
- BA-2 sat unmerged and unpushed while 2.1.7 shipped ADR-0012, M13 and endpoints 91-93 to main, the same numbers BA-2 had taken; a second epic in flight claimed them without either side noticing.
- 2.1.7 changed what local mode means (signed-in personas, roles enforced, ownerId everywhere), which turned BA-2's "org server mode only, local mode unchanged" rules, two unit tests and its whole API-level E2E (401 on every call) wrong at once. None of it showed as a conflict.
- The epic reached the merge with steps 9-11 undone (roadmap still In progress, no changelog, an evidence placeholder), so finishing it fell to the merge.

### What to do differently
- Push an epic branch the day it gets its first commit, and before taking an ADR, migration or endpoint number, check main and every pushed branch (`git grep -E 'ADR-00[0-9]+|\| M[0-9]+ ' origin/<branch> -- specs/system/`); renumber on the later branch alone, before merging, from a reviewed list.
- When main changes a mode or a role model while an epic is open, grep the epic's own lines for that mode (`git diff <base>..HEAD | grep -i 'local mode'`) right after merging main, and re-run its API-level E2E before resolving anything else.
- Don't leave an epic "In progress" past its last code commit: finish steps 9-11 on the branch, or say in the roadmap why not.
