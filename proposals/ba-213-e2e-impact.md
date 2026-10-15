# BA-213 step 6: E2E impact analysis (BA-217, BA-215, BA-216)

"Fails on main" means: main has no Tools/Skills fieldsets, no `/skills` routes, no In-app skills level and no `skills` collection.

## 1. Touched component -> scenarios that exercise it

| Touched | Feature / scenario (spec file) |
|---|---|
| agent-editor component, AgentEditorService, util (Tools and Skills fieldsets, save/preview payload) | Agent editor, all 9 existing + 2 new (`agent-editor.spec.ts`) |
| agent-hub (Skills header button) | Agent Hub: "shows the built-in agents and mine in sections", the a11y scenario (`agent-hub.spec.ts`) |
| skills-library, skill-editor, SkillsApiService, app.ts/app.html routing | Skill library (new `skill-library.spec.ts`) |
| agent-skills tab (In-app level) | Agent skills (`agent-skills.spec.ts`) |
| agent detail (tools from draft/Live) | Agent Hub "a card opens the agent's detail view"; Agents "Shows the model an agent resolves to"; Agent editor Tools scenario |
| backend `skills` module (endpoints 94-98) | Skill library; Agent definitions (API) pattern (`user-agents.e2e-spec.ts`) |
| user-agents service/DTO/entity (tools, skills, liveSkills), agents.service | Agent editor; Agent Hub publish/delete; Agent definitions (API) |
| sessions.service, assistant.agent, assistant-prompt, agent-tools, agent-skills, skill-tools, app-skills (per-call tools, prompt, catalog, read_file virtual paths) | Sessions started from an agent (6, `agent-sessions.spec.ts`); Skills the assistant is given (6, `assistant-skills.spec.ts`); `chat-clarification`, `chat-and-visuals`, `world-cup-workflow`, `designer-skills` (shared prompt builder) |
| admin.service, all-owners repositories (transfer copies skills) | Edit a user / Users and groups transfer (`org-admin-edit-user.spec.ts`, `org-admin-users.spec.ts`); `backend/test/org-admin.e2e-spec.ts` |
| database.module, doc-store (private `skills` collection) | Private and shared data (`org-isolation.spec.ts`); `owner-isolation.e2e-spec.ts` |
| evals (two new world-cup cases, 12 questions) | Agents/evals scenarios that say "10 questions" |

## 2. Decisions per scenario

### Add
- **Agent editor / Tools left unticked are not offered to the model** (`agent-editor.spec.ts`). Assert: the three optional tools are ticked on a new agent; after unticking two, the last stub request's `tools` contains `sample_rows` and none of `ask_clarification`, `create_visual`, `update_visual`; system text contains "You can't ask the user a question back in this session."; the Tools tab lists `sample_rows`, not `create_visual`. Fails on main: no fieldset, all tools always offered.
- **Agent editor / An assigned skill reaches the preview, and the Live agent keeps its copy** (`agent-editor.spec.ts`). Assert: preview request's system text lists `fiscal-calendar` at `/in-app-skills/fiscal-calendar/SKILL.md`; after Publish and a library body edit the hub card shows "Unpublished changes"; in a real chat the stub scripts a `read_file` call on that path and the next stub request carries a tool result containing "1 July" (not "1 April"). Fails on main: no skills fieldset, no catalog entry, path refused.
- **Skill library / Creates, edits and deletes a skill** and **Refuses a bad name or description** (new `skill-library.spec.ts`). Assert the exact empty state, toasts, "Not used by any agent" and "What the agent sees" text from the Gherkin. Fail on main: no Skills button or page.
- **Sessions started from an agent / A Live agent's tools and skills shape every turn** (new scenario, needs Gherkin in step 5; `agent-sessions.spec.ts`). Live agent with `tools: ['sample_rows']` and one assigned skill; start chat and send; assert offered tools = `run_readonly_sql`, `read_file`, `sample_rows` (no `ask_clarification`, `create_visual`); catalog lists the skill at `/in-app-skills/<name>/SKILL.md`; then change the draft tools and skill body without publishing, send again, and the request is unchanged. Fails on main: all tools offered, no catalog.
- **Agent skills / A user agent's in-app skills show at level "In-app"** (new scenario, needs Gherkin; `agent-skills.spec.ts`). Seed skill via API, assign in a Live agent, open the agent detail, Skills tab: the assistant's skills plus the skill at level "In-app"; change the draft assignment and assert the tab still shows the Live copy. Fails on main: no In-app level.
- **Private and shared data / skills are private to their owner** (new scenario, needs Gherkin; `org-isolation.spec.ts`). User A creates a skill via API; user B's `GET /skills` lists none and `GET /skills/:id` is 404. Fails on main: routes 404 for both.
- Optional: **Skill library / no axe violations in either theme** (library and editor), matching the hub and editor acceptance.

### Update
- **Agent Hub / shows the built-in agents and mine in sections** (`agent-hub.spec.ts`): add an assertion that the header shows "Skills" beside "New agent", opens the library, and "Back" returns. Fails on main: no button.
- **Agents and evals "10 questions" / "0/10 passed"** scenarios: step 7 runs `grep -n "10 questions\|/10" frontend/e2e/*.spec.ts` and changes literals to 12 / "0/12 passed" where found (spec now says 12; not verified in e2e files).
- Agent editor Acceptance count in the spec ("eight") becomes ten.

