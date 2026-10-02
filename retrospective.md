# Retrospective

Lessons from each completed change, newest first. **Read this file before starting any task.** See *Retrospective convention* in [CLAUDE.md](CLAUDE.md).

Entry template:

```
## YYYY-MM-DD — <roadmap feature ID> <short title>

### What went well
### What went wrong
### What to do differently
```

---

## 2026-10-01 — 0.2.1 (BA-84) Delivery workflow shipped

### What went well
- Drawing the C4 diagrams from the code, not from CLAUDE.md, surfaced nine places where CLAUDE.md had drifted, including a real bug (renderer ignores `BACKEND_PORT`, now roadmap 0.1.1). Diagramming doubled as an audit.
- Fanning out the independent pieces (diagrams, Gherkin steps, wireframe tokens) to parallel subagents finished them in one wait. Spot-checking each subagent's claims against the code before editing CLAUDE.md caught no errors, but it made the corrections safe to trust.
- Importing the Jira beta plan with a 1:1 epic→milestone, story→feature mapping kept the roadmap traceable, and Jira's gaps (no acceptance criteria, no fix version) were flagged instead of silently filled in.

### What went wrong
- The wireframe convention was ported and given supporting files (`_tokens.css`, `_example.html`), then removed by the user. Effort went into a convention nobody had confirmed they wanted.
- The branching rule was introduced mid-change, so this branch was renamed after the fact and the Jira story (BA-84) was created retroactively instead of first.
- Opening the PR stalled: `gh` wasn't installed, an auto-mode permission check blocked `gh pr create`, and the user had to run the commands by hand, including an unnecessary `gh auth login` detour.
- The worktree had no `.env`, so the Jira skill failed until it was pointed at the main checkout's config.

### What to do differently
- When porting a harness from another project, list each convention and ask which to adopt *before* building supporting files for any of them.
- Create the Jira issue and the `<type>/<BA-ID>-<short-description>` branch before the first edit, even for process-only work.
- Before promising to open a PR, check `command -v gh && gh auth status`. If PR creation is blocked, give the user the exact commands at once, plus the compare URL.
- In a worktree, run the Jira skill with `JIRA_CONFIG_FILE=<main checkout>/.env`, or copy the `JIRA_*` lines into the worktree's `.env`.

## 2026-10-01 — Adopt delivery workflow harness

### What went well
- The harness was ported from another project and adapted to this repo's real layout (Playwright-on-Electron in `frontend/e2e/`, Jest in `backend/`, phase plans in `docs/plans/`) instead of copied verbatim.

### What went wrong
- `gherkin.md` was seeded from existing E2E test titles only; the Given/When/Then steps are not written yet, so it is not yet a full spec.
- The phase plans in `docs/plans/` have unknown completion status, so they were parked in the roadmap Backlog rather than sequenced.

### What to do differently
- The first time a change touches a seeded Gherkin feature, write that feature's full Given/When/Then steps as part of step 5.
- Before starting work from a `docs/plans/` phase, confirm with the user which items already shipped, then promote the remainder into a milestone.
