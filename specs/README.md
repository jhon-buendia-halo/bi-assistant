# Specs

The complete, current specification of Questions to Insights. The goal: an LLM given **only this folder** can rebuild the app from scratch, and every change is specified here before it is built. See *Spec convention* in [CLAUDE.md](../CLAUDE.md).

Each fact lives in exactly one file. Other files link to it rather than copying it.

## Layout

```
specs/
  README.md                        this file: index, format, lifecycle, rebuild prompt
  product/
    vision.md                      problem, users, value, product principles
    glossary.md                    every domain term, defined once
    non-functional.md              platforms, local-first, security, privacy, performance, accessibility
  system/
    architecture.md                C4 diagrams (levels 1–4) and every ADR
    tech-stack.md                  the current implementation profile: frameworks, versions, code layout
    data-model.md                  persisted collections, document shapes, files on disk, migrations
    api.md                         HTTP + streaming contract, desktop IPC bridge, CLI contract
    agents.md                      every LLM agent: role, prompt requirements, tools, memory, model routing
    ui.md                          app shell, navigation, panels, design tokens, UI states
    delivery.md                    build, packaging, distribution, versioning and release
  capabilities/<capability>/spec.md  one per capability: rules, edge cases, flows (Gherkin), acceptance
  epics/<EPIC-ID>/spec.md          one high-level spec per Jira epic
```

### Capabilities

| Capability | What it covers | Gherkin Features (Playwright spec) |
|---|---|---|
| [app-shell](capabilities/app-shell/spec.md) | Layout, navigation, resizable panels, backend status, toasts, accessibility | Layout and accessibility (`layout-accessibility.spec.ts`) |
| [diagnostics](capabilities/diagnostics/spec.md) | System logs panel, redaction, LLM-readable export | Diagnostics (`diagnostics.spec.ts`) |
| [llm-settings](capabilities/llm-settings/spec.md) | LLM provider configuration, encrypted keys, model resolution | — |
| [datasources](capabilities/datasources/spec.md) | Connections (PostgreSQL, Databricks, REST/OpenAPI), testing, discovery, read-only execution | Datasources, datasets, and sessions (`world-cup-workflow.spec.ts`) |
| [datasets](capabilities/datasets/spec.md) | Catalog browser, entity selection, entity details, relationships | — (covered by the datasources Feature) |
| [testing-data](capabilities/testing-data/spec.md) | Sample / test data setup | — |
| [developer-settings](capabilities/developer-settings/spec.md) | Developer observability switch, endpoints, restart to apply | Developer settings (`developer-settings.spec.ts`), Developer observability export (`developer-observability.spec.ts`) |
| [sessions-chat](capabilities/sessions-chat/spec.md) | Sessions, streamed chat, tools, SQL repair and verification, clarification, memory | Chat and visuals (`chat-and-visuals.spec.ts`) |
| [visuals](capabilities/visuals/spec.md) | Interactive visuals: create, tailor, version, revert, refresh, repair, export | — (covered by the Chat and visuals Feature) |
| [knowledge](capabilities/knowledge/spec.md) | Knowledge entries and bootstrap from data | — |
| [verified-queries](capabilities/verified-queries/spec.md) | Saved, trusted question → SQL pairs | — |
| [metrics](capabilities/metrics/spec.md) | Metric definitions and the metrics panel | — |
| [deep-analysis](capabilities/deep-analysis/spec.md) | Multi-step deep analysis runs | — |
| [agents-evals](capabilities/agents-evals/spec.md) | Agent catalogue, eval sets, eval runs and reports | Agents (`agents.spec.ts`) |

A Gherkin Feature that spans capabilities lives in the capability that owns its main outcome; the others link to it.

### Epics

| Epic | Spec |
|---|---|
| BA-2 Data Model DSL | [epics/BA-2](epics/BA-2/spec.md) |
| BA-4 Knowledge Store | [epics/BA-4](epics/BA-4/spec.md) |
| BA-5 Data Connectors | [epics/BA-5](epics/BA-5/spec.md) |
| BA-9 Golden Dataset and Evals | [epics/BA-9](epics/BA-9/spec.md) |
| BA-10 User Testing | [epics/BA-10](epics/BA-10/spec.md) |
| BA-11 Bug Fixes | [epics/BA-11](epics/BA-11/spec.md) |
| BA-12 Response Reliability Signals | [epics/BA-12](epics/BA-12/spec.md) |
| BA-82 Agent Routines | [epics/BA-82](epics/BA-82/spec.md) |
| BA-89 Delivery Process | [epics/BA-89](epics/BA-89/spec.md) |
| BA-111 Local Development Observability | [epics/BA-111](epics/BA-111/spec.md) |
| BA-141 Agentic Hub Look and Feel | [epics/BA-141](epics/BA-141/spec.md) |

