# LLM settings

The user chooses which language model powers every agent in the app: a provider, a model (or deployment name), an API key and, for Halo's gateway, a base URL. The configuration is proven to work before it is saved, the key is stored encrypted and is never shown again, and the choice applies to the very next agent call without restarting anything. A single global reasoning-effort setting tunes how hard models that support it think, chosen from the levels the selected model accepts.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): LLM provider, reasoning effort, app secret, agent, assistant, data directory.

Capability-local vocabulary:
- **Deployment name** — for `lenai`, the value of the "model" field; it names a deployment on the gateway rather than a model.
- **Connection probe** — the fixed, cheap request used to test a configuration (see R13 to R19).
- **Model route** — the provider-qualified identifier an agent call uses, `<provider>/<model>`.
- **Effort levels** — the reasoning-effort values a model accepts, lowest first, from the built-in table in [../../system/agents.md](../../system/agents.md) 1.4 (see R36 to R41).

## Rules

Configuration
- R1. The system SHALL support exactly three providers: `openai` (shown as "OpenAI"), `anthropic` ("Anthropic") and `lenai` ("LenAI (Halo gateway)"). Any other provider SHALL be rejected with `provider must be one of: openai, anthropic, lenai`.
- R2. There SHALL be one global configuration, shared by every agent and every session. It SHALL hold: provider, model, base URL (may be empty), the encrypted API key and the reasoning effort.
- R3. The model SHALL be a free-text, non-empty value after trimming; otherwise `model is required`. For `lenai` it is labelled "Deployment name".
- R4. For `lenai`, the base URL SHALL be required (`baseUrl is required for lenai`). It is the gateway root. Requests for a deployment SHALL go to `<base URL without trailing slashes>/openai/v1/deployments/<deployment>`, carrying the key both as a bearer credential and in an `X-Api-Key` header.
- R5. For `openai` and `anthropic` the base URL SHALL NOT be required and SHALL NOT be used: `openai` goes to the provider's public API and `anthropic` to its native API.
- R6. The API key SHALL be required the first time. When a request omits the key or sends a blank one, the system SHALL use the stored key; if none is stored, it SHALL fail with `apiKey is required — none stored yet`.
- R7. Reasoning effort SHALL default to `high`. The composer menu (R8) SHALL set only `low`, `medium` or `high`; setting any other value there SHALL fail with `reasoning effort must be one of: low, medium, high`, and setting it before any configuration has been saved SHALL fail with `Configure and save the LLM first — no settings stored yet`. Saving SHALL store the effort chosen in Settings (R38), or, when none is sent, keep the stored effort if the model accepts it and otherwise use the model's default (R36).
- R8. The reasoning effort SHALL be changeable from the new-session composer (a small chip beside the model name) without opening Settings. Success shows "Reasoning effort set to <effort>".

Key protection
- R9. The API key SHALL be stored only in encrypted form: AES-256-GCM with a 256-bit key derived (SHA-256) from the app secret, a fresh random 12-byte IV per encryption, stored as `iv:tag:data` (each base64).
- R10. The system SHALL NEVER return the key in plaintext. The settings view SHALL carry a masked form: eight bullet characters followed by the key's last four characters. The settings screen SHALL show that mask as the key field's placeholder, leave the field itself empty, and keep the stored key unless a new one is typed.
- R11. The app secret SHALL never be a fixed, known value. When no `APP_SECRET` is given, the backend SHALL read `.app-secret` from its data directory, or generate and persist it there on first run, exactly as desktop and web mode do (see [../../product/non-functional.md](../../product/non-functional.md)).
- R12. The key SHALL be decrypted only in memory, at the moment a model call or a connection probe needs it.
- R33. At backend startup, a stored key that the current app secret cannot read but the former fixed development secret (`insecure-dev-secret`, used before the backend persisted its own secret) can SHALL be re-encrypted with the current secret and saved, leaving every other field unchanged. Installs that saved a key before the desktop app persisted a secret therefore keep their key.
- R34. When the stored key cannot be read with the current app secret (and R33 does not apply), reading the settings SHALL NOT fail: the view SHALL report `configured: false`, `keyUnreadable: true`, the stored provider, model, base URL and reasoning effort, and no masked key.
- R35. The settings screen SHALL then fill in provider, model and base URL and show "Your saved API key can't be read because the app secret changed. Enter the key again, test and save." until a new key is saved. An agent call, and a test or save that does not carry a new key, SHALL fail with `The saved API key can't be read because the app secret changed — enter it again in Settings → LLM Configuration`.

