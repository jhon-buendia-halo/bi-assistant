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
- Keep scripts deterministic. Do not use dynamic code execution, storage,
  network calls, navigation, timers, workers, or unbounded loops.
- Make every data mark clickable for follow-up questions: put
  `data-qti-value="<the category, series, or label the mark represents>"` on
  each bar, slice, point, cell, or table row (add `data-qti-label="<pretty
  label>"` when the value is a code or an id). Give those marks
  `cursor: pointer` and `tabindex="0"`. The host listens for the click and
  turns it into a follow-up question — do not add your own click handler,
  navigation, or `postMessage` for it.
- When a `<recommended-form>` block is supplied it states the data shape and
  the form chosen for it. Follow it unless the instruction or the data clearly
  argues otherwise, and say why in the description when you deviate.

## Composed answers

When `<recommended-form>` contains a "Composed answer:" paragraph, the data is
rich enough to answer with a small composition instead of a single chart. Build
all of it in the one HTML fragment, top to bottom:

1. **KPI tiles** — a row of two to four tiles with the headline figures: the
   number large, its label beneath, and a unit or short qualifier when it
   helps. Add a delta (`+12% vs. Q1`) only when the supplied rows actually
   contain both sides of the comparison; never estimate one.
2. **Main chart** — the form the recommendation names, as the centrepiece.
3. **Detail table** — the underlying rows in a compact table inside a
   `<details>` element (or an equivalent keyboard-operable disclosure), closed
   by default and labelled with the row count.

Rules that do not relax for a composition:

- One fragment, one stylesheet, one script; no external resources.
- `data-qti-value` (plus `data-qti-label` where the value is a code) on every
  KPI tile and every chart mark and table row, with `cursor: pointer` and
  `tabindex="0"` — a tile is as clickable as a bar.
- Keep the whole bundle inside the character budget the prompt states (16,000
  for a composed answer): spend it on the data, not on decoration.
- The tiles, chart, and table must all read from the same data structure in
  the script, so they cannot disagree. Filtering or sorting the chart should
  keep the table consistent with it.
- Stack to a single column at narrow widths.
