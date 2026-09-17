---
name: interactive-visuals
description: Create a self-contained interactive visualization from a completed, data-grounded analysis answer for rendering inside the Questions to Insights project panel.
---

# Interactive Visuals

Turn the supplied question and answer into one focused visual explanation.

- When a `<data>` block is supplied, it holds the exact query results the
  answer was built from (JSON: tool, input SQL, columns, rows). Prefer it as
  the source of truth for every value, series, and label — chart the full
  rows, not just the numbers quoted in prose. When no data block exists, use
  only facts present in the answer text.
- Never invent rows, estimates, labels, or citations.
- Choose the form that makes the main comparison easiest to understand: a
  small SVG chart, ranked bars, metric cards, a timeline, or a compact table.
- Return a short title and a plain-language description explaining what the
  visual shows, how to interact with it, and its main takeaway.
- Produce a body HTML fragment, CSS, and JavaScript as separate outputs. Do not
  include Markdown fences, document-level HTML tags, inline scripts, or inline
  styles in the HTML fragment.
- Use browser-native HTML, CSS, SVG, and JavaScript only. Do not load external
  libraries, fonts, images, APIs, or other network resources.
- Include a useful interaction such as filtering, sorting, toggling a measure,
  or inspecting values. Keep controls keyboard accessible and give the visual
  an accessible name or text alternative.
- Design for a dark panel, adapt cleanly to narrow widths, and avoid animation
  that ignores reduced-motion preferences.
- **Interaction requirements** — every chart shows a hover/focus tooltip with
  the exact values (use `.qti-tooltip`); multi-series charts get a clickable
  legend that toggles series visibility; axes get subtle gridlines using
  `var(--qti-grid)` and labels in `var(--qti-axis)`.
- **Number formatting** — format values for reading: thousands separators,
  compact notation for large values (1.2M), and % or currency units when the
  column implies them. Keep the raw, unrounded values in tooltips.
- Keep scripts deterministic. Do not use dynamic code execution, storage,
  network calls, navigation, timers, workers, or unbounded loops.
- Make every data mark clickable for follow-up questions: put
  `data-qti-value="<the category, series, or label the mark represents>"` on
  each bar, slice, point, cell, or table row (add `data-qti-label="<pretty
  label>"` when the value is a code or an id). Also set
  `data-qti-column="<the column name this mark's value belongs to>"` on every
  mark, so dashboard cross-filtering knows which column the value filters.
  Give those marks `cursor: pointer` and `tabindex="0"`. The host listens for
  the click and turns it into a follow-up question (or, on a pinned dashboard,
  a cross-filter) — do not add your own click handler, navigation, or
  `postMessage` for it.
- When a `<recommended-form>` block is supplied it states the data shape and
  the form chosen for it. Follow it unless the instruction or the data clearly
  argues otherwise, and say why in the description when you deviate.

## Consistency

- Use the frame-provided CSS custom properties for all series and semantic
  colors (`var(--qti-cat-1)` … `var(--qti-cat-8)`, `var(--qti-pos)` /
  `var(--qti-neg)`). Never invent hex colors for data marks.
- Use `.qti-kpis` / `.qti-kpi` / `.qti-kpi-value` / `.qti-kpi-label` /
  `.qti-kpi-delta` with `.qti-up` / `.qti-down` and `.qti-kpi-spark` for KPI
  tiles instead of restyling them from scratch.
- Use `.qti-tooltip` for hover readouts.

## Data access

The frame injects the exact query results the `<data>` block above described
into the rendered document, at `window.qti.data` — same shape (array of
`{ tool, input, columns, rowCount, rows }`). Your script MUST read every
value, label, and precomputed aggregate it renders from `window.qti.data` —
never hardcode data values, labels, or aggregates as JavaScript literals
(chart/axis/section titles may still be literal strings). This is the same
data structure whether the visual is shown full-size, as a dashboard tile, or
downloaded standalone — build tiles, the main chart, and any detail table from
that one structure so they can never disagree.

Rules that keep the script correct against real result sets:

- **Each entry is a separate result set with its own columns.** Never
  concatenate rows across entries (`qti.data.flatMap(d => d.rows)` mixes
  incompatible schemas and produces `undefined` fields, `NaN` totals, and
  empty charts). Select the result set whose columns match what you are
  rendering, by column name:
  `const rec = window.qti.data.find(r => (r.columns || []).includes('player'));`
  A KPI computed from one result set and a chart from another is fine — but
  each must read from the result set that actually carries its columns.
- **Coerce numerics explicitly.** SQL drivers often return numbers as strings
  (`"4"`, `"82.5"`). Wrap every numeric field in `Number(...)` before math,
  and skip rows where the needed field is missing or not finite
  (`Number.isFinite`) so one odd row cannot poison a total or an axis scale.
- **Guard the empty case.** If the selected result set is missing or has no
  rows, render a short "no data" message instead of NaN or a blank chart.

Data can be refreshed after the visual is built by re-running the stored SQL,
without regenerating your code. Call `window.qti.onRefresh(render)` with the
same function (or an equivalent) you use for the initial render, so that when
the host swaps in fresh rows your visual re-renders from them automatically.

Visuals need no filter logic of their own. On a pinned dashboard, the frame
applies the global filter bar and cross-filter clicks by swapping
`window.qti.data` to the already-filtered rows and calling your `onRefresh`
callback — a correct `onRefresh` re-render is all that is required for a
visual to participate in dashboard filtering.

## Composed answers

When `<recommended-form>` contains a "Composed answer:" paragraph, the data is
rich enough to answer with a small composition instead of a single chart. Build
all of it in the one HTML fragment, top to bottom:

1. **KPI tiles** — a row of two to four tiles built from the frame classes:
   `.qti-kpis` for the row, `.qti-kpi` per tile, `.qti-kpi-value` for the
   number large, `.qti-kpi-label` beneath it, and a unit or short qualifier
   when it helps. Add a delta (`+12% vs. Q1`) with `.qti-kpi-delta` and
   `.qti-up` or `.qti-down` only when the supplied rows actually contain both
   sides of the comparison; never estimate one. When a temporal column exists
   and a tile has a per-period series behind it, add a small inline SVG
   sparkline in `.qti-kpi-spark`.
2. **Main chart** — the form the recommendation names, as the centrepiece.
3. **Detail table** — the underlying rows in a compact table inside a
   `<details>` element (or an equivalent keyboard-operable disclosure), closed
   by default and labelled with the row count.

Rules that do not relax for a composition:

- One fragment, one stylesheet, one script; no external resources.
- `data-qti-value` (plus `data-qti-label` where the value is a code, and
  `data-qti-column` naming the column the value belongs to) on every KPI tile
  and every chart mark and table row, with `cursor: pointer` and
  `tabindex="0"` — a tile is as clickable as a bar.
- Keep the whole bundle inside the character budget the prompt states (20,000
  for a composed answer): spend it on the data, not on decoration.
- The tiles, chart, and table must all read from the same data structure in
  the script — `window.qti.data` — so they cannot disagree. Filtering or
  sorting the chart should keep the table consistent with it.
- Stack to a single column at narrow widths.
