# M0-6 — Workflow modes: Strict and Free style

- **Roadmap:** Milestone 0.6 · **Status:** Confirmed (2026-11-12, the user: "vamos adelante", after the sketch and answers on the free style steps, a new branch, the saved choice, switching mid-session and the branch name.)

## Goal

The user chooses, per session, how much process a piece of work gets.
- **Strict** is the current eleven-step workflow, unchanged.
- **Free style** runs four steps (understand, clarify, implement, checks). Every other step is optional.
- `CLAUDE.md` loads only what both workflows share, so the first read of every session is shorter.

## Scope

- **Workflow choice:** in a new session, after reading `lessons.md`, Claude asks Strict or Free style with a picker and saves the answer in `.context/workflow-mode` (per workspace, git-ignored). When the file exists, Claude confirms the mode in one line instead of asking. "Switch to strict" or "switch to free style" changes it mid-session. Going from Free style to Strict adds the roadmap story for the work already done.
- **`CLAUDE.md` as a router:** what the app is, the mandatory first action, the choice, the rules both workflows share, and the model routing table.
- **`workflow-strict` skill:** the eleven steps, change sizes, decide-before-build, story lane, wave check, acceptance gate and Epic gate, moved from `CLAUDE.md`. The step skills (`workflow-start`, `workflow-implement`, `workflow-gate`, `verify`) are unchanged apart from their pointers.
- **`workflow-free-style` skill:** the four steps, the optional ones, and the rules it keeps: a new branch, never `main`, Conventional Commits, and spec lines the change makes false.
- **`qa.mjs --free`:** the gate's checks with no roadmap id and no evidence.
- **`workflow-steps` mod:** reads the steps from the strict skill.

## Out of scope

- Changing what any strict step does.
- Builder and reviewer agents in Free style.
- Any app behaviour change.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| Workflow choice | `CLAUDE.md` as a router, the picker, `.context/workflow-mode`, switching | 0.6.1 |
| Strict skill | The current workflow moved into `workflow-strict` | 0.6.2 |
| Free style skill | Four steps, the rest optional | 0.6.3 |
| QA without a story | `qa.mjs --free` | 0.6.4 |
| Workflow pane | The mod reads the strict skill | 0.6.5 |

## Specs touched

- [system/delivery.md](../../system/delivery.md): section 9 (the `workflow-steps` mod's source), section 10 (the two workflows, the skills table), section 13 (`qa.mjs --free`).
- [README.md](../../README.md): this epic's row.

## Acceptance

- `CLAUDE.md` is under 60 lines and holds no history lines.
- `python3 scripts/check-specs.py` passes.
- `node --test scripts/qa-lib.test.mjs` passes.
- `claude plugin test` in `.claude/mods/workflow-steps` passes.
- The workflow pane still shows the eleven strict steps.

## Dependencies, risks and open questions

- Free style skips the roadmap, so work done in it is traced only by its commits and PR. Switching to Strict before the PR adds the story.
- `.context/` is per workspace: a new Conductor workspace asks again, which is intended.
