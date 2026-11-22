### Session handoff

Pause work so another session can pick it up, or pick up work a previous session left.

**Pause**

1. Commit what is green; never leave a finished story uncommitted ([lessons.md](../../lessons.md), *Process and hand-over*).
2. Write `.context/handoff.md` from the template in [`workflow-gate`](../skills/workflow-gate/SKILL.md), *Session handoff*, before starting a new session.

**Pick up**

3. Read `lessons.md`, then `.context/workflow-mode`, `.context/brand` and `.context/handoff.md`.
4. On "keep going" with no context, check for another live session on the epic (commits in the last minutes, files changing under you) and ask who owns the work ([lessons.md](../../lessons.md), *Subagents and parallel units*).
5. `git fetch`, then merge `origin/main` into the epic branch at the start of the next story ([lessons.md](../../lessons.md), *Git and worktrees*).
6. Continue at the handoff's *Next* line.

**Reply:** where the work stands, the next step with its command, and the open questions for the user.
