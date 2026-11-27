# User agents run on Elena; Emily, Ryan and Rachel removed (approach B)

Decided by the user on 2026-11-26.

- **Built-in agents that stay:** Elena (`insights-lead`), plus the agents of Answer a Business Question (Avery + Michael):
  - Avery (`chief-of-staff`)
  - Michael (`insights-analyst`)
  - Clara (`bi-analyst`)
  - David (`sql-fixer`)
  - Hannah (`query-explainer`)
  - Nathan (`result-explorer`)
  - Laura (`assistant-eval-judge`)
- **Already removed** in `feat/elena-hosts-user-agents` (#165): Kevin, Olivia and Jessica.
- **This plan, approach B:** everything that runs on Emily (`assistant`) moves to Elena's conversation engine. Try it stays a draft that is never stored, and can now suspend and resume. Emily, Ryan (`visualization`, the visual designer) and Rachel (`sql-verifier`, careful mode) are deleted.
- **Defaults taken:**
  - Emily's eval sets are ported to Elena's target.
  - Try it keeps Elena's model routing (Opus 5.5 high on a Claude provider) unless the user agent sets a model.
  - The dashboard gate stays closed in Try it.
  - Stored visuals stay viewable (read-only viewer, revert, refresh).
  - Stored `crossCheck` stays as stored data only.

## 0. What the code says

**Turns today:**
- Stored sessions are read-only (ADR-0041).
- Turns run only on run hosts:
  - stored runs: Avery's (`orchestrated-answer-michael`) and Elena's (`agent:insights-lead`);
  - Try it drafts (`createDraftRunHost`, `sessions.service.ts` 584-611);
  - node chats (`workflow-node-chats.service.ts` 186-219);
  - the eval host (`createEvalHost(agentKey: 'assistant')`, `assistant.evals.ts` 1392-1407).

**After this change:**
- Drafts run on Elena with `agentKey: 'insights-lead'` on the host.
- The eval host is deleted.
- Node chats keep their workflow's `primaryFor` agent.
- `agent-turn` stays for node chats only.
- The turn engine's fallback for an unregistered key (`turn-engine.ts` 278-283) becomes `NotFoundException('Agent "<key>" not found')`.

**Proof rules:**
- **Inventory.** Elena's matrix hash must change, because she now reacts to user-agent contexts. So the inventory hashes per scenario and tags the user-agent scenarios. The proof:
  - Elena's plain hash and every untagged scenario stay identical;
  - only the tagged scenarios differ;
  - every other agent is identical in every scenario.
- **Try it model.** Draft hosts are `run: true`, so Try it moves from the saved model to Elena's Opus routing (`turn-engine.ts` 368-379). Her repair round is added too, so up to 2 attempts. An explicit user-agent model override wins over that routing.
- **Waiting drafts.** While a draft waits, the engine keeps a framework snapshot (`conversation-turn.workflow.ts` 108-111). It is deleted on resume, expiry or restart (`discardSuspendedWorkflowRuns`).
- **Memory handle.** The `MastraService` memory helpers (287, 293, 308, 321, 343, 397) move to `insights-analyst`, which has `sessionMemory()`. They go through one private `memoryHandle()` with the constant `MEMORY_HANDLE_AGENT_KEY`, and a spec fails if that agent loses its memory.
- **`schemaSnapshotBlock`** (`context-blocks.ts`): its callers were careful mode and Kevin's bootstrap. Delete it once neither remains.
- **ADR and endpoint numbers:** the new ADR is **ADR-0059** and the new endpoint is **169**. Amend ADR-0043 too.

## 1. Contracts (copy into api.md as written)

**Amended 129:**
> `POST /agents/:id/draft-runs/stream` … The agent turn runs on Elena's conversation engine (`insights-lead-conversation`, one step `answer`; ADR-0059) on a run host that is a preview-shaped session over the draft: Elena's prompt and checks, with the draft's instructions as context Block 5, its datasets that exist, its tool selection (`sample_rows`, `ask_clarification`; a stored `visuals` is ignored), its model and effort overrides (else Elena's routing) and its in-app skills after hers. The dashboard and export gates stay closed. Body: `{ input: { question: string } }` (no `careful`). The `run` event carries `workflowId: "agent:<id>"`. When Elena asks the user, the stream sends `step` (waiting), `input-required { runId, stepId: "answer", title: "Answer", question, options, expiresAt }` and `done { run }` with `run.status: "suspended"` and `run.waitingFor`; the waiting draft is held in server memory for 30 minutes, at most 20 of them (the oldest expires first), and continues with 169. Side effects: none kept once it ends (success, failure, stop, expiry or restart): its host, workspace, memory thread and the engine's snapshot are deleted. `done.run.agentKey` is `insights-lead`, `agentId` the user agent's id.

