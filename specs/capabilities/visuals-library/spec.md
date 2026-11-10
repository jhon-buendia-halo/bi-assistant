# Visuals library

Analysts keep a **visuals library**: a catalog of chart types for data visualization, grouped by what they show (Comparison, Change over time, Part-to-whole and so on). Each chart has a name, a category, a small preview thumbnail, a description, when to use it, when to avoid it, the data it needs, and whether the app can draw it. The app ships a default catalog of 30 charts that the team can edit, disable or delete, and add to. The section lives in the Context area. Today it is manage-only: agents, the visual designer and sessions do not read the library yet, so nothing in it changes an answer or a chart. A later release will let agents pick from it.

This is not the [visuals](../visuals/spec.md) capability, which is the interactive visuals a chat session creates and tailors. The library describes chart types; it holds no data and draws nothing in a session.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): visuals library, chart, category, renderer form, assistant, session.

Capability-local vocabulary is limited to the UI words "Add chart", "Drawn by the app" and "No charts yet".

## Rules

Shape and validation
- R1. The system SHALL store each chart with: a unique id, a name, a category, a preview key, a renderer form (or none), a description, when to use, when to avoid, the data shape needed, an enabled flag, a built-in flag, and created/updated timestamps. Shape: [../../system/data-model.md](../../system/data-model.md) (section 3.9b).
- R2. The system SHALL trim every string it receives. A name SHALL be required: a blank name SHALL be rejected with `Name is required`, and a name longer than 80 characters with `Name is at most 80 characters`. A category SHALL be required (`Category is required`) and at most 60 characters (`Category is at most 60 characters`); it is free text, so the user MAY create a category the defaults do not use.
- R3. The system SHALL limit a description, when to use and when to avoid to 1,000 characters each (`Description is at most 1,000 characters`, `When to use is at most 1,000 characters`, `When to avoid is at most 1,000 characters`) and the data shape to 200 characters (`Data needed is at most 200 characters`), for example "1 category + 1 measure". Each MAY be empty.
- R4. The preview key SHALL be one of the 30 preview keys the app draws (the Preview column of the table under R14) or `none` (no thumbnail, the default); any other value SHALL be rejected with `Unknown preview`. The renderer form SHALL be one of `bar`, `line`, `scatter`, `heatmap`, `metric-cards`, `table`, `donut` (the chart forms the app draws, [../visuals/spec.md](../visuals/spec.md)) or none (the default, "not drawn by the app"); any other value SHALL be rejected with `Unknown renderer form`. The enabled flag SHALL be a boolean (`Enabled must be true or false`) and defaults to true.
- R5. Chart names SHALL be unique ignoring case. Creating or renaming a chart to a name another chart already has SHALL fail with `A chart named "<name>" already exists` (HTTP 409). Renaming a chart to its own name, in any case, SHALL be allowed.
- R6. The built-in flag SHALL be set only by the seed (R14). A chart created or edited by the user SHALL NOT take it from the request.

Listing and search
- R7. Listing SHALL return every chart grouped for display: the nine default categories first in the shipped order (Comparison, Change over time, Part-to-whole, Distribution, Relationship, Ranking, Flow, Spatial, Numbers and tables), any other category after them alphabetically ignoring case, and within a category by name ignoring case.
- R8. The section SHALL show one group per category present, headed by the category name and the number of charts in it. Each chart SHALL be a card with its preview thumbnail, name and a two-line description; a chart the app can draw SHALL carry the badge "Drawn by the app", and a disabled chart SHALL be faded and carry the badge "Disabled".
- R9. A search box SHALL narrow the cards, case-insensitively, to the charts whose name, description, when to use or category contain the typed text. Category chips ("All" and one per category present) SHALL narrow the cards to one category. Search and a category chip combine. A group with no matching card is hidden.

Authoring
- R10. The user SHALL be able to create, edit, enable, disable and delete charts. Update SHALL be partial: only the fields present in the request are validated and applied, an omitted field is kept, and the updated time SHALL be restamped on every update.
- R11. Choosing a card SHALL open its editor in place: the card is replaced by the form, spanning the full row at that position, and scrolled into view. **Add chart** SHALL open an empty form at the top of the list. One form is open at a time; Cancel closes it without a change. The form's preview select SHALL show a live thumbnail of the chosen preview.
- R12. Updating or deleting a chart that does not exist SHALL fail with `Chart not found` (HTTP 404).
- R13. Deleting a chart SHALL be permanent and SHALL ask the user for confirmation first. A built-in chart MAY be edited and deleted like any other.

