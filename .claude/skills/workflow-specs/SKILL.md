---
name: workflow-specs
description: Use at workflow step 5, before any test or code: update the epic, capability (Rules and Gherkin) and system specs the change affects; also whenever writing Gherkin or deciding which spec file a fact belongs in.
---

# Step 5 — Update the specs

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core (the mandatory first action, the step list, the fast loop and acceptance gate, the hard gates). Load this skill before the step starts.

## The step

5. **Update specs** — before any test or code, update every spec the change affects: the epic spec, the capability spec's Rules and Gherkin Flows, and the system specs for any endpoint, persisted shape, prompt, UI or delivery change. The Gherkin is the executable spec the implementation is measured against. See **Spec convention**.

## Spec convention — the specs describe the shipped app, completely

**[specs/](../../../specs/README.md) is the single source of truth for what the app does and how it is built, complete enough that an LLM given only that folder could rebuild the app.** Layout, formats, stack-neutrality and the rebuild prompt are in [specs/README.md](../../../specs/README.md).

- **Specs change with the code, on the same branch** (workflow step 5). A PR that changes behaviour, an endpoint, a persisted shape, an agent prompt or tool, the UI, or the build and release process without the matching spec change is incomplete. Because specs change on the branch, `main` always describes the shipped app.
- **Where things go:** behaviour rules and user flows → `specs/capabilities/<capability>/spec.md`; endpoints, IPC and CLI → `system/api.md`; collections, document shapes, files on disk and migrations → `system/data-model.md`; agents, prompts, tools and model routing → `system/agents.md`; layout, screens, tokens and copy → `system/ui.md`; frameworks, versions and code layout → `system/tech-stack.md`; build, packaging and release → `system/delivery.md`; terms → `product/glossary.md`. A new capability gets a new folder and a row in the [specs/README.md](../../../specs/README.md) table.
- **Each fact lives in one file.** Link to it; never copy it.
- **CI enforces coverage.** `.github/workflows/spec-checks.yml` runs `python3 scripts/check-specs.py` on every PR, and a ruleset on `main` makes it a required check, so a PR with drifting specs cannot merge. It fails when a route, collection, agent, Playwright spec, capability or roadmap epic has no spec, or when a link breaks. Run it locally before pushing. It proves coverage, not correctness.
- **Gherkin:** every user-facing flow is a `Scenario:` under a `Feature:` in the Flows section of the capability spec that owns it, in standard Gherkin (`Given / When / Then / And`). It covers navigation, dialogs, panels, toasts, form submits, chat/stream behaviour and visual tailoring, but not purely visual tweaks or internal refactors. Write from the user's point of view (`When I click "New session"`), not the implementation's. Each Feature names its Playwright spec file, or says `E2E: none yet`.
