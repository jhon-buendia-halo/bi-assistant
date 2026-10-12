# BA-169 — Claude Code workflow mod

- **Jira:** [BA-169](https://halo-powered.atlassian.net/browse/BA-169) · **Roadmap:** Milestone 1.11 · **Status:** Confirmed

## Goal

Every developer working on this repository in Claude Code sees the eleven-step development workflow from [CLAUDE.md](../../../CLAUDE.md) in a side pane while they work, so the order of operations is in view instead of in a file they have to reopen.

Today the workflow lives only in CLAUDE.md. A Claude Code *mod* (a plugin whose hooks module draws in the interface) can open a pane beside the transcript and list the steps. The mod ships in the repository so it is versioned with the workflow it describes, and the repository offers it to every developer.

## Scope

- **The mod.** `.claude/mods/workflow-steps/`: a plugin with a hooks module that, at session start and on `/workflow`, reads `CLAUDE.md` in the working directory, parses the `## Workflow` section (the mandatory first action and the numbered, bold-titled steps) and opens a **Workflow** pane listing them: number, title and the first sentence of each step. When the file can't be read or has no such section, a built-in copy of the steps is shown and the pane says so. A static checklist: nothing is tracked or stored.
- **The queue (BA-171).** The pane is a task queue inferred from tool calls, with nothing asked of Claude: executed tasks numbered in the order they ran with step, agent, duration, tokens and cost; the running task with a confidence bar and its subagents; a tentative task that earns its number after enough matched calls; the remaining steps queued with the numbers they will get. Cost is the session cost delta; no history is kept.
- **Task details (BA-174).** Every row shows its agent (expected for a queued step), tokens, cost and a completion %, and the header the overall completion. A click or Enter opens a detail under the row: a summary built from the task's own calls, the step's checklist behind the %, and the agents with their own tokens. Completion comes from per-step checklists of facts read off tool calls; cost stays at task level (no price table). Confirmed with the user on 2026-10-12, after choosing option A of three mockups.
- **Tests.** The mod's own tests, run with `claude plugin test`, cover parsing, the pane on the terminal and desktop surfaces, the command and both fallbacks.
- **Install for every developer.** The repository is a plugin marketplace (`.claude-plugin/marketplace.json` at the root lists the mod by its path), and the committed project settings (`.claude/settings.json`) register that marketplace and enable `workflow-steps@bi-assistant`, so Claude Code offers the install to a developer who trusts the folder. Developers changing the mod load it directly with `claude --plugin-dir .claude/mods/workflow-steps`.
- **Documentation.** The install and the mod's behaviour in [system/delivery.md](../../system/delivery.md) and the repository README; a README inside the mod.

## Out of scope

- Any change to the application (frontend, backend, CLI, desktop). The mod is developer tooling.
- A reporting tool or prompt injection; a history store with estimates; a price table or cost per agent; writing anything back to the repository.
- Organization-wide managed installs; other mods.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-170](https://halo-powered.atlassian.net/browse/BA-170) | Ship the workflow-steps mod in the repo and make it installable | 1.11.1 |
| [BA-171](https://halo-powered.atlassian.net/browse/BA-171) | Inferred task queue in the workflow pane | 1.11.2 |
| [BA-174](https://halo-powered.atlassian.net/browse/BA-174) | Task details in the workflow pane: click a task to see its summary, agents and completion | 1.11.3 |

All stories are built on one branch, `feat/BA-169-claude-code-workflow-mod`, and ship as one PR. BA-170 and BA-171 merged that way; BA-174 came later, on a new branch of the same name.

## Specs touched

- [system/delivery.md](../../system/delivery.md): a section on Claude Code mods: where they live, how the marketplace and project settings install them, how to validate, test and develop one.
- No capability spec, endpoint, persisted shape, prompt or UI of the application changes, so no Gherkin scenario or Playwright spec is touched.

## Acceptance

- `claude plugin validate` passes on the mod and on the repository marketplace; `claude plugin test` passes in the mod.
- In a Claude Code session started in the repository with the mod loaded, the **Workflow** pane lists the eleven steps and the mandatory first action as CLAUDE.md spells them, and `/workflow` opens the pane.
- The committed project settings register the marketplace and enable the plugin, so a developer who trusts the folder is offered the install without further setup.
- `git diff` of the PR touches nothing under `backend/` or `frontend/`.

## Dependencies, risks and open questions

- **Early-access API.** Mods need Claude Code 2.1.287 or later and the hooks API may change between releases. The mod's README names the version it was tested with; a breaking change shows up as a validation or load failure, not as a wrong pane.
- **Narrow terminals.** A pane the mod opens by itself only appears in a terminal at least 144 columns wide (110 once the developer has opened it). Narrower, a toast says to run `/workflow`, which opens it at any width.
- **Installed copies are cached by version.** A change to the mod reaches developers who installed it from the marketplace only after a version bump in its manifest and `/plugin update`; the developer changing it uses `--plugin-dir`.
- **Marketplace on `main`.** The project settings point at this GitHub repository, so the install works once the marketplace file is on the default branch; on the epic branch it is verified from a local path.
