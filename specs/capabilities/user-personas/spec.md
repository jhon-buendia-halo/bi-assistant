# User personas

Analysts keep a small library of **user personas**: short profiles of the people who ask the questions, each with a role, goals, typical questions, an expertise level and a preferred answer style. The section lives in the Context area (the only section there since the dataset ontology moved into the dataset editor, roadmap 1.21.8). Today it is manage-only: agents and sessions do not read personas yet, so nothing a persona says changes an answer. A later release will give agents the personas as context.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): user persona, expertise, typical question, answer style, assistant, session.

Capability-local vocabulary is limited to the UI words "New persona" and "No personas yet".

## Rules

Shape and validation
- R1. The system SHALL store each persona with: a unique id, a name, a role, a description, goals, a list of typical questions, an expertise, an answer style, and created/updated timestamps.
- R2. The system SHALL trim every string it receives. A name SHALL be required: a blank name SHALL be rejected with `Name is required`, and a name longer than 80 characters with `Name is at most 80 characters`.
- R3. The system SHALL limit a role to 80 characters (`Role is at most 80 characters`), a description to 2,000 characters (`Description is at most 2,000 characters`), goals to 2,000 characters (`Goals are at most 2,000 characters`) and an answer style to 500 characters (`Answer style is at most 500 characters`). Role, description, goals and answer style MAY be empty.
- R4. The system SHALL drop blank typical questions after trimming, SHALL accept at most 10 (`At most 10 typical questions`) and SHALL limit each to 300 characters (`A typical question is at most 300 characters`).
- R5. The system SHALL accept exactly three expertise values: `novice`, `intermediate` and `expert`. Any other value SHALL be rejected with `Expertise must be novice, intermediate or expert`. A persona created without an expertise SHALL be `intermediate`.
- R6. Persona names SHALL be unique ignoring case. Creating or renaming a persona to a name another persona already has SHALL fail with `A persona named "<name>" already exists` (HTTP 409). Renaming a persona to its own name, in any case, SHALL be allowed.

Listing and authoring
- R7. Listing SHALL return every persona sorted by name, ignoring case.
- R8. The user SHALL be able to create, edit and delete personas. Update SHALL be partial: only the fields present in the request are validated and applied, an omitted field is kept, and the updated time SHALL be restamped on every update.
- R9. Updating or deleting a persona that does not exist SHALL fail with `Persona not found` (HTTP 404).
- R10. Deleting a persona SHALL be permanent and SHALL ask the user for confirmation first.
- R11. Personas SHALL be kept in the app's local store and SHALL survive a restart. They belong to the one user ([../../system/data-model.md](../../system/data-model.md)).

Scope of use
- R12. Agents, sessions, the assistant's context blocks and eval runs SHALL NOT read or use personas in this release.
- R13. Every data dir SHALL start with one default persona, **Demo Finance Analyst**, with every field filled in (role `FP&A analyst`, a description, goals, five typical questions, expertise Intermediate and an answer style; exact text in `backend/src/modules/personas/demo-persona.ts`). The backend SHALL add it once, on its first start with this version: on new installs and on existing ones alike. It SHALL NOT add it again once seeded, so a demo persona that was edited, renamed or deleted stays that way. When a persona with that name (ignoring case) already exists, the seed SHALL add nothing. A failed seed SHALL NOT stop the backend; it is tried again on the next start.

## Edge cases and errors

- Empty library: the section shows "No personas yet" with a hint and the "New persona" action.
- Load failure: the section shows `Could not load personas`.
- Save or delete failure: the backend's message is shown inline in the editor (or the list) and nothing is changed; a duplicate name shows `A persona named "<name>" already exists`.
- A blank name keeps Save disabled; the backend still refuses it with `Name is required` if it is sent.
- An eleventh typical question is refused with `At most 10 typical questions`; the editor stops offering "Add" at 10.
- Two personas whose names differ only by case cannot coexist (R6).

## Contracts