Defaults and scope of use
- R14. Every data dir SHALL start with a default catalog of 30 charts in 9 categories (the table below), each with a real description, when to use, when to avoid and data shape (exact text in `backend/src/modules/visuals/default-visuals.ts`). The backend SHALL add them once, on its first start with this version: on new installs and on existing ones alike, marked built-in. It SHALL NOT add them again once seeded, so a default that was edited, renamed or deleted stays that way; when a chart with a default's name (ignoring case) already exists, the seed SHALL skip that default. A failed seed SHALL NOT stop the backend; it is tried again on the next start.
- R15. Agents, sessions, the visual designer, the assistant's context blocks and eval runs SHALL NOT read or use the library in this release.
- R16. Charts SHALL be kept in the app's local store and SHALL survive a restart ([../../system/data-model.md](../../system/data-model.md)).

### The default catalog

| Category | Name | Preview | Renderer form |
|---|---|---|---|
| Comparison | Bar chart | `bar` | `bar` |
| Comparison | Column chart | `column` | `bar` |
| Comparison | Grouped bar chart | `grouped-bar` | `bar` |
| Comparison | Bullet chart | `bullet` | none |
| Comparison | Radar chart | `radar` | none |
| Change over time | Line chart | `line` | `line` |
| Change over time | Area chart | `area` | none |
| Change over time | Sparkline | `sparkline` | none |
| Change over time | Slope chart | `slope` | none |
| Change over time | Calendar heatmap | `calendar-heatmap` | none |
| Part-to-whole | Donut chart | `donut` | `donut` |
| Part-to-whole | Pie chart | `pie` | none |
| Part-to-whole | Stacked bar chart | `stacked-bar` | none |
| Part-to-whole | Treemap | `treemap` | none |
| Part-to-whole | Waterfall chart | `waterfall` | none |
| Distribution | Histogram | `histogram` | none |
| Distribution | Box plot | `box-plot` | none |
| Distribution | Strip plot | `strip` | none |
| Relationship | Scatter plot | `scatter` | `scatter` |
| Relationship | Bubble chart | `bubble` | none |
| Relationship | Heatmap | `heatmap` | `heatmap` |
| Ranking | Ordered bar chart | `ordered-bar` | `bar` |
| Ranking | Lollipop chart | `lollipop` | none |
| Ranking | Bump chart | `bump` | none |
| Flow | Sankey diagram | `sankey` | none |
| Flow | Funnel chart | `funnel` | none |
| Spatial | Choropleth map | `choropleth` | none |
| Spatial | Symbol map | `symbol-map` | none |
| Numbers and tables | KPI cards | `metric-cards` | `metric-cards` |
| Numbers and tables | Table | `table` | `table` |

## Edge cases and errors

- Empty library (every chart deleted): the section shows "No charts yet." with the "Add chart" action.
- No match for the search and category: the section shows "No charts match your search."
- Load failure: the section shows `Could not load charts`.
- Save or delete failure: the backend's message is shown inline in the editor and nothing is changed; a duplicate name shows `A chart named "<name>" already exists`.
- A blank name or category keeps Save disabled; the backend still refuses them if sent (R2).
- Two charts whose names differ only by case cannot coexist (R5).
- A category the user typed that no chart uses any more disappears with its last chart; its chip goes too.

## Contracts

- Endpoints: list, create, partial update and delete under the visuals resource. See [../../system/api.md](../../system/api.md) (section 2.8b).
- Collection and document shape (`visual_charts`) and the seed marker: see [../../system/data-model.md](../../system/data-model.md) (section 3.9b).
- Related: [../visuals/spec.md](../visuals/spec.md) (the chart forms the app draws in a session), [../user-personas/spec.md](../user-personas/spec.md) (the sibling manage-only Context section), [../app-shell/spec.md](../app-shell/spec.md) R3a (the Context page and its cards).

## UI

