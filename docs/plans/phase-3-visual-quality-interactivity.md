# Phase 3 execution plan — Visual quality + interactivity

From `docs/research/competitive-research-and-improvement-plan.md` §3 Phase 3 (items 9-12). Two workstreams; the contract below is fixed — both sides code against it.

## Shared contract

**New endpoints** (sessions.controller.ts, `{ok, message, session?, visualization?}` response shape like revert):

- `POST /sessions/:id/visualizations/:vid/repair` body `{ error: string, version: number }` — regenerate the visual's current version with the runtime error as feedback; new version whose `instruction` is `auto-repair: <error>` (truncated to 200 chars). Rejects (`ok:false`) when `version !== currentVersion` or when the current version's `instruction` already starts with `auto-repair:` (one auto-repair per broken generation — no loops).
- `POST /sessions/:id/visualizations/:vid/tailor` body `{ instruction: string }` — same pipeline as the `update_visual` tool (designer with current bundle + instruction), persists metadata **with** an `updated` chat event (mirrors `generateVisualization`'s button path).

**postMessage from the sandboxed frame** (existing `visual-error` unchanged):

- `{ type: 'visual-error', message: string }` — runtime error OR blank render (blank message: `visual rendered blank`).
- `{ type: 'visual-select', value: string, label?: string }` — user clicked a data mark.

## Workstream A — Backend (+ frame + skill; all under backend/)

### Item 9: Deterministic chart-type heuristic

- New pure module `backend/src/modules/sessions/chart-heuristic.ts`: `recommendChartForm(records: ToolDataRecord[]): { shape: string; recommendation: string } | undefined` operating on the same records `visualizationData` charts.
  - Column classification from the rows (up to the capped sample): temporal (native Date, ISO-like strings, column type/name hints: date/time/month/week/year), numeric (number or numeric strings), else categorical (track distinct-count).
  - Rules (first match): 1 row × ≥1 numeric → metric cards; temporal + ≥1 numeric → line (multi-series when 2-3 numerics); 1 categorical + 1 numeric → sorted horizontal bars, top-N + "Other" when >8 categories; 2 numerics (+optional category) → scatter; 2 categoricals + 1 numeric → heatmap; fallback → compact sortable table.
- Inject into the designer prompt in `runDesigner` (create path AND tailor path) as its own block:
  ```
  <recommended-form>
  Data shape: <shape summary — column roles, cardinalities, row count>.
  Recommended form: <rule output>. Use this form unless the instruction or the
  data itself argues for another; if you deviate, say why in the description.
  </recommended-form>
  ```
- Unit tests: one per rule + mixed-type edge cases (numeric strings, ISO dates, nulls).

### Item 10: Runtime repair loop

- **Blank-render check** in `visualization-document.ts` `RUNTIME_ERROR_HOOK` (sandboxed doc only): after `load` + ~1500ms timeout, if the `.qti-visual` section has no visible content (no svg/canvas/table/img and `offsetHeight < 24` for its children), post `visual-error` with message `visual rendered blank`. Guard so a real error already posted suppresses the blank report.
- `VisualizationService.repair(session, visualId, errorMessage)`: load current bundle, run the designer with feedback block `<previous-attempt-error> Your previous code failed at runtime in the sandbox: <error>. Return corrected, complete code that renders the same visual. </previous-attempt-error>` (reuse the existing `feedback` plumbing; extend its wording to cover runtime vs parse), persist as a new version with `instruction: 'auto-repair: <error>'`. No chat event (silent fix; version history shows it).
- Controller endpoint per contract, with the two rejection guards. Service-level guard too (don't trust the client).

### Item 11: Click-to-follow-up (frame side)

- In both stored and sandboxed documents, add a small frame script (before the designer's script) defining:
  ```js
  window.qti = { select: function (value, label) { …postMessage({type:'visual-select', value:String(value), label:label==null?undefined:String(label)}, '*')… } };
  ```
  plus a delegated click/keydown(Enter) listener: any element with `data-qti-value` (optional `data-qti-label`) triggers `qti.select`. In the standalone stored document the postMessage is a harmless no-op.
- `SKILL.md` additions: put `data-qti-value="<the category/series/label the mark represents>"` on every clickable data mark (bars, slices, points, table rows); the host turns clicks into follow-up questions. Marks should have `cursor: pointer` and `tabindex="0"`. Keep it one short bullet block.

### Item 12: Tailor endpoint

- `SessionsService.tailorVisualization(id, visualId, instruction)`: exactly the `update_visual` tool path (`visuals.update` + `saveVisualMetadata` with `updated` event) but callable over HTTP; controller route per contract. Validate non-empty instruction.

### Tests
chart-heuristic rules; repair guards (version mismatch, double-repair, happy path with mocked designer); tailor persists event; prompt contains `<recommended-form>` (extend visualization.service.spec.ts); blank-check script present in the sandboxed document string.

## Workstream B — Frontend (frontend/ only)

Files: interactive-visual-panel.*, sessions-api.service.ts, session-chat.*, app.ts/html, models.

### Item 10 UI: auto-repair
- `sessions-api.service`: `repairVisualization(sessionId, visualId, error, version)`, `tailorVisualization(sessionId, visualId, instruction)`.
- Panel: on `visual-error` for the **current** version, instead of only showing the banner: set a `repairing` signal (spinner overlay chip "Fixing the visual…"), call repair once (track attempted per `visualId:version` so a second error just shows the banner), on success emit the refreshed visualization/session upward (reuse the path `revertVersion`/`viewVisual` results flow through in app.ts); on failure show the existing banner with the original error.
- While viewing an old version, keep today's banner behavior (no auto-repair).

### Item 11 UI: follow-up chips
- Panel: handle `visual-select` messages → output `dataPointSelected = output<{value, label?}>()`.
- app.ts/html: pass it to `session-chat` as an input signal.
- session-chat: when a selection arrives (and a visual is open), show a dismissible chip row directly above the input: `Drill into "<label||value>"` and `Why "<label||value>"?`. Clicking a chip fills the input with a sensible prompt (e.g. `Drill into "<value>": break it down further.` / `Why does "<value>" stand out? Explain the drivers.`) and focuses the input — the user sends it (don't auto-send). New selection replaces the old chips; sending or dismissing clears them. Never touch an in-flight stream.

### Item 12 UI: tailoring controls
- Panel toolbar: a "Tailor" button (Sparkles or SlidersHorizontal icon) opening a small popover form: chart type select (Auto, Bar, Line, Scatter, Heatmap, Metric cards, Table, Donut), sort (None/Ascending/Descending), top-N (empty or number 3-50). Apply → build one plain-English instruction from the chosen values (skip "Auto"/"None"/empty parts; e.g. `Change the visual to a line chart. Sort descending by the main measure. Show only the top 10 items and group the rest as "Other".`) → `tailorVisualization` → on success the session + visualization refresh (chat gains the updated-visual event card; same refresh path as the agent-driven update, SSE `visual-updated` does not apply here so use the returned payload). Disable Apply while running; surface `ok:false` messages as the panel error.
- If every control is Auto/None/empty, disable Apply.

### Constraints
Standalone + signals, Tailwind v4, lucide icons, match panel idioms. Never abort in-flight streams. No `git stash`.

## Verification (both)
Backend: `npm run build` + `npm test` green, new specs included. Frontend: build + `ng test` (the app.spec.ts keyboard-resize failure is pre-existing). No commits. No AI attribution.