**New 169:**
> #### 169. `POST /agents/:id/draft-runs/:runId/resume/stream`
> - Body: `{ stepId: string; answer: string }`. Answers a draft run (129) that waits for the user and continues the same run, streamed as 129 (same events, no `seq`) and tied to the connection (closing it stops the run). Ends in `done { run }` (possibly `suspended` again) or `error`.
> - Refusals (Style B, before the stream): `404 "Agent \"<id>\" not found"`; `400 "Select at least one dataset to preview"`; `404 "Run \"<runId>\" not found"` (unknown, not this agent's, already resumed or ended); `410 "This run can no longer continue — run it again with your answer"` (its 30 minutes passed); `400 "Answer is required"`; `400 "Step \"<stepId>\" is not waiting for an answer"`.
> - Side effects: as 129. The held draft is taken out on a passing request, so it resumes once.

**Removed:** 130, 131 and 134 (Generate visual, Tailor visual, Repair visual), marked "Removed 2026-11-26" like 127.
- `GET /agents/assistant`, `/agents/visualization` and `/agents/sql-verifier` answer `404 "Agent \"<key>\" not found"`.
- api.md 33, 34, 34a and 103 say "a user agent runs on Elena". `memory` is `null` and `toolDetails` are Elena's under the selection.

**Shared module names (fixed):**
- `backend/src/mastra/tools/turn-context.ts`: `SESSION_ID_CONTEXT_KEY = 'session-id'`, `TURN_QUESTION_CONTEXT_KEY = 'turn-question'`. Monitoring reads `turn-question` (`session-trajectory.ts:278`).
- `backend/src/mastra/tool-section.ts`: `PromptTool`, `firstSentence`, `toolLines`, moved from `assistant-prompt.ts` 241-271.
- `backend/src/mastra/agent-skill-sources.ts`, renamed from `assistant-skills.ts`: `skillSourcesFor(agentKey, agentSkills)`, `frameworkSkills(sources)`, `referenceKey`, `servedPaths`.
- `EvalRunDetails.records?: { tool; input?; rows?; error? }[]`, owned by builder B.
- New model policy in `agent-factory.ts`: `'override-or-step-model'` = `resolveAgentModel(modelOverrideFrom(rc) ?? stepModelFrom(rc)?.model)`. `'user-override'` is deleted.

## 2. Builders (one owner per file)

| Builder | Owns |
|---|---|
| **A – backend core** | `backend/src/**` except `mastra/evals/**` and `modules/agents/eval-runs.service*`; plus `backend/test/**`, `scripts/agent-inventory*` |
| **B – evals** | `backend/src/mastra/evals/**`, `modules/agents/eval-runs.service(.spec).ts`, `backend/package.json` (scripts), `backend/eval/README.md` |
| **C – frontend** | `frontend/src/**`, `frontend/e2e/**` |
| **D – specs and docs** | `specs/**`, `.claude/skills/**`, `CLAUDE.md`, `lessons.md` mentions |

**Sequencing:**
- A1–A7, B, C and D run in parallel.
- A8 (delete Emily) waits for B, which removes `assistant.evals.ts`' imports of `assistantAgent` and the context keys.
- C's E2E runs on the merged result.

## 3. Builder A (backend core)

**A0 – characterization, on the base, first**
- New `backend/src/modules/sessions/turn/turn-options.spec.ts`: Elena's `agentOptions` for a plain run host (no `agentId`) deep-equal a committed snapshot (context blocks, requestContext keys, `maxSteps`, `providerOptions`).
- Record the base inventory: `node scripts/agent-inventory.mjs --json > .context/agents-base.json` after `npx nest build`.

**A1 – moves with no behaviour change**
- `PromptTool`/`firstSentence`/`toolLines` move into `tool-section.ts`.
- The context keys move into `tools/turn-context.ts`.
- `assistant-skills.ts` becomes `agent-skill-sources.ts`.
- `memoryHandle()` in `mastra.service.ts`.
- Check: A0 green, and `--compare` shows no change for any agent in any scenario.

**A2 – per-scenario inventory**
- `MATRIX_SCENARIOS` gets `userAgent: true` on `tools:*` and `user-override`.
- `tools:visuals+clarify` is renamed `tools:legacy-visuals+clarify`.
- New scenarios:
  - `user-agent:skills` (`'agent-skills': [{ name: 'matrix-skill', description: 'x', body: 'y', files: [] }]`);
  - `user-agent:override+step-model`;
  - `user-agent:no-clarify+gates:closed`.
- The runner returns `{ matrixHash, scenarioHashes }`.
- `compareInventories` names the scenarios that differ, and says "only user-agent scenarios" when that holds.
- Tests in `agent-inventory-lib.test.mjs`.

**A3 – Elena takes a user agent's definition**
- `mastra/agent-tools.ts`:
  - `OPTIONAL_AGENT_TOOLS = ['sample_rows','ask_clarification']`;
  - `RETIRED_AGENT_TOOLS = ['visuals']`, which `normalizeAgentTools` drops silently.
- `mastra/agent-links.ts`:
  - `LIBRARY_TOOLS` = `ask_clarification`, `describe_entity`, `explore_result`, `list_entities`, `run_readonly_sql`, `sample_rows`;
  - `ALWAYS_ON_TOOLS` = `describe_entity`, `explore_result`, `list_entities`, `run_readonly_sql`;
  - `RETIRED_LINK_TOOLS` = `create_visual`, `update_visual`, `show_in_panel`, `update_workflow`: accepted by link validation, resolved to plain mentions, never listed.
- `agents/insights-lead.agent.ts`:
  - `insightsLeadTools`: `sample_rows`/`ask_clarification` only when selected, in the same key order;
  - `insightsLeadSkills`: append `agentSkillsFrom(rc)` copies, which replace a catalogue skill of the same name, only when present;
  - `model: 'override-or-step-model'`.
- `workflows/insights-lead.prompts.ts` and `insightsLeadInstructions`: when `ask_clarification` is not offered, replace the "Ask at most one question…" line with an Elena-worded port of `NO_CLARIFICATION_RULES`. The repair rule stays last.
- `turn-options.ts`:
  - Elena branch of `agentOptions` (275-286): `const agent = session.agentId ? await this.agentConfigFor(session) : undefined`, before `DATASETS_CONTEXT_KEY` is set.
  - `analystAgentOptions` (297-337), after `KNOWLEDGE_USED`:
    - `AGENT_OVERRIDES_CONTEXT_KEY` when a model or effort is set;
    - `AGENT_TOOLS_CONTEXT_KEY` when the selection is not full;
    - `AGENT_SKILLS_CONTEXT_KEY`;
    - `providerOptions` with the agent's effort and model;
    - orientation selection;
    - Block 5 `agentInstructionsBlock(agent)` last in `context`, so it comes before the catalogue and plan blocks and the repair block stays last.
- `turn-engine.ts` 364-379:
  - a model override means no `soloModel`;
  - an effort-only override keeps Opus with the agent's effort;
  - evals keep the saved model unless there is an override.
- Tests, written first:
  - no `sample_rows` when it is not selected;
  - the no-clarification rule, with the repair cue still last;
  - the override wins over the step model;
  - no Opus step model under an override;
  - Block 5 order;
  - in-app skill after the catalogue, and replacing one of the same name;
  - A0 snapshot unchanged without an agent.
- Check: `--compare`: only `insights-lead` changes, only in tagged scenarios.

**A4 – Try it on Elena's engine**
- `createDraftRunHost`: `agentKey: INSIGHTS_LEAD_AGENT_KEY`.
- `turn/turn-workflow.ts` 41-63:
  - `TurnWorkflow.binding?`;
  - `kind 'user-agent'` → `{ engineId: INSIGHTS_LEAD_ENGINE_ID, bar: 'steps', stepIds: ['answer'], binding: { …Elena's, workflowId: 'agent:<id>', author } }`;
  - `conversationOfTurn` reads `workflow.binding`.
- `turn-engine.ts` ~909: no `saveDashboard` on a preview host.
- `prepareDraft` (560-602):
  - steps `INSIGHTS_LEAD_STEPS` with the user agent as the agent;
  - edges `INSIGHTS_LEAD_EDGES`;
  - `draftRunInput()` with the question only.
- Tests:
  - a draft turn runs `insights-lead-conversation` with the draft's instructions;
  - a preview gets no `submit_dashboard` and no artifact.

**A5 – a draft suspends and resumes, never stored**
- `workflow-runs.service.ts`:
  - `waitingDrafts = new SuspendedRuns<HeldRun>(expireDraft)`, capped at 20 (oldest expired first);
  - `runAgent` (~2191): a draft plus a suspension → `suspendDraft`;
  - `prepareDraftResume`, with the 169 refusals in order;
  - `resumeDraft`, like `resume` without `repository.update`;
  - `expireDraft`: `discard()`, `finishRunHost`, `deleteRunHostResources`.
- `draft-runs.controller.ts`: `@Post(':id/draft-runs/:runId/resume/stream')`.
- Tests, with fake timers:
  - suspend then resume, never stored (no `repository.insert` or `update`);
  - expiry after 30 minutes drops the host, workspace and snapshot;
  - a 21st waiting draft expires the oldest;
  - the refusals (404 twice, 410, 400 step, 400 blank);
  - Stop during a resume ends `stopped` and deletes the host.

**A6 – Rachel and careful mode**
- `sql-checks.ts`: delete 260-428 and 495-505; keep `matchesVerifiedQuery` (430-455).
- Delete `sql-verifier.agent.ts` and `SQL_VERIFIER_PROMPT`.
- `CAREFUL_FIELD` and the `careful` parameter go everywhere: `streamRunTurn`, `streamTurn`, the deps, `workflow-runs` ~1007, node chats ~216, `testing/stream-stored.ts`.
- `crossCheck` stays as stored data only.

**A7 – Ryan's designer, viewer kept**
- Delete `visualization.agent.ts`, `chart-heuristic.ts`, `mastra/skills/interactive-visuals/` and `HARNESS_SKILLS.visualization`.
- `visualization.service.ts`:
  - delete create, createFromAnswer, update, repair, appendVersion, design*, designerPrompt, runDesigner;
  - keep load, download, revert, refreshData, find, contextFor, writeVersion, read*.
- `sessions.service.ts` ~1220-1310: delete generate, tailor and repair.
- Delete endpoints 130, 131 and 134, and `builtVisualEvent`.

**A8 – Emily (after B)**
- Unregister `assistant`, `visualization` and `sql-verifier` (index, personas, constants, shipped prompts).
- Delete `assistant.agent.ts` and `assistant-prompt.ts`, plus their specs.
- Delete `visual.tools.ts`, `panel.tool.ts` and `workflow.tool.ts`, with their bridges.
- `turn-records.ts`: delete `ASSISTANT_AGENT_KEY` and the tool-name constants.
- `turn-engine.ts`:
  - the fallback becomes the 404;
  - delete `isAssistant`, the grounding guard (1139-1155) and the visual and panel handling.
- `turn-options.ts`: delete `agentContext`.
- `workflow-catalog.ts`:
  - delete `WRAPPED_AGENT_KEYS`;
  - `agent:assistant` stays a retired stored id, and its chip still reads "Assistant".
- `effectiveWorkflowFor`: `session.agentKey ? [] : parseWorkflow(config?.instructions ?? '')`.
- `agents.service.ts`: a user agent's detail and skills come from Elena.
- `agent-prompts.service.ts`: drop the assistant branch.
- `app-skills.ts`: `AGENT_SKILLS.assistant` goes.
- Tests:
  - `agent:assistant` chip;
  - a past chat with `crossCheck`, `visual` and panel items still opens;
  - an unregistered key answers 404;
  - removed keys' overrides are ignored.

**A9 – backend e2e**
- `test/user-agents.e2e-spec.ts`
- `test/response-status.e2e-spec.ts`: 130, 131 and 134 answer 404; 169's refusals.
- `test/workflows.e2e-spec.ts`

## 4. Builder B (evals)

- **E1 – runner**
  - Delete the assistant case data, `ASSISTANT_EVAL_TARGET`, `createEvalHost`/`cleanupEvalHost` and the session and turn-records keys in `evalRequestContext`. Keep `turn-question`, imported from `turn-context.ts`.
  - `runResultSetCheck` reads `details.records` when there are no turn records.
  - `eval-runs.service.ts`: no eval host.
- **E2 – Elena's target**
  - `insights-lead-target.ts`: `records` on `evalDetails`.
  - `insights-lead-eval-checks.ts`: add `answerIncludes`, `answerMatches`, `calledTool`, `didNotCall`, `noToolErrors`, `toolOrder`.
- **E3 – the port**
  - New `insights-lead-data.evals.ts` with the sets `world-cup`, `world-cup-excel`, `world-cup-rest` and `formula-1`.
  - `agentKey: 'insights-lead'`, `target: INSIGHTS_LEAD_EVAL_TARGET`, with the old ids, `expectedSql` and rubrics.
  - Ambiguous cases check `runEndsIn(['suspended'])`.
  - Dropped: `visual-request`, `f1-visual-request`, `no-visuals-chart-request` and the `schema-notes` set (its orientation seam does not exist on a real run).
  - `no-clarification-best-team` is kept as a user-agent draft case if feasible, otherwise dropped with a note.
- **E4**
  - `eval-sets.ts`: `agentKey` becomes required.
  - `run-assistant-evals.ts` becomes `run-evals.ts`; script `evals` replaces `evals:assistant`.
  - Update `backend/eval/README.md`.

## 5. Builder C (frontend)

- **F1 – Try it waiting card and resume (169)**
  - New `waiting` state in `agent-try-it.ts`, using `<app-workflow-run-input-required>`.
  - `resumeDraftRun` in `workflow-runs-api.service.ts`.
  - A 410 marks the card expired and offers a rerun with the answer appended.
- **F2 – editor:** `visuals` leaves the defaults and `AgentToolId`; `prompt-links.ts` lists Elena's library tools.
- **F3 – hub:**
  - `EVERY_AGENT_SKILL_OWNERS = new Set(['insights-lead'])`;
  - `agent-hub.util.ts` fallback is `insights-lead`;
  - `official-links.ts` drops the assistant branch.
- **F4 – designer UI:** remove Generate (answer view, run detail), Tailor and auto-repair (interactive-visual-panel), `run-visuals-state.generate`, the api client's generate/tailor/repair, and `visual-tailor` in `background-tasks`.
- **F5:** remove the cross-check chip and the `session.model.ts` field use.
- **F6 – E2E:**
  - `agent-editor.spec.ts`: Try it on Elena, plus a new suspend → answer → continues test with nothing stored.
  - `agent-sessions.spec.ts`
  - `agent-hub.spec.ts`
  - `agents.spec.ts`
  - `builtin-agent-prompts.spec.ts`
  - `agent-skills.spec.ts`
  - `layout-accessibility.spec.ts`
  - `monitoring-agent-quality.spec.ts`
  - `chat-history-nav.spec.ts`
  - `runs.spec.ts`
  - `visual-tailoring.spec.ts`: keep the stored-visual theme tests; drop generate and tailor.
  - `designer-skills.spec.ts`: delete.
  - `agent-panel.spec.ts`: seed a stored visual.
  - `workflow-runs.spec.ts`
  - `chat-and-visuals.spec.ts`

## 6. Builder D (specs)

- **agents.md:**
  - 1.1/1.2, 1.3 (new policy), 1.5 (remove);
  - 2.1/2.2/2.4 become "removed 2026-11-26" stubs; 2.23 (user agents on Elena);
  - 3.6/3.7/3.11/3.12 removed; 4.1/4.2;
  - 5.1/5.6/5.8/5.10; 5.12 (retired `agent:assistant`); 5.14 (draft host);
  - 6 (designer removed; 6.8/6.9 kept as the renderer contract); 7.2/7.4/7.5; 8.1/8.3.
- **agent-answers:** R18-R24, R37-R40, R52-R61.
- **agents-evals:**
  - R60/R61 (draft suspends and resumes);
  - R75 (Elena);
  - R43 (`visuals` ignored).
- **Other capability specs:** visuals (designer rules out, viewer kept); workflows (R1/R2/R27 and run-host notes).
- **api.md:** as in section 1.
- **data-model.md:**
  - 3.4 (`crossCheck` stored only);
  - 3.10 (tools);
  - 3.10.3 (orphaned keys).
- **ui.md:** 4.5.x (Try it waiting card).
- **architecture.md:** amend ADR-0008, 0022, 0025, 0029, 0040, 0041, 0042, 0043 and 0058; add **ADR-0059** "User agents run on Elena's conversation engine".
- **Then:**
  - `node scripts/spec-index.mjs`;
  - `check-specs.py`;
  - update `.claude/skills/verify/SKILL.md`, `delivery.md` and `tech-stack.md` for the evals script;
  - grep `.claude/skills` for stale "assistant" guidance.

## 7. Final checks and what to measure

- `node scripts/agent-inventory.mjs --compare` against the base:
  - removed: `assistant`, `visualization`, `sql-verifier`;
  - changed: `insights-lead`, in tagged scenarios only.
- `qa.mjs --free`, plus the E2E list in F6.
- `schemaSnapshotBlock` has no caller.
- **Evals, 3 runs each, with the model agreed with the user first:**
  - Elena's own set, base vs branch: expect equal.
  - Ported sets on the branch (Elena) vs the base (Emily) on the same ids, 35 cases × 3 runs × 2 builds.
