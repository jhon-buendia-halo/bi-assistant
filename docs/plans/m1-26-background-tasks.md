# M1-26 — Background tasks survive navigation: plan and contract

Requested 2026-11-15: a long process (saving a dataset was the example) disappears when the user opens another screen, and the resource it makes only shows up once it ends. Confirmed with a prototype: a **Background tasks** button in the rail beside System logs, a panel of running and finished tasks, the resource shown at once in its list, and a toast with **Open** or **Retry** at the end. ADR-0047.

## 1. The shared layer (story 1.26.1, done first)

`frontend/src/app/core/background-tasks/background-tasks.service.ts` (`BackgroundTasksService`, root):

- `start({ kind, key, title, work, onValue?, outcome?, errorMessage?, open?, onFinish?, toast?, onCancel? })` subscribes `work()` **at the root**, so a component's destruction never cancels it. Starting a kind and key that is already running returns the running task.
- `active(kind, key?)`, `latest(kind, key)`, `get(id)`: signal reads, usable in `computed`.
- `update(id, { detail, progress, title })` while running; `cancel(id)` (Stop), `retry(id)`, `dismiss(id)`, `clearFinished()`, `open(id)`.
- `finished$`: every task that ends. `tasks`, `running`, `finished`, `runningCount`, `now` (1 s clock while something runs).
- At the end it toasts the outcome (server message, else `<title>: done`): success with **Open** when `open` is given, failure with **Retry**. `toast: false` or a function `(task) => boolean` (decided at the end) turns it off.
- `outcome(last)` reads `{ ok, message }` from the last emitted value (Style A responses: `res => ({ ok: !!res?.ok, message: res?.message })`). Request errors use the server `message`, else "Backend unreachable".

`frontend/src/app/shared/components/background-tasks/` renders the rail button (`data-testid="background-tasks-button"`, the count `background-tasks-count`) and the panel (`role="dialog"`, `aria-label="Background tasks"`, rows `data-testid="background-task"` with `data-status`).

`ToastService.success/error(message, action?)`: a toast may carry one action button (`data-testid="toast-action"`).

## 2. Rules for every integration

1. The component starts the work through `BackgroundTasksService.start`, never by subscribing itself. Its busy state is a `computed` over `service.active(kind, key)`, so it is right again when the screen is shown again.
2. It reads the result from the task (`latest(kind, key)` / `finished$` with `takeUntilDestroyed`), not from a subscription it owns.
3. The service toasts the end. Remove the component's own success and error toasts for that work, so nothing is toasted twice. Validation that fails before any request (no name, nothing selected) still toasts from the component.
4. Keep the existing copy, `data-testid`s and button labels unless the rule below changes them; the Playwright specs rely on them.
5. Every task gets an `open` that brings the user back to where the result is (an area, a view, a tab).
6. Unit-test the component: the busy state survives destroying and re-creating it, and the result shows when it is re-created after the end.

## 3. Kinds, keys and where they open

| Kind | Key | Title | Progress | Open | Story |
|---|---|---|---|---|---|
| `dataset-save` | dataset name (trimmed) | `Saving dataset "<name>"` | none (indeterminate) | Datasets list, the dataset opened | 1.26.2 |
| `inventory-refresh` | datasource id | `Loading the inventory of "<datasource>"` | none | the catalog browser on that datasource | 1.26.2 |
| `testing-data-load` | fixture id | `Loading testing data "<name>"` | none | Settings → Testing Data | 1.26.3 |
| `ontology-bootstrap` | dataset name | `Suggesting ontology for "<dataset>"` | the stream's stages | the dataset's Ontology tab | 1.26.3 |
| `synthetic-profile` | dataset name | `Profiling "<dataset>"` | none | the dataset's Profile & synthesize tab | 1.26.3 |
| `visual-tailor`, `visual-refresh` | `<runId>/<visualId>` | `Tailoring visual "<title>"`, `Refreshing visual "<title>"` | none | the run (workflow page or run detail) | 1.26.4 |
| `eval-run` | agent key | `Running evals · <agent name>` | `done/total` from the poll | the agent's page, Evals tab | 1.26.4 |
| `workflow-run` | run id | `<workflow name>: <run title>` | the run's steps | the workflow page drawn with the run | 1.26.5 (phase 3, approach chosen by the user) |

## 4. Saving a dataset (the reported case)

Save starts the task and returns to the Datasets list at once. The list shows a pending row for every running `dataset-save` whose name is not in the list yet (spinner, the name, the datasource and entity count, a `Saving… <m:ss>` chip, `data-testid="dataset-row-pending"`, not openable), and the `Saving…` chip on the row of a dataset being re-saved. At the end the list re-fetches; a failed save leaves the row with the error and **Retry** / **Dismiss** (the same as the panel).
