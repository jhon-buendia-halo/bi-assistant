# workflow-steps

A Claude Code mod that opens a **Workflow** pane beside the transcript (the right-hand
sidebar in a wide fullscreen terminal or the desktop app, a framed region above the
prompt otherwise) showing the eleven-step development workflow from this repository's
[CLAUDE.md](../../../CLAUDE.md) as a **task queue inferred from tool calls**.

- Executed tasks are numbered in the order they ran (`#1`, `#2`, …) with the step they
  correspond to, the agent (`main`, `main +2` with subagents), duration, tokens, cost, a
  completion bar and a one-line summary (`Edited roadmap.md ×2 · 3 reads`). The running task
  also lists the subagents spawned under it. The header adds the overall completion.
- Completion is the share of the step's checklist met, from facts read off the task's calls:
  step 3 counts `roadmap.md` edited, `Acceptance` written and a status set; step 9 counts
  tests run and the last run passed; and so on for every step.
- Click a row, or press Enter on it after `ctrl+x tab`, to open its detail: the summary, the
  checklist with each check met or not, the agents with their own tokens, and the cost and
  confidence. Press again to close it; several rows can stay open. Queued steps open too,
  showing what is expected of them and the agent they usually use (`~main`).
- The mod maps each tool call to a step (roadmap.md is 3, specs are 5, Playwright files
  are 7, source files 8, a test run 9, the changelog 10, the retrospective 11, and so on).
  A step change opens a tentative task (`#n?`) that earns its number after three matched
  calls or one write, and is dropped after three unmatched calls. Nothing is asked of
  Claude and no prompt is changed.
- The remaining steps are queued with the numbers they will get; steps that never gave a
  signal are listed apart.
- `/workflow` re-reads `CLAUDE.md` and opens (or focuses) the pane; Esc closes it.
  `/workflow reset` clears the queue for a new change.
- When `CLAUDE.md` can't be read or has no `## Workflow` section, a built-in copy of the
  steps is used and the pane says so.
- A pane the mod opens by itself only appears in a terminal at least 144 columns wide
  (110 once you opened it yourself); otherwise a toast says to run `/workflow`.

Tokens come from each turn's usage, a subagent's own turns credited to it and to the task it
was spawned under; cost is the session cost delta between a task's start and end, as `/cost`
counts it, so there is no cost per agent. Nothing is stored across sessions. The full rule table is in
[specs/system/delivery.md](../../../specs/system/delivery.md) §9. Written against Claude
Code 2.1.296; mods need 2.1.287 or later and the hooks API is early access.

## Install

The repository is a plugin marketplace and its committed `.claude/settings.json` enables
this mod, so Claude Code offers the install when you trust the folder. By hand:

```bash
claude plugin marketplace add jhon-buendia-halo/bi-assistant
claude plugin install workflow-steps@bi-assistant
```

## Develop

```bash
claude --plugin-dir .claude/mods/workflow-steps   # loads this directory for one session, hot-reloads on save
claude plugin validate .claude/mods/workflow-steps
cd .claude/mods/workflow-steps && claude plugin test
```

An installed copy is cached by version: bump `version` in `.claude-plugin/plugin.json`
and run `/plugin update` for installed developers to receive a change.

## Layout

```
workflow-steps/
├── .claude-plugin/plugin.json   manifest (name, version, types)
├── hooks/hooks.json             points at the hooks module
├── hooks/register.tsx           session.start, command.run{workflow}, ui.render{Pane}
├── hooks/rules.ts               the inference rules (pure functions, tested on their own)
├── types/index.d.ts             the $.state values the mod keeps
├── tests/                       `claude plugin test`: the rules and the queue through the hooks
└── tsconfig.json                extends the declarations Claude Code writes into .claude-plugin/types/
```
