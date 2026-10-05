# BA-89 — Delivery Process

- **Jira:** [BA-89](https://halo-powered.atlassian.net/browse/BA-89) · **Roadmap:** Milestone 0.2 · **Status:** Confirmed

## Goal

Every change to Questions to Insights is planned, specified, built, verified and traced the same way. The repo holds a complete, current specification of the app: an LLM given only [specs/](../../README.md) could rebuild it.

## Scope

- The delivery workflow and its conventions in [CLAUDE.md](../../../CLAUDE.md): roadmap, ADRs, specs, E2E impact analysis, evidence, retrospective, branching, Epic gate.
- The process documents at the repo root: roadmap, changelog, retrospective and evidence.
- The `specs/` tree: product, system, capability and epic specs, and their lifecycle.
- The rules on `main` that enforce these conventions: the required spec check, and a reviewed PR for every merge.

## Out of scope

- Product behaviour. Changes to the app itself belong to the product epics.
- CI/CD workflow changes, unless they enforce a delivery convention.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-84](https://halo-powered.atlassian.net/browse/BA-84) | Adopt the delivery workflow, beta roadmap and branching convention | 0.2.1 |
| [BA-90](https://halo-powered.atlassian.net/browse/BA-90) | Rebuildable system specs in `specs/` | 0.2.2 |
| [BA-108](https://halo-powered.atlassian.net/browse/BA-108) | Require the spec check before merging to `main` | 0.2.3 |
| [BA-110](https://halo-powered.atlassian.net/browse/BA-110) | Require PR approval on `main`; only the repo admin may merge without one | 0.2.4 |

## Specs touched

- [specs/README.md](../../README.md): layout, formats, lifecycle, rebuild prompt.
- Every file under [product/](../../product/), [system/](../../system/) and [capabilities/](../../capabilities/), created by the BA-90 backfill.
- [system/delivery.md](../../system/delivery.md): the release workflow and the branch rulesets on `main` (BA-108, BA-110).

## Acceptance

- CLAUDE.md describes the workflow, every convention and the Epic gate, and every file it references exists.
- `specs/` describes the shipped app completely enough that rebuilding one capability from the specs alone passes that capability's Playwright Feature.
- Every PR that changes behaviour, an endpoint, a persisted shape, a prompt or the UI changes the matching spec in the same PR.

## Dependencies, risks and open questions

- **Risk: spec drift.** Specs are only as current as the PRs that change them. Review is the enforcement point; a CI check (for example, every backend route appears in `system/api.md`) would make it automatic.
