# E2E impact (step 6) — 1.10.3 GitHub Copilot as an LLM provider

Read by `scripts/qa.mjs 1.10.3 --gate` ([delivery.md](../../specs/system/delivery.md) 13): first column the spec, second the decision. Target: web. The Copilot scenarios run against `frontend/e2e/helpers/copilot-runtime-stub.js`, a stub of the local Copilot runtime that the backend spawns through the SDK's own `COPILOT_CLI_PATH` variable. It was written from a recorded trace of the real runtime's JSON-RPC traffic.

## Components touched

| Layer | Component | Change |
|---|---|---|
| Backend | `mastra/copilot` (new) | Copilot runtime (one per process, sign-in status, model list) and the AI SDK model over it |
| Backend | `modules/llm` | Provider `copilot`: validate, save without a key, test, list models, `GET /llm/copilot/status`; effort levels by provider |
| Backend | `mastra/model-resolver`, `model-factory`, `model-compat`, `effort-levels` | Plain-data `copilot` config and its build |
| Backend | `modules/agents` | Provider name "GitHub Copilot" and effort levels in the agent's LLM detail |
| Frontend | `llm/llm-config`, `llm/llm-model-picker`, `llm-api.service`, `llm-models-api.service` | The GitHub Copilot option, the sign-in status line, hidden key/base URL/API style fields, Load models for Copilot |
| Frontend | `app.ts` | Composer chip `<model> · GitHub Copilot` |
| Frontend | `agents/agent-llm-config` | Copilot provider name in the agent's LLM Config tab |

## Decisions per spec

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/llm-copilot.spec.ts` | add | every scenario of `Feature: GitHub Copilot connection`: "Shows who is signed in to GitHub", "Configures GitHub Copilot by testing and saving with model auto" (the story's demo, `@demo`, `@story-1.10.3`), "Says how to sign in when no GitHub login is found", "Lists the seat's models", "A Copilot Free seat lists no models", "A chat turn runs on GitHub Copilot", "A tool call written as text is never shown" (R66, added after the first eval round), "Switching from GitHub Copilot to OpenAI asks for an API key" |
| `frontend/e2e/llm-settings.spec.ts` | re-run | all: the provider form, the model picker, the effort levels (now read by provider) and the composer chip changed |
| `frontend/e2e/llm-custom-endpoint.spec.ts` | re-run | all: Load models and the model picker now serve two providers |
| `frontend/e2e/agent-editor.spec.ts` | re-run | all: the agent's LLM Config tab reads the provider name and effort levels |
| `frontend/e2e/navigation.spec.ts` | re-run | all: the composer's reasoning-effort control reads effort levels by provider |
