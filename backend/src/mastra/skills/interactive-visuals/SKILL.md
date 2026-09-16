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
