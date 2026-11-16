# M1-26 — Background tasks survive navigation

- **Roadmap:** Milestone 1.26 · **Status:** Confirmed (2026-11-15, the user, after a static prototype: "usa el rail junto al system log e implementa las 3 fases".)

## Goal

Saving a dataset disappeared when the user opened another screen, and the dataset appeared only once the save ended. The same held for most slow operations; some were cancelled outright. After this epic:

- Long work the user starts keeps running when they leave its screen, and its result is not lost.
- A **Background tasks** button in the rail, above System logs, shows what runs (with elapsed time and, when known, progress) and what ended, with **Open**, **Retry** and **Dismiss**.
- A resource being made shows at once where it will live (a dataset being saved is a pending row in the Datasets list).
- A toast reports the end once, with **Open** or **Retry**.

## Scope

- The shared layer: `BackgroundTasksService`, the rail button and panel, toast actions (1.26.1).
- Wired operations: saving a dataset, loading an inventory (1.26.2); loading Testing Data, ontology suggestions, the synthetic profile (1.26.3); tailoring and refreshing a visual, eval runs (1.26.4).
- Workflow runs keep running when their page is left (1.26.5), with the approach the user picks among three.

## Out of scope

- Storing tasks across a window reload or an app restart (the panel starts empty on launch).
- Short calls (test connection, list models, Copilot status) and conversational ones (Try it, a step's chat), which stay tied to their screen.
- The automatic visual repair, which the user does not start.

## Stories

| Story | What | Status |
|---|---|---|
| 1.26.1 | The background tasks layer and the rail indicator | In progress |
| 1.26.2 | Saving a dataset and loading an inventory | In progress |
| 1.26.3 | Testing Data, ontology suggestions, synthetic profile | In progress |
| 1.26.4 | Visual tailor and refresh, eval runs | In progress |
| 1.26.5 | Workflow runs keep running when their page is left (approach A: backend run registry, re-attach, Stop endpoint) | In progress |

## Specs touched

- [app-shell](../../capabilities/app-shell/spec.md) R30, R37, R58–R63.
- [ui.md](../../system/ui.md) 1.3, 3.3, 3.7, 5.1, 5.3.
- [architecture.md](../../system/architecture.md) ADR-0047.
- The capability specs of each wired operation: datasets, testing-data, dataset-ontology, synthetic-data, visuals, agents-evals; workflows and api.md for 1.26.5.

## Acceptance

- Each wired operation, started and then left for another area, still runs (the rail shows it), and its screen shown again shows it running or its result.
- A dataset being saved is listed at once as "Saving…" and becomes a normal row when the save ends.
- The end is toasted once, with **Open** or **Retry**.
- Unit tests per story; the impacted Playwright specs stay green.

## Dependencies, risks and open questions

- Plan and contract: [docs/plans/m1-26-background-tasks.md](../../../docs/plans/m1-26-background-tasks.md).
- Risk: a component that still toasts its own outcome would toast twice; the plan's rule 3 removes them.
- 1.26.5 approach A, picked by the user on 2026-11-15 ("vamos con tu recomendacion"); ADR-0048.
