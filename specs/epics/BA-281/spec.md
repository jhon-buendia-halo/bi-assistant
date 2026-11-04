# BA-281 — Custom LLM endpoint provider

- **Jira:** [BA-281](https://halo-powered.atlassian.net/browse/BA-281) · **Roadmap:** Milestone 1.17 · **Status:** Confirmed (by the user on 2026-11-03)

## Goal

The app can run on any model server the user controls or chooses, not only OpenAI, Anthropic and LenAI: a self-hosted model (Ollama, LM Studio, vLLM), a gateway (LiteLLM) or a relay that speaks the OpenAI or Anthropic API. The user picks **Custom endpoint**, says which API the server speaks, gives its base URL, an API key if it needs one, and a model, which they can pick from the server's own model list.

## Scope

- **Provider.** A fourth provider, `custom` ("Custom endpoint"), with an **API style**:
  - **OpenAI-compatible**: the base URL includes the API version path (e.g. `http://127.0.0.1:8317/v1`); the key is sent as `Authorization: Bearer`.
  - **Anthropic-compatible**: the base URL is the server root (e.g. `http://127.0.0.1:8317`); the key is sent as `x-api-key`.
- **Settings.** Base URL is required. The API key is optional (local servers often need none) and, when given, is encrypted at rest and masked like every other key. The model is free text.
- **Load models.** The form lists the endpoint's models from its models list (`<base>/models` in the OpenAI style, `<root>/v1/models` in the Anthropic style; with the typed key, or the stored one when none is typed); any typed name is still accepted.
- **Test connection** works per API style, tolerating OpenAI-compatible servers without strict JSON-schema support, and reports clear texts for an unreachable host, a wrong path (404), a rejected key (401), a rate limit and a timeout.
- **Everywhere a model runs**: every agent, tool, stream and structured call, effort levels (by model name), the visual designer and the eval runner use the custom endpoint. Chat errors on a failing endpoint name its host and the fix.
- **Safety.** Keys never appear in API responses, logs or diagnostics.
- **Docs.** Example settings for common servers.

## Out of scope

- The Claude local-login approach (BA-264, cancelled 2026-11-03).
- Several endpoints at once, or a different endpoint per agent.
- Custom headers, client certificates, or OAuth flows to the endpoint.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-282](https://halo-powered.atlassian.net/browse/BA-282) | Settings service: validate, save, view and resolve | 1.17.1 |
| [BA-283](https://halo-powered.atlassian.net/browse/BA-283) | URL normalisation and model route per API style | 1.17.2 |
| [BA-284](https://halo-powered.atlassian.net/browse/BA-284) | Anthropic-compatible model factory | 1.17.3 |
| [BA-285](https://halo-powered.atlassian.net/browse/BA-285) | OpenAI-style connection probe | 1.17.4 |
| [BA-286](https://halo-powered.atlassian.net/browse/BA-286) | Anthropic-style connection probe | 1.17.5 |
| [BA-287](https://halo-powered.atlassian.net/browse/BA-287) | List models from the endpoint | 1.17.6 |
| [BA-288](https://halo-powered.atlassian.net/browse/BA-288) | Tuning and effort levels | 1.17.7 |
| [BA-289](https://halo-powered.atlassian.net/browse/BA-289) | Visual designer model selection | 1.17.8 |
| [BA-290](https://halo-powered.atlassian.net/browse/BA-290) | Agent catalogue provider display | 1.17.9 |
| [BA-291](https://halo-powered.atlassian.net/browse/BA-291) | Clear chat errors for unreachable or misconfigured endpoints | 1.17.10 |
| [BA-292](https://halo-powered.atlassian.net/browse/BA-292) | Key redaction in logs and diagnostics | 1.17.11 |
| [BA-293](https://halo-powered.atlassian.net/browse/BA-293) | Settings form: provider, API style, base URL and key | 1.17.12 |
| [BA-294](https://halo-powered.atlassian.net/browse/BA-294) | Load models dropdown | 1.17.13 |
| [BA-295](https://halo-powered.atlassian.net/browse/BA-295) | Provider display in the agent page and composer | 1.17.14 |
| [BA-296](https://halo-powered.atlassian.net/browse/BA-296) | E2E for the OpenAI style | 1.17.15 |
| [BA-297](https://halo-powered.atlassian.net/browse/BA-297) | Anthropic API stub and E2E fixture | 1.17.16 |
| [BA-298](https://halo-powered.atlassian.net/browse/BA-298) | E2E for the Anthropic style | 1.17.17 |
| [BA-299](https://halo-powered.atlassian.net/browse/BA-299) | Live smoke script against a real endpoint | 1.17.18 |
| [BA-300](https://halo-powered.atlassian.net/browse/BA-300) | Run evals against a custom endpoint | 1.17.19 |
| [BA-301](https://halo-powered.atlassian.net/browse/BA-301) | User docs for common endpoints | 1.17.20 |

## Specs touched

- [capabilities/llm-settings](../../capabilities/llm-settings/spec.md): R1 (four providers), base URL and key rules, probe, routes, tuning, model listing, UI, Gherkin.
- [system/architecture.md](../../system/architecture.md): ADR-0032 (models for the Anthropic-compatible style are built with `@ai-sdk/anthropic` outside Mastra's router, which cannot target a custom Anthropic base URL).
- [system/api.md](../../system/api.md) §2.5: provider union, `apiStyle`, validation texts, the model-list route.
- [system/data-model.md](../../system/data-model.md) §3.2: `apiStyle`; `apiKeyCiphertext` optional for `custom`.
- [system/agents.md](../../system/agents.md) §1.3–1.5 and 8.5: resolver table, tuning, visual designer, eval runner environment variables.
- [system/tech-stack.md](../../system/tech-stack.md): the `@ai-sdk/anthropic` dependency.
- [system/ui.md](../../system/ui.md): the LLM Configuration form, the agent page's Model tab and the composer chip.
- [product/non-functional.md](../../product/non-functional.md) (secrets, redaction) and [product/glossary.md](../../product/glossary.md).

## Acceptance

- `python3 scripts/check-specs.py`, backend and frontend unit tests, lint and builds are green.
- The live smoke script passes against a real endpoint in **both** API styles (the user's local server at `127.0.0.1:8317`): models load, the connection test passes, one assistant turn answers using a tool, and the key appears in no response, log or data file.
- Hand test: configure, load models, test, save and chat in Settings and a session.
- Acceptance gate: the two Playwright specs (OpenAI style on the existing LLM stub, Anthropic style on an Anthropic stub) pass on the web target, and the assistant evals pass on a custom endpoint (3/3 per case) compared with `main`.

## Dependencies, risks and open questions

- **Depends on** the LLM settings capability and ADR-0004 (Mastra, models resolved at call time).
- **Risk:** OpenAI-compatible servers differ in what they support (strict JSON schema, tool calls, streaming usage); the probe degrades gracefully, but a server without tool calling cannot run the agents and is reported as such.
- **Risk:** `@ai-sdk/anthropic` must match the AI SDK major bundled in `@mastra/core` 1.66.
- **Open question:** none.
