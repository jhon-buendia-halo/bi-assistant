# 1.13.5 — E2E impact analysis (workflow step 6)

Change: `interactive-visuals/SKILL.md` becomes a router. Its two modes move verbatim into `references/spec-mode.md` and `references/freeform.md`. Each designer call gets the router body plus only its own mode's reference.

Touched: `modules/sessions/visualization.service.ts` (`designerSkill(mode)`), `mastra/app-skills.ts` (`appSkillBody`), `mastra/skills/interactive-visuals/**`.

| Scenario → Playwright spec | Decision |
|---|---|
| visuals · Skills the designer is given · A spec visual is designed with the spec-mode instructions only → `designer-skills.spec.ts` | **Add**. Against the build from before the change, the turn and the visual worked, but the designer's system message carried the whole skill: front matter, `## Fallback: freeform…`, `### Data access`, `window.qti.onRefresh(render)`. |
| sessions-chat · Chat and visuals → `chat-and-visuals.spec.ts` | Re-run as-is (the designer route is mocked in the browser). |
| every other Feature | Re-run as-is (full web and org suites). |

The freeform paths (no rows; fallback after two failed spec attempts) are covered by `visualization.service.spec.ts`, which checks the exact system message for each.
