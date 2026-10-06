# Developer settings

A developer can switch on **developer observability** and point it at their local tools, without editing files or environment variables. The setting is off by default, so end users never need this section. Changes are saved at once but take effect the next time the backend starts, because the instrumentation has to load before the backend's own modules. The section always shows whether the running backend matches the saved setting, and offers a restart when it does not. What observability exports once it is on belongs to the BA-111 stories that follow ([../../epics/BA-111/spec.md](../../epics/BA-111/spec.md)). This capability owns the setting, its storage and the restart.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): data directory, developer observability.

Capability-local vocabulary:
- **Saved setting** — what is in the developer-settings file now.
- **Active setting** — what the running backend read from that file when it started.
- **Restart required** — the saved and active settings differ.
- **Endpoint probe** — the request used by "Test" to check that an endpoint accepts OpenTelemetry (OTLP) traces.

## Rules

The setting
- R1. There SHALL be one developer setting per data directory with three values: **observability enabled** (boolean), **Phoenix endpoint** and **OTLP endpoint** (absolute URLs).
- R2. With no saved setting, the values SHALL be: enabled `false`, Phoenix `http://localhost:6006`, OTLP `http://localhost:4318`.
- R3. The setting SHALL be stored as a JSON file in the data directory (not in the document store), so the backend entry points can read it synchronously before any app module loads. A missing, unreadable or malformed file, or a file with invalid values, SHALL fall back to the defaults for the invalid values and SHALL NOT stop the backend from starting.
- R4. An endpoint SHALL be an absolute `http` or `https` URL. Saving one that is not SHALL fail with `<Phoenix|OTLP> endpoint must be an http(s) URL` and leave the saved setting unchanged. Trailing slashes SHALL be removed before saving.
- R5. Saving SHALL NOT require the endpoints to be reachable; the tools may start later.
- R6. A successful save SHALL answer `Developer settings saved — restart to apply` when restart is required after it, and `Developer settings saved` otherwise.

Applying on restart
- R7. The backend SHALL read the setting once, at startup, and keep that copy as the active setting for its whole life. Saving SHALL NOT change the active setting.
- R8. The settings view SHALL report the saved setting, the active setting and whether restart is required.
- R9. When restart is required, the section SHALL show a notice "Restart to apply" that names the active state ("The running backend has developer observability on" or "… off").
- R10. In the desktop app the notice SHALL offer **Restart backend**. It SHALL stop the backend and start it again at once. This restart SHALL NOT count against the crash-restart budget, and the backend status banner SHALL show it as restarting. When the backend is ready again, the section SHALL reload the view, and the notice SHALL disappear because the new backend has read the saved setting.
- R11. In a browser (the npm CLI), where the backend runs inside the CLI process, the notice SHALL say "Restart the CLI to apply" and SHALL NOT offer a button.

Testing an endpoint
- R12. Each endpoint SHALL have a **Test** button that probes the value currently typed, not the saved one. The backend SHALL send the probe so that the result reflects what the backend can reach.
- R13. The probe SHALL be `POST <endpoint>/v1/traces` with `Content-Type: application/x-protobuf` and an empty body (an empty OTLP export request), with a 3-second timeout.
- R14. A 2xx response SHALL be reported as `Reachable — <endpoint> accepted an OTLP trace export in <N>ms`. Any other response as `Endpoint answered <status> — not an OTLP trace receiver`. A network failure or timeout as `Unreachable — <detail>`.
- R15. The result SHALL be shown inline under the endpoint, green on success and red otherwise, and SHALL clear when that endpoint is edited.

Default behaviour
- R16. The section SHALL NOT change what the app does while the setting is off. Turning it on SHALL change nothing until the backend restarts.

## Edge cases and errors

- Saving while the backend is unreachable shows an error toast with `Backend unreachable`, and the form keeps the typed values.
- Toggling on and back off before saving leaves nothing to save. **Save** is enabled only when the form differs from the saved setting and both endpoints are valid.
- If the developer edits the file by hand while the app runs, the section shows the edit after it is reopened. The edit applies at the next restart like any save.
- **Restart backend** while an answer is streaming ends that stream with the usual backend-unreachable error. The notice does not warn about it. Open question: warn when a stream is in flight.
- If the restarted backend never becomes ready, the existing crash supervisor takes over (back-off restarts, then `down`).

