# 1.10.1 — E2E impact analysis (step 6)

Components touched: backend `LlmService` (probe effort, effort on save, `effortLevels`), `LlmController` (`GET /llm/effort-levels`), `model-compat` (effort mapped per model), `model-resolver` (wider effort type), new `mastra/effort-levels`; frontend `LlmConfig` (effort select), `LlmApiService`, `llm.model`; E2E helper `llm-stub` (records probes and `reasoning_effort`).

| Spec / scenario | Capability Feature | Decision | Why |
|---|---|---|---|
| `llm-settings.spec.ts` › Offers the effort levels of the chosen model | LLM settings | **Add** | New select (R36, R37). |
| `llm-settings.spec.ts` › Tests a reasoning model at its lowest effort | LLM settings | **Add** | Probe effort (R16, R40) and R23's exception. |
| `llm-settings.spec.ts` › Saves the chosen effort and uses it on the next turn | LLM settings | **Add** | R38, R39, R41: stored, reloaded, sent on a turn. |
| `llm-settings.spec.ts` › the four existing scenarios | LLM settings | Re-run as-is | The stub deployment name now shows a Low/Medium/High select and the probe carries `reasoning_effort: low`; neither changes what they assert. |
| `agent-sessions.spec.ts`, `agent-editor.spec.ts`, `chat-and-visuals.spec.ts`, `world-cup-workflow.spec.ts` | Sessions and chat, Agents | Re-run as-is | They save LenAI settings through the API and send turns; turns now carry the mapped effort. |
| `layout-accessibility.spec.ts` (LLM Configuration in the axe scan and screenshots) | App shell | Re-run as-is | The form gains a select for the saved stub deployment; the axe scan must stay clean. |
| All other specs | — | Re-run as-is | Not affected; full suite run for regressions. |
| Gherkin "Sets the reasoning effort from the new-session composer" | LLM settings | Unchanged, not automated | The composer menu is out of scope. |
