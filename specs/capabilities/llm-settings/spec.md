# LLM settings

The user chooses which language model powers every agent in the app: a provider, a model (or deployment name), an API key and, for Halo's gateway or a custom endpoint, a base URL. A custom endpoint is any model server the user controls or chooses (a self-hosted model, a gateway or a relay) that speaks the OpenAI or the Anthropic API; its key is optional and its models can be listed from the server. The configuration is proven to work before it is saved, the key is stored encrypted and is never shown again, and the choice applies to the very next agent call without restarting anything. A single global reasoning-effort setting tunes how hard models that support it think, chosen from the levels the selected model accepts.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): LLM provider, reasoning effort, app secret, agent, assistant, data directory.

Capability-local vocabulary:
- **Deployment name** — for `lenai`, the value of the "model" field; it names a deployment on the gateway rather than a model.
- **Connection probe** — the fixed, cheap request used to test a configuration (see R13 to R19).
- **Model route** — the provider-qualified identifier an agent call uses, `<provider>/<model>`.
- **API style** — for `custom`, which API the endpoint speaks: `openai` (shown as "OpenAI-compatible") or `anthropic` ("Anthropic-compatible").
- **Endpoint host** — the host of a custom base URL, with its port when the URL names one (e.g. `127.0.0.1:8317`).
- **Effort levels** — the reasoning-effort values a model accepts, lowest first, from the built-in table in [../../system/agents.md](../../system/agents.md) 1.4 (see R36 to R41).

## Rules

Configuration
- R1. The system SHALL support exactly four providers: `openai` (shown as "OpenAI"), `anthropic` ("Anthropic"), `lenai` ("LenAI (Halo gateway)") and `custom` ("Custom endpoint"). Any other provider SHALL be rejected with `provider must be one of: openai, anthropic, lenai, custom`.
- R2. There SHALL be one global configuration, used by every agent and every session. It SHALL hold: provider, API style (only for `custom`), model, base URL (may be empty), the encrypted API key (may be absent only for `custom`) and the reasoning effort.
- R3. The model SHALL be a free-text, non-empty value after trimming; otherwise `model is required`. For `lenai` it is labelled "Deployment name".
- R4. For `lenai`, the base URL SHALL be required (`baseUrl is required for lenai`). It is the gateway root. Requests for a deployment SHALL go to `<base URL without trailing slashes>/openai/v1/deployments/<deployment>`, carrying the key both as a bearer credential and in an `X-Api-Key` header.
- R5. For `openai` and `anthropic` the base URL SHALL NOT be required and SHALL NOT be used: `openai` goes to the provider's public API and `anthropic` to its native API. For every provider except `custom`, an API style SHALL be ignored and not stored.
- R6. For `openai`, `anthropic` and `lenai` the API key SHALL be required the first time. When a request omits the key or sends a blank one, the system SHALL use the stored key; if none is stored, it SHALL fail with `apiKey is required — none stored yet`. Switching from `custom` to another provider SHALL follow this rule unchanged. For `custom` the key is optional (R47).
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
- R17. For OpenAI-compatible routes (`openai`, `lenai`, and `custom` in the OpenAI style) the probe SHALL cap output at 512 tokens, or 4,096 for models in the families that count hidden reasoning against the cap (gpt-5 and later, o1 to o4, written to survive gateway-mangled deployment names). Those families SHALL be sent the cap under the name `max_completion_tokens`; all others under `max_tokens`.
- R18. Failures SHALL be reported in these words (the part after the dash varies; `custom` reports network and HTTP failures in its own words, R50):
  - network failure: `Provider unreachable — <detail>`
  - HTTP 401: `Authentication failed (401) — check the API key`
  - other HTTP errors: `Provider request failed (<status>) — <first 300 characters of the body>`
  - empty reply cut off by the cap: `Model hit the <cap>-token limit before replying — reasoning models spend that budget thinking first; try a lower reasoning effort or a non-reasoning model`
  - the model refused: `Model refused the connection probe — <first 200 characters of the refusal>`
  - reply that is not the required JSON: `Model answered but could not produce structured JSON output, which every agent here requires — reply="<first 200 characters>"`
