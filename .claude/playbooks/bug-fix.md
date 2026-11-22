### Bug fix

A defect in behaviour that already shipped. Each step below fills the workflow step named in brackets. In Strict it is an S change: the story goes under an open epic or Milestone 1.7 *Bug Fixes* ([`workflow-strict`](../skills/workflow-strict/SKILL.md), *Change sizes*).

1. **[Understand]** Reproduce it on the surface where it was seen. Capture one failing case's real request or traffic (a stub dump, a logging proxy) before guessing a cause ([lessons.md](../../lessons.md), *Process and hand-over*).
2. **[Understand]** When a test is what fails, count its flake rate on unchanged code first: run it alone 5–10 times ([lessons.md](../../lessons.md)).
3. **[Clarify]** State the root cause with its evidence. Ask the user only when the fix changes behaviour they would see.
4. **[Implement]** Write the failing test first when a cheap one exists, then the smallest fix that makes it pass, with the code rules in [`workflow-implement`](../skills/workflow-implement/SKILL.md).
5. **[Checks]** The step-1 reproduction now passes, then [`verify`](../skills/verify/SKILL.md).

**Reply:** what was broken, the root cause, the fix, and the reproduction's output before and after.
