---
name: workflow-plan
description: Use at workflow step 3, before any file changes: find or add the roadmap feature, pass the Jira Epic gate (story under an epic, epic spec confirmed), and branch or reuse the epic's branch and worktree. Also when creating a branch, worktree or epic spec.
---

# Step 3 — Roadmap, Epic gate, branch and worktree

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core (the mandatory first action, the step list, the fast loop and acceptance gate, the hard gates). Load this skill before the step starts.

## The step

3. **Update roadmap** — find or add the feature in [roadmap.md](../../../roadmap.md) with `Intent`, `Scope`, `Acceptance` filled in; set status to `🚧 In progress`. See **Planning convention**. Before any file changes, confirm the user story belongs to a Jira epic (see **Epic gate**), then work on the epic's branch and git worktree: reuse it if the epic already has one open, otherwise create it. See **Branching convention**.

## Planning convention — read before building

**Every feature must be defined in [roadmap.md](../../../roadmap.md) before any code is written for it.** The roadmap uses a strict **Release → Milestone → Feature** hierarchy with numeric IDs (`R`, `R.M`, `R.M.F`) and a status legend (`📋 Planned`, `🚧 In progress`, `✅ Done`, `🚫 Cut`). A feature is only ready to start when its Intent, Scope, and Acceptance fields are filled in.

1. Find or add the entry in [roadmap.md](../../../roadmap.md) first.
2. Confirm Intent / Scope / Acceptance are present before touching code.
3. Update status to `🚧 In progress`, then `✅ Done` when merged and verified.
4. If something gets cut, leave the entry with status `🚫 Cut` and a one-line reason.

Items in the **Backlog** section are not yet sequenced into a release. Promote them into a Milestone before starting work.

### Find the right feature — don't just append

When a new requirement arrives, the first move is a classification step, not "append at the bottom":

1. **Identify the milestone** the work belongs to — read each milestone's description; they exist for this.
2. **Decide add / extend / split:** extend an existing feature's `Scope` / `Acceptance` / `Notes` if the work fits it; otherwise add a new feature under the *right* milestone, slotted in dependency order; if no milestone fits cleanly, propose a new milestone or restate boundaries *before* adding the feature.
3. **Then write the entry** with Intent / Scope / Out-of-scope / Acceptance / Notes, and update cross-references in features that touch it.

The roadmap is read top-to-bottom; ordering and grouping carry meaning.

## Epic gate — no Jira epic, no code change

**Every new code change must map to a Jira epic in project BA. If it does not, the change is not done: do not branch, edit code or open a PR.** This is a hard gate, checked before step 3 of the workflow.

- The change maps to an epic when its Jira issue (the Story or Bug being worked on) has an Epic as its `parent`, or the issue is that Epic itself. Check with the `get_issue` tool of the `jira` skill: it passes when `parentType` is `Epic` (or the issue is itself the Epic).
- No epic: stop and tell the user which issue has no epic. Ask them to link it to an existing epic or create one (with the `jira` skill, with confirmation). Never pick an epic yourself or invent a key.
- The epic also appears in the matching [roadmap.md](../../../roadmap.md) milestone (each milestone mirrors one epic) and in the PR description, which links the epic and every story it includes.
- **Every epic has a high-level spec** at `specs/epics/<EPIC-ID>/spec.md` (e.g. `specs/epics/BA-12/spec.md`), in the format in [specs/README.md](../../../specs/README.md): goal, scope, out of scope, stories, the capability and system specs it touches, acceptance, and dependencies, risks and open questions. If the epic has no spec yet, or its spec is still `Status: Draft`, write or finish it before any code for its stories and get the user to confirm it (`Status: Confirmed`).
- **One-time exception (2026-10-04):** the user waived confirmation for the eight epic specs drafted by the BA-90 backfill (BA-2, BA-4, BA-5, BA-9, BA-10, BA-11, BA-12, BA-82). Specs marked *confirmation waived* do not block their stories. The exception does not extend to any other epic spec; every new one follows the rule above.
- Keep the epic spec high level. Story detail lives in the roadmap and Jira, behaviour in the capability specs, decisions in [specs/system/architecture.md](../../../specs/system/architecture.md); link to them rather than copying. Update the spec when the epic's scope changes, and link it from the matching roadmap milestone.

## Branching convention — one epic, one branch, one worktree, one PR

**Every epic is developed on a single feature branch, checked out in a single git worktree, and ships as a single PR that includes all of its user stories.** Stories under the same epic do not get their own branches or PRs: each one is built, specified, tested and logged on the epic's branch, one after the other. No work goes directly on `main` or the default branch, and no branch is created without an existing Jira epic behind it.

- **Branch name:** `<type>/<EPIC-ID>-<short-description>`
  - `<type>` is a Conventional Commit type: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci` or `build`. Use the highest-impact type among the epic's commits (`feat` if any story adds a feature). The version bump reads every commit since the last tag, so mixed commit types on one branch still bump correctly.
  - `<EPIC-ID>` is the key of an **existing** Jira Epic in project BA, uppercase as Jira shows it (e.g. `BA-111`). Each story worked on the branch must be a child of that epic. Check both with the `get_issue` tool of the `jira` skill before the first commit for a story. If the story or epic doesn't exist yet, stop and ask the user to create it (or create it with the `jira` skill, with confirmation). Never invent an ID. See **Epic gate**.
  - `<short-description>` is lowercase kebab-case, a few words, ASCII only, describing the epic.
  - Example: `feat/BA-111-local-observability`.
- **One open branch per epic.** Before starting a story, check for the epic's branch (`git branch -a --list '*/<EPIC-ID>-*'`) and its worktree (`git worktree list`). If they exist, continue there; create them only for the epic's first story.
- **Worktree:** one per epic branch, under `.claude/worktrees/`. **The folder is named after the epic it builds: `<EPIC-ID>-<short-description>`, exactly the branch name without the type.** No other name is allowed (no session ids, no `wt-…`, no story ids):
  ```bash
  git worktree add .claude/worktrees/BA-111-local-observability -b feat/BA-111-local-observability main
  ```
  When the Claude desktop app creates the worktree for the session under another name (e.g. `.claude/worktrees/bridge-cse_…`), bring both to the convention before the first commit: rename the branch (`git branch -m <type>/<EPIC-ID>-<short-description>`) and move the folder (`git worktree move <current-path> .claude/worktrees/<EPIC-ID>-<short-description>`; a worktree the app has locked needs `git worktree unlock` first, or the move after the session ends).
- **Bugs:** a Bug whose parent epic has an open branch is fixed on that branch, like a story. A Bug against work that already shipped, whose epic has no open branch, gets its own `fix/<BUG-ID>-<short-description>` branch, worktree and PR (e.g. `fix/BA-83-empty-session-thread`). The bug must still belong to an epic.
- **Traceability:**
  - Each commit is scoped to the story (or bug) it implements: `feat(BA-115): …`.
  - Each story keeps its own [roadmap.md](../../../roadmap.md) feature, changelog entry, evidence folder and retrospective entry, all made on the epic branch.
- **Adopted 2026-10-09 ([BA-149](https://halo-powered.atlassian.net/browse/BA-149)).** Branches created earlier under the old one-issue-per-branch rule merge as they are.
