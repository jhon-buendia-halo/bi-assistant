---
name: workflow-ship
description: Use at workflow step 10 and after: the changelog entry, the evidence folder, the roadmap ✅ Done, the epic PR (title, description, review) and the mandatory worktree and branch cleanup once the PR merges.
---

# Step 10 — Changelog, evidence, PR and cleanup

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core (the mandatory first action, the step list, the fast loop and acceptance gate, the hard gates). Load this skill before the step starts.

## The step

10. **Update changelog with evidence** — only after step 9 is green, add a dated entry to [changelog.md](../../../changelog.md) and capture the evidence under [evidence/](../../../evidence/) (E2E summary, screenshots of the running app, exports). Mark the roadmap entry `✅ Done`. Confirm the specs touched in step 5 describe what actually shipped, and fix them in the same PR if not. See **Logging convention** and **Evidence convention**.

## Logging convention — record every change

**Every meaningful change must be logged in [changelog.md](../../../changelog.md), as the *final* implementation step (step 10).** Reverse-chronological dated sections (`## YYYY-MM-DD`) with categorized subsections (`### Added`, `### Changed`, `### Removed`, `### Cut`, `### Fixed`). Bundle related edits from one session into one bullet; reference the affected file or roadmap feature ID. Never rewrite past entries — fix forward with a new dated entry. Roadmap status transitions get a matching changelog entry at the same time. **Every entry links to its evidence.**

## Evidence convention — every shipped change is independently verifiable

**Every change logged in [changelog.md](../../../changelog.md) must be backed by artifacts in [evidence/](../../../evidence/), linked from the entry**, so the user can confirm the work without re-running anything.

Layout: one folder per shipped change, keyed by roadmap feature ID — `evidence/<feature-id>/` (e.g. `evidence/1.2.3/`). Store:

- **E2E results** — the `npm run test:e2e` summary (`e2e-results.txt`) and/or the Playwright HTML report / trace (`frontend/playwright-report/`, `frontend/test-results/`) for the specs exercising the change, naming the spec files so evidence maps back to Gherkin scenarios.
- **Screenshots** — of the running web app (Playwright `page.screenshot` in the app fixture works; desktop screenshots only when the user asked for a desktop run), named for what they show (`visual-panel-revert.png`, not `screenshot1.png`), capturing the actual claimed state.
- **Other artifacts** — exported visuals (`index.html`, `answer.md`, `data.json`), sample API responses, diagnostics reports, short recordings.

Link with a relative path: `Evidence: [evidence/1.2.3/](../../../evidence/1.2.3/)`. Keep artifacts lightweight. If a change genuinely produces no observable artifact, say so explicitly — *"Evidence: existing E2E suite green, no UI change"*.

## The epic PR and cleanup

  - The PR title names the epic (`feat(BA-111): …` or `feat: … (BA-111)`).
  - The PR description links the epic and lists every story and bug it includes, each with its Jira link and roadmap feature ID.
  - Open the PR when the epic's stories are done, not one PR per story.
- **Review:** a PR into `main` needs one approving review. Only the repo owner (the only admin) can merge without one, through the ruleset bypass; nobody can push straight to `main`. Details: *Branch rulesets on `main`* in [delivery.md](../../../specs/system/delivery.md).
- **Cleanup — mandatory once the PR merges:** delete the epic's worktree folder and its branch. From the main checkout:
  ```bash
  git worktree remove .claude/worktrees/<EPIC-ID>-<short-description>   # deletes the folder
  git worktree prune
  git branch -d <type>/<EPIC-ID>-<short-description>
  git push origin --delete <type>/<EPIC-ID>-<short-description>   # if GitHub didn't delete it on merge
  ```
  Then confirm with `git worktree list` that it is gone and that `.claude/worktrees/<EPIC-ID>-…` no longer exists on disk. `git worktree remove` refuses when the folder holds uncommitted or untracked files: look at them first, and never discard work that isn't in the merged PR without asking the user. Git-ignored local files (`.env`, `.env.*.local`, `node_modules/`, `dist/`) go with the folder; copy any you still need (such as `.env.llm.local`) before removing. Also tear down the worktree's isolated resources (an infra-mcp namespace, a `docker compose -p` stack, a temp data dir).
