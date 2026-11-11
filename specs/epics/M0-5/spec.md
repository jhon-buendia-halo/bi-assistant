# M0-5 — Faster workflow, repo-only planning

- **Roadmap:** Milestone 0.5 · **Status:** Confirmed (2026-11-11, the user: "Make all the changes … we are not going to use Jira anymore. All the specs will be written in the repository.")

## Goal

A new piece of work goes from request to merged PR in less time, without weakening what the workflow guarantees: every change is planned in the roadmap, specified, tested and recorded.
- Small changes stop paying for the full eleven-step process.
- The first read of every task is short.
- Records are written once per epic, not once per story.
- The QA script and the eval bar stop costing waiting time.
- A new workspace is ready with one command.
- Planning needs no external system: Jira is no longer used.

## Scope

- **Repo-only planning:** epics are roadmap milestones with the ID `M<R>-<M>` and a spec in `specs/epics/`; stories are roadmap features. The Jira MCP server, its skill, `.mcp.json`, the Jira settings and `.env.example` are removed; `check-specs.py` checks the new epic IDs.
- **Change sizes** S, M and L in `CLAUDE.md`, each with the steps it runs.
- **`lessons.md`**, a short distilled list, replaces `retrospective.md` as the mandatory first read.
- **Per-epic records:** one changelog entry and one retrospective per epic.
- **Four workflow skills** instead of nine: `workflow-start` (1–5), `workflow-implement` (8), `verify` (fast loop, 9), `workflow-gate` (6, 7, 10, 11). Brief-driven agents skip `CLAUDE.md`.
- **Faster `qa.mjs`:** parallel checks, the build skipped when up to date, a narrower QA lane, `--draft-impact` for step 6, `--no-demo` for S changes.
- **Eval bar:** runs in parallel, compared with the base commit; code checks 3 of 3, judged cases at least 2 of 3 and no worse than the base.
- **Workspace bootstrap:** `scripts/bootstrap.mjs`, the Conductor setup script, `@floating-ui/dom` as a direct dependency, and `setup-local.mjs` loading the Intellify sample where the Intellify RFP API reads it.

## Out of scope

- Rewriting past changelog, retrospective or evidence entries, or renaming the existing `BA-*` epic folders.
- Tagged lessons, `scripts/lessons.mjs` and token metering: they stay planned in 0.4.8.
- Any app behaviour change.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| Repo-only planning | Remove Jira; epics are milestones `M<R>-<M>` | 0.5.1 |
| Lighter workflow | Change sizes, `lessons.md`, per-epic records, four skills | 0.5.2 |
| Faster QA script | Parallel checks, build skip, narrower lane, draft impact, `--no-demo` | 0.5.3 |
| Eval bar | Parallel runs, base-relative bar for judged cases | 0.5.4 |
| Workspace bootstrap | One-command setup, Conductor settings, dependency and setup-local fixes | 0.5.5 |

## Specs touched

- [system/delivery.md](../../system/delivery.md): section 2 (bootstrap, setup-local), 10 (skills, sizes, records), 11 (no tools), 12 (`omitClaudeMd`), 13 (`qa.mjs`).
- [README.md](../../README.md): the epic spec format, epic IDs, this epic's row.
- [capabilities/diagnostics](../../capabilities/diagnostics/spec.md): its Test target link points at `workflow-gate`.

## Acceptance

- `CLAUDE.md` has no Jira rule, names a size table, and the `workflow-steps` mod still parses its eleven steps.
- `python3 scripts/check-specs.py` passes and checks `M<R>-<M>` milestone epics.
- `node --test scripts/qa-lib.test.mjs scripts/setup-local.test.mjs` passes.
- `node scripts/bootstrap.mjs` makes a checkout with no `node_modules` build the web UI.
- No reference to a removed skill or to the Jira tools remains outside history (changelog, retrospective, evidence, past roadmap entries, past epic specs).

## Dependencies, risks and open questions

- `.conductor/settings.toml` takes effect in the Conductor app only once merged to `main`.
- The S size depends on judgment; when unsure, the larger size is taken and stated, and the user can re-size.
- Judged eval cases may now ship at 2 of 3. Known-flaky cases are listed in the changelog and PR, so a regression in them stays visible.
