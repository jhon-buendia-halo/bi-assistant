# Evidence — 1.13.7 Skill levels: built-in, user and project skills that override by name (BA-205)

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). Decision: ADR-0019. Behaviour: [agents.md](../../specs/system/agents.md) 7.3 and 7.4.

| File | What it shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step-6 analysis: two scenarios added to "Skills the assistant is given". |
| [api-smoke.txt](api-smoke.txt) | The built CLI started with a user skill, a broken user skill and a project override of `curated-knowledge`. It shows what `GET /agents/assistant/skills` resolved, the file endpoint's 200/400/404 answers, and the `[skills] Skipped user skill "broken": description is missing` log line. The backend kept serving. |

**E2E.** The recording stub shows a user-level `sql-style` skill in the assistant's `<available_skills>` catalog, with the `skill` and `skill_read` tools. It also shows a user-level `curated-knowledge` override sent right after the knowledge block, with none of the built-in rules (`assistant-skills.spec.ts`, 5/5). `designer-skills.spec.ts` is green after the `references/` → `reference/` move. Full-suite results: see [../1.13.8/README.md](../1.13.8/README.md).

**Unit.** `app-skills.spec.ts` has 34 tests. They cover:
- precedence across the three levels, and `agents` targeting;
- every skip reason, with the log line;
- the override checks (files, placeholders, empty body), and that a skipped override leaves the level below in place;
- the two warnings, dot-folders, and symbolic links being ignored;
- file listing and reading (binary, too large, paths outside the skill).

Backend `npx jest`: **66 suites, 1114 tests passed**.

**Other checks:**
- `tsc`: only the 4 known errors.
- ESLint on the changed files: no new errors.
- `hermes verify backend --phase build --phase test` on `7171bd5`: build and Jest passed. Lint failed on the repo's existing 219 errors (`origin/main` has 221); the changed files have none.
