# Evidence — 1.13.2 Slim assistant core prompt: curated-knowledge skill, harness-loaded (BA-200)

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). It absorbs 1.13.3 (BA-201, cut).

| File | What it shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step-6 analysis: two scenarios added, the rest re-run as-is. |

What changed for the model:

- The base prompt went from 7,380 to 5,694 characters. The removed 1,686 are the "Curated knowledge:" section, now `skills/curated-knowledge/SKILL.md`, byte-identical.
- A turn with a knowledge block gets it back as the next system message after the block. A turn without one doesn't get it.
- `specs/system/agents.md` Appendix A was checked against the prompt the code builds and Appendix B against the skill body: both are exact matches.

Tests:

- `assistant-skills.spec.ts`: "a turn without curated knowledge carries no knowledge rules" and "a turn with curated knowledge carries the rules right after the block". Before the code change, both failed on `not.toContain("Curated knowledge:")` in the base prompt.
- Jest: `context-blocks.spec.ts` (block present gives the block and then the skill; absent or empty gives nothing), `assistant.evals.spec.ts` (the eval path sends the same pair), `sessions.service.spec.ts`, and `app-skills.spec.ts` (`appSkillBody`).

Gates on the integrated epic head (`49184ac`, all three stories merged), shared with 1.13.4 and 1.13.5:

- Playwright web: **89 passed, 2 skipped** ([../1.13.5/e2e-web.txt](../1.13.5/e2e-web.txt)). Org: **47 passed** ([../1.13.5/e2e-org.txt](../1.13.5/e2e-org.txt)).
- Frontend unit at 1440×900: **297 passed** ([../1.13.5/ng-test.txt](../1.13.5/ng-test.txt)).
- Backend `npx jest`: **65 suites, 1091 tests passed**. `tsc` shows only the 4 known errors (3 in `llm.service.spec.ts`, 1 in `test/app.e2e-spec.ts`). ESLint per touched file matches the base `f3ef18e`, and the new files are at 0. `check-specs.py` passes.
- **Desktop not run:** `developer-settings.spec.ts` "the desktop app offers to restart the backend…" and `diagnostics.spec.ts` "captures live renderer failures…" are desktop-only. They were skipped on web, and no desktop run was requested.
- **Evals:** the world-cup set before and after the epic: [../1.13.5/README.md](../1.13.5/README.md#evals).
