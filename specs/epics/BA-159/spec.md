# BA-159 — LLM configuration

- **Jira:** [BA-159](https://halo-powered.atlassian.net/browse/BA-159) · **Roadmap:** Milestone 1.10 · **Status:** Confirmed

## Goal

Users can configure any model the app supports in Settings → LLM, including reasoning models such as `gpt-5`, and choose how hard it reasons from the levels that model actually offers.

Today, a reasoning model can't be configured at all. Test connection and Save both send a probe with the model's default reasoning, and `gpt-5` routinely takes longer than the 30 s probe limit, so the test fails and Save refuses. The reasoning effort is also a fixed `low / medium / high` list for every model, so levels such as `gpt-5`'s `minimal` can't be chosen, and models without reasoning still show a picker.

## Scope

- **Per-model effort levels.** A built-in table, keyed by model family, lists the reasoning-effort levels each model accepts, for example `minimal / low / medium / high` for `gpt-5`. The table is checked against the provider documentation when it is written. Unknown model names, such as LenAI deployment names that don't match a family, fall back to `low / medium / high`. Models without reasoning have no levels.
- **Effort picker in Settings → LLM.** Next to the model, the user picks an effort from the selected model's levels. Changing the model resets an effort the new model doesn't offer to that model's default. A model with no levels shows no picker. Save stores the chosen effort with the connection.
- **A connection test that doesn't time out.** The probe behind Test connection and Save asks for the lowest effort the model allows. It checks the key, the model and structured JSON output, not reasoning depth, so it stays well inside the 30 s limit. The effort the user chose applies to real turns.

## Out of scope

- The effort menu in the chat composer and the effort field in the agent editor. They keep today's `low / medium / high` list.
- Fetching each model's levels from the provider at runtime.
- Changing the 30 s probe limit.
- New providers or models.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-160](https://halo-powered.atlassian.net/browse/BA-160) | Per-model reasoning effort in LLM Settings | 1.10.1 |

All stories are built on one branch, `feat/BA-159-llm-configuration`, and ship as one PR.

## Specs touched

- [system/agents.md](../../system/agents.md): the per-model effort table, its fallback, and the probe's effort.
- [system/api.md](../../system/api.md): the effort field on the LLM settings and test-connection requests, and the allowed levels in the settings view.
- [system/data-model.md](../../system/data-model.md): the wider set of stored effort values.
- [system/ui.md](../../system/ui.md): the effort picker in Settings → LLM.
- The capability spec that owns Settings → LLM: rules and Gherkin for the picker and for testing and saving a reasoning model.

## Acceptance

- With `gpt-5` selected, Settings → LLM offers `minimal`, `low`, `medium` and `high`. Test connection succeeds, and Save stores the model and the chosen effort.
- Turns sent after saving use the chosen effort.
- A model without reasoning shows no effort picker and tests and saves as before.
- A model name the table doesn't know offers `low`, `medium` and `high`.
- Existing saved settings keep working after the upgrade.
- Every new or changed Gherkin scenario has a passing Playwright spec, and the existing Settings flows still pass.

## Dependencies, risks and open questions

- **Changing levels.** Providers change which levels a model family accepts (newer `gpt-5.x` models, for example, offer `none` and `xhigh`). The table needs an update whenever a family changes; the fallback keeps unknown models usable meanwhile.
- **Probe on the lowest level.** A model may pass the probe and still be slow on real turns at a high effort. That is expected: the probe proves the wiring, not the latency.
- **Chat menu mismatch.** Because the chat menu is out of scope, an effort set in Settings, such as `minimal`, can be outside the chat menu's list. The menu shows it as the current value but can't re-select it. A follow-up story can extend the per-model levels to the chat menu and the agent editor.