### Re-run as-is
- Agent editor: the other 8 (including the axe scan, which guards the two new fieldsets' labels).
- Agent Hub: the other 8, including the axe scan (header gained a button).
- Agent skills: "Shows the designer's built-in skill", "An agent without skills says so" (SQL Fixer is built-in), "A user skill and a project override", "A broken user skill".
- Agents: all 9 (detail payload only gains fields).
- Sessions started from an agent: the other 5 (the prompt gained "## Tools"/"## Skills"; ordering assertions must still hold).
- Skills the assistant is given: all 6. BA-216/217 rewrote the prompt builder and `read_file`; run first, edit assertions only on a real diff.
- chat-clarification, chat-and-visuals, world-cup-workflow, designer-skills, org-admin-edit-user, org-admin-users, org-permissions.

### Delete
- None.

## 3. New spec files and Feature "E2E:" lines
- New `frontend/e2e/skill-library.spec.ts` (web project).
- `specs/capabilities/agents-evals/spec.md`: Feature "Skill library" `E2E: none yet` becomes `E2E: frontend/e2e/skill-library.spec.ts`. Other E2E lines unchanged.
- Step 5 Gherkin gaps to close first (scenarios missing from the specs): Agent skills "In-app" level, Hub "Skills" button, Sessions tools+skills per turn, skills isolation (R74) in admin "Private and shared data", transfer copies skills, Agent definitions (API) skills/tools scenarios, library axe scan. Then run `python3 scripts/check-specs.py`.

## 4. Backend e2e (backend/test)
- `user-agents.e2e-spec.ts` (Feature "Agent definitions (API)"), add:
  1. Tools default to all three; `tools: ['sample_rows']` round-trips; an unknown tool id is refused (assert the DTO message).
  2. Publish copies assigned skills: POST /skills, assign to the draft, publish, PUT /skills/:id; the agent shows unpublished changes and its Live skill copy is unchanged. Fails on main: no `skills` field, /skills 404.
  3. Deleting a skill removes it from agent drafts and keeps the Live copy.
  4. Skills endpoints 94-98: create/get/list/save/delete; refusals for name pattern, built-in name, description not starting "Use when", missing referenced file, duplicate name per owner, more than 10 skills on an agent.
  5. Agent detail reports the tools and the In-app skills.
- `owner-isolation.e2e-spec.ts`: skills private (list, get, put, delete 404 for another user), following the agents block.
- `org-admin.e2e-spec.ts` (transfer near line 596): after transfer the new owner's `GET /skills` has the agent's skills and the agent's Live skill copies; the former owner keeps theirs; check admin.service for the name-clash rule and assert it.
- Re-run as-is: `agent-sessions`, `app`, `answer-guards`, `local-auth`, `org-auth`, `scim`, `response-status`.

## 5. Spec files for step 9
Web (`npm run test:e2e -- ...` in frontend/):
`e2e/agent-editor.spec.ts e2e/skill-library.spec.ts e2e/agent-hub.spec.ts e2e/agent-skills.spec.ts e2e/agents.spec.ts e2e/agent-sessions.spec.ts e2e/assistant-skills.spec.ts e2e/chat-clarification.spec.ts e2e/chat-and-visuals.spec.ts e2e/designer-skills.spec.ts e2e/world-cup-workflow.spec.ts`

Org (`npm run test:e2e:org -- ...`):
`e2e/org-isolation.spec.ts e2e/org-admin-edit-user.spec.ts e2e/org-admin-users.spec.ts e2e/org-permissions.spec.ts`

Backend: `npm test`, `npm run lint`, `npm run build`, plus backend e2e `user-agents`, `owner-isolation`, `org-admin`, `agent-sessions`, `app`.
Frontend: `npm test`, `npm run build`. Root: `python3 scripts/check-specs.py`.
Evals: the change touches what the agent receives (tools, prompt, skills catalog), so run `EVAL_SET=world-cup` on main and on the branch, same model and data dir, 100% x3, including `no-clarification-best-team` and `no-visuals-chart-request`.
Desktop: not run (no desktop-only scenario added); state it in the evidence README and PR.

## 6. Data for the new scenarios
- Model: `startLlmStub()` in `frontend/e2e/helpers/llm-stub.ts` as in `agent-editor.spec.ts`/`agent-sessions.spec.ts`. Read `stub.requests`, `turnRequests(stub, question)`, `systemTexts(request)`, `request.tools`; script `read_file` via `stub.reply` returning `{ toolCall: { name: 'read_file', arguments: { path } } }` as `assistant-skills.spec.ts` does. `saveLenaiSettings` in `helpers/agents-api.ts` points the app at the stub.
- Dataset: `seedWorldCupDataset(page)` in `helpers/agents-api.ts` (World Cup Postgres, `matches` table, `world-cup-db.ts`).
- Agents: `createUserAgent`, `saveAgentDraft`, `publishAgent` in `helpers/agents-api.ts`; extend `UserAgentInput` with `tools?` and `skills?`.
- Skills: add `createSkill(page, { name, description, body, files? })` and `updateSkill` to `helpers/agents-api.ts` on its private `call()` (POST/PUT `/skills`). Create skills through the UI only in `skill-library.spec.ts`.
- Org scenarios: `org.fixture.ts`, `admin-actions.ts` (`actAs`, `giveAgents`, `openAgents`) and `org-actions.ts`; for skills isolation call `/skills` with each person's client from `actAs`.
- Backend e2e: reuse `backend-process.ts`, `org-server.ts`, `oidc-stub.ts`, `world-cup.ts` as the existing files do.
