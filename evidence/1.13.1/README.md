# Evidence — 1.13.1 ADR, epic spec and skill loader for app-owned skills (BA-199)

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). Branch `refactor/BA-198-assistant-skills`. Target: the web app (no desktop run requested).

| File | What it shows |
|---|---|
| [assistant-request-before.json](assistant-request-before.json) | The assistant's first chat request on `main` (`f3ef18e`), recorded by the stub: an `<available_skills>` catalog listing the designer's `interactive-visuals`, the framework's skills usage note, and the `skill`, `skill_search` and `skill_read` tools next to the seven `mastra_workspace_*` file tools. This is the defect the story fixes, and it resolves the old open question in agents.md §3.8. |
| [e2e-impact.md](e2e-impact.md) | Step-6 analysis: one scenario added, the rest re-run as-is. |
| [e2e-web.txt](e2e-web.txt) | `npm run test:e2e` (web): **86 passed, 2 skipped**, including `assistant-skills.spec.ts`, which failed before the change ("Received `interactive-visuals`") and passes after. |
| [e2e-org.txt](e2e-org.txt) | `playwright test --project=org`: **47 passed**. |
| [ng-test.txt](ng-test.txt) | Frontend unit tests, headless at 1440×900: **297 passed**. At headless Chrome's default 800×600, `App should support keyboard resizing from the separator` fails (525 vs 548). That's a window-size dependency in an untouched test, and this branch changes no frontend source. |
| [old-session-check.json](old-session-check.json) | A session created by the previous build (whose workspace got the `.agents/skills/interactive-visuals/SKILL.md` copy) still answers on the new build. The copy stays on disk, and no request carries a catalog, the skill or a skill tool. |
| [startup-invalid-skill.log](startup-invalid-skill.log) | The built CLI started with an invalid skill in `dist/` (description not starting "Use when"): it exits 1 with `Invalid app skills:` / `interactive-visuals: description must start with "Use when"` and never listens. |

Other gates, run on the branch:

- Backend `npx jest`: 62 suites, **1062 tests passed** (`main`: 61 / 1047). The new tests are `mastra/app-skills.spec.ts` (14) and a `visualization.service.spec.ts` test proving that the designer gets the bundled `SKILL.md`, not a workspace copy.
- `npx tsc --noEmit`: only the known `test/app.e2e-spec.ts` error.
- ESLint on the changed files: no new errors. Per-file counts equal `HEAD`'s, and the new files are at 0.
- `npm run build:all` and `python3 scripts/check-specs.py`: pass.

**Desktop not run:** `developer-settings.spec.ts` "the desktop app offers to restart the backend…" and `diagnostics.spec.ts` "captures live renderer failures…" are desktop-only. They were skipped on web, and no desktop run was requested.

**Evals:** the world-cup set runs once before the epic and once at its end, with `anthropic/claude-sonnet-5`, and the comparison goes in the epic's last evidence folder. Baseline at `f3ef18e`: 5/10.
