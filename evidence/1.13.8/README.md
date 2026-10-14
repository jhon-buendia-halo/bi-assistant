# Evidence — 1.13.8 Agent page Skills tab (BA-206)

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). Rules: agents-evals R63-R67. Layout: [ui.md](../../specs/system/ui.md) 4.5. API: [api.md](../../specs/system/api.md) 34a and 34b. This is the epic's last story, so this folder also holds the integrated-head gates.

| File | What it shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step-6 analysis: the new Feature "Agent skills" (4 scenarios); the agents, editor and hub specs re-run as they are. |
| [e2e-web.txt](e2e-web.txt) | The full Playwright web run on the integrated tree: **95 passed, 2 skipped**. It includes `agent-skills.spec.ts` (4/4; also 12/12 over `--repeat-each=3`) and `assistant-skills.spec.ts` (5/5). |
| [e2e-org.txt](e2e-org.txt) | Playwright org: **47 passed**. |
| [ng-test.txt](ng-test.txt) | Frontend unit: **311 passed**, including 14 new tests for the Skills tab component and the two service methods. |
| [skills-tab-assistant-levels.png](skills-tab-assistant-levels.png) | The assistant with a user skill (`sql-style`), a project override of `curated-knowledge` and a broken user skill: the three levels with their folders, and `Skills (3)`. |
| [skills-tab-expanded-files.png](skills-tab-expanded-files.png) | `curated-knowledge` (Project, overrides built-in and user) showing the project override's `SKILL.md`; `deep-analysis` with `phases/1-plan.md` selected. |
| [skills-tab-skipped.png](skills-tab-skipped.png) | `sql-style` with the warning `scripts/ is not run for user and project skills`, and `broken` under Skipped with `description is missing`. |
| [skills-tab-designer-spec-mode.png](skills-tab-designer-spec-mode.png) | The designer's built-in `interactive-visuals` with `reference/spec-mode.md` shown. |
| [skills-tab-details-panel-open.png](skills-tab-details-panel-open.png) | With the Details panel open (482 px row), the file list stacks above the content. |

The first full web run failed one new scenario ("an agent without skills says so"). The test's own helper was at fault: it called `isVisible()` on "Show more" before the hub had rendered. It was fixed by clicking unconditionally, as `agents.spec.ts` does, then re-run 12/12 and inside the full run above.

**Layout check.** The first panel-open screenshot squeezed the file content to about 200 px. The row is now a container (`@2xl:flex-row`), and the screenshot above is after the fix.

**Desktop not run:** `developer-settings.spec.ts` "the desktop app offers to restart the backend…" and `diagnostics.spec.ts` "captures live renderer failures…" are desktop-only. They were skipped on web, and no desktop run was requested.
