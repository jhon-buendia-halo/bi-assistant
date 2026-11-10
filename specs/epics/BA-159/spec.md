# BA-159 — LLM configuration

- **Jira:** [BA-159](https://halo-powered.atlassian.net/browse/BA-159) · **Roadmap:** Milestone 1.10 · **Status:** Confirmed (GitHub Copilot scope confirmed by the user on 2026-11-09)

## Goal

Users can configure any model the app supports in Settings → LLM, including reasoning models such as `gpt-5`, and choose how hard it reasons from the levels that model actually offers.

Today, a reasoning model can't be configured at all. Test connection and Save both send a probe with the model's default reasoning, and `gpt-5` routinely takes longer than the 30 s probe limit, so the test fails and Save refuses. The reasoning effort is also a fixed `low / medium / high` list for every model, so levels such as `gpt-5`'s `minimal` can't be chosen, and models without reasoning still show a picker.

## Scope

- **Per-model effort levels.** A built-in table, keyed by model family, lists the reasoning-effort levels each model accepts, for example `minimal / low / medium / high` for `gpt-5`. The table is checked against the provider documentation when it is written. Unknown model names, such as LenAI deployment names that don't match a family, fall back to `low / medium / high`. Models without reasoning have no levels.
- **Effort picker in Settings → LLM.** Next to the model, the user picks an effort from the selected model's levels. Changing the model resets an effort the new model doesn't offer to that model's default. A model with no levels shows no picker. Save stores the chosen effort with the connection.
- **A connection test that doesn't time out.** The probe behind Test connection and Save asks for the lowest effort the model allows. It checks the key, the model and structured JSON output, not reasoning depth, so it stays well inside the 30 s limit. The effort the user chose applies to real turns.

- **UI preferences (added 2026-10-10 at the user's request).** The app opens in the Light theme with the navigation drawer expanded. The user's theme choice and drawer state are stored in the backend (ADR-0009), with a browser copy for the first paint. Not LLM configuration, but shipped in this epic's PR by the user's choice.

- **GitHub Copilot provider (added 2026-11-09 at the user's request).** A developer with a GitHub Copilot seat can pick **GitHub Copilot** in Settings → LLM Configuration and run every agent on that seat, with no API key and no spend beyond the seat. The app reuses the GitHub login already on the machine and talks to Copilot through GitHub's official Copilot SDK, which runs a local Copilot runtime. The app's agents keep their own tools, prompts and structured outputs: Copilot's built-in tools are switched off, and tool calls are handed back to the app (ADR-0037). The model defaults to `auto`, where Copilot picks one from the seat's plan (all a Copilot Free seat allows); **Load models** lists the models a paid seat can choose. Answers stream word by word. The runtime ships inside the desktop installers and the npm package.

## Out of scope

- The effort menu in the chat composer and the effort field in the agent editor. They keep today's `low / medium / high` list.
- Fetching each model's levels from the provider at runtime.
- Changing the 30 s probe limit.
- New providers or models, apart from GitHub Copilot (added 2026-11-09).
- For GitHub Copilot: a Sign in with GitHub button or pasted GitHub tokens, Copilot's own bring-your-own-key mode, running evals from the CLI against Copilot, and a different provider per agent.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-160](https://halo-powered.atlassian.net/browse/BA-160) | Per-model reasoning effort in LLM Settings | 1.10.1 |
| [BA-168](https://halo-powered.atlassian.net/browse/BA-168) | Light theme and open navigation drawer by default, remembered in the database | 1.10.2 |

| — | GitHub Copilot as an LLM provider | 1.10.3 |
| — | Ship the Copilot runtime in the installers and the npm package | 1.10.4 |

Stories 1.10.1–1.10.2 were built on `feat/BA-159-llm-configuration` and shipped as one PR. Stories 1.10.3–1.10.4 have no Jira keys (Jira is no longer used from 2026-11-09); they are built on `feat/BA-159-github-copilot-provider`. At the user's request (2026-11-10), 1.10.3 ships as a second PR on its own, and 1.10.4 follows in a later one.

## Specs touched

- [system/agents.md](../../system/agents.md): the per-model effort table, its fallback, and the probe's effort.
- [system/api.md](../../system/api.md): the effort field on the LLM settings and test-connection requests, and the allowed levels in the settings view.
- [system/data-model.md](../../system/data-model.md): the wider set of stored effort values.
- [system/ui.md](../../system/ui.md): the effort picker in Settings → LLM.
- The capability spec that owns Settings → LLM: rules and Gherkin for the picker and for testing and saving a reasoning model.
- [capabilities/app-shell/spec.md](../../capabilities/app-shell/spec.md): R2, R39, R43, R50 and the drawer and appearance scenarios; [system/architecture.md](../../system/architecture.md) ADR-0009; [system/api.md](../../system/api.md) 2.12; [system/data-model.md](../../system/data-model.md) 3.2.1 and M12 (BA-168).
- GitHub Copilot (1.10.3–1.10.4): [capabilities/llm-settings](../../capabilities/llm-settings/spec.md) (R1 and new rules, UI, Gherkin); [system/architecture.md](../../system/architecture.md) ADR-0037; [system/api.md](../../system/api.md) 2.5; [system/data-model.md](../../system/data-model.md) 3.2; [system/agents.md](../../system/agents.md) 1.3–1.5; [system/ui.md](../../system/ui.md); [system/tech-stack.md](../../system/tech-stack.md); [system/delivery.md](../../system/delivery.md) (1.10.4); [product/glossary.md](../../product/glossary.md).

## Acceptance

- With `gpt-5` selected, Settings → LLM offers `minimal`, `low`, `medium` and `high`. Test connection succeeds, and Save stores the model and the chosen effort.
- Turns sent after saving use the chosen effort.
- A model without reasoning shows no effort picker and tests and saves as before.
- A model name the table doesn't know offers `low`, `medium` and `high`.
- Existing saved settings keep working after the upgrade.
- Every new or changed Gherkin scenario has a passing Playwright spec, and the existing Settings flows still pass.
- GitHub Copilot: with a signed-in seat, the user picks GitHub Copilot, sees their GitHub login, tests and saves with model `auto`, and a chat turn answers with real tool calls and streamed text. With no GitHub login on the machine, the test says how to sign in and nothing is saved. The desktop installer and the npm package work without a separate Copilot install.

## Dependencies, risks and open questions

- **Changing levels.** Providers change which levels a model family accepts (newer `gpt-5.x` models, for example, offer `none` and `xhigh`). The table needs an update whenever a family changes; the fallback keeps unknown models usable meanwhile.
- **Probe on the lowest level.** A model may pass the probe and still be slow on real turns at a high effort. That is expected: the probe proves the wiring, not the latency.
- **Chat menu mismatch.** Because the chat menu is out of scope, an effort set in Settings, such as `minimal`, can be outside the chat menu's list. The menu shows it as the current value but can't re-select it. A follow-up story can extend the per-model levels to the chat menu and the agent editor.
- **GitHub Copilot.** Each prompt counts against the user's Copilot allowance (about 0.4 of a Free seat's 200 monthly chat credits per assistant question in the spike), so heavy users on Free seats will run out. The call that hands tool results back to Copilot (`handlePendingToolCall`) is marked experimental in SDK 1.0.30. The runtime adds about 180 MB to each installer. The Copilot terms describe Copilot Free as for personal use; company use on Free seats is the user's call.
