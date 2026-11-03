# BA-81 (roadmap 1.3.7): E2E impact analysis (workflow step 6)

Change under test: `90931c0` on `feat/BA-4-knowledge-store`, "memory of past sessions behind the LearningStore port, Mastra only". Written 2026-11-02, after the user accepted BA-81 by hand.

Decisions: **Add** (a new test), **Update** (an existing test changes), **Delete**, **Re-run** (run as it is, because the scenario exercises touched code), **None** (not impacted; not run).

## 1. What 90931c0 touched

| Layer | Touched | Reaches |
|---|---|---|
| Frontend | `app.ts` / `app.html`: a sixth Settings section, **Memory** (brain icon), between LLM Configuration and Testing Data | Settings area list, every Settings screen |
| Frontend | `features/memory/*` (new): `MemorySettings` (switch `Memory of past sessions`, toasts, embeddings line by `embeddingKey`), `MemoryApiService` (`GET`/`PUT /memory/settings`) | Settings → Memory |
| Frontend | `session-chat.*`: the thumbs-down's note (Add a note / Edit note, form, `Note: <note>`), the rating rollback now restores the note, memory entries in "Knowledge in context" (badge, title, line-by-line body, Forget with `window.confirm`, `Forgotten`, footnote sentence) | every assistant answer and clarification card |
| Frontend | `session.model.ts` (`feedbackNote`, `KnowledgeUse.kind/source`), `sessions-api.service.ts` (`note` on feedback, `forgetMemorySignal`) | ratings, Forget |
| Backend | `modules/memory/*` (new): lever, outbox, `MastraLearningStore`, embedder, learned block, Forget, compaction | every rating, every chat turn, datasource delete, start-up |
| Backend | `sessions.service.ts`: Block 3b in `agentContext` (chat turns only, lever on), `recordFeedback` with `note` and the memory side effects; `sessions.controller.ts` (`note`); `session.entity.ts` (`feedbackNote`) | every chat turn's context, every rating |
| Backend | `datasources.service.ts`: delete forgets the datasource's learning memory | datasource delete |
| Backend | `llm.service.ts`: `openAiApiKey()` | Settings → Memory's embeddings line, the embedder |
| Backend | `database.module.ts`, `doc-store.ts`, `sqlite-maintenance.ts`: the `memory_signals` collection, `app.sqlite` compaction | start-up, Forget, datasource delete |
| Backend | `knowledge-snippet.entity.ts`: `KnowledgeUse` kinds and `source` | the "Knowledge in context" record |
| Specs | knowledge R30 to R43 and the Feature "Memory from past sessions"; sessions-chat R36 and two new scenarios; ui.md 2, 4.12, 4.17, 7; api.md 7, 19, 108 to 110 | (contract for the above) |

Helpers grepped for copy or test ids the change removed (retrospective 2026-10-14): the change removes none. It changes one count: ui.md now lists **six** Settings sections; `navigation.spec.ts` asserted the five-item list, and `layout-accessibility.spec.ts` scans a fixed list of sections. app-shell R5 and its Gherkin still said "five sections": a step-5 gap, fixed on this branch (see section 3).

## 2. Per-scenario decisions

### knowledge: Feature "Memory from past sessions" (was `E2E: none yet`) → new `frontend/e2e/memory.spec.ts`

How it runs without a model: the app runs its real "Mastra only" memory; the recording LLM stub (LenAI) answers each turn with one `run_readonly_sql` on the World Cup database and writes the summary; a new **embeddings stub** (`e2e/helpers/embeddings-stub.ts`) stands in for `text-embedding-3-small` through `OPENAI_BASE_URL` + `OPENAI_API_KEY` (the framework's OpenAI provider reads both; checked in `@mastra/core`'s `createOpenAI`). What the memory holds is read from `app.sqlite` (`memory_signals`) and `mastra.sqlite` (learning thread, `memory_messages` index, resource working memory) by `e2e/helpers/memory-db.ts`.