## Contracts

- Endpoints `GET /developer-settings`, `PUT /developer-settings`, `POST /developer-settings/test-endpoint`: [../../system/api.md](../../system/api.md).
- IPC channel `backend:restart` and `window.desktop.restartBackend()`: [../../system/api.md](../../system/api.md) (desktop bridge).
- The developer-settings file under the data directory: [../../system/data-model.md](../../system/data-model.md).
- The decision to keep the setting in a file read before bootstrap: ADR-0006 in [../../system/architecture.md](../../system/architecture.md).

## UI

Settings sidebar, **Developer** row, after Testing Data ([../app-shell/spec.md](../app-shell/spec.md), [../../system/ui.md](../../system/ui.md) §4.12). The form, top to bottom:
- Heading "Developer", subtitle "Tools for developing this app. Everything here is off by default."
- A switch "Developer observability" with the description "Export agent traces to Arize Phoenix and backend traces, metrics and logs to an OpenTelemetry endpoint. Traces are still kept in the local store."
- **Phoenix endpoint** and **OTLP endpoint** text fields, each with a **Test** button ("Testing…" while it runs) and its inline result.
- **Save** ("Saving…" while it runs).
- The restart notice, when one is needed.

States: defaults (nothing saved), saved, restart required (desktop or browser), invalid endpoint, testing, saving.

## Flows

### Feature: Developer settings

E2E: `frontend/e2e/developer-settings.spec.ts`

```gherkin
Feature: Developer settings

  Scenario: Developer observability is off by default
    When I click "Settings" and then "Developer"
    Then the "Developer observability" switch is off
    And the Phoenix endpoint is "http://localhost:6006"
    And the OTLP endpoint is "http://localhost:4318"
    And "Save" is disabled
    And I do not see "Restart to apply"

  Scenario: Turning observability on asks for a restart
    Given I am in "Developer"
    When I turn on "Developer observability" and click "Save"
    Then I see "Developer settings saved — restart to apply"
    And I see "Restart to apply" with "The running backend has developer observability off"
    And I see "Restart backend"

  Scenario: Restarting the backend applies the saved setting
    Given I saved "Developer observability" on and I see "Restart to apply"
    When I click "Restart backend"
    Then the backend restarts
    And the "Developer observability" switch is still on
    And I no longer see "Restart to apply"

  Scenario: Turning it back off before restarting needs no restart
    Given I saved "Developer observability" on and I see "Restart to apply"
    When I turn off "Developer observability" and click "Save"
    Then I see "Developer settings saved"
    And I no longer see "Restart to apply"

  Scenario: Rejects an endpoint that is not a URL
    Given I am in "Developer"
    When I set the OTLP endpoint to "not a url"
    Then I see "OTLP endpoint must be an http(s) URL"
    And "Save" is disabled

  Scenario: Tests an endpoint that accepts OTLP traces
    Given an OTLP trace receiver is listening
    When I set the Phoenix endpoint to that receiver and click its "Test"
    Then I see a green message starting with "Reachable —"

  Scenario: Tests an endpoint that is not listening
    When I set the OTLP endpoint to a port where nothing is listening and click its "Test"
    Then I see a red message starting with "Unreachable —"
    When I edit the OTLP endpoint
    Then the message is gone
```

## Acceptance

1. A fresh data directory shows the switch off, the default endpoints and no restart notice, and the backend has no developer-settings file until the first save.
2. Saving writes the file in the data directory with the three values. The view reports restart required until the backend restarts, and then reports the saved values as active.
3. In the desktop app, **Restart backend** brings the backend back without using the crash-restart budget, and the notice disappears once it is ready.
4. Invalid endpoints are rejected by both the form and the backend, with the messages in R4.
5. **Test** reports reachable, a wrong status, or unreachable, with the messages in R14, using the typed value.

<!-- sources: backend/src/infrastructure/developer-settings/**, backend/src/modules/developer-settings/**, frontend/src/app/features/developer/**, frontend/src/app/app.html (Developer navigation), frontend/electron/main.cjs (backend:restart), frontend/electron/preload.cjs -->
