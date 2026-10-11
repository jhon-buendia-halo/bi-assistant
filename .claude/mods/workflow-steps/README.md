# workflow-steps

A Claude Code mod that opens a **Workflow** pane beside the transcript (the right-hand
sidebar in a wide fullscreen terminal or the desktop app, a framed region above the
prompt otherwise) listing the eleven-step development workflow from this repository's
[CLAUDE.md](../../../CLAUDE.md), plus the mandatory first action it names.

- On session start the mod reads `CLAUDE.md` in the working directory, parses the
  `## Workflow` section (its numbered, bold-titled steps) and opens the pane.
- `/workflow` re-reads the file and opens (or focuses) the pane. Esc closes it.
- When `CLAUDE.md` can't be read or has no `## Workflow` section, a built-in copy of the
  steps is shown and the pane says so.
- A pane the mod opens by itself only appears in a terminal at least 144 columns wide
  (110 once you opened it yourself); otherwise a toast says to run `/workflow`.

The checklist is static: nothing is tracked or stored. Written against Claude Code
2.1.296; mods need 2.1.287 or later and the hooks API is early access.

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
├── types/index.d.ts             the $.state values the mod keeps
├── tests/workflow-steps.test.ts `claude plugin test`
└── tsconfig.json                extends the declarations Claude Code writes into .claude-plugin/types/
```