Testing a connection
- R13. The user SHALL be able to test a configuration without saving it. The system SHALL send the candidate configuration (not the saved one) through a probe and report the outcome.
- R14. The probe SHALL ask the model for a JSON object `{ "status": "<non-empty string>" }` under a strict JSON schema, using the same structured-output request every agent makes. A model that answers in free text SHALL NOT pass.
- R15. A pass SHALL be reported as `Connection successful — <provider>/<model> replied "<status>" in <N>ms`.
- R16. The probe SHALL time out after 30 seconds (`LLM request timed out after 30s`). It SHALL ask for the model's lowest effort level (R40), so a reasoning model answers within the limit.
- R17. For OpenAI-compatible routes (`openai`, `lenai`) the probe SHALL cap output at 512 tokens, or 4,096 for models in the families that count hidden reasoning against the cap (gpt-5 and later, o1 to o4, written to survive gateway-mangled deployment names). Those families SHALL be sent the cap under the name `max_completion_tokens`; all others under `max_tokens`.
- R18. Failures SHALL be reported in these words (the part after the dash varies):
  - network failure: `Provider unreachable — <detail>`
  - HTTP 401: `Authentication failed (401) — check the API key`
  - other HTTP errors: `Provider request failed (<status>) — <first 300 characters of the body>`
  - empty reply cut off by the cap: `Model hit the <cap>-token limit before replying — reasoning models spend that budget thinking first; try a lower reasoning effort or a non-reasoning model`
  - the model refused: `Model refused the connection probe — <first 200 characters of the refusal>`
  - reply that is not the required JSON: `Model answered but could not produce structured JSON output, which every agent here requires — reply="<first 200 characters>"`
- R19. For `anthropic` the probe SHALL go through the same agent runtime the app uses for real calls (so provider-specific structured-output handling is proven), with a 512-token cap, and report failures with the same 401, status, unreachable, timeout and structured-output messages.
- R20. A failed test, a failed save or an unreachable backend SHALL be shown as an error toast; a success as a success toast. A failed save reports the same message the test would.