- R19. For `anthropic`, and for `custom` in the Anthropic style, the probe SHALL go through the same agent runtime the app uses for real calls (so provider-specific structured-output handling is proven), with a 512-token cap. For `anthropic` it SHALL report failures with the same 401, status, unreachable, timeout and structured-output messages; for `custom` with the texts of R50 and the structured-output messages of R18.
- R20. A failed test, a failed save or an unreachable backend SHALL be shown as an error toast; a success as a success toast. A failed save reports the same message the test would.

Saving
- R21. Saving SHALL re-run the probe with the submitted configuration and SHALL persist only if it passes. A failed save SHALL leave the previous configuration untouched.
- R22. The save and test endpoints SHALL answer with an ok flag and a message in the response body; a validation or probe failure SHALL NOT be an HTTP error. A successful save reports `Configuration saved`.
- R23. The settings screen SHALL enable **Save connection** only after a successful **Test connection** with the current field values; editing any field except **Reasoning effort** SHALL withdraw that permission (the probe doesn't use the chosen effort, R40). **Test connection** SHALL be enabled when a model is entered (and a base URL for `lenai` and `custom`) and no test is running, and SHALL read "Testing…" while it runs. **Save connection** SHALL read "Saving…" while it runs.

Fallback
- R24. When nothing has been saved, the settings view SHALL report `configured: false`, no provider, model, base URL or key, and reasoning effort `high`. The new-session composer SHALL then show "No model configured".
- R25. When nothing has been saved, agents SHALL still run, using the route `openai/gpt-4o-mini` with the key taken from the `OPENAI_API_KEY` environment variable. If that variable is also unset the model call fails and surfaces as an ordinary error.

Applying the settings
- R26. Every agent SHALL resolve its model from the saved configuration at call time, on every call. A saved change SHALL therefore apply to the next call of every agent without restarting the app, including a turn already in a session.
- R27. The model route SHALL be: `openai/<model>` for OpenAI; `anthropic/<model>` for Anthropic; for LenAI `lenai/<deployment>` with the gateway URL of R4 and the `X-Api-Key` header. For `custom` in the OpenAI style it SHALL be an OpenAI-compatible route `custom/<model>` aimed at the normalised base URL of R45 with the key, if any. For `custom` in the Anthropic style it SHALL be the Anthropic route `anthropic/<model>` aimed at `<root>/v1` (R46) with the key, if any; because the agent runtime's own routing cannot aim an Anthropic route at another base URL, this route SHALL be kept as plain data (style, model, base URL, key) and built into a model object only at call time. Callers that need the route as data (tuning, the visual designer) SHALL read the plain form; agents SHALL receive the built model.
- R28. The configured reasoning effort SHALL be sent with chat turns, the SQL cross-check and the answer synthesised after a tool-only turn. Calls with their own need SHALL override it: SQL repair and visual generation use `low`, and the synthesised answer of a tool-only eval turn uses `medium`.
- R29. Reasoning effort SHALL be filed under the provider option the target model actually reads: `reasoningEffort` for OpenAI and LenAI; `effort` for Anthropic, and for Anthropic SHALL be dropped entirely for models that reject it (Haiku, the Claude 3 line, Sonnet 4 and 4.5, Opus 4 and 4.1, including dated variants). A `custom` endpoint SHALL be tuned by its API style (R52): the OpenAI style as an OpenAI-compatible route, the Anthropic style as Anthropic.
- R30. For OpenAI-compatible gateway routes (`lenai`, and `custom` in the OpenAI style) whose model belongs to a family that rejects `max_tokens`, an output cap SHALL be sent as `max_completion_tokens`. For Anthropic, including `custom` in the Anthropic style, that passthrough SHALL be dropped.
- R31. Provider responses of 429, 500, 502 or 503 SHALL be retried up to 3 times, waiting the `Retry-After` value when the response carries one (seconds or an HTTP date), else 1 s, 2 s, then 4 s. Other statuses and network errors SHALL NOT be retried. Retrying SHALL apply to every model request the process makes, custom endpoints included, and SHALL be installed once.
- R32. The visual-designer agent MAY use a different model from the configured one: the `VISUAL_MODEL` environment variable forces a route; otherwise a configured gpt-5 or o-series OpenAI route (not a gateway deployment) is replaced by `openai/gpt-4.1-mini`, and any route whose name contains the token `nano` is replaced by its `mini` sibling with a warning log. A `custom` configuration SHALL keep its base URL, API style and key: only the `nano` → `mini` swap MAY apply to its model name, and it SHALL NEVER be replaced by a public OpenAI route. All other agents use the configured model unchanged.

Effort levels
- R36. The system SHALL know, for every model name, its effort levels: an ordered subset of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, from the built-in table in [../../system/agents.md](../../system/agents.md) 1.4. A name the table doesn't know SHALL get `low`, `medium`, `high`; a model without reasoning SHALL get none. A model's default SHALL be `high` when offered, else its first level.
- R37. The settings screen SHALL show a **Reasoning effort** select below the model (or deployment name) listing the levels of the model typed, lowest first, capitalised (`Minimal`, `Low`, `Medium`, `High`, `XHigh`, `Max`, `None`). It SHALL update as the model or provider changes, keep the selected effort when the new model accepts it, and otherwise select the new model's default. The select SHALL always be shown, so users can discover it: with an empty model field it SHALL be disabled with the single option `Default — enter a model first`, and for a model with no levels disabled with the single option `Default — not available for this model`. Its hint SHALL say why (R42).
- R38. Saving SHALL store the selected effort with the connection. A selected effort the model doesn't accept SHALL fail the save with `reasoning effort must be one of: <levels>` and store nothing.
- R39. When the settings screen opens on a saved configuration, the select SHALL show the stored effort (or the model's default when the stored one isn't among its levels).
- R40. The connection probe (test and save) SHALL send the model's lowest level as its reasoning effort, and none for a model without levels. It SHALL NOT use the selected effort.
- R41. Every model call SHALL map its effort to the nearest level the model accepts (ties to the higher level) before sending it. A model without levels SHALL keep today's behaviour (R29).
- R42. The select's hint, linked to it as its accessible description, SHALL read `Used for answers. Test connection always uses the lowest level.` when the model has levels, `Enter a model to see the effort levels it supports.` when the model is empty, and `This model doesn't support a reasoning effort setting.` when it has none.

Custom endpoint
- R44. For `custom`, the API style SHALL be required and SHALL be `openai` or `anthropic`; otherwise `apiStyle must be one of: openai, anthropic`. The base URL SHALL be required (`baseUrl is required for custom`) and SHALL be an absolute `http` or `https` URL (`baseUrl must be an http or https URL`). Any host, including loopback and private addresses, SHALL be accepted. The checks SHALL run in this order and report the first failure: provider, API style, base URL presence, base URL form, model.
- R45. In the OpenAI style the base URL SHALL be used as given, minus trailing slashes, and SHALL include the API version path (e.g. `http://127.0.0.1:8317/v1`). Chat requests SHALL go to `<base>/chat/completions` and the model list to `<base>/models`. A key SHALL be sent as `Authorization: Bearer <key>`.
- R46. In the Anthropic style the base URL SHALL be the server root (e.g. `http://127.0.0.1:8317`); after trailing slashes are removed the system SHALL append `/v1`, unless the URL already ends in `/v1`, which SHALL be accepted as-is. Messages SHALL go to `<root>/v1/messages` and the model list to `<root>/v1/models`. Every request SHALL carry `anthropic-version: 2023-06-01`, and a key SHALL be sent as `x-api-key: <key>`.
- R47. For `custom` the API key SHALL be optional. A key that is typed SHALL be stored encrypted (R9) and masked (R10) like any other. When the key is blank, the stored key SHALL be used if the stored configuration is also `custom` and holds one; otherwise the endpoint SHALL be called with no credential header at all, and saving SHALL store no key. A saved keyless `custom` configuration SHALL read as `configured: true` with no masked key.
- R48. The user SHALL be able to list a custom endpoint's models before saving. The request carries the provider (`custom` only; any other is rejected with `provider must be custom to load models`), the API style, the base URL and an optional key (blank → as R47). It SHALL be validated as R44, call the model-list URL of R45 or R46 with the headers of that style, and answer in the body with an ok flag: on success the `id` of each entry in the response's `data` list, in the server's order with duplicates removed; on failure a message. Nothing SHALL be persisted. The call SHALL time out after 15 seconds (`Model list request timed out after 15s`). Network and HTTP failures SHALL use the texts of R50; a reply without a readable model list SHALL report `The endpoint did not return a model list — type the model name instead`.
- R49. Testing a `custom` configuration SHALL report a pass as R15, with the route `custom/<model>` in both styles. In the OpenAI style, when the endpoint rejects the strict JSON-schema request (an HTTP 400 or 422 answer), the probe SHALL retry once asking for a JSON object without a schema, and then once with no response format at all; at each step the reply SHALL pass only if it parses (a surrounding code fence tolerated) to `{ "status": "<non-empty string>" }`. A rejection at the last step, or any other failure, SHALL be reported as usual.
- R50. For `custom`, network, HTTP and timeout failures of the probe, the model list and chat turns SHALL be reported in these words:
  - host unreachable (connection refused, DNS failure, reset): `Could not reach <host> — check the base URL and that the server is running`
  - HTTP 404: `The endpoint answered 404 at <url> — check the base URL (OpenAI-compatible servers usually end in /v1)`, where `<url>` is the full URL requested
  - HTTP 401 or 403: `The endpoint rejected the API key (<status>)`
  - HTTP 429 (after the retries of R31): `The endpoint is rate limiting requests (429) — try again later`
  - other HTTP errors: `Provider request failed (<status>) — <first 300 characters of the body>`
  - probe timeout: `LLM request timed out after 30s`
- R51. When a chat turn fails because a `custom` endpoint is unreachable, answers 404 or rejects the key, the session SHALL show the matching text of R50 as the turn's error, not a generic failure.
- R52. Effort levels for a `custom` model SHALL be chosen by its model name, as R36. In the OpenAI style the effort SHALL be sent as `reasoning_effort` only when the model has effort levels, and not at all otherwise. In the Anthropic style it SHALL be sent as Anthropic's `effort` and dropped for the models R29 lists.
- R53. Wherever the app names the provider (the agent catalogue, the agent page's Model tab, Settings), `custom` SHALL read "Custom endpoint". The new-session composer SHALL show a `custom` model as `<model> · <endpoint host>`.
- R54. No API key, of any provider, SHALL appear in an API response, a log line or the desktop diagnostics, apart from the masked form of R10. Error texts (R18, R50) SHALL NOT echo request headers. Values of `Authorization` and `x-api-key` headers SHALL be redacted wherever requests or errors are logged.

Availability
- R43. There SHALL be one LLM configuration for the whole server. Reading it, saving it, testing a connection and changing the reasoning effort SHALL all be available to the user: the LLM Configuration section and the composer's Reasoning effort control are always shown, and the settings view always carries the masked key (never the key itself).

## Edge cases and errors

- Switching provider in the form keeps the typed model and key; the placeholder example changes (`gpt-4o-mini`, `claude-sonnet-5-5`, `my-deployment`, and `llama3.1:8b` for Custom endpoint). Switching the API style keeps the base URL as typed; the hint below it shows which form that style expects.
- An OpenAI-style URL typed without its version path (`http://127.0.0.1:8317`) is not corrected: the endpoint usually answers 404, and the R50 text points at `/v1`. An Anthropic-style URL typed with `/v1` is accepted (R46).
- A keyless `custom` configuration can't be given a key later by leaving the field blank; typing a key and saving stores it. A stored `custom` key can't be removed from the form except by saving a different provider. Open question: add a "clear key" control.
- A stored key of another provider is never sent to a custom endpoint (R47), so switching from OpenAI to Custom endpoint with a blank key calls the endpoint without a credential. Switching from Custom endpoint back to OpenAI, Anthropic or LenAI with a blank key fails with `apiKey is required — none stored yet` (R6): the custom key is never sent to a public provider.
- A stored `custom` key is reused with a blank key field even when the base URL or API style has changed (R47), so it is sent to the new server. Open question: reuse the stored custom key only when the base URL is unchanged.
- Trailing slashes are removed in both styles: `http://127.0.0.1:8317/v1/` (OpenAI) requests `http://127.0.0.1:8317/v1/chat/completions`; `http://127.0.0.1:8317/` and `http://127.0.0.1:8317/v1/` (Anthropic) both request `http://127.0.0.1:8317/v1/messages` (R45, R46).
- A server that rejects strict JSON schema but returns the JSON object passes the test through the fallback of R49; one that returns only free text at every step fails with the structured-output message of R18.
- A slow server: the probe stops at 30 s and the model list at 15 s (R16, R48). A chat turn has no timeout of its own ([../../system/agents.md](../../system/agents.md) 1.6); it runs until the server answers or the user stops it.
- A custom model whose name the effort table doesn't know gets `low`, `medium`, `high` (R36), so `reasoning_effort` is sent; a server that rejects that parameter fails the turn. The user can pick a model with a recognised name or a server that ignores unknown parameters. Open question: a "no reasoning effort" choice per custom endpoint.
- A server without tool calling (either style) passes the connection probe, which uses no tools, but cannot run the agents: a server that rejects the tools fails the turn with its own error (R50, "other HTTP errors"); one that ignores them answers without querying data. Neither is detected before saving.
- **Load models** lists whatever the server returns, including models that cannot answer chat requests (embeddings); the model field still accepts any typed name, listed or not.
- Typing a key and leaving it in the field after a successful save is harmless: it is sent again on the next test or save and replaces the stored one.
- If the app secret changes (a lost secret file on a new install, a different `APP_SECRET`), the stored key can no longer be decrypted. Only a key under the former development secret is recovered (R33); any other must be entered again (R34, R35).
- Masking shows the last four characters; a key of four characters or fewer would be shown whole, which conflicts with R54. Custom endpoints make this likely (placeholder keys such as `none` or `sk-x`). Open question: pad or fully hide very short keys.
- A backend that is unreachable during load leaves the form empty and shows no toast.
- The composer menu offers only `low`, `medium`, `high`. An effort saved from Settings outside that list (such as `minimal`) shows as the current value but can't be re-selected there; extending the per-model levels to the composer and the agent editor is a possible follow-up (epic [BA-159](../../epics/BA-159/spec.md)).
- The effort table is fixed in the app. A provider that adds or drops levels for a family needs a table update; until then the unknown-name fallback (R36) keeps new names usable.

## Contracts

- Endpoints `GET /llm/settings`, `PUT /llm/settings`, `PUT /llm/reasoning`, `POST /llm/test-connection`, `POST /llm/models`: [../../system/api.md](../../system/api.md).
- Persisted single settings document (key `llm`; provider, API style, model, base URL, encrypted key (optional for `custom`), reasoning effort, timestamps): [../../system/data-model.md](../../system/data-model.md).
- Model routing per agent (including the plain-data and built-model forms of a custom route), tuning per provider, the visual-designer exception, the connection-probe prompt and the eval runner's custom-endpoint settings: [../../system/agents.md](../../system/agents.md).
- Why Anthropic-compatible endpoints are built outside the runtime's router, and keyless endpoints: [../../system/architecture.md](../../system/architecture.md) ADR-0032.
- App secret handling, key-at-rest policy and redaction: [../../product/non-functional.md](../../product/non-functional.md).

## UI

Settings area, **LLM Configuration** ([../app-shell/spec.md](../app-shell/spec.md), [../../system/ui.md](../../system/ui.md)). The form, top to bottom: heading "LLM Configuration" with "Configure the language-model provider and verify the credentials."; **Provider** select (OpenAI, Anthropic, LenAI (Halo gateway), Custom endpoint); for Custom endpoint, before the model so its models can be listed, an **API style** select (OpenAI-compatible, the default, or Anthropic-compatible), a required **Base URL** box whose hint follows the API style (OpenAI-compatible "Include the version path, e.g. http://127.0.0.1:8317/v1; requests use <base URL>/chat/completions.", Anthropic-compatible "Server root, e.g. http://127.0.0.1:8317; requests use <base URL>/v1/messages.") and an **API key (optional)** password box (placeholder "Leave blank if the server needs none", or the masked saved key); **Model** (or **Deployment name**) text box, for Custom endpoint with a **Load models** button beside it, enabled when a base URL is entered and no load is running, reading "Loading models…" while it runs: on success the model box offers the loaded names as a dropdown while still accepting any typed name, an empty list shows "The endpoint listed no models — type the model name." in that dropdown, and a failure shows the R48 or R50 message as an error toast; **Reasoning effort** select (always shown; disabled with a `Default — …` option when the model is empty or has no effort levels, R37); for LenAI a **Base URL** box with the hint "Gateway root; requests use <base URL>/openai/v1/deployments/<deployment>."; for OpenAI, Anthropic and LenAI an **API key** password box; **Test connection** button; **Save connection** button (tooltip "Test the connection successfully before saving"). States: empty (nothing saved), populated (saved values, masked key placeholder), key unreadable (saved values without a key, plus the notice "Your saved API key can't be read because the app secret changed. Enter the key again, test and save."), testing, saving, tested-ok (Save enabled). Results appear as toasts. The new-session composer shows the saved model name (for Custom endpoint `<model> · <endpoint host>`, R53; or "No model configured") and a reasoning-effort chip (Low, Medium, High).

## Flows

E2E: `frontend/e2e/llm-settings.spec.ts` covers "LenAI needs a deployment name and a base URL", "Never shows the stored key", "Keeps a key saved under the former development secret", "Asks for the key again when the app secret changed", "Offers the effort levels of the chosen model", "Tests a reasoning model at its lowest effort", "Saves the chosen effort and uses it on the next turn", "Sets the reasoning effort from the new-session composer" and "Shows that no model is configured", against a local stub of the LenAI gateway. The other scenarios need a real provider and are not automated yet.

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
    When I click "Sessions" on the rail
    And I click "Start New Conversation"
    Then I see the saved model name and the effort "high"
    When I choose "Low" from the reasoning effort menu
    Then I see "Reasoning effort set to low"

  Scenario: Offers the effort levels of the chosen model
    When I choose the provider "LenAI (Halo gateway)" and enter the deployment name "gpt-5"
    Then the "Reasoning effort" select offers "Minimal", "Low", "Medium" and "High"
    And "High" is selected
    When I change the deployment name to "gpt-4.1"
    Then the "Reasoning effort" select is disabled and shows "Default — not available for this model"
    And I see "This model doesn't support a reasoning effort setting."
    When I clear the deployment name
    Then the "Reasoning effort" select is disabled and shows "Default — enter a model first"
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
    When I click "Sessions" on the rail
    And I click "Start New Conversation"
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

E2E: `frontend/e2e/llm-custom-endpoint.spec.ts` for the Feature "Custom endpoint connection" covers, in the OpenAI style, "Configures an OpenAI-compatible endpoint by loading models, testing and saving", "A chat turn runs on the custom endpoint", "Uses an endpoint that needs no key", "Reports an unreachable endpoint", "Points at the version path when the endpoint answers 404" and "Never sends another provider's key to a custom endpoint", and in the Anthropic style "Configures an Anthropic-compatible endpoint by loading models, testing and saving" (with a chat turn and the composer chip), "Uses an endpoint that needs no key", "Removes trailing slashes and accepts /v1 in the Anthropic style" and "Reports a rejected key"; "Passes the test on a server without strict JSON-schema support" and "Reports a model list that times out" are not automated yet. The steps run against local stub servers (`helpers/llm-stub.ts` for the OpenAI style, `helpers/anthropic-stub.ts` for the Anthropic style) that record each request's path, headers and body; the controls carry the test ids of [../../system/ui.md](../../system/ui.md) 4.9 (`llm-api-style`, `llm-load-models`, `llm-model-options`).

```gherkin
Feature: Custom endpoint connection

  Scenario: Configures an OpenAI-compatible endpoint by loading models, testing and saving
    Given an OpenAI-compatible server at "http://127.0.0.1:8317/v1" that lists the models "qwen3-8b" and "llama3.1:8b"
    When I open "LLM Configuration"
    And I choose the provider "Custom endpoint"
    Then I see an "API style" select showing "OpenAI-compatible"
    And I see "Include the version path, e.g. http://127.0.0.1:8317/v1; requests use <base URL>/chat/completions."
    When I enter the base URL "http://127.0.0.1:8317/v1" and an API key
    And I click "Load models"
    Then the model field offers "qwen3-8b" and "llama3.1:8b"
    When I choose "qwen3-8b"
    And I click "Test connection"
    Then I see 'Connection successful — custom/qwen3-8b replied "ok"' with a latency
    When I click "Save connection"
    Then I see "Configuration saved"
    When I reopen "LLM Configuration"
    Then the provider is "Custom endpoint", the API style "OpenAI-compatible" and the base URL "http://127.0.0.1:8317/v1"
    And the API key placeholder shows the key's last four characters

  Scenario: Configures an Anthropic-compatible endpoint by loading models, testing and saving
    Given an Anthropic-compatible server at "http://127.0.0.1:8317" that lists the model "claude-sonnet-5-5"
    When I choose the provider "Custom endpoint" and the API style "Anthropic-compatible"
    Then I see "Server root, e.g. http://127.0.0.1:8317; requests use <base URL>/v1/messages."
    When I enter the base URL "http://127.0.0.1:8317" and an API key
    And I click "Load models"
    Then the model field offers "claude-sonnet-5-5"
    When I choose "claude-sonnet-5-5" and click "Test connection"
    Then I see 'Connection successful — custom/claude-sonnet-5-5 replied "ok"' with a latency
    And the server received the key in the "x-api-key" header
    When I click "Save connection"
    Then I see "Configuration saved"

  Scenario: A chat turn runs on the custom endpoint
    Given a custom endpoint configuration with the model "qwen3-8b" at "http://127.0.0.1:8317/v1" is saved
    When I click "Sessions" on the rail
    And I click "Start New Conversation"
    Then I see "qwen3-8b · 127.0.0.1:8317"
    When I ask a question
    Then the server received a request to "/v1/chat/completions" for the model "qwen3-8b"
    And I see the assistant's answer

  Scenario: Uses an endpoint that needs no key
    Given an OpenAI-compatible server that accepts requests without a credential
    When I choose the provider "Custom endpoint" and enter its base URL and a model
    And I leave "API key (optional)" empty
    And I click "Test connection"
    Then I see a message starting "Connection successful — custom/"
    And the server received no "Authorization" header
    When I click "Save connection"
    Then I see "Configuration saved"

  Scenario: Reports an unreachable endpoint
    Given nothing listens at "http://127.0.0.1:9"
    When I choose the provider "Custom endpoint", enter the base URL "http://127.0.0.1:9/v1" and a model
    And I click "Test connection"
    Then I see "Could not reach 127.0.0.1:9 — check the base URL and that the server is running"
    And "Save connection" stays disabled

  Scenario: Points at the version path when the endpoint answers 404
    Given an OpenAI-compatible server at "http://127.0.0.1:8317/v1"
    When I choose the provider "Custom endpoint" and enter the base URL "http://127.0.0.1:8317" and a model
    And I click "Test connection"
    Then I see "The endpoint answered 404 at http://127.0.0.1:8317/chat/completions — check the base URL (OpenAI-compatible servers usually end in /v1)"
    And "Save connection" stays disabled

  Scenario: Removes trailing slashes and accepts /v1 in the Anthropic style
    Given an Anthropic-compatible server at "http://127.0.0.1:8317"
    When I choose the provider "Custom endpoint" and the API style "Anthropic-compatible"
    And I enter the base URL "http://127.0.0.1:8317/v1/" and the model "claude-sonnet-5-5"
    And I click "Test connection"
    Then I see 'Connection successful — custom/claude-sonnet-5-5 replied "ok"' with a latency
    And the server received a request to "/v1/messages", not "/v1/v1/messages"

  Scenario: Passes the test on a server without strict JSON-schema support
    Given an OpenAI-compatible server at "http://127.0.0.1:8317/v1" that answers 400 to a "json_schema" response format and honours "json_object"
    When I choose the provider "Custom endpoint", enter that base URL and the model "qwen3-8b"
    And I click "Test connection"
    Then I see 'Connection successful — custom/qwen3-8b replied "ok"' with a latency
    And "Save connection" is enabled

  Scenario: Reports a rejected key
    Given an OpenAI-compatible server at "http://127.0.0.1:8317/v1" that answers 401
    When I choose the provider "Custom endpoint", enter that base URL, the model "qwen3-8b" and the API key "wrong-key"
    And I click "Test connection"
    Then I see "The endpoint rejected the API key (401)"
    And "Save connection" stays disabled

  Scenario: Never sends another provider's key to a custom endpoint
    Given an OpenAI configuration is saved with a key
    And an OpenAI-compatible server at "http://127.0.0.1:8317/v1" that accepts requests without a credential
    When I choose the provider "Custom endpoint", enter that base URL and the model "qwen3-8b"
    And I leave "API key (optional)" empty and click "Test connection"
    Then I see a message starting "Connection successful — custom/qwen3-8b"
    And the server received no "Authorization" header

  Scenario: Reports a model list that times out
    Given an OpenAI-compatible server at "http://127.0.0.1:8317/v1" that does not answer "/models" within 15 seconds
    When I choose the provider "Custom endpoint", enter that base URL and click "Load models"
    Then I see "Model list request timed out after 15s"
    And the model field still accepts a typed name
```

## Acceptance

- The scenarios above pass against a real provider (or a stub that honours the JSON schema).
- A configuration saved today still works after a restart (the key decrypts with the persisted app secret), and one saved under the former development secret still works after the first launch with a real secret.
- A key the current secret cannot read never surfaces as a backend error; the screen asks for the key again.
- The stored document contains the key only as `iv:tag:data`; no API response and no log line contains the plaintext key.
- With a model that rejects `max_tokens`, a chat turn on a LenAI deployment succeeds (cap sent as `max_completion_tokens`); with an Anthropic Haiku model, a chat turn succeeds with reasoning effort dropped.
- A provider 429 during a turn is retried transparently and the user sees the answer, not an error.
- A custom endpoint works end to end in both API styles against a real server: models load, the test passes, the settings save, and an assistant turn answers using a tool.
- A keyless custom endpoint receives no `Authorization` or `x-api-key` header; a keyed one receives the key only in the header of its style.
- An OpenAI-compatible server that rejects strict JSON schema still passes the test when it can return the JSON object (R49).
- No API response, log line, data file other than the encrypted settings document, or desktop diagnostic contains a custom endpoint's key.

## Open questions

- The agents screen's Model tab says "No model resolved — save an LLM configuration in Settings first" when no settings exist, but R25 says a default route is used. Confirm which the Model tab should show with no saved configuration.

<!-- sources: backend/src/modules/llm/{llm.controller,llm.service,llm.types,retry-fetch}.ts, backend/src/modules/llm/repositories/llm-settings.repository.ts, backend/src/infrastructure/crypto/crypto.service.ts, backend/src/mastra/{model-resolver,model-compat}.ts, backend/src/mastra/agents/visualization.agent.ts, backend/src/modules/sessions/sessions.service.ts (reasoning effort use), frontend/src/app/features/llm/, frontend/src/app/app.ts (composer chip, setEffort); custom endpoint provider: epic BA-281 -->