## Stack neutrality

- `product/` and `capabilities/` are **stack-neutral**: they describe behaviour, rules and flows, never frameworks or file paths.
- `system/data-model.md`, `api.md`, `agents.md` and `ui.md` describe **contracts** (document shapes, endpoints, prompts, tokens) that any stack must honour. Where the current implementation matters, they say so in a clearly marked *Implementation note*.
- `system/architecture.md` and `system/tech-stack.md` describe **the current implementation**. To rebuild on another stack, replace `tech-stack.md` and treat the ADRs' *Context* sections as constraints.

## Data assets

Some content is data rather than behaviour. A rebuild copies these files verbatim instead of regenerating them from prose:

| Asset | Path | Specified by |
|---|---|---|
| World Cup sample database | `backend/src/modules/testing-data/fixtures/001_world_cup.sql` (identical copy in `docker/postgres/init/`) | [testing-data](capabilities/testing-data/spec.md) |
| Formula 1 sample database | `backend/src/modules/testing-data/fixtures/002_formula_1.sql.gz` | [testing-data](capabilities/testing-data/spec.md) |
| Eval suites: questions, reference SQL, checks, judge rubrics | `backend/src/mastra/evals/assistant-eval-datasets.ts` | [agents-evals](capabilities/agents-evals/spec.md), [agents.md](system/agents.md) |
| Interactive-visuals skill copied into session workspaces | `backend/src/mastra/skills/interactive-visuals/` | [agents.md](system/agents.md) |

## Formats

### Capability spec — `capabilities/<capability>/spec.md`

~~~markdown
# <Capability>

<One paragraph: what the user can do and why it matters.>

## Concepts
Terms this capability uses, linked to product/glossary.md. No new definitions here.

## Rules
Numbered, testable requirements. Each one is a single "The system SHALL / SHALL NOT …" sentence.
- R1. The system SHALL …
- R2. …

## Edge cases and errors
What happens on empty input, failure, timeout, missing permission, invalid data. Exact user-visible messages where they matter.

## Contracts
Links to the endpoints in system/api.md, the collections in system/data-model.md and the agents in system/agents.md this capability owns or uses. No copies.

## UI
Where it lives in the shell (link to system/ui.md), its screens and states: empty, loading, error, populated.

## Flows
Gherkin, one `Feature:` per Playwright spec. Each Feature starts with a line `E2E: \`frontend/e2e/<file>.spec.ts\`` naming its spec file, or `E2E: none yet`. Mentions of another capability's spec file elsewhere in the text are cross-references only.

```gherkin
Feature: …
  Scenario: …
```

## Acceptance
How to tell the capability works end to end: the Flows above plus anything not covered by them.
~~~

### Epic spec — `epics/<EPIC-ID>/spec.md`

```markdown
# <EPIC-ID> — <Epic name>

- **Jira:** <link> · **Roadmap:** Milestone R.M · **Status:** Draft | Confirmed

## Goal
The user-observable outcome the epic delivers, and why.

## Scope
## Out of scope
## Stories
| Story | Summary | Roadmap feature |
## Specs touched
The capability and system specs this epic changes, and how.
## Acceptance
Epic-level success criteria.
## Dependencies, risks and open questions
```

Keep it high level: story detail lives in the roadmap and Jira, behaviour in the capability specs.

## Lifecycle

1. **Before code:** the epic spec exists (Epic gate). The change's branch updates every capability and system spec it affects (workflow step 5): new or changed rules, Gherkin, endpoints, document shapes, prompts, UI.
2. **Review:** the PR diff shows the spec change next to the code change. A PR that changes behaviour, an endpoint, a persisted shape, a prompt or the UI without the matching spec change is incomplete.
3. **Merge:** because specs change on the same branch as the code, `main` always describes the shipped app.

## Rebuild prompt

To rebuild the app (or one capability) from specs alone, give an LLM this folder and:

> You are rebuilding Questions to Insights from its specification. Read `specs/README.md`, then `product/`, then `system/` (architecture, tech-stack, data-model, api, agents, ui, delivery), then every `capabilities/*/spec.md`. Implement the system so every Rule holds and every Gherkin scenario passes. Use the stack in `system/tech-stack.md` unless told otherwise. Where a spec is silent, choose the simplest behaviour consistent with `product/` and list the gap.

**Completeness check:** now and then, rebuild one capability from the specs alone and run its Playwright Feature against the result. Every gap found becomes a spec fix.