Saving
- R21. Saving SHALL re-run the probe with the submitted configuration and SHALL persist only if it passes. A failed save SHALL leave the previous configuration untouched.
- R22. The save and test endpoints SHALL answer with an ok flag and a message in the response body; a validation or probe failure SHALL NOT be an HTTP error. A successful save reports `Configuration saved`.
- R23. The settings screen SHALL enable **Save connection** only after a successful **Test connection** with the current field values; editing any field except **Reasoning effort** SHALL withdraw that permission (the probe doesn't use the chosen effort, R40). **Test connection** SHALL be enabled when a model is entered (and a base URL for `lenai`) and no test is running, and SHALL read "Testing…" while it runs. **Save connection** SHALL read "Saving…" while it runs.

Fallback
- R24. When nothing has been saved, the settings view SHALL report `configured: false`, no provider, model, base URL or key, and reasoning effort `high`. The new-session composer SHALL then show "No model configured".
- R25. When nothing has been saved, agents SHALL still run, using the route `openai/gpt-4o-mini` with the key taken from the `OPENAI_API_KEY` environment variable. If that variable is also unset the model call fails and surfaces as an ordinary error.

Applying the settings
- R26. Every agent SHALL resolve its model from the saved configuration at call time, on every call. A saved change SHALL therefore apply to the next call of every agent without restarting the app, including a turn already in a session.
- R27. The model route SHALL be: `openai/<model>` for OpenAI; `anthropic/<model>` for Anthropic; for LenAI `lenai/<deployment>` with the gateway URL of R4 and the `X-Api-Key` header.
- R28. The configured reasoning effort SHALL be sent with chat turns, the SQL cross-check and the answer synthesised after a tool-only turn. Calls with their own need SHALL override it: SQL repair and visual generation use `low`, and the synthesised answer of a tool-only eval turn uses `medium`.
- R29. Reasoning effort SHALL be filed under the provider option the target model actually reads: `reasoningEffort` for OpenAI and LenAI; `effort` for Anthropic, and for Anthropic SHALL be dropped entirely for models that reject it (Haiku, the Claude 3 line, Sonnet 4 and 4.5, Opus 4 and 4.1, including dated variants).
- R30. For OpenAI-compatible gateway routes whose model belongs to a family that rejects `max_tokens`, an output cap SHALL be sent as `max_completion_tokens`. For Anthropic that passthrough SHALL be dropped.
- R31. Provider responses of 429, 500, 502 or 503 SHALL be retried up to 3 times, waiting the `Retry-After` value when the response carries one (seconds or an HTTP date), else 1 s, 2 s, then 4 s. Other statuses and network errors SHALL NOT be retried. Retrying SHALL apply to every model request the process makes and SHALL be installed once.
- R32. The visual-designer agent MAY use a different model from the configured one: the `VISUAL_MODEL` environment variable forces a route; otherwise a configured gpt-5 or o-series OpenAI route (not a gateway deployment) is replaced by `openai/gpt-4.1-mini`, and any route whose name contains the token `nano` is replaced by its `mini` sibling with a warning log. All other agents use the configured model unchanged.

Effort levels
- R36. The system SHALL know, for every model name, its effort levels: an ordered subset of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, from the built-in table in [../../system/agents.md](../../system/agents.md) 1.4. A name the table doesn't know SHALL get `low`, `medium`, `high`; a model without reasoning SHALL get none. A model's default SHALL be `high` when offered, else its first level.
- R37. The settings screen SHALL show a **Reasoning effort** select below the model (or deployment name) listing the levels of the model typed, lowest first, capitalised (`Minimal`, `Low`, `Medium`, `High`, `XHigh`, `Max`, `None`). It SHALL update as the model or provider changes, keep the selected effort when the new model accepts it, and otherwise select the new model's default. A model with no levels, or an empty model field, SHALL show no select.
- R38. Saving SHALL store the selected effort with the connection. A selected effort the model doesn't accept SHALL fail the save with `reasoning effort must be one of: <levels>` and store nothing.
- R39. When the settings screen opens on a saved configuration, the select SHALL show the stored effort (or the model's default when the stored one isn't among its levels).
- R40. The connection probe (test and save) SHALL send the model's lowest level as its reasoning effort, and none for a model without levels. It SHALL NOT use the selected effort.
- R41. Every model call SHALL map its effort to the nearest level the model accepts (ties to the higher level) before sending it. A model without levels SHALL keep today's behaviour (R29).

## Edge cases and errors

- Switching provider in the form keeps the typed model and key; the placeholder example changes (`gpt-4o-mini`, `claude-sonnet-5-5`, `my-deployment`).
- Typing a key and leaving it in the field after a successful save is harmless: it is sent again on the next test or save and replaces the stored one.
- If the app secret changes (a lost secret file on a new install, a different `APP_SECRET`), the stored key can no longer be decrypted. Only a key under the former development secret is recovered (R33); any other must be entered again (R34, R35).
- Masking shows the last four characters; a key shorter than four characters would be shown whole. Open question: pad or fully hide very short keys.
- A backend that is unreachable during load leaves the form empty and shows no toast.
- The composer menu offers only `low`, `medium`, `high`. An effort saved from Settings outside that list (such as `minimal`) shows as the current value but can't be re-selected there; extending the per-model levels to the composer and the agent editor is a possible follow-up (epic [BA-159](../../epics/BA-159/spec.md)).
- The effort table is fixed in the app. A provider that adds or drops levels for a family needs a table update; until then the unknown-name fallback (R36) keeps new names usable.

## Contracts

- Endpoints `GET /llm/settings`, `PUT /llm/settings`, `PUT /llm/reasoning`, `POST /llm/test-connection`: [../../system/api.md](../../system/api.md).
- Persisted single settings document (key `llm`; provider, model, base URL, encrypted key, reasoning effort, timestamps): [../../system/data-model.md](../../system/data-model.md).
- Model routing per agent, the visual-designer exception and the connection-probe prompt: [../../system/agents.md](../../system/agents.md).
- App secret handling and key-at-rest policy: [../../product/non-functional.md](../../product/non-functional.md).

## UI

Settings area, **LLM Configuration** ([../app-shell/spec.md](../app-shell/spec.md), [../../system/ui.md](../../system/ui.md)). The form, top to bottom: heading "LLM Configuration" with "Configure the language-model provider and verify the credentials."; **Provider** select; **Model** (or **Deployment name**) text box; for LenAI a **Base URL** box with the hint "Gateway root; requests use <base URL>/openai/v1/deployments/<deployment>."; **Reasoning effort** select (only when the model has effort levels, R37); **API key** password box; **Test connection** button; **Save connection** button (tooltip "Test the connection successfully before saving"). States: empty (nothing saved), populated (saved values, masked key placeholder), key unreadable (saved values without a key, plus the notice "Your saved API key can't be read because the app secret changed. Enter the key again, test and save."), testing, saving, tested-ok (Save enabled). Results appear as toasts. The new-session composer shows the saved model name (or "No model configured") and a reasoning-effort chip (Low, Medium, High).

## Flows

E2E: `frontend/e2e/llm-settings.spec.ts` covers "LenAI needs a deployment name and a base URL", "Never shows the stored key", "Keeps a key saved under the former development secret", "Asks for the key again when the app secret changed", "Offers the effort levels of the chosen model", "Tests a reasoning model at its lowest effort" and "Saves the chosen effort and uses it on the next turn", against a local stub of the LenAI gateway. The other scenarios need a real provider and are not automated yet.

```gherkin
Feature: LLM settings

  Scenario: Configures a provider by testing first, then saving
    Given nothing is configured
    When I click "Settings" and then "LLM Configuration"
    Then "Save connection" is disabled
    When I choose the provider "OpenAI" and enter the model "gpt-4o-mini" and an API key
    And I click "Test connection"
    Then I see 'Connection successful — openai/gpt-4o-mini replied "ok"' with a latency
    And "Save connection" is enabled
    When I click "Save connection"
    Then I see "Configuration saved"

  Scenario: Editing a field withdraws the successful test
    Given I tested a configuration successfully
    When I change the model
    Then "Save connection" is disabled again

  Scenario: LenAI needs a deployment name and a base URL
    When I choose the provider "LenAI (Halo gateway)"
    Then the model field is labelled "Deployment name"
    And I see a "Base URL" field
    And "Test connection" is disabled until both are filled

  Scenario: Shows a clear message when the key is wrong
    When I test a configuration with an invalid key
    Then I see "Authentication failed (401) — check the API key"
    And "Save connection" stays disabled

  Scenario: Rejects a model that cannot return structured output
    When I test a configuration whose model answers in free text
    Then I see a message starting "Model answered but could not produce structured JSON output"

  Scenario: Never shows the stored key
    Given a configuration was saved with a key ending in "9f3a"
    When I reopen "LLM Configuration"
    Then the API key field is empty
    And its placeholder shows "••••••••9f3a"

  Scenario: Keeps the stored key when only the model changes
    Given a configuration is saved
    When I change only the model, leave the key empty and test
    Then the test uses the stored key
    And saving keeps working without retyping the key

  Scenario: A saved change applies to the next answer without a restart
    Given a session is open
    When I save a different model in "LLM Configuration"
    And I send the next message
    Then the answer is produced by the new model

  Scenario: Sets the reasoning effort from the new-session composer
    Given a configuration is saved
    When I click "New conversation"
    Then I see the saved model name and the effort "high"
    When I choose "Low" from the reasoning effort menu
    Then I see "Reasoning effort set to low"

  Scenario: Offers the effort levels of the chosen model
    When I choose the provider "LenAI (Halo gateway)" and enter the deployment name "gpt-5"
    Then the "Reasoning effort" select offers "Minimal", "Low", "Medium" and "High"
    And "High" is selected
    When I change the deployment name to "gpt-4.1"
    Then I see no "Reasoning effort" select
    When I change the deployment name to "my-deployment"
    Then the "Reasoning effort" select offers "Low", "Medium" and "High"

  Scenario: Tests a reasoning model at its lowest effort
    Given the deployment name is "gpt-5"
    And I choose "Medium" as the reasoning effort
    When I click "Test connection"
    Then I see 'Connection successful — lenai/gpt-5 replied "ok"'
    And the probe asked the model for the effort "minimal"
    When I choose "Low" as the reasoning effort
    Then "Save connection" stays enabled

  Scenario: Saves the chosen effort and uses it on the next turn
    Given the deployment name is "gpt-5" and the test passed
    When I choose "Medium" as the reasoning effort and click "Save connection"
    Then I see "Configuration saved"
    When I reopen "LLM Configuration"
    Then "Medium" is selected
    When I ask a question in a session
    Then the model is asked for the effort "medium"

  Scenario: Shows that no model is configured
    Given nothing is configured
    When I click "New conversation"
    Then I see "No model configured"

  Scenario: Keeps a key saved under the former development secret
    Given a LenAI configuration was saved while the app used the former development secret
    When I start the app with its own app secret
    And I open "LLM Configuration"
    Then the API key placeholder shows the saved key's last four characters
    When I click "Test connection" without typing a key
    Then the test uses the saved key and succeeds

  Scenario: Asks for the key again when the app secret changed
    Given a LenAI configuration was saved
    And the app secret was replaced
    When I open "LLM Configuration"
    Then I see "Your saved API key can't be read because the app secret changed. Enter the key again, test and save."
    And the provider, deployment name and base URL are filled in
    When I enter the key, click "Test connection" and then "Save connection"
    Then I see "Configuration saved"
    And the notice is gone
```

## Acceptance

- The scenarios above pass against a real provider (or a stub that honours the JSON schema).
- A configuration saved today still works after a restart (the key decrypts with the persisted app secret), and one saved under the former development secret still works after the first launch with a real secret.
- A key the current secret cannot read never surfaces as a backend error; the screen asks for the key again.
- The stored document contains the key only as `iv:tag:data`; no API response and no log line contains the plaintext key.
- With a model that rejects `max_tokens`, a chat turn on a LenAI deployment succeeds (cap sent as `max_completion_tokens`); with an Anthropic Haiku model, a chat turn succeeds with reasoning effort dropped.
- A provider 429 during a turn is retried transparently and the user sees the answer, not an error.

## Open questions

- The agents screen's Model tab says "No model resolved — save an LLM configuration in Settings first" when no settings exist, but R25 says a default route is used. Confirm which the Model tab should show with no saved configuration.

<!-- sources: backend/src/modules/llm/{llm.controller,llm.service,llm.types,retry-fetch}.ts, backend/src/modules/llm/repositories/llm-settings.repository.ts, backend/src/infrastructure/crypto/crypto.service.ts, backend/src/mastra/{model-resolver,model-compat}.ts, backend/src/mastra/agents/visualization.agent.ts, backend/src/modules/sessions/sessions.service.ts (reasoning effort use), frontend/src/app/features/llm/, frontend/src/app/app.ts (composer chip, setEffort) -->
