# Evidence — 1.13.13 Built-in skills only: remove user and project skill levels (BA-211)

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). ADR-0021 (supersedes ADR-0019). Rules: agents-evals R63-R67. Layout: [ui.md](../../specs/system/ui.md) 4.5. API: [api.md](../../specs/system/api.md) 34a.

| File | What it shows |
|---|---|
| [e2e-results.txt](e2e-results.txt) | The impacted Playwright specs on web: `agent-skills.spec.ts` 3/3, `assistant-skills.spec.ts` 5/5, `designer-skills.spec.ts` 2/2 (**10 passed**). On the base commit (513009d) the three scenarios that assert BA-211 fail: "Where skills come from" is still shown, the tab reads `Skills (3)`, and the catalog lists `sql-style`. |
| [skills-tab-assistant-built-in-only.png](skills-tab-assistant-built-in-only.png) | The assistant's Skills tab with a `skills/sql-style` folder left in the data dir: `Skills (2)`, `curated-knowledge` (On demand) and `deep-analysis` (Loaded by the app), no level badges, no "Where skills come from", no Skipped section. |
| [skills-tab-designer-files.png](skills-tab-designer-files.png) | The designer's `interactive-visuals` expanded with `reference/spec-mode.md` shown. |

## Step-6 impact analysis

- **Feature "Agent skills"** (`agent-skills.spec.ts`): updated "Shows the designer's built-in skill and the content of its files"; re-run "An agent without skills says so" (its helper waited for the removed "Restart the app" line); replaced "A user skill and a project override reach the assistant" with "The assistant gets only its built-in skills, and an old skills folder is ignored"; deleted "A broken user skill is skipped and says why".
- **Feature "Skills the assistant is given"** (`assistant-skills.spec.ts`): replaced "A user-level skill is offered to the assistant on demand" with "A skills folder left in the data dir by an older version is ignored"; updated "The assistant reads a skill's files with read_file, and only those" to read the built-in `curated-knowledge` (it passes on base too, since it only drops its dependency on user skills); deleted "A user-level override of the curated-knowledge skill is the one the model reads"; re-ran the other three.
- **Feature "Skills the designer is given"** (`designer-skills.spec.ts`): re-run as-is.

## Other checks

- Backend: `npm test` 1144/1144, `npm run lint` 0 errors (2 warnings in untouched files), `npm run build:all` passes.
- Frontend: `npm run build` passes; `npm test` 306/307. The one failure, `App should support keyboard resizing from the separator` ("Expected 525 to be 548"), fails the same way on the base commit and is unrelated to this change.
- `python3 scripts/check-specs.py`: all checks passed.
- **Evals not run:** the assistant's prompt is byte-identical before and after (`assistantAgent.getInstructions()`, sha256 `323741e5…ed4f1`), and its catalog and tools are unchanged, so nothing the agent receives changed.
- **Desktop not run:** no desktop run was requested.
