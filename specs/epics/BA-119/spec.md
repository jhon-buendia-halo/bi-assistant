# BA-119 — Harness Adjustments

- **Jira:** [BA-119](https://halo-powered.atlassian.net/browse/BA-119) · **Roadmap:** Milestone 0.4 · **Status:** Confirmed

## Goal

The delivery workflow harness (CLAUDE.md, its conventions, the project skills and the checks that govern how a change is planned, built and shipped) stays easy for Claude Code to follow as it grows. Each session should load what it needs when it needs it, rather than carrying every convention in context on every turn.

Today CLAUDE.md is about 200 lines. It is loaded into every turn of every session, including turns that only run the app or answer a question. The RFP Builder already solves the same problem for an agent. Its prompt keeps a short core with a `## Workflow` list that names one skill per stage, and each stage's detail lives in a skill loaded before that stage starts. The harness should use the same structure.

## Scope

- **Workflow-stage skills (BA-236).** CLAUDE.md keeps only the always-on core:
  - what the repo is and where things live
  - the mandatory first action
  - the eleven-step `## Workflow` list, with each step naming the skill to load before it starts
  - the fast loop and the acceptance gate
  - the hard gates (no epic no code, never on `main`, specs change with the code, ask the target before starting the app in a worktree, never edit `version`)
  - model usage

  Each stage's conventions move, unchanged in substance, into a project skill under `.claude/skills/`. Each skill can be invoked as `/<name>`:

  | Steps | Skill | Conventions it carries |
  |---|---|---|
  | 1–2 | `workflow-understand` | reading the retrospective, restating the goal, clarifying questions |
  | 3 | `workflow-plan` | Planning, Epic gate, Branching (branch, worktree, traceability) |
  | 4 | `workflow-architecture` | Architecture (C4, ADRs) |
  | 5 | `workflow-specs` | Spec (where things go, Gherkin, CI coverage) |
  | 6–7 | `workflow-e2e` | E2E test, Test target |
  | 8 | `workflow-implement` | Code rules (frontend, backend, versioning), Worktree deploy |
  | 9 | `verify` (existing, extended) | the step-9 commands, impacted specs only, the eval bar; checking the running web app |
  | 10 | `workflow-ship` | Logging, Evidence, the epic PR and post-merge cleanup |
  | 11 | `workflow-retrospective` | Retrospective |

- **Developer tools in `.claude/tools/` (BA-237).** A home for tools that Claude Code uses, each one an MCP server (an external, authenticated service with shared writes) or a script (repo-local work that people and CI also run), with the skill that names it. The first is a `jira` MCP server, registered in a committed `.mcp.json`, that creates epics and creates stories or bugs under an epic (checking that the parent is an Epic), and covers everything `jira.sh` did (read, search, update, comment, transition). It replaces `jira.sh`, and the `jira` skill becomes the guide to it.
- **Links stay checked.** `scripts/check-specs.py` also checks the relative links in `.claude/skills/*/SKILL.md`. Specs that cite "*X convention* in CLAUDE.md" point at the skill that now holds that convention.

## Out of scope

- Any change to the application (frontend, backend, CLI, desktop).
- Changing what a convention says. The split moves text and does not rewrite rules. Wording changes only where text has to say where something now lives.
- Changing the `workflow-steps` mod. It keeps reading CLAUDE.md's `## Workflow` section, whose line format (`<n>. **<title>** — <description>`) is unchanged.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-236](https://halo-powered.atlassian.net/browse/BA-236) | Split CLAUDE.md into workflow-stage skills | 0.4.1 |
| [BA-237](https://halo-powered.atlassian.net/browse/BA-237) | Jira MCP tool in .claude/tools for epics and stories | 0.4.2 |

All stories are built on one branch, `feat/BA-119-harness-adjustments`, and ship as one PR.

## Specs touched

- [system/delivery.md](../../system/delivery.md):
  - Links that name a CLAUDE.md convention now point at its skill.
  - The `check-specs` link rule covers the project skills.
  - A short list of the project skills that carry the workflow.
- [capabilities/diagnostics/spec.md](../../capabilities/diagnostics/spec.md): its *Test target convention* link points at `workflow-e2e`.
- [system/delivery.md](../../system/delivery.md) section 11: `.claude/tools/`, the two kinds of tool and the `jira` MCP server.
- No endpoint, persisted shape, prompt or UI of the application changes, so no Gherkin scenario or Playwright spec is touched.

## Acceptance

- Every rule in today's CLAUDE.md is in exactly one place after the split: the core or one skill. A section-by-section map in the evidence shows where each one went.
- CLAUDE.md's `## Workflow` names the skill for every step, and the `workflow-steps` mod still parses all eleven steps and the mandatory first action. Its tests pass.
- In a new Claude Code session in the repo, the nine skills are listed and each can be invoked as `/<name>`.
- `python3 scripts/check-specs.py` passes, including the links inside the skills.
- The `jira` tools' unit tests pass, and in a new session `/mcp` lists the `jira` server. Its read tools run without a prompt, its write tools ask, and a Story created under an Epic reads back with that Epic as its parent.
- `git diff` of the PR touches nothing under `backend/` or `frontend/`.

## Dependencies, risks and open questions

- **A skill not loaded is a rule not followed.** Moving a convention out of CLAUDE.md means Claude only sees it when it loads the skill. Mitigation:
  - Every workflow step names its skill.
  - The core says to load a stage's skill before starting that stage.
  - The hard gates stay in the core, because they apply outside a stage, for example "run the app".
- **Skills are discovered by description.** Each description says when to use the skill ("Use at workflow step 5 …"), so the stage and its skill can be matched without reading the file.
- **Past entries keep their old links.** `changelog.md` and `retrospective.md` entries are never rewritten, so their mentions of "*X convention* in CLAUDE.md" stay as historical text.
