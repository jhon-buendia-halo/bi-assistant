# 1.21.4 — Context area on the navigation rail

Ships a **Context** area on the rail (Datasets, Agents, Context, Sessions; layers icon) that replaces Knowledge's own rail item. Context opens a page of section cards like the Agent Hub's (icon tile, name, two-line description); a card opens its section under a **Context** back control, and the rail's Context returns to the cards. The only card in this story was Knowledge; the cards that followed are 1.21.6 (User personas) and 1.21.11 (Ontologies).

## Gherkin scenarios and the specs that cover them

Specs: [app-shell](../../specs/capabilities/app-shell/spec.md) R3, R3a, R37 and "Moves between areas from the rail"; [ui.md](../../specs/system/ui.md) 2, 3, 4.8, 4.8a.

| Scenario | Playwright spec |
|---|---|
| Moves between areas from the rail (Context in Knowledge's place) | `frontend/e2e/navigation.spec.ts` (updated; passed, [final gate run](../1.21.7/e2e-results.txt)) |
| Expands the rail into a drawer with labels | `frontend/e2e/layout-accessibility.spec.ts` (updated; passed, [final gate run](../1.21.7/e2e-results.txt)) |

The `application-shell` screenshot baseline (`frontend/e2e/layout-accessibility.spec.ts-snapshots/application-shell-web-win32.png`) was refreshed for the new rail label.

## Artifacts

No separate screenshot; the refreshed baseline above and the E2E specs are the evidence. See also [../1.21.11/](../1.21.11/) for the Context page as shipped. All listed scenarios passed in the [final gate run](../1.21.7/e2e-results.txt).

Desktop: not run (web target only).
