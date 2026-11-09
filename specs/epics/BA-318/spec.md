# BA-318 — Datasource metadata: layer and description

- **Jira:** [BA-318](https://halo-powered.atlassian.net/browse/BA-318) · **Roadmap:** Milestone 1.20 · **Status:** Confirmed (by the user on 2026-11-09).

## Goal

Users can say what a datasource is for. When adding or editing a datasource, of any kind, they can pick its data **layer** (Landing, Normalized or Consumption) and write a free-text **description**. The Datasources list then shows the layer as a badge and the description under the name, so a list of similar connections can be told apart at a glance.

## Scope

- **Two optional fields on every datasource**, stored in the datasource document and returned by the API:
  - `layer`: one of `landing`, `normalized`, `consumption`, or absent. UI labels: "Landing", "Normalized", "Consumption"; the dropdown's empty option is "None".
  - `description`: free text, trimmed and capped at 500 characters; empty means absent.
- **Form:** a Layer dropdown and a Description textarea, after Kind, for all three kinds, on add and on edit.
- **No re-test for metadata:** an edited datasource whose connection settings are unchanged since the form opened can be saved without a new connection test. This covers Name, Layer and Description. A new datasource, or any connection-field change, still needs a successful test first (datasources R13).
- **Saves that leave the fields out keep them:** `POST /datasources` without `layer` or `description` keeps the stored values. Testing Data re-registers its sample datasources this way, so a user's layer and description on a sample survive a reload. Sending `null` or an empty string clears a field.
- **List:** a layer badge beside the kind badge, and the description under the name (one line, truncated, full text in a tooltip).
- **Existing data:** datasources saved before this change have no layer and no description. No migration: both fields are optional and new.

## Out of scope

- Using layer or description in agent prompts, dataset pickers, session headers or anywhere outside Settings → Datasource Configuration.
- Filtering or grouping the list by layer.
- Layers other than the three named, or user-defined layers.
- Setting a layer on the Testing Data samples.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-319](https://halo-powered.atlassian.net/browse/BA-319) | Add layer dropdown and description to the datasource form and list | 1.20.1 |

## Specs touched

- [capabilities/datasources](../../capabilities/datasources/spec.md): R2 (the two fields), R13 (save without re-test when only metadata changed), new rules for layer values, description limits and the keep-on-omit save; the UI section (form table, list row); a new Gherkin scenario.
- [system/api.md](../../system/api.md): 2.2 #15 (`DatasourceView` gains `layer?`, `description?`) and #18 (body fields and keep-on-omit).
- [system/data-model.md](../../system/data-model.md): the `connections` document gains `layer?` and `description?`.
- [product/glossary.md](../../product/glossary.md): "Datasource layer".

No ADR: two optional fields on an existing document, with no new collection, container or data flow.

## Acceptance

- Creating a datasource with Layer "Consumption" and a description shows both in the list, and both are back in the form after a reload and an Edit.
- Changing only the Layer or Description of a saved datasource, then clicking "Save changes" without testing, saves it. Changing a connection field disables Save until a successful test.
- A datasource saved before this change lists and edits normally, with Layer "None" and an empty description.
- Loading a Testing Data sample again keeps the layer and description the user gave its datasource.
- The API rejects an unknown layer with `layer must be one of: landing, normalized, consumption`.
- Backend and frontend unit tests, `python3 scripts/check-specs.py`, lint, builds and the Datasources Playwright scenarios (including the new one) pass on the web target.
- No eval gate: no agent's prompt, tools, skills or context changes.

## Dependencies, risks and open questions

- **Depends on** the datasources capability as shipped (R1–R50) and the World Cup sample database for E2E.
- **Risk:** R13 today resets the tested state when an edit opens. Relaxing it for unchanged connection settings must not let an untested *changed* connection be saved; the unit tests cover both paths.
- **Open question:** none at drafting time. Optional fields, no re-test for metadata, and showing them in the list only were settled with the user on 2026-11-09.