Placement: the **Context** item on the navigation rail opens the Context page; its **Visuals** card opens a full-width section titled "Visuals" in the main area, under a **Context** back control that returns to the cards ([app-shell](../app-shell/spec.md) R3a, [../../system/ui.md](../../system/ui.md) 4.8c). Context stays the current rail item.

- Header: level-two heading "Visuals", the note "Chart types for data visualization, grouped by what they show.", and an **Add chart** button; under it a search box ("Search charts") and the category chips.
- List: one group per category (R7, R8), cards in a grid, three to a row on a wide window and fewer on a narrow one.
- Editor: Name, Category (with the existing categories as suggestions), Preview (with a live thumbnail), Drawn by the app as ("Not drawn by the app" or a renderer form), Description, When to use, When to avoid, Data needed and Enabled; **Save**, **Cancel** and, for an existing chart, **Delete**. A backend message is shown inline.

## Flows

E2E: `frontend/e2e/visuals-library.spec.ts`

```gherkin
Feature: Visuals library

  Scenario: Browse the library and edit a chart in place
    Given the app starts with a new data dir
    When I open the Context page and click the "Visuals" card
    Then I see the charts grouped by category, "Comparison" first
    When I click the "Part-to-whole" chip
    Then I see only its 5 charts, "Donut chart" with the badge "Drawn by the app"
    When I click "All" and type "funnel" in "Search charts"
    Then only "Funnel chart" is listed, under "Flow"
    When I clear the search and click the "Pie chart" card
    Then the editor opens in place of the card, with every field filled in

  Scenario: A new install shows the catalog grouped by category
    Given the app starts with a new data dir
    When I open the Context page and click the "Visuals" card
    Then I see the "Visuals" section and "Context" is still the current rail item
    And I see 9 category groups, "Comparison" first and "Numbers and tables" last
    And I see 30 chart cards, each with a preview thumbnail
    And "Bar chart" carries the badge "Drawn by the app" and "Radar chart" does not

  Scenario: Search narrows the cards
    Given I am on the "Visuals" section
    When I type "funnel" in "Search charts"
    Then only "Funnel chart" is listed, under "Flow"
    When I type "zzzz"
    Then I see "No charts match your search."

  Scenario: Filter by category
    Given I am on the "Visuals" section
    When I click the "Ranking" chip
    Then I see only the 3 charts of "Ranking"
    When I click "All"
    Then I see all 30 charts again

  Scenario: Add a chart
    Given I am on the "Visuals" section
    When I click "Add chart"
    And I fill Name with "Dot plot" and Category with "Distribution", choose the Preview "Strip", and fill Description
    And I click "Save"
    Then "Dot plot" is listed under "Distribution" in name order, without the badge "Drawn by the app"
    And it is still listed after the app restarts

  Scenario: Edit a chart in place
    Given the "Visuals" section lists "Pie chart"
    When I click its card
    Then the card is replaced by the editor at the same position
    When I change Description and click "Save"
    Then the card shows the new description
    And the other cards are unchanged

  Scenario: Disabling a chart fades it
    Given the "Visuals" section lists "Pie chart"
    When I edit it, clear Enabled and click "Save"
    Then its card is faded and carries the badge "Disabled"

  Scenario: Delete a chart after confirmation
    Given a chart "Dot plot" exists
    When I edit it, click "Delete" and confirm
    Then "Dot plot" is no longer listed

  Scenario: A duplicate name is refused
    Given the "Visuals" section lists "Bar chart"
    When I add a chart named "bar CHART" and click "Save"
    Then I see the message `A chart named "bar CHART" already exists` in the editor
    And no second chart is listed

  Scenario: A deleted default stays deleted
    Given I deleted "Radar chart"
    When the app restarts
    Then "Radar chart" is not listed
    And the other 29 default charts are listed
```

## Acceptance

- Every Gherkin scenario above passes against the running app (backend tests cover R1-R6, R10, R12 and R14 at service and controller level).
- A new data dir lists the 30 default charts in 9 categories with previews; a chart created with every field is returned unchanged by the list, edited fields change and omitted ones are kept, and a deleted chart is gone after a restart, defaults included (R14).
- No agent prompt, session or eval run changes when the library changes (R15).

<!-- sources: backend/src/modules/visuals/**, frontend/src/app/features/visuals/**, frontend/src/app/app.html (Context page cards) -->
