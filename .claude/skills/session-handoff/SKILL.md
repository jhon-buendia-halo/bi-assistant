---
name: session-handoff
description: Use at the start of every session (own worktree, up to date with origin/main), when pausing work so another session can pick it up (.context/handoff.md), or when picking up a previous session's work.
---

# Session handoff

Start a session, pause work so another session can pick it up, or pick up work a previous session left.

**Start** (mandatory, every session, before the first change)

1. **Its own worktree.** Work in a git worktree of its own, never in the main checkout: `git worktree list` shows where the session is; when it is the main checkout, create one (`git worktree add ../<name> -b <branch> origin/main`, or let Conductor create the workspace), then run `node scripts/bootstrap.mjs` there once.
2. **Up to date with `main`.** `git fetch origin`. A new branch starts from `origin/main`. An existing branch merges `origin/main` in (`git merge origin/main`); when the merge conflicts, stop and ask the user. `git log --oneline HEAD..origin/main` must then be empty.
3. Say in one line the worktree, the branch and that it holds `origin/main` at `<short sha>`.

**Pause**

4. Commit what is green; never leave a finished story uncommitted ([lessons.md](../../../lessons.md), *Process and hand-over*).
5. Before starting a new session (one lead session per epic wave), write `.context/handoff.md` (git-ignored scratch, under 30 lines) and start the new session from it:

   ```
   # Handoff — <EPIC-ID>, <date>
   Branch / worktree: <branch>, <path>
   Done: <story ids merged, wave checks green>
   In flight: <story ids, unit branches, who owns them>
   Next: <the next wave or gate step, with the exact command>
   Open questions for the user: <one line each, with the recommendation>
   Traps: <anything the next session would rediscover>
   ```

**Pick up**

6. Read `lessons.md`, then `.context/workflow-mode`, `.context/brand` and `.context/handoff.md`.
7. On "keep going" with no context, check for another live session on the epic (commits in the last minutes, files changing under you) and ask who owns the work ([lessons.md](../../../lessons.md), *Subagents and parallel units*).
8. `git fetch`, then merge `origin/main` into the epic branch at the start of the next story (step 2 above, again) ([lessons.md](../../../lessons.md), *Git and worktrees*).
9. Continue at the handoff's *Next* line.

**Reply:** at the start, the worktree, the branch and the `origin/main` commit it holds; when picking up, where the work stands, the next step with its command, and the open questions for the user.
