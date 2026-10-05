# Engine levers

Every behaviour of the assistant that the engine improvement loop measures is a named switch, an **engine lever**, rather than a code change: how much curated context a turn gets, which extra tools it has, whether failed SQL is repaired by a separate fixer, whether a second derivation or a review checks the answer, and which prompt rules are present. The operator sets the production values of these levers in Settings → **Engine levers**; every chat turn runs with them. An eval run can apply a named **arm** (a preset of lever values) over the production values, so comparing two engines is two runs of the same question set, not two builds. The same screen pins the model the eval judge grades on, so changing the assistant's model does not move the ruler.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): engine lever, arm, eval judge, assistant, reasoning effort, careful mode, knowledge entry, metric, verified query, eval category.

Capability-local vocabulary:
- **Shipped defaults** — the lever values the engine ships with: the engine as it behaved before the levers existed (R2).
- **Production values** — the shipped defaults overridden by whatever the operator saved here; what every chat turn runs with.
- **Rule group** — a named block of the assistant's instructions that an arm may remove for a prompt-ablation measurement (R9).
- **Corrective pass** — one more assistant step, with tools, that a check after the answer may ask for once per turn (R7).

## Rules

The levers
- R1. The system SHALL define these levers, each with a fixed type:
  - context: `context` (`curated` = the knowledge, metrics and verified-query blocks are in the turn's context; `bare` = schema only, what a new customer has on day one), `columnProfiles` (per-entity schema cards with column statistics, also shown when the assistant describes an entity), `inlineKnowledge` (a knowledge entry about one column shown beside that column), `rankedKnowledge` (knowledge and metrics ranked by relevance to the question instead of newest first), `lookupTools` (the assistant gets the `lookup_values` and `lookup_knowledge` tools);
  - tools: `descriptiveErrors` (a failed query's error names the closest columns and tables, their types and known values), `sqlPrecheck` (a static check of each statement before it runs; it only warns, never blocks), `extendedGuards` (more result warnings: a constant metric of any value, a result keyed only by ids, a missing default filter), `staticFirstContext` (static context blocks first, the per-turn ones last), `repairIntentGuard` (each automatic SQL repair is compared with the original and flagged when it changed filters or aggregates);
  - pipeline: `sqlRepair` (failed SQL goes to the separate fixer; off = the assistant retries with the error itself), `careful` (`off`, `on`, or `auto` = the independent cross-check runs only for risky questions — eval categories `ratio-trap`, `metric-definition`, `multi-step-join`, `default-filter`, `unit-confusion` — and for turns whose own SQL drew a result warning or a precheck finding, or whose automatic repair changed what the query asks), `answerReview` (R7);
  - prompt: `promptAblation` (a list of rule-group ids to remove, `*` meaning every removable group);
  - memory: `memory` (`off`, `recall` or `recall+models`; R15);
  - optional overrides: `reasoningEffort` (`low`, `medium` or `high`, overriding the LLM setting) and `maxSteps` (an integer from 1 to 50, overriding the step budget).
- R2. The shipped defaults SHALL be: `context` curated, `sqlRepair` on, `repairIntentGuard` on, `careful` off, every other switch off, nothing ablated, no effort or step override. With the shipped defaults a chat turn SHALL behave as it did before the levers existed, apart from the repair-intent flag.
- R3. Lever values arriving from storage or from a request SHALL be sanitised: an unknown lever or a value of the wrong type SHALL be dropped silently and never reach a turn. The resolved values of a turn SHALL be the shipped defaults, then the production values, then (for an eval run) the arm, then the run's explicit overrides, later layers winning.
- R4. Every chat turn SHALL read the production values when it starts and apply one resolution to the whole turn, including the tools it calls.

Arms
- R5. The system SHALL offer these named arms, each a partial set of lever values: `baseline` (nothing — the production values as saved), `legacy` (the shipped defaults, whatever is saved), `bare`, `curated`, `profiles` (column profiles and inline knowledge), `ranked`, `lookup`, `context-full` (every context switch), `errors` (descriptive errors), `fixer-off` (no SQL fixer, descriptive errors on), `precheck`, `guards`, `static-first`, `tools-full` (descriptive errors, precheck, extended guards, static-first), `review`, `careful-auto`, `careful-on`, `no-prompt-rules` (ablate every removable group), `effort-medium`, `effort-low`, `memory-recall` (the shipped defaults with `memory` = `recall`), `memory-models` (the shipped defaults with `memory` = `recall+models`) and `full` (every context and tool switch, answer review, careful auto). Each SHALL carry a one-line description shown wherever an arm is picked.
- R6. An arm name SHALL be a preset name or `custom:<JSON object of lever values>`. An unknown name SHALL be refused with `Unknown arm "<name>" — known arms: <names>`; malformed JSON with `Arm "<name>" is not valid JSON after "custom:"`. The text form of overrides, `key=value,key=value` (booleans as true/false/on/off/yes/no/1/0, lists joined with `+`), SHALL reject an unknown key or an impossible value with a message naming it.

Answer review and lookup
- R7. With `answerReview` on, after the answer is final the system SHALL make one review call over the turn's own transcript (the question, each statement and whether it succeeded, the result shapes, the warnings and the answer) that looks only for these eight problems: an unsupported claim, a wrong or shifted date filter, a truncated result presented as complete, arithmetic done in prose, comparison windows that do not match, a requested breakdown answered with one figure, a degenerate query, and a mismatch with a governed metric or default filter. On a finding the assistant SHALL get one corrective pass; the review outcome SHALL be recorded on the answer: `ok` (nothing found), `revised` (the corrective pass rewrote the answer), `flagged` (findings the corrective pass could not address; the original answer stands) or `error` (the review could not complete; the answer is never lost). The review never runs a query or re-derives the answer.
- R8. With `lookupTools` on, `lookup_values` SHALL return the stored values of one column of an entity in the session's datasets that best match a phrase, tolerating case, accents and typos (10 by default, at most 50), drawn from the column's profile when that lists every distinct value and otherwise from a live, case-insensitive substring query; an unknown column SHALL be answered with the closest column names. `lookup_knowledge` SHALL return the curated knowledge entries and metrics that match a term, optionally narrowed to an entity and column. With the lever off neither tool SHALL be offered to the model.

Prompt rule groups
- R9. The assistant's instructions SHALL be built from named rule groups in a fixed order; with nothing ablated they SHALL be exactly the instructions the assistant has without levers. The role, procedure and grounding groups SHALL never be removable.

Memory
- R15. The lever `memory` SHALL be `off` (default; no recall and no retain, memory fully off), `recall` (learned memories from past sessions are recalled into the turn and user signals are retained) or `recall+models` (also the consolidated mental-models block). It SHALL act only when a memory server is configured (`HINDSIGHT_URL`); otherwise every value behaves as `off`. The shipped default is `off`, so R2 holds. The lever SHALL be part of the configuration hash. An eval arm MAY turn it on so that recall runs for that arm; evals never retain, because signals come only from user actions. Behaviour: [../knowledge/spec.md](../knowledge/spec.md) R36 to R44; blocks: [../../system/agents.md](../../system/agents.md) 4.1 and 10.2.

Production settings
- R10. The settings SHALL be one stored record holding only the levers the operator changed from the shipped defaults, the pinned judge model and the Databricks reasoning-effort switch. Saving SHALL accept the full set of production values and persist only the differences; omitting the values SHALL leave the stored ones untouched.
- R11. The judge model SHALL be a `<provider>/<model>` route or empty. Anything else SHALL be refused with `judgeModel must be a "<provider>/<model>" router id (e.g. openai/gpt-4.1-mini), or empty to clear it — got "<value>"`, writing nothing. Empty SHALL clear the pin.
- R12. When a judge model is pinned and its provider matches the configured LLM provider, the judge SHALL use the stored credentials (and gateway URL) with the pinned model. When the providers differ, the judge SHALL use the route through the environment-bound default credentials and log a warning. With no pin, the judge SHALL use the assistant's configured model.
- R13. Reasoning effort SHALL NOT be sent to Databricks Model Serving endpoints unless the Databricks reasoning-effort switch is on (many endpoints reject the field).
- R14. Reading the settings SHALL return the resolved production values, only the stored differences, the shipped defaults, the judge model (or none), the Databricks switch, every arm with its values and description, and the rule groups (id, title, removable or not).

## Edge cases and errors

- Nothing saved yet: the screen shows the shipped defaults; every chat turn runs with them.
- A stored record carrying a lever that no longer exists, or a value of the wrong type, is read as if the field were absent.
- A pinned judge model of another provider than the configured LLM works only when that provider's environment credentials are set; otherwise judged eval cases score as measurement gaps, not failures (see [../agents-evals/spec.md](../agents-evals/spec.md)).
- Switching `sqlRepair` off makes a failed query surface to the assistant, which retries with the question in mind; with `descriptiveErrors` also off the error is the database's own text.
- `careful` set to `auto` in chat (where no eval category is known) runs the cross-check only on turns with a result warning, a precheck finding or a question-changing repair.

## Contracts

- Endpoints `GET /engine/settings`, `PUT /engine/settings`: [../../system/api.md](../../system/api.md).
- The stored settings record (key `engine` in the settings collection) and the lever fields recorded on answers and eval runs: [../../system/data-model.md](../../system/data-model.md).
- The answer-review agent, the lookup tools, rule groups and judge model routing: [../../system/agents.md](../../system/agents.md).
- Arms as used by eval runs and loops: [../agents-evals/spec.md](../agents-evals/spec.md) R52 to R70.
- Screen layout: [../../system/ui.md](../../system/ui.md).

## UI

Settings sidebar, **Engine levers** (below **Testing Data**). Heading "Engine levers" with "These are production defaults for every chat turn. Eval runs override them per arm — measure a lever with Agents → Evals → Loop run before switching it on here." Sections, top to bottom: **Context**, **Tools**, **Pipeline** (one row per lever with its label, a one-line explanation and a switch or select; it also holds the select "Memory (Hindsight)": Off / Recall / Recall + mental models, help "Learn from approvals and corrections across sessions. Needs HINDSIGHT_URL on the backend.", test id `engine-lever-memory`), **Prompt** (the removable rule groups), **Eval judge** ("Judge model" text box, placeholder `openai/gpt-4.1-mini`, hint "Router id (<provider>/<model>), pinned so changing the assistant's model does not move the ruler. Empty = the assistant's own configured model."; a switch "Send reasoning effort to Databricks endpoints — Off by default — many serving endpoints reject the field."), a collapsible read-only list of **Arms**, then **Save** and **Reset to shipped defaults**. States: loading ("Loading engine settings…"), load error, populated, saving, resetting. Results appear as toasts.

## Flows

E2E: none yet for the Feature below. (Opening this screen is exercised by the engine-loop test in the agents Playwright spec, owned by [../agents-evals/spec.md](../agents-evals/spec.md).)

```gherkin
Feature: Engine levers

  Scenario: Shows the shipped defaults when nothing is saved
    Given no engine settings are saved
    When I open Settings and click "Engine levers"
    Then I see the sections "Context", "Tools", "Pipeline", "Prompt" and "Eval judge"
    And the SQL fixer switch is on and every other switch is off

  Scenario: Saves a production lever
    When I switch on "Answer review" and click "Save"
    Then I see a success toast
    And the next chat answer is reviewed before it is shown

  Scenario: Pins the eval judge
    When I enter "openai/gpt-4.1-mini" as the judge model and click "Save"
    Then judged eval cases are graded by that model

  Scenario: Refuses a malformed judge model
    When I enter "gpt-4.1-mini" as the judge model and click "Save"
    Then I see a message starting 'judgeModel must be a "<provider>/<model>" router id'
    And nothing is saved

  Scenario: Resets to the shipped defaults
    Given I saved changes to several levers
    When I click "Reset to shipped defaults"
    Then every lever shows its shipped value
```

## Acceptance

- With nothing saved, a chat turn behaves as before the levers existed (same instructions, same tools, same context blocks).
- A lever saved here applies to the next chat turn without a restart.
- An eval run with arm `fixer-off` never calls the SQL fixer; with `bare` its turns carry no knowledge, metric or verified-query block.
- A pinned judge model is the model recorded as the judge in the run's log.

## Open questions

- The answer-review outcome is stored on the answer but not shown in the chat UI.
- The Databricks LLM route and the Databricks fixture loader are unit-tested only; neither has been run against a live workspace.

<!-- sources: backend/src/modules/engine/, backend/src/mastra/agents/{assistant-instructions,answer-review.agent}.ts, backend/src/mastra/tools/lookup.tools.ts, backend/src/modules/sessions/{sessions.service,answer-review,sql-precheck,sql-errors,sql-repair-guard,result-guards}.ts, backend/src/modules/llm/llm.service.ts (judge resolver, Databricks effort), frontend/src/app/features/engine/ -->