| Scenario | Decision | Test |
|---|---|---|
| Memory is off by default (R30) | Add | `memory is off by default` (+ Gherkin step "no text was sent to the embedding model") |
| Turning memory on in Settings (R30) | Add | `turning memory on in Settings` (provider OpenAI seeded by rewriting the stored provider) |
| The key from the environment embeds when the provider is not OpenAI (R30, ui.md 4.17) | Add, new Gherkin | `the environment key embeds when the provider is not OpenAI` |
| No key for embeddings (R30) | Add | `no key for embeddings` (provider Anthropic seeded; `OPENAI_API_KEY` removed from the app's env) |
| An approval in one session informs a question in another language (R31, R33, R36, R38) | Add | `an approval in one session informs a question in another language` (the stub gives both questions one vector: proves the path, not a real model's recall) |
| A thumbs-down is kept as a rejection, with its note when it has one (R31, R33) | Add | `a thumbs-down is kept as a rejection, with its note when it has one` |
| Row values never reach the memory (R32) | Add | `row values never reach the memory` |
| Curated knowledge comes first and is said to win (R36, R37) | Add | `curated knowledge comes first and is said to win` |
| Rating an answer again, or changing its note, replaces what it taught (R39) | Add | `rating an answer again, or changing its note, replaces what it taught` |
| With memory off, re-rating an answer forgets what it taught (R30, R39) | Add | `with memory off, re-rating an answer forgets what it taught` |
| Forget a memory (R40, R42) | Add, Gherkin fixed | `forget a memory` |
| Deleting a datasource forgets what its sessions taught (R41) | Add | `deleting a datasource forgets what its sessions taught` |
| A memory that does not answer in time does not hold up a turn (R36) | Add | `a memory that does not answer in time does not hold up a turn` |
| Turning memory off keeps what it learned (R30) | Add | `turning memory off keeps what it learned` |

Not provable here, left to the memory eval (BA-190) on a real model: that a real embedding finds a paraphrase or another language, and that the assistant follows curated knowledge over a contradicting memory (R37). Left to unit tests (listed in the Feature's "Covered by"): R34's retries and giving up, R31/R35 with several datasources, R42's 2,000-character clip, R43 (grounding pass, deep analysis).

### sessions-chat: Feature "Chat answers and reliability signals" → new `frontend/e2e/chat-feedback.spec.ts` (second E2E line of the Feature)

| Scenario | Decision | Test |
|---|---|---|
| Saving an answer as a verified query | Add (was none yet; `rateMessage` and its rollback changed) | `saving an answer as a verified query` |
| Adding, editing and clearing the note of a thumbs-down (R36) | Add | `adding, editing and clearing the note of a thumbs-down` |
| A thumbs-up removes the note of a thumbs-down (R36) | Add | `a thumbs-up removes the note of a thumbs-down` |
| Answering a clarification | Re-run (the clarification card's "Knowledge in context" template changed) | `chat-clarification.spec.ts` |
| A malformed clarification is asked again, never shown without options | Re-run | `chat-clarification.spec.ts` |
| An answer shows how it was worked out…, A questionable query result…, Failed SQL is repaired…, Typing my own clarification…, Only the latest clarification card…, Careful mode…, A failed turn can be retried, Switching sessions mid-turn… | None (no E2E today; not touched beyond the shared template, which the tests above render) | — |

### sessions-chat: Feature "Chat and visuals" (`chat-and-visuals.spec.ts`)

| Scenario | Decision |
|---|---|
| Renders streamed reasoning, tool activity, final Markdown, and supports stopping | Re-run (answer template changed) |
| Renders a deterministic interactive visualization and its version controls | Re-run (the "Generate interactive visuals" block now follows the note block) |

### sessions-chat: Feature "Skills the assistant is given" (`assistant-skills.spec.ts`)

| Scenario | Decision |
|---|---|
| All five (only its own skills; without curated knowledge; with curated knowledge; old skills folder ignored; loads a skill) | Re-run: `agentContext` gained Block 3b; with the lever off (the default) the context must be byte-identical (R30) |

### sessions-chat: Feature "Sessions started from an agent" (`agent-sessions.spec.ts`)

| Scenario | Decision |
|---|---|
| All seven (the agent's instructions and model shape every turn, the read-only guard, tool selection…) | Re-run: they assert the order of the system messages `agentContext` builds |

### app-shell: Feature "Navigation rail" (`navigation.spec.ts`)

| Scenario | Decision |
|---|---|
| Opens Settings as an area with a section list | **Update**: the list is six sections, Memory third (Gherkin and R5 updated) |
| The app opens straight into the shell | **Update**: "every Settings section is reachable" now visits Memory |
| Moves between areas…, The start page…, Opens with the drawer expanded, Remembers a collapsed drawer…, Expands the rail…, Shows the details panel only on demand, Shows the product name | Re-run (same file) |

### app-shell: Feature "Layout and accessibility" (`layout-accessibility.spec.ts`)

| Scenario | Decision |
|---|---|
| Has no automatically detectable accessibility violations on any screen in either theme | **Update**: the scan now includes Settings → Memory (with no key, so the `warning-soft` notice is scanned) in both themes |
| Supports keyboard layout controls…, … in the application shell | Re-run (same file) |
| Matches the stable application-shell visual baseline | Re-run; known: no `application-shell-web-darwin.png` baseline on macOS, not regenerated |

### datasources: Feature "Datasources, datasets, and sessions (World Cup database)" (`world-cup-workflow.spec.ts`)

| Scenario | Decision |
|---|---|
| Preserves masked credentials when editing and supports datasource deletion | Re-run: delete now forgets the learning memory (R15, knowledge R41) and must not fail with nothing held |
| The other three | Re-run (same file) |

### llm-settings: Feature "LLM settings" (`llm-settings.spec.ts`)

| Scenario | Decision |
|---|---|
| Every automated scenario | Re-run: `llm.service.ts` gained `openAiApiKey()`; the settings document is read by the memory |

### knowledge: Feature "Knowledge snippets" (`E2E: none yet`)

| Scenario | Decision |
|---|---|
| An answer shows the knowledge it was given | None: still no spec file. The snippet's rendering in the changed disclosure is asserted by `memory.spec.ts` "curated knowledge comes first and is said to win" and by `session-chat.spec.ts` |
| The others | None (Knowledge screen untouched) |

### Not impacted (not run)

`session-management`, `agent-panel`, `agent-hub`, `agent-editor`, `agent-skills`, `agents` (Evals: eval runs neither recall nor retain, R43), `builtin-agent-prompts`, `skill-library`, `designer-skills`, `visual-tailoring`, `rfp-builder`, `testing-data`, `developer-settings`, `developer-observability`, `diagnostics`, `appearance`: none of their scenarios reaches the touched code beyond the shared start-up, which every run above boots.

## 3. Spec fixes on the branch (step 5, same branch)

- `specs/capabilities/app-shell/spec.md`: R5 and the scenario "Opens Settings as an area with a section list" said five sections; now six, naming Memory (ui.md already said six).
- `specs/capabilities/knowledge/spec.md`, Feature "Memory from past sessions":
  - "Forget a memory" said "its note is in neither file's bytes". That cannot hold for `app.sqlite`: the rated answer keeps its note (`feedbackNote`) and the answers that used the signal keep it in their record (R38, R40). Now: "no byte of mastra.sqlite holds its note and no byte of app.sqlite holds its outbox row"; and a step that the summary entry offers no Forget (edge case already in the spec).
  - New scenario "The key from the environment embeds when the provider is not OpenAI" (ui.md 4.17 had the copy; no scenario).
  - "Memory is off by default" gains "no text was sent to the embedding model" (the Acceptance's "no memory is called").
  - The `E2E:` line names `frontend/e2e/memory.spec.ts` and the stubs; a "Covered by" list maps each scenario to its unit tests.
- `specs/capabilities/sessions-chat/spec.md`: a second `E2E:` line for `frontend/e2e/chat-feedback.spec.ts`.
- `specs/system/api.md` 6.1: a row for `OPENAI_BASE_URL`, which the memory's embedder honours through the framework's OpenAI provider and which the suite points at the embeddings stub (the LLM settings' OpenAI connection test does not read it).

## 4. Run list (step 9 subset)

`memory`, `chat-feedback`, `navigation`, `layout-accessibility`, `chat-clarification`, `chat-and-visuals`, `assistant-skills`, `agent-sessions`, `world-cup-workflow`, `llm-settings`.
