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