- Endpoints: list, create, partial update and delete under the personas resource. See [../../system/api.md](../../system/api.md) (section 2.8a).
- Collection and document shape (`user_personas`): see [../../system/data-model.md](../../system/data-model.md) (section 3.9a).
- Related: [../dataset-ontology/spec.md](../dataset-ontology/spec.md) (the ontology that agents are given besides personas, edited in the dataset editor), [../app-shell/spec.md](../app-shell/spec.md) R3a (the Context page and its cards).

## UI

Placement: the **Context** item on the navigation rail opens the Context page; its **User personas** card opens a full-width section titled "User personas" in the main area, under a **Context** back control that returns to the cards ([app-shell](../app-shell/spec.md) R3a, [../../system/ui.md](../../system/ui.md) 4.8b). Context stays the current rail item.

- Header: level-two heading "User personas", the note "Describe who asks the questions. Agents will use personas as context in a later release.", and a **New persona** button.
- List: personas sorted by name (R7). Each row shows the name, the role and an expertise chip (Novice, Intermediate or Expert), with Edit and Delete actions. Delete asks `Delete persona "<name>"?`.
- States: loading, error (`Could not load personas`), empty ("No personas yet"), populated.
- Editor (opened by New persona or Edit; Cancel returns to the list): Name (required), Role, Description, Goals, Typical questions (a list editor, up to 10), Expertise (Novice, Intermediate by default, Expert) and Answer style. Save is disabled while the name is blank; a backend message is shown inline on failure.

## Flows

E2E: `frontend/e2e/user-personas.spec.ts`

```gherkin
Feature: User personas

  Scenario: Open the section from the Context page
    Given I am on the Context page
    When I click the "User personas" card
    Then I see the "User personas" section and "Context" is still the current rail item
    When I click the "Context" back control
    Then I see the Context page with its cards

  Scenario: A new install starts with the demo persona
    Given the app starts with a new data dir
    When I open the "User personas" section
    Then I see "Demo Finance Analyst" with role "FP&A analyst" and the chip "Intermediate"
    And editing it shows every field filled in

  Scenario: A deleted demo persona does not come back
    Given I deleted "Demo Finance Analyst"
    When the app restarts
    Then "Demo Finance Analyst" is not listed

  Scenario: The empty library invites the first persona
    Given no personas exist
    When I open the "User personas" section
    Then I see "No personas yet"
    And I see the "New persona" button

  Scenario: Create a persona with every field
    Given I am on the "User personas" section
    When I click "New persona"
    And I fill Name with "Ana, finance analyst", Role with "Finance analyst", Description, Goals, two Typical questions and Answer style
    And I choose Expertise "Expert"
    And I click "Save"
    Then "Ana, finance analyst" is listed with the role "Finance analyst" and the chip "Expert"
    And it is still listed after the app restarts

  Scenario: Blank name keeps Save disabled
    Given the persona editor is open
    When Name is empty or only spaces
    Then "Save" is disabled

  Scenario: Edit a persona
    Given a persona "Ana, finance analyst" exists
    When I click its Edit button, change Role to "Controller" and click "Save"
    Then the list shows the role "Controller"
    And its other fields are unchanged

  Scenario: Delete a persona after confirmation
    Given a persona "Ana, finance analyst" exists
    When I click its Delete button and confirm `Delete persona "Ana, finance analyst"?`
    Then the persona is no longer listed

  Scenario: A duplicate name is refused
    Given a persona "Ana, finance analyst" exists
    When I create a persona named "ana, FINANCE analyst" and click "Save"
    Then I see the message `A persona named "ana, FINANCE analyst" already exists` in the editor
    And no second persona is listed
```

## Acceptance

- Every Gherkin scenario above passes against the running app (backend tests cover R1-R11 at service and controller level).
- A persona created with every field is returned unchanged by the list, edited fields change and omitted ones are kept, and a deleted persona is gone after a restart.
- No agent prompt, session or eval run changes when personas exist (R12).
- A new data dir lists Demo Finance Analyst with every field filled; deleting it and restarting leaves it deleted (R13).

<!-- sources: backend/src/modules/personas/**, frontend/src/app/features/personas/**, frontend/src/app/app.html (Context page cards) -->
